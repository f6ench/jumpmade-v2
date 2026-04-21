const fs = require('fs');
const path = require('path');
const { sendTelegram } = require('./telegram');

// Lazy-load puppeteer so HTTP-only scrapers don't need it installed
let puppeteer = null;
let puppeteerStealth = null;

function getPuppeteer() {
    if (!puppeteer) puppeteer = require('puppeteer');
    return puppeteer;
}

function getStealthPuppeteer() {
    if (!puppeteerStealth) {
        const puppeteerExtra = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteerExtra.use(StealthPlugin());
        puppeteerStealth = puppeteerExtra;
    }
    return puppeteerStealth;
}

// ============================================================
// Constants
// ============================================================

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'
];

// ============================================================
// Proxy rotation
// ============================================================

let proxies = [];
let proxyIndex = 0;

function loadProxies(proxyFile) {
    const proxyPath = path.resolve(proxyFile || './proxylist.txt');
    if (!fs.existsSync(proxyPath)) {
        console.log('No proxy file found -- running without proxies');
        return;
    }
    const lines = fs.readFileSync(proxyPath, 'utf-8').split('\n').filter(l => l.trim());
    proxies = lines.map(line => {
        const [host, port, username, password] = line.trim().split(':');
        return { host, port, username, password };
    });
    // Shuffle
    for (let i = proxies.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
    }
    console.log(`Loaded ${proxies.length} proxies`);
}

function getNextProxy() {
    if (proxies.length === 0) return null;
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    return proxy;
}

// ============================================================
// Browser management
// ============================================================

let currentProxy = null;
const activeBrowsers = new Set();

async function launchBrowser(options = {}) {
    currentProxy = getNextProxy();
    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
    if (currentProxy) {
        args.push(`--proxy-server=http://${currentProxy.host}:${currentProxy.port}`);
        console.log(`Using proxy: ${currentProxy.host}:${currentProxy.port}`);
    }
    const launcher = options.stealth ? getStealthPuppeteer() : getPuppeteer();
    const browser = await launcher.launch({ headless: 'new', args });
    activeBrowsers.add(browser);
    return browser;
}

async function forceCloseBrowser(browser) {
    if (!browser) return;
    activeBrowsers.delete(browser);
    try {
        const proc = browser.process();
        await browser.close().catch(() => {});
        // If Chrome is still alive after graceful close, kill it
        if (proc && !proc.killed) {
            try { proc.kill('SIGKILL'); } catch {}
        }
    } catch {
        // Last resort: try to get the PID and kill
        try {
            const proc = browser.process();
            if (proc) proc.kill('SIGKILL');
        } catch {}
    }
}

async function cleanupAllBrowsers() {
    for (const browser of activeBrowsers) {
        await forceCloseBrowser(browser);
    }
    activeBrowsers.clear();
}

// Kill all Chrome on exit to prevent zombies
process.on('exit', () => {
    for (const browser of activeBrowsers) {
        try { const p = browser.process(); if (p) p.kill('SIGKILL'); } catch {}
    }
});
process.on('SIGINT', async () => { await cleanupAllBrowsers(); process.exit(1); });
process.on('SIGTERM', async () => { await cleanupAllBrowsers(); process.exit(0); });

function getCurrentProxy() {
    return currentProxy;
}

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function newPage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(randomUserAgent());
    if (currentProxy) {
        await page.authenticate({ username: currentProxy.username, password: currentProxy.password });
    }
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    return page;
}

// ============================================================
// Utility functions
// ============================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function jitterDelay(min, max) {
    const ms = min + Math.floor(Math.random() * (max - min));
    return sleep(ms);
}

const slugify = (s) => s.toLowerCase().replace(/[\s\/]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-?s$/, '');

