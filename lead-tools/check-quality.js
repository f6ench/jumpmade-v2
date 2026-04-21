const fs = require('fs');
const file = process.argv[2] || './output/enriched-plumbers-batch1.csv';

function parseCsvRow(row) {
    const f = [];
    let c = '', q = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') { q = !q; }
        else if (ch === ',' && !q) { f.push(c.trim().replace(/^"|"$/g, '')); c = ''; }
        else { c += ch; }
    }
    f.push(c.trim().replace(/^"|"$/g, ''));
    return f;
}

const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
const hdr = parseCsvRow(lines[0]);
const col = name => hdr.indexOf(name);

const total = lines.length - 1;
console.log(`\nFile: ${file}`);
console.log(`Total leads: ${total}\n`);

let stats = { mobile: 0, landline: 0, anyPhone: 0, email: 0, website: 0, linkedin: 0, ctPhone: 0 };

for (let i = 1; i < lines.length; i++) {
    const c = parseCsvRow(lines[i]);
    if (c[col('mobile')]) stats.mobile++;
    if (c[col('landline')]) stats.landline++;
    if (c[col('mobile')] || c[col('landline')] || c[col('checkatrade_phone')]) stats.anyPhone++;
    if (c[col('checkatrade_phone')]) stats.ctPhone++;
    if (c[col('email')]) stats.email++;
    if (c[col('website')]) stats.website++;
    if (c[col('linkedin_company')] || c[col('linkedin_owner')]) stats.linkedin++;
}

const p = n => total ? Math.round(n / total * 100) : 0;
console.log('CONTACT DATA:');
console.log(`  Checkatrade phone: ${stats.ctPhone} (${p(stats.ctPhone)}%)`);
console.log(`  Mobile (scraped):  ${stats.mobile} (${p(stats.mobile)}%)`);
console.log(`  Landline (scraped):${stats.landline} (${p(stats.landline)}%)`);
console.log(`  Any phone:         ${stats.anyPhone} (${p(stats.anyPhone)}%)`);
console.log(`  Email:             ${stats.email} (${p(stats.email)}%)`);
console.log(`  Website:           ${stats.website} (${p(stats.website)}%)`);
console.log(`  LinkedIn:          ${stats.linkedin} (${p(stats.linkedin)}%)`);

// SMS-ready = has mobile number (07xxx)
console.log(`\nSMS-READY (has mobile): ${stats.mobile} / ${total} (${p(stats.mobile)}%)`);

// Sample 10 leads
console.log('\n--- SAMPLE (first 10) ---');
for (let i = 1; i <= 10 && i < lines.length; i++) {
    const c = parseCsvRow(lines[i]);
    const name = c[col('company_name')];
    const mob = c[col('mobile')] || '-';
    const land = c[col('landline')] || '-';
    const em = c[col('email')] || '-';
    const web = c[col('website')] ? 'Y' : 'N';
    console.log(`  ${name} | mob:${mob} | land:${land} | email:${em.substring(0,30)} | web:${web}`);
}
