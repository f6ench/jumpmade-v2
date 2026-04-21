const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

// All UK postcode areas (124 areas) - systematic coverage of entire UK
const UK_POSTCODE_AREAS_FULL = [
    // London
    'EC', 'WC', 'E', 'N', 'NW', 'SE', 'SW', 'W',
    // England
    'AL', 'B', 'BA', 'BB', 'BD', 'BH', 'BL', 'BN', 'BR', 'BS', 'CA',
    'CB', 'CH', 'CM', 'CO', 'CR', 'CT', 'CV', 'CW', 'DA', 'DE', 'DH',
    'DL', 'DN', 'DT', 'DY', 'EN', 'EX', 'FY', 'GL', 'GU', 'HA', 'HD',
    'HG', 'HP', 'HR', 'HU', 'HX', 'IG', 'IP', 'KT', 'L', 'LA', 'LE',
    'LN', 'LS', 'LU', 'M', 'ME', 'MK', 'NE', 'NG', 'NN', 'NP', 'NR',
    'OL', 'OX', 'PE', 'PL', 'PO', 'PR', 'RG', 'RH', 'RM', 'S', 'SK',
    'SL', 'SM', 'SN', 'SO', 'SP', 'SR', 'SS', 'ST', 'SY', 'TA', 'TF',
    'TN', 'TQ', 'TR', 'TS', 'TW', 'UB', 'WA', 'WD', 'WF', 'WN', 'WR',
    'WS', 'WV', 'YO',
    // Scotland
    'AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY',
    'ML', 'PA', 'PH', 'TD', 'ZE',
    // Wales
    'CF', 'LD', 'LL', 'SA', 'SY',
    // Northern Ireland
    'BT',
    // Crown Dependencies
    'GY', 'JE', 'IM'
];

// Top 50 metro postcodes - covers ~80% of tradespeople, half the time
const UK_POSTCODE_AREAS_FAST = [
    // London (8)
    'EC', 'WC', 'E', 'N', 'NW', 'SE', 'SW', 'W',
    // Major cities (18)
    'B', 'M', 'L', 'LS', 'S', 'BS', 'NE', 'NG', 'LE', 'SO',
    'G', 'EH', 'CF', 'BT', 'BN', 'PO', 'CV', 'DE',
    // Large towns (24)
    'BA', 'BD', 'BH', 'CB', 'CH', 'CM', 'CR', 'DA', 'DN', 'EX',
    'GL', 'GU', 'HP', 'KT', 'MK', 'NN', 'NR', 'OX', 'PE', 'PL',
    'RG', 'RH', 'ST', 'TN'
];

// High-density areas get more pages (London + major cities)
const HIGH_DENSITY_AREAS = [
    'EC', 'WC', 'E', 'N', 'NW', 'SE', 'SW', 'W', // London
    'B', 'M', 'L', 'LS', 'S', 'BS', 'NE', 'NG',  // Major cities
    'LE', 'SO', 'G', 'EH', 'CF', 'BT', 'BN', 'PO' // More cities
];

// Remaining 74 postcodes = FULL minus FAST (non-metro areas)
const UK_POSTCODE_AREAS_REMAINING = UK_POSTCODE_AREAS_FULL.filter(
    pc => !UK_POSTCODE_AREAS_FAST.includes(pc)
);

// Parse flags
const args = process.argv.slice(2);
const fastPostcodes = args.includes('--fast-postcodes');
const remainingPostcodes = args.includes('--remaining-postcodes');
const skipPhase2 = args.includes('--skip-phase2');
const fastDelays = args.includes('--fast');
const instanceIdx = args.indexOf('--instance');
const instanceLabel = instanceIdx >= 0 ? args[instanceIdx + 1] : '';

function tagMsg(msg) {
    return instanceLabel ? `[#${instanceLabel}] ${msg}` : msg;
}

const UK_POSTCODE_AREAS = remainingPostcodes ? UK_POSTCODE_AREAS_REMAINING
    : fastPostcodes ? UK_POSTCODE_AREAS_FAST
    : UK_POSTCODE_AREAS_FULL;

