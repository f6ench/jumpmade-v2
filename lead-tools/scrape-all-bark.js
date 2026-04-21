const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./scraper-base');

const OUTPUT_DIR = path.join(__dirname, 'output', 'bark');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'scrape-bark-progress.json');
const recoveryMode = process.argv.includes('--recovery');
const flareSolverrMode = process.argv.includes('--flaresolverr');
const COOLDOWN_MS = flareSolverrMode ? 90000 : (recoveryMode ? 120000 : 15000);

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

const TRADE_CATEGORIES = [
    // === Home trades ===
    'Plumber', 'Builder', 'Electrician', 'Roofer',
    'Kitchen Fitter', 'Bathroom Fitter', 'Heating Engineer',
    'Landscaper', 'Painter Decorator', 'Plasterer',
    'Carpenter', 'Tiler', 'Locksmith',
    'Driveway Specialist', 'Fencer', 'Guttering Specialist',
    'Handyman', 'Window Fitter', 'Drainage Specialist',
    'Flooring Specialist', 'Gardener', 'Tree Surgeon',
    'Pest Control', 'Gas Engineer', 'Bricklayer',
    'Scaffolder', 'Cleaner', 'Removals',
    // === Home specialist ===
    'Architect', 'Interior Designer', 'Surveyor',
    'Aerial Installer', 'Alarm Specialist', 'Carpet Cleaner',
    'Oven Cleaner', 'Window Cleaner', 'Chimney Sweep',
    'Curtain Fitter', 'Furniture Assembler', 'Mobile Mechanic',
    'Garage Door Installer', 'Conservatory Installer',
    'Rendering Specialist', 'Damp Proofing Specialist',
    'Insulation Installer', 'Solar Panel Installer',
    'CCTV Installer', 'Extension Specialist', 'Loft Conversion Specialist',
    'Demolition Contractor', 'Swimming Pool Builder', 'Hot Tub Installer',
    'Skip Hire', 'Waste Removal',
    // === Events and entertainment ===
    'Photographer', 'Videographer', 'DJ',
    'Magician', 'Face Painter', 'Caricaturist',
    'Event Planner', 'Wedding Planner', 'Party Planner',
    'Caterer', 'Cake Maker', 'Mobile Bar Hire',
    'Marquee Hire', 'Bouncy Castle Hire', 'Photo Booth Hire',
    'Venue Hire', 'Balloon Decorator', 'Event Decorator',
    'Florist', 'Limousine Hire', 'Live Band',
    'Wedding Singer', 'String Quartet', 'Comedian',
    'Children Entertainer', 'Toastmaster',
    // === Lessons and tutoring ===
    'Personal Trainer', 'Yoga Instructor', 'Pilates Instructor',
    'Dance Teacher', 'Singing Teacher', 'Piano Teacher',
    'Guitar Teacher', 'Drum Teacher', 'Violin Teacher',
    'Music Teacher', 'Swimming Teacher', 'Driving Instructor',
    'Maths Tutor', 'English Tutor', 'Science Tutor',
    'Language Tutor', 'Life Coach', 'Business Coach',
    'Martial Arts Instructor', 'Boxing Trainer', 'Golf Instructor',
    'Tennis Coach', 'Football Coach',
    // === Beauty and wellness ===
    'Makeup Artist', 'Hair Stylist', 'Mobile Hairdresser',
    'Beauty Therapist', 'Massage Therapist', 'Nail Technician',
    'Nutritionist', 'Physiotherapist', 'Chiropractor',
    'Osteopath', 'Acupuncturist', 'Counsellor',
    'Tattoo Artist', 'Personal Stylist',
    // === Business and professional ===
    'Accountant', 'Solicitor', 'Financial Adviser',
    'Web Designer', 'Graphic Designer', 'Logo Designer',
    'SEO Expert', 'Social Media Manager', 'Copywriter',
    'IT Support', 'App Developer', 'Bookkeeper',
    'Virtual Assistant', 'Business Consultant',
    'Translator', 'Proofreader',
    // === Pets ===
    'Dog Walker', 'Dog Groomer', 'Dog Trainer',
    'Pet Sitter', 'Mobile Dog Groomer', 'Cat Sitter',
    // === Transport ===
    'Man With Van', 'Courier', 'Car Transport',
    // === Misc services ===
    'Tailor', 'Upholsterer', 'Furniture Restoration',
    'Picture Framer', 'Locksmith Emergency', 'Key Cutting'
];

function csvExists(trade) {
    const slug = slugify(trade);
    const csvPath = path.join(OUTPUT_DIR, `bark-${slug}s.csv`);
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
    const csvPath = path.join(OUTPUT_DIR, `bark-${slug}s.csv`);
    if (!fs.existsSync(csvPath)) return 0;
    return Math.max(0, fs.readFileSync(csvPath, 'utf-8').trim().split('\n').length - 1);
}

function runScraper(trade) {
    return new Promise((resolve, reject) => {
        const slug = slugify(trade);
        const logPath = path.join(LOGS_DIR, `scrape-bark-${slug}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        const scraperArgs = [trade];
        if (recoveryMode) scraperArgs.push('--recovery');
        if (flareSolverrMode) scraperArgs.push('--flaresolverr');
        const flagLabel = flareSolverrMode ? ' --flaresolverr' : (recoveryMode ? ' --recovery' : '');
        console.log(`  Spawning: node scrape-bark.js "${trade}"${flagLabel}`);
        const child = spawn('node', ['scrape-bark.js', ...scraperArgs], {
            cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env }
        });

        child.stdout.pipe(logStream);
        child.stderr.pipe(logStream);
        child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('Phase') || line.includes('Complete') || line.includes('Total unique') || line.includes('WARNING')) {
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

    console.log('=== Scrape All Trades -- Bark (Plain HTTP) ===');
    if (instanceLabel) console.log(`Instance: ${instanceLabel} (${trades.length} of ${TRADE_CATEGORIES.length} trades)`);
    console.log(`Trades: ${trades.length}`);
    console.log(`Cooldown: ${COOLDOWN_MS / 1000}s\n`);

    if (dryRun) {
        for (const trade of trades) {
            const slug = slugify(trade);
            const status = csvExists(trade) ? 'SKIP' : 'PENDING';
            console.log(`  ${status.padEnd(10)} ${trade} -> bark-${slug}s.csv`);
        }
        return;
    }

    sendTelegram(tagMsg(`[BARK START] ${trades.length} trades`));
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
            const msg = rowCount > 0 ? tagMsg(`[BARK OK] ${trade}: ${rowCount} leads`) : tagMsg(`[BARK FAIL] ${trade}: empty`);
            console.log(`  ${msg}`);
            sendTelegram(msg);
            if (rowCount > 0) { progress.completed.push(trade); progress.counts[trade] = rowCount; completed++; }
            else { progress.failed.push(trade); failed++; }
        } catch (e) {
            const msg = tagMsg(`[BARK FAIL] ${trade}: ${e.message}`);
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

    const summary = tagMsg(`[BARK ALL DONE] ${completed}/${trades.length} trades | ${failed} failed | ${skipped} skipped`);
    console.log('\n' + summary);
    sendTelegram(summary);
}

main().catch(console.error);
