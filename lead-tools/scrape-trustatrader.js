const fs = require('fs');
const path = require('path');
const {
    loadProxies, launchBrowser, newPage,
    sleep, jitterDelay, slugify, csvEscape, writeCSV, ensureDir, sendTelegram
} = require('./scraper-base');

// ============================================================
// Config
// ============================================================

const CONFIG = {
    trade: process.argv[2] || 'Plumber',
    testMode: process.argv.includes('--test'),
    outputDir: './output/trustatrader',
    logsDir: './logs',
    proxyFile: process.env.PROXY_FILE || './proxylist.txt',
    browserRotateEvery: 10,
    crawlDelayMin: 5000,
    crawlDelayMax: 8000,
    maxEmptyPages: 3,
    healthCheckEvery: 250,
    saveEvery: 50
};

// ============================================================
// UK locations for TrustATrader (city/town names, not postcodes)
// Covers major population centres across UK
// ============================================================

const UK_LOCATIONS = [
    // London boroughs / areas
    'london', 'east-london', 'west-london', 'north-london', 'south-london',
    'central-london', 'croydon', 'bromley', 'enfield', 'barnet', 'ealing',
    'hounslow', 'hillingdon', 'havering', 'redbridge', 'walthamstow',
    'greenwich', 'lewisham', 'southwark', 'lambeth', 'wandsworth',
    'richmond', 'kingston', 'sutton', 'merton', 'bexley', 'dartford',
    // South East
    'brighton', 'reading', 'oxford', 'southampton', 'portsmouth', 'guildford',
    'maidstone', 'canterbury', 'tunbridge-wells', 'crawley', 'slough',
    'woking', 'basingstoke', 'winchester', 'chichester', 'hastings',
    'eastbourne', 'folkestone', 'margate', 'ashford', 'sevenoaks',
    'epsom', 'chelmsford', 'colchester', 'southend-on-sea', 'basildon',
    // South West
    'bristol', 'bath', 'exeter', 'plymouth', 'bournemouth', 'poole',
    'swindon', 'gloucester', 'cheltenham', 'taunton', 'torquay',
    'salisbury', 'yeovil', 'truro', 'penzance', 'barnstaple',
    // East
    'norwich', 'cambridge', 'ipswich', 'peterborough', 'luton',
    'st-albans', 'watford', 'stevenage', 'bedford', 'milton-keynes',
    'northampton', 'wellingborough', 'kings-lynn',
    // Midlands
    'birmingham', 'coventry', 'leicester', 'nottingham', 'derby',
    'wolverhampton', 'stoke-on-trent', 'worcester', 'hereford',
    'telford', 'shrewsbury', 'stafford', 'burton-on-trent', 'nuneaton',
    'solihull', 'walsall', 'dudley', 'redditch', 'rugby',
    'lincoln', 'mansfield', 'chesterfield', 'loughborough',
    // North West
    'manchester', 'liverpool', 'bolton', 'stockport', 'wigan',
    'warrington', 'blackpool', 'preston', 'blackburn', 'burnley',
    'lancaster', 'chester', 'crewe', 'macclesfield', 'oldham',
    'rochdale', 'bury', 'salford', 'st-helens',
    // North East
    'newcastle', 'sunderland', 'middlesbrough', 'durham', 'darlington',
    'hartlepool', 'gateshead', 'south-shields',
    // Yorkshire
    'leeds', 'sheffield', 'bradford', 'hull', 'york', 'huddersfield',
    'doncaster', 'wakefield', 'barnsley', 'rotherham', 'harrogate',
    'scarborough', 'halifax', 'dewsbury', 'grimsby', 'scunthorpe',
    // Scotland
    'edinburgh', 'glasgow', 'aberdeen', 'dundee', 'inverness',
    'stirling', 'perth', 'paisley', 'east-kilbride', 'livingston',
    'dunfermline', 'kirkcaldy', 'ayr', 'falkirk',
    // Wales
    'cardiff', 'swansea', 'newport', 'wrexham', 'bangor',
    'aberystwyth', 'carmarthen', 'llanelli', 'bridgend', 'barry',
    // Northern Ireland
    'belfast', 'derry', 'lisburn', 'newry', 'bangor'
];

// ============================================================
// CSV output
// ============================================================

const CSV_HEADERS = [
    'company_name', 'owner_name', 'trade_type', 'location', 'website_url',
    'overall_rating', 'review_count', 'years_experience',
    'phone', 'verification_status', 'services', 'coverage_area',
    'profile_url', 'source_platform'
];

// Track state
const allLeads = [];
const seenSlugs = new Set();
let totalDuplicates = 0;

