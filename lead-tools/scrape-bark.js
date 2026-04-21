const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const {
    sleep, jitterDelay, slugify, writeCSV,
    ensureDir, sendTelegram
} = require('./scraper-base');

// Load proxy config
const PROXY_FILE = path.join(__dirname, 'proxies-fast.txt');
let proxyConfig = null;
if (fs.existsSync(PROXY_FILE)) {
    const line = fs.readFileSync(PROXY_FILE, 'utf8').trim().split('\n')[0].trim();
    const parts = line.split(':');
    if (parts.length >= 4) {
        proxyConfig = { host: parts[0], port: parseInt(parts[1]), user: parts[2], pass: parts[3] };
        console.log(`Proxy: ${proxyConfig.host}:${proxyConfig.port} (${proxyConfig.user.substring(0, 15)}...)`);
    }
}

// HTTPS GET via HTTP CONNECT proxy
function httpGet(url) {
    if (!proxyConfig) return httpGetDirect(url);
    return httpGetProxy(url);
}

function httpGetDirect(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: browserHeaders()
        }, (res) => handleResponse(res, resolve, reject));
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });
}

function httpGetProxy(url) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    // Append random session ID to force IP rotation per request
    const sessionId = Math.random().toString(36).substring(2, 10);
    const rotatedUser = `${proxyConfig.user}-session-${sessionId}`;
    const proxyUrl = `http://${rotatedUser}:${proxyConfig.pass}@${proxyConfig.host}:${proxyConfig.port}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            agent,
            headers: browserHeaders()
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://www.bark.com${res.headers.location}`;
                return httpGet(loc).then(resolve, reject);
            }
            if (res.statusCode === 404) {
                return resolve('');
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });
}

function browserHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
    };
}

// ============================================================
// Config
// ============================================================

const recoveryMode = process.argv.includes('--recovery');
const flareSolverrMode = process.argv.includes('--flaresolverr');
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://100.121.45.1:8191/v1';

const CONFIG = {
    trade: process.argv[2] || 'Plumber',
    testMode: process.argv.includes('--test'),
    recoveryMode,
    flareSolverrMode: flareSolverrMode,
    debugHtml: process.argv.includes('--debug-html'),
    outputDir: './output/bark',
    logsDir: './logs',
    debugDir: './output/bark/debug',
    delayMin: flareSolverrMode ? 8000 : (recoveryMode ? 10000 : 3000),
    delayMax: flareSolverrMode ? 15000 : (recoveryMode ? 20000 : 6000),
    profileDelayMin: flareSolverrMode ? 5000 : (recoveryMode ? 8000 : 3000),
    profileDelayMax: flareSolverrMode ? 10000 : (recoveryMode ? 15000 : 6000),
    maxEmptyPages: 3,
    maxRetries: recoveryMode ? 3 : 1,
    retryWaits: recoveryMode ? [90000, 120000, 180000] : [60000],
    healthCheckEvery: 250,
    saveEvery: 50,
    sessionRotateEvery: 500  // unused, kept for reference
};