const CONFIG = {
    trade: args.find(a => !a.startsWith('--') && !(args[args.indexOf(a) - 1] || '').startsWith('--')) || args[0] || 'Plumber',
    maxPagesPerArea: parseInt(process.argv[3]) || 50,
    maxPagesForHighDensity: 100,
    outputDir: './output/checkatrade',
    delay: fastDelays ? 800 : 1500,
    proxyFile: process.env.PROXY_FILE || './proxies-fast.txt',
    browserRotateEvery: 10
};

// Fix: first non-flag arg is trade name
const tradeArg = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i-1].startsWith('--') && !['--skip-phase2', '--fast-postcodes', '--fast', '--skip-existing', '--remaining-postcodes'].includes(args[i-1])));
if (tradeArg) CONFIG.trade = tradeArg;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

// ============================================================
// Proxy rotation
// ============================================================
let proxies = [];
let proxyIndex = 0;

function loadProxies() {
    const proxyPath = path.resolve(__dirname, CONFIG.proxyFile);
    if (!fs.existsSync(proxyPath)) {
        console.log('No proxy file found -- running without proxies');
        return;
    }
    const lines = fs.readFileSync(proxyPath, 'utf-8').split('\n').filter(l => l.trim());
    proxies = lines.map(line => {
        const [host, port, username, password] = line.trim().split(':');
        return { host, port, username, password };
    });
    // Shuffle so we don't burn through them in order
    for (let i = proxies.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
    }
    console.log(`Loaded ${proxies.length} proxies`);
}

function getNextProxy() {
    if (proxies.length === 0) return null;
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    return proxy;
}

let currentProxy = null;

async function launchBrowser() {
    currentProxy = getNextProxy();
    const args = ['--no-sandbox', '--disable-setuid-sandbox'];
    if (currentProxy) {
        args.push(`--proxy-server=http://${currentProxy.host}:${currentProxy.port}`);
        console.log(`Using proxy: ${currentProxy.host}:${currentProxy.port}`);
    }
    return puppeteer.launch({ headless: 'new', args });
}

// Track all leads and seen handles for deduplication
const allLeads = [];
const seenHandles = new Set();
let totalScraped = 0;
let totalDuplicates = 0;

// When running remaining-postcodes, load existing CSV handles to avoid duplicates
function loadExistingLeads() {
    const tradeSlug = slugify(CONFIG.trade);
    const csvPath = path.join(CONFIG.outputDir, `all-uk-${tradeSlug}s.csv`);
    if (!fs.existsSync(csvPath)) return [];
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    const lines = content.split('\n');
    if (lines.length <= 1) return [];
    const header = lines[0];
    const handleIdx = header.split(',').indexOf('handle');
    if (handleIdx < 0) return [];
    const existing = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const handle = cols[handleIdx]?.replace(/"/g, '').trim();
        if (handle) {
            seenHandles.add(handle);
            existing.push(lines[i]);
        }
    }
    console.log(`Loaded ${existing.length} existing leads from CSV for dedup`);
    return existing;
}

