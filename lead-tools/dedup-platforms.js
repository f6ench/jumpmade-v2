const fs = require('fs');
const path = require('path');
const { slugify, ensureDir } = require('./scraper-base');

const OUTPUT_DIR = path.join(__dirname, 'output');
const CHECKATRADE_DIR = path.join(OUTPUT_DIR, 'checkatrade');
const TRUSTATRADER_DIR = path.join(OUTPUT_DIR, 'trustatrader');
const RATEDPEOPLE_DIR = path.join(OUTPUT_DIR, 'ratedpeople');
const MYJOBQUOTE_DIR = path.join(OUTPUT_DIR, 'myjobquote');
const BARK_DIR = path.join(OUTPUT_DIR, 'bark');
const MYBUILDER_DIR = path.join(OUTPUT_DIR, 'mybuilder');
const MASTER_DIR = path.join(OUTPUT_DIR, 'master');

// ============================================================
// CSV parsing (no external deps)
// ============================================================

function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const lines = content.split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] || '';
        }
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                values.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }
    values.push(current.trim());
    return values;
}

// ============================================================
// Phone normalization
// ============================================================

function normalizePhone(phone) {
    if (!phone) return '';
    // Strip everything except digits
    let digits = phone.replace(/[^\d]/g, '');
    // Convert +44 prefix to 0
    if (digits.startsWith('44') && digits.length > 10) {
        digits = '0' + digits.slice(2);
    }
    // Must be valid UK phone (10-11 digits starting with 0)
    if (digits.length >= 10 && digits.length <= 11 && digits.startsWith('0')) {
        return digits;
    }
    return '';
}

// ============================================================
// Domain extraction
// ============================================================

