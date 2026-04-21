const fs = require('fs');

function parseCSV(t) {
  const r = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { q = false; }
      else { cell += c; }
    } else {
      if (c === '"') { q = true; }
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (cell || row.length) { row.push(cell); r.push(row); row = []; cell = ''; } }
      else { cell += c; }
    }
  }
  if (cell || row.length) { row.push(cell); r.push(row); }
  return r;
}

const rows = parseCSV(fs.readFileSync('./output/enriched-electricians-partial.csv', 'utf8'));
const h = rows[0];
const idx = {
  company: h.indexOf('company_name'),
  first: h.indexOf('first_name'),
  full: h.indexOf('full_name'),
  area: h.indexOf('area'),
  mobile: h.indexOf('mobile'),
  cp: h.indexOf('checkatrade_phone'),
  email: h.indexOf('email'),
  website: h.indexOf('website'),
  rating: h.indexOf('rating'),
  reviews: h.indexOf('reviews'),
  fit: h.indexOf('sniper_fit_tier'),
  score: h.indexOf('sniper_fit_score'),
  profile: h.indexOf('profile_url'),
};

// Known Checkatrade proxy prefixes
const proxyPrefixes = ['073072', '073085', '074271', '074413', '074481', '074469', '078468'];

let smsReady = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 10) continue;

  // Only use mobile field (from website scraping) -- checkatrade_phone is ALWAYS a proxy number
  let mob = (r[idx.mobile] || '').trim().replace(/[^0-9]/g, '');
  if (!mob.startsWith('07')) continue;
  let src = 'website';

  smsReady.push({
    company: r[idx.company] || '',
    first: r[idx.first] || r[idx.full] || '',
    area: r[idx.area] || '',
    mobile: mob,
    rating: r[idx.rating] || '',
    reviews: r[idx.reviews] || '',
    fit: r[idx.fit] || '',
    score: r[idx.score] || '',
    email: r[idx.email] || '',
    website: r[idx.website] || '',
    profile: r[idx.profile] || '',
    src: src,
  });
}

// Dedupe by phone number
const seen = new Set();
const deduped = smsReady.filter(r => {
  if (seen.has(r.mobile)) return false;
  seen.add(r.mobile);
  return true;
});

// Write CSV for GHL import
let csv = 'first_name,company_name,phone,area,rating,reviews,sniper_fit_tier,sniper_fit_score,email,website,checkatrade_url,trade_type,lead_source,phone_source\n';
deduped.forEach(r => {
  const intl = '+44' + r.mobile.substring(1);
  csv += `"${r.first}","${r.company}","${intl}","${r.area}","${r.rating}","${r.reviews}","${r.fit}","${r.score}","${r.email}","${r.website}","${r.profile}","electrician","checkatrade_enrichment","${r.src}"\n`;
});

fs.writeFileSync('./output/sms-ready-electricians.csv', csv);
console.log('Total SMS-ready electricians: ' + deduped.length);
console.log('From mobile field: ' + deduped.filter(r => r.src === 'mobile').length);
console.log('From checkatrade_phone (non-proxy): ' + deduped.filter(r => r.src === 'checkatrade_phone').length);