// FlareSolverr request -- bypasses Cloudflare with headless browser
function flareSolverrGet(url) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            cmd: 'request.get',
            url,
            maxTimeout: 60000
        });
        const opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };
        const req = http.request(FLARESOLVERR_URL, opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.solution && json.solution.response) {
                        resolve(json.solution.response);
                    } else {
                        resolve('');
                    }
                } catch (e) {
                    reject(new Error(`FlareSolverr parse error: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(90000, () => { req.destroy(); reject(new Error('FlareSolverr timeout')); });
        req.write(payload);
        req.end();
    });
}

// ============================================================
// UK locations for Bark
// ============================================================

const UK_LOCATIONS = [
    'london', 'east-london', 'west-london', 'north-london', 'south-london',
    'croydon', 'bromley', 'enfield', 'barnet', 'ealing',
    'brighton', 'reading', 'oxford', 'southampton', 'portsmouth',
    'guildford', 'maidstone', 'canterbury', 'crawley', 'slough',
    'basingstoke', 'chelmsford', 'colchester', 'southend-on-sea',
    'bristol', 'bath', 'exeter', 'plymouth', 'bournemouth',
    'swindon', 'gloucester', 'cheltenham', 'taunton',
    'norwich', 'cambridge', 'ipswich', 'peterborough', 'luton',
    'watford', 'stevenage', 'bedford', 'milton-keynes', 'northampton',
    'birmingham', 'coventry', 'leicester', 'nottingham', 'derby',
    'wolverhampton', 'stoke-on-trent', 'worcester', 'telford',
    'solihull', 'walsall', 'lincoln', 'mansfield',
    'manchester', 'liverpool', 'bolton', 'stockport', 'wigan',
    'warrington', 'blackpool', 'preston', 'chester', 'salford',
    'newcastle', 'sunderland', 'middlesbrough', 'durham', 'gateshead',
    'leeds', 'sheffield', 'bradford', 'hull', 'york', 'huddersfield',
    'doncaster', 'wakefield', 'barnsley', 'rotherham', 'harrogate',
    'edinburgh', 'glasgow', 'aberdeen', 'dundee', 'inverness',
    'stirling', 'perth', 'falkirk',
    'cardiff', 'swansea', 'newport', 'wrexham',
    'belfast', 'derry', 'lisburn'
];

// ============================================================
// Trade slug mapping for Bark URLs
// ============================================================

function getBarkTradeSlug(trade) {
    const map = {
        'plumber': 'plumbers', 'builder': 'builders', 'electrician': 'electricians',
        'roofer': 'roofers', 'painter decorator': 'painter-decorator',
        'plasterer': 'plasterers', 'carpenter': 'carpenters', 'tiler': 'tilers',
        'handyman': 'handyman', 'heating engineer': 'boiler-installation',
        'bathroom fitter': 'bathroom-installation', 'kitchen fitter': 'kitchen-fitters',
        'landscaper': 'landscaping', 'locksmith': 'locksmith',
        'driveway specialist': 'driveway-installation', 'fencer': 'fence-installers',
        'guttering specialist': 'gutter-cleaning-repairs', 'window fitter': 'window-fitters',
        'drainage specialist': 'plumbing-drainage', 'flooring specialist': 'flooring-installation',
        'gardener': 'gardeners', 'tree surgeon': 'tree-surgeon',
        'pest control': 'pest-control', 'gas engineer': 'boiler-installation',
        'bricklayer': 'bricklayers', 'scaffolder': 'scaffolding',
        'cleaner': 'cleaners', 'removals': 'removal-companies',
        'architect': 'architects', 'interior designer': 'interior-design',
        'surveyor': 'surveyors', 'aerial installer': 'aerial-home-cinema-networking',
        'alarm specialist': 'cctv-installation', 'carpet cleaner': 'carpet-cleaning',
        'oven cleaner': 'oven-cleaning', 'window cleaner': 'window-cleaners',
        'chimney sweep': 'chimney-cleaning', 'curtain fitter': 'curtain-fitting',
        'furniture assembler': 'furniture-assembly', 'mobile mechanic': 'mobile-mechanic',
        'garage door installer': 'garage-door-installation',
        'conservatory installer': 'conservatory-installation',
        'rendering specialist': 'rendering',
        'damp proofing specialist': 'damp-proofing',
        'insulation installer': 'insulation',
        'solar panel installer': 'solar-panel-installation',
        'cctv installer': 'cctv-installation', 'extension specialist': 'property-extensions',
        'loft conversion specialist': 'loft-conversion',
        'demolition contractor': 'demolition',
        'swimming pool builder': 'swimming-pools-hot-tubs',
        'hot tub installer': 'swimming-pools-hot-tubs',
        'skip hire': 'skip-hire', 'waste removal': 'waste-removal',
        'photographer': 'photographers', 'videographer': 'videographers',
        'dj': 'dj-hire', 'magician': 'magicians', 'face painter': 'face-painters',
        'caricaturist': 'caricaturists', 'event planner': 'event-planners',
        'wedding planner': 'wedding-planners', 'party planner': 'party-planners',
        'caterer': 'caterers', 'cake maker': 'cake-makers',
        'mobile bar hire': 'mobile-bar-hire', 'marquee hire': 'marquee-hire',
        'bouncy castle hire': 'bouncy-castle-hire', 'photo booth hire': 'photo-booth-hire',
        'venue hire': 'venue-hire', 'balloon decorator': 'balloon-decorators',
        'event decorator': 'event-decorators', 'florist': 'florists',
        'limousine hire': 'limousine-hire', 'live band': 'live-bands',
        'wedding singer': 'wedding-singers', 'string quartet': 'string-quartets',
        'comedian': 'comedians', 'children entertainer': 'childrens-entertainers',
        'toastmaster': 'toastmasters',
        'personal trainer': 'personal-trainers', 'yoga instructor': 'yoga-instructors',
        'pilates instructor': 'pilates-instructors', 'dance teacher': 'dance-teachers',
        'singing teacher': 'singing-teachers', 'piano teacher': 'piano-teachers',
        'guitar teacher': 'guitar-teachers', 'drum teacher': 'drum-teachers',
        'violin teacher': 'violin-teachers', 'music teacher': 'music-teachers',
        'swimming teacher': 'swimming-teachers',
        'driving instructor': 'driving-instructors',
        'maths tutor': 'maths-tutors', 'english tutor': 'english-tutors',
        'science tutor': 'science-tutors', 'language tutor': 'language-tutors',
        'life coach': 'life-coaches', 'business coach': 'business-coaches',
        'martial arts instructor': 'martial-arts-instructors',
        'boxing trainer': 'boxing-trainers', 'golf instructor': 'golf-instructors',
        'tennis coach': 'tennis-coaches', 'football coach': 'football-coaches',
        'makeup artist': 'makeup-artists', 'hair stylist': 'hair-stylists',
        'mobile hairdresser': 'mobile-hairdressers',
        'beauty therapist': 'beauty-therapists',
        'massage therapist': 'massage-therapists',
        'nail technician': 'nail-technicians', 'nutritionist': 'nutritionists',
        'physiotherapist': 'physiotherapists', 'chiropractor': 'chiropractors',
        'osteopath': 'osteopaths', 'acupuncturist': 'acupuncturists',
        'counsellor': 'counsellors', 'tattoo artist': 'tattoo-artists',
        'personal stylist': 'personal-stylists',
        'accountant': 'accountants', 'solicitor': 'solicitors',
        'financial adviser': 'financial-advisers',
        'web designer': 'web-designers', 'graphic designer': 'graphic-designers',
        'logo designer': 'logo-designers', 'seo expert': 'seo-experts',
        'social media manager': 'social-media-managers',
        'copywriter': 'copywriters', 'it support': 'it-support',
        'app developer': 'app-developers', 'bookkeeper': 'bookkeepers',
        'virtual assistant': 'virtual-assistants',
        'business consultant': 'business-consultants',
        'translator': 'translators', 'proofreader': 'proofreaders',
        'dog walker': 'dog-walkers', 'dog groomer': 'dog-groomers',
        'dog trainer': 'dog-trainers', 'pet sitter': 'pet-sitters',
        'mobile dog groomer': 'mobile-dog-groomers', 'cat sitter': 'cat-sitters',
        'man with van': 'man-with-van', 'courier': 'couriers',
        'car transport': 'car-transport',
        'tailor': 'tailors', 'upholsterer': 'upholsterers',
        'furniture restoration': 'furniture-restoration',
        'picture framer': 'picture-framers',
        'locksmith emergency': 'emergency-locksmiths',
        'key cutting': 'key-cutting'
    };
    const lower = trade.toLowerCase();
    return map[lower] || lower.replace(/\s+/g, '-') + 's';
}

// ============================================================
// CSV output
// ============================================================

const CSV_HEADERS = [
    'company_name', 'owner_name', 'trade_type', 'location',
    'website_url', 'overall_rating', 'review_count',
    'phone', 'verification_status', 'services', 'coverage_area',
    'profile_url', 'source_platform'
];

const allLeads = [];
const seenSlugs = new Set();
let totalDuplicates = 0;
let totalRequests = 0;

function saveResults(leads, trade) {
    const tradeSlug = slugify(trade);
    const rows = leads.map(l => ({
        company_name: (l.companyName || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        owner_name: l.ownerName || '',
        trade_type: trade,
        location: l.location || '',
        website_url: l.websiteUrl || '',
        overall_rating: l.overallRating || '',
        review_count: l.reviewCount || '',
        phone: l.phone || '',
        verification_status: l.verificationStatus || '',
        services: l.services || '',
        coverage_area: l.coverageArea || '',
        profile_url: l.profileUrl || '',
        source_platform: 'bark'
    }));
    writeCSV(path.join(CONFIG.outputDir, `bark-${tradeSlug}s.csv`), CSV_HEADERS, rows);
}

function saveDebugHtml(html, label) {
    if (!CONFIG.debugHtml) return;
    ensureDir(CONFIG.debugDir);
    const filename = `${label}-${Date.now()}.html`;
    fs.writeFileSync(path.join(CONFIG.debugDir, filename), html);
    console.log(`    [DEBUG] Saved ${filename}`);
}

// ============================================================
// No session management needed (plain HTTP)
// ============================================================

// ============================================================
// Phase 1: Listing collection (HTTP + cheerio)
// ============================================================

function parseListingPage(html) {
    const $ = cheerio.load(html);
    const traders = [];
    const seen = new Set();

    // Try HTML card selectors -- target actual listing cards, not sub-elements
    const cards = $('.seller-card, .provider-card, .result-card, [class*="ResultCard"], [class*="professional-card"], article.search-result, .search-result');

    cards.each((_, card) => {
        const $card = $(card);
        const link = $card.find('a[href*="/en/"][href*="/company/"], a[href*="/en/"][href*="/b/"]').first();
        if (!link.length) return;

        const href = link.attr('href') || '';
        const fullHref = href.startsWith('http') ? href : `https://www.bark.com${href}`;
        const slugMatch = fullHref.match(/\/company\/([^\/]+)/i) || fullHref.match(/\/b\/[^\/]+\/([^\/]+)/i);
        if (!slugMatch) return;
        const slug = slugMatch[1];
        if (seen.has(slug)) return;
        seen.add(slug);

        const nameEl = $card.find('h2, h3, h4, [class*="name"], [class*="Name"], [class*="title"], [class*="Title"]').first();
        const companyName = nameEl.length ? nameEl.text().trim() : (link.text().trim() || slug.replace(/-/g, ' '));

        // Rating: count star images in the card's review-score section
        const starCount = $card.find('.review-score img.star, .review-score .star').length;
        const ratingMatch = starCount > 0 && starCount <= 5 ? [null, String(starCount)] : null;

        const cardText = $card.text();
        const reviewMatch = cardText.match(/(\d+)\s*reviews?/i);

        const locEl = $card.find('[class*="location"], [class*="Location"], [class*="address"]').first();
        const loc = locEl.length ? locEl.text().trim() : '';

        traders.push({
            companyName,
            slug,
            profileUrl: fullHref.split('?')[0].split('#')[0],
            overallRating: ratingMatch ? ratingMatch[1] : '',
            reviewCount: reviewMatch ? reviewMatch[1] : '',
            location: loc
        });
    });

    // Fallback: find company links inside the directory listing section only
    if (traders.length === 0) {
        const skipSlugs = new Set(['bark-com', 'bark', 'about']);
        $('a[href*="/en/gb/company/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const fullHref = href.startsWith('http') ? href : `https://www.bark.com${href}`;
            const slugMatch = fullHref.match(/\/company\/([^\/]+)/i);
            if (!slugMatch) return;
            const slug = slugMatch[1];
            if (seen.has(slug) || slug.length < 3 || skipSlugs.has(slug)) return;
            seen.add(slug);
            traders.push({
                companyName: $(el).text().trim() || slug.replace(/-/g, ' '),
                slug,
                profileUrl: fullHref.split('?')[0].split('#')[0],
                overallRating: '',
                reviewCount: '',
                location: ''
            });
        });
    }

    return traders;
}

