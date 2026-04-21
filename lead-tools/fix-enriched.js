#!/usr/bin/env node
// fix-enriched.js -- Post-processor for enriched CSVs
// Phase 1: Strip untrusted phone sources
// Phase 2: LinkedIn enrichment via Apify
// Phase 3: Re-scrape websites for lost phones
//
// Usage:
//   node fix-enriched.js --all                         # process all enriched-*.csv
//   node fix-enriched.js --input enriched-plumbers.csv # single file
//   node fix-enriched.js --all --skip-linkedin         # phases 1+3 only
//   node fix-enriched.js --all --skip-rescrape         # phases 1+2 only
//   node fix-enriched.js --all --phase 2               # resume from phase 2

const fs = require('fs');
const path = require('path');
const { parseCSV } = require('./dedup-platforms');
const {
    loadProxies, launchBrowser, forceCloseBrowser, newPage,
    sleep, writeCSV, ensureDir, sendTelegram
} = require('./scraper-base');
const { runApifyBatch } = require('./apify-linkedin');

// ============================================================
// Config
// ============================================================

const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf('--' + name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name) { return args.includes('--' + name); }

const ENRICHED_DIR = path.resolve(getArg('dir', './output/enriched/'));
const INPUT_FILE = getArg('input', '');
const ALL = hasFlag('all');
const SKIP_LINKEDIN = hasFlag('skip-linkedin');
const SKIP_RESCRAPE = hasFlag('skip-rescrape');
const START_PHASE = parseInt(getArg('phase', '1'));
const PROXY_FILE = getArg('proxies', './proxies-fast.txt');
const BROWSER_ROTATE_EVERY = 10;

const TRUSTED_SOURCES = ['website', 'website_via_search', 'facebook', 'google_maps', 'cross_platform'];

// ============================================================
// Phone validation (copied from enrich-leads-lite.js)
// ============================================================

const TRACKING_PREFIXES = ['03', '084', '087', '09', '070', '076', '056'];
const PLATFORM_TRACKING_PREFIXES = ['07307', '07360', '07308', '07309'];

function isValidUKMobile(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length !== 11) return false;
    if (!cleaned.startsWith('07')) return false;
    if (cleaned.startsWith('070')) return false;
    if (cleaned.startsWith('076')) return false;
    return true;
}

function isValidUKLandline(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length < 10 || cleaned.length > 12) return false;
    if (cleaned.startsWith('07')) return false;
    if (TRACKING_PREFIXES.some(p => cleaned.startsWith(p))) return false;
    return (cleaned.startsWith('01') || cleaned.startsWith('02') ||
            cleaned.startsWith('0800') || cleaned.startsWith('0808'));
}

function cleanUKPhone(raw) {
    if (!raw) return '';
    return raw.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
}

function isTrackingNumber(num, checkatradePhone) {
    if (!num) return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (checkatradePhone) {
        const ctCleaned = checkatradePhone.replace(/[^\d]/g, '');
        if (cleaned === ctCleaned) return true;
    }
    if (TRACKING_PREFIXES.some(p => cleaned.startsWith(p))) return true;
    if (PLATFORM_TRACKING_PREFIXES.some(p => cleaned.startsWith(p))) return true;
    return false;
}

// ============================================================
// OUTPUT_HEADERS (copied from enrich-leads-lite.js)
// ============================================================

const OUTPUT_HEADERS = [
    'company_name', 'first_name', 'last_name', 'full_name', 'role',
    'trade_type', 'location', 'postcode', 'registered_address',
    'mobile', 'landline', 'all_phones', 'email_primary', 'all_emails',
    'website', 'facebook', 'instagram', 'linkedin_company', 'linkedin_owner',
    'checkatrade_phone', 'google_phone',
    'overall_rating', 'review_count', 'years_on_checkatrade',
    'google_reviews', 'google_rating',
    'last_review_date', 'review_response_rate',
    'company_size', 'is_ltd', 'is_vat', 'team_language', 'has_team_page',
    'employee_signals', 'competitor_tools', 'services_listed',
    'has_online_booking', 'has_live_chat', 'website_platform',
    'sic_codes', 'filing_category', 'company_age', 'company_status',
    'director_count', 'director_occupation', 'psc_name', 'last_accounts_date',
    'linkedin_company_size', 'linkedin_owner_name', 'linkedin_owner_title',
    'sniper_fit_tier', 'sniper_fit_score', 'sniper_fit_reasons',
    'contact_completeness', 'pain_signals',
    'platforms', 'platform_count', 'match_confidence',
    'phone_source', 'website_source', 'name_source',
    'other_platform_ratings',
    'profile_url', 'handle', 'companies_house_number'
];