function cleanLocation(loc) {
    if (!loc) return '';
    // Fix "ing London" -> "London" (from "Covering/Serving London" text clips)
    return loc.replace(/^(?:cover)?ing\s+/i, '').replace(/^(?:Serv|Cover)ing\s+/i, '').trim();
}

function saveResults(leads, trade) {
    const tradeSlug = slugify(trade);
    const rows = leads.map(l => ({
        company_name: l.companyName || '',
        owner_name: l.ownerName || '',
        trade_type: trade,
        location: cleanLocation(l.location),
        website_url: l.websiteUrl || '',
        overall_rating: l.overallRating || '',
        review_count: l.reviewCount || '',
        years_experience: l.yearsExperience || '',
        phone: l.phone || '',
        verification_status: l.verificationStatus || '',
        services: l.services || '',
        coverage_area: cleanLocation(l.coverageArea),
        profile_url: l.profileUrl || '',
        source_platform: 'trustatrader'
    }));
    writeCSV(path.join(CONFIG.outputDir, `trustatrader-${tradeSlug}s.csv`), CSV_HEADERS, rows);
}

// ============================================================
// TrustATrader URL slug overrides -- maps trade name to exact URL slug
// Only needed where auto-pluralizing (name + 's') doesn't match their URL
const URL_SLUG_MAP = {
    'Plumber': 'plumbers',
    'Builder': 'builders',
    'Electrician': 'electricians',
    'Roofer': 'roofers',
    'Kitchen Fitter': 'kitchen-fitters',
    'Bathroom Fitter': 'bathroom-fitters',
    'Heating Engineer': 'heating-engineers-gas-fitters',
    'Landscape Gardener': 'landscape-gardeners',
    'Painter Decorator': 'painters-decorators',
    'Plasterer': 'plastering-screeding',
    'Carpenter Joiner': 'carpenters-joiners',
    'Tiler': 'tilers',
    'Locksmith': 'locksmith',
    'Handyman': 'handyman',
    'Tree Surgeon': 'tree-surgeons',
    'Flooring Specialist': 'flooring-specialists',
    'Bricklayer': 'bricklaying-masonry',
    'Fencer': 'fencing-contractors',
    'Drainage Specialist': 'drainage-specialists',
    'Driveway Specialist': 'blockpaving-driveways',
    'Guttering Specialist': 'fascias-soffits-guttering',
    'Window Fitter': 'double-glazing',
    'Pest Control': 'pest-control',
    'Damp Proofing': 'damp-proofing',
    'Garage Door Installer': 'garage-door-installers',
    'Conservatory Installer': 'conservatory-installers',
    'Alarm Specialist': 'alarms-security',
    'Aerial Installer': 'aerial-satellite-installation',
    'Rendering': 'rendering',
    'Gas Engineer': 'heating-engineers-gas-fitters',
    'Skip Hire': 'skip-hire',
    'Removal Company': 'removal-companies',
    'Cleaner': 'cleaning-domestic-commercial',
    'Garden Designer': 'garden-maintenance',
    'Paving Specialist': 'blockpaving-driveways',
    'Stonemason': 'bricklaying-masonry',
    'Extension Specialist': 'extension-specialists',
    'Loft Conversion': 'loft-rooms-conversions',
    'Carpet Fitter': 'carpet-fitters',
    'Carpet Upholstery Cleaning': 'carpet-upholstery-cleaning',
    'Double Glazing': 'double-glazing',
    'Double Glazing Repair': 'double-glazing-repairs',
    'Door Installer': 'door-installers',
    'Domestic Appliance Repair': 'domestic-appliance-repairs',
    'Driveway Patio Cleaning': 'driveway-patio-cleaning',
    'Electric Car Charger Installer': 'electric-car-charger-installers',
    'Electrical Inspection': 'electrical-inspection-testing',
    'Exterior Wall Coating': 'exterior-wall-coating',
    'Garden Clearance': 'garden-clearance',
    'Garden Maintenance': 'garden-maintenance',
    'Garden Room': 'garden-room',
    'Garage Conversion Specialist': 'garage-conversion-specialists',
    'Garage Mechanic': 'garage-mechanics',
    'Ground Work Demolition': 'ground-work-demolition',
    'Home Improvement': 'home-improvements',
    'Artificial Grass Installation': 'artificial-grass-installation',
    'Pointing Specialist': 'pointing-specialists',
    'Property Maintenance': 'property-maintenance',
    'Resin Bonded Driveway': 'resin-bonded-driveway-specialists',
    'Roof Cleaning': 'roof-cleaning',
    'Soundproofing Specialist': 'soundproofing-specialist',
    'Structural Engineer': 'structural-engineer',
    'Tarmacing': 'tarmacing',
    'Underfloor Heating Specialist': 'underfloor-heating-specialists',
    'Wood Stove Installer': 'wood-stove-installers',
    'Window Cleaner': 'window-cleaners',
    'CCTV Installation': 'cctv-installations',
    'Oven Repair': 'oven-repair',
    'Fitted Wardrobe Company': 'fitted-wardrobe-companies',
    'Spray Foam Removal': 'spray-foam-removal',
    'Garden Office Builder': 'garden-office-builders',
    'Architectural Service': 'architectural-services',
    'Park Home Specialist': 'park-home-specialists',
    'Computer Repair': 'computer-repairs-servicing',
    'Energy Assessor': 'energy-assessor',
    'Damp Surveyor': 'damp-surveyor',
    'Mobile Mechanic': 'mobile-mechanics'
};

