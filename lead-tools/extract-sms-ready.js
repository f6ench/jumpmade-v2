const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
    inputFiles: [
        path.resolve(__dirname, 'output/enriched-plumbers-batch1-recovered.csv'),
        path.resolve(__dirname, 'output/enriched-plumbers-batch2a.csv'),
        path.resolve(__dirname, 'output/enriched-plumbers-batch2b.csv')
    ],
    outputFile: path.resolve(__dirname, 'output/sms-ready-leads.csv'),
    pollInterval: 60000,
    watch: process.argv.includes('--watch'),
    geminiApiKey: process.argv[2] && !process.argv[2].startsWith('--')
        ? process.argv[2]
        : (process.env.GEMINI_API_KEY || ''),
    batchSize: 25 // numbers per Gemini call
};

// GHL import header
const GHL_COLUMNS = ['firstName', 'lastName', 'companyName', 'phone', 'email', 'website', 'city', 'all_emails'];

// ============================================================
// CSV parsing (handles quoted fields with commas)
// ============================================================
function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields;
}

function parseCSV(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
        rows.push(row);
    }
    return rows;
}

// ============================================================
// Phone number validation
// ============================================================
// ALL numbers from checkatrade_phone are tracking/redirect numbers.
// Only use mobile and all_phones fields (scraped from business websites).

function isValidMobile(digits) {
    return digits.startsWith('07') && digits.length === 11;
}

function extractMobilesFromField(field) {
    const numbers = [];
    const parts = field.split(';').map(s => s.trim());
    for (const part of parts) {
        const digits = part.replace(/\D/g, '');
        if (isValidMobile(digits)) numbers.push(digits);
    }
    return numbers;
}

function extract07Mobile(row) {
    // Only use mobile and all_phones (scraped from business websites)
    // NEVER use checkatrade_phone — those are all tracking numbers
    const mob = extractMobilesFromField(row.mobile || '');
    if (mob.length > 0) return mob[0];

    const ap = extractMobilesFromField(row.all_phones || '');
    if (ap.length > 0) return ap[0];

    return null;
}

