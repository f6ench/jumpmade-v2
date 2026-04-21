const fs = require('fs');
const path = require('path');
const {
    loadProxies, launchBrowser, newPage,
    sleep, jitterDelay, slugify, csvEscape, writeCSV,
    ensureDir, sendTelegram
} = require('./scraper-base');

// ============================================================
// Config
// ============================================================

const CONFIG = {
    trade: process.argv[2] || 'Plumber',
    testMode: process.argv.includes('--test'),
    outputDir: './output/mybuilder',
    logsDir: './logs',
    proxyFile: process.env.PROXY_FILE || './proxylist.txt',
    browserRotateEvery: 5,
    delayMin: 4000,
    delayMax: 8000,
    profileDelayMin: 5000,
    profileDelayMax: 9000,
    maxEmptyPages: 3,
    healthCheckEvery: 250,
    saveEvery: 50,
    humanTestTimeout: 15000
};

// ============================================================
// Trade category mapping for MyBuilder URLs
// Pattern: /plumbing/plumber-tradespeople/london
//          /{category}/{trade}-tradespeople/{location}
// ============================================================

const TRADE_CATEGORIES = {
    'plumber': { category: 'plumbing', slug: 'plumber' },
    'electrician': { category: 'electrics', slug: 'electrician' },
    'builder': { category: 'extensions', slug: 'builder' },
    'roofer': { category: 'roofing', slug: 'roofer' },
    'painter decorator': { category: 'painting-decorating', slug: 'painter-decorator' },
    'plasterer': { category: 'plastering', slug: 'plasterer' },
    'carpenter': { category: 'carpentry', slug: 'carpenter' },
    'tiler': { category: 'tiling', slug: 'tiler' },
    'handyman': { category: 'handyman', slug: 'handyman' },
    'heating engineer': { category: 'heating', slug: 'heating-engineer' },
    'bathroom fitter': { category: 'bathrooms', slug: 'bathroom-fitter' },
    'kitchen fitter': { category: 'kitchens', slug: 'kitchen-fitter' },
    'landscaper': { category: 'landscaping', slug: 'landscaper' },
    'locksmith': { category: 'locksmith', slug: 'locksmith' },
    'flooring specialist': { category: 'flooring', slug: 'flooring-specialist' },
    'gas engineer': { category: 'gas-work', slug: 'gas-engineer' },
    'driveway specialist': { category: 'driveways', slug: 'driveway-specialist' },
    'fencer': { category: 'fencing', slug: 'fencer' },
    'window fitter': { category: 'windows', slug: 'window-fitter' },
    'bricklayer': { category: 'bricklaying', slug: 'bricklayer' },
    'gardener': { category: 'gardening', slug: 'gardener' },
    'tree surgeon': { category: 'tree-surgery', slug: 'tree-surgeon' },
    'demolition': { category: 'demolition', slug: 'demolition-specialist' },
    'drainage specialist': { category: 'drainage', slug: 'drainage-specialist' },
    'cleaner': { category: 'cleaning', slug: 'cleaner' },
    'pest control': { category: 'pest-control', slug: 'pest-controller' },
    'scaffolder': { category: 'scaffolding', slug: 'scaffolder' },
    'insulation specialist': { category: 'insulation', slug: 'insulation-specialist' },
    'rendering': { category: 'rendering', slug: 'renderer' }
};

function getTradeInfo(trade) {
    const lower = trade.toLowerCase();
    if (TRADE_CATEGORIES[lower]) return TRADE_CATEGORIES[lower];
    // Try matching
    for (const [key, val] of Object.entries(TRADE_CATEGORIES)) {
        if (key.includes(lower) || lower.includes(key)) return val;
    }
    return { category: lower.replace(/\s+/g, '-'), slug: lower.replace(/\s+/g, '-') };
}

// ============================================================
// UK locations
// ============================================================

