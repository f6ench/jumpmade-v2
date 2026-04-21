const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

// Load proxies
const proxyPath = path.join(__dirname, 'proxylist (2).txt');
const proxyLines = fs.readFileSync(proxyPath, 'utf-8').split('\n').filter(l => l.trim());
const proxies = proxyLines.map(line => {
    const [host, port, user, pass] = line.trim().split(':');
    return { host, port, user, pass };
});
let proxyIdx = 0;
function getProxy() {
    const p = proxies[proxyIdx % proxies.length];
    proxyIdx++;
    return p;
}

// Known-good control trade (must return results to validate test works)
const CONTROL = 'Plumbers';

// Old API categories NOT in the new 24 list + variations
const trades = [
    'Air Conditioning', 'Asbestos Services', 'Bedrooms', 'Bricklayer',
    'Carpet and Upholstery Cleaning', 'Chimney Sweep',
    'Damp Proofer', 'Drain / Sewer Clearance',
    'Driveways / Patios / Paths', 'Drone Surveying',
    'Fascia / Soffits / Guttering',
    'Garage Doors', 'Gardener', 'Glass', 'Grass Cutting', 'Groundworks',
    'Insulation', 'Interior Designer',
    'Oven Cleaning', 'Pest / Vermin Control', 'Removals / Storage',
    'Renewable Energy', 'Rubbish / Waste / Clearance', 'Scaffolder',
    'Shop Fitting', 'Stonemason', 'Surface Repair', 'Surveying',
    'Swimming Pools', 'Tree Surgeon', 'Weather Coatings',
    // Variations
    'Gardeners', 'Bricklayers', 'Chimney Sweeps', 'Damp Proofing',
    'Drain Clearance', 'Driveway Contractor', 'Pest Control',
    'Removals', 'Scaffolding', 'Tree Surgeons', 'Oven Cleaner',
    'Rubbish Clearance', 'Stonemasons', 'Driveways',
    'Boiler Installer', 'Gas Engineer', 'Kitchen Fitter',
    'Flooring Fitter', 'Skip Hire', 'Paving', 'Decking',
    'Loft Conversion', 'Extension Builder', 'Driveway Installer',
    'Groundworker', 'Garage Door Fitter'
];

async function testTrade(page, trade) {
    const url = 'https://www.checkatrade.com/Search/' + encodeURIComponent(trade) + '/in/London';
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));

    const info = await page.evaluate(() => {
        const body = document.body ? document.body.innerText : '';
        const h1 = document.querySelector('h1');
        const h1Text = h1 ? h1.textContent.trim() : '';
        // Check for Cloudflare block
        if (body.includes('security verification') || body.includes('Cloudflare')) {
            return { blocked: true, h1: h1Text, count: 0 };
        }
        // Try to find result count from page text
        const match = body.match(/(\d[\d,]*)\s+results?/i) || body.match(/of\s+(\d[\d,]*)/i);
        const count = match ? parseInt(match[1].replace(/,/g, '')) : 0;
        // Also check for trade cards/links
        const links = document.querySelectorAll('a');
        let tradeLinks = 0;
        links.forEach(a => { if (a.href && a.href.includes('/trades/')) tradeLinks++; });
        return { blocked: false, h1: h1Text, count, tradeLinks };
    });

    return info;
}

(async () => {
    const results = [];
    let browser;
    let browserAge = 0;

    // Test control trade first
    const proxy = getProxy();
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', `--proxy-server=http://${proxy.host}:${proxy.port}`]
    });
    let page = await browser.newPage();
    await page.authenticate({ username: proxy.user, password: proxy.pass });

    console.log('Testing control trade: ' + CONTROL);
    const control = await testTrade(page, CONTROL);
    console.log(`Control: blocked=${control.blocked} count=${control.count} tradeLinks=${control.tradeLinks} h1="${control.h1}"`);
    await page.close();

    if (control.blocked) {
        console.log('\nCloudflare is blocking even with stealth. Cannot test.');
        await browser.close();
        process.exit(1);
    }

    if (control.count === 0 && control.tradeLinks === 0) {
        console.log('\nControl trade returned 0 results. Selector issue. Cannot test.');
        await browser.close();
        process.exit(1);
    }

    console.log('Control passed. Testing ' + trades.length + ' trades...\n');

    for (let i = 0; i < trades.length; i++) {
        const trade = trades[i];

        // Rotate browser every 8 trades
        if (i > 0 && i % 8 === 0) {
            await browser.close();
            const p = getProxy();
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', `--proxy-server=http://${p.host}:${p.port}`]
            });
        }

        page = await browser.newPage();
        const p = getProxy();
        await page.authenticate({ username: p.user, password: p.pass });

        try {
            const info = await testTrade(page, trade);
            if (info.blocked) {
                console.log(`BLOCK| ${trade.padEnd(35)} | Cloudflare blocked`);
            } else {
                const has = info.count > 0 || info.tradeLinks > 0;
                const status = has ? 'YES' : 'NO';
                console.log(`${status.padEnd(4)} | ${trade.padEnd(35)} | count=${info.count} links=${info.tradeLinks} | ${info.h1}`);
                if (has) results.push(trade);
            }
        } catch(e) {
            console.log(`ERR  | ${trade.padEnd(35)} | ${e.message.substring(0, 60)}`);
        }
        await page.close();
        await new Promise(r => setTimeout(r, 1000));
    }

    if (browser) await browser.close();

    console.log('\n=== TRADES WITH RESULTS ===');
    results.forEach(t => console.log('  ' + t));
    console.log(`\nTotal: ${results.length} / ${trades.length}`);
})();