async function scrapeLocation(browser, location) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    if (currentProxy) {
        await page.authenticate({ username: currentProxy.username, password: currentProxy.password });
    }
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    const locationLeads = [];
    let pageNum = 1;
    let emptyPages = 0;
    let duplicateOnlyPages = 0;

    const isHighDensity = HIGH_DENSITY_AREAS.includes(location);
    const maxPages = isHighDensity ? CONFIG.maxPagesForHighDensity : CONFIG.maxPagesPerArea;

    try {
        while (pageNum <= maxPages) {
            const searchUrl = `https://www.checkatrade.com/Search/${encodeURIComponent(CONFIG.trade)}/in/${encodeURIComponent(location)}${pageNum > 1 ? '?page=' + pageNum : ''}`;

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await sleep(CONFIG.delay);
            } catch (e) {
                console.log(`    Page ${pageNum}: Failed to load`);
                emptyPages++;
                if (emptyPages >= 3) break;
                pageNum++;
                continue;
            }

            const links = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href*="/trades/"]'));
                const seen = new Set();
                const results = [];

                anchors.forEach(link => {
                    const href = link.href;
                    const handle = href.split('/trades/')[1]?.split('/')[0]?.split('?')[0]?.split('#')[0];

                    if (handle && !seen.has(handle) && handle.length > 3) {
                        seen.add(handle);

                        let parent = link.closest('article, div[class*="card"], div[class*="Card"], li');
                        let companyName = '';

                        if (parent) {
                            const nameEl = parent.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
                            if (nameEl) companyName = nameEl.textContent.trim();
                        }

                        if (!companyName) {
                            companyName = link.textContent.trim() || handle.replace(/-/g, ' ');
                        }

                        results.push({
                            companyName,
                            handle,
                            profileUrl: href.split('#')[0].split('?')[0]
                        });
                    }
                });

                return results;
            });

            if (links.length === 0) {
                emptyPages++;
                if (emptyPages >= 3) break;
                pageNum++;
                continue;
            }

            emptyPages = 0;

            let newLeads = 0;
            for (const link of links) {
                if (!seenHandles.has(link.handle)) {
                    seenHandles.add(link.handle);
                    locationLeads.push(link);
                    newLeads++;
                } else {
                    totalDuplicates++;
                }
            }

            if (newLeads === 0) {
                duplicateOnlyPages++;
                if (duplicateOnlyPages >= 5) {
                    console.log(`    Page ${pageNum}: All duplicates (5 in a row, stopping)`);
                    break;
                }
            } else {
                duplicateOnlyPages = 0;
                console.log(`    Page ${pageNum}: ${links.length} found, ${newLeads} new`);
            }

            pageNum++;
        }
    } catch (error) {
        console.log(`    Error: ${error.message}`);
    }

    try {
        await page.close();
    } catch (e) {}
    return locationLeads;
}