const UK_LOCATIONS = [
    'london', 'east-london', 'west-london', 'north-london', 'south-london',
    'croydon', 'bromley', 'enfield', 'barnet', 'ealing',
    'brighton', 'reading', 'oxford', 'southampton', 'portsmouth',
    'guildford', 'maidstone', 'canterbury', 'crawley', 'slough',
    'basingstoke', 'chelmsford', 'colchester',
    'bristol', 'bath', 'exeter', 'plymouth', 'bournemouth',
    'swindon', 'gloucester', 'cheltenham',
    'norwich', 'cambridge', 'ipswich', 'peterborough', 'luton',
    'watford', 'bedford', 'milton-keynes', 'northampton',
    'birmingham', 'coventry', 'leicester', 'nottingham', 'derby',
    'wolverhampton', 'stoke-on-trent', 'worcester', 'telford',
    'solihull', 'lincoln', 'mansfield',
    'manchester', 'liverpool', 'bolton', 'stockport', 'wigan',
    'warrington', 'blackpool', 'preston', 'chester', 'salford',
    'newcastle', 'sunderland', 'middlesbrough', 'durham', 'gateshead',
    'leeds', 'sheffield', 'bradford', 'hull', 'york', 'huddersfield',
    'doncaster', 'wakefield', 'harrogate',
    'edinburgh', 'glasgow', 'aberdeen', 'dundee',
    'cardiff', 'swansea', 'newport',
    'belfast', 'derry'
];

// ============================================================
// CSV output
// ============================================================

const CSV_HEADERS = [
    'company_name', 'owner_name', 'trade_type', 'location',
    'website_url', 'overall_rating', 'feedback_pct', 'review_count',
    'years_experience', 'phone', 'verification_status', 'services',
    'profile_url', 'source_platform'
];

const allLeads = [];
const seenSlugs = new Set();
let totalDuplicates = 0;

function saveResults(leads, trade) {
    const tradeSlug = slugify(trade);
    const rows = leads.map(l => ({
        company_name: l.companyName || '',
        owner_name: l.ownerName || '',
        trade_type: trade,
        location: l.location || '',
        website_url: l.websiteUrl || '',
        overall_rating: l.overallRating || '',
        feedback_pct: l.feedbackPct || '',
        review_count: l.reviewCount || '',
        years_experience: l.yearsExperience || '',
        phone: l.phone || '',
        verification_status: l.verificationStatus || '',
        services: l.services || '',
        profile_url: l.profileUrl || '',
        source_platform: 'mybuilder'
    }));
    writeCSV(path.join(CONFIG.outputDir, `mybuilder-${tradeSlug}s.csv`), CSV_HEADERS, rows);
}

// ============================================================
// Human test / CAPTCHA detection
// ============================================================

async function checkForHumanTest(page) {
    const url = page.url();
    if (url.includes('human-test') || url.includes('challenge')) {
        return true;
    }
    const content = await page.content();
    return content.includes('human-test') || content.includes('verify you are human');
}

async function waitForHumanTestResolve(page) {
    // The stealth plugin should prevent most challenges, but if one fires,
    // wait briefly to see if it auto-resolves (some JS challenges do)
    console.log('    Human test detected, waiting for auto-resolve...');
    try {
        await page.waitForNavigation({ timeout: CONFIG.humanTestTimeout, waitUntil: 'networkidle2' });
        const stillBlocked = await checkForHumanTest(page);
        if (stillBlocked) {
            console.log('    Human test did not auto-resolve');
            return false;
        }
        console.log('    Human test resolved');
        return true;
    } catch (e) {
        console.log('    Human test timeout');
        return false;
    }
}

// ============================================================
// Phase 1: Listing collection
// ============================================================