// ============================================================
// Gemini AI phone verification
// ============================================================
async function verifyPhonesWithAI(leads) {
    if (!CONFIG.geminiApiKey) {
        console.log('No Gemini API key — skipping AI verification');
        return leads;
    }

    const genAI = new GoogleGenerativeAI(CONFIG.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const verified = [];
    let flagged = 0;

    for (let i = 0; i < leads.length; i += CONFIG.batchSize) {
        const batch = leads.slice(i, i + CONFIG.batchSize);
        const numbersForReview = batch.map((l, idx) => ({
            idx: i + idx,
            company: l.companyName,
            phone: l.phone,
            email: l.email,
            website: l.website
        }));

        const prompt = `You are a UK phone number validator for SMS marketing. Review these business phone numbers and flag any that are NOT real UK mobile numbers suitable for receiving SMS.

Flag a number as INVALID if:
- It looks like a landline (01x, 02x, 03x patterns even with 07 prefix due to data error)
- It looks like a premium rate or virtual/VoIP number
- It matches known tracking/redirect number patterns (Checkatrade uses 073x, 074x ranges)
- The number format is wrong (not 11 digits starting with 07 when converted to local)
- It looks like a fax number

Return ONLY a JSON array of the idx values that are INVALID. If all are valid, return [].
Example: [0, 3, 7]

Numbers to review:
${JSON.stringify(numbersForReview, null, 2)}`;

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            // Extract JSON array from response
            const match = text.match(/\[[\d,\s]*\]/);
            const invalidIdxs = match ? JSON.parse(match[0]) : [];
            const invalidSet = new Set(invalidIdxs);

            for (let j = 0; j < batch.length; j++) {
                if (invalidSet.has(i + j)) {
                    flagged++;
                } else {
                    verified.push(batch[j]);
                }
            }
        } catch (err) {
            console.log(`AI verification error on batch ${Math.floor(i / CONFIG.batchSize) + 1}: ${err.message}`);
            // On error, include the batch (don't lose leads due to API issues)
            verified.push(...batch);
        }

        // Delay between batches to avoid rate limits
        if (i + CONFIG.batchSize < leads.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (flagged > 0) console.log(`AI flagged ${flagged} suspicious numbers`);
    return verified;
}

// ============================================================
// Gemini AI mobile number recovery
// ============================================================
// For leads where we couldn't extract a mobile from mobile/all_phones,
// send all available phone data to Gemini to identify any real mobiles
// hidden in the data (e.g. concatenated numbers, misplaced fields).
async function recoverMobilesWithAI(rows, seenNumbers) {
    if (!CONFIG.geminiApiKey || rows.length === 0) return [];

    const genAI = new GoogleGenerativeAI(CONFIG.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const recovered = [];

    for (let i = 0; i < rows.length; i += CONFIG.batchSize) {
        const batch = rows.slice(i, i + CONFIG.batchSize);
        const data = batch.map((row, idx) => ({
            idx,
            company: row.company_name || '',
            checkatrade_phone: row.checkatrade_phone || '',
            mobile_field: row.mobile || '',
            landline: row.landline || '',
            all_phones: row.all_phones || '',
            website: row.website || ''
        }));

        const prompt = `You are parsing UK business phone data to find real mobile numbers for SMS outreach.

Rules:
- ALL numbers in checkatrade_phone are Checkatrade tracking/redirect numbers — NEVER return these
- The mobile_field and all_phones sometimes contain concatenated numbers (e.g. "0745328015302031059958" = "07453280153" + "02031059958")
- The mobile_field sometimes contains emails instead of phone numbers — ignore those
- A valid UK mobile is exactly 11 digits starting with 07
- Look for real mobile numbers that might be hidden in concatenated strings

For each entry, extract any REAL mobile number you can find (NOT from checkatrade_phone).
Return a JSON array of objects: [{"idx": 0, "mobile": "07xxx"}, ...]
Only include entries where you found a valid mobile. Return [] if none found.

Data:
${JSON.stringify(data, null, 2)}`;

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            const match = text.match(/\[[\s\S]*?\]/);
            if (!match) continue;
            const found = JSON.parse(match[0]);

            for (const item of found) {
                const digits = (item.mobile || '').replace(/\D/g, '');
                if (!isValidMobile(digits)) continue;
                if (seenNumbers.has(digits)) continue;
                seenNumbers.add(digits);

                const row = batch[item.idx];
                recovered.push({
                    firstName: row.first_name || '',
                    lastName: row.last_name || '',
                    companyName: row.company_name || '',
                    phone: formatPhoneGHL(digits),
                    email: row.email || '',
                    website: row.website || '',
                    city: row.area || '',
                    all_emails: row.all_emails || ''
                });
            }
        } catch (err) {
            console.log(`AI recovery error on batch ${Math.floor(i / CONFIG.batchSize) + 1}: ${err.message}`);
        }

        if (i + CONFIG.batchSize < rows.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (recovered.length > 0) console.log(`AI recovered ${recovered.length} additional mobiles from messy data`);
    return recovered;
}

// ============================================================
// Format phone for GHL (add +44 prefix)
// ============================================================
function formatPhoneGHL(digits) {
    return '+44' + digits.slice(1);
}

// ============================================================
// Escape CSV field
// ============================================================
function csvEscape(val) {
    if (!val) return '';
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
}

// ============================================================
// Main extraction
// ============================================================
async function extract() {
    const seen = new Set();
    let leads = [];

    for (const file of CONFIG.inputFiles) {
        const rows = parseCSV(file);
        for (const row of rows) {
            const mobile = extract07Mobile(row);
            if (!mobile) continue;
            if (seen.has(mobile)) continue;
            seen.add(mobile);

            leads.push({
                firstName: row.first_name || '',
                lastName: row.last_name || '',
                companyName: row.company_name || '',
                phone: formatPhoneGHL(mobile),
                email: row.email || '',
                website: row.website || '',
                city: row.area || '',
                all_emails: row.all_emails || ''
            });
        }
    }

    // AI discovery: try to find real mobiles for leads we missed
    const missed = [];
    for (const file of CONFIG.inputFiles) {
        const rows = parseCSV(file);
        for (const row of rows) {
            const mobile = extract07Mobile(row);
            if (mobile) continue; // already have a number
            // Collect all phone data for AI analysis
            const allNums = [
                row.checkatrade_phone || '',
                row.mobile || '',
                row.landline || '',
                row.all_phones || ''
            ].filter(Boolean).join('; ');
            if (!allNums.trim()) continue;
            missed.push(row);
        }
    }

    if (missed.length > 0) {
        const recovered = await recoverMobilesWithAI(missed, seen);
        leads.push(...recovered);
    }

    const preCount = leads.length;

    // AI verification pass
    leads = await verifyPhonesWithAI(leads);

    // Write output
    const header = GHL_COLUMNS.join(',');
    const csvRows = leads.map(lead =>
        GHL_COLUMNS.map(col => csvEscape(lead[col])).join(',')
    );
    const output = [header, ...csvRows].join('\n') + '\n';
    fs.writeFileSync(CONFIG.outputFile, output);

    return { total: preCount, verified: leads.length };
}

// ============================================================
// Run
// ============================================================
let previousCount = 0;

async function run() {
    const { total, verified } = await extract();
    const newLeads = verified - previousCount;
    const timestamp = new Date().toLocaleTimeString('en-GB');
    const removed = total - verified;
    console.log(`[${timestamp}] SMS-ready: ${verified} leads (${removed} filtered by AI)${previousCount > 0 ? ` (${newLeads} new)` : ''}`);
    previousCount = verified;
}

// Initial run
run().then(() => {
    if (CONFIG.watch) {
        console.log(`Watching for changes every ${CONFIG.pollInterval / 1000}s... (Ctrl+C to stop)`);
        setInterval(() => run(), CONFIG.pollInterval);
    }
});
