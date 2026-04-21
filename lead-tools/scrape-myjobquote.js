const fs = require('fs');
const path = require('path');
const {
    httpGet, sleep, jitterDelay, slugify, csvEscape, writeCSV,
    ensureDir, sendTelegram
} = require('./scraper-base');

// ============================================================
// Config
// ============================================================

const CONFIG = {
    trade: process.argv[2] || 'plumber',
    testMode: process.argv.includes('--test'),
    outputDir: './output/myjobquote',
    logsDir: './logs',
    delayMin: 1000,
    delayMax: 2000,
    profileDelayMin: 1500,
    profileDelayMax: 3000,
    healthCheckEvery: 250,
    saveEvery: 50
};

// ============================================================
// Trade slug mapping
// ============================================================

const TRADE_SLUGS = {
    'plumber': 'Plumber',
    'builder': 'Builder',
    'electrician': 'Electrician',
    'roofer': 'Roofer',
    'bathroom': 'Bathroom Fitter',
    'kitchen': 'Kitchen Fitter',
    'heating-engineer': 'Heating Engineer',
    'gas-boiler': 'Gas Boiler',
    'gardener': 'Gardener',
    'painters-decorators': 'Painter Decorator',
    'plasterers-renderers': 'Plasterer',
    'carpenter-and-joiner': 'Carpenter',
    'tiler': 'Tiler',
    'locksmith': 'Locksmith',
    'handyman': 'Handyman',
    'driveway': 'Driveway Specialist',
    'fencing-and-gates': 'Fencing',
    'guttering-and-rainwater-pipe': 'Guttering',
    'windows-conservatories': 'Window Fitter',
    'flooring': 'Flooring Specialist',
    'tree-surgeon': 'Tree Surgeon',
    'bricklayer': 'Bricklayer',
    'extension': 'Extension Builder',
    'loft-conversion': 'Loft Conversion',
    'chimney-building-and-repair': 'Chimney Specialist',
    'cleaner': 'Cleaner',
    'flat-roof': 'Flat Roof',
    'fascias-and-soffits-and-cladding-upvc': 'Fascias Soffits Cladding',
    'garage-conversion': 'Garage Conversion',
    'garage-and-outbuilding-construction': 'Garage Outbuilding',
    'garden-clearance': 'Garden Clearance',
    'garden-maintenance': 'Garden Maintenance',
    'garden-shed-and-playhouse': 'Garden Shed Playhouse',
    'gas-fire': 'Gas Fire',
    'gas-ovens-and-hob': 'Gas Ovens Hob',
    'hard-landscaping': 'Hard Landscaping',
    'internal-renovation-and-reconfiguration': 'Internal Renovation',
    'laminate-flooring': 'Laminate Flooring',
    'lawns-turfing-and-seeding': 'Lawns Turfing Seeding',
    'pebble-dashing': 'Pebble Dashing',
    'porch-specialists': 'Porch Specialist',
    'power-showers-and-pump': 'Power Showers Pump',
    'radiator': 'Radiator',
    'staircases-wooden': 'Wooden Staircases',
    'tarmacing-a-driveway': 'Tarmac Driveway',
    'underpinning-and-foundation': 'Underpinning Foundation',
    'wooden-decking': 'Wooden Decking',
    'wooden-doors': 'Wooden Doors',
    'flat-pack-furniture-assembly': 'Flat Pack Assembly',
    'carpet-laying': 'Carpet Laying'
};

function getTradeSlug(input) {
    const lower = input.toLowerCase().replace(/\s+/g, '-');
    if (TRADE_SLUGS[lower]) return lower;
    for (const [slug, name] of Object.entries(TRADE_SLUGS)) {
        if (name.toLowerCase() === input.toLowerCase()) return slug;
        if (slug.includes(lower) || lower.includes(slug)) return slug;
    }
    return lower;
}

// ============================================================
// UK locations for MyJobQuote
// ============================================================

