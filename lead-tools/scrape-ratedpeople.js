const fs = require('fs');
const path = require('path');
const {
    httpGet, sleep, jitterDelay, slugify, csvEscape, writeCSV,
    ensureDir, sendTelegram, randomUserAgent
} = require('./scraper-base');

// ============================================================
// Config
// ============================================================

const CONFIG = {
    trade: process.argv[2] || 'plumber',
    testMode: process.argv.includes('--test'),
    outputDir: './output/ratedpeople',
    logsDir: './logs',
    delayMin: 1500,
    delayMax: 3000,
    healthCheckEvery: 250,
    saveEvery: 50
};

// ============================================================
// Trade slug mapping (URL slug -> display name)
// ============================================================

const TRADE_SLUGS = {
    // Priority trades
    'plumbers': 'Plumber',
    'builders': 'Builder',
    'electricians': 'Electrician',
    'roofers': 'Roofer',
    'bathroom-fitter': 'Bathroom Fitter',
    'kitchen-specialists': 'Kitchen Specialist',
    'gas-heating-engineer': 'Gas Heating Engineer',
    'gardener-landscape-gardeners': 'Gardener Landscape Gardener',
    'painter-and-decorator': 'Painter Decorator',
    'plasterers-renderers': 'Plasterer Renderer',
    'carpenters-joiners': 'Carpenter Joiner',
    'tilers': 'Tiler',
    'locksmiths': 'Locksmith',
    // All categories A-Z
    'access-control-door-entry': 'Access Control Door Entry',
    'aerial-installation': 'Aerial Installation',
    'aerial-satellite-dish-installation': 'Aerial Satellite Dish Installation',
    'air-conditioning-refrigeration': 'Air Conditioning Refrigeration',
    'astro-turf': 'Astro Turf',
    'bath-resurfacing': 'Bath Resurfacing',
    'bathroom-design': 'Bathroom Design',
    'bathroom-installation': 'Bathroom Installation',
    'bathroom-kitchen-and-wc-plumbing': 'Bathroom Kitchen WC Plumbing',
    'bathroom-repair': 'Bathroom Repair',
    'bathroom-tiling': 'Bathroom Tiling',
    'bespoke-furniture': 'Bespoke Furniture',
    'bespoke-kitchens': 'Bespoke Kitchens',
    'blacksmith-metal-worker': 'Blacksmith Metal Worker',
    'blind-curtain-shutter-installation': 'Blind Curtain Shutter Installation',
    'brick-block-paving': 'Brick Block Paving',
    'brick-stone-cleaning': 'Brick Stone Cleaning',
    'bricklayers': 'Bricklayer',
    'built-in-furniture': 'Built In Furniture',
    'burglar-repairs': 'Burglar Repairs',
    'burglar-security-intruder-alarm-installation': 'Burglar Security Intruder Alarm Installation',
    'carbon-monoxide-alarms-installation': 'Carbon Monoxide Alarms Installation',
    'carpet-cleaning': 'Carpet Cleaning',
    'carpet-fitters': 'Carpet Fitter',
    'cat-flap-installation': 'Cat Flap Installation',
    'cavity-wall-insulation': 'Cavity Wall Insulation',
    'cctv-installation': 'CCTV Installation',
    'cctv-satellites-alarms': 'CCTV Satellites Alarms',
    'cellar-basement-conversion': 'Cellar Basement Conversion',
    'chimney-building-repair': 'Chimney Building Repair',
    'cladding': 'Cladding',
    'cleaners': 'Cleaner',
    'commercial-pest-control': 'Commercial Pest Control',
    'commercial-window-cleaning': 'Commercial Window Cleaning',
    'complete-bathroom-refurbishment': 'Complete Bathroom Refurbishment',
    'complete-kitchen-refurbishment': 'Complete Kitchen Refurbishment',
    'concrete-driveway': 'Concrete Driveway',
    'conservatory': 'Conservatory',
    'conservatory-cleaning-maintenance': 'Conservatory Cleaning Maintenance',
    'crown-reduction': 'Crown Reduction',
    'crown-thinning': 'Crown Thinning',
    'damp-proofing': 'Damp Proofing',
    'decorative-cornicing-plasterwork': 'Decorative Cornicing Plasterwork',
    'decorative-glazing': 'Decorative Glazing',
    'decorative-ironmongery-and-metalwork': 'Decorative Ironmongery Metalwork',
    'deep-cleaning-commercial': 'Deep Cleaning Commercial',
    'deep-cleaning-domestic': 'Deep Cleaning Domestic',
    'demolition': 'Demolition',
    'digital-home-network': 'Digital Home Network',
    'disability-access-installation': 'Disability Access Installation',
    'disabled-access-mobility-service': 'Disabled Access Mobility Service',
    'domestic-appliance-repair': 'Domestic Appliance Repair',
    'domestic-house-cleaning-one-off': 'Domestic House Cleaning One Off',
    'domestic-house-cleaning-regular': 'Domestic House Cleaning Regular',
    'door-opening': 'Door Opening',
    'door-replacement': 'Door Replacement',
    'door-window-painting': 'Door Window Painting',
    'drainage-specialists': 'Drainage Specialist',
    'drains-installation-unblocking-cleaning': 'Drains Installation Unblocking Cleaning',
    'driveway-pavers': 'Driveway Paver',
    'dry-lining-plasterboard-installation': 'Dry Lining Plasterboard Installation',
    'dry-lining-plasterboard-repair': 'Dry Lining Plasterboard Repair',
    'electric-boiler-installation': 'Electric Boiler Installation',
    'electric-boiler-repair': 'Electric Boiler Repair',
    'electric-boiler-service': 'Electric Boiler Service',
    'electric-car-charging-point-installation': 'Electric Car Charging Point Installation',
    'electric-oven-hob-installation': 'Electric Oven Hob Installation',
    'electric-underfloor-heating': 'Electric Underfloor Heating',
    'electrical-inspection-condition-report': 'Electrical Inspection Condition Report',
    'electrical-installation-testing': 'Electrical Installation Testing',
    'emergency-24-hour-locksmith': 'Emergency 24 Hour Locksmith',
    'emergency-electrician': 'Emergency Electrician',
    'emergency-plumber': 'Emergency Plumber',
    'end-of-tenancy-cleaning': 'End Of Tenancy Cleaning',
    'external-lighting': 'External Lighting',
    'external-rendering': 'External Rendering',
    'external-tiling': 'External Tiling',
    'external-wall-insulation': 'External Wall Insulation',
    'external-wall-painting': 'External Wall Painting',
    'fire-alarm-installation': 'Fire Alarm Installation',
    'fireplace': 'Fireplace',
    'fitted-bedrooms-wardrobes': 'Fitted Bedrooms Wardrobes',
    'fitted-kitchens': 'Fitted Kitchens',
    'flat-pack-furniture-assembly': 'Flat Pack Furniture Assembly',
    'flat-roof-installation-repair': 'Flat Roof Installation Repair',
    'floor-fitters': 'Floor Fitter',
    'floor-sanding-finishing': 'Floor Sanding Finishing',
    'floor-tiling': 'Floor Tiling',
    'garage-conversion': 'Garage Conversion',
    'garage-doors-installation-repair': 'Garage Doors Installation Repair',
    'garden-clearance': 'Garden Clearance',
    'garden-design': 'Garden Design',
    'garden-maintenance': 'Garden Maintenance',
    'garden-office-studio-construction': 'Garden Office Studio Construction',
    'garden-shed-playhouse': 'Garden Shed Playhouse',
    'garden-wall': 'Garden Wall',
    'gas-boiler-installation': 'Gas Boiler Installation',
    'gas-boiler-repair': 'Gas Boiler Repair',
    'gas-boiler-service': 'Gas Boiler Service',
    'gas-cooker-hob-installation': 'Gas Cooker Hob Installation',
    'gas-cooker-hob-repair': 'Gas Cooker Hob Repair',
    'gas-fire': 'Gas Fire',
    'general-fitted-furniture': 'General Fitted Furniture',
    'groundwork-foundations': 'Groundwork Foundations',
    'guttering-and-rainwater-pipe': 'Guttering Rainwater Pipe',
    'handyperson': 'Handyperson',
    'heat-pump': 'Heat Pump',
    'home-improvements': 'Home Improvements',
    'home-maintenance-repair': 'Home Maintenance Repair',
    'hot-tub-installation-repair': 'Hot Tub Installation Repair',
    'hot-water-tank-appliance-tank-thermostats': 'Hot Water Tank Thermostats',
    'house-clearance': 'House Clearance',
    'house-extension': 'House Extension',
    'house-removals': 'House Removals',
    'internal-lighting': 'Internal Lighting',
    'internal-painting-decorating': 'Internal Painting Decorating',
    'internal-rendering': 'Internal Rendering',
    'jet-power-washing': 'Jet Power Washing',
    'kitchen-design-installation': 'Kitchen Design Installation',
    'kitchen-tiling': 'Kitchen Tiling',
    'kitchen-worktops-stone': 'Kitchen Worktops Stone',
    'laminate-flooring': 'Laminate Flooring',
    'laminate-wooden-kitchen-worktops': 'Laminate Wooden Kitchen Worktops',
    'landlord-reports-safety-checks': 'Landlord Reports Safety Checks',
    'landscaping': 'Landscaping',
    'lawn-care-services-grass-cutting-turfing-seeding': 'Lawn Care Grass Cutting Turfing',
    'leadwork': 'Leadwork',
    'linoleum-flooring': 'Linoleum Flooring',
    'lock-fitting-repair': 'Lock Fitting Repair',
    'loft-conversion': 'Loft Conversion',
    'loft-conversion-specialists': 'Loft Conversion Specialist',
    'log-cabins-timber-framed-building': 'Log Cabins Timber Framed Building',
    'man-woman-with-a-van': 'Man Woman With A Van',
    'metal-kitchen-worktops': 'Metal Kitchen Worktops',
    'metal-staircases': 'Metal Staircases',
    'mould-damp-control': 'Mould Damp Control',
    'office-commercial-cleaning': 'Office Commercial Cleaning',
    'oil-fired-boiler': 'Oil Fired Boiler',
    'oven-cleaning': 'Oven Cleaning',
    'partition-wall': 'Partition Wall',
    'pebble-dashing': 'Pebble Dashing',
    'period-listed-building-works': 'Period Listed Building Works',
    'period-restoration': 'Period Restoration',
    'perspex-protective-screens': 'Perspex Protective Screens',
    'pest-control': 'Pest Control',
    'pizza-oven': 'Pizza Oven',
    'planting': 'Planting',
    'plaster-skimming': 'Plaster Skimming',
    'plastic-rubber-flooring': 'Plastic Rubber Flooring',
    'plumbing-repair-maintenance': 'Plumbing Repair Maintenance',
    'pointing-repointing': 'Pointing Repointing',
    'polished-concrete': 'Polished Concrete',
    'polished-other-plaster-finish': 'Polished Other Plaster Finish',
    'pond-water-feature': 'Pond Water Feature',
    'porch-canopy': 'Porch Canopy',
    'post-construction-cleaning': 'Post Construction Cleaning',
    'power-showers-and-pump': 'Power Showers Pump',
    'radiator': 'Radiator',
    'radiator-covers': 'Radiator Covers',
    'removals': 'Removals',
    'renewables-specialists': 'Renewables Specialist',
    'repeat-garden-maintenance': 'Repeat Garden Maintenance',
    'repeat-wheelie-bin-clean': 'Repeat Wheelie Bin Clean',
    'residential-pest-control': 'Residential Pest Control',
    'resin-driveway': 'Resin Driveway',
    'roller-shutters-installation-repair': 'Roller Shutters Installation Repair',
    'roof-cleaning': 'Roof Cleaning',
    'roof-insulation': 'Roof Insulation',
    'scaffolding': 'Scaffolding',
    'screeding': 'Screeding',
    'security-fencing': 'Security Fencing',
    'security-gates-bollard': 'Security Gates Bollard',
    'security-grill': 'Security Grill',
    'security-systems-alarms': 'Security Systems Alarms',
    'septic-tanks-installation-emptying-cleaning': 'Septic Tanks Installation Emptying Cleaning',
    'single-double-glazing': 'Single Double Glazing',
    'skirting-board-installation': 'Skirting Board Installation',
    'slate-tiled-roof': 'Slate Tiled Roof',
    'smoke-alarm-installation': 'Smoke Alarm Installation',
    'soil-irrigation-drainage': 'Soil Irrigation Drainage',
    'solar-panel-cleaning-repair': 'Solar Panel Cleaning Repair',
    'solar-panel-installation': 'Solar Panel Installation',
    'solid-wood-flooring': 'Solid Wood Flooring',
    'sound-audio-visual-installation': 'Sound Audio Visual Installation',
    'sound-proofing': 'Sound Proofing',
    'specialist-removals': 'Specialist Removals',
    'specialist-services': 'Specialist Services',
    'sprinkler-system': 'Sprinkler System',
    'standard-coving': 'Standard Coving',
    'steel-fabrication-structural-steelwork': 'Steel Fabrication Structural Steelwork',
    'stone-concrete-paving': 'Stone Concrete Paving',
    'stonework-stone-cladding': 'Stonework Stone Cladding',
    'stoneworkers-stonemasons': 'Stoneworker Stonemason',
    'storage': 'Storage',
    'stored-gas': 'Stored Gas',
    'stored-oil': 'Stored Oil',
    'stump-grinding': 'Stump Grinding',
    'suspended-ceiling': 'Suspended Ceiling',
    'swimming-pool-design': 'Swimming Pool Design',
    'swimming-pool-installation': 'Swimming Pool Installation',
    'swimming-pool-maintenance': 'Swimming Pool Maintenance',
    'swimming-pool-specialists': 'Swimming Pool Specialist',
    'tarmac': 'Tarmac',
    'thatched-roof': 'Thatched Roof',
    'thermal-insulation': 'Thermal Insulation',
    'timber-preservation-woodworm-rot': 'Timber Preservation Woodworm Rot',
    'traditional-craftspeople': 'Traditional Craftspeople',
    'tree-felling': 'Tree Felling',
    'tree-surgeons': 'Tree Surgeon',
    'tree-surgery-consultancy': 'Tree Surgery Consultancy',
    'underfloor-insulation': 'Underfloor Insulation',
    'underpinning-piling-foundations': 'Underpinning Piling Foundations',
    'upvc-fascias-soffits-cladding': 'UPVC Fascias Soffits Cladding',
    'upvc-windows-door': 'UPVC Windows Door',
    'velux-skylight-window': 'Velux Skylight Window',
    'vinyl-flooring': 'Vinyl Flooring',
    'wall-murals-paint-effects': 'Wall Murals Paint Effects',
    'wall-tiling': 'Wall Tiling',
    'waste-removal': 'Waste Removal',
    'water-tanks-and-immersion-heater': 'Water Tanks Immersion Heater',
    'water-underfloor-heating': 'Water Underfloor Heating',
    'wet-room-installation': 'Wet Room Installation',
    'whole-internal-refurbishment': 'Whole Internal Refurbishment',
    'window-cleaning': 'Window Cleaning',
    'window-fitter-conservatory-installer': 'Window Fitter Conservatory Installer',
    'wood-floor-sanding-staining': 'Wood Floor Sanding Staining',
    'wooden-casement-window': 'Wooden Casement Window',
    'wooden-cladding-fascias-soffits': 'Wooden Cladding Fascias Soffits',
    'wooden-decking': 'Wooden Decking',
    'wooden-doors-external': 'Wooden Doors External',
    'wooden-doors-internal': 'Wooden Doors Internal',
    'wooden-metal-gates': 'Wooden Metal Gates',
    'wooden-metal-wire-fences': 'Wooden Metal Wire Fences',
    'wooden-sash-window': 'Wooden Sash Window',
    'wooden-shutter': 'Wooden Shutter',
    'wooden-staircases': 'Wooden Staircases',
    'zinc-metal-roof': 'Zinc Metal Roof'
};