function getUrlSlug(trade) {
    return URL_SLUG_MAP[trade] || trade.toLowerCase().replace(/\s+/g, '-') + 's';
}

// ============================================================
// Phase 1: Listing collection
// ============================================================

async function scrapeListingPage(page, trade, location, pageNum) {
    const tradeSlug = getUrlSlug(trade);
    const url = pageNum === 1
        ? `https://www.trustatrader.com/${tradeSlug}-in-${location}`
        : `https://www.trustatrader.com/${tradeSlug}-in-${location}?page=${pageNum}`;

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await jitterDelay(CONFIG.crawlDelayMin, CONFIG.crawlDelayMax);
    } catch (e) {
        console.log(`    Page ${pageNum}: Failed to load -- ${e.message}`);
        return [];
    }

    const results = await page.evaluate(() => {
        const traders = [];

        // Look for trader listing cards
        const cards = document.querySelectorAll(
            'a[href*="/traders/"], a[href*="/search-by-name/"], .trader-card, .search-result, [class*="TraderCard"], [class*="trader-card"]'
        );

        const seen = new Set();

        // Try structured card extraction first
        const cardContainers = document.querySelectorAll(
            'article, .trader-card, .search-result, [class*="TraderCard"], [class*="trader-card"], [class*="result-card"], [class*="ResultCard"]'
        );

        for (const card of cardContainers) {
            const link = card.querySelector('a[href*="/traders/"], a[href*="/search-by-name/"]');
            if (!link) continue;

            const href = link.href;
            const slug = href.split('/traders/')[1]?.split('?')[0]?.split('#')[0]
                || href.split('/search-by-name/')[1]?.split('?')[0]?.split('#')[0];
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);

            const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="Name"], [class*="title"], [class*="Title"]');
            const companyName = nameEl ? nameEl.textContent.trim() : (link.textContent.trim() || slug.replace(/-/g, ' '));

            // Rating
            const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"], [class*="score"], [class*="Score"]');
            const ratingText = ratingEl ? ratingEl.textContent.trim() : '';
            const ratingMatch = ratingText.match(/([\d.]+)/);

            // Reviews
            const reviewEl = card.querySelector('[class*="review"], [class*="Review"]');
            const reviewText = reviewEl ? reviewEl.textContent.trim() : card.textContent;
            const reviewMatch = reviewText.match(/(\d+)\s*reviews?/i);

            // Phone
            const phoneEl = card.querySelector('a[href^="tel:"]');
            const phone = phoneEl ? phoneEl.href.replace('tel:', '').trim() : '';

            // Location
            const locEl = card.querySelector('[class*="location"], [class*="Location"], [class*="area"], [class*="Area"]');
            const loc = locEl ? locEl.textContent.trim() : '';

            traders.push({
                companyName,
                slug,
                profileUrl: href.split('?')[0].split('#')[0],
                overallRating: ratingMatch ? ratingMatch[1] : '',
                reviewCount: reviewMatch ? reviewMatch[1] : '',
                phone,
                location: loc
            });
        }

        // Fallback: find any trader links not yet captured
        if (traders.length === 0) {
            const allLinks = document.querySelectorAll('a[href*="/traders/"], a[href*="/search-by-name/"]');
            for (const link of allLinks) {
                const href = link.href;
                const slug = href.split('/traders/')[1]?.split('?')[0]?.split('#')[0]
                    || href.split('/search-by-name/')[1]?.split('?')[0]?.split('#')[0];
                if (!slug || seen.has(slug) || slug.length < 3) continue;
                seen.add(slug);

                traders.push({
                    companyName: link.textContent.trim() || slug.replace(/-/g, ' '),
                    slug,
                    profileUrl: href.split('?')[0].split('#')[0],
                    overallRating: '',
                    reviewCount: '',
                    phone: '',
                    location: ''
                });
            }
        }

        return traders;
    });

    return results;
}

