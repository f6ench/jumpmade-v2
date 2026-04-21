const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
let GoogleGenerativeAI;
try { GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI; } catch (e) { /* optional */ }

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
    inputFile: process.argv[2] || './output/all-uk-plumbers.csv',
    outputFile: process.argv[3] || './output/enriched-plumbers.csv',
    progressFile: process.argv[4] || './output/enrichment-progress.json',
    minDelay: 3000,
    maxDelay: 6000,
    maxRetries: 2,
    saveEvery: 25, // checkpoint every N leads
    browserRotateEvery: 4, // fresh browser + new proxy every 4 leads
    proxyFile: './proxies-fast.txt',
    rotateProxyOnBlock: true,
    // Companies House API key (free from https://developer.company-information.service.gov.uk/)
    companiesHouseApiKey: process.env.CH_API_KEY || '',
    // Gemini API key for AI-assisted phone discovery
    geminiApiKey: process.env.GEMINI_API_KEY || ''
};

// Domains that indicate junk/captcha search results (not real business sites)
const JUNK_RESULT_DOMAINS = [
    'zhihu.com', 'baidu.com', 'stackexchange.com', 'stackoverflow.com',
    'wordreference.com', 'cambridge.org', 'dictionary.cambridge',
    'math.stackexchange', 'diy.stackexchange', 'superuser.com', 'serverfault.com',
    'ask.com', 'answers.com', 'quora.com', 'reddit.com',
    'forum.wordreference', 'yahoo.co.jp', 'naver.com',
    'zhidao.baidu', 'tieba.baidu', 'weibo.com', 'douban.com',
    'rakuten.co.jp', 'taobao.com', 'aliexpress.com', 'alibaba.com',
    'iep.edu', 'researchgate.net', 'academia.edu', 'arxiv.org',
    'wikihow.com', 'wikimedia.org', 'wiktionary.org',
    '.cn/', '.jp/', '.kr/', 'sogou.com', 'qq.com', 'bilibili.com'
];

// User agents to rotate through
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
];

// ============================================================
// Helpers
// ============================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const jitterDelay = () => sleep(CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));

// ============================================================
// Phone number validation
// ============================================================

// Known Checkatrade tracking number prefixes (redirect numbers, not real mobiles)
// These are 03xx/084x/087x virtual numbers used for call tracking
const TRACKING_NUMBER_PREFIXES = ['03', '084', '087', '09', '070'];

// Known VoIP/virtual number ranges that aren't real mobiles
const VOIP_PREFIXES = ['056'];

function isValidUKMobile(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length !== 11) return false;
    if (!cleaned.startsWith('07')) return false;
    // 070xx are personal numbering (VoIP/redirect), not real mobiles
    if (cleaned.startsWith('070')) return false;
    // 076xx are pager numbers
    if (cleaned.startsWith('076')) return false;
    return true;
}

function isValidUKLandline(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length < 10 || cleaned.length > 12) return false;
    if (cleaned.startsWith('07')) return false;
    // Reject tracking/virtual numbers
    if (TRACKING_NUMBER_PREFIXES.some(p => cleaned.startsWith(p))) return false;
    if (VOIP_PREFIXES.some(p => cleaned.startsWith(p))) return false;
    return (cleaned.startsWith('01') || cleaned.startsWith('02') || cleaned.startsWith('0800') || cleaned.startsWith('0808'));
}

function isTrackingNumber(num, checkatradePhone) {
    if (!num) return false;
    const cleaned = num.replace(/[^\d]/g, '');
    // If the number matches the Checkatrade tracking number exactly, reject it
    if (checkatradePhone) {
        const ctCleaned = checkatradePhone.replace(/[^\d]/g, '');
        if (cleaned === ctCleaned) return true;
    }
    // 03xx numbers are always tracking/virtual
    if (TRACKING_NUMBER_PREFIXES.some(p => cleaned.startsWith(p))) return true;
    return false;
}

function cleanUKPhone(raw) {
    if (!raw) return '';
    return raw.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
}

// Deduplicate and validate a list of phone numbers, rejecting tracking numbers
function validatePhoneList(phones, checkatradePhone) {
    const seen = new Set();
    const valid = [];
    for (const num of phones) {
        const cleaned = cleanUKPhone(num);
        if (seen.has(cleaned)) continue;
        if (isTrackingNumber(cleaned, checkatradePhone)) continue;
        seen.add(cleaned);
        valid.push(cleaned);
    }
    return valid;
}

// ============================================================
// Proxy rotation
// ============================================================
let proxies = [];
let proxyIndex = 0;

function loadProxies() {
    const proxyPath = path.resolve(__dirname, CONFIG.proxyFile);
    if (!fs.existsSync(proxyPath)) {
        console.log('No proxy file found — running without proxies');
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

async function createPage(browser) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    await p.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    if (currentProxy) {
        await p.authenticate({ username: currentProxy.username, password: currentProxy.password });
    }
    await p.setRequestInterception(true);
    p.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return p;
}

function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim().replace(/^"|"$/g, ''));
    return fields;
}

function parseCSV(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const firstRow = parseCSVLine(lines[0]);
    const rows = [];
    const isHeaderless = /^\d+$/.test(firstRow[0]);

    if (isHeaderless) {
        for (const line of lines) {
            const v = parseCSVLine(line);
            rows.push({
                company_name: v[10] || '', area: v[2] || '', phone: v[4] || '',
                trade_type: v[8] || '', rating: v[11] || '', reviews: v[12] || '',
                years_on_checkatrade: v[14] || '', owner_name: v[15] || v[16] || '',
                vat_number: v[17] || '', profile_url: v[18] || '', handle: v[19] || ''
            });
        }
    } else {
        const header = firstRow;
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            const row = {};
            header.forEach((key, idx) => {
                row[key.trim().toLowerCase().replace(/\s+/g, '_')] = values[idx] || '';
            });
            rows.push(row);
        }
    }
    return rows;
}

function csvEscape(val) {
    const s = String(val || '').replace(/"/g, '""');
    return `"${s}"`;
}

function extractName(fullTitle) {
    if (!fullTitle) return { firstName: '', lastName: '', fullName: '' };
    const cleaned = fullTitle
        .replace(/^(Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Director|Owner)\s*/i, '')
        .trim();
    const parts = cleaned.split(' ').filter(p => p);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        fullName: cleaned
    };
}