// Reverse lookup: display name or partial match -> URL slug
function getTradeSlug(input) {
    const lower = input.toLowerCase().replace(/\s+/g, '-');
    // Direct slug match
    if (TRADE_SLUGS[lower]) return lower;
    // Try adding 's'
    if (TRADE_SLUGS[lower + 's']) return lower + 's';
    // Search display names
    for (const [slug, name] of Object.entries(TRADE_SLUGS)) {
        if (name.toLowerCase() === input.toLowerCase()) return slug;
        if (slug.includes(lower)) return slug;
    }
    // Fallback: use input as slug directly
    return lower;
}

// ============================================================
// UK locations for Rated People
// ============================================================

const UK_LOCATIONS = [
    // London
    'london', 'east-london', 'west-london', 'north-london', 'south-london',
    'central-london', 'croydon', 'bromley', 'enfield', 'barnet',
    'ealing', 'hounslow', 'greenwich', 'lewisham', 'wandsworth',
    'richmond', 'kingston', 'sutton', 'bexley', 'dartford',
    // South East
    'brighton', 'reading', 'oxford', 'southampton', 'portsmouth',
    'guildford', 'maidstone', 'canterbury', 'crawley', 'slough',
    'basingstoke', 'winchester', 'chichester', 'eastbourne', 'ashford',
    'chelmsford', 'colchester', 'southend-on-sea', 'basildon',
    // South West
    'bristol', 'bath', 'exeter', 'plymouth', 'bournemouth',
    'swindon', 'gloucester', 'cheltenham', 'taunton', 'salisbury',
    'truro',
    // East
    'norwich', 'cambridge', 'ipswich', 'peterborough', 'luton',
    'st-albans', 'watford', 'stevenage', 'bedford', 'milton-keynes',
    'northampton',
    // Midlands
    'birmingham', 'coventry', 'leicester', 'nottingham', 'derby',
    'wolverhampton', 'stoke-on-trent', 'worcester', 'telford',
    'stafford', 'solihull', 'walsall', 'lincoln', 'mansfield',
    // North West
    'manchester', 'liverpool', 'bolton', 'stockport', 'wigan',
    'warrington', 'blackpool', 'preston', 'chester', 'oldham',
    'rochdale', 'salford',
    // North East
    'newcastle', 'sunderland', 'middlesbrough', 'durham', 'darlington',
    'gateshead',
    // Yorkshire
    'leeds', 'sheffield', 'bradford', 'hull', 'york', 'huddersfield',
    'doncaster', 'wakefield', 'barnsley', 'rotherham', 'harrogate',
    'halifax', 'grimsby',
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
        trade_type: TRADE_SLUGS[getTradeSlug(trade)] || trade,
        location: l.location || '',
        website_url: l.websiteUrl || '',
        overall_rating: l.overallRating || '',
        review_count: l.reviewCount || '',
        phone: l.phone || '',
        verification_status: l.verificationStatus || '',
        services: l.services || '',
        coverage_area: l.coverageArea || '',
        profile_url: l.profileUrl || '',
        source_platform: 'ratedpeople'
    }));
    writeCSV(path.join(CONFIG.outputDir, `ratedpeople-${tradeSlug}s.csv`), CSV_HEADERS, rows);
}

