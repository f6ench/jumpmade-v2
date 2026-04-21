const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ============================================================
// Config
// ============================================================
const CONFIG = {
    inputFile: process.argv[2] || './output/enriched-plumbers-batch1.csv',
    outputFile: process.argv[3] || './output/enriched-plumbers-batch1-recovered.csv',
    minDelay: 2000,
    maxDelay: 4000,
    browserRotateEvery: 15,
    saveEvery: 20
};

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// Phone validation (same as enrich-leads.js v3)
// ============================================================
const TRACKING_NUMBER_PREFIXES = ['03', '084', '087', '09', '070'];

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
    if (TRACKING_NUMBER_PREFIXES.some(p => cleaned.startsWith(p))) return false;
    return (cleaned.startsWith('01') || cleaned.startsWith('02') || cleaned.startsWith('0800') || cleaned.startsWith('0808'));
}

function isTrackingNumber(num, checkatradePhone) {
    if (!num) return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (checkatradePhone) {
        const ctCleaned = checkatradePhone.replace(/[^\d]/g, '');
        if (cleaned === ctCleaned) return true;
    }
    if (TRACKING_NUMBER_PREFIXES.some(p => cleaned.startsWith(p))) return true;
    return false;
}

function cleanPhone(raw) {
    if (!raw) return '';
    return raw.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
}

// ============================================================
// CSV parsing
// ============================================================
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (line[i] === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += line[i];
        }
    }
    fields.push(current);
    return fields;
}

function csvEscape(val) {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// ============================================================
// Browser setup (no proxy)
// ============================================================
async function createPage(browser) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    await p.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    await p.setRequestInterception(true);
    p.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return p;
}

// ============================================================
// Enhanced page scraping (tel: links, schema.org, meta tags)
// ============================================================
async function extractPhones(page) {
    return page.evaluate(() => {
        const data = { mobiles: [], landlines: [], emails: [] };
        const body = document.body.innerText || '';

        // ---- REGEX on body text ----
        const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
        const mobiles = body.match(mobilePattern) || [];
        for (const m of mobiles) {
            const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) data.mobiles.push(cleaned);
        }

        const landlinePatterns = [
            /(?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6}/g,
            /(?:\+44\s?|0)2\d{4}[\s.-]?\d{4}/g,
            /(0[23]\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/g,
            /(0800[\s.-]?\d{3}[\s.-]?\d{3,4})/g
        ];
        for (const pattern of landlinePatterns) {
            const matches = body.match(pattern) || [];
            for (const m of matches) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                    data.landlines.push(cleaned);
                }
            }
        }

        // ---- TEL: LINKS ----
        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
        for (const link of telLinks) {
            const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (num.length === 11 && num.startsWith('07')) {
                data.mobiles.push(num);
            } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02') || num.startsWith('0800'))) {
                data.landlines.push(num);
            }
        }

        // ---- SCHEMA.ORG / JSON-LD ----
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
                                data.mobiles.push(cleaned);
                            } else if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                                data.landlines.push(cleaned);
                            }
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // ---- META TAGS ----
        const metaTags = Array.from(document.querySelectorAll('meta[name*="phone"], meta[name*="telephone"], meta[property*="phone"], meta[itemprop="telephone"]'));
        for (const meta of metaTags) {
            const content = meta.getAttribute('content') || '';
            const cleaned = content.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned);
            } else if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                data.landlines.push(cleaned);
            }
        }

        // ---- MAILTO: links for emails ----
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        for (const link of mailtoLinks) {
            const addr = link.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
            if (addr && addr.includes('@')) data.emails.push(addr);
        }
        const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        const bodyEmails = body.match(emailPattern) || [];
        data.emails.push(...bodyEmails.map(e => e.toLowerCase()));

        // Deduplicate
        data.mobiles = [...new Set(data.mobiles)];
        data.landlines = [...new Set(data.landlines)];
        data.emails = [...new Set(data.emails)];

        return data;
    });
}