// ============================================================
// Companies House API — get directors for Ltd companies
// ============================================================
function companiesHouseRequest(urlPath) {
    return new Promise((resolve, reject) => {
        if (!CONFIG.companiesHouseApiKey) return resolve(null);

        const options = {
            hostname: 'api.company-information.service.gov.uk',
            path: urlPath,
            headers: {
                'Authorization': 'Basic ' + Buffer.from(CONFIG.companiesHouseApiKey + ':').toString('base64')
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function lookupCompaniesHouse(companyName) {
    if (!CONFIG.companiesHouseApiKey) return null;

    try {
        // Step 1: Search for the company
        const searchResult = await companiesHouseRequest(
            `/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=3`
        );

        if (!searchResult || !searchResult.items || searchResult.items.length === 0) return null;

        // Find best match — exact or close name match
        const nameLower = companyName.toLowerCase().replace(/\s*(ltd|limited|plc)\s*/gi, '').trim();
        let match = searchResult.items.find(item => {
            const itemName = (item.title || '').toLowerCase().replace(/\s*(ltd|limited|plc)\s*/gi, '').trim();
            return itemName === nameLower;
        });
        if (!match) match = searchResult.items[0]; // fallback to top result

        const companyNumber = match.company_number;
        const registeredAddress = match.registered_office_address || {};

        // Step 2: Get officers (directors)
        const officersResult = await companiesHouseRequest(
            `/company/${companyNumber}/officers?items_per_page=10`
        );

        if (!officersResult || !officersResult.items) {
            return { companyNumber, directors: [], address: registeredAddress };
        }

        // Filter to active directors only
        const directors = officersResult.items
            .filter(o => o.officer_role === 'director' && !o.resigned_on)
            .map(o => ({
                name: o.name || '',  // "SURNAME, Firstname Middlename" format
                appointed: o.appointed_on || '',
                nationality: o.nationality || '',
                occupation: o.occupation || ''
            }));

        return { companyNumber, directors, address: registeredAddress };

    } catch (error) {
        console.error(`  CH API error: ${error.message}`);
        return null;
    }
}

// Parse Companies House name format "SURNAME, Firstname" into parts
function parseDirectorName(chName) {
    if (!chName) return { firstName: '', lastName: '', fullName: '' };

    // CH format: "SMITH, John David" or "SMITH, John"
    const parts = chName.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        const surname = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
        const forenames = parts[1];
        const firstName = forenames.split(' ')[0];
        return {
            firstName,
            lastName: surname,
            fullName: `${forenames} ${surname}`
        };
    }

    // Fallback
    const words = chName.split(' ').filter(w => w);
    return {
        firstName: words[0] || '',
        lastName: words.slice(1).join(' ') || '',
        fullName: chName
    };
}

// ============================================================
// DuckDuckGo search with retry
// ============================================================
async function searchWeb(page, query, retries = 0) {
    const engines = [
        { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
        { name: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10` },
        { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` }
    ];

    let blockedCount = 0;

    for (const engine of engines) {
        try {
            await page.goto(engine.url, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(2000 + Math.random() * 2000);

            // Detect captcha/block pages
            const blocked = await page.evaluate(() => {
                const body = (document.body.innerText || '').toLowerCase();
                const url = window.location.href.toLowerCase();
                return body.includes('captcha') || body.includes('unusual traffic') ||
                    body.includes('are you a robot') || body.includes('verify you are human') ||
                    body.includes('automated queries') || body.includes('sorry, we need to make sure') ||
                    url.includes('captcha') || url.includes('challenge');
            });

            if (blocked) {
                blockedCount++;
                console.log(`  [BLOCKED] ${engine.name} captcha detected, skipping`);
                continue; // try next engine
            }

            const results = await page.evaluate(() => {
                const links = [];
                const skipDomains = ['google.com', 'google.co.uk', 'googleapis.com', 'gstatic.com',
                    'bing.com', 'microsoft.com', 'msn.com', 'youtube.com',
                    'schema.org', 'w3.org', 'accounts.google', 'yahoo.co.jp',
                    'duckduckgo.com', 'duck.com', 'spreadprivacy.com'];

                document.querySelectorAll('a[href]').forEach(el => {
                    let href = el.href;

                    // Google /url?q= redirect format
                    if (href.includes('/url?q=')) {
                        try {
                            const url = new URL(href);
                            href = url.searchParams.get('q') || href;
                        } catch {}
                    }

                    // Bing /ck/a redirect — decode base64 from u= param
                    if (href.includes('/ck/a') && href.includes('&u=a1')) {
                        try {
                            const url = new URL(href);
                            const encoded = url.searchParams.get('u');
                            if (encoded && encoded.startsWith('a1')) {
                                href = atob(encoded.substring(2));
                            }
                        } catch {}
                    }

                    // DuckDuckGo /l/?uddg= redirect format
                    if (href.includes('duckduckgo.com/l/?') && href.includes('uddg=')) {
                        try {
                            const url = new URL(href);
                            href = decodeURIComponent(url.searchParams.get('uddg') || href);
                        } catch {}
                    }

                    // Google data-href
                    if (!href.startsWith('http') && el.dataset && el.dataset.href) {
                        href = el.dataset.href;
                    }

                    if (href && href.startsWith('http') &&
                        !skipDomains.some(d => href.includes(d))) {
                        links.push(href);
                    }
                });

                // Also try cite elements (Google shows URLs as green text)
                document.querySelectorAll('cite').forEach(cite => {
                    let text = cite.textContent.trim();
                    if (text && !text.startsWith('http')) text = 'https://' + text;
                    try {
                        const url = new URL(text);
                        if (!skipDomains.some(d => url.hostname.includes(d))) {
                            links.push(url.origin + url.pathname);
                        }
                    } catch {}
                });

                return [...new Set(links)];
            });

            // Filter out known junk domains from results
            const cleaned = results.filter(url => {
                const lower = url.toLowerCase();
                return !JUNK_RESULT_DOMAINS.some(d => lower.includes(d));
            });

            if (cleaned.length > 0) return cleaned;
            // If all results were junk, the engine is likely serving garbage — try next
            if (results.length > 0 && cleaned.length === 0) {
                console.log(`  [JUNK] ${engine.name} returned ${results.length} junk results, trying next`);
                continue;
            }
        } catch (error) {
            if (retries < CONFIG.maxRetries) {
                console.log(`  Search retry ${retries + 1} (${engine.name}) for: ${query}`);
                await sleep(5000 + Math.random() * 5000);

                // Recreate page if frame detached
                if (error.message.includes('detached') || error.message.includes('destroyed')) {
                    try {
                        const browser = page.browser();
                        await page.close().catch(() => {});
                        page = await createPage(browser);
                        activePage = page;
                    } catch (e) { /* couldn't recreate page */ }
                }

                return searchWeb(page, query, retries + 1);
            }
            continue;
        }
    }

    // All engines blocked — rotate proxy and retry once
    if (blockedCount >= engines.length && CONFIG.rotateProxyOnBlock && proxies.length > 0 && retries < 1) {
        const newProxy = getNextProxy();
        console.log(`  [PROXY ROTATE] All engines blocked — switching to ${newProxy.username.substring(0, 30)}...`);
        try {
            const browser = page.browser();
            await browser.close().catch(() => {});
            currentProxy = newProxy;
            const b = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    `--proxy-server=http://${currentProxy.host}:${currentProxy.port}`
                ]
            });
            const newPage = await createPage(b);
            // Update the global refs so main loop picks them up
            activeBrowser = b;
            activePage = newPage;
            return searchWeb(newPage, query, retries + 1);
        } catch (e) {
            console.log(`  [PROXY ROTATE] Failed: ${e.message}`);
        }
    }

    return [];
}

// Expose page/browser refs so searchWeb recovery can update them
let activePage = null;
let activeBrowser = null;

// ============================================================
// Find company website
// ============================================================
async function findWebsite(page, companyName, area) {
    // Try DuckDuckGo first, then Google as fallback
    const query = `"${companyName}" ${area} plumber`;
    const results = await searchWeb(page, query);

    const skipDomains = [
        'checkatrade.com', 'yell.com', '192.com', 'yelp.com', 'cylex',
        'facebook.com', 'linkedin.com', 'twitter.com', 'instagram.com',
        'google.com', 'gov.uk', 'wikipedia.org', 'youtube.com',
        'trustatrader.com', 'mybuilder.com', 'bark.com', 'trustpilot.com',
        'nextdoor.co.uk', 'freeindex.co.uk', 'endole.co.uk', 'findatrader',
        'thebestof.co.uk', 'rated-people.com', 'localsearch', 'scoot.co.uk',
        'apple.com/maps', 'hotfrog.co.uk', 'misterwhat.co.uk',
        'which.co.uk', 'trustedtraders.which', 'apps.apple.com', 'play.google.com',
        'amazon.co.uk', 'amazon.com', 'ebay.co.uk', 'gumtree.com',
        'thomson-local.com', 'touchlocal.com', 'cityvisitor.co.uk',
        'brownbook.net', 'dnb.com', 'companieshouse.gov.uk',
        'glassdoor.', 'indeed.', 'reed.co.uk', 'totaljobs.',
        'duckduckgo.com', 'spreadprivacy.com',
        'maps.apple.com', 'bing.com', 'bbb.org',
        'duck.ai', 'duckduckgo.com', 'spreadprivacy.com',
        'about.ads', 'help.duckduckgo', 'safe.duckduckgo',
        'substack.com', 'medium.com', 'reddit.com', 'quora.com',
        'tiktok.com', 'pinterest.com', 'x.com', 'threads.net',
        ...JUNK_RESULT_DOMAINS
    ];

    const filtered = results.filter(url => {
        const lower = url.toLowerCase();
        return !skipDomains.some(d => lower.includes(d));
    });

    // Try to match company name words in URL
    const companyWords = companyName.toLowerCase()
        .replace(/\b(ltd|limited|plc|services|solutions|plumbing|heating|gas|&|and)\b/g, '')
        .split(/\s+/).filter(w => w.length > 2);

    for (const url of filtered) {
        const urlLower = url.toLowerCase();
        for (const word of companyWords) {
            if (urlLower.includes(word)) return url;
        }
    }

    return filtered[0] || null;
}

// ============================================================
// Google Business Profile — get Google review count
// ============================================================
async function findGoogleBusiness(page, companyName, area) {
    const query = `${companyName} ${area} plumber reviews`;
    const engines = [
        { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` },
        { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` }
    ];

    for (const engine of engines) {
        try {
            await page.goto(engine.url, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(1500 + Math.random() * 1000);

            const blocked = await page.evaluate(() => {
                const body = (document.body.innerText || '').toLowerCase();
                const url = window.location.href.toLowerCase();
                return body.includes('captcha') || body.includes('unusual traffic') ||
                    body.includes('are you a robot') || body.includes('verify you are human') ||
                    url.includes('captcha') || url.includes('challenge');
            });

            if (blocked) {
                console.log(`  [GBP] ${engine.name} blocked, trying next`);
                continue;
            }

            const gbpData = await page.evaluate(() => {
                const body = document.body.innerText || '';
                let googleReviews = 0;
                let googleRating = '';

                const ratingPatterns = [
                    /(\d\.\d)\s*\((\d[\d,]*)\)/,
                    /(\d\.\d)\s*stars?\s*[·\-]\s*(\d[\d,]*)\s*reviews?/i,
                    /(\d[\d,]*)\s*Google\s*reviews?/i,
                    /Rating:\s*(\d\.\d).*?(\d[\d,]*)\s*reviews?/i
                ];

                for (const pattern of ratingPatterns) {
                    const match = body.match(pattern);
                    if (match) {
                        if (match[2]) {
                            googleRating = match[1];
                            googleReviews = parseInt(match[2].replace(/,/g, ''));
                        } else {
                            googleReviews = parseInt(match[1].replace(/,/g, ''));
                        }
                        if (googleReviews > 0) break;
                    }
                }

                return { googleReviews, googleRating };
            });

            if (gbpData.googleReviews > 0) return gbpData;
            // No reviews found on this engine — try next
        } catch (error) {
            continue;
        }
    }

    return { googleReviews: 0, googleRating: '' };
}

// ============================================================
// Find LinkedIn profile
// ============================================================
async function findLinkedIn(page, companyName, ownerName, area) {
    // DDG-only search for LinkedIn — Google/Bing always captcha on LinkedIn queries
    // and LinkedIn blocks most scrapers anyway, so this is low-value vs time cost
    const linkedIn = { companyPage: '', ownerProfile: '' };

    try {
        const query = `linkedin.com "${companyName}" ${area}`;
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle2', timeout: 12000
        });
        await sleep(1500 + Math.random() * 1000);

        const results = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(el => {
                let href = el.href;
                if (href.includes('duckduckgo.com/l/?') && href.includes('uddg=')) {
                    try {
                        const url = new URL(href);
                        href = decodeURIComponent(url.searchParams.get('uddg') || href);
                    } catch {}
                }
                if (href.includes('linkedin.com/')) links.push(href);
            });
            return [...new Set(links)];
        });

        for (const url of results) {
            const lower = url.toLowerCase();
            if (lower.includes('linkedin.com/company/') && !linkedIn.companyPage) {
                linkedIn.companyPage = url;
            }
            if (lower.includes('linkedin.com/in/') && !linkedIn.ownerProfile) {
                linkedIn.ownerProfile = url;
            }
        }
    } catch (e) { /* DDG timeout — skip LinkedIn */ }

    return linkedIn;
}