async function scrapeListingPage(barkSlug, location, pageNum) {
    const url = pageNum === 1
        ? `https://www.bark.com/en/gb/${barkSlug}/${location}/`
        : `https://www.bark.com/en/gb/${barkSlug}/${location}/?page=${pageNum}`;

    try {
        let html;
        let usedFlaresolverr = false;

        if (CONFIG.flareSolverrMode) {
            // FlareSolverr mode: use FlareSolverr directly
            console.log(`    Page ${pageNum}: via FlareSolverr`);
            html = await flareSolverrGet(url);
            usedFlaresolverr = true;
        } else {
            html = await httpGet(url);
        }
        totalRequests++;
        saveDebugHtml(html, `listing-${barkSlug}-${location}-p${pageNum}`);

        // Check if we got a challenge page instead of real content
        if (html.includes('Just a moment') || html.includes('Checking your browser') || html.length < 1000) {
            if (!usedFlaresolverr && CONFIG.flareSolverrMode) {
                // Shouldn't happen in flaresolverr mode, but handle it
                console.log(`    Page ${pageNum}: Cloudflare challenge not solved (even via FlareSolverr)`);
            } else {
                console.log(`    Page ${pageNum}: Cloudflare challenge not solved`);
            }
            return { results: [], blocked: true };
        }

        const results = parseListingPage(html);
        return { results, blocked: false };
    } catch (e) {
        console.log(`    Page ${pageNum}: ${e.message}`);
        return { results: [], blocked: e.message.includes('timeout') || e.message.includes('FlareSolverr') };
    }
}

