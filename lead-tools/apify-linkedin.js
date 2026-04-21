#!/usr/bin/env node
// Apify LinkedIn Company Search -- REST API + account rotation (Tier 1)
// Uses "Companies Search Scraper for LinkedIn | No Cookies" actor
// Usage: node apify-linkedin.js --input batch.csv --output linkedin-results.csv [--json]
//
// Input CSV: company_name, full_name, location, trade_type
// Output CSV: company_name, linkedin_company, linkedin_company_size, linkedin_owner_name, linkedin_owner_title

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseCSV } = require('./dedup-platforms');
const { sleep, writeCSV, sendTelegram } = require('./scraper-base');

// ============================================================
// Config
// ============================================================

const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf('--' + name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name) { return args.includes('--' + name); }

const INPUT_FILE = getArg('input', '');
const OUTPUT_FILE = getArg('output', 'linkedin-results.csv');
const JSON_OUTPUT = hasFlag('json');
const ACCOUNTS_FILE = path.resolve(getArg('accounts', './apify-accounts.json'));
const BATCH_SIZE = parseInt(getArg('batch-size', '10'));
const MAX_WAIT_MIN = parseInt(getArg('max-wait', '10'));
const MAX_RESULTS_PER_SEARCH = parseInt(getArg('max-results', '5'));

// Companies Search Scraper for LinkedIn | No Cookies (201k+ runs)
const ACTOR_ID = 'QwLfX9hYQXhA84LY3';

// ============================================================
// HTTP helpers
// ============================================================

function httpRequest(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const method = opts.method || 'GET';
        const body = opts.body ? JSON.stringify(opts.body) : null;
        const urlObj = new URL(url);

        const reqOpts = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
            }
        };

        const req = https.request(reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

// ============================================================
// Account management
// ============================================================

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.error(`No accounts file found at ${ACCOUNTS_FILE}`);
        console.error('Create apify-accounts.json with: { "accounts": [{ "token": "apify_api_..." }], "currentIndex": 0 }');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
}

function saveAccountIndex(config, newIndex) {
    config.currentIndex = newIndex;
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(config, null, 2));
}

function getCurrentAccount(config) {
    const idx = config.currentIndex || 0;
    if (idx >= config.accounts.length) {
        console.error('All Apify accounts exhausted');
        return null;
    }
    return config.accounts[idx];
}

function rotateAccount(config) {
    const next = (config.currentIndex || 0) + 1;
    if (next >= config.accounts.length) {
        console.log('[Apify] All accounts exhausted, wrapping to 0');
        saveAccountIndex(config, 0);
        return null;
    }
    saveAccountIndex(config, next);
    console.log(`[Apify] Rotated to account ${next + 1}/${config.accounts.length}`);
    return config.accounts[next];
}

// ============================================================
// Apify REST API
// ============================================================

async function startCompanySearch(token, keyword, maxResults) {
    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${token}`;
    const input = { keyword, maxResults };

    const res = await httpRequest(url, { method: 'POST', body: input });

    if (res.status === 402) {
        return 'QUOTA_EXCEEDED';
    }
    if (res.status !== 201 && res.status !== 200) {
        const errMsg = JSON.stringify(res.data).slice(0, 200);
        // actor-is-not-rented = need to rent, skip
        if (errMsg.includes('actor-is-not-rented')) return 'NOT_RENTED';
        console.log(`[Apify] Start failed: ${res.status} ${errMsg}`);
        return null;
    }

    return res.data?.data?.id;
}

async function waitForRun(token, runId) {
    const maxWaitMs = MAX_WAIT_MIN * 60 * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        await sleep(10000);

        const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`;
        const res = await httpRequest(url);

        if (res.status !== 200) continue;

        const status = res.data?.data?.status;
        if (status === 'SUCCEEDED') return res.data.data;
        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') return null;
    }

    return null;
}

async function getRunResults(token, runId) {
    const url = `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&format=json`;
    const res = await httpRequest(url);
    if (res.status !== 200) return null;
    return Array.isArray(res.data) ? res.data : null;
}

// ============================================================
// Result matching
// ============================================================