// ============================================================
// HTML parsing helpers (no cheerio dependency -- regex-based)
// ============================================================

function extractRemixContext(html) {
    // Find the start of __remixContext and parse the JSON by bracket matching
    const marker = 'window.__remixContext = ';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;

    const jsonStart = idx + marker.length;
    // Find matching closing brace by counting brackets
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = jsonStart;

    for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') depth--;
        if (depth === 0) { end = i + 1; break; }
    }

    const jsonStr = html.substring(jsonStart, end);
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        try {
            return JSON.parse(jsonStr.replace(/undefined/g, 'null'));
        } catch (e2) {
            return null;
        }
    }
}

function extractListingData(html) {
    const results = [];

    // Try Remix context first -- has structured tradespeople data
    const remix = extractRemixContext(html);
    if (remix) {
        try {
            const loaderData = remix.state && remix.state.loaderData;
            if (loaderData) {
                const routeKey = Object.keys(loaderData).find(k => k.includes('localTrade') || k.includes('$level'));
                if (routeKey && loaderData[routeKey]) {
                    const routeData = loaderData[routeKey];
                    const tradespeople = routeData.tradespeople;

                    if (tradespeople && tradespeople.results && Array.isArray(tradespeople.results)) {
                        for (const tp of tradespeople.results) {
                            results.push({
                                slug: tp.profileStem || tp.activeProfileStem || '',
                                profileUrl: `https://www.ratedpeople.com/profile/${tp.profileStem || tp.activeProfileStem || ''}`,
                                companyName: tp.companyName || '',
                                overallRating: tp.averageRating != null ? String(tp.averageRating) : '',
                                reviewCount: tp.numberOfRatings != null ? String(tp.numberOfRatings) : '',
                                location: tp.businessAddressTown || '',
                                postcode: tp.businessAddressPostcode || '',
                                phone: tp.maskedNumber || '',
                                verificationStatus: tp.isVerified ? 'Verified' : '',
                                services: Array.isArray(tp.trades) ? tp.trades.map(t => t.name || t).join('; ') : ''
                            });
                        }
                        return results;
                    }
                }
            }
        } catch (e) {
            // Fall through to HTML extraction
        }
    }

    // Fallback: extract profile links from HTML
    const links = [];
    const regex = /href=["']\/profile\/([^"'\/\?#]+)["']/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        // Filter out image filenames
        if (slug && slug.length > 2 && !slug.startsWith('_') && slug !== 'view' && !slug.includes('.png') && !slug.includes('.jpg')) {
            links.push(slug);
        }
    }
    const uniqueSlugs = [...new Set(links)];

    for (const slug of uniqueSlugs) {
        results.push({
            slug,
            profileUrl: `https://www.ratedpeople.com/profile/${slug}`,
            companyName: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            overallRating: '',
            reviewCount: '',
            location: '',
            phone: '',
            verificationStatus: '',
            services: ''
        });
    }

    return results;
}

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
        coverageArea: ''
    };

    // Try __remixContext first -- this has all the structured data
    // Structure: state.loaderData["routes/_stickyheader.profile.$urlStem._index"].data
    const remix = extractRemixContext(html);
    if (remix) {
        try {
            const loaderData = remix.state && remix.state.loaderData;
            if (loaderData) {
                // Find the profile route
                const profileKey = Object.keys(loaderData).find(k => k.includes('profile'));
                if (profileKey && loaderData[profileKey]) {
                    const routeData = loaderData[profileKey];
                    const profile = routeData.data || routeData;

                    if (profile.companyName || profile.displayName) {
                        data.companyName = profile.companyName || profile.displayName || '';
                        data.phone = profile.maskedNumber || profile.phone || '';
                        data.location = profile.businessAddressTown || '';
                        data.postcode = profile.businessAddressPostcode || '';
                        data.overallRating = profile.averageRating != null ? String(profile.averageRating) : '';
                        data.reviewCount = profile.numberOfRatings != null ? String(profile.numberOfRatings) : '';
                        data.verificationStatus = profile.isVerified ? 'Verified' : '';

                        if (Array.isArray(profile.badges)) {
                            const badgeNames = profile.badges.map(b => b.name || b.label || b.type || String(b)).filter(Boolean);
                            if (badgeNames.length > 0) {
                                data.verificationStatus = badgeNames.join('; ');
                            }
                        }

                        if (Array.isArray(profile.trades)) {
                            data.services = profile.trades.map(t => t.name || t.label || String(t)).filter(Boolean).join('; ');
                        }

                        if (profile.companyDescription) {
                            data.coverageArea = profile.businessAddressTown || '';
                        }

                        return data;
                    }
                }
            }
        } catch (e) {
            // Fall through to HTML parsing
        }
    }

    // Fallback: extract tel: links and basic HTML data
    const telMatch = html.match(/href=["']tel:([^"']+)/);
    if (telMatch) data.phone = telMatch[1].trim();

    // Company name from title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
        const title = titleMatch[1].replace(/\s*[\|].*$/, '').replace(/\s*in\s+\w.*$/, '').trim();
        if (title && title.indexOf('Rated People') === -1) data.companyName = title;
    }

    // Rating from HTML
    const ratingMatch = html.match(/(\d\.?\d?)\s*(?:\/\s*5|out of 5)/i);
    if (ratingMatch) data.overallRating = ratingMatch[1];

    // Reviews
    const reviewMatch = html.match(/(\d+)\s*reviews?/i);
    if (reviewMatch) data.reviewCount = reviewMatch[1];

    return data;
}