// ============================================================
// Phone extraction from website (copied from enrich-leads-lite.js)
// ============================================================

async function extractPhonesFromPage(page) {
    return page.evaluate(() => {
        const body = document.body.innerText || '';
        const data = { mobiles: [], landlines: [], phones: [] };

        // Mobile pattern
        const mobilePattern = /(?:^|\s|tel:|phone:|call[:\s]|mob(?:ile)?[:\s])?((?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3})/gi;
        const mobiles = body.match(mobilePattern) || [];
        for (const m of mobiles) {
            const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned);
                data.phones.push(cleaned);
            }
        }

        // tel: links
        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
        for (const link of telLinks) {
            const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (num.length === 11 && num.startsWith('07')) {
                data.mobiles.push(num);
                data.phones.push(num);
            } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02') || num.startsWith('0800') || num.startsWith('0808'))) {
                data.landlines.push(num);
                data.phones.push(num);
            }
        }

        // Landline patterns
        const landlinePatterns = [
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s]|fax[:\s])?((?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6})/gi,
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s])?((?:\+44\s?|0)2\d{4}[\s.-]?\d{4})/gi,
            /(0800[\s.-]?\d{3}[\s.-]?\d{3,4})/gi,
            /(0808[\s.-]?\d{3}[\s.-]?\d{3,4})/gi
        ];
        for (const pattern of landlinePatterns) {
            const matches = body.match(pattern) || [];
            for (const m of matches) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                    data.landlines.push(cleaned);
                    data.phones.push(cleaned);
                }
            }
        }

        // JSON-LD phones
        try {
            const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const script of jsonLdScripts) {
                try {
                    const ld = JSON.parse(script.textContent);
                    const items = Array.isArray(ld) ? ld : [ld];
                    for (const item of items) {
                        const phone = item.telephone || (item.contactPoint && item.contactPoint.telephone);
                        if (phone) {
                            const cleaned = phone.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                                data.mobiles.push(cleaned); data.phones.push(cleaned);
                            } else if (cleaned.length >= 10 && !cleaned.startsWith('07')) {
                                data.landlines.push(cleaned); data.phones.push(cleaned);
                            }
                        }
                    }
                } catch {}
            }
        } catch {}

        // Meta tag phones
        const metaTags = Array.from(document.querySelectorAll('meta[name*="phone"], meta[name*="telephone"], meta[property*="phone"], meta[itemprop="telephone"]'));
        for (const meta of metaTags) {
            const content = meta.getAttribute('content') || '';
            const cleaned = content.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned); data.phones.push(cleaned);
            } else if (cleaned.length >= 10 && !cleaned.startsWith('07')) {
                data.landlines.push(cleaned); data.phones.push(cleaned);
            }
        }

        // Deduplicate
        data.mobiles = [...new Set(data.mobiles)];
        data.landlines = [...new Set(data.landlines)];
        data.phones = [...new Set(data.phones)];
        return data;
    });
}

// ============================================================
// Checkpoint management
// ============================================================

function checkpointPath(filePath, phase) {
    const base = path.basename(filePath, '.csv');
    return path.join(ENRICHED_DIR, `checkpoint-fix-${base}-p${phase}.json`);
}

function saveCheckpoint(filePath, phase, rows) {
    const cp = { phase, rows, timestamp: new Date().toISOString() };
    fs.writeFileSync(checkpointPath(filePath, phase), JSON.stringify(cp));
}

function loadCheckpoint(filePath, phase) {
    const cpPath = checkpointPath(filePath, phase);
    if (fs.existsSync(cpPath)) {
        return JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
    }
    return null;
}

function clearCheckpoints(filePath) {
    for (let p = 1; p <= 3; p++) {
        const cpPath = checkpointPath(filePath, p);
        if (fs.existsSync(cpPath)) fs.unlinkSync(cpPath);
    }
}