// ============================================================
// Scrape website — ALL phones, ALL emails, socials, signals
// ============================================================
async function scrapeWebsite(page, url, retries = 0) {
    const result = {
        allPhones: [],
        mobileNumbers: [],
        landlineNumbers: [],
        allEmails: [],
        facebook: '',
        instagram: '',
        postcode: '',
        teamLanguage: '',
        hasTeamPage: false,
        employeeSignals: [],
        ownerNameFromSite: '',
        competitorTools: []
    };

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1000);

        // Scrape homepage first
        const homeData = await extractPageData(page);
        mergePageData(result, homeData);

        // Try contact page
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
                const contactData = await extractPageData(page);
                mergePageData(result, contactData);
            } catch (e) { /* skip if contact page fails */ }
        }

        // Try about page
        const aboutUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const aboutLink = links.find(a => {
                const text = (a.textContent || '').toLowerCase();
                const href = (a.href || '').toLowerCase();
                return (text.includes('about') || text.includes('meet the team') ||
                        href.includes('/about') || href.includes('/team'));
            });
            return aboutLink ? aboutLink.href : null;
        });

        if (aboutUrl && aboutUrl !== url && aboutUrl !== contactUrl) {
            try {
                await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1000);
                const aboutData = await extractPageData(page);
                mergePageData(result, aboutData);
                result.hasTeamPage = true;
            } catch (e) { /* skip */ }
        }

        // Deduplicate
        result.allPhones = [...new Set(result.allPhones)];
        result.mobileNumbers = [...new Set(result.mobileNumbers)];
        result.landlineNumbers = [...new Set(result.landlineNumbers)];
        result.allEmails = [...new Set(result.allEmails)];
        result.competitorTools = [...new Set(result.competitorTools || [])];
        result.employeeSignals = [...new Set(result.employeeSignals)];

    } catch (error) {
        if (retries < CONFIG.maxRetries) {
            console.log(`  Scrape retry ${retries + 1} for: ${url}`);
            await sleep(3000);
            return scrapeWebsite(page, url, retries + 1);
        }
        console.error(`  Scrape failed: ${error.message}`);
    }

    return result;
}

