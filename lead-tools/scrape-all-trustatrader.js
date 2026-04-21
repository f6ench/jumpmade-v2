const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

const OUTPUT_DIR = path.join(__dirname, 'output', 'trustatrader');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-trustatrader-progress.json');
const COOLDOWN_MS = 30000;

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

// TrustATrader trade categories -- full list from trustatrader.com/trades
// Ordered by priority -- high-value trades first, then alphabetical
const TRADE_CATEGORIES = [
    // Tier 1: core trades (highest volume)
    'Plumber', 'Builder', 'Electrician', 'Roofer',
    'Kitchen Fitter', 'Bathroom Fitter', 'Heating Engineer',
    'Landscape Gardener', 'Painter Decorator', 'Plasterer',
    'Carpenter Joiner', 'Tiler', 'Locksmith',
    'Handyman', 'Tree Surgeon', 'Flooring Specialist',
    'Bricklayer', 'Fencer', 'Drainage Specialist',
    // Tier 2: solid trades
    'Driveway Specialist', 'Guttering Specialist', 'Window Fitter',
    'Pest Control', 'Damp Proofing', 'Garage Door Installer',
    'Conservatory Installer', 'Alarm Specialist', 'Aerial Installer',
    'Rendering', 'Skip Hire', 'Removal Company', 'Cleaner',
    'Garden Maintenance', 'Stonemason',
    'Extension Specialist', 'Loft Conversion',
    // Tier 3: additional categories from TrustATrader
    'Carpet Fitter', 'Carpet Upholstery Cleaning',
    'Double Glazing Repair',
    'Door Installer', 'Domestic Appliance Repair',
    'Driveway Patio Cleaning', 'Electric Car Charger Installer',
    'Electrical Inspection', 'Exterior Wall Coating',
    'Garden Clearance', 'Garden Room',
    'Garage Conversion Specialist', 'Garage Mechanic',
    'Ground Work Demolition', 'Home Improvement',
    'Artificial Grass Installation', 'Pointing Specialist',
    'Property Maintenance', 'Resin Bonded Driveway',
    'Roof Cleaning', 'Soundproofing Specialist',
    'Structural Engineer', 'Tarmacing',
    'Underfloor Heating Specialist', 'Wood Stove Installer',
    'Window Cleaner', 'CCTV Installation',
    'Oven Repair', 'Fitted Wardrobe Company',
    'Spray Foam Removal', 'Garden Office Builder',
    'Architectural Service', 'Park Home Specialist',
    'Computer Repair', 'Energy Assessor',
    'Damp Surveyor', 'Mobile Mechanic'
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `trustatrader-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return false;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    const lines = content.split('\n');
    return lines.length > 1;
}

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    }
    return { started: new Date().toISOString(), completed: [], failed: [], counts: {}, current: null, remaining: 0 };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function countCsvRows(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `trustatrader-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    const lines = content.split('\n');
    return Math.max(0, lines.length - 1);
}

function runScraper(trade) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-trustatrader-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        console.log(`  Spawning: node scrape-trustatrader.js "${trade}"`);
        console.log(`  Log: logs/scrape-trustatrader-${slug}.log`);

        const child = spawn('node', ['scrape-trustatrader.js', trade], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);

        child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('Phase') || line.includes('Complete') || line.includes('Total unique') || line.includes('Using proxy')) {
                console.log(`  [${slug}] ${line}`);
            }
        });

        child.on('close', (code) => {
            logStream.end();
            if (code === 0) resolve();
            else reject(new Error(`Exited with code ${code}`));
        });

        child.on('error', (err) => {
            logStream.end();
            reject(err);
        });
    });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const args = process.argv.slice(2);
    const skipExisting = args.includes('--skip-existing');
    const dryRun = args.includes('--dry-run');

    // Instance splitting: --instance N --of M (splits trade list M ways, runs slice N)
    const instanceIdx = args.indexOf('--instance');
    const instance = instanceIdx >= 0 ? parseInt(args[instanceIdx + 1]) : 0;
    const ofIdx = args.indexOf('--of');
    const totalInstances = ofIdx >= 0 ? parseInt(args[ofIdx + 1]) : 2;
    const trades = instance > 0
        ? TRADE_CATEGORIES.filter((_, i) => i % totalInstances === instance - 1)
        : TRADE_CATEGORIES;
    const instanceLabel = instance > 0 ? `#${instance}/${totalInstances}` : '';

    function tagMsg(msg) { return instanceLabel ? `[${instanceLabel}] ${msg}` : msg; }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

    console.log('=== Scrape All Trades -- TrustATrader ===');
    if (instanceLabel) console.log(`Instance: ${instanceLabel} (${trades.length} of ${TRADE_CATEGORIES.length} trades)`);
    console.log(`Trades: ${trades.length}\n`);

    if (dryRun) {
        console.log(`--- Trade List (${trades.length} trades) ---\n`);
        for (const trade of trades) {
            const slug = slugify(trade);
            const exists = csvExists(trade);
            const status = exists ? 'SKIP (CSV exists)' : 'PENDING';
            console.log(`  ${status.padEnd(20)} ${trade} -> trustatrader-${slug}s.csv`);
        }
        const pending = trades.filter(t => !csvExists(t)).length;
        const skipping = trades.length - pending;
        console.log(`\nTotal: ${trades.length} | Pending: ${pending} | Skipping: ${skipping}`);
        return;
    }

    sendTelegram(tagMsg(`[TRUSTATRADER START] ${trades.length} trades`));
    const progress = loadProgress();
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const trade of trades) {
        if (skipExisting && csvExists(trade)) {
            console.log(`[SKIP] ${trade} -- CSV already exists`);
            skipped++;
            if (!progress.completed.includes(trade)) progress.completed.push(trade);
            continue;
        }

        console.log(`\n[${completed + failed + skipped + 1}/${trades.length}] Scraping: ${trade}`);
        progress.current = trade;
        progress.remaining = trades.length - (completed + failed + skipped + 1);
        saveProgress(progress);

        try {
            await runScraper(trade);
            const rowCount = countCsvRows(trade);
            if (rowCount === 0) {
                const msg = tagMsg(`[TRUSTATRADER FAIL] ${trade}: CSV empty`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.failed.includes(trade)) progress.failed.push(trade);
                failed++;
            } else {
                const msg = tagMsg(`[TRUSTATRADER OK] ${trade}: ${rowCount} leads`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.completed.includes(trade)) progress.completed.push(trade);
                progress.counts[trade] = rowCount;
                completed++;
            }
        } catch (e) {
            const msg = tagMsg(`[TRUSTATRADER FAIL] ${trade}: ${e.message}`);
            console.log(`  ${msg}`);
            sendTelegram(msg);
            if (!progress.failed.includes(trade)) progress.failed.push(trade);
            failed++;
        }

        progress.current = null;
        saveProgress(progress);

        if (completed + failed + skipped < trades.length) {
            console.log(`  Cooling down ${COOLDOWN_MS / 1000}s...`);
            await sleep(COOLDOWN_MS);
        }
    }

    progress.remaining = 0;
    progress.current = null;
    saveProgress(progress);

    const summary = tagMsg(`[TRUSTATRADER ALL DONE] ${completed}/${trades.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n=== All Trades Complete ===');
    console.log(summary);
    sendTelegram(summary);
}

main().catch(console.error);