// ============================================================
// Phase 1: Strip untrusted phones
// ============================================================

function phase1StripPhones(rows) {
    const stats = { kept: 0, stripped: 0, directoryVerified: 0, directoryStripped: 0 };
    const lostPhoneList = [];

    for (const row of rows) {
        const source = (row.phone_source || '').toLowerCase().trim();

        // Trusted sources -- keep as-is
        if (TRUSTED_SOURCES.includes(source)) {
            stats.kept++;
            continue;
        }

        // Directory -- verify against google_phone or website source
        if (source === 'directory') {
            const currentPhone = cleanUKPhone(row.mobile || row.landline || '');
            const googlePhone = cleanUKPhone(row.google_phone || '');

            // Verified if same phone found on Google Maps
            if (currentPhone && googlePhone && currentPhone === googlePhone) {
                row.phone_source = 'directory_verified';
                stats.directoryVerified++;
                stats.kept++;
                continue;
            }

            // Not verified -- strip
            const hadPhone = !!(row.mobile || row.landline);
            row.mobile = '';
            row.landline = '';
            row.all_phones = '';
            row.phone_source = '';
            if (hadPhone) {
                lostPhoneList.push(row);
                stats.directoryStripped++;
            }
            stats.stripped++;
            continue;
        }

        // Checkatrade or empty/unknown -- strip
        const hadPhone = !!(row.mobile || row.landline);
        row.mobile = '';
        row.landline = '';
        row.all_phones = '';
        row.phone_source = '';
        if (hadPhone) {
            lostPhoneList.push(row);
        }
        stats.stripped++;
    }

    return { rows, lostPhoneList, stats };
}

// ============================================================
// Phase 2: LinkedIn enrichment
// ============================================================

async function phase2LinkedIn(rows, filePath) {
    // Filter leads missing both linkedin fields
    const needLinkedIn = rows.filter(r =>
        !r.linkedin_company && !r.linkedin_owner
    );

    if (needLinkedIn.length === 0) {
        console.log('[Phase 2] No leads need LinkedIn enrichment');
        return rows;
    }

    console.log(`[Phase 2] ${needLinkedIn.length} leads need LinkedIn`);

    // Write batch input CSV
    const batchFile = path.join(ENRICHED_DIR, `linkedin-batch-${path.basename(filePath, '.csv')}.csv`);
    const batchHeaders = ['company_name', 'full_name', 'location', 'trade_type'];
    const batchRows = needLinkedIn.map(r => ({
        company_name: r.company_name || '',
        full_name: r.full_name || '',
        location: r.location || '',
        trade_type: r.trade_type || ''
    }));
    writeCSV(batchFile, batchHeaders, batchRows);

    // Run Apify batch
    const resultsFile = path.join(ENRICHED_DIR, `linkedin-results-${path.basename(filePath, '.csv')}.csv`);
    const results = await runApifyBatch(batchFile, resultsFile);

    // Merge results back
    let merged = 0;
    for (const row of rows) {
        if (row.linkedin_company || row.linkedin_owner) continue;
        const match = results.get(row.company_name);
        if (match) {
            row.linkedin_company = match.linkedin_company || '';
            row.linkedin_company_size = match.linkedin_company_size || '';
            row.linkedin_owner_name = match.linkedin_owner_name || '';
            row.linkedin_owner_title = match.linkedin_owner_title || '';
            merged++;
        }
    }

    console.log(`[Phase 2] Merged ${merged} LinkedIn matches`);

    // Cleanup batch file
    if (fs.existsSync(batchFile)) fs.unlinkSync(batchFile);

    return rows;
}

// ============================================================
// Phase 3: Re-scrape websites for lost phones
// ============================================================