async function scrapeListingPage(page, tradeInfo, location, pageNum) {
    // MyBuilder URL patterns:
    // /{category}/{slug}-tradespeople/{location}?page=N
    // Also try /find-trades/{location}
    const url = `https://www.mybuilder.com/${tradeInfo.category}/${tradeInfo.slug}-tradespeople/${location}${pageNum > 1 ? '?page=' + pageNum : ''}`;

    try {
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        const status = response.status();

        if (status === 403) {
            const isHumanTest = await checkForHumanTest(page);
            if (isHumanTest) {
                const resolved = await waitForHumanTestResolve(page);
                if (!resolved) return { results: [], blocked: true };
            } else {
                console.log(`    Page ${pageNum}: 403 Forbidden`);
                return { results: [], blocked: true };
            }
        }

        if (status === 404) {
            return { results: [], blocked: false };
        }

        await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);

        // Try extracting __NEXT_DATA__ first (Next.js SSR)
        const nextData = await page.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            if (el) {
                try { return JSON.parse(el.textContent); } catch (e) { return null; }
            }
            return null;
        });

        let results = [];

        if (nextData) {
            // Extract from Next.js page props
            try {
                const pageProps = nextData.props?.pageProps;
                const tradespeople = pageProps?.tradespeople || pageProps?.results || pageProps?.traders || [];
                if (Array.isArray(tradespeople)) {
                    for (const tp of tradespeople) {
                        const slug = tp.username || tp.slug || tp.id || tp.profileUrl?.split('/').pop();
                        if (!slug) continue;

                        results.push({
                            companyName: tp.displayName || tp.businessName || tp.name || tp.companyName || '',
                            slug: String(slug),
                            profileUrl: tp.profileUrl
                                ? `https://www.mybuilder.com${tp.profileUrl}`
                                : `https://www.mybuilder.com/profile/view/${slug}`,
                            overallRating: tp.rating != null ? String(tp.rating) : '',
                            feedbackPct: tp.feedbackPercentage != null ? String(tp.feedbackPercentage) : '',
                            reviewCount: tp.feedbackCount != null ? String(tp.feedbackCount) : '',
                            location: tp.location || tp.town || '',
                            yearsExperience: tp.yearsExperience != null ? String(tp.yearsExperience) : '',
                            services: Array.isArray(tp.trades) ? tp.trades.map(t => t.name || t).join('; ') : ''
                        });
                    }
                }
            } catch (e) {
                // Fall through to DOM parsing
            }
        }

        // DOM fallback
        if (results.length === 0) {
            results = await page.evaluate(() => {
                const traders = [];
                const seen = new Set();

                // Find profile links
                const profileLinks = document.querySelectorAll(
                    'a[href*="/profile/view/"], a[href*="/profile/"]'
                );

                for (const link of profileLinks) {
                    const href = link.href;
                    const slugMatch = href.match(/\/profile\/(?:view\/)?([^\/\?#]+)/i);
                    if (!slugMatch) continue;
                    const slug = slugMatch[1];
                    if (seen.has(slug) || slug.length < 2) continue;
                    seen.add(slug);

                    // Find parent card
                    const card = link.closest('article, div[class*="card"], div[class*="Card"], li, section') || link.parentElement;
                    let companyName = '';
                    let rating = '';
                    let feedbackPct = '';
                    let reviewCount = '';
                    let location = '';

                    if (card) {
                        const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="Name"]');
                        if (nameEl) {
                            const txt = nameEl.textContent.trim();
                            // Avoid picking up ratings (pure numbers like "4.9" or "5")
                            if (txt && !/^\d+(\.\d+)?$/.test(txt)) companyName = txt;
                        }

                        const cardText = card.textContent;
                        const feedbackMatch = cardText.match(/(\d+)%\s*(?:Feedback|feedback|positive)/i);
                        if (feedbackMatch) feedbackPct = feedbackMatch[1];

                        const reviewMatch = cardText.match(/(\d+)\s*(?:feedback|reviews?|jobs?\s*done)/i);
                        if (reviewMatch) reviewCount = reviewMatch[1];

                        const locEl = card.querySelector('[class*="location"], [class*="Location"]');
                        if (locEl) location = locEl.textContent.trim();

                        const yearsMatch = cardText.match(/(\d+)\s*years?\s*(?:experience|exp)/i);
                    }

                    if (!companyName || /^\d+(\.\d+)?$/.test(companyName)) {
                        const linkText = link.textContent.trim();
                        companyName = (linkText && !/^\d+(\.\d+)?$/.test(linkText)) ? linkText : slug.replace(/[-_]/g, ' ');
                    }

                    traders.push({
                        companyName,
                        slug,
                        profileUrl: href.split('?')[0].split('#')[0],
                        overallRating: rating,
                        feedbackPct,
                        reviewCount,
                        location,
                        yearsExperience: '',
                        services: ''
                    });
                }

                return traders;
            });
        }

        return { results, blocked: false };
    } catch (e) {
        console.log(`    Page ${pageNum}: ${e.message}`);
        return { results: [], blocked: e.message.includes('net::ERR') || e.message.includes('403') };
    }
}

