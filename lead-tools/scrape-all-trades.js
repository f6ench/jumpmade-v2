const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

const OUTPUT_DIR = path.join(__dirname, 'output', 'checkatrade');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-all-progress.json');
const COOLDOWN_MS = 15000; // Reduced from 30s

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

// Confirmed working Checkatrade search terms (singular API category names)
// Tested via stealth Puppeteer + proxies on Mar 11 -- only these return results
const ALL_TRADES = [
    // High-value / high-volume
    'Plumber',
    'Electrician',
    'Builder',
    'Roofer',
    'Bathrooms',
    'Plasterer',
    'Kitchens',
    'Landscaper',
    'Handyman',
    'Locksmith',
    // Medium volume
    'Bricklayer',
    'Carpenter',
    'Gardener',
    'Scaffolder',
    'Surveying',
    'Insulation',
    'Glass',
    'Groundworks',
    'Chimney Sweep',
    'Carpet and Upholstery Cleaning',
    // Low volume
    'Bedrooms',
    'Telecommunications',
    'Stonemason',
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `all-uk-${slug}s.csv`);
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
    const csvPath = path.join(OUTPUT_DIR, `all-uk-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    const lines = content.split('\n');
    return Math.max(0, lines.length - 1);
}

function runScraper(trade, extraArgs = []) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        const childArgs = ['scrape-all-uk.js', trade, ...extraArgs];
        console.log(`  Spawning: node ${childArgs.join(' ')}`);
        console.log(`  Log: logs/scrape-${slug}.log`);

        const child = spawn('node', childArgs, {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env }
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
    const skipPhase2 = args.includes('--skip-phase2');
    const fastPostcodes = args.includes('--fast-postcodes');
    const fast = args.includes('--fast');
    const startFromIdx = args.indexOf('--start-from');
    const startFrom = startFromIdx >= 0 ? args[startFromIdx + 1] : null;
    const stopAtIdx = args.indexOf('--stop-at');
    const stopAt = stopAtIdx >= 0 ? args[stopAtIdx + 1] : null;
    const instanceIdx = args.indexOf('--instance');
    const instanceLabel = instanceIdx >= 0 ? args[instanceIdx + 1] : '';
    const concurrentIdx = args.indexOf('--concurrent');
    const concurrentCount = concurrentIdx >= 0 ? parseInt(args[concurrentIdx + 1]) : 1;

    function tagMsg(msg) {
        return instanceLabel ? `[#${instanceLabel}] ${msg}` : msg;
    }

    // Ensure dirs exist
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

    console.log('=== Scrape All Trades ===');
    if (instanceLabel) console.log(`Instance: #${instanceLabel}`);
    if (concurrentCount > 1) console.log(`Concurrent: ${concurrentCount} trades at a time`);
    if (skipPhase2) console.log('Phase 2: SKIPPED');
    if (fastPostcodes) console.log('Postcodes: fast (50 metro areas)');
    if (fast) console.log('Delays: fast');
    console.log(`${ALL_TRADES.length} trades loaded\n`);

    let sorted = [...ALL_TRADES];

    // Filter trade range for multi-machine splitting
    if (startFrom || stopAt) {
        const startIdx = startFrom ? sorted.findIndex(t => t.toLowerCase() === startFrom.toLowerCase()) : 0;
        const stopIdx = stopAt ? sorted.findIndex(t => t.toLowerCase() === stopAt.toLowerCase()) : sorted.length - 1;
        if (startFrom && startIdx < 0) { console.error(`Trade not found: "${startFrom}"`); process.exit(1); }
        if (stopAt && stopIdx < 0) { console.error(`Trade not found: "${stopAt}"`); process.exit(1); }
        sorted = sorted.slice(startIdx >= 0 ? startIdx : 0, (stopIdx >= 0 ? stopIdx : sorted.length - 1) + 1);
        console.log(`Range: ${sorted[0]} -> ${sorted[sorted.length - 1]} (${sorted.length} trades)`);
    }

    if (dryRun) {
        console.log(`\n--- Trade List (${sorted.length} trades) ---\n`);
        for (const trade of sorted) {
            const slug = slugify(trade);
            const exists = csvExists(trade);
            const status = exists ? 'SKIP (CSV exists)' : 'PENDING';
            console.log(`  ${status.padEnd(20)} ${trade} -> all-uk-${slug}s.csv`);
        }
        const pending = sorted.filter(t => !csvExists(t)).length;
        const skipping = sorted.length - pending;
        console.log(`\nTotal: ${sorted.length} | Pending: ${pending} | Skipping: ${skipping}`);
        return;
    }

    // Build extra args to pass to child scraper
    const baseExtraArgs = [];
    if (skipPhase2) baseExtraArgs.push('--skip-phase2');
    if (fast) baseExtraArgs.push('--fast');
    if (instanceLabel) baseExtraArgs.push('--instance', instanceLabel);

    const startMsg = tagMsg(`[START] Scraping ${sorted.length} trades | concurrent=${concurrentCount} | phase2=${!skipPhase2} | postcodes=auto (remaining 74 for existing, full 124 for new)`);
    sendTelegram(startMsg);

    const progress = loadProgress();
    if (!progress.started) progress.started = new Date().toISOString();

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    // Filter to pending trades
    const pendingTrades = [];
    for (const trade of sorted) {
        if (skipExisting && csvExists(trade)) {
            console.log(`[SKIP] ${trade} -- CSV already exists`);
            skipped++;
            if (!progress.completed.includes(trade)) progress.completed.push(trade);
            continue;
        }
        pendingTrades.push(trade);
    }

    // Process trades in batches of concurrentCount
    for (let i = 0; i < pendingTrades.length; i += concurrentCount) {
        const batch = pendingTrades.slice(i, i + concurrentCount);

        console.log(`\n--- Batch: ${batch.join(' + ')} ---`);

        const promises = batch.map(async (trade) => {
            const idx = sorted.indexOf(trade);
            // Decide postcode mode: if CSV exists, scrape remaining 74 only; otherwise full 124
            const hasExisting = csvExists(trade);
            const extraArgs = [...baseExtraArgs];
            if (hasExisting) {
                extraArgs.push('--remaining-postcodes');
                console.log(`\n[${idx + 1}/${sorted.length}] Scraping: ${trade} (remaining 74 postcodes -- appending to existing CSV)`);
            } else {
                console.log(`\n[${idx + 1}/${sorted.length}] Scraping: ${trade} (full 124 postcodes)`);
            }
            progress.current = trade;
            saveProgress(progress);

            try {
                await runScraper(trade, extraArgs);
                const rowCount = countCsvRows(trade);
                if (rowCount === 0) {
                    const msg = tagMsg(`[FAILED] ${trade}: CSV empty despite exit code 0`);
                    console.log(`  ${msg}`);
                    sendTelegram(msg);
                    if (!progress.failed.includes(trade)) progress.failed.push(trade);
                    failed++;
                } else {
                    const msg = tagMsg(`[COMPLETE] ${trade}: ${rowCount} leads`);
                    console.log(`  ${msg}`);
                    sendTelegram(msg);
                    if (!progress.completed.includes(trade)) progress.completed.push(trade);
                    if (!progress.counts) progress.counts = {};
                    progress.counts[trade] = rowCount;
                    completed++;
                }
            } catch (e) {
                const msg = tagMsg(`[FAILED] ${trade}: ${e.message}`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.failed.includes(trade)) progress.failed.push(trade);
                failed++;
            }
        });

        await Promise.all(promises);

        progress.current = null;
        saveProgress(progress);

        // Cooldown between batches
        if (i + concurrentCount < pendingTrades.length) {
            console.log(`  Cooling down ${COOLDOWN_MS / 1000}s...`);
            await sleep(COOLDOWN_MS);
        }
    }

    progress.remaining = 0;
    progress.current = null;
    saveProgress(progress);

    const summary = tagMsg(`[ALL DONE] ${completed}/${sorted.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n=== All Trades Complete ===');
    console.log(summary);
    sendTelegram(summary);
}

main().catch(console.error);