async function extractPageData(page) {
    return page.evaluate(() => {
        const body = document.body.innerText || '';
        const html = document.body.innerHTML || '';
        const data = {
            phones: [],
            mobiles: [],
            landlines: [],
            emails: [],
            facebook: '',
            instagram: '',
            postcode: '',
            teamLanguage: '',
            employeeSignals: [],
            ownerName: ''
        };

        // ---- ALL UK PHONE NUMBERS ----
        // Mobile: 07xxx
        const mobilePattern = /(?:^|\s|tel:|phone:|call[:\s]|mob(?:ile)?[:\s])?((?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3})/gi;
        const mobiles = body.match(mobilePattern) || [];
        for (const m of mobiles) {
            const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned);
                data.phones.push(cleaned);
            }
        }

        // ---- TEL: LINKS (click-to-call buttons, often hidden in mobile-only elements) ----
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

        // Landline: 01xxx, 02xxx, 0800
        const landlinePatterns = [
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s]|fax[:\s])?((?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6})/gi,
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s])?((?:\+44\s?|0)2\d{4}[\s.-]?\d{4})/gi,
            /(0[23]\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/gi,
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

        // ---- ALL EMAILS ----
        const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        const emails = body.match(emailPattern) || [];
        // Also check href="mailto:" which might have obfuscated text
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        for (const link of mailtoLinks) {
            const addr = link.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
            if (addr && addr.includes('@')) emails.push(addr);
        }

        const junkDomains = ['example', 'domain', 'wix.com', 'wordpress', 'sentry',
            'schema.org', 'w3.org', 'googleapis', 'gravatar', 'wp.com',
            'squarespace', 'mailchimp', 'hubspot', 'google.com', 'facebook.com',
            'which.co.uk', 'apple.com', 'microsoft.com', 'yahoo.com',
            'trustatrader', 'mybuilder', 'bark.com', 'trustpilot'];

        // Get the current page's domain to prioritise on-domain emails
        const pageDomain = window.location.hostname.replace('www.', '');

        for (const e of emails) {
            const lower = e.toLowerCase();
            if (!junkDomains.some(d => lower.includes(d))) {
                data.emails.push(lower);
            }
        }

        // Sort: on-domain emails first, then gmail/outlook (likely personal), then others
        data.emails.sort((a, b) => {
            const aOnDomain = a.includes(pageDomain) ? 0 : 1;
            const bOnDomain = b.includes(pageDomain) ? 0 : 1;
            if (aOnDomain !== bOnDomain) return aOnDomain - bOnDomain;
            const personalDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'];
            const aPersonal = personalDomains.some(d => a.includes(d)) ? 0 : 1;
            const bPersonal = personalDomains.some(d => b.includes(d)) ? 0 : 1;
            return aPersonal - bPersonal;
        });

        // ---- SOCIAL LINKS ----
        const fbLinks = Array.from(document.querySelectorAll('a[href*="facebook.com"]'));
        for (const link of fbLinks) {
            if (link.href.includes('facebook.com/') && !link.href.includes('sharer')) {
                data.facebook = link.href;
                break;
            }
        }

        const igLinks = Array.from(document.querySelectorAll('a[href*="instagram.com"]'));
        for (const link of igLinks) {
            if (link.href.includes('instagram.com/')) {
                data.instagram = link.href;
                break;
            }
        }

        // ---- POSTCODE ----
        const postcodePattern = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/gi;
        const postcodes = body.match(postcodePattern);
        if (postcodes && postcodes.length > 0) {
            data.postcode = postcodes[0].toUpperCase().replace(/\s+/g, ' ');
        }

        // ---- TEAM LANGUAGE ----
        const iCount = (body.match(/\b(I am|I have|I offer|I provide|I specialise|my name is|myself|I've been)\b/gi) || []).length;
        const weCount = (body.match(/\b(we are|we have|we offer|we provide|our team|our engineers|our plumbers|our staff|we've been|our company)\b/gi) || []).length;

        if (iCount > weCount && iCount >= 2) data.teamLanguage = 'solo';
        else if (weCount > iCount && weCount >= 2) data.teamLanguage = 'team';
        else data.teamLanguage = 'unclear';

        // ---- EMPLOYEE SIGNALS ----
        const fleetMatch = body.match(/(\d+)\s*(vans?|vehicles?|trucks?)/gi);
        if (fleetMatch) data.employeeSignals.push('fleet:' + fleetMatch[0].trim());

        const engineerMatch = body.match(/(\d+)\s*(engineers?|plumbers?|technicians?|staff|employees?|operatives?)/gi);
        if (engineerMatch) data.employeeSignals.push('staff:' + engineerMatch[0].trim());

        if (body.match(/multi-?ple\s*(locations?|branches?|offices?)/gi)) data.employeeSignals.push('multiple_locations');
        if (body.match(/24\s*\/?\s*7|24\s*hours?|emergency\s*call\s*out/gi)) data.employeeSignals.push('24_7_service');

        // ---- COMPETITOR TOOLS (scripts, meta tags, badges on site) ----
        data.competitorTools = [];
        const lowerHtml = html.toLowerCase();
        const lowerBody = body.toLowerCase();
        const toolChecks = [
            { name: 'Jobber', patterns: ['jobber.com', 'getjobber'] },
            { name: 'ServiceM8', patterns: ['servicem8.com', 'servicem8'] },
            { name: 'Tradify', patterns: ['tradifyhq.com', 'tradify'] },
            { name: 'Commusoft', patterns: ['commusoft.co.uk', 'commusoft'] },
            { name: 'Fergus', patterns: ['fergus.com', 'fergusapp'] },
            { name: 'Housecall Pro', patterns: ['housecallpro.com', 'housecall'] },
            { name: 'ServiceTitan', patterns: ['servicetitan.com', 'servicetitan'] },
            { name: 'Powered Now', patterns: ['powerednow.com', 'powered now'] },
            { name: 'Workever', patterns: ['workever.com', 'workever'] },
            { name: 'SimPRO', patterns: ['simpro.co', 'simprogroup'] },
            { name: 'BigChange', patterns: ['bigchange.com', 'bigchange'] },
            { name: 'Verizon Connect', patterns: ['verizonconnect.com', 'fleetmatics'] },
            { name: 'Gas Engineer Software', patterns: ['gasengineersoftware.co.uk'] },
        ];
        for (const tool of toolChecks) {
            if (tool.patterns.some(p => lowerHtml.includes(p) || lowerBody.includes(p))) {
                data.competitorTools.push(tool.name);
            }
        }

        // ---- OWNER NAME FROM ABOUT TEXT ----
        // Look for patterns like "Hi, I'm John Smith" or "My name is John Smith" or "Owner: John Smith"
        const namePatterns = [
            /(?:my name is|hi,?\s*i'm|hello,?\s*i'm)\s+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/,
            /(?:owner|director|founder|proprietor)[:\s-]+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/,
            /(?:run by|managed by|operated by)\s+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/
        ];

        // Common words that look like names but aren't
        const junkNames = ['the team', 'our team', 'your home', 'our customers', 'the best',
            'rooting for', 'looking for', 'our company', 'your property', 'our services'];

        for (const pattern of namePatterns) {
            const match = body.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (!junkNames.some(j => candidate.toLowerCase().includes(j)) && candidate.length <= 40) {
                    data.ownerName = candidate;
                    break;
                }
            }
        }

        // ---- SCHEMA.ORG / JSON-LD PHONE EXTRACTION ----
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
                                data.phones.push(cleaned);
                            } else if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                                data.landlines.push(cleaned);
                                data.phones.push(cleaned);
                            }
                        }
                    }
                } catch (e) { /* malformed JSON-LD */ }
            }
        } catch (e) { /* no JSON-LD */ }

        // ---- META TAG PHONE EXTRACTION ----
        const metaTags = Array.from(document.querySelectorAll('meta[name*="phone"], meta[name*="telephone"], meta[property*="phone"], meta[itemprop="telephone"]'));
        for (const meta of metaTags) {
            const content = meta.getAttribute('content') || '';
            const cleaned = content.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned);
                data.phones.push(cleaned);
            } else if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                data.landlines.push(cleaned);
                data.phones.push(cleaned);
            }
        }

        return data;
    });
}

function mergePageData(result, pageData) {
    if (pageData.competitorTools) {
        if (!result.competitorTools) result.competitorTools = [];
        result.competitorTools.push(...pageData.competitorTools);
    }
    if (pageData.mobiles) result.mobileNumbers.push(...pageData.mobiles);
    if (pageData.landlines) result.landlineNumbers.push(...pageData.landlines);
    if (pageData.phones) result.allPhones.push(...pageData.phones);
    if (pageData.emails) result.allEmails.push(...pageData.emails);
    if (pageData.facebook && !result.facebook) result.facebook = pageData.facebook;
    if (pageData.instagram && !result.instagram) result.instagram = pageData.instagram;
    if (pageData.postcode && !result.postcode) result.postcode = pageData.postcode;
    if (pageData.teamLanguage && pageData.teamLanguage !== 'unclear') result.teamLanguage = pageData.teamLanguage;
    if (pageData.employeeSignals) result.employeeSignals.push(...pageData.employeeSignals);
    if (pageData.ownerName && !result.ownerNameFromSite) result.ownerNameFromSite = pageData.ownerName;
}

// ============================================================
// Company size scoring
// ============================================================
function calculateCompanySize(lead, websiteData, chData) {
    let score = 0;
    const signals = [];

    const isLtd = /\b(ltd|limited|plc)\b/i.test(lead.company_name || '');
    if (isLtd) { score += 1; signals.push('ltd'); }

    const vatField = lead.vat_number || '';
    const isVat = vatField.toLowerCase() === 'yes' || (vatField.length >= 9 && /^\d+$/.test(vatField));
    if (isVat) { score += 2; signals.push('vat'); }

    const reviews = parseInt(lead.reviews || lead.review_count) || 0;
    if (reviews >= 200) { score += 3; signals.push('200+ reviews'); }
    else if (reviews >= 100) { score += 2; signals.push('100+ reviews'); }
    else if (reviews >= 50) { score += 1; signals.push('50+ reviews'); }

    const yearsMatch = String(lead.years_on_checkatrade || '').match(/(\d+)/);
    const years = yearsMatch ? parseInt(yearsMatch[1]) : 0;
    if (years >= 10) { score += 2; signals.push('10+ years'); }
    else if (years >= 5) { score += 1; signals.push('5+ years'); }

    if (websiteData.teamLanguage === 'team') { score += 2; signals.push('team_language'); }
    else if (websiteData.teamLanguage === 'solo') { score -= 1; signals.push('solo_language'); }

    if (websiteData.hasTeamPage) { score += 1; signals.push('has_team_page'); }
    if (websiteData.employeeSignals.length > 0) {
        score += websiteData.employeeSignals.length;
        signals.push(...websiteData.employeeSignals);
    }

    if (chData && chData.directors && chData.directors.length > 1) {
        score += 1;
        signals.push(`${chData.directors.length}_directors`);
    }

    let category;
    if (score <= 1) category = 'Solo';
    else if (score <= 4) category = 'Small';
    else if (score <= 7) category = 'Established';
    else category = 'Large';

    return { category, score, signals, isLtd, isVat };
}