async function scrapeLocation(browser, tradeInfo, location) {
    const page = await newPage(browser);
    const locationLeads = [];
    let pageNum = 1;
    let emptyPages = 0;
    const maxPages = CONFIG.testMode ? 2 : 30;
    let blocked = false;

    try {
        while (pageNum <= maxPages && !blocked) {
            const { results, blocked: isBlocked } = await scrapeListingPage(page, tradeInfo, location, pageNum);

            if (isBlocked) {
                blocked = true;
                break;
            }

            if (results.length === 0) {
                emptyPages++;
                if (emptyPages >= CONFIG.maxEmptyPages) break;
                pageNum++;
                continue;
            }

            emptyPages = 0;
            let newLeads = 0;

            for (const r of results) {
                if (!seenSlugs.has(r.slug)) {
                    seenSlugs.add(r.slug);
                    locationLeads.push(r);
                    newLeads++;
                } else {
                    totalDuplicates++;
                }
            }

            console.log(`    Page ${pageNum}: ${results.length} found, ${newLeads} new`);
            if (newLeads === 0) break;

            pageNum++;
        }
    } catch (error) {
        console.log(`    Error: ${error.message}`);
    }

    try { await page.close(); } catch (e) {}
    return { leads: locationLeads, blocked };
}

// ============================================================
// Phase 2: Profile detail scraping
// ============================================================

