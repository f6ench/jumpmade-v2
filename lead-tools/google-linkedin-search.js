// Google Custom Search API wrapper for LinkedIn enrichment (Tier 2)
// Requires: GOOGLE_CSE_KEY and GOOGLE_CSE_CX env vars (or pass in config)
// Set up a Programmable Search Engine scoped to linkedin.com/*

const https = require('https');

const DEFAULT_KEY = process.env.GOOGLE_CSE_KEY || '';
const DEFAULT_CX = process.env.GOOGLE_CSE_CX || '';

function googleSearch(query, opts = {}) {
    const key = opts.key || DEFAULT_KEY;
    const cx = opts.cx || DEFAULT_CX;
    if (!key || !cx) return Promise.resolve(null);

    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=5`;

    return new Promise((resolve) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        console.log(`  [Google CSE] API error: ${json.error.message}`);
                        resolve(null);
                        return;
                    }
                    resolve(json.items || []);
                } catch {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    });
}

// Extract employee count from LinkedIn snippet text
function parseEmployeeCount(snippet) {
    if (!snippet) return '';
    // Patterns: "11-50 employees", "1,001-5,000 employees", "501-1000 employees"
    const match = snippet.match(/(\d[\d,]*(?:\s*-\s*\d[\d,]*)?)\s*employees?/i);
    if (match) return match[1].replace(/\s/g, '');
    // "X followers" sometimes correlates but not useful as size
    return '';
}

// Extract title/headline from snippet
function parseTitle(snippet) {
    if (!snippet) return '';
    // Common patterns: "John Smith - Plumber at Smith Ltd", "Director at ...", "Owner | ..."
    const patterns = [
        /^([^.]+?)\s*[-|]\s*([^.]+?)(?:\s*[-|]\s*LinkedIn)?$/i,
        /(?:^|\.\s+)([A-Z][a-z]+ [A-Z][a-z]+)\s*[-|]\s*(.+?)(?:\s*[-|]|$)/,
    ];
    for (const p of patterns) {
        const m = snippet.match(p);
        if (m) return m[2] ? m[2].trim() : m[1].trim();
    }
    return '';
}

async function googleLinkedInCompany(companyName, area, opts) {
    const query = `site:linkedin.com/company "${companyName}" ${area || ''}`.trim();
    const results = await googleSearch(query, opts);
    if (!results || results.length === 0) return null;

    for (const item of results) {
        const link = (item.link || '').toLowerCase();
        if (link.includes('linkedin.com/company/')) {
            const size = parseEmployeeCount(item.snippet || '');
            return {
                url: item.link,
                size: size,
                snippet: (item.snippet || '').slice(0, 200)
            };
        }
    }
    return null;
}

async function googleLinkedInPerson(fullName, companyName, opts) {
    if (!fullName) return null;
    const query = `site:linkedin.com/in "${fullName}" "${companyName}"`.trim();
    const results = await googleSearch(query, opts);
    if (!results || results.length === 0) return null;

    for (const item of results) {
        const link = (item.link || '').toLowerCase();
        if (link.includes('linkedin.com/in/')) {
            const title = parseTitle(item.snippet || '') || parseTitle(item.title || '');
            return {
                url: item.link,
                name: fullName,
                title: title,
                snippet: (item.snippet || '').slice(0, 200)
            };
        }
    }
    return null;
}

module.exports = { googleLinkedInCompany, googleLinkedInPerson };