async function scrapeLocation(barkSlug, location) {
    const locationLeads = [];
    let pageNum = 1;
    let emptyPages = 0;
    const maxPages = CONFIG.testMode ? 2 : 20;

    while (pageNum <= maxPages) {
        const { results, blocked } = await scrapeListingPage(barkSlug, location, pageNum);

        if (blocked) {
            let recovered = false;
            for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
                const waitMs = CONFIG.retryWaits[attempt] || CONFIG.retryWaits[CONFIG.retryWaits.length - 1];
                const waitSec = Math.round(waitMs / 1000);
                console.log(`    Blocked at page ${pageNum} -- retry ${attempt + 1}/${CONFIG.maxRetries}, waiting ${waitSec}s`);
                await jitterDelay(waitMs, waitMs + 30000);
                const retry = await scrapeListingPage(barkSlug, location, pageNum);
                if (!retry.blocked && retry.results.length > 0) {
                    let newLeads = 0;
                    for (const r of retry.results) {
                        if (!seenSlugs.has(r.slug)) { seenSlugs.add(r.slug); locationLeads.push(r); newLeads++; }
                        else { totalDuplicates++; }
                    }
                    console.log(`    Page ${pageNum} (retry ${attempt + 1}): ${retry.results.length} found, ${newLeads} new`);
                    recovered = true;
                    break;
                }
            }
            if (!recovered) {
                console.log(`    Still blocked after ${CONFIG.maxRetries} retries, skipping location`);
                break;
            }
        } else if (results.length === 0) {
            emptyPages++;
            if (emptyPages >= CONFIG.maxEmptyPages) break;
        } else {
            emptyPages = 0;
            let newLeads = 0;
            for (const r of results) {
                if (!seenSlugs.has(r.slug)) { seenSlugs.add(r.slug); locationLeads.push(r); newLeads++; }
                else { totalDuplicates++; }
            }
            console.log(`    Page ${pageNum}: ${results.length} found, ${newLeads} new`);
            if (newLeads === 0) break;
        }

        pageNum++;
        await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
    }

    return locationLeads;
}