// ============================================================
// Scrape a website (homepage + contact page)
// ============================================================
async function scrapeWebsite(page, url) {
    const result = { mobiles: [], landlines: [], emails: [] };

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1000);

        // Homepage
        const homeData = await extractPhones(page);
        result.mobiles.push(...homeData.mobiles);
        result.landlines.push(...homeData.landlines);
        result.emails.push(...homeData.emails);

        // Contact page
        const contactUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const contactLink = links.find(a => {
                const text = (a.textContent || '').toLowerCase();
                const href = (a.href || '').toLowerCase();
                return (text.includes('contact') || text.includes('get in touch') ||
                        href.includes('/contact') || href.includes('/get-in-touch'));
            });
            return contactLink ? contactLink.href : null;
        });

        if (contactUrl && contactUrl !== url) {
            try {
                await page.goto(contactUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1000);
                const contactData = await extractPhones(page);
                result.mobiles.push(...contactData.mobiles);
                result.landlines.push(...contactData.landlines);
                result.emails.push(...contactData.emails);
            } catch (e) {}
        }
    } catch (error) {
        console.log(`    Scrape failed: ${error.message.substring(0, 60)}`);
    }

    result.mobiles = [...new Set(result.mobiles)];
    result.landlines = [...new Set(result.landlines)];
    result.emails = [...new Set(result.emails)];
    return result;
}

// ============================================================
// Scrape Checkatrade profile for website URL + phones
// ============================================================
async function scrapeCheckatradeProfile(page, profileUrl) {
    try {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1500 + Math.random() * 1000);

        return page.evaluate(() => {
            const data = { website: null, mobiles: [], landlines: [] };

            const links = Array.from(document.querySelectorAll('a[href]'));
            const skipDomains = ['checkatrade.com', 'facebook.com', 'twitter.com', 'instagram.com',
                'linkedin.com', 'youtube.com', 'google.com', 'trustpilot.com',
                'gassaferegister.co.uk', 'watersafe.org.uk', 'x.com', 'tiktok.com',
                'pinterest.com', 'threads.net', 'niceic.com', 'cscs.uk.com',
                'apple.com', 'play.google.com', 'apps.apple.com',
                'vaillant.co.uk', 'napit.org.uk', 'ciphe.org.uk', 'bafe.org.uk',
                'jib.org.uk', 'fgasregister.com', 'worcester-bosch.co.uk',
                'baxi.co.uk', 'oftec.org', 'elecsa.co.uk', 'stroma.com'];

            // Find website link
            for (const link of links) {
                const href = link.href || '';
                const text = (link.textContent || '').toLowerCase().trim();
                if ((text.includes('website') || text.includes('visit') || text.includes('www.') ||
                     link.getAttribute('data-tracking') === 'website') &&
                    href.startsWith('http') &&
                    !skipDomains.some(d => href.includes(d))) {
                    data.website = href;
                    break;
                }
            }

            // Fallback: any external link that looks like a business website
            if (!data.website) {
                for (const link of links) {
                    const href = link.href || '';
                    if (href.startsWith('http') && !skipDomains.some(d => href.includes(d)) &&
                        !href.includes('checkatrade') && !href.includes('javascript:') &&
                        href.match(/\.(co\.uk|com|org\.uk|uk|net|biz)/)) {
                        data.website = href;
                        break;
                    }
                }
            }

            // Phone numbers on profile
            const body = document.body.innerText || '';
            const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
            const mobiles = body.match(mobilePattern) || [];
            for (const m of mobiles) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length === 11 && cleaned.startsWith('07')) data.mobiles.push(cleaned);
            }

            // tel: links
            const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
            for (const link of telLinks) {
                const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (num.length === 11 && num.startsWith('07')) {
                    data.mobiles.push(num);
                } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02'))) {
                    data.landlines.push(num);
                }
            }

            data.mobiles = [...new Set(data.mobiles)];
            data.landlines = [...new Set(data.landlines)];
            return data;
        });
    } catch (error) {
        console.log(`    CT profile failed: ${error.message.substring(0, 60)}`);
        return null;
    }
}