function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function matchCompanyResult(results, companyName, location) {
    if (!results || results.length === 0) return null;

    const cn = normalise(companyName);
    const loc = (location || '').toLowerCase();

    // Score each result
    let best = null;
    let bestScore = 0;

    for (const r of results) {
        const rName = normalise(r.name || '');
        const rLoc = (r.location || '').toLowerCase();
        const rDesc = (r.description || '').toLowerCase();
        let score = 0;

        // Exact normalised match
        if (rName === cn) score += 100;
        // One contains the other
        else if (rName.includes(cn) || cn.includes(rName)) score += 50;
        // Significant overlap
        else {
            const words = companyName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const matchedWords = words.filter(w => rName.includes(normalise(w)));
            if (matchedWords.length >= 2) score += 25 * matchedWords.length;
        }

        if (score === 0) continue;

        // Location bonus
        if (loc && rLoc) {
            const locParts = loc.split(/[,\s]+/).filter(p => p.length > 2);
            if (locParts.some(p => rLoc.includes(p))) score += 20;
        }

        // UK bonus (we're searching UK trades)
        if (rLoc && (rLoc.includes('united kingdom') || rLoc.includes(', uk') || rLoc.includes('england') || rLoc.includes('scotland') || rLoc.includes('wales'))) {
            score += 10;
        }

        // Trade/plumbing in description bonus
        if (rDesc.includes('plumb') || rDesc.includes('electric') || rDesc.includes('heat') || rDesc.includes('trade') || rDesc.includes('contractor')) {
            score += 5;
        }

        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    }

    if (!best || bestScore < 25) return null;

    return {
        linkedin_company: best.company_url || '',
        linkedin_company_size: '', // company search doesn't always return size
        linkedin_owner_name: '',
        linkedin_owner_title: ''
    };
}

// ============================================================
// Main
// ============================================================

async function runApifyBatch(inputFile, outputFile) {
    if (!inputFile || !fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        process.exit(1);
    }

    const leads = parseCSV(inputFile);
    console.log(`[Apify] Loaded ${leads.length} leads from ${inputFile}`);

    if (leads.length === 0) {
        console.log('[Apify] No leads to process');
        return new Map();
    }

    const config = loadAccounts();
    const allResults = new Map();
    let quotaExhausted = false;

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        if (quotaExhausted) break;

        const batch = leads.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(leads.length / BATCH_SIZE);
        console.log(`\n[Apify] Batch ${batchNum}/${totalBatches}: ${batch.length} leads`);

        // Run one actor search per lead in this batch (sequentially to avoid quota burn)
        for (const lead of batch) {
            if (quotaExhausted) break;
            if (allResults.has(lead.company_name)) continue;

            const keyword = `${lead.company_name} ${lead.location || ''}`.trim();
            const account = getCurrentAccount(config);
            if (!account) { quotaExhausted = true; break; }

            const runId = await startCompanySearch(account.token, keyword, MAX_RESULTS_PER_SEARCH);

            if (runId === 'QUOTA_EXCEEDED') {
                console.log(`[Apify] Quota hit on account ${(config.currentIndex || 0) + 1}`);
                const next = rotateAccount(config);
                if (!next) {
                    sendTelegram(`[Apify] All 5 accounts exhausted after ${allResults.size} matches`);
                    quotaExhausted = true;
                    break;
                }
                // Retry this lead
                const retryId = await startCompanySearch(next.token, keyword, MAX_RESULTS_PER_SEARCH);
                if (!retryId || retryId === 'QUOTA_EXCEEDED' || retryId === 'NOT_RENTED') continue;
                const retryData = await waitForRun(next.token, retryId);
                if (retryData) {
                    const results = await getRunResults(next.token, retryId);
                    const match = matchCompanyResult(results, lead.company_name, lead.location);
                    if (match) allResults.set(lead.company_name, match);
                }
                continue;
            }

            if (!runId || runId === 'NOT_RENTED') continue;

            const runData = await waitForRun(account.token, runId);
            if (!runData) continue;

            const results = await getRunResults(account.token, runId);
            const match = matchCompanyResult(results, lead.company_name, lead.location);
            if (match) {
                allResults.set(lead.company_name, match);
                console.log(`  [T1] ${lead.company_name} -> ${match.linkedin_company}`);
            }

            await sleep(2000); // cooldown between searches
        }

        const pct = leads.length > 0 ? Math.round(100 * allResults.size / Math.min(i + BATCH_SIZE, leads.length)) : 0;
        console.log(`[Apify] Progress: ${allResults.size} matches so far (${pct}%)`);
    }

    // Write output
    if (JSON_OUTPUT) {
        process.stdout.write(JSON.stringify(Object.fromEntries(allResults), null, 2));
    } else if (outputFile) {
        const headers = ['company_name', 'linkedin_company', 'linkedin_company_size', 'linkedin_owner_name', 'linkedin_owner_title'];
        const rows = [];
        for (const [companyName, data] of allResults) {
            rows.push({ company_name: companyName, ...data });
        }
        writeCSV(path.resolve(outputFile), headers, rows);
        console.log(`\n[Apify] Results written to ${outputFile} (${rows.length} matches)`);
    }

    return allResults;
}

// CLI entry point
if (require.main === module) {
    if (!INPUT_FILE) {
        console.log('Usage: node apify-linkedin.js --input batch.csv --output linkedin-results.csv [--json]');
        process.exit(1);
    }
    runApifyBatch(INPUT_FILE, OUTPUT_FILE).then(results => {
        console.log(`\n[Apify] Done. ${results.size} LinkedIn company matches found.`);
        process.exit(0);
    }).catch(err => {
        console.error(`[Apify] Fatal: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { runApifyBatch, matchCompanyResult };
