const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

const OUTPUT_DIR = path.join(__dirname, 'output', 'ratedpeople');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-ratedpeople-progress.json');
const COOLDOWN_MS = 30000;

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

// Trade categories in priority order, then alphabetical
// These are the URL slugs used by Rated People (250 total)
const TRADE_CATEGORIES = [
    // Priority trades
    'plumbers', 'builders', 'electricians', 'roofers',
    'bathroom-fitter', 'kitchen-specialists', 'gas-heating-engineer',
    'gardener-landscape-gardeners', 'painter-and-decorator', 'plasterers-renderers',
    'carpenters-joiners', 'tilers', 'locksmiths',
    // Alphabetical (remaining)
    'access-control-door-entry', 'aerial-installation', 'aerial-satellite-dish-installation',
    'air-conditioning-refrigeration', 'astro-turf', 'bath-resurfacing',
    'bathroom-design', 'bathroom-installation', 'bathroom-kitchen-and-wc-plumbing',
    'bathroom-repair', 'bathroom-tiling', 'bespoke-furniture',
    'bespoke-kitchens', 'blacksmith-metal-worker', 'blind-curtain-shutter-installation',
    'brick-block-paving', 'brick-stone-cleaning', 'bricklayers',
    'built-in-furniture', 'burglar-repairs', 'burglar-security-intruder-alarm-installation',
    'carbon-monoxide-alarms-installation', 'carpet-cleaning', 'carpet-fitters',
    'cat-flap-installation', 'cavity-wall-insulation', 'cctv-installation',
    'cctv-satellites-alarms', 'cellar-basement-conversion', 'chimney-building-repair',
    'cladding', 'cleaners', 'commercial-pest-control',
    'commercial-window-cleaning', 'complete-bathroom-refurbishment', 'complete-kitchen-refurbishment',
    'concrete-driveway', 'conservatory', 'conservatory-cleaning-maintenance',
    'crown-reduction', 'crown-thinning', 'damp-proofing',
    'decorative-cornicing-plasterwork', 'decorative-glazing', 'decorative-ironmongery-and-metalwork',
    'deep-cleaning-commercial', 'deep-cleaning-domestic', 'demolition',
    'digital-home-network', 'disability-access-installation', 'disabled-access-mobility-service',
    'domestic-appliance-repair', 'domestic-house-cleaning-one-off', 'domestic-house-cleaning-regular',
    'door-opening', 'door-replacement', 'door-window-painting',
    'drainage-specialists', 'drains-installation-unblocking-cleaning', 'driveway-pavers',
    'dry-lining-plasterboard-installation', 'dry-lining-plasterboard-repair',
    'electric-boiler-installation', 'electric-boiler-repair', 'electric-boiler-service',
    'electric-car-charging-point-installation', 'electric-oven-hob-installation',
    'electric-underfloor-heating', 'electrical-inspection-condition-report',
    'electrical-installation-testing', 'emergency-24-hour-locksmith',
    'emergency-electrician', 'emergency-plumber', 'end-of-tenancy-cleaning',
    'external-lighting', 'external-rendering', 'external-tiling',
    'external-wall-insulation', 'external-wall-painting', 'fire-alarm-installation',
    'fireplace', 'fitted-bedrooms-wardrobes', 'fitted-kitchens',
    'flat-pack-furniture-assembly', 'flat-roof-installation-repair', 'floor-fitters',
    'floor-sanding-finishing', 'floor-tiling', 'garage-conversion',
    'garage-doors-installation-repair', 'garden-clearance', 'garden-design',
    'garden-maintenance', 'garden-office-studio-construction', 'garden-shed-playhouse',
    'garden-wall', 'gas-boiler-installation', 'gas-boiler-repair',
    'gas-boiler-service', 'gas-cooker-hob-installation', 'gas-cooker-hob-repair',
    'gas-fire', 'general-fitted-furniture', 'groundwork-foundations',
    'guttering-and-rainwater-pipe', 'handyperson', 'heat-pump',
    'home-improvements', 'home-maintenance-repair', 'hot-tub-installation-repair',
    'hot-water-tank-appliance-tank-thermostats', 'house-clearance', 'house-extension',
    'house-removals', 'internal-lighting', 'internal-painting-decorating',
    'internal-rendering', 'jet-power-washing', 'kitchen-design-installation',
    'kitchen-tiling', 'kitchen-worktops-stone', 'laminate-flooring',
    'laminate-wooden-kitchen-worktops', 'landlord-reports-safety-checks', 'landscaping',
    'lawn-care-services-grass-cutting-turfing-seeding', 'leadwork', 'linoleum-flooring',
    'lock-fitting-repair', 'loft-conversion', 'loft-conversion-specialists',
    'log-cabins-timber-framed-building', 'man-woman-with-a-van', 'metal-kitchen-worktops',
    'metal-staircases', 'mould-damp-control', 'office-commercial-cleaning',
    'oil-fired-boiler', 'oven-cleaning', 'partition-wall',
    'pebble-dashing', 'period-listed-building-works', 'period-restoration',
    'perspex-protective-screens', 'pest-control', 'pizza-oven',
    'planting', 'plaster-skimming', 'plastic-rubber-flooring',
    'plumbing-repair-maintenance', 'pointing-repointing', 'polished-concrete',
    'polished-other-plaster-finish', 'pond-water-feature', 'porch-canopy',
    'post-construction-cleaning', 'power-showers-and-pump', 'radiator',
    'radiator-covers', 'removals', 'renewables-specialists',
    'repeat-garden-maintenance', 'repeat-wheelie-bin-clean', 'residential-pest-control',
    'resin-driveway', 'roller-shutters-installation-repair', 'roof-cleaning',
    'roof-insulation', 'scaffolding', 'screeding',
    'security-fencing', 'security-gates-bollard', 'security-grill',
    'security-systems-alarms', 'septic-tanks-installation-emptying-cleaning',
    'single-double-glazing', 'skirting-board-installation', 'slate-tiled-roof',
    'smoke-alarm-installation', 'soil-irrigation-drainage', 'solar-panel-cleaning-repair',
    'solar-panel-installation', 'solid-wood-flooring', 'sound-audio-visual-installation',
    'sound-proofing', 'specialist-removals', 'specialist-services',
    'sprinkler-system', 'standard-coving', 'steel-fabrication-structural-steelwork',
    'stone-concrete-paving', 'stonework-stone-cladding', 'stoneworkers-stonemasons',
    'storage', 'stored-gas', 'stored-oil',
    'stump-grinding', 'suspended-ceiling', 'swimming-pool-design',
    'swimming-pool-installation', 'swimming-pool-maintenance', 'swimming-pool-specialists',
    'tarmac', 'thatched-roof', 'thermal-insulation',
    'timber-preservation-woodworm-rot', 'traditional-craftspeople', 'tree-felling',
    'tree-surgeons', 'tree-surgery-consultancy', 'underfloor-insulation',
    'underpinning-piling-foundations', 'upvc-fascias-soffits-cladding', 'upvc-windows-door',
    'velux-skylight-window', 'vinyl-flooring', 'wall-murals-paint-effects',
    'wall-tiling', 'waste-removal', 'water-tanks-and-immersion-heater',
    'water-underfloor-heating', 'wet-room-installation', 'whole-internal-refurbishment',
    'window-cleaning', 'window-fitter-conservatory-installer', 'wood-floor-sanding-staining',
    'wooden-casement-window', 'wooden-cladding-fascias-soffits', 'wooden-decking',
    'wooden-doors-external', 'wooden-doors-internal', 'wooden-metal-gates',
    'wooden-metal-wire-fences', 'wooden-sash-window', 'wooden-shutter',
    'wooden-staircases', 'zinc-metal-roof'
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `ratedpeople-${slug}s.csv`);
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
    const csvPath = path.join(OUTPUT_DIR, `ratedpeople-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    const content = fs.readFileSync(csvPath, 'utf-8').trim();
    return Math.max(0, content.split('\n').length - 1);
}

function runScraper(trade) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-ratedpeople-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        console.log(`  Spawning: node scrape-ratedpeople.js "${trade}"`);
        console.log(`  Log: logs/scrape-ratedpeople-${slug}.log`);

        const child = spawn('node', ['scrape-ratedpeople.js', trade], {
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

    console.log('=== Scrape All Trades -- Rated People ===');
    if (instanceLabel) console.log(`Instance: ${instanceLabel} (${trades.length} of ${TRADE_CATEGORIES.length} trades)`);
    console.log(`Trades: ${trades.length}\n`);

    if (dryRun) {
        console.log(`--- Trade List (${trades.length} trades) ---\n`);
        for (const trade of trades) {
            const slug = slugify(trade);
            const exists = csvExists(trade);
            const status = exists ? 'SKIP (CSV exists)' : 'PENDING';
            console.log(`  ${status.padEnd(20)} ${trade} -> ratedpeople-${slug}s.csv`);
        }
        const pending = trades.filter(t => !csvExists(t)).length;
        console.log(`\nTotal: ${trades.length} | Pending: ${pending} | Skipping: ${trades.length - pending}`);
        return;
    }

    sendTelegram(tagMsg(`[RATEDPEOPLE START] ${trades.length} trades`));
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
                const msg = tagMsg(`[RATEDPEOPLE FAIL] ${trade}: CSV empty`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.failed.includes(trade)) progress.failed.push(trade);
                failed++;
            } else {
                const msg = tagMsg(`[RATEDPEOPLE OK] ${trade}: ${rowCount} leads`);
                console.log(`  ${msg}`);
                sendTelegram(msg);
                if (!progress.completed.includes(trade)) progress.completed.push(trade);
                progress.counts[trade] = rowCount;
                completed++;
            }
        } catch (e) {
            const msg = tagMsg(`[RATEDPEOPLE FAIL] ${trade}: ${e.message}`);
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

    const summary = tagMsg(`[RATEDPEOPLE ALL DONE] ${completed}/${trades.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n=== All Trades Complete ===');
    console.log(summary);
    sendTelegram(summary);
}

main().catch(console.error);