const UK_LOCATIONS = [
    // London
    'london', 'east-london', 'west-london', 'north-london', 'south-london',
    'croydon', 'bromley', 'enfield', 'barnet', 'ealing',
    'hounslow', 'greenwich', 'lewisham', 'wandsworth', 'kingston', 'sutton',
    // South East
    'brighton', 'reading', 'oxford', 'southampton', 'portsmouth',
    'guildford', 'maidstone', 'canterbury', 'crawley', 'slough',
    'basingstoke', 'winchester', 'chichester', 'eastbourne', 'ashford',
    'chelmsford', 'colchester', 'southend-on-sea', 'basildon',
    // South West
    'bristol', 'bath', 'exeter', 'plymouth', 'bournemouth',
    'swindon', 'gloucester', 'cheltenham', 'taunton', 'salisbury', 'truro',
    // East
    'norwich', 'cambridge', 'ipswich', 'peterborough', 'luton',
    'st-albans', 'watford', 'stevenage', 'bedford', 'milton-keynes', 'northampton',
    // Midlands
    'birmingham', 'coventry', 'leicester', 'nottingham', 'derby',
    'wolverhampton', 'stoke-on-trent', 'worcester', 'telford',
    'stafford', 'solihull', 'walsall', 'lincoln', 'mansfield',
    // North West
    'manchester', 'liverpool', 'bolton', 'stockport', 'wigan',
    'warrington', 'blackpool', 'preston', 'chester', 'oldham', 'rochdale', 'salford',
    // North East
    'newcastle', 'sunderland', 'middlesbrough', 'durham', 'darlington', 'gateshead',
    // Yorkshire
    'leeds', 'sheffield', 'bradford', 'hull', 'york', 'huddersfield',
    'doncaster', 'wakefield', 'barnsley', 'rotherham', 'harrogate', 'halifax', 'grimsby',
    // Scotland
    'edinburgh', 'glasgow', 'aberdeen', 'dundee', 'inverness',
    'stirling', 'perth', 'paisley', 'dunfermline', 'falkirk',
    // Wales
    'cardiff', 'swansea', 'newport', 'wrexham', 'bangor',
    // Northern Ireland
    'belfast', 'derry', 'lisburn', 'newry'
];

// ============================================================
// CSV output
// ============================================================

const CSV_HEADERS = [
    'company_name', 'owner_name', 'trade_type', 'location',
    'website_url', 'overall_rating', 'review_count',
    'phone', 'verification_status', 'services', 'coverage_area',
    'member_since', 'profile_url', 'source_platform'
];

const allLeads = [];
const seenSlugs = new Set();
let totalDuplicates = 0;

function saveResults(leads, trade) {
    const tradeSlug = slugify(trade);
    const rows = leads.map(l => ({
        company_name: l.companyName || '',
        owner_name: l.ownerName || '',
        trade_type: TRADE_SLUGS[getTradeSlug(trade)] || trade,
        location: l.location || '',
        website_url: l.websiteUrl || '',
        overall_rating: l.overallRating || '',
        review_count: l.reviewCount || '',
        phone: l.phone || '',
        verification_status: l.verificationStatus || '',
        services: l.services || '',
        coverage_area: l.coverageArea || '',
        member_since: l.memberSince || '',
        profile_url: l.profileUrl || '',
        source_platform: 'myjobquote'
    }));
    writeCSV(path.join(CONFIG.outputDir, `myjobquote-${tradeSlug}s.csv`), CSV_HEADERS, rows);
}

// ============================================================
// HTML parsing for listing API response
// The API returns { trades: "<html>", total: N, count: N, has_more: 1 }
// ============================================================