// ============================================================
// Sniper OS fit score — who should we contact FIRST?
// ============================================================
function calculateFitScore(lead, websiteData, gbpData) {
    let score = 0;
    const reasons = [];

    const reviews = parseInt(lead.reviews || lead.review_count) || 0;
    if (reviews >= 50) { score += 3; reasons.push('active_profile'); }
    else if (reviews >= 20) { score += 2; reasons.push('decent_profile'); }
    else if (reviews >= 5) { score += 1; reasons.push('has_reviews'); }

    const emergency = (lead.emergency_callout || '').toLowerCase();
    if (emergency === 'yes') { score += 2; reasons.push('emergency_callout'); }

    const yearsMatch = String(lead.years_on_checkatrade || '').match(/(\d+)/);
    const years = yearsMatch ? parseInt(yearsMatch[1]) : 0;
    if (years >= 2) { score += 2; reasons.push('invested_in_platform'); }

    const rating = parseFloat(lead.overall_rating || lead.rating) || 0;
    if (rating >= 9.5) { score += 2; reasons.push('high_rating'); }
    else if (rating >= 8) { score += 1; reasons.push('good_rating'); }

    if (websiteData.allPhones.length > 0 || websiteData.allEmails.length > 0) {
        score += 1;
        reasons.push('contactable');
    }

    // Google presence = takes online presence seriously
    if (gbpData && gbpData.googleReviews >= 20) {
        score += 2;
        reasons.push('strong_google_presence');
    } else if (gbpData && gbpData.googleReviews >= 5) {
        score += 1;
        reasons.push('has_google_reviews');
    }

    // Already uses business tools = willing to pay for software
    if (websiteData.competitorTools && websiteData.competitorTools.length > 0) {
        score += 2;
        reasons.push('uses_biz_tools:' + websiteData.competitorTools.join('+'));
    }

    let tier;
    if (score >= 9) tier = 'A';
    else if (score >= 6) tier = 'B';
    else if (score >= 3) tier = 'C';
    else tier = 'D';

    return { tier, score, reasons };
}

// ============================================================
// Checkatrade profile scraping — extract real website URL
// ============================================================
async function scrapeCheckatradeProfile(page, profileUrl) {
    if (!profileUrl) return null;
    try {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1500 + Math.random() * 1000);

        const result = await page.evaluate(() => {
            const data = { website: null, phones: [], mobiles: [], landlines: [] };

            // Look for website link on profile page
            const links = Array.from(document.querySelectorAll('a[href]'));
            const skipDomains = ['checkatrade.com', 'facebook.com', 'twitter.com', 'instagram.com',
                'linkedin.com', 'youtube.com', 'google.com', 'trustpilot.com',
                'gassaferegister.co.uk', 'watersafe.org.uk', 'x.com', 'tiktok.com',
                'pinterest.com', 'threads.net', 'niceic.com', 'cscs.uk.com',
                'apple.com', 'play.google.com', 'apps.apple.com',
                'vaillant.co.uk', 'napit.org.uk', 'ciphe.org.uk', 'bafe.org.uk',
                'jib.org.uk', 'fgasregister.com', 'worcester-bosch.co.uk',
                'baxi.co.uk', 'oftec.org', 'elecsa.co.uk', 'stroma.com'];

            for (const link of links) {
                const href = link.href || '';
                const text = (link.textContent || '').toLowerCase().trim();
                // Look for links labeled "website", "visit website", "www." etc
                if ((text.includes('website') || text.includes('visit') || text.includes('www.') ||
                     href.includes('redirect') || link.getAttribute('data-tracking') === 'website') &&
                    href.startsWith('http') &&
                    !skipDomains.some(d => href.includes(d))) {
                    data.website = href;
                    break;
                }
            }

            // Also try finding website from any external link that isn't a known directory
            if (!data.website) {
                for (const link of links) {
                    const href = link.href || '';
                    if (href.startsWith('http') && !skipDomains.some(d => href.includes(d)) &&
                        !href.includes('checkatrade') && !href.includes('javascript:')) {
                        // Check it looks like a business website (has a .co.uk, .com, etc)
                        if (href.match(/\.(co\.uk|com|org\.uk|uk|net|biz)/)) {
                            data.website = href;
                            break;
                        }
                    }
                }
            }

            // Extract any phone numbers visible on the profile page
            const body = document.body.innerText || '';
            const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
            const mobiles = body.match(mobilePattern) || [];
            for (const m of mobiles) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length === 11 && cleaned.startsWith('07')) {
                    data.mobiles.push(cleaned);
                    data.phones.push(cleaned);
                }
            }

            // tel: links on profile
            const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
            for (const link of telLinks) {
                const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (num.length === 11 && num.startsWith('07')) {
                    data.mobiles.push(num);
                    data.phones.push(num);
                }
            }

            return data;
        });

        return result;
    } catch (error) {
        console.log(`  [CT Profile] Failed: ${error.message}`);
        return null;
    }
}

// ============================================================
// Directory fallback — Yell.com / FreeIndex
// ============================================================
async function searchDirectories(page, companyName, area) {
    const result = { phones: [], mobiles: [], landlines: [], website: null };

    // Try Yell.com search
    const yellQuery = `"${companyName}" ${area} plumber site:yell.com`;
    const yellResults = await searchWeb(page, yellQuery);
    const yellUrl = yellResults.find(u => u.includes('yell.com'));

    if (yellUrl) {
        try {
            await page.goto(yellUrl, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(1500 + Math.random() * 1000);

            const yellData = await page.evaluate(() => {
                const data = { phones: [], mobiles: [], landlines: [], website: null };
                const body = document.body.innerText || '';

                // Yell.com shows phone numbers prominently
                const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                const mobiles = body.match(mobilePattern) || [];
                for (const m of mobiles) {
                    const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (cleaned.length === 11 && cleaned.startsWith('07')) {
                        data.mobiles.push(cleaned);
                        data.phones.push(cleaned);
                    }
                }

                // Landlines on Yell
                const landlinePattern = /(?:\+44\s?|0)[12]\d{3}[\s.-]?\d{5,6}/g;
                const landlines = body.match(landlinePattern) || [];
                for (const m of landlines) {
                    const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                        data.landlines.push(cleaned);
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
                    } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02'))) {
                        data.landlines.push(num);
                        data.phones.push(num);
                    }
                }

                // Website link on Yell listing
                const websiteLinks = Array.from(document.querySelectorAll('a[href]'));
                for (const link of websiteLinks) {
                    const text = (link.textContent || '').toLowerCase();
                    const href = link.href || '';
                    if ((text.includes('website') || text.includes('visit')) &&
                        href.startsWith('http') && !href.includes('yell.com')) {
                        data.website = href;
                        break;
                    }
                }

                return data;
            });

            result.phones.push(...yellData.phones);
            result.mobiles.push(...yellData.mobiles);
            result.landlines.push(...yellData.landlines);
            if (yellData.website) result.website = yellData.website;

            if (yellData.mobiles.length) {
                console.log(`  [Yell] Found mobiles: ${yellData.mobiles.join(', ')}`);
            }
        } catch (e) {
            console.log(`  [Yell] Scrape failed: ${e.message}`);
        }
    }

    // If still no mobile, try FreeIndex
    if (result.mobiles.length === 0) {
        const freeIndexQuery = `"${companyName}" ${area} plumber site:freeindex.co.uk`;
        const fiResults = await searchWeb(page, freeIndexQuery);
        const fiUrl = fiResults.find(u => u.includes('freeindex.co.uk'));

        if (fiUrl) {
            try {
                await page.goto(fiUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1500 + Math.random() * 1000);

                const fiData = await page.evaluate(() => {
                    const data = { phones: [], mobiles: [], landlines: [] };
                    const body = document.body.innerText || '';

                    const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                    const mobiles = body.match(mobilePattern) || [];
                    for (const m of mobiles) {
                        const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                        if (cleaned.length === 11 && cleaned.startsWith('07')) {
                            data.mobiles.push(cleaned);
                            data.phones.push(cleaned);
                        }
                    }

                    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                    for (const link of telLinks) {
                        const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                        if (num.length === 11 && num.startsWith('07')) {
                            data.mobiles.push(num);
                            data.phones.push(num);
                        }
                    }

                    return data;
                });

                result.phones.push(...fiData.phones);
                result.mobiles.push(...fiData.mobiles);
                result.landlines.push(...fiData.landlines);

                if (fiData.mobiles.length) {
                    console.log(`  [FreeIndex] Found mobiles: ${fiData.mobiles.join(', ')}`);
                }
            } catch (e) {
                console.log(`  [FreeIndex] Scrape failed: ${e.message}`);
            }
        }
    }

    // Deduplicate
    result.phones = [...new Set(result.phones)];
    result.mobiles = [...new Set(result.mobiles)];
    result.landlines = [...new Set(result.landlines)];

    return result;
}

