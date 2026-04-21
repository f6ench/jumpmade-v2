/**
 * validate-mobiles.js - HLR validation for recovered mobile numbers
 * Uses Abstract API Phone Validation (free tier: 100 lookups/month)
 *
 * Usage: node validate-mobiles.js [input.csv] [--key=YOUR_API_KEY]
 *
 * Sign up free: https://www.abstractapi.com/api/phone-validation-api
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// Config
const API_KEY = process.argv.find(a => a.startsWith('--key='))?.split('=')[1] || process.env.ABSTRACT_PHONE_KEY || '';
const INPUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'output/mobiles-for-clearout.csv';
const OUTPUT = INPUT.replace('.csv', '-validated.csv');
const PROGRESS_FILE = INPUT.replace('.csv', '-validate-progress.json');
const RATE_LIMIT_MS = 350; // 3 req/sec max on free tier, stay safe

if (!API_KEY) {
    console.error('No API key provided.');
    console.error('Sign up free at: https://www.abstractapi.com/api/phone-validation-api');
    console.error('Then run: node validate-mobiles.js --key=YOUR_KEY');
    process.exit(1);
}

function fetchValidation(phone) {
    return new Promise((resolve, reject) => {
        const url = `https://phonevalidation.abstractapi.com/v1/?api_key=${API_KEY}&phone=${encodeURIComponent(phone)}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Parse error: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCSVLine(line) {
    const fields = []; let field = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQuotes = !inQuotes; }
        else if (line[i] === ',' && !inQuotes) { fields.push(field); field = ''; }
        else { field += line[i]; }
    }
    fields.push(field);
    return fields;
}

async function main() {
    console.log(`Validating mobiles from: ${INPUT}`);

    const csv = fs.readFileSync(INPUT, 'utf-8');
    const lines = csv.split('\n').filter(l => l.trim());
    const header = lines[0];
    const rows = lines.slice(1).map(l => {
        const fields = parseCSVLine(l);
        return { phone: fields[0], company: fields[1], profile_url: fields[2], raw: l };
    });

    // Load progress
    let progress = {};
    if (fs.existsSync(PROGRESS_FILE)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        console.log(`Resuming - ${Object.keys(progress).length} already validated`);
    }

    const results = [];
    let valid = 0, invalid = 0, errors = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const phone = row.phone.trim();

        if (progress[phone]) {
            results.push(progress[phone]);
            if (progress[phone].valid) valid++;
            else invalid++;
            continue;
        }

        // Format for UK: add country code
        const intlPhone = phone.startsWith('0') ? '+44' + phone.slice(1) : phone;

        try {
            const res = await fetchValidation(intlPhone);

            const result = {
                phone: phone,
                company: row.company,
                profile_url: row.profile_url,
                valid: res.valid !== false,
                type: res.type || '',
                carrier: res.carrier || '',
                country: res.country?.name || '',
                location: res.location || '',
                format_international: res.format?.international || '',
                format_national: res.format?.national || '',
            };

            results.push(result);
            progress[phone] = result;

            if (result.valid) valid++;
            else invalid++;

            const status = result.valid ? 'VALID' : 'INVALID';
            console.log(`[${i+1}/${rows.length}] ${phone} -> ${status} | ${result.type} | ${result.carrier}`);

            // Save progress every 10
            if ((i + 1) % 10 === 0) {
                fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
            }

            await sleep(RATE_LIMIT_MS);
        } catch (err) {
            console.error(`[${i+1}/${rows.length}] ${phone} -> ERROR: ${err.message}`);
            errors++;

            // Check for rate limit
            if (err.message.includes('429') || err.message.includes('rate')) {
                console.log('Rate limited - waiting 5s...');
                await sleep(5000);
                i--; // retry
                continue;
            }
        }
    }

    // Save final progress
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    // Write validated CSV
    const outLines = ['phone_number,company_name,profile_url,valid,type,carrier,location'];
    for (const r of results) {
        outLines.push([
            r.phone,
            '"' + (r.company || '').replace(/"/g, '""') + '"',
            '"' + (r.profile_url || '') + '"',
            r.valid,
            r.type,
            '"' + (r.carrier || '').replace(/"/g, '""') + '"',
            '"' + (r.location || '') + '"'
        ].join(','));
    }
    fs.writeFileSync(OUTPUT, outLines.join('\n'));

    // Write valid-only extract
    const validOnly = results.filter(r => r.valid && (r.type === 'mobile' || r.type === '' || !r.type));
    const validFile = INPUT.replace('.csv', '-valid-mobiles.csv');
    const validLines = ['phone_number,company_name,profile_url,carrier'];
    for (const r of validOnly) {
        validLines.push([
            r.phone,
            '"' + (r.company || '').replace(/"/g, '""') + '"',
            '"' + (r.profile_url || '') + '"',
            '"' + (r.carrier || '').replace(/"/g, '""') + '"'
        ].join(','));
    }
    fs.writeFileSync(validFile, validLines.join('\n'));

    // Summary
    console.log('\n--- Validation Summary ---');
    console.log(`Total:   ${results.length}`);
    console.log(`Valid:   ${valid}`);
    console.log(`Invalid: ${invalid}`);
    console.log(`Errors:  ${errors}`);
    console.log(`\nValid mobiles: ${validOnly.length}`);
    console.log(`\nOutput: ${OUTPUT}`);
    console.log(`Valid mobiles only: ${validFile}`);

    // Type breakdown
    const types = {};
    for (const r of results) {
        const t = r.type || 'unknown';
        types[t] = (types[t] || 0) + 1;
    }
    console.log('\nBy type:');
    for (const [t, c] of Object.entries(types)) {
        console.log(`  ${t}: ${c}`);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