// ============================================================
// Sitemap parsing
// ============================================================

async function fetchSitemapProfileUrls() {
    console.log('Fetching sitemap index...');
    const resp = await httpGet('https://www.ratedpeople.com/sitemap_index.xml');
    if (resp.status !== 200) {
        console.log(`Sitemap index returned ${resp.status}`);
        return [];
    }

    // Find profile sitemap URLs
    const sitemapUrls = [];
    const regex = /<loc>(https?:\/\/[^<]*sitemap[^<]*profiles?[^<]*)<\/loc>/gi;
    let match;
    while ((match = regex.exec(resp.body)) !== null) {
        sitemapUrls.push(match[1]);
    }

    if (sitemapUrls.length === 0) {
        // Try fetching all sitemaps and filter for profile ones
        const allSitemaps = [];
        const allRegex = /<loc>(https?:\/\/[^<]+\.xml(?:\.gz)?)<\/loc>/gi;
        while ((match = allRegex.exec(resp.body)) !== null) {
            allSitemaps.push(match[1]);
        }
        console.log(`Found ${allSitemaps.length} total sitemaps`);
        for (const sm of allSitemaps) {
            if (sm.includes('profile')) sitemapUrls.push(sm);
        }
    }

    console.log(`Found ${sitemapUrls.length} profile sitemaps`);

    const profileUrls = [];
    for (const smUrl of sitemapUrls) {
        console.log(`  Fetching: ${smUrl}`);
        try {
            const smResp = await httpGet(smUrl);
            if (smResp.status === 200) {
                const urlRegex = /<loc>(https?:\/\/www\.ratedpeople\.com\/profile\/[^<]+)<\/loc>/gi;
                while ((match = urlRegex.exec(smResp.body)) !== null) {
                    profileUrls.push(match[1]);
                }
            }
            await jitterDelay(500, 1000);
        } catch (e) {
            console.log(`  Error fetching sitemap: ${e.message}`);
        }
    }

    console.log(`Total profile URLs from sitemaps: ${profileUrls.length}`);
    return profileUrls;
}