async function scrapeProfileDetails(browser, lead) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    if (currentProxy) {
        await page.authenticate({ username: currentProxy.username, password: currentProxy.password });
    }
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    try {
        await page.goto(lead.profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(800);

        const data = await page.evaluate(() => {
            const result = {
                ownerName: '',
                yearsOnCheckatrade: '',
                vatNumber: '',
                overallRating: '',
                qualityRating: '',
                reliabilityRating: '',
                communicationRating: '',
                reviewCount: '',
                websiteUrl: '',
                isLtd: false,
                freeEstimates: false,
                emergencyCallout: false,
                location: ''
            };

            const bodyText = document.body.innerText;

            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            for (const a of allLinks) {
                const href = a.href;
                if (href.match(/^https?:\/\//) && !href.includes('checkatrade.com') && !href.includes('google.com') && !href.includes('facebook.com') && !href.includes('twitter.com') && !href.includes('instagram.com') && !href.includes('youtube.com') && !href.includes('linkedin.com')) {
                    result.websiteUrl = href;
                    break;
                }
            }

            const ownerMatch = bodyText.match(/Owner\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
            if (ownerMatch) result.ownerName = ownerMatch[1];
            else {
                const nameMatch = bodyText.match(/(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+/);
                if (nameMatch) result.ownerName = nameMatch[0];
            }

            const yearsMatch = bodyText.match(/(\d+)\s*years?\s*on\s*Checkatrade/i);
            if (yearsMatch) result.yearsOnCheckatrade = yearsMatch[1];

            const vatMatch = bodyText.match(/VAT\s*Registered\s*(?:Yes:?\s*)?(\d{9,12})/i);
            if (vatMatch) result.vatNumber = vatMatch[1];

            const overallMatch = bodyText.match(/(\d+\.?\d*)\s*\/\s*10/);
            if (overallMatch) result.overallRating = overallMatch[1];

            const qualityMatch = bodyText.match(/Quality\s*(?:of\s*work)?\s*(\d+\.?\d*)/i);
            if (qualityMatch) result.qualityRating = qualityMatch[1];

            const reliabilityMatch = bodyText.match(/Reliability\s*(\d+\.?\d*)/i);
            if (reliabilityMatch) result.reliabilityRating = reliabilityMatch[1];

            const communicationMatch = bodyText.match(/Communication\s*(\d+\.?\d*)/i);
            if (communicationMatch) result.communicationRating = communicationMatch[1];

            const reviewMatch = bodyText.match(/Reviews?\s*\((\d+)\)/i) || bodyText.match(/(\d+)\s*reviews?/i);
            if (reviewMatch) result.reviewCount = reviewMatch[1];

            result.isLtd = /\b(Ltd|Limited|LTD|PLC)\b/.test(bodyText);
            result.freeEstimates = /Free\s*Estimates?/i.test(bodyText);
            result.emergencyCallout = /24\s*(?:Hour|hr)?\s*Call[- ]?out|Emergency/i.test(bodyText);

            const locationMatch = bodyText.match(/(?:covers?|based\s*in|serving)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
            if (locationMatch) result.location = locationMatch[1];

            return result;
        });

        await page.close();
        return { ...lead, ...data };

    } catch (error) {
        await page.close();
        return lead;
    }
}

async function main() {
    const tradeSlug = slugify(CONFIG.trade);
    const postcodeMode = remainingPostcodes ? 'remaining 74' : fastPostcodes ? 'fast 50' : 'full 124';
    console.log('=== UK-Wide Checkatrade Scraper (Postcode Areas) ===');
    console.log(`Trade: ${CONFIG.trade} (slug: ${tradeSlug})`);
    console.log(`Postcode areas: ${UK_POSTCODE_AREAS.length} (${postcodeMode})`);
    console.log(`Phase 2: ${skipPhase2 ? 'SKIPPED' : 'enabled'}`);
    console.log(`Delays: ${fastDelays ? 'fast (800ms)' : 'normal (1500ms)'}`);
    if (instanceLabel) console.log(`Instance: #${instanceLabel}`);
    console.log('');

    // Pre-load existing leads for dedup when appending
    let existingCsvRows = [];
    if (remainingPostcodes) {
        existingCsvRows = loadExistingLeads();
    }

    loadProxies();
    let browser = await launchBrowser();

    // Phase 1: Collect all trade links from all locations
    console.log('=== Phase 1: Collecting leads from all locations ===\n');

    for (let i = 0; i < UK_POSTCODE_AREAS.length; i++) {
        const location = UK_POSTCODE_AREAS[i];
        console.log(`[${i + 1}/${UK_POSTCODE_AREAS.length}] Postcode: ${location}`);

        if (i > 0 && i % CONFIG.browserRotateEvery === 0) {
            console.log('    Rotating browser + proxy...');
            try { await browser.close(); } catch (e) {}
            browser = await launchBrowser();
        }

        try {
            const leads = await scrapeLocation(browser, location);
            allLeads.push(...leads);
            totalScraped += leads.length;
        } catch (error) {
            console.log(`    Error scraping ${location}: ${error.message}`);
        }

        console.log(`    Total unique: ${allLeads.length} (${totalDuplicates} duplicates skipped)\n`);

        if ((i + 1) % 10 === 0) {
            saveProgress();
        }
    }

    console.log(`\n=== Phase 1 Complete ===`);
    console.log(`Total unique leads: ${allLeads.length}`);
    console.log(`Duplicates skipped: ${totalDuplicates}`);

    const p1Msg = tagMsg(`[PHASE 1 DONE] ${CONFIG.trade} | ${allLeads.length} unique leads | ${UK_POSTCODE_AREAS.length} postcodes`);
    console.log(p1Msg);
    sendTelegram(p1Msg);

    saveProgress();
    console.log(`\nPhase 1 handles saved to progress-${tradeSlug}.txt`);

    if (skipPhase2) {
        // Save Phase 1 results directly (no profile enrichment)
        saveFullResults(allLeads, existingCsvRows);
        const doneMsg = tagMsg(`[DONE] ${CONFIG.trade}: ${allLeads.length} new leads saved (Phase 1 only)`);
        console.log('\n=== Scraping Complete (Phase 2 skipped) ===');
        console.log(doneMsg);
        sendTelegram(doneMsg);
        try { await browser.close(); } catch (e) {}
        return;
    }

    // Phase 2: Scrape detailed profile info for each lead
    const p2Msg = tagMsg(`[PHASE 2 START] ${CONFIG.trade} | Scraping ${allLeads.length} profiles`);
    console.log(`\n=== Phase 2: Scraping profile details ===\n`);
    console.log(p2Msg);
    sendTelegram(p2Msg);

    const enrichedLeads = [];
    const phase2Start = Date.now();

    for (let i = 0; i < allLeads.length; i++) {
        const lead = allLeads[i];
        console.log(`[${i + 1}/${allLeads.length}] ${lead.companyName}`);

        if ((i + 1) % 250 === 0) {
            const elapsed = Math.round((Date.now() - phase2Start) / 60000);
            const rate = ((i + 1) / elapsed).toFixed(1);
            const msg = tagMsg(`[HEALTH] ${CONFIG.trade} | ${i + 1}/${allLeads.length} leads | ${elapsed}min | ${rate}/min`);
            console.log(msg);
            sendTelegram(msg);

            if (parseFloat(rate) < 1) {
                const warn = tagMsg(`[WARNING] ${CONFIG.trade} | Rate dropped below 1/min -- possible blocking`);
                console.log(warn);
                sendTelegram(warn);
            }

            if (!browser.isConnected()) {
                const reconn = tagMsg(`[RECONNECT] ${CONFIG.trade} | Browser disconnected, relaunching`);
                console.log(reconn);
                sendTelegram(reconn);
                browser = await launchBrowser();
            }
        }

        try {
            const enriched = await scrapeProfileDetails(browser, lead);
            enrichedLeads.push(enriched);
        } catch (error) {
            console.log(`    Error: ${error.message}`);
            enrichedLeads.push(lead);
        }

        if ((i + 1) % 50 === 0) {
            saveFullResults(enrichedLeads, existingCsvRows);
            console.log(`    Progress saved: ${enrichedLeads.length} profiles\n`);
        }

        await sleep(500);
    }

    try {
        await browser.close();
    } catch (e) {}

    saveFullResults(enrichedLeads, existingCsvRows);

    const doneMsg = tagMsg(`[DONE] ${CONFIG.trade}: ${enrichedLeads.length} new leads saved to all-uk-${tradeSlug}s.csv`);
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

function saveProgress() {
    const tradeSlug = slugify(CONFIG.trade);
    const data = allLeads.map(l => `${l.handle},${l.companyName}`).join('\n');
    fs.writeFileSync(path.join(CONFIG.outputDir, `progress-${tradeSlug}.txt`), data);
}

function saveFullResults(leads, existingRows) {
    const header = [
        'company_name', 'owner_name', 'trade_type', 'location', 'website_url',
        'overall_rating', 'quality_rating', 'reliability_rating', 'communication_rating',
        'review_count', 'years_on_checkatrade', 'vat_number', 'is_ltd',
        'free_estimates', 'emergency_callout', 'profile_url', 'handle'
    ].join(',');

    const newRows = leads.map(l => [
        `"${(l.companyName || '').replace(/"/g, '""')}"`,
        `"${(l.ownerName || '').replace(/"/g, '""')}"`,
        `"${(CONFIG.trade || '').replace(/"/g, '""')}"`,
        `"${(l.location || '').replace(/"/g, '""')}"`,
        `"${(l.websiteUrl || '').replace(/"/g, '""')}"`,
        l.overallRating || '',
        l.qualityRating || '',
        l.reliabilityRating || '',
        l.communicationRating || '',
        l.reviewCount || '',
        l.yearsOnCheckatrade || '',
        `"${(l.vatNumber || '').replace(/"/g, '""')}"`,
        l.isLtd ? 'Yes' : 'No',
        l.freeEstimates ? 'Yes' : 'No',
        l.emergencyCallout ? 'Yes' : 'No',
        `"${(l.profileUrl || '').replace(/"/g, '""')}"`,
        l.handle || ''
    ].join(','));

    // When appending (remaining-postcodes mode), keep existing rows + add new
    const allRows = existingRows && existingRows.length > 0
        ? [...existingRows, ...newRows]
        : newRows;

    const csv = [header, ...allRows].join('\n');
    const tradeSlug = slugify(CONFIG.trade);
    fs.writeFileSync(path.join(CONFIG.outputDir, `all-uk-${tradeSlug}s.csv`), csv);
}

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

main().catch(console.error);