async function phase3RescrapePhones(rows, lostPhoneList) {
    // Filter: lost phone AND has website AND still no phone
    const toRescrape = lostPhoneList.filter(r =>
        r.website && !r.mobile && !r.landline
    );

    if (toRescrape.length === 0) {
        console.log('[Phase 3] No leads need phone re-scraping');
        return rows;
    }

    console.log(`[Phase 3] Re-scraping ${toRescrape.length} websites for phones`);

    loadProxies(PROXY_FILE);
    let browser = null;
    let recovered = 0;
    let errors = 0;

    for (let i = 0; i < toRescrape.length; i++) {
        const row = toRescrape[i];

        // Rotate browser
        if (i % BROWSER_ROTATE_EVERY === 0) {
            if (browser) await forceCloseBrowser(browser);
            try {
                browser = await launchBrowser({ stealth: true });
            } catch (err) {
                console.log(`[Phase 3] Browser launch failed: ${err.message}`);
                break;
            }
        }

        try {
            const page = await newPage(browser);

            // Visit main page
            let url = row.website;
            if (!url.startsWith('http')) url = 'https://' + url;

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await sleep(2000);

            let phoneData = await extractPhonesFromPage(page);

            // Also try /contact page
            try {
                const contactUrl = new URL('/contact', url).href;
                await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await sleep(1500);
                const contactPhones = await extractPhonesFromPage(page);
                phoneData.mobiles = [...new Set([...phoneData.mobiles, ...contactPhones.mobiles])];
                phoneData.landlines = [...new Set([...phoneData.landlines, ...contactPhones.landlines])];
                phoneData.phones = [...new Set([...phoneData.phones, ...contactPhones.phones])];
            } catch {} // /contact may not exist

            // Also try /contact-us
            try {
                const contactUsUrl = new URL('/contact-us', url).href;
                await page.goto(contactUsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await sleep(1500);
                const contactPhones = await extractPhonesFromPage(page);
                phoneData.mobiles = [...new Set([...phoneData.mobiles, ...contactPhones.mobiles])];
                phoneData.landlines = [...new Set([...phoneData.landlines, ...contactPhones.landlines])];
                phoneData.phones = [...new Set([...phoneData.phones, ...contactPhones.phones])];
            } catch {}

            await page.close();

            // Filter out tracking numbers
            const checkatradePhone = row.checkatrade_phone || '';
            const validMobiles = phoneData.mobiles.filter(p =>
                isValidUKMobile(p) && !isTrackingNumber(p, checkatradePhone)
            );
            const validLandlines = phoneData.landlines.filter(p =>
                isValidUKLandline(p) && !isTrackingNumber(p, checkatradePhone)
            );

            if (validMobiles.length > 0 || validLandlines.length > 0) {
                row.mobile = validMobiles[0] || '';
                row.landline = validLandlines[0] || '';
                row.all_phones = [...new Set([...validMobiles, ...validLandlines])].join('; ');
                row.phone_source = 'website_rescrape';
                recovered++;
                console.log(`  [${i + 1}/${toRescrape.length}] ${row.company_name} -> ${row.mobile || row.landline}`);
            }
        } catch (err) {
            errors++;
            if (errors > 10 && errors > recovered * 3) {
                console.log(`[Phase 3] Too many errors (${errors}), stopping`);
                break;
            }
        }

        // Rate limiting
        await sleep(3000 + Math.random() * 3000);
    }

    if (browser) await forceCloseBrowser(browser);
    console.log(`[Phase 3] Recovered ${recovered}/${toRescrape.length} phones (${errors} errors)`);

    return rows;
}

// ============================================================
// File processing
// ============================================================

async function processFile(filePath) {
    const fileName = path.basename(filePath);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing: ${fileName}`);
    console.log('='.repeat(60));

    // Load data
    const rows = parseCSV(filePath);
    if (rows.length === 0) {
        console.log(`  Skipping empty file: ${fileName}`);
        return;
    }
    console.log(`  Loaded ${rows.length} rows`);

    // Backup
    const backupDir = path.join(ENRICHED_DIR, 'backup');
    ensureDir(backupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `${path.basename(filePath, '.csv')}-${timestamp}.csv`);
    fs.copyFileSync(filePath, backupPath);
    console.log(`  Backup: ${path.basename(backupPath)}`);

    let lostPhoneList = [];

    // Phase 1
    if (START_PHASE <= 1) {
        console.log('\n--- Phase 1: Strip untrusted phones ---');
        const result = phase1StripPhones(rows);
        lostPhoneList = result.lostPhoneList;
        const s = result.stats;
        console.log(`  Kept: ${s.kept} | Stripped: ${s.stripped} | Directory verified: ${s.directoryVerified} | Directory stripped: ${s.directoryStripped}`);
        console.log(`  Leads that lost phone: ${lostPhoneList.length}`);
        saveCheckpoint(filePath, 1, rows);
    } else {
        // Load from checkpoint
        const cp = loadCheckpoint(filePath, 1);
        if (cp) {
            console.log(`  Resuming from phase ${START_PHASE} (checkpoint found)`);
            // Rebuild lostPhoneList from current state
            lostPhoneList = rows.filter(r => !r.mobile && !r.landline && !r.phone_source);
        }
    }

    // Phase 2
    if (START_PHASE <= 2 && !SKIP_LINKEDIN) {
        console.log('\n--- Phase 2: LinkedIn enrichment ---');
        await phase2LinkedIn(rows, filePath);
        saveCheckpoint(filePath, 2, rows);
    }

    // Phase 3
    if (!SKIP_RESCRAPE) {
        console.log('\n--- Phase 3: Re-scrape phones ---');
        await phase3RescrapePhones(rows, lostPhoneList);
        saveCheckpoint(filePath, 3, rows);
    }

    // Write output (overwrite original)
    writeCSV(filePath, OUTPUT_HEADERS, rows);
    console.log(`\n  Written: ${fileName} (${rows.length} rows)`);

    // Summary
    const withMobile = rows.filter(r => r.mobile).length;
    const withLinkedIn = rows.filter(r => r.linkedin_company).length;
    const withEmail = rows.filter(r => r.email_primary).length;
    const summary = `${fileName}: ${rows.length} leads | mobile: ${withMobile} (${Math.round(100 * withMobile / rows.length)}%) | linkedin: ${withLinkedIn} (${Math.round(100 * withLinkedIn / rows.length)}%) | email: ${withEmail} (${Math.round(100 * withEmail / rows.length)}%)`;
    console.log(`  ${summary}`);

    // Clear checkpoints on success
    clearCheckpoints(filePath);

    return summary;
}

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('[fix-enriched] Starting...');
    console.log(`  Dir: ${ENRICHED_DIR}`);
    console.log(`  Skip LinkedIn: ${SKIP_LINKEDIN}`);
    console.log(`  Skip rescrape: ${SKIP_RESCRAPE}`);
    console.log(`  Start phase: ${START_PHASE}`);

    let files = [];

    if (INPUT_FILE) {
        const resolved = path.resolve(INPUT_FILE);
        if (!fs.existsSync(resolved)) {
            // Try in enriched dir
            const inDir = path.join(ENRICHED_DIR, INPUT_FILE);
            if (fs.existsSync(inDir)) {
                files.push(inDir);
            } else {
                console.error(`File not found: ${INPUT_FILE}`);
                process.exit(1);
            }
        } else {
            files.push(resolved);
        }
    } else if (ALL) {
        if (!fs.existsSync(ENRICHED_DIR)) {
            console.error(`Enriched dir not found: ${ENRICHED_DIR}`);
            process.exit(1);
        }
        files = fs.readdirSync(ENRICHED_DIR)
            .filter(f => f.startsWith('enriched-') && f.endsWith('.csv'))
            .sort()
            .map(f => path.join(ENRICHED_DIR, f));
    } else {
        console.log('Usage: node fix-enriched.js --all | --input <file>');
        process.exit(1);
    }

    if (files.length === 0) {
        console.log('No enriched CSV files found');
        process.exit(0);
    }

    console.log(`\nFound ${files.length} file(s):`);
    files.forEach(f => console.log(`  - ${path.basename(f)}`));

    const summaries = [];
    for (const file of files) {
        try {
            const summary = await processFile(file);
            if (summary) summaries.push(summary);
        } catch (err) {
            console.error(`Error processing ${path.basename(file)}: ${err.message}`);
            summaries.push(`${path.basename(file)}: ERROR - ${err.message}`);
        }
    }

    // Telegram summary
    const msg = `[fix-enriched] Done\n${summaries.join('\n')}`;
    console.log(`\n${msg}`);
    await sendTelegram(msg);
}

main().catch(err => {
    console.error(`[fix-enriched] Fatal: ${err.message}`);
    process.exit(1);
});
