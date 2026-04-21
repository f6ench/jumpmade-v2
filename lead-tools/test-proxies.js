const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// Config
// ============================================================
const PROXY_FILE = process.argv[2] || './proxies.txt';
const OUTPUT_FILE = process.argv[3] || './proxies-fast.txt';
const CONCURRENCY = 50;          // 50 concurrent — no browsers, just HTTP
const TIMEOUT_MS = 10000;        // 10s max per proxy
const MAX_ACCEPTABLE_MS = 5000;  // only keep proxies under 5s
const TEST_URL = 'http://httpbin.org/ip'; // lightweight endpoint, returns JSON

// ============================================================
// Load proxies
// ============================================================
const lines = fs.readFileSync(path.resolve(__dirname, PROXY_FILE), 'utf-8')
    .split('\n').filter(l => l.trim());

const proxies = lines.map(line => {
    const [host, port, username, password] = line.trim().split(':');
    return { host, port, username, password, raw: line.trim() };
});

console.log(`Testing ${proxies.length} proxies (${CONCURRENCY} concurrent, ${TIMEOUT_MS}ms timeout)`);
console.log(`Keeping proxies faster than ${MAX_ACCEPTABLE_MS}ms\n`);

// ============================================================
// Test a single proxy via HTTP CONNECT
// ============================================================
function testProxy(proxy) {
    return new Promise(resolve => {
        const start = Date.now();
        const timer = setTimeout(() => {
            resolve({ proxy, ms: null, status: 'timeout' });
        }, TIMEOUT_MS);

        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');

        const req = http.request({
            host: proxy.host,
            port: parseInt(proxy.port),
            path: TEST_URL,
            method: 'GET',
            headers: {
                'Proxy-Authorization': `Basic ${auth}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
            },
            timeout: TIMEOUT_MS
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timer);
                const elapsed = Date.now() - start;
                // Check we got a valid response (httpbin returns {"origin": "x.x.x.x"})
                if (res.statusCode === 200 && data.includes('origin')) {
                    resolve({ proxy, ms: elapsed, status: 'ok' });
                } else if (res.statusCode === 407) {
                    resolve({ proxy, ms: null, status: 'auth_fail' });
                } else {
                    resolve({ proxy, ms: elapsed, status: `http_${res.statusCode}` });
                }
            });
        });

        req.on('error', () => {
            clearTimeout(timer);
            resolve({ proxy, ms: null, status: 'error' });
        });

        req.on('timeout', () => {
            req.destroy();
            clearTimeout(timer);
            resolve({ proxy, ms: null, status: 'timeout' });
        });

        req.end();
    });
}

// ============================================================
// Run with concurrency pool
// ============================================================
async function main() {
    const results = [];
    let done = 0;
    let passed = 0;

    for (let i = 0; i < proxies.length; i += CONCURRENCY) {
        const batch = proxies.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(testProxy));

        for (const r of batchResults) {
            done++;
            results.push(r);
            const tag = r.status === 'ok' ? `${r.ms}ms` : r.status;
            if (r.status === 'ok' && r.ms <= MAX_ACCEPTABLE_MS) passed++;
            const pct = Math.round(done / proxies.length * 100);
            process.stdout.write(`\r[${done}/${proxies.length}] ${pct}% | ${passed} fast | ${tag}    `);
        }
    }

    console.log('\n');

    const fast = results
        .filter(r => r.status === 'ok' && r.ms <= MAX_ACCEPTABLE_MS)
        .sort((a, b) => a.ms - b.ms);

    const ok = results.filter(r => r.status === 'ok').length;
    const slow = results.filter(r => r.status === 'ok' && r.ms > MAX_ACCEPTABLE_MS).length;
    const timeouts = results.filter(r => r.status === 'timeout').length;
    const errors = results.filter(r => !['ok', 'timeout'].includes(r.status)).length;

    console.log('========================================');
    console.log('  PROXY TEST RESULTS');
    console.log('========================================');
    console.log(`Total tested:   ${results.length}`);
    console.log(`Working:        ${ok}`);
    console.log(`Fast (<${MAX_ACCEPTABLE_MS}ms):  ${fast.length}`);
    console.log(`Slow:           ${slow}`);
    console.log(`Timeouts:       ${timeouts}`);
    console.log(`Errors/blocked: ${errors}`);

    if (fast.length > 0) {
        console.log(`\nFastest:      ${fast[0].ms}ms`);
        console.log(`Median:       ${fast[Math.floor(fast.length / 2)].ms}ms`);
        console.log(`Slowest kept: ${fast[fast.length - 1].ms}ms`);

        const output = fast.map(r => r.proxy.raw).join('\n') + '\n';
        fs.writeFileSync(path.resolve(__dirname, OUTPUT_FILE), output, 'utf-8');
        console.log(`\nSaved ${fast.length} fast proxies to ${OUTPUT_FILE}`);
    } else {
        console.log('\nNo fast proxies found.');
    }
}

main().catch(console.error);