async function scrapeProfile(browser, lead) {
    const page = await newPage(browser);

    try {
        const response = await page.goto(lead.profileUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        if (response.status() === 403) {
            const isHumanTest = await checkForHumanTest(page);
            if (isHumanTest) {
                const resolved = await waitForHumanTestResolve(page);
                if (!resolved) { await page.close(); return lead; }
            } else {
                await page.close();
                return lead;
            }
        }

        await jitterDelay(CONFIG.profileDelayMin, CONFIG.profileDelayMax);

        // Try __NEXT_DATA__ first
        const profileData = await page.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            if (el) {
                try {
                    const data = JSON.parse(el.textContent);
                    const pp = data.props?.pageProps;
                    const profile = pp?.tradesperson || pp?.profile || pp?.trader || pp;
                    if (profile && (profile.displayName || profile.businessName || profile.name)) {
                        return {
                            companyName: profile.displayName || profile.businessName || profile.name || '',
                            ownerName: profile.ownerName || profile.contactName || '',
                            overallRating: profile.rating != null ? String(profile.rating) : '',
                            feedbackPct: profile.feedbackPercentage != null ? String(profile.feedbackPercentage) : '',
                            reviewCount: profile.feedbackCount != null ? String(profile.feedbackCount) : '',
                            location: profile.location || profile.town || profile.area || '',
                            yearsExperience: profile.yearsExperience != null ? String(profile.yearsExperience) : '',
                            services: Array.isArray(profile.trades) ? profile.trades.map(t => t.name || t).join('; ') : '',
                            memberSince: profile.memberSince || profile.joinDate || '',
                            verificationStatus: profile.verified ? 'Verified' : ''
                        };
                    }
                } catch (e) {}
            }
            return null;
        });

        if (profileData) {
            await page.close();
            return {
                ...lead,
                companyName: profileData.companyName || lead.companyName || '',
                ownerName: profileData.ownerName || '',
                overallRating: profileData.overallRating || lead.overallRating || '',
                feedbackPct: profileData.feedbackPct || lead.feedbackPct || '',
                reviewCount: profileData.reviewCount || lead.reviewCount || '',
                location: profileData.location || lead.location || '',
                yearsExperience: profileData.yearsExperience || lead.yearsExperience || '',
                services: profileData.services || lead.services || '',
                verificationStatus: profileData.verificationStatus || ''
            };
        }

        // DOM fallback
        const data = await page.evaluate(() => {
            const result = {
                companyName: '',
                ownerName: '',
                overallRating: '',
                feedbackPct: '',
                reviewCount: '',
                location: '',
                yearsExperience: '',
                services: '',
                verificationStatus: ''
            };

            const bodyText = document.body.innerText;

            // Name from h1
            const h1 = document.querySelector('h1');
            if (h1) result.companyName = h1.textContent.trim();

            // Feedback percentage
            const fbMatch = bodyText.match(/(\d+)%\s*(?:Feedback|feedback|positive)/i);
            if (fbMatch) result.feedbackPct = fbMatch[1];

            // Reviews
            const reviewMatch = bodyText.match(/(\d+)\s*(?:feedback|reviews?)/i);
            if (reviewMatch) result.reviewCount = reviewMatch[1];

            // Experience
            const yearsMatch = bodyText.match(/(\d+)\s*years?\s*(?:experience|exp)/i)
                || bodyText.match(/member\s*since\s*(?:[A-Z][a-z]+\s*)?(\d{4})/i);
            if (yearsMatch) {
                if (yearsMatch[1].length === 4) {
                    result.yearsExperience = String(new Date().getFullYear() - parseInt(yearsMatch[1]));
                } else {
                    result.yearsExperience = yearsMatch[1];
                }
            }

            // Location
            const locMatch = bodyText.match(/(?:based in|located in|works? in)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+){0,3})/i);
            if (locMatch) result.location = locMatch[1];

            // Services / trades
            const tradeEls = document.querySelectorAll('[class*="trade"] li, [class*="skill"] li, [class*="service"] li');
            if (tradeEls.length > 0) {
                result.services = Array.from(tradeEls).map(el => el.textContent.trim()).filter(Boolean).join('; ');
            }

            return result;
        });

        await page.close();

        return {
            ...lead,
            companyName: data.companyName || lead.companyName || '',
            ownerName: data.ownerName || '',
            overallRating: data.overallRating || lead.overallRating || '',
            feedbackPct: data.feedbackPct || lead.feedbackPct || '',
            reviewCount: data.reviewCount || lead.reviewCount || '',
            location: data.location || lead.location || '',
            yearsExperience: data.yearsExperience || lead.yearsExperience || '',
            services: data.services || lead.services || '',
            verificationStatus: data.verificationStatus || ''
        };

    } catch (error) {
        try { await page.close(); } catch (e) {}
        return lead;
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    const tradeSlug = slugify(CONFIG.trade);
    const tradeInfo = getTradeInfo(CONFIG.trade);
    const locations = CONFIG.testMode ? ['london'] : UK_LOCATIONS;

    console.log('=== MyBuilder Scraper (Stealth Mode) ===');
    console.log(`Trade: ${CONFIG.trade} (category: ${tradeInfo.category}, slug: ${tradeInfo.slug})`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Test mode: ${CONFIG.testMode}`);
    console.log('');

    ensureDir(CONFIG.outputDir);
    ensureDir(CONFIG.logsDir);
    loadProxies(CONFIG.proxyFile);

    let browser = await launchBrowser({ stealth: true });
    let consecutiveBlocks = 0;

    // Phase 1: Collect listings
    console.log('=== Phase 1: Collecting leads from all locations ===\n');

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        console.log(`[${i + 1}/${locations.length}] Location: ${location}`);

        if (i > 0 && (i % CONFIG.browserRotateEvery === 0 || consecutiveBlocks > 0)) {
            console.log('    Rotating browser + proxy...');
            try { await browser.close(); } catch (e) {}
            browser = await launchBrowser({ stealth: true });
            if (consecutiveBlocks > 0) {
                await sleep(5000); // Extra cooldown after block
            }
            consecutiveBlocks = 0;
        }

        try {
            const { leads, blocked } = await scrapeLocation(browser, tradeInfo, location);
            allLeads.push(...leads);

            if (blocked) {
                consecutiveBlocks++;
                if (consecutiveBlocks >= 3) {
                    const msg = `[MYBUILDER WARNING] ${CONFIG.trade} | 3 consecutive blocks, pausing 90s + rotating`;
                    console.log(msg);
                    sendTelegram(msg);
                    try { await browser.close(); } catch (e) {}
                    await sleep(90000);
                    browser = await launchBrowser({ stealth: true });
                    consecutiveBlocks = 0;
                }
            } else {
                consecutiveBlocks = 0;
            }
        } catch (error) {
            console.log(`    Error scraping ${location}: ${error.message}`);
        }

        console.log(`    Total unique: ${allLeads.length} (${totalDuplicates} duplicates skipped)\n`);

        if ((i + 1) % 10 === 0) {
            saveResults(allLeads, CONFIG.trade);
        }
    }

    console.log(`\n=== Phase 1 Complete ===`);
    console.log(`Total unique leads: ${allLeads.length}`);
    console.log(`Duplicates skipped: ${totalDuplicates}`);

    const p1Msg = `[MYBUILDER P1] ${CONFIG.trade} | ${allLeads.length} unique leads | ${totalDuplicates} dupes`;
    sendTelegram(p1Msg);
    saveResults(allLeads, CONFIG.trade);

    if (allLeads.length === 0) {
        const msg = `[MYBUILDER FAILED] ${CONFIG.trade} | No leads collected -- CAPTCHA may be blocking`;
        console.log(msg);
        sendTelegram(msg);
        try { await browser.close(); } catch (e) {}
        return;
    }

    // Phase 2: Profile details
    const p2Msg = `[MYBUILDER P2 START] ${CONFIG.trade} | Scraping ${allLeads.length} profiles`;
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
            const msg = `[HEALTH] MyBuilder ${CONFIG.trade} | ${i + 1}/${allLeads.length} | ${elapsed}min | ${rate}/min`;
            console.log(msg);
            sendTelegram(msg);
        }

        if (i > 0 && i % (CONFIG.browserRotateEvery * 8) === 0) {
            console.log('    Rotating browser + proxy...');
            try { await browser.close(); } catch (e) {}
            browser = await launchBrowser({ stealth: true });
        }

        try {
            const enriched = await scrapeProfile(browser, lead);
            enrichedLeads.push(enriched);
        } catch (error) {
            console.log(`    Error: ${error.message}`);
            enrichedLeads.push(lead);
        }

        if ((i + 1) % CONFIG.saveEvery === 0) {
            saveResults(enrichedLeads, CONFIG.trade);
            console.log(`    Progress saved: ${enrichedLeads.length} profiles\n`);
        }
    }

    try { await browser.close(); } catch (e) {}

    saveResults(enrichedLeads, CONFIG.trade);

    const doneMsg = `[MYBUILDER DONE] ${CONFIG.trade}: ${enrichedLeads.length} leads saved to mybuilder-${tradeSlug}s.csv`;
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

main().catch(console.error);
