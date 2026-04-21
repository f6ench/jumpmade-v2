const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

const OUTPUT_DIR = path.join(__dirname, 'output', 'myjobquote');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-myjobquote-progress.json');
const COOLDOWN_MS = 30000;

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

// MyJobQuote trade slugs in priority order (50 confirmed live slugs)
const TRADE_CATEGORIES = [
    'plumber', 'builder', 'electrician', 'roofer',
    'bathroom', 'kitchen', 'heating-engineer', 'gas-boiler',
    'gardener', 'painters-decorators', 'plasterers-renderers',
    'carpenter-and-joiner', 'tiler', 'locksmith', 'handyman',
    'driveway', 'fencing-and-gates', 'guttering-and-rainwater-pipe',
    'windows-conservatories', 'flooring', 'tree-surgeon', 'bricklayer',
    'extension', 'loft-conversion', 'chimney-building-and-repair',
    'cleaner', 'flat-roof', 'fascias-and-soffits-and-cladding-upvc',
    'garage-conversion', 'garage-and-outbuilding-construction',
    'garden-clearance', 'garden-maintenance', 'garden-shed-and-playhouse',
    'gas-fire', 'gas-ovens-and-hob', 'hard-landscaping',
    'internal-renovation-and-reconfiguration', 'laminate-flooring',
    'lawns-turfing-and-seeding', 'pebble-dashing', 'porch-specialists',
    'power-showers-and-pump', 'radiator', 'staircases-wooden',
    'tarmacing-a-driveway', 'underpinning-and-foundation',
    'wooden-decking', 'wooden-doors', 'flat-pack-furniture-assembly',
    'carpet-laying'
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `myjobquote-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return false;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    return content.split('\n').length > 1;
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
    const csvPath = path.join(OUTPUT_DIR, `myjobquote-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    return Math.max(0, content.split('\n').length - 1);
}

function runScraper(trade) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-myjobquote-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        console.log(`  Spawning: node scrape-myjobquote.js "${trade}"`);
        console.log(`  Log: logs/scrape-myjobquote-${slug}.log`);

        const child = spawn('node', ['scrape-myjobquote.js', trade], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);

        child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('Phase') || line.includes('Complete') || line.includes('Total unique')) {
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

    console.log('=== Scrape All Trades -- MyJobQuote ===');
    if (instanceLabel) console.log(`Instance: ${instanceLabel} (${trades.length} of ${TRADE_CATEGORIES.length} trades)`);
    console.log(`Trades: ${trades.length}\n`);

    if (dryRun) {
        console.log(`--- Trade List (${trades.length} trades) ---\n`);
        for (const trade of trades) {
            const slug = slugify(trade);
            const exists = csvExists(trade);
            const status = exists ? 'SKIP (CSV exists)' : 'PENDING';
            console.log(`  ${status.padEnd(20)} ${trade} -> myjobquote-${slug}s.csv`);
        }
        const pending = trades.filter(t => !csvExists(t)).length;
        console.log(`\nTotal: ${trades.length} | Pending: ${pending} | Skipping: ${trades.length - pending}`);
        return;
    }

    sendTelegram(tagMsg(`[MYJOBQUOTE START] ${trades.length} trades`));
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
                const msg = tagMsg(`[MYJOBQUOTE FAIL] ${trade}: CSV empty`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.failed.includes(trade)) progress.failed.push(trade);
                failed++;
            } else {
                const msg = tagMsg(`[MYJOBQUOTE OK] ${trade}: ${rowCount} leads`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.completed.includes(trade)) progress.completed.push(trade);
                progress.counts[trade] = rowCount;
                completed++;
            }
        } catch (e) {
            const msg = tagMsg(`[MYJOBQUOTE FAIL] ${trade}: ${e.message}`);
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

    const summary = tagMsg(`[MYJOBQUOTE ALL DONE] ${completed}/${trades.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n=== All Trades Complete ===');
    console.log(summary);
    sendTelegram(summary);
}

main().catch(console.error);