// ============================================================
// Gemini-assisted phone discovery
// ============================================================
async function geminiPhoneSearch(page, companyName, area, profileUrl, checkatradePhone) {
    if (!GoogleGenerativeAI || !CONFIG.geminiApiKey) return { mobiles: [], searchUrls: [] };

    try {
        const genAI = new GoogleGenerativeAI(CONFIG.geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = `You are helping find the real mobile phone number for a UK plumbing business.

Business: ${companyName}
Area: ${area}
Checkatrade profile: ${profileUrl || 'N/A'}
Checkatrade tracking number (NOT the real number): ${checkatradePhone || 'N/A'}

The business has no website we could find. We need their real mobile number (07xxx).

Suggest 3-5 specific Google search queries that might find this number. Think about:
- Nextdoor posts or community forums where they might have posted
- Local Facebook groups or marketplace listings
- Google Maps/Google Business Profile
- Thomson Local, 118118, BT Phone Book
- Local council approved trader lists
- Industry directories (Gas Safe Register if gas work, CIPHE, WaterSafe)
- Review sites that show phone numbers (Trustpilot, Google Reviews)

Return ONLY the search queries, one per line, no numbering, no explanation.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const queries = text.split('\n').map(q => q.trim()).filter(q => q.length > 10 && q.length < 200);

        const foundMobiles = [];

        // Try up to 3 of the suggested queries
        for (const query of queries.slice(0, 3)) {
            console.log(`  [Gemini] Searching: ${query.substring(0, 60)}...`);
            const results = await searchWeb(page, query);

            // Check first 2 results for phone numbers
            for (const url of results.slice(0, 2)) {
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 12000 });
                    await sleep(1000);

                    const pagePhones = await page.evaluate(() => {
                        const body = document.body.innerText || '';
                        const phones = [];

                        // Mobile pattern
                        const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                        const mobiles = body.match(mobilePattern) || [];
                        for (const m of mobiles) {
                            const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                                phones.push(cleaned);
                            }
                        }

                        // tel: links
                        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                        for (const link of telLinks) {
                            const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                            if (num.length === 11 && num.startsWith('07')) {
                                phones.push(num);
                            }
                        }

                        return [...new Set(phones)];
                    });

                    const validMobiles = validatePhoneList(pagePhones, checkatradePhone)
                        .filter(n => isValidUKMobile(n));
                    foundMobiles.push(...validMobiles);

                    if (foundMobiles.length > 0) break;
                } catch (e) { /* page load failed */ }
            }

            if (foundMobiles.length > 0) break;
            await sleep(1000);
        }

        return { mobiles: [...new Set(foundMobiles)] };
    } catch (error) {
        console.log(`  [Gemini] Failed: ${error.message}`);
        return { mobiles: [] };
    }
}

// ============================================================
// Checkpoint save/load
// ============================================================
function saveProgress(enrichedLeads, lastIndex) {
    const data = { lastIndex, count: enrichedLeads.length, leads: enrichedLeads };
    fs.writeFileSync(CONFIG.progressFile, JSON.stringify(data), 'utf-8');
    console.log(`  [Checkpoint] Saved ${enrichedLeads.length} leads (last index: ${lastIndex})`);
}

function loadProgress() {
    if (fs.existsSync(CONFIG.progressFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(CONFIG.progressFile, 'utf-8'));
            console.log(`Resuming from checkpoint: ${data.count} leads already enriched (last index: ${data.lastIndex})`);
            return data;
        } catch { return null; }
    }
    return null;
}

// ============================================================
// CSV output
// ============================================================
const OUTPUT_HEADER = [
    'company_name', 'first_name', 'last_name', 'full_name', 'role',
    'area', 'postcode', 'registered_address',
    'checkatrade_phone', 'mobile', 'landline', 'all_phones',
    'email', 'all_emails',
    'website', 'facebook', 'instagram', 'linkedin_company', 'linkedin_owner',
    'rating', 'reviews', 'years_on_checkatrade', 'trade_type',
    'google_reviews', 'google_rating',
    'company_size', 'size_score', 'size_signals',
    'is_ltd', 'is_vat', 'companies_house_number',
    'team_language', 'has_team_page', 'employee_signals',
    'competitor_tools',
    'sniper_fit_tier', 'sniper_fit_score', 'sniper_fit_reasons',
    'emergency_callout', 'free_estimates',
    'profile_url', 'phone_source', 'name_source'
];

function writeCSV(enrichedLeads) {
    const rows = [OUTPUT_HEADER.join(',')];
    for (const l of enrichedLeads) {
        rows.push([
            csvEscape(l.company_name), csvEscape(l.first_name), csvEscape(l.last_name),
            csvEscape(l.full_name), csvEscape(l.role),
            csvEscape(l.area), csvEscape(l.postcode), csvEscape(l.registered_address),
            csvEscape(l.checkatrade_phone), csvEscape(l.mobile), csvEscape(l.landline),
            csvEscape(l.all_phones),
            csvEscape(l.email), csvEscape(l.all_emails),
            csvEscape(l.website), csvEscape(l.facebook), csvEscape(l.instagram),
            csvEscape(l.linkedin_company), csvEscape(l.linkedin_owner),
            l.rating || '', l.reviews || '', csvEscape(l.years_on_checkatrade),
            csvEscape(l.trade_type),
            l.google_reviews || 0, csvEscape(l.google_rating),
            csvEscape(l.company_size), l.size_score || 0, csvEscape(l.size_signals),
            l.is_ltd ? 'Yes' : 'No', l.is_vat ? 'Yes' : 'No',
            csvEscape(l.companies_house_number),
            csvEscape(l.team_language), l.has_team_page ? 'Yes' : 'No',
            csvEscape(l.employee_signals),
            csvEscape(l.competitor_tools),
            csvEscape(l.sniper_fit_tier), l.sniper_fit_score || 0,
            csvEscape(l.sniper_fit_reasons),
            csvEscape(l.emergency_callout), csvEscape(l.free_estimates),
            csvEscape(l.profile_url), csvEscape(l.phone_source || ''), csvEscape(l.name_source)
        ].join(','));
    }

    const outputDir = path.dirname(CONFIG.outputFile);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(CONFIG.outputFile, rows.join('\n'), 'utf-8');
}

// ============================================================
// Main
// ============================================================
async function enrichLeads() {
    console.log('\n=== Lead Enrichment v3 (Enhanced Phone Discovery) ===');
    console.log(`Input:    ${CONFIG.inputFile}`);
    console.log(`Output:   ${CONFIG.outputFile}`);
    console.log(`Progress: ${CONFIG.progressFile}`);
    console.log(`CH API:   ${CONFIG.companiesHouseApiKey ? 'Configured' : 'Not set (set CH_API_KEY env var)'}`);
    console.log('');

    if (!fs.existsSync(CONFIG.inputFile)) {
        console.error(`Input file not found: ${CONFIG.inputFile}`);
        process.exit(1);
    }

    const content = fs.readFileSync(CONFIG.inputFile, 'utf-8');
    const leads = parseCSV(content);
    console.log(`Total leads in file: ${leads.length}\n`);

    // Load checkpoint
    const progress = loadProgress();
    const enrichedLeads = progress ? progress.leads : [];
    const startIndex = progress ? progress.lastIndex + 1 : 0;

    if (startIndex >= leads.length) {
        console.log('All leads already enriched. Delete progress file to re-run.');
        writeCSV(enrichedLeads);
        return;
    }

    // Load proxies
    loadProxies();

    // Launch browser with rotation support
    let searchesSinceRotate = 0;

    async function launchBrowser() {
        currentProxy = getNextProxy();
        const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
        if (currentProxy) {
            launchArgs.push(`--proxy-server=http://${currentProxy.host}:${currentProxy.port}`);
            console.log(`  Using proxy: ${currentProxy.username.substring(0, 40)}...`);
        }
        const b = await puppeteer.launch({ headless: 'new', args: launchArgs });
        const p = await createPage(b);
        activeBrowser = b;
        activePage = p;
        return { browser: b, page: p };
    }

    let { browser, page } = await launchBrowser();

    try {
        for (let i = startIndex; i < leads.length; i++) {
            // Pick up browser/page if searchWeb rotated proxy mid-search
            if (activeBrowser && activeBrowser !== browser) {
                browser = activeBrowser;
                page = activePage;
            }

            // Rotate browser + proxy periodically to avoid bot detection
            if (searchesSinceRotate >= CONFIG.browserRotateEvery) {
                console.log('  [ROTATE] Fresh browser + proxy to avoid detection');
                await browser.close().catch(() => {});
                await sleep(3000 + Math.random() * 3000);
                ({ browser, page } = await launchBrowser());
                searchesSinceRotate = 0;
            }
            const lead = leads[i];
            const companyName = lead.company_name || lead.companyname || lead.company || lead.name || '';
            const area = lead.area || lead.location || lead.city || '';
            const ownerNameRaw = lead.owner_name || lead.ownername || lead.owner || lead.contact || '';
            const checkatradePhone = lead.phone || lead.checkatrade_phone || '';

            console.log(`\n[${i + 1}/${leads.length}] ${companyName}`);

            // --- Name resolution (priority: Companies House > Website > Checkatrade) ---
            let firstName = '', lastName = '', fullName = '', role = '', nameSource = '';
            const checkatradeName = extractName(ownerNameRaw);

            // Companies House lookup for Ltd companies
            let chData = null;
            const isLtd = /\b(ltd|limited|plc)\b/i.test(companyName);
            if (isLtd && CONFIG.companiesHouseApiKey) {
                chData = await lookupCompaniesHouse(companyName);
                if (chData && chData.directors && chData.directors.length > 0) {
                    const director = chData.directors[0];
                    const parsed = parseDirectorName(director.name);
                    firstName = parsed.firstName;
                    lastName = parsed.lastName;
                    fullName = parsed.fullName;
                    role = director.occupation || 'Director';
                    nameSource = 'companies_house';
                    console.log(`  CH Director: ${fullName} (${role})`);
                }
                await sleep(500); // CH rate limit: 600/5min
            }

            // Website search
            let website = await findWebsite(page, companyName, area);
            let websiteData = {
                allPhones: [], mobileNumbers: [], landlineNumbers: [],
                allEmails: [], facebook: '', instagram: '', postcode: '',
                teamLanguage: 'unclear', hasTeamPage: false, employeeSignals: [],
                ownerNameFromSite: ''
            };
            let phoneSource = '';
            const profileUrl = lead.profile_url || '';

            if (website) {
                console.log(`  Website: ${website}`);
                websiteData = await scrapeWebsite(page, website);
                phoneSource = 'website';

                // If no name from CH, try website
                if (!lastName && websiteData.ownerNameFromSite) {
                    const siteName = extractName(websiteData.ownerNameFromSite);
                    firstName = siteName.firstName;
                    lastName = siteName.lastName;
                    fullName = siteName.fullName;
                    nameSource = 'website';
                    console.log(`  Name from site: ${fullName}`);
                }
            } else {
                console.log('  No website found via search');

                // --- FALLBACK 1: Checkatrade profile scraping ---
                if (profileUrl) {
                    console.log(`  [CT Profile] Checking: ${profileUrl}`);
                    const ctProfile = await scrapeCheckatradeProfile(page, profileUrl);
                    if (ctProfile) {
                        // If profile has a real website link, scrape it
                        if (ctProfile.website) {
                            console.log(`  [CT Profile] Found website: ${ctProfile.website}`);
                            website = ctProfile.website;
                            websiteData = await scrapeWebsite(page, website);
                            phoneSource = 'checkatrade_profile_website';

                            if (!lastName && websiteData.ownerNameFromSite) {
                                const siteName = extractName(websiteData.ownerNameFromSite);
                                firstName = siteName.firstName;
                                lastName = siteName.lastName;
                                fullName = siteName.fullName;
                                nameSource = 'website';
                                console.log(`  Name from site: ${fullName}`);
                            }
                        }
                        // Merge any phone numbers found directly on profile
                        if (ctProfile.mobiles.length) {
                            // Validate these aren't the Checkatrade tracking number
                            const validProfileMobiles = validatePhoneList(ctProfile.mobiles, checkatradePhone)
                                .filter(n => isValidUKMobile(n));
                            websiteData.mobileNumbers.push(...validProfileMobiles);
                            websiteData.allPhones.push(...validProfileMobiles);
                            if (validProfileMobiles.length) {
                                console.log(`  [CT Profile] Mobiles: ${validProfileMobiles.join(', ')}`);
                                if (!phoneSource) phoneSource = 'checkatrade_profile';
                            }
                        }
                    }
                }

                // --- FALLBACK 2: Directory search (Yell.com / FreeIndex) ---
                if (websiteData.mobileNumbers.length === 0) {
                    console.log('  [Directory] Searching Yell/FreeIndex...');
                    const dirData = await searchDirectories(page, companyName, area);

                    // If directory found a website and we still don't have one, scrape it
                    if (!website && dirData.website) {
                        console.log(`  [Directory] Found website: ${dirData.website}`);
                        website = dirData.website;
                        websiteData = await scrapeWebsite(page, website);
                        phoneSource = 'directory_website';
                    }

                    // Merge directory phone numbers
                    if (dirData.mobiles.length) {
                        const validDirMobiles = validatePhoneList(dirData.mobiles, checkatradePhone)
                            .filter(n => isValidUKMobile(n));
                        websiteData.mobileNumbers.push(...validDirMobiles);
                        websiteData.allPhones.push(...validDirMobiles);
                        if (validDirMobiles.length && !phoneSource) phoneSource = 'directory';
                    }
                    if (dirData.landlines.length) {
                        const validDirLandlines = validatePhoneList(dirData.landlines, checkatradePhone)
                            .filter(n => isValidUKLandline(n));
                        websiteData.landlineNumbers.push(...validDirLandlines);
                        websiteData.allPhones.push(...validDirLandlines);
                    }
                }
            }

            // --- FALLBACK 3: Gemini-assisted search (niche sites, forums, directories) ---
            if (websiteData.mobileNumbers.length === 0 && CONFIG.geminiApiKey && GoogleGenerativeAI) {
                console.log('  [Gemini] No mobile found yet, trying AI-assisted search...');
                const geminiResult = await geminiPhoneSearch(page, companyName, area, profileUrl, checkatradePhone);
                if (geminiResult.mobiles.length) {
                    websiteData.mobileNumbers.push(...geminiResult.mobiles);
                    websiteData.allPhones.push(...geminiResult.mobiles);
                    phoneSource = 'gemini';
                    console.log(`  [Gemini] Found mobiles: ${geminiResult.mobiles.join(', ')}`);
                }
            }

            // --- VALIDATE AND DEDUPLICATE ALL PHONE NUMBERS ---
            websiteData.mobileNumbers = validatePhoneList(websiteData.mobileNumbers, checkatradePhone)
                .filter(n => isValidUKMobile(n));
            websiteData.landlineNumbers = validatePhoneList(websiteData.landlineNumbers, checkatradePhone)
                .filter(n => isValidUKLandline(n));
            websiteData.allPhones = [...new Set([...websiteData.mobileNumbers, ...websiteData.landlineNumbers])];

            // Fallback to Checkatrade name
            if (!firstName) {
                firstName = checkatradeName.firstName;
                lastName = checkatradeName.lastName;
                fullName = checkatradeName.fullName;
                nameSource = 'checkatrade';
            }

            // Google Business Profile
            const gbpData = await findGoogleBusiness(page, companyName, area);
            if (gbpData.googleReviews) console.log(`  Google: ${gbpData.googleRating || '?'}★ (${gbpData.googleReviews} reviews)`);

            // LinkedIn search (only if we have a name or company)
            let linkedIn = { companyPage: '', ownerProfile: '' };
            if (companyName) {
                linkedIn = await findLinkedIn(page, companyName, fullName, area);
                if (linkedIn.companyPage) console.log(`  LinkedIn Co: ${linkedIn.companyPage}`);
                if (linkedIn.ownerProfile) console.log(`  LinkedIn Owner: ${linkedIn.ownerProfile}`);
            }

            // Log contact data found
            if (websiteData.mobileNumbers.length) console.log(`  Mobiles: ${websiteData.mobileNumbers.join(', ')}${phoneSource ? ' [' + phoneSource + ']' : ''}`);
            if (websiteData.landlineNumbers.length) console.log(`  Landlines: ${websiteData.landlineNumbers.join(', ')}`);
            if (websiteData.allEmails.length) console.log(`  Emails: ${websiteData.allEmails.join(', ')}`);
            if (websiteData.competitorTools && websiteData.competitorTools.length) console.log(`  Biz Tools: ${websiteData.competitorTools.join(', ')}`);

            // Scoring
            const sizeData = calculateCompanySize(lead, websiteData, chData);
            const fitData = calculateFitScore(lead, websiteData, gbpData);
            console.log(`  Size: ${sizeData.category} | Fit: ${fitData.tier} (${fitData.score})`);

            searchesSinceRotate++;

            // Build enriched record
            const registered = chData && chData.address ?
                [chData.address.address_line_1, chData.address.locality, chData.address.postal_code]
                    .filter(Boolean).join(', ') : '';

            enrichedLeads.push({
                company_name: companyName,
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                role: role,
                area: area,
                postcode: websiteData.postcode || '',
                registered_address: registered,
                checkatrade_phone: checkatradePhone,
                mobile: websiteData.mobileNumbers[0] || '',
                landline: websiteData.landlineNumbers[0] || '',
                all_phones: websiteData.allPhones.join('; '),
                email: websiteData.allEmails[0] || '',
                all_emails: websiteData.allEmails.join('; '),
                website: website || '',
                facebook: websiteData.facebook,
                instagram: websiteData.instagram,
                linkedin_company: linkedIn.companyPage,
                linkedin_owner: linkedIn.ownerProfile,
                rating: lead.overall_rating || lead.rating || '',
                reviews: lead.review_count || lead.reviews || '',
                years_on_checkatrade: lead.years_on_checkatrade || '',
                trade_type: lead.trade_type || 'Plumber',
                google_reviews: gbpData.googleReviews || 0,
                google_rating: gbpData.googleRating || '',
                company_size: sizeData.category,
                size_score: sizeData.score,
                size_signals: sizeData.signals.join('; '),
                is_ltd: sizeData.isLtd,
                is_vat: sizeData.isVat,
                companies_house_number: chData ? chData.companyNumber || '' : '',
                team_language: websiteData.teamLanguage,
                has_team_page: websiteData.hasTeamPage,
                employee_signals: websiteData.employeeSignals.join('; '),
                competitor_tools: (websiteData.competitorTools || []).join('; '),
                sniper_fit_tier: fitData.tier,
                sniper_fit_score: fitData.score,
                sniper_fit_reasons: fitData.reasons.join('; '),
                emergency_callout: lead.emergency_callout || '',
                free_estimates: lead.free_estimates || '',
                profile_url: profileUrl,
                phone_source: phoneSource,
                name_source: nameSource
            });

            // Checkpoint
            if ((i + 1) % CONFIG.saveEvery === 0) {
                saveProgress(enrichedLeads, i);
                writeCSV(enrichedLeads); // also write partial CSV
            }

            // Slightly longer delay between leads to reduce detection
            await sleep(CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay));
            // Extra pause every 10 leads
            if ((i + 1) % 10 === 0) {
                const extraPause = 5000 + Math.random() * 5000;
                console.log(`  [PAUSE] ${Math.round(extraPause/1000)}s cooldown`);
                await sleep(extraPause);
            }
        }

    } finally {
        await browser.close();
    }

    // Final save
    writeCSV(enrichedLeads);

    // Clean up progress file
    if (fs.existsSync(CONFIG.progressFile)) fs.unlinkSync(CONFIG.progressFile);

    // ---- Summary ----
    const total = enrichedLeads.length;
    const pct = (n) => total ? Math.round(n / total * 100) : 0;

    const withMobile = enrichedLeads.filter(l => l.mobile).length;
    const withLandline = enrichedLeads.filter(l => l.landline).length;
    const withEmail = enrichedLeads.filter(l => l.email).length;
    const withWebsite = enrichedLeads.filter(l => l.website).length;
    const withFullName = enrichedLeads.filter(l => l.last_name).length;
    const withLinkedIn = enrichedLeads.filter(l => l.linkedin_company || l.linkedin_owner).length;
    const withFacebook = enrichedLeads.filter(l => l.facebook).length;

    const tierA = enrichedLeads.filter(l => l.sniper_fit_tier === 'A').length;
    const tierB = enrichedLeads.filter(l => l.sniper_fit_tier === 'B').length;
    const tierC = enrichedLeads.filter(l => l.sniper_fit_tier === 'C').length;
    const tierD = enrichedLeads.filter(l => l.sniper_fit_tier === 'D').length;

    const chNames = enrichedLeads.filter(l => l.name_source === 'companies_house').length;
    const siteNames = enrichedLeads.filter(l => l.name_source === 'website').length;
    const ctNames = enrichedLeads.filter(l => l.name_source === 'checkatrade').length;
    const withGoogleReviews = enrichedLeads.filter(l => l.google_reviews > 0).length;
    const withCompTools = enrichedLeads.filter(l => l.competitor_tools).length;

    // Phone source breakdown
    const phoneFromWebsite = enrichedLeads.filter(l => l.phone_source === 'website').length;
    const phoneFromCTProfile = enrichedLeads.filter(l => l.phone_source === 'checkatrade_profile' || l.phone_source === 'checkatrade_profile_website').length;
    const phoneFromDirectory = enrichedLeads.filter(l => l.phone_source === 'directory' || l.phone_source === 'directory_website').length;
    const phoneFromGemini = enrichedLeads.filter(l => l.phone_source === 'gemini').length;

    console.log('\n========================================');
    console.log('     ENRICHMENT COMPLETE (v3)');
    console.log('========================================');
    console.log(`Total: ${total}`);
    console.log('');
    console.log('CONTACT DATA:');
    console.log(`  Mobile (07):    ${withMobile} (${pct(withMobile)}%)`);
    console.log(`  Landline:       ${withLandline} (${pct(withLandline)}%)`);
    console.log(`  Email:          ${withEmail} (${pct(withEmail)}%)`);
    console.log(`  Website:        ${withWebsite} (${pct(withWebsite)}%)`);
    console.log(`  Facebook:       ${withFacebook} (${pct(withFacebook)}%)`);
    console.log(`  LinkedIn:       ${withLinkedIn} (${pct(withLinkedIn)}%)`);
    console.log('');
    console.log('PHONE SOURCES:');
    console.log(`  From website:        ${phoneFromWebsite}`);
    console.log(`  From CT profile:     ${phoneFromCTProfile}`);
    console.log(`  From directories:    ${phoneFromDirectory}`);
    console.log(`  From Gemini search:  ${phoneFromGemini}`);
    console.log('');
    console.log('DECISION MAKER:');
    console.log(`  Full name (first+last): ${withFullName} (${pct(withFullName)}%)`);
    console.log(`  From Companies House:   ${chNames}`);
    console.log(`  From website:           ${siteNames}`);
    console.log(`  Checkatrade only:       ${ctNames}`);
    console.log('');
    console.log('ONLINE PRESENCE:');
    console.log(`  Google Reviews: ${withGoogleReviews} (${pct(withGoogleReviews)}%)`);
    console.log(`  Uses Biz Tools: ${withCompTools} (${pct(withCompTools)}%)`);
    console.log('');
    console.log('SNIPER OS FIT:');
    console.log(`  Tier A (hot):     ${tierA} (${pct(tierA)}%)`);
    console.log(`  Tier B (warm):    ${tierB} (${pct(tierB)}%)`);
    console.log(`  Tier C (cool):    ${tierC} (${pct(tierC)}%)`);
    console.log(`  Tier D (cold):    ${tierD} (${pct(tierD)}%)`);
    console.log(`\nOutput: ${CONFIG.outputFile}`);
}

// Run
enrichLeads().catch(console.error);