// ============================================================
// Phase 1: Listing collection via location browsing
// ============================================================

async function scrapeListingPage(tradeSlug, location, pageNum) {
    const url = pageNum === 1
        ? `https://www.ratedpeople.com/local-${tradeSlug}/${location}`
        : `https://www.ratedpeople.com/local-${tradeSlug}/${location}?page=${pageNum}`;

    try {
        const resp = await httpGet(url);
        if (resp.status !== 200) {
            if (resp.status === 404) return []; // No results for this location
            console.log(`    Page ${pageNum}: HTTP ${resp.status}`);
            return [];
        }
        return extractListingData(resp.body);
    } catch (e) {
        console.log(`    Page ${pageNum}: ${e.message}`);
        return [];
    }
}

async function scrapeLocation(tradeSlug, location) {
    const locationLeads = [];
    let pageNum = 1;
    let emptyPages = 0;
    const maxPages = CONFIG.testMode ? 2 : 30;

    while (pageNum <= maxPages) {
        const results = await scrapeListingPage(tradeSlug, location, pageNum);

        if (results.length === 0) {
            emptyPages++;
            if (emptyPages >= 3) break;
            pageNum++;
            await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
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
        await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
    }

    return locationLeads;
}

// ============================================================
// Phase 2: Profile detail scraping
// ============================================================

async function scrapeProfile(lead) {
    try {
        const resp = await httpGet(lead.profileUrl);
        if (resp.status !== 200) {
            console.log(`    HTTP ${resp.status}`);
            return lead;
        }

        const data = extractProfileData(resp.body);

        return {
            ...lead,
            companyName: data.companyName || lead.companyName || '',
            ownerName: data.ownerName || '',
            overallRating: data.overallRating || lead.overallRating || '',
            reviewCount: data.reviewCount || lead.reviewCount || '',
            location: data.location || lead.location || '',
            phone: data.phone || '',
            websiteUrl: data.websiteUrl || '',
            verificationStatus: data.verificationStatus || '',
            services: data.services || '',
            coverageArea: data.coverageArea || ''
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

    console.log('=== Rated People Scraper ===');
    console.log(`Trade: ${tradeName} (slug: ${tradeSlug})`);
    console.log(`Locations: ${locations.length}`);
    console.log(`Test mode: ${CONFIG.testMode}`);
    console.log('');

    ensureDir(CONFIG.outputDir);
    ensureDir(CONFIG.logsDir);

    // Phase 1: Collect listings from all locations
    console.log('=== Phase 1: Collecting leads from all locations ===\n');

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        console.log(`[${i + 1}/${locations.length}] Location: ${location}`);

        try {
            const leads = await scrapeLocation(tradeSlug, location);
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

    const p1Msg = `[RATEDPEOPLE P1] ${tradeName} | ${allLeads.length} unique leads | ${totalDuplicates} dupes`;
    sendTelegram(p1Msg);
    saveResults(allLeads, tradeName);

    // Phase 2: Profile details
    const p2Msg = `[RATEDPEOPLE P2 START] ${tradeName} | Scraping ${allLeads.length} profiles`;
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
            const msg = `[HEALTH] RatedPeople ${tradeName} | ${i + 1}/${allLeads.length} | ${elapsed}min | ${rate}/min`;
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

        await jitterDelay(CONFIG.delayMin, CONFIG.delayMax);
    }

    // Final save
    saveResults(enrichedLeads, tradeName);

    const tradeSlugOut = slugify(tradeName);
    const doneMsg = `[RATEDPEOPLE DONE] ${tradeName}: ${enrichedLeads.length} leads saved to ratedpeople-${tradeSlugOut}s.csv`;
    console.log('\n=== Scraping Complete ===');
    console.log(doneMsg);
    sendTelegram(doneMsg);
}

main().catch(console.error);