function extractDomain(url) {
    if (!url) return '';
    try {
        const match = url.match(/https?:\/\/(?:www\.)?([^\/\?#]+)/i);
        return match ? match[1].toLowerCase() : '';
    } catch {
        return '';
    }
}

// ============================================================
// Fuzzy business name matching
// ============================================================

function normalizeName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .replace(/\b(ltd|limited|plc|inc|llp|the|&|and)\b/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

function namesMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // Only use Levenshtein for short-ish names to avoid false positives
    if (na.length < 30 && nb.length < 30) {
        return levenshtein(na, nb) <= 3;
    }
    return false;
}

// ============================================================
// Load all platform CSVs
// ============================================================

function loadPlatformData(trade, overrideSlug) {
    const tradeSlug = overrideSlug || slugify(trade);
    const leads = [];

    // Checkatrade
    const checkatradePath = path.join(CHECKATRADE_DIR, `all-uk-${tradeSlug}s.csv`);
    if (fs.existsSync(checkatradePath)) {
        const rows = parseCSV(checkatradePath);
        for (const row of rows) {
            // website_url from Checkatrade scrape is a tracking link (9tuma.app.link) -- not a real domain
            const rawDomain = extractDomain(row.website_url || '');
            const domain = (rawDomain && !rawDomain.includes('9tuma') && !rawDomain.includes('app.link') && !rawDomain.includes('checkatrade.com')) ? rawDomain : '';
            leads.push({
                ...row,
                source_platform: 'checkatrade',
                _phone: normalizePhone(row.phone || row.checkatrade_phone || row.mobile || ''),
                _domain: domain,
                _handle: row.handle || '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  Checkatrade: ${rows.length} rows from ${checkatradePath}`);
    }

    // TrustATrader
    const tatPath = path.join(TRUSTATRADER_DIR, `trustatrader-${tradeSlug}s.csv`);
    if (fs.existsSync(tatPath)) {
        const rows = parseCSV(tatPath);
        for (const row of rows) {
            leads.push({
                ...row,
                source_platform: row.source_platform || 'trustatrader',
                _phone: normalizePhone(row.phone || ''),
                _domain: extractDomain(row.website_url || ''),
                _handle: '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  TrustATrader: ${rows.length} rows from ${tatPath}`);
    }

    // Rated People
    const rpPath = path.join(RATEDPEOPLE_DIR, `ratedpeople-${tradeSlug}s.csv`);
    if (fs.existsSync(rpPath)) {
        const rows = parseCSV(rpPath);
        for (const row of rows) {
            leads.push({
                ...row,
                source_platform: row.source_platform || 'ratedpeople',
                _phone: normalizePhone(row.phone || ''),
                _domain: extractDomain(row.website_url || ''),
                _handle: '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  Rated People: ${rows.length} rows from ${rpPath}`);
    }

    // MyJobQuote
    const mjqPath = path.join(MYJOBQUOTE_DIR, `myjobquote-${tradeSlug}s.csv`);
    if (fs.existsSync(mjqPath)) {
        const rows = parseCSV(mjqPath);
        for (const row of rows) {
            leads.push({
                ...row,
                source_platform: row.source_platform || 'myjobquote',
                _phone: normalizePhone(row.phone || ''),
                _domain: extractDomain(row.website_url || ''),
                _handle: '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  MyJobQuote: ${rows.length} rows from ${mjqPath}`);
    }

    // Bark
    const barkPath = path.join(BARK_DIR, `bark-${tradeSlug}s.csv`);
    if (fs.existsSync(barkPath)) {
        const rows = parseCSV(barkPath);
        for (const row of rows) {
            leads.push({
                ...row,
                source_platform: row.source_platform || 'bark',
                _phone: normalizePhone(row.phone || ''),
                _domain: extractDomain(row.website_url || ''),
                _handle: '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  Bark: ${rows.length} rows from ${barkPath}`);
    }

    // MyBuilder
    const mbPath = path.join(MYBUILDER_DIR, `mybuilder-${tradeSlug}s.csv`);
    if (fs.existsSync(mbPath)) {
        const rows = parseCSV(mbPath);
        for (const row of rows) {
            leads.push({
                ...row,
                source_platform: row.source_platform || 'mybuilder',
                _phone: normalizePhone(row.phone || ''),
                _domain: extractDomain(row.website_url || ''),
                _handle: '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  MyBuilder: ${rows.length} rows from ${mbPath}`);
    }

    return leads;
}

// ============================================================
// Dedup engine
// ============================================================

function dedupLeads(leads) {
    // Build indexes for fast lookup
    const handleIndex = new Map();    // handle -> cluster ID (Checkatrade unique ID)
    const profileIndex = new Map();   // profile_url -> cluster ID
    const phoneIndex = new Map();     // phone -> cluster ID
    const domainIndex = new Map();    // domain -> cluster ID
    const clusters = new Map();       // cluster ID -> array of leads
    let nextCluster = 0;

    function getOrCreateCluster(lead) {
        // Check handle match first (strongest -- unique per business on Checkatrade)
        if (lead._handle && handleIndex.has(lead._handle)) {
            return handleIndex.get(lead._handle);
        }
        // Check profile URL match (unique per business per platform)
        if (lead._profileUrl && profileIndex.has(lead._profileUrl)) {
            return profileIndex.get(lead._profileUrl);
        }
        // Check phone match
        if (lead._phone && phoneIndex.has(lead._phone)) {
            return phoneIndex.get(lead._phone);
        }
        // Check domain match
        if (lead._domain && domainIndex.has(lead._domain)) {
            return domainIndex.get(lead._domain);
        }
        return null;
    }

    function mergeClusters(id1, id2) {
        if (id1 === id2) return id1;
        const leads1 = clusters.get(id1) || [];
        const leads2 = clusters.get(id2) || [];
        const merged = [...leads1, ...leads2];
        clusters.set(id1, merged);
        clusters.delete(id2);
        // Update all indexes
        for (const l of merged) {
            if (l._handle) handleIndex.set(l._handle, id1);
            if (l._profileUrl) profileIndex.set(l._profileUrl, id1);
            if (l._phone) phoneIndex.set(l._phone, id1);
            if (l._domain) domainIndex.set(l._domain, id1);
        }
        return id1;
    }

    // Pass 1: Handle, profile URL, phone, and domain matching
    for (const lead of leads) {
        let clusterId = getOrCreateCluster(lead);

        if (clusterId === null) {
            clusterId = nextCluster++;
            clusters.set(clusterId, []);
        }

        clusters.get(clusterId).push(lead);
        if (lead._handle) handleIndex.set(lead._handle, clusterId);
        if (lead._profileUrl) profileIndex.set(lead._profileUrl, clusterId);
        if (lead._phone) phoneIndex.set(lead._phone, clusterId);
        if (lead._domain) domainIndex.set(lead._domain, clusterId);
    }

    // Pass 2: Name-based fuzzy matching ONLY for cross-platform merging
    // Skip if cluster only has leads from a single platform (handle/profileUrl already deduped within platform)
    const clusterArray = Array.from(clusters.entries());
    for (let i = 0; i < clusterArray.length; i++) {
        const [id1, leads1] = clusterArray[i];
        if (!clusters.has(id1)) continue;
        if (leads1.length > 3) continue;

        for (let j = i + 1; j < clusterArray.length; j++) {
            const [id2, leads2] = clusterArray[j];
            if (!clusters.has(id2)) continue;
            if (leads2.length > 3) continue;

            // Only fuzzy match across different platforms
            const platforms1 = new Set(leads1.map(l => l.source_platform));
            const platforms2 = new Set(leads2.map(l => l.source_platform));
            const samePlatform = [...platforms1].some(p => platforms2.has(p));
            if (samePlatform) continue;

            const name1 = leads1[0]._normName;
            const name2 = leads2[0]._normName;
            if (name1 && name2 && namesMatch(name1, name2)) {
                mergeClusters(id1, id2);
            }
        }
    }

    return clusters;
}

// ============================================================
// Output
// ============================================================

const MASTER_HEADERS = [
    'company_name', 'owner_name', 'trade_type', 'location', 'website_url',
    'overall_rating', 'review_count', 'phone',
    'profile_url', 'platforms', 'platform_count', 'high_value'
];

const GLOBAL_MASTER_HEADERS = [
    'company_name', 'owner_name', 'trades', 'trade_count',
    'overall_rating', 'review_count', 'years_on_checkatrade',
    'is_ltd', 'vat_number',
    'platforms', 'platform_count',
    'profile_url', 'handle'
];

function clusterToRow(clusterLeads) {
    // Pick the "best" lead as the primary (prefer one with most data)
    const sorted = clusterLeads.sort((a, b) => {
        const scoreA = [a.company_name, a.phone, a.website_url, a.owner_name, a.overall_rating].filter(Boolean).length;
        const scoreB = [b.company_name, b.phone, b.website_url, b.owner_name, b.overall_rating].filter(Boolean).length;
        return scoreB - scoreA;
    });

    const primary = sorted[0];
    const platforms = [...new Set(clusterLeads.map(l => l.source_platform).filter(Boolean))];
    const profileUrls = clusterLeads.map(l => l.profile_url).filter(Boolean);

    // Merge: take first non-empty value for each field
    const merged = {};
    for (const key of ['company_name', 'owner_name', 'trade_type', 'location', 'website_url', 'overall_rating', 'review_count', 'phone']) {
        merged[key] = '';
        for (const lead of sorted) {
            if (lead[key]) {
                merged[key] = lead[key];
                break;
            }
        }
    }

    merged.profile_url = profileUrls.join(' | ');
    merged.platforms = platforms.join(', ');
    merged.platform_count = String(platforms.length);
    merged.high_value = platforms.length >= 3 ? 'YES' : '';

    return merged;
}

function writeMasterCSV(filePath, rows) {
    const { csvEscape } = require('./scraper-base');
    const headerLine = MASTER_HEADERS.join(',');
    const dataLines = rows.map(row =>
        MASTER_HEADERS.map(h => csvEscape(row[h] || '')).join(',')
    );
    fs.writeFileSync(filePath, [headerLine, ...dataLines].join('\n'));
}

// ============================================================
// Global master -- one row per business across ALL trades
// ============================================================

function buildGlobalMaster() {
    console.log('=== Building Global Master Sheet ===\n');

    // Load every CSV from subdirectories
    const checkatradeFiles = fs.existsSync(CHECKATRADE_DIR) ? fs.readdirSync(CHECKATRADE_DIR) : [];
    const allLeads = [];

    for (const f of checkatradeFiles) {
        const match = f.match(/^all-uk-(.+)\.csv$/);
        if (!match) continue;
        const filePath = path.join(CHECKATRADE_DIR, f);
        const rows = parseCSV(filePath);
        if (rows.length === 0) continue;

        for (const row of rows) {
            const rawDomain = extractDomain(row.website_url || '');
            const domain = (rawDomain && !rawDomain.includes('9tuma') && !rawDomain.includes('app.link') && !rawDomain.includes('checkatrade.com')) ? rawDomain : '';
            allLeads.push({
                ...row,
                source_platform: 'checkatrade',
                _phone: normalizePhone(row.phone || row.checkatrade_phone || row.mobile || ''),
                _domain: domain,
                _handle: row.handle || '',
                _profileUrl: row.profile_url || '',
                _normName: normalizeName(row.company_name || '')
            });
        }
        console.log(`  ${f}: ${rows.length} rows`);
    }

    // Also load other platform CSVs from subdirectories
    const platformDirs = [
        { dir: TRUSTATRADER_DIR, prefix: 'trustatrader-', platform: 'trustatrader' },
        { dir: RATEDPEOPLE_DIR, prefix: 'ratedpeople-', platform: 'ratedpeople' },
        { dir: MYJOBQUOTE_DIR, prefix: 'myjobquote-', platform: 'myjobquote' },
        { dir: BARK_DIR, prefix: 'bark-', platform: 'bark' },
        { dir: MYBUILDER_DIR, prefix: 'mybuilder-', platform: 'mybuilder' }
    ];
    for (const { dir, prefix, platform } of platformDirs) {
        if (!fs.existsSync(dir)) continue;
        const dirFiles = fs.readdirSync(dir);
        for (const f of dirFiles) {
            if (!f.startsWith(prefix) || !f.endsWith('.csv')) continue;
            const filePath = path.join(dir, f);
            const rows = parseCSV(filePath);
            if (rows.length === 0) continue;

            for (const row of rows) {
                allLeads.push({
                    ...row,
                    source_platform: row.source_platform || platform,
                    _phone: normalizePhone(row.phone || ''),
                    _domain: extractDomain(row.website_url || ''),
                    _handle: '',
                    _profileUrl: row.profile_url || '',
                    _normName: normalizeName(row.company_name || '')
                });
            }
            console.log(`  ${f}: ${rows.length} rows`);
        }
    }

    console.log(`\n  Total rows loaded: ${allLeads.length}`);

    // Dedup across everything
    const clusters = dedupLeads(allLeads);

    // Build master rows -- one per business, trades combined
    const masterRows = [];
    let multiTrade = 0;
    let multiPlatform = 0;

    for (const [, clusterLeads] of clusters) {
        // Collect all trades
        const trades = [...new Set(clusterLeads.map(l => l.trade_type).filter(Boolean))];
        const platforms = [...new Set(clusterLeads.map(l => l.source_platform).filter(Boolean))];
        const profileUrls = [...new Set(clusterLeads.map(l => l.profile_url).filter(Boolean))];
        const handles = [...new Set(clusterLeads.map(l => l.handle || l._handle).filter(Boolean))];

        // Pick best data from all rows
        const best = {};
        for (const key of ['company_name', 'owner_name', 'overall_rating', 'review_count', 'years_on_checkatrade', 'is_ltd', 'vat_number']) {
            best[key] = '';
            for (const lead of clusterLeads) {
                if (lead[key] && (!best[key] || (key === 'review_count' && parseInt(lead[key]) > parseInt(best[key])) || (key === 'overall_rating' && parseFloat(lead[key]) > parseFloat(best[key])))) {
                    best[key] = lead[key];
                }
            }
        }

        const row = {
            company_name: best.company_name,
            owner_name: best.owner_name,
            trades: trades.join(', '),
            trade_count: String(trades.length),
            overall_rating: best.overall_rating,
            review_count: best.review_count,
            years_on_checkatrade: best.years_on_checkatrade,
            is_ltd: best.is_ltd,
            vat_number: best.vat_number,
            platforms: platforms.join(', '),
            platform_count: String(platforms.length),
            profile_url: profileUrls[0] || '',
            handle: handles[0] || ''
        };

        masterRows.push(row);
        if (trades.length > 1) multiTrade++;
        if (platforms.length > 1) multiPlatform++;
    }

    // Sort by review count descending
    masterRows.sort((a, b) => (parseInt(b.review_count) || 0) - (parseInt(a.review_count) || 0));

    ensureDir(MASTER_DIR);
    const outPath = path.join(MASTER_DIR, 'master-all-trades.csv');
    const { csvEscape } = require('./scraper-base');
    const headerLine = GLOBAL_MASTER_HEADERS.join(',');
    const dataLines = masterRows.map(row =>
        GLOBAL_MASTER_HEADERS.map(h => csvEscape(row[h] || '')).join(',')
    );
    fs.writeFileSync(outPath, [headerLine, ...dataLines].join('\n'));

    console.log(`\n=== Global Master Complete ===`);
    console.log(`Unique businesses: ${masterRows.length}`);
    console.log(`Multi-trade: ${multiTrade} (listed in 2+ trade categories)`);
    console.log(`Multi-platform: ${multiPlatform} (appear on 2+ platforms)`);
    console.log(`Saved: ${outPath}`);
}

// ============================================================
// Main
// ============================================================

function main() {
    const tradeArg = process.argv[2];
    if (!tradeArg) {
        console.log('Usage: node dedup-platforms.js <trade>');
        console.log('       node dedup-platforms.js --all');
        console.log('       node dedup-platforms.js --master');
        process.exit(1);
    }

    ensureDir(OUTPUT_DIR);

    if (tradeArg === '--master') {
        return buildGlobalMaster();
    }

    if (tradeArg === '--all') {
        // Find all trades from existing CSVs across subdirectories
        const trades = new Set();
        const scanDirs = [
            { dir: CHECKATRADE_DIR, pattern: /^all-uk-(.+?)s\.csv$/ },
            { dir: TRUSTATRADER_DIR, pattern: /^trustatrader-(.+?)s\.csv$/ },
            { dir: RATEDPEOPLE_DIR, pattern: /^ratedpeople-(.+?)s\.csv$/ },
            { dir: MYJOBQUOTE_DIR, pattern: /^myjobquote-(.+?)s\.csv$/ },
            { dir: BARK_DIR, pattern: /^bark-(.+?)s\.csv$/ },
            { dir: MYBUILDER_DIR, pattern: /^mybuilder-(.+?)s\.csv$/ }
        ];
        for (const { dir, pattern } of scanDirs) {
            if (!fs.existsSync(dir)) continue;
            for (const f of fs.readdirSync(dir)) {
                const match = f.match(pattern);
                if (match) trades.add(match[1]);
            }
        }

        console.log(`=== Cross-Platform Dedup (${trades.size} trades) ===\n`);
        let totalMaster = 0;
        let totalMultiPlatform = 0;

        for (const tradeSlug of [...trades].sort()) {
            const displayName = tradeSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            console.log(`Processing: ${displayName}`);
            const { masterCount, multiCount } = processTradeBySlug(tradeSlug, displayName);
            totalMaster += masterCount;
            totalMultiPlatform += multiCount;
        }

        console.log(`\n=== Dedup Complete ===`);
        console.log(`Total master leads: ${totalMaster}`);
        console.log(`Multi-platform leads: ${totalMultiPlatform}`);
        return;
    }

    console.log(`=== Cross-Platform Dedup: ${tradeArg} ===\n`);
    processTrade(tradeArg);
}

function processTradeBySlug(tradeSlug, displayName) {
    return processTrade(displayName, tradeSlug);
}

function processTrade(trade, overrideSlug) {
    const tradeSlug = overrideSlug || slugify(trade);
    const leads = loadPlatformData(trade, tradeSlug);

    if (leads.length === 0) {
        console.log(`  No data found for ${trade}\n`);
        return { masterCount: 0, multiCount: 0 };
    }

    console.log(`  Total input: ${leads.length} rows`);
    const clusters = dedupLeads(leads);

    const masterRows = [];
    let multiPlatform = 0;

    for (const [, clusterLeads] of clusters) {
        const row = clusterToRow(clusterLeads);
        masterRows.push(row);
        if (parseInt(row.platform_count) >= 2) multiPlatform++;
    }

    ensureDir(MASTER_DIR);
    const outPath = path.join(MASTER_DIR, `master-${tradeSlug}.csv`);
    writeMasterCSV(outPath, masterRows);

    console.log(`  Master output: ${masterRows.length} unique businesses`);
    console.log(`  Multi-platform: ${multiPlatform}`);
    console.log(`  Dedup ratio: ${((1 - masterRows.length / leads.length) * 100).toFixed(1)}%`);
    console.log(`  Saved: ${outPath}\n`);

    return { masterCount: masterRows.length, multiCount: multiPlatform };
}

// ============================================================
// Exportable cross-platform index builder for enrichment
// ============================================================

function buildCrossPlatformIndex(tradeSlug) {
    const index = new Map(); // normalizedName -> { website_url, platforms[], phones[], emails[], ratings, location }

    const platformConfigs = [
        { dir: TRUSTATRADER_DIR, prefix: 'trustatrader-', platform: 'trustatrader' },
        { dir: RATEDPEOPLE_DIR, prefix: 'ratedpeople-', platform: 'ratedpeople' },
        { dir: MYJOBQUOTE_DIR, prefix: 'myjobquote-', platform: 'myjobquote' },
        { dir: BARK_DIR, prefix: 'bark-', platform: 'bark' },
        { dir: MYBUILDER_DIR, prefix: 'mybuilder-', platform: 'mybuilder' }
    ];

    let totalLoaded = 0;

    for (const { dir, prefix, platform } of platformConfigs) {
        if (!fs.existsSync(dir)) continue;

        // If tradeSlug specified, load only that trade; otherwise load all
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv') && f.startsWith(prefix));
        const targetFiles = tradeSlug
            ? files.filter(f => f === `${prefix}${tradeSlug}s.csv`)
            : files;

        for (const f of targetFiles) {
            const rows = parseCSV(path.join(dir, f));
            for (const row of rows) {
                const name = normalizeName(row.company_name || '');
                if (!name || name.length < 3) continue;

                const phone = normalizePhone(row.phone || '');
                const domain = extractDomain(row.website_url || '');
                const location = (row.location || row.coverage_area || '').toLowerCase();

                if (!index.has(name)) {
                    index.set(name, {
                        website_url: '',
                        platforms: [],
                        phones: [],
                        emails: [],
                        ratings: [],
                        location: ''
                    });
                }

                const entry = index.get(name);
                if (!entry.platforms.includes(platform)) entry.platforms.push(platform);
                if (row.website_url && !entry.website_url) entry.website_url = row.website_url;
                // Never trust directory phone numbers -- all platforms use tracking/proxy numbers
                // Real phones only come from scraping the company's own website
                if (row.email && !entry.emails.includes(row.email)) entry.emails.push(row.email);
                if (!entry.location && location) entry.location = location;

                const rating = row.overall_rating;
                const reviews = row.review_count;
                if (rating || reviews) {
                    entry.ratings.push(`${platform}:${rating || '?'}/${reviews || '?'}`);
                }

                totalLoaded++;
            }
        }
    }

    // Also build phone index and domain index for fast lookup
    const phoneIndex = new Map();
    const domainIndex = new Map();
    for (const [name, entry] of index) {
        for (const phone of entry.phones) {
            if (!phoneIndex.has(phone)) phoneIndex.set(phone, []);
            phoneIndex.get(phone).push(name);
        }
        const domain = extractDomain(entry.website_url);
        if (domain) {
            if (!domainIndex.has(domain)) domainIndex.set(domain, []);
            domainIndex.get(domain).push(name);
        }
    }

    return { index, phoneIndex, domainIndex, totalLoaded };
}

// ============================================================
// Match a single lead against the cross-platform index
// ============================================================

function matchCrossPlatform(lead, crossPlatformData) {
    const { index, phoneIndex, domainIndex } = crossPlatformData;
    const result = {
        website_url: '',
        platforms: [],
        phones: [],
        emails: [],
        other_platform_ratings: '',
        match_confidence: 'none'
    };

    const leadName = normalizeName(lead.company_name || '');
    const leadPhone = normalizePhone(lead.phone || lead.checkatrade_phone || '');
    const leadDomain = extractDomain(lead.website_url || '');

    // Tier 1: Phone match (highest confidence)
    if (leadPhone && phoneIndex.has(leadPhone)) {
        const matchedNames = phoneIndex.get(leadPhone);
        const entry = index.get(matchedNames[0]);
        if (entry) {
            mergeMatch(result, entry, 'high');
            return result;
        }
    }

    // Tier 2: Domain match
    if (leadDomain && domainIndex.has(leadDomain)) {
        const matchedNames = domainIndex.get(leadDomain);
        const entry = index.get(matchedNames[0]);
        if (entry) {
            mergeMatch(result, entry, 'high');
            return result;
        }
    }

    // Tier 3: Exact normalized name match
    if (leadName && leadName.length >= 5 && index.has(leadName)) {
        const entry = index.get(leadName);
        mergeMatch(result, entry, 'high');
        return result;
    }

    // Tier 4: Fuzzy name match (Levenshtein)
    if (leadName && leadName.length >= 5) {
        for (const [name, entry] of index) {
            if (name.length < 5) continue;
            if (namesMatch(leadName, name)) {
                mergeMatch(result, entry, 'medium');
                return result;
            }
        }
    }

    return result;
}

function mergeMatch(result, entry, confidence) {
    result.match_confidence = confidence;
    if (entry.website_url) result.website_url = entry.website_url;
    result.platforms = [...entry.platforms];
    for (const phone of entry.phones) {
        // Include real mobiles (07xxx) and landlines (01/02xxx)
        const cleaned = phone.replace(/[^\d]/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 12 && !result.phones.includes(cleaned)) {
            // Skip tracking prefixes (03, 084, 087, 09, 070, 076, 056)
            if (!cleaned.startsWith('03') && !cleaned.startsWith('084') && !cleaned.startsWith('087') &&
                !cleaned.startsWith('09') && !cleaned.startsWith('070') && !cleaned.startsWith('076') &&
                !cleaned.startsWith('056')) {
                result.phones.push(cleaned);
            }
        }
    }
    result.emails = [...entry.emails];
    result.other_platform_ratings = entry.ratings.join(', ');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    buildCrossPlatformIndex,
    matchCrossPlatform,
    normalizeName,
    normalizePhone,
    extractDomain,
    namesMatch,
    parseCSV,
    parseCSVLine
};

// Only run main when executed directly
if (require.main === module) {
    main();
}