async function scrapeLocation(browser, trade, location) {
    const page = await newPage(browser);
    const locationLeads = [];
    let pageNum = 1;
    let emptyPages = 0;
    const maxPages = CONFIG.testMode ? 2 : 50;

    try {
        while (pageNum <= maxPages) {
            const results = await scrapeListingPage(page, trade, location, pageNum);

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

            if (newLeads === 0) {
                // All duplicates -- likely exhausted this location
                break;
            }

            pageNum++;
        }
    } catch (error) {
        console.log(`    Error: ${error.message}`);
    }

    try { await page.close(); } catch (e) {}
    return locationLeads;
}

// ============================================================
// Phase 2: Profile detail scraping
// ============================================================

async function scrapeProfile(browser, lead) {
    const page = await newPage(browser);

    try {
        await page.goto(lead.profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await jitterDelay(CONFIG.crawlDelayMin, CONFIG.crawlDelayMax);

        const data = await page.evaluate(() => {
            const result = {
                ownerName: '',
                yearsExperience: '',
                websiteUrl: '',
                phone: '',
                verificationStatus: '',
                services: '',
                coverageArea: '',
                overallRating: '',
                reviewCount: ''
            };

            const bodyText = document.body.innerText;

            // Owner name
            const ownerMatch = bodyText.match(/(?:Owner|Director|Proprietor|Run by|Contact)\s*:?\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/);
            if (ownerMatch) result.ownerName = ownerMatch[1];

            // Years experience
            const yearsMatch = bodyText.match(/(\d+)\s*years?\s*(?:experience|trading|in\s*business|established)/i);
            if (yearsMatch) result.yearsExperience = yearsMatch[1];
            else {
                const estMatch = bodyText.match(/(?:established|since|trading since)\s*(\d{4})/i);
                if (estMatch) {
                    const years = new Date().getFullYear() - parseInt(estMatch[1]);
                    if (years > 0 && years < 100) result.yearsExperience = String(years);
                }
            }

            // Website
            const skipDomains = ['trustatrader', 'google.com', 'googleapis.com', 'gstatic.com', 'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com', 'trustpilot.com', 'cloudfront.net', 'amazonaws.com', 'jsdelivr.net', 'jquery', 'bootstrap', 'cdnjs.'];
            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            for (const a of allLinks) {
                const href = a.href;
                if (href.match(/^https?:\/\//) && !skipDomains.some(d => href.toLowerCase().includes(d))) {
                    result.websiteUrl = href;
                    break;
                }
            }

            // Phone
            const phoneEl = document.querySelector('a[href^="tel:"]');
            if (phoneEl) {
                result.phone = phoneEl.href.replace('tel:', '').trim();
            } else {
                const phoneMatch = bodyText.match(/(?:Tel|Phone|Call|Mobile)\s*:?\s*(0\d[\d\s]{8,13})/i);
                if (phoneMatch) result.phone = phoneMatch[1].replace(/\s/g, '');
            }

            // Rating
            const ratingMatch = bodyText.match(/([\d.]+)\s*(?:\/\s*5|out\s*of\s*5|stars?)/i)
                || bodyText.match(/Average\s*(?:rating|score)\s*:?\s*([\d.]+)/i);
            if (ratingMatch) result.overallRating = ratingMatch[1];

            // Reviews
            const reviewMatch = bodyText.match(/(\d+)\s*reviews?/i);
            if (reviewMatch) result.reviewCount = reviewMatch[1];

            // Verification
            const verified = bodyText.match(/(?:ID\s*Checked|Vetted|Verified|Insurance\s*Verified|Qualifications?\s*Checked)/gi);
            if (verified) result.verificationStatus = [...new Set(verified.map(v => v.trim()))].join('; ');

            // Services
            const serviceEls = document.querySelectorAll('[class*="service"] li, [class*="Service"] li, [class*="trade"] li');
            if (serviceEls.length > 0) {
                result.services = Array.from(serviceEls).map(el => el.textContent.trim()).filter(Boolean).join('; ');
            }

            // Coverage area
            const coverageMatch = bodyText.match(/(?:Covers?|Covering|Serving|Areas?\s*covered)\s*:?\s*([^\n.]{5,100})/i);
            if (coverageMatch) result.coverageArea = coverageMatch[1].trim();

            return result;
        });

        await page.close();

        // Merge profile data with listing data (profile data takes priority where non-empty)
        return {
            ...lead,
            ownerName: data.ownerName || lead.ownerName || '',
            yearsExperience: data.yearsExperience || lead.yearsExperience || '',
            websiteUrl: data.websiteUrl || lead.websiteUrl || '',
            phone: data.phone || lead.phone || '',
            verificationStatus: data.verificationStatus || '',
            services: data.services || '',
            coverageArea: data.coverageArea || '',
            overallRating: data.overallRating || lead.overallRating || '',
            reviewCount: data.reviewCount || lead.reviewCount || '',
            location: lead.location || data.coverageArea || ''
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
    const locations = CONFIG.testMode ? ['london'] : UK_LOCATIONS;

    console.log('=== TrustATrader Scraper ===');
    console.log(`Trade: ${CONFIG.trade} (slug: ${tradeSlug})`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Test mode: ${CONFIG.testMode}`);
    console.log('');

    ensureDir(CONFIG.outputDir);
    ensureDir(CONFIG.logsDir);
    loadProxies(CONFIG.proxyFile);

    let browser = await launchBrowser();

    // Phase 1: Collect listings
    console.log('=== Phase 1: Collecting leads from all locations ===\n');

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        console.log(`[${i + 1}/${locations.length}] Location: ${location}`);

        // Rotate browser every N locations
        if (i > 0 && i % CONFIG.browserRotateEvery === 0) {
            console.log('    Rotating browser + proxy...');
            try { await browser.close(); } catch (e) {}
            browser = await launchBrowser();
        }

        try {
            const leads = await scrapeLocation(browser, CONFIG.trade, location);
            allLeads.push(...leads);
        } catch (error) {
            console.log(`    Error scraping ${location}: ${error.message}`);
        }

        console.log(`    Total unique: ${allLeads.length} (${totalDuplicates} duplicates skipped)\n`);

        // Save progress every 10 locations
        if ((i + 1) % 10 === 0) {
            saveResults(allLeads, CONFIG.trade);
        }
    }

    console.log(`\n=== Phase 1 Complete ===`);
    console.log(`Total unique leads: ${allLeads.length}`);
    console.log(`Duplicates skipped: ${totalDuplicates}`);

    const p1Msg = `[TRUSTATRADER P1] ${CONFIG.trade} | ${allLeads.length} unique leads | ${totalDuplicates} dupes`;
    sendTelegram(p1Msg);
    saveResults(allLeads, CONFIG.trade);

    // Phase 2: Profile details
    const p2Msg = `[TRUSTATRADER P2 START] ${CONFIG.trade} | Scraping ${allLeads.length} profiles`;
    console.log(`\n=== Phase 2: Scraping profile details ===\n`);
    sendTelegram(p2Msg);

    const enrichedLeads = [];
    const phase2Start = Date.now();

    for (let i = 0; i < allLeads.length; i++) {
        const lead = allLeads[i];
        console.log(`[${i + 1}/${allLeads.length}] ${lead.companyName}`);

        // Health check
        if ((i + 1) % CONFIG.healthCheckEvery === 0) {
            const elapsed = Math.round((Date.now() - phase2Start) / 60000);
            const rate = elapsed > 0 ? ((i + 1) / elapsed).toFixed(1) : 'N/A';
            const msg = `[HEALTH] TrustATrader ${CONFIG.trade} | ${i + 1}/${allLeads.length} | ${elapsed}min | ${rate}/min`;
            console.log(msg);
            sendTelegram(msg);

            if (!browser.isConnected()) {
                console.log('    Browser disconnected, relaunching...');
                sendTelegram(`[RECONNECT] TrustATrader ${CONFIG.trade} | Browser disconnected`);
                browser = await launchBrowser();
            }
        }

        // Rotate browser periodically in phase 2
        if (i > 0 && i % (CONFIG.browserRotateEvery * 25) === 0) {
            console.log('    Rotating browser + proxy...');
            try { await browser.close(); } catch (e) {}
            browser = await launchBrowser();
        }

        try {
            const enriched = await scrapeProfile(browser, lead);
            enrichedLeads.push(enriched);
        } catch (error) {
            console.log(`    Error: ${error.message}`);
            enrichedLeads.push(lead);
        }

        // Save periodically
        if ((i + 1) % CONFIG.saveEvery === 0) {
            saveResults(enrichedLeads, CONFIG.trade);
            console.log(`    Progress saved: ${enrichedLeads.length} profiles\n`);
        }
    }

    try { await browser.close(); } catch (e) {}

    // Final save
    saveResults(enrichedLeads, CONFIG.trade);

    const doneMsg = `[TRUSTATRADER DONE] ${CONFIG.trade}: ${enrichedLeads.length} leads saved to trustatrader-${tradeSlug}s.csv`;
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

main().catch(console.error);