function csvEscape(val) {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function writeCSV(filePath, headers, rows) {
    const headerLine = headers.join(',');
    const dataLines = rows.map(row =>
        headers.map(h => csvEscape(row[h] || '')).join(',')
    );
    fs.writeFileSync(filePath, [headerLine, ...dataLines].join('\n'));
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ============================================================
// HTTP request helper (for scrapers that don't need Puppeteer)
// ============================================================

function httpGet(url, options = {}) {
    const mod = url.startsWith('https') ? require('https') : require('http');
    return new Promise((resolve, reject) => {
        const proxy = options.proxy || null;
        const headers = {
            'User-Agent': randomUserAgent(),
            'Accept-Language': 'en-GB,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ...(options.headers || {})
        };

        const parsed = new URL(url);
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers
        };

        const req = mod.request(reqOptions, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
                httpGet(redirectUrl, options).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });

        req.on('error', reject);
        req.setTimeout(options.timeout || 30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

// ============================================================
// FlareSolverr client (Cloudflare bypass)
// ============================================================

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';

function flareSolverPost(body) {
    const http = require('http');
    const parsed = new URL(FLARESOLVERR_URL);
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error(`FlareSolverr bad response: ${data.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('FlareSolverr timeout')); });
        req.write(payload);
        req.end();
    });
}

async function flareSolverGet(url, sessionId) {
    const body = { cmd: 'request.get', url, maxTimeout: 60000 };
    if (sessionId) body.session = sessionId;
    const resp = await flareSolverPost(body);
    if (resp.status !== 'ok') throw new Error(`FlareSolverr error: ${resp.message || JSON.stringify(resp)}`);
    return resp.solution.response;
}

async function flareSolverCreateSession(sessionId) {
    return flareSolverPost({ cmd: 'sessions.create', session: sessionId });
}

async function flareSolverDestroySession(sessionId) {
    return flareSolverPost({ cmd: 'sessions.destroy', session: sessionId }).catch(() => {});
}

async function flareSolverHealthCheck() {
    try {
        const http = require('http');
        const parsed = new URL(FLARESOLVERR_URL.replace('/v1', '/health'));
        return new Promise((resolve) => {
            const req = http.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, timeout: 5000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(true));
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    } catch { return false; }
}

// ============================================================
// Proxy exhaustion / block detection
// ============================================================

let consecutiveErrors = 0;
const BLOCK_PATTERNS = ['ERR_TUNNEL', 'ERR_PROXY', 'ECONNREFUSED', 'ECONNRESET', '407', '403', 'captcha', 'blocked', 'timeout', 'ETIMEDOUT', 'ERR_EMPTY_RESPONSE'];

async function checkForBlock(error) {
    const msg = (error.message || '').toLowerCase();
    if (!BLOCK_PATTERNS.some(p => msg.includes(p.toLowerCase()))) {
        consecutiveErrors = 0;
        return false;
    }
    consecutiveErrors++;
    console.log(`[BLOCK CHECK] Consecutive errors: ${consecutiveErrors}/5`);
    if (consecutiveErrors >= 5) {
        const resumeFile = path.resolve('./resume.txt');
        sendTelegram(`[BLOCKED] ${consecutiveErrors} consecutive proxy/block errors. PAUSED.\nCreate resume.txt to continue, or wait 5 min for auto-resume.`);
        // Wait up to 5 minutes for resume.txt, then auto-resume
        let waited = 0;
        while (!fs.existsSync(resumeFile) && waited < 300000) {
            await sleep(10000);
            waited += 10000;
        }
        if (fs.existsSync(resumeFile)) {
            try { fs.unlinkSync(resumeFile); } catch {}
        }
        consecutiveErrors = 0;
        sendTelegram('[RESUMED] Continuing after block pause.');
        return true;
    }
    return false;
}

function resetBlockErrors() {
    consecutiveErrors = 0;
}

module.exports = {
    loadProxies,
    getNextProxy,
    getCurrentProxy,
    launchBrowser,
    forceCloseBrowser,
    cleanupAllBrowsers,
    newPage,
    randomUserAgent,
    sleep,
    jitterDelay,
    slugify,
    csvEscape,
    writeCSV,
    ensureDir,
    sendTelegram,
    httpGet,
    getStealthPuppeteer,
    checkForBlock,
    resetBlockErrors,
    flareSolverGet,
    flareSolverCreateSession,
    flareSolverDestroySession,
    flareSolverHealthCheck,
    FLARESOLVERR_URL
};