// ============================================================
// Phase 2: Profile detail scraping (HTTP + cheerio)
// ============================================================

function parseProfilePage(html) {
    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    const result = {
        ownerName: '',
        websiteUrl: '',
        phone: '',
        overallRating: '',
        reviewCount: '',
        verificationStatus: '',
        services: '',
        coverageArea: '',
        location: ''
    };

    // Services
    const serviceEls = $('[class*="service"] li, [class*="Service"] li, [class*="category"] li');
    if (serviceEls.length > 0) {
        result.services = serviceEls.map((_, el) => $(el).text().trim()).get().filter(Boolean).join('; ');
    }

    // Rating from itemprop (most reliable on profile pages)
    const ratingItemprop = $('[itemprop="ratingValue"]').attr('content') || $('[itemprop="ratingValue"]').text().trim();
    if (ratingItemprop && /^[\d.]+$/.test(ratingItemprop)) result.overallRating = ratingItemprop;

    // Review count from itemprop or count review-score divs
    const reviewItemprop = $('[itemprop="reviewCount"]').attr('content') || $('[itemprop="reviewCount"]').text().trim();
    if (reviewItemprop && /^\d+$/.test(reviewItemprop)) {
        result.reviewCount = reviewItemprop;
    } else {
        // Count individual review blocks (each has a review-score div)
        const reviewDivs = $('.review-score').filter((_, el) => $(el).find('img.star').length > 0).length;
        if (reviewDivs > 0) result.reviewCount = String(reviewDivs);
    }

    // Fallback: meta description "X-star rated"
    if (!result.overallRating) {
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const metaMatch = metaDesc.match(/(\d+)-star rated/i);
        if (metaMatch) result.overallRating = metaMatch[1];
    }

    // Fallback: count star images in first review-score div
    if (!result.overallRating) {
        const firstScore = $('.review-score').first();
        const stars = firstScore.find('img.star').length;
        if (stars > 0 && stars <= 5) result.overallRating = String(stars);
    }

    // Location
    const locMatch = bodyText.match(/(?:Based in|Located in|Covers?|Serving)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+){0,3})/);
    if (locMatch) result.location = locMatch[1];

    // Website -- external links
    const skipDomains = ['bark.com', 'bark-com.typeform.com', 'typeform.com', 'onetrust.com',
        'google.com', 'googleapis.com', 'facebook.com', 'twitter.com', 'instagram.com',
        'youtube.com', 'linkedin.com', 'trustpilot.com', 'cloudfront.net', 'amazonaws.com',
        'gstatic.com', 'jsdelivr.net', 'cdnjs.', 'cookielaw.org', 'optanon'];
    $('a[href]').each((_, el) => {
        if (result.websiteUrl) return false; // break on first match
        const href = $(el).attr('href') || '';
        if (href.match(/^https?:\/\//) && !skipDomains.some(d => href.toLowerCase().includes(d))) {
            result.websiteUrl = href;
        }
    });

    // Phone
    const phoneEl = $('a[href^="tel:"]').first();
    if (phoneEl.length) {
        result.phone = phoneEl.attr('href').replace('tel:', '').trim();
    } else {
        const phoneMatch = bodyText.match(/(?:Tel|Phone|Call|Mobile)\s*:?\s*(0\d[\d\s]{8,13})/i);
        if (phoneMatch) result.phone = phoneMatch[1].replace(/\s/g, '');
    }

    // Verification
    const badges = [];
    if (/verified/i.test(bodyText)) badges.push('Verified');
    if (/ID\s*check/i.test(bodyText)) badges.push('ID Checked');
    if (/insurance/i.test(bodyText)) badges.push('Insured');
    if (badges.length > 0) result.verificationStatus = badges.join('; ');

    return result;
}