function parseListingHTML(htmlStr) {
    const results = [];

    // Links are full URLs: href="https://www.myjobquote.co.uk/t/{slug}"
    const linkRegex = /href=["']https?:\/\/www\.myjobquote\.co\.uk\/t\/([^"']+)["']/g;
    let linkMatch;
    const slugs = new Set();

    while ((linkMatch = linkRegex.exec(htmlStr)) !== null) {
        const slug = linkMatch[1];
        if (slugs.has(slug)) continue;
        slugs.add(slug);

        const result = {
            slug,
            profileUrl: `https://www.myjobquote.co.uk/t/${slug}`,
            companyName: '',
            overallRating: '',
            reviewCount: '',
            location: '',
            verificationStatus: '',
            memberSince: ''
        };

        // Get context around this link
        const idx = htmlStr.indexOf(`/t/${slug}`);
        const start = Math.max(0, idx - 2000);
        const end = Math.min(htmlStr.length, idx + 2000);
        const context = htmlStr.substring(start, end);

        // Company name -- from trade-name div or itemprop="name"
        const tradeNameMatch = context.match(/class="trade-name"[^>]*(?:itemprop=["']name["'])?[^>]*>(?:<a[^>]*>)?([^<]+)/i);
        const nameContent = tradeNameMatch || context.match(/itemprop=["']name["'][^>]*>(?:<a[^>]*>)?([^<]+)/i);
        if (nameContent) result.companyName = nameContent[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

        // Rating -- itemprop="ratingValue" content attribute
        const ratingContent = context.match(/itemprop=["']ratingValue["']\s*content=["']([^"']+)["']/i);
        if (ratingContent) result.overallRating = ratingContent[1].trim();
        else {
            const ratingText = context.match(/(\d\.?\d?)\s*rating/i);
            if (ratingText) result.overallRating = ratingText[1];
        }

        // Review count -- itemprop="reviewCount" content attribute
        const reviewContent = context.match(/itemprop=["']reviewCount["']\s*content=["']([^"']+)["']/i);
        if (reviewContent) result.reviewCount = reviewContent[1].trim();
        else {
            const reviewText = context.match(/(\d+)\s*reviews?/i);
            if (reviewText) result.reviewCount = reviewText[1];
        }

        // Location from address
        const locMatch = context.match(/itemprop=["']addressLocality["'][^>]*>([^<]+)/i);
        if (locMatch) result.location = locMatch[1].trim();

        // Verification badges
        const badges = [];
        if (/ID\s*Check/i.test(context)) badges.push('ID Checked');
        if (/Public\s*liability/i.test(context)) badges.push('Public Liability Insurance');
        if (badges.length > 0) result.verificationStatus = badges.join('; ');

        // Member since
        const memberMatch = context.match(/Member\s*since\s*:?\s*([A-Z][a-z]+\s*\d{4})/i);
        if (memberMatch) result.memberSince = memberMatch[1];

        // Fallback name from slug
        if (!result.companyName) {
            result.companyName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }

        results.push(result);
    }

    return results;
}

// ============================================================
// Phase 1: Listing collection via API
// ============================================================

async function scrapeListings(tradeSlug, location, maxPages) {
    const locationLeads = [];
    let page = 1;
    let emptyPages = 0;

    while (page <= maxPages) {
        const apiUrl = `https://www.myjobquote.co.uk/api/directory-service/trades?url=${tradeSlug}/${location}&page=${page}`;

        try {
            const resp = await httpGet(apiUrl, {
                headers: {
                    'Accept': 'application/json, text/html, */*',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `https://www.myjobquote.co.uk/${tradeSlug}/${location}`
                }
            });

            if (resp.status !== 200) {
                console.log(`    Page ${page}: HTTP ${resp.status}`);
                emptyPages++;
                if (emptyPages >= 3) break;
                page++;
                await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
                continue;
            }

            let data;
            try {
                data = JSON.parse(resp.body);
            } catch (e) {
                console.log(`    Page ${page}: Invalid JSON`);
                emptyPages++;
                if (emptyPages >= 3) break;
                page++;
                continue;
            }

            if (!data.trades || data.count === 0) {
                emptyPages++;
                if (emptyPages >= 3) break;
                page++;
                await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
                continue;
            }

            emptyPages = 0;
            const results = parseListingHTML(data.trades);

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

            console.log(`    Page ${page}: ${results.length} found, ${newLeads} new (total API: ${data.total || '?'})`);

            if (newLeads === 0 || !data.has_more) break;

            page++;
            await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);

        } catch (e) {
            console.log(`    Page ${page}: ${e.message}`);
            emptyPages++;
            if (emptyPages >= 3) break;
            page++;
            await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
        }
    }

    return locationLeads;
}

// ============================================================
// Phase 2: Profile detail scraping
// ============================================================

function extractProfileData(html) {
    const data = {
        companyName: '',
        ownerName: '',
        overallRating: '',
        reviewCount: '',
        location: '',
        postcode: '',
        phone: '',
        websiteUrl: '',
        verificationStatus: '',
        services: '',
        coverageArea: '',
        memberSince: '',
        businessType: ''
    };

    // Phone -- tel: link
    const telMatch = html.match(/href=["']tel:([^"']+)/);
    if (telMatch) data.phone = telMatch[1].trim();

    // Website -- external link (filter out review sites and social media)
    const skipDomains = ['myjobquote', 'reviews.co.uk', 'trustpilot', 'google.com', 'googleapis.com', 'gstatic.com', 'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com', 'reviews.io', 'amazonaws.com', 's3.eu-west', 'cloudfront.net', 'jsdelivr.net', 'cdnjs.', 'jquery', 'bootstrap'];
    const websiteRegex = /href=["'](https?:\/\/[^"']+)["'][^>]*(?:target=["']_blank|rel=["'][^"]*nofollow)/gi;
    let wsMatch;
    while ((wsMatch = websiteRegex.exec(html)) !== null) {
        const url = wsMatch[1];
        const isSkip = skipDomains.some(d => url.toLowerCase().includes(d));
        if (!isSkip) {
            data.websiteUrl = url;
            break;
        }
    }

    // Company name from title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
        const title = titleMatch[1].replace(/\s*[\|].*$/, '').replace(/\s*-\s*MyJobQuote.*$/i, '').trim();
        if (title) data.companyName = title;
    }

    // Schema.org data
    const nameMatch = html.match(/itemprop=["']name["'][^>]*>([^<]+)/i);
    if (nameMatch) data.companyName = nameMatch[1].trim();

    // Rating
    const ratingMatch = html.match(/itemprop=["']ratingValue["'][^>]*>([^<]+)/i)
        || html.match(/(\d\.?\d?)\s*(?:\/\s*5|out of 5)/i);
    if (ratingMatch) data.overallRating = ratingMatch[1].trim();

    // Reviews
    const reviewMatch = html.match(/itemprop=["']reviewCount["'][^>]*>([^<]+)/i)
        || html.match(/(\d+)\s*reviews?/i);
    if (reviewMatch) data.reviewCount = reviewMatch[1].trim();

    // Location
    const locMatch = html.match(/itemprop=["']addressLocality["'][^>]*>([^<]+)/i);
    if (locMatch) data.location = locMatch[1].trim();

    const postcodeMatch = html.match(/itemprop=["']postalCode["'][^>]*>([^<]+)/i);
    if (postcodeMatch) data.postcode = postcodeMatch[1].trim();

    // Business type
    const bizMatch = html.match(/(?:Business\s*type|Company\s*type)\s*:?\s*<[^>]*>([^<]+)/i);
    if (bizMatch) data.businessType = bizMatch[1].trim();

    // Established / Member since
    const estMatch = html.match(/(?:Established|Member\s*since)\s*:?\s*<[^>]*>([^<]+)/i)
        || html.match(/(?:Established|Member\s*since)\s*:?\s*([A-Z][a-z]+\s*\d{4}|\d{4})/i);
    if (estMatch) data.memberSince = estMatch[1].trim();

    // Verification badges
    const badges = [];
    if (/ID\s*Check/i.test(html)) badges.push('ID Checked');
    if (/Public\s*liability\s*insurance/i.test(html)) badges.push('Public Liability Insurance');
    if (/Qualifications?\s*verified/i.test(html)) badges.push('Qualifications Verified');
    if (badges.length > 0) data.verificationStatus = badges.join('; ');

    // Services -- look for trade/service list items
    const serviceMatches = html.match(/<li[^>]*class="[^"]*(?:service|trade|skill)[^"]*"[^>]*>([^<]+)<\/li>/gi);
    if (serviceMatches) {
        data.services = serviceMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('; ');
    }

    // Qualifications
    const qualMatch = html.match(/(?:Qualifications?|Accreditations?)\s*:?\s*<[^>]*>([\s\S]{5,200}?)<\//i);
    if (qualMatch) {
        const quals = qualMatch[1].replace(/<[^>]+>/g, '').trim();
        if (quals) data.services = data.services ? data.services + '; ' + quals : quals;
    }

    return data;
}

async function scrapeProfile(lead) {
    try {
        const resp = await httpGet(lead.profileUrl);
        if (resp.status !== 200) {
            console.log(`    HTTP ${resp.status}`);
            return lead;
        }

        const data = extractProfileData(resp.body);

        // Profile page title often shows owner first name (e.g. "Paul")
        // Keep the listing company name if it's longer/more descriptive
        let companyName = lead.companyName || '';
        if (data.companyName && data.companyName.length > companyName.length) {
            companyName = data.companyName;
        }
        // If profile returned a short name (likely owner), use it as ownerName instead
        let ownerName = data.ownerName || '';
        if (data.companyName && data.companyName.length < 15 && !data.companyName.includes(' ') && lead.companyName) {
            ownerName = data.companyName;
            companyName = lead.companyName;
        }

        return {
            ...lead,
            companyName,
            ownerName,
            overallRating: data.overallRating || lead.overallRating || '',
            reviewCount: data.reviewCount || lead.reviewCount || '',
            location: data.location || lead.location || '',
            phone: data.phone || lead.phone || '',
            websiteUrl: data.websiteUrl || '',
            verificationStatus: data.verificationStatus || lead.verificationStatus || '',
            services: data.services || lead.services || '',
            coverageArea: data.coverageArea || lead.coverageArea || '',
            memberSince: data.memberSince || lead.memberSince || ''
        };
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        return lead;
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    const tradeSlug = getTradeSlug(CONFIG.trade);
    const tradeName = TRADE_SLUGS[tradeSlug] || CONFIG.trade;
    const locations = CONFIG.testMode ? ['london'] : UK_LOCATIONS;
    const maxPagesPerLocation = CONFIG.testMode ? 2 : 50;

    console.log('=== MyJobQuote Scraper ===');
    console.log(`Trade: ${tradeName} (slug: ${tradeSlug})`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Test mode: ${CONFIG.testMode}`);
    console.log('');

    ensureDir(CONFIG.outputDir);
    ensureDir(CONFIG.logsDir);

    // Phase 1: Collect listings from API
    console.log('=== Phase 1: Collecting leads via API ===\n');

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        console.log(`[${i + 1}/${locations.length}] Location: ${location}`);

        try {
            const leads = await scrapeListings(tradeSlug, location, maxPagesPerLocation);
            allLeads.push(...leads);
        } catch (error) {
            console.log(`    Error scraping ${location}: ${error.message}`);
        }

        console.log(`    Total unique: ${allLeads.length} (${totalDuplicates} duplicates skipped)\n`);

        if ((i + 1) % 10 === 0) {
            saveResults(allLeads, tradeName);
        }
    }

    console.log(`\n=== Phase 1 Complete ===`);
    console.log(`Total unique leads: ${allLeads.length}`);
    console.log(`Duplicates skipped: ${totalDuplicates}`);

    const p1Msg = `[MYJOBQUOTE P1] ${tradeName} | ${allLeads.length} unique leads | ${totalDuplicates} dupes`;
    sendTelegram(p1Msg);
    saveResults(allLeads, tradeName);

    // Phase 2: Profile details
    const p2Msg = `[MYJOBQUOTE P2 START] ${tradeName} | Scraping ${allLeads.length} profiles`;
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
            const msg = `[HEALTH] MyJobQuote ${tradeName} | ${i + 1}/${allLeads.length} | ${elapsed}min | ${rate}/min`;
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
            saveResults(enrichedLeads, tradeName);
            console.log(`    Progress saved: ${enrichedLeads.length} profiles\n`);
        }

        await jitterDelay(CONFIG.profileDelayMin, CONFIG.profileDelayMax);
    }

    saveResults(enrichedLeads, tradeName);

    const tradeSlugOut = slugify(tradeName);
    const doneMsg = `[MYJOBQUOTE DONE] ${tradeName}: ${enrichedLeads.length} leads saved to myjobquote-${tradeSlugOut}s.csv`;
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

main().catch(console.error);
