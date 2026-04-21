const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

const OUTPUT_DIR = path.join(__dirname, 'output', 'mybuilder');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-mybuilder-progress.json');
const COOLDOWN_MS = 60000; // Longer cooldown for CAPTCHA-protected site

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

const TRADE_CATEGORIES = [
    'Plumber', 'Builder', 'Electrician', 'Roofer',
    'Kitchen Fitter', 'Bathroom Fitter', 'Heating Engineer',
    'Landscaper', 'Painter Decorator', 'Plasterer',
    'Carpenter', 'Tiler', 'Locksmith',
    'Driveway Specialist', 'Fencer', 'Window Fitter',
    'Handyman', 'Flooring Specialist', 'Gas Engineer',
    'Bricklayer', 'Gardener', 'Tree Surgeon',
    'Drainage Specialist', 'Cleaner', 'Pest Control',
    'Scaffolder', 'Insulation Specialist', 'Rendering',
    'Demolition'
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `mybuilder-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return false;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    return content.split('\n').length > 1;
}

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    return { started: new Date().toISOString(), completed: [], failed: [], counts: {}, current: null, remaining: 0 };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function countCsvRows(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `mybuilder-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    return Math.max(0, fs.readFileSync(csvPath, 'utf-8').trim().split('\n').length - 1);
}

function runScraper(trade) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-mybuilder-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        console.log(`  Spawning: node scrape-mybuilder.js "${trade}"`);
        const child = spawn('node', ['scrape-mybuilder.js', trade], {
            cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe']
        });

        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);
        child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('Phase') || line.includes('Complete') || line.includes('Total unique') || line.includes('WARNING') || line.includes('Human test')) {
                console.log(`  [${slug}] ${line}`);
            }
        });

        child.on('close', (code) => { logStream.end(); code === 0 ? resolve() : reject(new Error(`Exit ${code}`)); });
        child.on('error', (err) => { logStream.end(); reject(err); });
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

    console.log('=== Scrape All Trades -- MyBuilder (Stealth) ===');
    if (instanceLabel) console.log(`Instance: ${instanceLabel} (${trades.length} of ${TRADE_CATEGORIES.length} trades)`);
    console.log(`Trades: ${trades.length}\n`);

    if (dryRun) {
        for (const trade of trades) {
            const slug = slugify(trade);
            const status = csvExists(trade) ? 'SKIP' : 'PENDING';
            console.log(`  ${status.padEnd(10)} ${trade} -> mybuilder-${slug}s.csv`);
        }
        return;
    }

    sendTelegram(tagMsg(`[MYBUILDER START] ${trades.length} trades`));
    const progress = loadProgress();
    let completed = 0, failed = 0, skipped = 0;

    for (const trade of trades) {
        if (skipExisting && csvExists(trade)) { skipped++; continue; }

        console.log(`\n[${completed + failed + skipped + 1}/${trades.length}] Scraping: ${trade}`);
        progress.current = trade;
        saveProgress(progress);

        try {
            await runScraper(trade);
            const rowCount = countCsvRows(trade);
            const msg = rowCount > 0 ? tagMsg(`[MYBUILDER OK] ${trade}: ${rowCount} leads`) : tagMsg(`[MYBUILDER FAIL] ${trade}: empty`);
            console.log(`  ${msg}`);
            sendTelegram(msg);
            if (rowCount > 0) { progress.completed.push(trade); progress.counts[trade] = rowCount; completed++; }
            else { progress.failed.push(trade); failed++; }
        } catch (e) {
            const msg = tagMsg(`[MYBUILDER FAIL] ${trade}: ${e.message}`);
            console.log(`  ${msg}`);
            sendTelegram(msg);
            progress.failed.push(trade);
            failed++;
        }

        progress.current = null;
        saveProgress(progress);

        if (completed + failed + skipped < trades.length) {
            console.log(`  Cooling down ${COOLDOWN_MS / 1000}s...`);
            await sleep(COOLDOWN_MS);
        }
    }

    const summary = tagMsg(`[MYBUILDER ALL DONE] ${completed}/${trades.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n' + summary);
    sendTelegram(summary);
}

main().catch(console.error);