// ============================================================
// Main
// ============================================================
async function recover() {
    console.log('\n=== Mobile Recovery Script ===');
    console.log(`Input:  ${CONFIG.inputFile}`);
    console.log(`Output: ${CONFIG.outputFile}\n`);

    if (!fs.existsSync(CONFIG.inputFile)) {
        console.error(`Input file not found: ${CONFIG.inputFile}`);
        process.exit(1);
    }

    // Parse enriched CSV
    const content = fs.readFileSync(CONFIG.inputFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const header = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);
        const row = {};
        header.forEach((h, idx) => { row[h] = fields[idx] || ''; });
        rows.push(row);
    }

    console.log(`Total leads: ${rows.length}`);

    // Identify targets
    const needsRescrape = []; // has website, no mobile
    const needsProfile = [];  // has profile_url, no mobile, no website OR still no mobile after rescrape
    const alreadyHasMobile = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.mobile && r.mobile.trim()) {
            alreadyHasMobile.push(i);
        } else if (r.website && r.website.trim()) {
            needsRescrape.push(i);
        } else if (r.profile_url && r.profile_url.trim()) {
            needsProfile.push(i);
        }
    }

    console.log(`Already have mobile: ${alreadyHasMobile.length}`);
    console.log(`Pass 1 - Re-scrape website (tel:/schema.org): ${needsRescrape.length}`);
    console.log(`Pass 2 - CT profile scrape: ${needsProfile.length}`);
    console.log('');

    // Launch browser (no proxy)
    let browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    let page = await createPage(browser);
    let requestCount = 0;

    let pass1Mobiles = 0;
    let pass1Landlines = 0;
    let pass1Emails = 0;
    let pass2Websites = 0;
    let pass2Mobiles = 0;
    let pass2Landlines = 0;

    // ============================================================
    // PASS 1: Re-scrape websites with enhanced extraction
    // ============================================================
    console.log('--- PASS 1: Re-scrape websites with tel:/schema.org ---\n');

    for (let j = 0; j < needsRescrape.length; j++) {
        const idx = needsRescrape[j];
        const row = rows[idx];
        const website = row.website;
        const ctPhone = row.checkatrade_phone || '';

        console.log(`[P1 ${j + 1}/${needsRescrape.length}] ${row.company_name} -> ${website.substring(0, 50)}`);

        // Rotate browser periodically
        if (requestCount > 0 && requestCount % CONFIG.browserRotateEvery === 0) {
            await browser.close().catch(() => {});
            await sleep(2000);
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            page = await createPage(browser);
        }

        const data = await scrapeWebsite(page, website);
        requestCount++;

        // Validate and filter
        const validMobiles = data.mobiles
            .filter(n => isValidUKMobile(n) && !isTrackingNumber(n, ctPhone));
        const validLandlines = data.landlines
            .filter(n => isValidUKLandline(n) && !isTrackingNumber(n, ctPhone));
        const junkEmailDomains = ['example', 'wix.com', 'wordpress', 'sentry', 'schema.org',
            'w3.org', 'googleapis', 'squarespace', 'mailchimp', 'hubspot', 'google.com',
            'facebook.com', 'which.co.uk', 'apple.com'];
        const validEmails = data.emails.filter(e => !junkEmailDomains.some(d => e.includes(d)));

        if (validMobiles.length) {
            row.mobile = validMobiles[0];
            row.all_phones = [...new Set([row.all_phones, ...validMobiles, ...validLandlines].filter(Boolean))].join('; ');
            row.phone_source = 'rescrape_website';
            pass1Mobiles++;
            console.log(`  MOBILE FOUND: ${validMobiles.join(', ')}`);
        }
        if (validLandlines.length && !row.landline) {
            row.landline = validLandlines[0];
            row.all_phones = [...new Set([row.all_phones, ...validLandlines].filter(Boolean))].join('; ');
            pass1Landlines++;
            console.log(`  Landline: ${validLandlines.join(', ')}`);
        }
        if (validEmails.length && !row.email) {
            row.email = validEmails[0];
            row.all_emails = [...new Set([row.all_emails, ...validEmails].filter(Boolean))].join('; ');
            pass1Emails++;
            console.log(`  Email: ${validEmails.join(', ')}`);
        }

        if (!validMobiles.length && !validLandlines.length) {
            console.log('  Nothing new');
        }

        // Checkpoint
        if ((j + 1) % CONFIG.saveEvery === 0) {
            writeOutput(header, rows);
            console.log(`  [Checkpoint] Saved at ${j + 1}/${needsRescrape.length}`);
        }

        await sleep(CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));
    }

    console.log(`\nPass 1 complete: +${pass1Mobiles} mobiles, +${pass1Landlines} landlines, +${pass1Emails} emails\n`);

    // ============================================================
    // PASS 2: Checkatrade profile -> website -> phones
    // ============================================================
    console.log('--- PASS 2: CT profile scrape for website + phones ---\n');

    // Also add Pass 1 leads that still have no mobile to Pass 2 if they have a profile URL
    const pass2Targets = [...needsProfile];
    for (const idx of needsRescrape) {
        const row = rows[idx];
        if (!row.mobile && row.profile_url && row.profile_url.trim()) {
            pass2Targets.push(idx);
        }
    }
    // Deduplicate
    const pass2Unique = [...new Set(pass2Targets)];

    console.log(`Pass 2 targets: ${pass2Unique.length}\n`);

    for (let j = 0; j < pass2Unique.length; j++) {
        const idx = pass2Unique[j];
        const row = rows[idx];

        // Skip if Pass 1 already found a mobile
        if (row.mobile && row.mobile.trim()) continue;

        const profileUrl = row.profile_url;
        const ctPhone = row.checkatrade_phone || '';

        console.log(`[P2 ${j + 1}/${pass2Unique.length}] ${row.company_name} -> ${profileUrl.substring(0, 60)}`);

        // Rotate browser periodically
        if (requestCount > 0 && requestCount % CONFIG.browserRotateEvery === 0) {
            await browser.close().catch(() => {});
            await sleep(2000);
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            page = await createPage(browser);
        }

        const ctData = await scrapeCheckatradeProfile(page, profileUrl);
        requestCount++;

        if (!ctData) {
            console.log('  Profile scrape failed');
            await sleep(CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));
            continue;
        }

        // Check for mobiles directly on profile
        const profileMobiles = ctData.mobiles
            .filter(n => isValidUKMobile(n) && !isTrackingNumber(n, ctPhone));
        if (profileMobiles.length) {
            row.mobile = profileMobiles[0];
            row.all_phones = [...new Set([row.all_phones, ...profileMobiles].filter(Boolean))].join('; ');
            row.phone_source = 'checkatrade_profile';
            pass2Mobiles++;
            console.log(`  MOBILE FROM PROFILE: ${profileMobiles.join(', ')}`);
        }

        // If profile found a website we didn't have, scrape it
        if (!row.mobile && ctData.website && (!row.website || !row.website.trim())) {
            console.log(`  CT website found: ${ctData.website.substring(0, 50)}`);
            row.website = ctData.website;
            pass2Websites++;

            const siteData = await scrapeWebsite(page, ctData.website);
            requestCount++;

            const siteMobiles = siteData.mobiles
                .filter(n => isValidUKMobile(n) && !isTrackingNumber(n, ctPhone));
            const siteLandlines = siteData.landlines
                .filter(n => isValidUKLandline(n) && !isTrackingNumber(n, ctPhone));

            if (siteMobiles.length) {
                row.mobile = siteMobiles[0];
                row.all_phones = [...new Set([row.all_phones, ...siteMobiles, ...siteLandlines].filter(Boolean))].join('; ');
                row.phone_source = 'checkatrade_profile_website';
                pass2Mobiles++;
                console.log(`  MOBILE FROM WEBSITE: ${siteMobiles.join(', ')}`);
            }
            if (siteLandlines.length && !row.landline) {
                row.landline = siteLandlines[0];
                row.all_phones = [...new Set([row.all_phones, ...siteLandlines].filter(Boolean))].join('; ');
                pass2Landlines++;
                console.log(`  Landline: ${siteLandlines.join(', ')}`);
            }
            if (siteData.emails.length && !row.email) {
                const junkEmailDomains = ['example', 'wix.com', 'wordpress', 'sentry', 'schema.org',
                    'w3.org', 'googleapis', 'squarespace', 'mailchimp', 'hubspot', 'google.com',
                    'facebook.com', 'which.co.uk', 'apple.com'];
                const validEmails = siteData.emails.filter(e => !junkEmailDomains.some(d => e.includes(d)));
                if (validEmails.length) {
                    row.email = validEmails[0];
                    row.all_emails = [...new Set([row.all_emails, ...validEmails].filter(Boolean))].join('; ');
                }
            }
        }

        if (!profileMobiles.length && !ctData.website) {
            console.log('  No website or mobile on profile');
        }

        // Checkpoint
        if ((j + 1) % CONFIG.saveEvery === 0) {
            writeOutput(header, rows);
            console.log(`  [Checkpoint] Saved at ${j + 1}/${pass2Unique.length}`);
        }

        await sleep(CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));

        // Extra pause every 20 to avoid rate limits on checkatrade.com
        if ((j + 1) % 20 === 0) {
            const pause = 5000 + Math.random() * 5000;
            console.log(`  [PAUSE] ${Math.round(pause / 1000)}s cooldown`);
            await sleep(pause);
        }
    }

    await browser.close().catch(() => {});

    // ============================================================
    // Final output
    // ============================================================
    // Add phone_source column if not in header
    if (!header.includes('phone_source')) {
        header.splice(header.indexOf('name_source'), 0, 'phone_source');
    }
    writeOutput(header, rows);

    // Summary
    const total = rows.length;
    const pct = (n) => total ? Math.round(n / total * 100) : 0;
    const totalMobiles = rows.filter(r => r.mobile && r.mobile.trim()).length;
    const totalLandlines = rows.filter(r => r.landline && r.landline.trim()).length;
    const totalEmails = rows.filter(r => r.email && r.email.trim()).length;
    const totalWebsites = rows.filter(r => r.website && r.website.trim()).length;

    console.log('\n========================================');
    console.log('     RECOVERY COMPLETE');
    console.log('========================================');
    console.log(`Total leads: ${total}`);
    console.log('');
    console.log('RECOVERED:');
    console.log(`  Pass 1 (website re-scrape): +${pass1Mobiles} mobiles, +${pass1Landlines} landlines, +${pass1Emails} emails`);
    console.log(`  Pass 2 (CT profile):        +${pass2Mobiles} mobiles, +${pass2Websites} websites, +${pass2Landlines} landlines`);
    console.log('');
    console.log('TOTALS (after recovery):');
    console.log(`  Mobile:   ${totalMobiles} (${pct(totalMobiles)}%) -- was ${alreadyHasMobile.length} (${pct(alreadyHasMobile.length)}%)`);
    console.log(`  Landline: ${totalLandlines} (${pct(totalLandlines)}%)`);
    console.log(`  Email:    ${totalEmails} (${pct(totalEmails)}%)`);
    console.log(`  Website:  ${totalWebsites} (${pct(totalWebsites)}%)`);
    console.log(`\nOutput: ${CONFIG.outputFile}`);
}

function writeOutput(header, rows) {
    const csvRows = [header.join(',')];
    for (const row of rows) {
        csvRows.push(header.map(h => csvEscape(row[h] || '')).join(','));
    }
    const outputDir = path.dirname(CONFIG.outputFile);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(CONFIG.outputFile, csvRows.join('\n'), 'utf-8');
}

recover().catch(console.error);