async function scrapeProfile(lead) {
    try {
        const html = await httpGet(lead.profileUrl);
        totalRequests++;
        saveDebugHtml(html, `profile-${lead.slug}`);

        if (html.includes('Just a moment') || html.includes('Checking your browser') || html.length < 1000) {
            console.log(`    Cloudflare challenge on profile`);
            return lead;
        }

        const data = parseProfilePage(html);

        return {
            ...lead,
            ownerName: data.ownerName || lead.ownerName || '',
            websiteUrl: data.websiteUrl || lead.websiteUrl || '',
            phone: data.phone || lead.phone || '',
            overallRating: data.overallRating || lead.overallRating || '',
            reviewCount: data.reviewCount || lead.reviewCount || '',
            verificationStatus: data.verificationStatus || lead.verificationStatus || '',
            services: data.services || lead.services || '',
            coverageArea: data.coverageArea || lead.coverageArea || '',
            location: data.location || lead.location || ''
        };
    } catch (error) {
        console.log(`    Profile error: ${error.message}`);
        return lead;
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    const tradeSlug = slugify(CONFIG.trade);
    const barkSlug = getBarkTradeSlug(CONFIG.trade);
    const locations = CONFIG.testMode ? ['london'] : UK_LOCATIONS;

    console.log('=== Bark Scraper (Plain HTTP + Cheerio) ===');
    console.log(`Trade: ${CONFIG.trade} (bark slug: ${barkSlug})`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Test mode: ${CONFIG.testMode}`);
    console.log(`Debug HTML: ${CONFIG.debugHtml}`);
    console.log('');

    ensureDir(CONFIG.outputDir);
    ensureDir(CONFIG.logsDir);

    // Validate the trade slug exists on Bark
    try {
        const testHtml = await httpGet(`https://www.bark.com/en/gb/${barkSlug}/london/`);
        if (testHtml.includes('Just a moment') || testHtml.includes('Checking your browser')) {
            console.log(`[WARN] Cloudflare on validation (${testHtml.length} bytes) -- proceeding anyway\n`);
        } else if (testHtml.length < 5000) {
            console.log(`[SKIP] Trade slug "${barkSlug}" returned tiny page (${testHtml.length} bytes) -- likely 404`);
            sendTelegram(`[BARK SKIP] ${CONFIG.trade} -- slug "${barkSlug}" not found on Bark`);
            return;
        } else {
            const testCards = cheerio.load(testHtml)('.seller-card').length;
            console.log(`Slug validated: ${testCards} cards on London test page\n`);
        }
    } catch (e) {
        console.log(`[WARN] Could not validate slug: ${e.message} -- proceeding anyway\n`);
    }

    // Phase 1: Collect listings
    console.log('=== Phase 1: Collecting leads from all locations ===\n');

    let consecutiveEmpty = 0;
    const earlyExitThreshold = 15; // skip trade if 15 consecutive locations yield 0 new leads

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        console.log(`[${i + 1}/${locations.length}] Location: ${location}`);

        const beforeCount = allLeads.length;
        try {
            const leads = await scrapeLocation(barkSlug, location);
            allLeads.push(...leads);
        } catch (error) {
            console.log(`    Error scraping ${location}: ${error.message}`);
        }

        const newFromLocation = allLeads.length - beforeCount;
        consecutiveEmpty = newFromLocation > 0 ? 0 : consecutiveEmpty + 1;

        console.log(`    Total unique: ${allLeads.length} (${totalDuplicates} duplicates skipped)\n`);

        // Early exit: if 15 consecutive locations yield nothing and we have checked at least 15, skip rest
        if (consecutiveEmpty >= earlyExitThreshold && i >= earlyExitThreshold - 1) {
            console.log(`    [EARLY EXIT] ${consecutiveEmpty} consecutive empty locations -- skipping remaining`);
            break;
        }

        if ((i + 1) % 10 === 0) {
            saveResults(allLeads, CONFIG.trade);
        }
    }

    console.log(`\n=== Phase 1 Complete ===`);
    console.log(`Total unique leads: ${allLeads.length}`);
    console.log(`Duplicates skipped: ${totalDuplicates}`);

    const p1Msg = `[BARK P1] ${CONFIG.trade} | ${allLeads.length} unique leads | ${totalDuplicates} dupes`;
    sendTelegram(p1Msg);
    saveResults(allLeads, CONFIG.trade);

    if (allLeads.length === 0) {
        const msg = `[BARK FAILED] ${CONFIG.trade} | No leads collected`;
        console.log(msg);
        sendTelegram(msg);
        return;
    }

    // Phase 2: Profile details
    const p2Msg = `[BARK P2 START] ${CONFIG.trade} | Scraping ${allLeads.length} profiles`;
    console.log(`\n=== Phase 2: Scraping profile details ===\n`);
    sendTelegram(p2Msg);

    const enrichedLeads = [];
    const phase2Start = Date.now();

    for (let i = 0; i < allLeads.length; i++) {
        const lead = allLeads[i];
        console.log(`[${i + 1}/${allLeads.length}] ${lead.companyName}`);

        if ((i + 1) % CONFIG.healthCheckEvery === 0) {
            const elapsed = Math.round((Date.now() - phase2Start) / 60000);
            const rate = elapsed > 0 ? ((i + 1) / elapsed).toFixed(1) : 'N/A';
            const msg = `[HEALTH] Bark ${CONFIG.trade} | ${i + 1}/${allLeads.length} | ${elapsed}min | ${rate}/min`;
            console.log(msg);
            sendTelegram(msg);
        }

        try {
            const enriched = await scrapeProfile(lead);
            enrichedLeads.push(enriched);
        } catch (error) {
            console.log(`    Error: ${error.message}`);
            enrichedLeads.push(lead);
        }

        if ((i + 1) % CONFIG.saveEvery === 0) {
            saveResults(enrichedLeads, CONFIG.trade);
            console.log(`    Progress saved: ${enrichedLeads.length} profiles\n`);
        }

        await jitterDelay(CONFIG.profileDelayMin, CONFIG.profileDelayMax);
    }

    saveResults(enrichedLeads, CONFIG.trade);

    const doneMsg = `[BARK DONE] ${CONFIG.trade}: ${enrichedLeads.length} leads saved to bark-${tradeSlug}s.csv`;
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

main().catch(err => {
    console.error(err);
});
