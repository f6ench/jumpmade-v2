const fs = require('fs');
const path = require('path');
const https = require('https');
const {
    loadProxies, getNextProxy, launchBrowser, forceCloseBrowser, cleanupAllBrowsers, newPage,
    sleep, jitterDelay, slugify, csvEscape, writeCSV, ensureDir,
    sendTelegram, checkForBlock, resetBlockErrors
} = require('./scraper-base');
const {
    buildCrossPlatformIndex, matchCrossPlatform,
    normalizeName, normalizePhone, extractDomain,
    parseCSV, parseCSVLine
} = require('./dedup-platforms');
const { googleLinkedInCompany, googleLinkedInPerson } = require('./google-linkedin-search');
const { execFileSync } = require('child_process');




// ============================================================
// Configuration
// ============================================================

const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf('--' + name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
function hasFlag(name) { return args.includes('--' + name); }

const CONFIG = {
    inputDir: path.resolve(getArg('input', hasFlag('use-master') ? './output/master/' : './output/checkatrade/')),
    outputDir: path.resolve(getArg('output', './output/enriched/')),
    trade: getArg('trade', null),
    instance: parseInt(getArg('instance', '1')),
    totalInstances: parseInt(getArg('of', '1')),
    resume: hasFlag('resume'),
    noProxy: hasFlag('no-proxy'),
    useMaster: hasFlag('use-master'),
    skipTrades: getArg('skip-trades', '').split(',').filter(Boolean),
    proxyFile: './proxies-fast.txt',
    companiesHouseApiKey: process.env.CH_API_KEY || 'aa5649ec-60cd-4644-9580-6ac533ef2c40',
    checkpointEvery: 25,
    browserRotateEvery: 8,
    telegramEvery: 100,
    minDelay: hasFlag('no-proxy') ? 5000 : 3000,
    maxDelay: hasFlag('no-proxy') ? 10000 : 6000
};

// Priority order for trades
const TRADE_PRIORITY = [
    'plumber', 'electrician', 'boiler-engineer', 'roofer', 'bathroom',
    'kitchen', 'builder', 'carpenter', 'landscaper', 'plasterer',
    'bricklayer', 'gardener', 'handyman', 'locksmith', 'scaffolder',
    'glass', 'groundwork', 'chimney-sweep', 'bedroom', 'insulation',
    'stonemason', 'surveying', 'telecommunication', 'carpet-and-upholstery-cleaning'
];

// Search engine delay: slower on direct IP to avoid rate limits
function searchDelay() {
    return CONFIG.noProxy
        ? sleep(8000 + Math.random() * 7000)   // 8-15s on direct
        : sleep(2000 + Math.random() * 2000);   // 2-4s on proxy
}

// Non-business domains to skip
const SKIP_DOMAINS = [
    'checkatrade.com', 'yell.com', '192.com', 'yelp.com', 'cylex',
    'facebook.com', 'linkedin.com', 'twitter.com', 'instagram.com',
    'google.com', 'gov.uk', 'wikipedia.org', 'youtube.com',
    'trustatrader.com', 'mybuilder.com', 'bark.com', 'trustpilot.com',
    'nextdoor.co.uk', 'freeindex.co.uk', 'endole.co.uk', 'findatrader',
    'thebestof.co.uk', 'rated-people.com', 'localsearch', 'scoot.co.uk',
    'apple.com', 'hotfrog.co.uk', 'misterwhat.co.uk', 'which.co.uk',
    'amazon.co.uk', 'amazon.com', 'ebay.co.uk', 'gumtree.com',
    'thomson-local.com', 'touchlocal.com', 'brownbook.net', 'dnb.com',
    'companieshouse.gov.uk', 'glassdoor.', 'indeed.', 'reed.co.uk',
    'duckduckgo.com', 'bing.com', 'bbb.org', 'reddit.com', 'quora.com',
    'myjobquote.co.uk', 'ratedpeople.com', 'x.com', 'tiktok.com',
    'pinterest.com', 'threads.net', 'substack.com', 'medium.com',
    '9tuma.app.link', 'app.link'
];

// Tracking number detection: trust SOURCE not pattern (see memory/feedback_tracking-numbers.md)

// Non-UK domain TLDs
const NON_UK_TLDS = ['.com.au', '.co.nz', '.ca', '.us', '.in', '.ie'];

// ============================================================
// Phone validation
// ============================================================

function isValidUKMobile(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length !== 11) return false;
    if (!cleaned.startsWith('07')) return false;
    if (cleaned.startsWith('070')) return false;
    if (cleaned.startsWith('076')) return false;
    return true;
}

function isValidUKLandline(num) {
    if (!num || typeof num !== 'string') return false;
    const cleaned = num.replace(/[^\d]/g, '');
    if (cleaned.length < 10 || cleaned.length > 12) return false;
    if (cleaned.startsWith('07')) return false;  // mobiles, not landlines
    return (cleaned.startsWith('01') || cleaned.startsWith('02') ||
            cleaned.startsWith('03') ||
            cleaned.startsWith('0800') || cleaned.startsWith('0808'));
}

function cleanUKPhone(raw) {
    if (!raw) return '';
    return raw.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
}

function isTrackingNumber(num, checkatradePhone) {
    if (!num) return false;
    if (!checkatradePhone) return false;
    const cleaned = num.replace(/[^\d]/g, '');
    const ctCleaned = checkatradePhone.replace(/[^\d]/g, '');
    return cleaned === ctCleaned;
}

function validatePhoneList(phones, checkatradePhone) {
    const seen = new Set();
    const valid = [];
    for (const num of phones) {
        const cleaned = cleanUKPhone(num);
        if (!cleaned || seen.has(cleaned)) continue;
        if (isTrackingNumber(cleaned, checkatradePhone)) continue;
        seen.add(cleaned);
        valid.push(cleaned);
    }
    return valid;
}

// ============================================================
// Name extraction
// ============================================================

function extractName(fullTitle) {
    if (!fullTitle) return { firstName: '', lastName: '', fullName: '' };
    const cleaned = fullTitle
        .replace(/^(Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Director|Owner)\s*/i, '')
        .trim();
    const parts = cleaned.split(' ').filter(p => p);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        fullName: cleaned
    };
}

function parseDirectorName(chName) {
    if (!chName) return { firstName: '', lastName: '', fullName: '' };
    const parts = chName.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        const surname = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
        const forenames = parts[1];
        const firstName = forenames.split(' ')[0];
        return { firstName, lastName: surname, fullName: `${forenames} ${surname}` };
    }
    const words = chName.split(' ').filter(w => w);
    return { firstName: words[0] || '', lastName: words.slice(1).join(' ') || '', fullName: chName };
}

// ============================================================
// Companies House API (Group 5)
// ============================================================

function chRequest(urlPath) {
    return new Promise((resolve, reject) => {
        if (!CONFIG.companiesHouseApiKey) return resolve(null);
        const options = {
            hostname: 'api.company-information.service.gov.uk',
            path: urlPath,
            headers: {
                'Authorization': 'Basic ' + Buffer.from(CONFIG.companiesHouseApiKey + ':').toString('base64')
            }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function lookupCompaniesHouse(companyName) {
    if (!CONFIG.companiesHouseApiKey) return null;

    try {
        // Step 1: Search
        const searchResult = await chRequest(
            `/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=3`
        );
        if (!searchResult || !searchResult.items || searchResult.items.length === 0) return null;

        const nameLower = companyName.toLowerCase().replace(/\s*(ltd|limited|plc)\s*/gi, '').trim();
        let match = searchResult.items.find(item => {
            const itemName = (item.title || '').toLowerCase().replace(/\s*(ltd|limited|plc)\s*/gi, '').trim();
            return itemName === nameLower;
        });
        if (!match) match = searchResult.items[0];

        const companyNumber = match.company_number;
        const companyStatus = match.company_status || '';

        // Skip dissolved/liquidation companies
        if (companyStatus === 'dissolved' || companyStatus === 'liquidation') {
            return { companyNumber, skip: true, status: companyStatus };
        }

        const registeredAddress = match.registered_office_address || {};
        const dateOfCreation = match.date_of_creation || '';

        // Step 2: Company profile
        const profile = await chRequest(`/company/${companyNumber}`);
        await sleep(200);
        const sicCodes = profile && profile.sic_codes ? profile.sic_codes.join(', ') : '';
        const filingCategory = profile && profile.accounts && profile.accounts.type
            ? profile.accounts.type : '';
        const lastAccountsDate = profile && profile.accounts && profile.accounts.last_accounts
            ? profile.accounts.last_accounts.made_up_to : '';

        // Step 3: Officers
        const officersResult = await chRequest(`/company/${companyNumber}/officers?items_per_page=10`);
        await sleep(200);
        const directors = officersResult && officersResult.items
            ? officersResult.items
                .filter(o => o.officer_role === 'director' && !o.resigned_on)
                .map(o => ({
                    name: o.name || '',
                    appointed: o.appointed_on || '',
                    nationality: o.nationality || '',
                    occupation: o.occupation || ''
                }))
            : [];

        // Step 4: PSC
        const pscResult = await chRequest(
            `/company/${companyNumber}/persons-with-significant-control?items_per_page=5`
        );
        await sleep(200);
        const pscName = pscResult && pscResult.items && pscResult.items.length > 0
            ? pscResult.items[0].name || '' : '';

        return {
            companyNumber,
            companyStatus,
            dateOfCreation,
            registeredAddress,
            sicCodes,
            filingCategory,
            lastAccountsDate,
            directors,
            directorCount: directors.length,
            pscName
        };
    } catch (error) {
        console.error(`  CH error: ${error.message}`);
        return null;
    }
}

// ============================================================
// Checkatrade profile scraping (Group 3)
// ============================================================

async function scrapeCheckatradeProfile(page, profileUrl, checkatradePhone) {
    if (!profileUrl) return null;
    try {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1500 + Math.random() * 1000);

        const result = await page.evaluate(() => {
            const data = {
                website: null, phones: [], mobiles: [], landlines: [], emails: [],
                lastReviewDate: '', reviewResponseRate: '', services: []
            };
            const body = document.body.innerText || '';
            const html = document.body.innerHTML || '';

            // Website link
            const skipDomains = ['checkatrade.com', 'facebook.com', 'twitter.com', 'instagram.com',
                'linkedin.com', 'youtube.com', 'google.com', 'trustpilot.com',
                'gassaferegister.co.uk', 'watersafe.org.uk', 'x.com', 'tiktok.com',
                'pinterest.com', 'threads.net', 'niceic.com', 'cscs.uk.com',
                'apple.com', 'play.google.com', 'apps.apple.com',
                'vaillant.co.uk', 'napit.org.uk', 'ciphe.org.uk', 'bafe.org.uk',
                'jib.org.uk', 'fgasregister.com', 'worcester-bosch.co.uk',
                'baxi.co.uk', 'oftec.org', 'elecsa.co.uk', 'stroma.com',
                '9tuma.app.link', 'app.link'];

            const links = Array.from(document.querySelectorAll('a[href]'));
            for (const link of links) {
                const href = link.href || '';
                const text = (link.textContent || '').toLowerCase().trim();
                if ((text.includes('website') || text.includes('visit') || text.includes('www.') ||
                     href.includes('redirect') || link.getAttribute('data-tracking') === 'website') &&
                    href.startsWith('http') && !skipDomains.some(d => href.includes(d))) {
                    data.website = href;
                    break;
                }
            }
            if (!data.website) {
                for (const link of links) {
                    const href = link.href || '';
                    if (href.startsWith('http') && !skipDomains.some(d => href.includes(d)) &&
                        !href.includes('checkatrade') && !href.includes('javascript:') &&
                        href.match(/\.(co\.uk|com|org\.uk|uk|net|biz)/)) {
                        data.website = href;
                        break;
                    }
                }
            }

            // Phones from profile
            const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
            const mobiles = body.match(mobilePattern) || [];
            for (const m of mobiles) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length === 11 && cleaned.startsWith('07')) {
                    data.mobiles.push(cleaned);
                    data.phones.push(cleaned);
                }
            }

            // tel: links
            const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
            for (const link of telLinks) {
                const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (num.length === 11 && num.startsWith('07')) {
                    data.mobiles.push(num);
                    data.phones.push(num);
                } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02'))) {
                    data.landlines.push(num);
                    data.phones.push(num);
                }
            }

            // Emails from mailto: and JSON-LD
            const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
            for (const link of mailtoLinks) {
                const addr = link.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
                if (addr && addr.includes('@')) data.emails.push(addr);
            }

            try {
                const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                for (const script of jsonLdScripts) {
                    try {
                        const ld = JSON.parse(script.textContent);
                        const items = Array.isArray(ld) ? ld : [ld];
                        for (const item of items) {
                            if (item.email) data.emails.push(item.email.toLowerCase());
                            const phone = item.telephone || (item.contactPoint && item.contactPoint.telephone);
                            if (phone) {
                                const cleaned = phone.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                                if (cleaned.length === 11 && cleaned.startsWith('07')) {
                                    data.mobiles.push(cleaned);
                                    data.phones.push(cleaned);
                                }
                            }
                        }
                    } catch {}
                }
            } catch {}

            // Last review date
            const datePattern = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i;
            const dateMatch = body.match(datePattern);
            if (dateMatch) data.lastReviewDate = dateMatch[1];

            // Review response rate (count trader replies visible on page)
            const reviewBlocks = document.querySelectorAll('[class*="review"], [data-testid*="review"]');
            let totalReviews = reviewBlocks.length;
            let traderReplies = 0;
            for (const block of reviewBlocks) {
                const blockText = block.innerText || '';
                if (blockText.match(/reply|response|thank|reply from/i)) traderReplies++;
            }
            if (totalReviews > 0) {
                data.reviewResponseRate = Math.round((traderReplies / totalReviews) * 100) + '%';
            }

            // Services/specialisms
            const serviceEls = document.querySelectorAll('[class*="service"], [class*="specialism"], [data-testid*="service"]');
            for (const el of serviceEls) {
                const text = (el.textContent || '').trim();
                if (text && text.length < 100 && text.length > 2) data.services.push(text);
            }

            return data;
        });

        // ALL phones from Checkatrade profiles are tracking numbers (even 07xxx)
        // Keep them for dedup reference but mark them clearly
        result.ctTrackingPhones = [...new Set([...result.mobiles, ...result.phones])];
        result.mobiles = [];  // Never treat CT profile phones as real mobiles
        result.phones = [];
        result.landlines = [];

        return result;
    } catch (error) {
        console.log(`  [CT] Failed: ${error.message}`);
        return null;
    }
}

// ============================================================
// Website scraping (Group 4)
// ============================================================

async function extractPageData(page) {
    return page.evaluate(() => {
        const body = document.body.innerText || '';
        const html = document.body.innerHTML || '';
        const data = {
            phones: [], mobiles: [], landlines: [], emails: [],
            facebook: '', instagram: '', postcode: '',
            teamLanguage: '', employeeSignals: [], ownerName: '',
            competitorTools: [], hasOnlineBooking: false,
            hasLiveChat: false, websitePlatform: ''
        };

        // ---- PHONES ----
        const mobilePattern = /(?:^|\s|tel:|phone:|call[:\s]|mob(?:ile)?[:\s])?((?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3})/gi;
        const mobiles = body.match(mobilePattern) || [];
        for (const m of mobiles) {
            const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned);
                data.phones.push(cleaned);
            }
        }

        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
        for (const link of telLinks) {
            const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (num.length === 11 && num.startsWith('07')) {
                data.mobiles.push(num);
                data.phones.push(num);
            } else if (num.length >= 10 && num.length <= 12 && (num.startsWith('01') || num.startsWith('02') || num.startsWith('0800') || num.startsWith('0808'))) {
                data.landlines.push(num);
                data.phones.push(num);
            }
        }

        const landlinePatterns = [
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s]|fax[:\s])?((?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6})/gi,
            /(?:^|\s|tel:|phone:|call[:\s]|office[:\s])?((?:\+44\s?|0)2\d{4}[\s.-]?\d{4})/gi,
            /(0800[\s.-]?\d{3}[\s.-]?\d{3,4})/gi,
            /(0808[\s.-]?\d{3}[\s.-]?\d{3,4})/gi
        ];
        for (const pattern of landlinePatterns) {
            const matches = body.match(pattern) || [];
            for (const m of matches) {
                const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                if (cleaned.length >= 10 && cleaned.length <= 12 && !cleaned.startsWith('07')) {
                    data.landlines.push(cleaned);
                    data.phones.push(cleaned);
                }
            }
        }

        // JSON-LD phones + emails
        try {
            const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const script of jsonLdScripts) {
                try {
                    const ld = JSON.parse(script.textContent);
                    const items = Array.isArray(ld) ? ld : [ld];
                    for (const item of items) {
                        const phone = item.telephone || (item.contactPoint && item.contactPoint.telephone);
                        if (phone) {
                            const cleaned = phone.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                                data.mobiles.push(cleaned); data.phones.push(cleaned);
                            } else if (cleaned.length >= 10 && !cleaned.startsWith('07')) {
                                data.landlines.push(cleaned); data.phones.push(cleaned);
                            }
                        }
                        if (item.email) data.emails.push(item.email.toLowerCase());
                    }
                } catch {}
            }
        } catch {}

        // Meta tag phones
        const metaTags = Array.from(document.querySelectorAll('meta[name*="phone"], meta[name*="telephone"], meta[property*="phone"], meta[itemprop="telephone"]'));
        for (const meta of metaTags) {
            const content = meta.getAttribute('content') || '';
            const cleaned = content.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
            if (cleaned.length === 11 && cleaned.startsWith('07')) {
                data.mobiles.push(cleaned); data.phones.push(cleaned);
            } else if (cleaned.length >= 10 && !cleaned.startsWith('07')) {
                data.landlines.push(cleaned); data.phones.push(cleaned);
            }
        }

        // ---- EMAILS ----
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'));
        for (const link of mailtoLinks) {
            const addr = link.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
            if (addr && addr.includes('@')) data.emails.push(addr);
        }

        // Meta itemprop email
        const emailMeta = document.querySelector('meta[itemprop="email"]');
        if (emailMeta) {
            const addr = (emailMeta.getAttribute('content') || '').toLowerCase();
            if (addr && addr.includes('@')) data.emails.push(addr);
        }

        const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        const regexEmails = body.match(emailPattern) || [];
        const pageDomain = window.location.hostname.replace('www.', '');
        const junkDomains = ['example', 'domain', 'wix.com', 'wordpress', 'sentry',
            'schema.org', 'w3.org', 'googleapis', 'gravatar', 'wp.com',
            'squarespace', 'mailchimp', 'hubspot', 'google.com', 'facebook.com',
            'apple.com', 'microsoft.com', 'yahoo.com', 'trustatrader', 'mybuilder',
            'bark.com', 'trustpilot', 'checkatrade'];

        // Only add regex emails that match the company domain
        for (const e of regexEmails) {
            const lower = e.toLowerCase();
            if (junkDomains.some(d => lower.includes(d))) continue;
            if (lower.includes(pageDomain)) {
                data.emails.push(lower);
            }
        }

        // Sort: company domain first, then personal
        data.emails = [...new Set(data.emails)];
        data.emails.sort((a, b) => {
            const aOnDomain = a.includes(pageDomain) ? 0 : 1;
            const bOnDomain = b.includes(pageDomain) ? 0 : 1;
            return aOnDomain - bOnDomain;
        });

        // ---- SOCIAL ----
        const fbLinks = Array.from(document.querySelectorAll('a[href*="facebook.com"]'));
        for (const link of fbLinks) {
            if (link.href.includes('facebook.com/') && !link.href.includes('sharer')) {
                data.facebook = link.href; break;
            }
        }
        const igLinks = Array.from(document.querySelectorAll('a[href*="instagram.com"]'));
        for (const link of igLinks) {
            if (link.href.includes('instagram.com/')) { data.instagram = link.href; break; }
        }

        // ---- POSTCODE ----
        const postcodePattern = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/gi;
        const postcodes = body.match(postcodePattern);
        if (postcodes) data.postcode = postcodes[0].toUpperCase().replace(/\s+/g, ' ');

        // ---- TEAM LANGUAGE ----
        const iCount = (body.match(/\b(I am|I have|I offer|I provide|I specialise|my name is|myself|I've been)\b/gi) || []).length;
        const weCount = (body.match(/\b(we are|we have|we offer|we provide|our team|our engineers|our plumbers|our staff|we've been|our company)\b/gi) || []).length;
        if (iCount > weCount && iCount >= 2) data.teamLanguage = 'solo';
        else if (weCount > iCount && weCount >= 2) data.teamLanguage = 'team';
        else data.teamLanguage = 'unclear';

        // ---- EMPLOYEE SIGNALS ----
        const fleetMatch = body.match(/(\d+)\s*(vans?|vehicles?|trucks?)/gi);
        if (fleetMatch) data.employeeSignals.push('fleet:' + fleetMatch[0].trim());
        const engineerMatch = body.match(/(\d+)\s*(engineers?|plumbers?|technicians?|staff|employees?|operatives?)/gi);
        if (engineerMatch) data.employeeSignals.push('staff:' + engineerMatch[0].trim());
        if (body.match(/multi-?ple\s*(locations?|branches?|offices?)/gi)) data.employeeSignals.push('multiple_locations');
        if (body.match(/24\s*\/?\s*7|24\s*hours?|emergency\s*call\s*out/gi)) data.employeeSignals.push('24_7_service');

        // ---- COMPETITOR TOOLS ----
        const lowerHtml = html.toLowerCase();
        const lowerBody = body.toLowerCase();
        const toolChecks = [
            { name: 'Jobber', patterns: ['jobber.com', 'getjobber'] },
            { name: 'ServiceM8', patterns: ['servicem8.com', 'servicem8'] },
            { name: 'Tradify', patterns: ['tradifyhq.com', 'tradify'] },
            { name: 'Commusoft', patterns: ['commusoft.co.uk', 'commusoft'] },
            { name: 'Fergus', patterns: ['fergus.com', 'fergusapp'] },
            { name: 'Housecall Pro', patterns: ['housecallpro.com', 'housecall'] },
            { name: 'ServiceTitan', patterns: ['servicetitan.com', 'servicetitan'] },
            { name: 'Powered Now', patterns: ['powerednow.com', 'powered now'] },
            { name: 'Workever', patterns: ['workever.com', 'workever'] },
            { name: 'SimPRO', patterns: ['simpro.co', 'simprogroup'] },
            { name: 'BigChange', patterns: ['bigchange.com', 'bigchange'] },
            { name: 'Verizon Connect', patterns: ['verizonconnect.com', 'fleetmatics'] },
            { name: 'Gas Engineer Software', patterns: ['gasengineersoftware.co.uk'] }
        ];
        for (const tool of toolChecks) {
            if (tool.patterns.some(p => lowerHtml.includes(p) || lowerBody.includes(p))) {
                data.competitorTools.push(tool.name);
            }
        }

        // ---- OWNER NAME ----
        const namePatterns = [
            /(?:my name is|hi,?\s*i'm|hello,?\s*i'm)\s+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/,
            /(?:owner|director|founder|proprietor)[:\s-]+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/,
            /(?:run by|managed by|operated by)\s+([A-Z][a-z]{2,15}\s+[A-Z][a-z]{2,20})/
        ];
        for (const pattern of namePatterns) {
            const match = body.match(pattern);
            if (match && match[1] && match[1].length <= 40) {
                data.ownerName = match[1].trim();
                break;
            }
        }

        // ---- BOOKING DETECTION ----
        const bookingPatterns = ['calendly.com', 'acuityscheduling.com', 'simplybook.me',
            'leadconnectorhq.com/widget/booking', 'booksy.com', 'setmore.com',
            'gettimely.com', 'squareup.com/appointments'];
        data.hasOnlineBooking = bookingPatterns.some(p => lowerHtml.includes(p));

        // ---- LIVE CHAT DETECTION ----
        const chatPatterns = ['tidiochat', 'livechat', 'intercom', 'drift.com',
            'zendesk', 'crisp.chat', 'tawk.to', 'hubspot', 'fb-customerchat'];
        data.hasLiveChat = chatPatterns.some(p => lowerHtml.includes(p));

        // ---- CMS DETECTION ----
        const metaGen = document.querySelector('meta[name="generator"]');
        const genContent = metaGen ? (metaGen.getAttribute('content') || '').toLowerCase() : '';
        if (genContent.includes('wix') || lowerHtml.includes('wix.com')) data.websitePlatform = 'Wix';
        else if (lowerHtml.includes('wp-content') || genContent.includes('wordpress')) data.websitePlatform = 'WordPress';
        else if (lowerHtml.includes('squarespace.com') || genContent.includes('squarespace')) data.websitePlatform = 'Squarespace';
        else if (lowerHtml.includes('weebly.com')) data.websitePlatform = 'Weebly';
        else if (lowerHtml.includes('shopify.com')) data.websitePlatform = 'Shopify';
        else if (lowerHtml.includes('godaddy.com') || genContent.includes('godaddy')) data.websitePlatform = 'GoDaddy';

        return data;
    });
}

function mergePageData(result, pageData) {
    if (pageData.mobiles) result.mobileNumbers.push(...pageData.mobiles);
    if (pageData.landlines) result.landlineNumbers.push(...pageData.landlines);
    if (pageData.phones) result.allPhones.push(...pageData.phones);
    if (pageData.emails) result.allEmails.push(...pageData.emails);
    if (pageData.facebook && !result.facebook) result.facebook = pageData.facebook;
    if (pageData.instagram && !result.instagram) result.instagram = pageData.instagram;
    if (pageData.postcode && !result.postcode) result.postcode = pageData.postcode;
    if (pageData.teamLanguage && pageData.teamLanguage !== 'unclear') result.teamLanguage = pageData.teamLanguage;
    if (pageData.employeeSignals) result.employeeSignals.push(...pageData.employeeSignals);
    if (pageData.ownerName && !result.ownerNameFromSite) result.ownerNameFromSite = pageData.ownerName;
    if (pageData.competitorTools) result.competitorTools.push(...pageData.competitorTools);
    if (pageData.hasOnlineBooking) result.hasOnlineBooking = true;
    if (pageData.hasLiveChat) result.hasLiveChat = true;
    if (pageData.websitePlatform && !result.websitePlatform) result.websitePlatform = pageData.websitePlatform;
}

async function scrapeWebsite(page, url, checkatradePhone) {
    const result = {
        allPhones: [], mobileNumbers: [], landlineNumbers: [],
        allEmails: [], facebook: '', instagram: '', postcode: '',
        teamLanguage: 'unclear', hasTeamPage: false, employeeSignals: [],
        ownerNameFromSite: '', competitorTools: [],
        hasOnlineBooking: false, hasLiveChat: false, websitePlatform: ''
    };

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1000);
        const homeData = await extractPageData(page);
        mergePageData(result, homeData);

        // Contact page
        const contactUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const link = links.find(a => {
                const text = (a.textContent || '').toLowerCase();
                const href = (a.href || '').toLowerCase();
                return (text.includes('contact') || text.includes('get in touch') ||
                        href.includes('/contact') || href.includes('/get-in-touch'));
            });
            return link ? link.href : null;
        });
        if (contactUrl && contactUrl !== url) {
            try {
                await page.goto(contactUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1000);
                mergePageData(result, await extractPageData(page));
            } catch {}
        }

        // About page
        const aboutUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const link = links.find(a => {
                const text = (a.textContent || '').toLowerCase();
                const href = (a.href || '').toLowerCase();
                return (text.includes('about') || text.includes('meet the team') ||
                        href.includes('/about') || href.includes('/team'));
            });
            return link ? link.href : null;
        });
        if (aboutUrl && aboutUrl !== url && aboutUrl !== contactUrl) {
            try {
                await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1000);
                mergePageData(result, await extractPageData(page));
                result.hasTeamPage = true;
            } catch {}
        }

        // Deduplicate and validate
        result.mobileNumbers = [...new Set(result.mobileNumbers)];
        result.landlineNumbers = [...new Set(result.landlineNumbers)];
        result.allPhones = [...new Set(result.allPhones)];
        result.allEmails = [...new Set(result.allEmails)];
        result.competitorTools = [...new Set(result.competitorTools)];
        result.employeeSignals = [...new Set(result.employeeSignals)];

        // Validate phones
        result.mobileNumbers = validatePhoneList(result.mobileNumbers, checkatradePhone)
            .filter(n => isValidUKMobile(n));
        result.landlineNumbers = validatePhoneList(result.landlineNumbers, checkatradePhone)
            .filter(n => isValidUKLandline(n));
        result.allPhones = [...new Set([...result.mobileNumbers, ...result.landlineNumbers])];
    } catch (error) {
        console.log(`  [Website] Failed: ${error.message}`);
    }

    return result;
}

// ============================================================
// Search engine cascade (Group 6 - Tier 2)
// ============================================================

async function searchWebForWebsite(page, companyName, location, tradeType) {
    const query = `"${companyName}" ${location} UK ${tradeType}`;
    const engines = [
        { name: 'DDG', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
        { name: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10` },
        { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` }
    ];

    for (const engine of engines) {
        try {
            await page.goto(engine.url, { waitUntil: 'networkidle2', timeout: 15000 });
            await searchDelay();

            const blocked = await page.evaluate(() => {
                const body = (document.body.innerText || '').toLowerCase();
                return body.includes('captcha') || body.includes('unusual traffic') ||
                    body.includes('are you a robot') || body.includes('verify you are human');
            });
            if (blocked) continue;

            const results = await page.evaluate(() => {
                const links = [];
                const skipDomains = ['google.com', 'google.co.uk', 'bing.com', 'duckduckgo.com',
                    'microsoft.com', 'youtube.com', 'schema.org', 'w3.org'];

                document.querySelectorAll('a[href]').forEach(el => {
                    let href = el.href;
                    if (href.includes('/url?q=')) {
                        try { href = new URL(href).searchParams.get('q') || href; } catch {}
                    }
                    if (href.includes('duckduckgo.com/l/?') && href.includes('uddg=')) {
                        try { href = decodeURIComponent(new URL(href).searchParams.get('uddg') || href); } catch {}
                    }
                    if (href && href.startsWith('http') && !skipDomains.some(d => href.includes(d))) {
                        links.push(href);
                    }
                });
                return [...new Set(links)];
            });

            const filtered = results.filter(url => {
                const lower = url.toLowerCase();
                return !SKIP_DOMAINS.some(d => lower.includes(d)) &&
                       !NON_UK_TLDS.some(t => lower.includes(t));
            });

            // Match company name words in URL
            const companyWords = companyName.toLowerCase()
                .replace(/\b(ltd|limited|plc|services|solutions|plumbing|heating|gas|&|and|the)\b/g, '')
                .split(/\s+/).filter(w => w.length > 2);

            for (const url of filtered) {
                const urlLower = url.toLowerCase();
                for (const word of companyWords) {
                    if (urlLower.includes(word)) return url;
                }
            }

            // Prefer .co.uk
            const coUk = filtered.find(u => u.includes('.co.uk'));
            if (coUk) return coUk;

            return filtered[0] || null;
        } catch { continue; }
    }
    return null;
}

// ============================================================
// Google Business Profile (Group 7) -- Google Maps direct
// ============================================================

async function findGoogleBusiness(page, companyName, location, tradeType) {
    const result = { googleReviews: 0, googleRating: '', googlePhone: '' };

    // Approach 1: Google Maps direct (avoids search engine rate limits)
    try {
        const mapsQuery = `${companyName} ${location} UK`;
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(mapsQuery)}`, {
            waitUntil: 'networkidle2', timeout: 20000
        });
        await searchDelay();

        const mapsData = await page.evaluate(() => {
            const body = document.body.innerText || '';
            const data = { googleReviews: 0, googleRating: '', googlePhone: '' };

            // Rating pattern: "4.8 (123)" or "4.8 stars 123 reviews"
            const ratingPatterns = [
                /(\d\.\d)\s*\((\d[\d,]*)\)/,
                /(\d\.\d)\s*stars?\s*[·\-]\s*(\d[\d,]*)\s*reviews?/i,
                /(\d\.\d)\s*\n\s*(\d[\d,]*)\s*reviews?/i
            ];
            for (const pattern of ratingPatterns) {
                const match = body.match(pattern);
                if (match && match[2]) {
                    data.googleRating = match[1];
                    data.googleReviews = parseInt(match[2].replace(/,/g, ''));
                    if (data.googleReviews > 0) break;
                }
            }

            // Phone from Maps sidebar
            const phonePatterns = [
                /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/,
                /(?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6}/,
                /(?:\+44\s?|0)2\d{4}[\s.-]?\d{4}/
            ];
            for (const pattern of phonePatterns) {
                const match = body.match(pattern);
                if (match) {
                    data.googlePhone = match[0].replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    break;
                }
            }

            return data;
        });

        if (mapsData.googleReviews > 0 || mapsData.googlePhone) {
            return mapsData;
        }
    } catch {}

    // Approach 2: Bing fallback for review data
    try {
        const query = `${companyName} ${location} UK ${tradeType} reviews`;
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle2', timeout: 15000
        });
        await searchDelay();

        const blocked = await page.evaluate(() => {
            const body = (document.body.innerText || '').toLowerCase();
            return body.includes('captcha') || body.includes('unusual traffic');
        });
        if (!blocked) {
            const bingData = await page.evaluate(() => {
                const body = document.body.innerText || '';
                let googleReviews = 0, googleRating = '';
                const patterns = [
                    /(\d\.\d)\s*\((\d[\d,]*)\)/,
                    /(\d\.\d)\s*stars?\s*[·\-]\s*(\d[\d,]*)\s*reviews?/i,
                    /Rating:\s*(\d\.\d).*?(\d[\d,]*)\s*reviews?/i
                ];
                for (const pattern of patterns) {
                    const match = body.match(pattern);
                    if (match && match[2]) {
                        googleRating = match[1];
                        googleReviews = parseInt(match[2].replace(/,/g, ''));
                        if (googleReviews > 0) break;
                    }
                }
                return { googleReviews, googleRating, googlePhone: '' };
            });
            if (bingData.googleReviews > 0) return bingData;
        }
    } catch {}

    return result;
}

// ============================================================
// LinkedIn (Group 8 - 3-Tier Cascade)
// ============================================================

// Tier 3: Direct stealth Puppeteer visit to LinkedIn public pages
async function linkedInDirectScrape(page, companyName, area, fullName) {
    const result = { companyPage: '', ownerProfile: '', companySize: '', ownerName: '', ownerTitle: '' };
    try {
        // Try company page search via DDG (original approach, kept as last resort)
        const query = `linkedin.com "${companyName}" ${area} "United Kingdom"`;
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle2', timeout: 12000
        });
        await sleep(1500 + Math.random() * 1000);

        const results = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a[href]').forEach(el => {
                let href = el.href;
                if (href.includes('duckduckgo.com/l/?') && href.includes('uddg=')) {
                    try { href = decodeURIComponent(new URL(href).searchParams.get('uddg') || href); } catch {}
                }
                if (href.includes('linkedin.com/')) links.push(href);
            });
            return [...new Set(links)];
        });

        for (const url of results) {
            const lower = url.toLowerCase();
            if (lower.includes('linkedin.com/company/') && !result.companyPage) result.companyPage = url;
            if (lower.includes('linkedin.com/in/') && !result.ownerProfile) result.ownerProfile = url;
        }

        // Try to visit found LinkedIn pages to extract data (heavy rate limiting)
        if (result.companyPage) {
            try {
                await sleep(30000); // 30s rate limit
                await page.goto(result.companyPage, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(2000);
                const pageText = await page.evaluate(() => document.body.innerText || '');
                const sizeMatch = pageText.match(/(\d[\d,]*(?:\s*-\s*\d[\d,]*)?)\s*employees?/i);
                if (sizeMatch) result.companySize = sizeMatch[1].replace(/\s/g, '');
            } catch {}
        }

        if (result.ownerProfile) {
            try {
                await sleep(30000); // 30s rate limit
                await page.goto(result.ownerProfile, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(2000);
                const profileText = await page.evaluate(() => {
                    const nameEl = document.querySelector('h1');
                    const titleEl = document.querySelector('.top-card-layout__headline, .text-body-medium');
                    return {
                        name: nameEl ? nameEl.textContent.trim() : '',
                        title: titleEl ? titleEl.textContent.trim() : ''
                    };
                });
                if (profileText.name) result.ownerName = profileText.name;
                if (profileText.title) result.ownerTitle = profileText.title;
            } catch {}
        }
    } catch {}
    return result;
}

async function findLinkedIn(page, companyName, area, fullName, tradeType, apifyResults, googleSearchOpts) {
    const linkedIn = {
        companyPage: '', ownerProfile: '',
        companySize: '', ownerName: '', ownerTitle: '',
        tier: ''
    };

    // Tier 1: Apify pre-batch results (already resolved)
    if (apifyResults && apifyResults.has(companyName)) {
        const apify = apifyResults.get(companyName);
        linkedIn.companyPage = apify.linkedin_company || '';
        linkedIn.ownerProfile = apify.linkedin_owner || '';
        linkedIn.companySize = apify.linkedin_company_size || '';
        linkedIn.ownerName = apify.linkedin_owner_name || '';
        linkedIn.ownerTitle = apify.linkedin_owner_title || '';
        linkedIn.tier = 'T1';
        if (linkedIn.companyPage || linkedIn.ownerProfile) {
            console.log(`  [LinkedIn T1] ${linkedIn.companyPage || linkedIn.ownerProfile}`);
            return linkedIn;
        }
    }

    // Tier 2: Google Custom Search API (fast HTTP, no browser)
    if (googleSearchOpts && (googleSearchOpts.key || process.env.GOOGLE_CSE_KEY)) {
        try {
            const companyResult = await googleLinkedInCompany(companyName, area, googleSearchOpts);
            if (companyResult) {
                linkedIn.companyPage = companyResult.url;
                linkedIn.companySize = companyResult.size || '';
            }

            const personResult = await googleLinkedInPerson(fullName, companyName, googleSearchOpts);
            if (personResult) {
                linkedIn.ownerProfile = personResult.url;
                linkedIn.ownerName = personResult.name || '';
                linkedIn.ownerTitle = personResult.title || '';
            }

            if (linkedIn.companyPage || linkedIn.ownerProfile) {
                linkedIn.tier = 'T2';
                console.log(`  [LinkedIn T2] ${linkedIn.companyPage || linkedIn.ownerProfile}`);
                return linkedIn;
            }
        } catch (err) {
            console.log(`  [LinkedIn T2] Error: ${err.message}`);
        }
    }

    // Tier 3: Direct stealth Puppeteer (last resort, heavy rate limiting)
    try {
        const directResult = await linkedInDirectScrape(page, companyName, area, fullName);
        if (directResult.companyPage || directResult.ownerProfile) {
            linkedIn.companyPage = directResult.companyPage;
            linkedIn.ownerProfile = directResult.ownerProfile;
            linkedIn.companySize = directResult.companySize;
            linkedIn.ownerName = directResult.ownerName;
            linkedIn.ownerTitle = directResult.ownerTitle;
            linkedIn.tier = 'T3';
            console.log(`  [LinkedIn T3] ${linkedIn.companyPage || linkedIn.ownerProfile}`);
            return linkedIn;
        }
    } catch {}

    return linkedIn;
}

// ============================================================
// Facebook page scraping (Group 6b) -- many sole traders only have FB
// ============================================================

async function findFacebookPage(page, companyName, location, tradeType) {
    const result = { mobiles: [], landlines: [], emails: [], fbUrl: '' };
    try {
        // Use Bing (DDG used by Group 6, spread the load)
        const query = `site:facebook.com "${companyName}" ${location} ${tradeType}`;
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle2', timeout: 15000
        });
        await searchDelay();

        const fbUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            for (const link of links) {
                const href = link.href || '';
                if (href.includes('facebook.com/') && !href.includes('facebook.com/sharer') &&
                    !href.includes('facebook.com/login') && !href.includes('facebook.com/help') &&
                    !href.includes('facebook.com/policy') && !href.includes('facebook.com/groups/')) {
                    return href;
                }
            }
            return null;
        });

        if (fbUrl) {
            result.fbUrl = fbUrl;
            // Scrape FB page About section
            await page.goto(fbUrl, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(2000);

            const fbData = await page.evaluate(() => {
                const body = document.body.innerText || '';
                const data = { mobiles: [], landlines: [], emails: [] };

                // Phone from FB page
                const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                const mobiles = body.match(mobilePattern) || [];
                for (const m of mobiles) {
                    const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (cleaned.length === 11 && cleaned.startsWith('07')) data.mobiles.push(cleaned);
                }

                const landlinePatterns = [
                    /(?:\+44\s?|0)1\d{3}[\s.-]?\d{5,6}/g,
                    /(?:\+44\s?|0)2\d{4}[\s.-]?\d{4}/g
                ];
                for (const pattern of landlinePatterns) {
                    const matches = body.match(pattern) || [];
                    for (const m of matches) {
                        const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                        if (cleaned.length >= 10 && cleaned.length <= 12) data.landlines.push(cleaned);
                    }
                }

                // tel: links
                const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                for (const link of telLinks) {
                    const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (num.length === 11 && num.startsWith('07')) data.mobiles.push(num);
                    else if (num.length >= 10 && (num.startsWith('01') || num.startsWith('02'))) data.landlines.push(num);
                }

                // Email from FB page
                const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
                const emails = body.match(emailPattern) || [];
                const junk = ['facebook.com', 'fbcdn.net', 'example.com', 'sentry.io'];
                for (const e of emails) {
                    if (!junk.some(d => e.toLowerCase().includes(d))) data.emails.push(e.toLowerCase());
                }

                return data;
            });

            result.mobiles = [...new Set(fbData.mobiles)];
            result.landlines = [...new Set(fbData.landlines)];
            result.emails = [...new Set(fbData.emails)];
        }
    } catch {}
    return result;
}

// ============================================================
// Directory fallbacks (Group 9)
// ============================================================

async function searchDirectories(page, companyName, location, tradeType) {
    const result = { mobiles: [], landlines: [], website: null };

    // Yell.com
    try {
        const yellQuery = `"${companyName}" ${location} ${tradeType} site:yell.com`;
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(yellQuery)}`, {
            waitUntil: 'networkidle2', timeout: 12000
        });
        await searchDelay();

        const yellUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            for (const link of links) {
                let href = link.href;
                if (href.includes('uddg=')) {
                    try { href = decodeURIComponent(new URL(href).searchParams.get('uddg') || href); } catch {}
                }
                if (href.includes('yell.com/biz/')) return href;
            }
            return null;
        });

        if (yellUrl) {
            await page.goto(yellUrl, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(1500);

            const yellData = await page.evaluate(() => {
                const body = document.body.innerText || '';
                const data = { mobiles: [], landlines: [], website: null };

                const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                const mobiles = body.match(mobilePattern) || [];
                for (const m of mobiles) {
                    const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (cleaned.length === 11 && cleaned.startsWith('07')) data.mobiles.push(cleaned);
                }

                const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                for (const link of telLinks) {
                    const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                    if (num.length === 11 && num.startsWith('07')) data.mobiles.push(num);
                    else if (num.length >= 10 && (num.startsWith('01') || num.startsWith('02'))) data.landlines.push(num);
                }

                const wsLinks = Array.from(document.querySelectorAll('a[href]'));
                for (const link of wsLinks) {
                    const text = (link.textContent || '').toLowerCase();
                    if ((text.includes('website') || text.includes('visit')) &&
                        link.href.startsWith('http') && !link.href.includes('yell.com')) {
                        data.website = link.href; break;
                    }
                }
                return data;
            });

            result.mobiles.push(...yellData.mobiles);
            result.landlines.push(...yellData.landlines);
            if (yellData.website) result.website = yellData.website;
        }
    } catch {}

    // FreeIndex (only if no mobile from Yell)
    if (result.mobiles.length === 0) {
        try {
            const fiQuery = `"${companyName}" ${location} ${tradeType} site:freeindex.co.uk`;
            await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(fiQuery)}`, {
                waitUntil: 'networkidle2', timeout: 12000
            });
            await searchDelay();

            const fiUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href]'));
                for (const link of links) {
                    let href = link.href;
                    if (href.includes('uddg=')) {
                        try { href = decodeURIComponent(new URL(href).searchParams.get('uddg') || href); } catch {}
                    }
                    if (href.includes('freeindex.co.uk/profile/')) return href;
                }
                return null;
            });

            if (fiUrl) {
                await page.goto(fiUrl, { waitUntil: 'networkidle2', timeout: 15000 });
                await sleep(1500);

                const fiData = await page.evaluate(() => {
                    const body = document.body.innerText || '';
                    const mobiles = [];
                    const mobilePattern = /(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g;
                    const matches = body.match(mobilePattern) || [];
                    for (const m of matches) {
                        const cleaned = m.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                        if (cleaned.length === 11 && cleaned.startsWith('07')) mobiles.push(cleaned);
                    }
                    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                    for (const link of telLinks) {
                        const num = link.href.replace('tel:', '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44/, '0');
                        if (num.length === 11 && num.startsWith('07')) mobiles.push(num);
                    }
                    return { mobiles };
                });
                result.mobiles.push(...fiData.mobiles);
            }
        } catch {}
    }

    result.mobiles = [...new Set(result.mobiles)];
    result.landlines = [...new Set(result.landlines)];
    return result;
}

// ============================================================
// Scoring (Group 10)
// ============================================================

function calculateCompanySize(lead, websiteData, chData) {
    let score = 0;
    const signals = [];

    const isLtd = /\b(ltd|limited|plc)\b/i.test(lead.company_name || '');
    if (isLtd) { score += 1; signals.push('ltd'); }

    const vatField = lead.vat_number || '';
    const isVat = vatField.toLowerCase() === 'yes' || (vatField.length >= 9 && /^\d+$/.test(vatField));
    if (isVat) { score += 2; signals.push('vat'); }

    const reviews = parseInt(lead.review_count) || 0;
    if (reviews >= 200) { score += 3; signals.push('200+_reviews'); }
    else if (reviews >= 100) { score += 2; signals.push('100+_reviews'); }
    else if (reviews >= 50) { score += 1; signals.push('50+_reviews'); }

    const yearsMatch = String(lead.years_on_checkatrade || '').match(/(\d+)/);
    const years = yearsMatch ? parseInt(yearsMatch[1]) : 0;
    if (years >= 10) { score += 2; signals.push('10+_years'); }
    else if (years >= 5) { score += 1; signals.push('5+_years'); }

    if (websiteData.teamLanguage === 'team') { score += 2; signals.push('team_language'); }
    else if (websiteData.teamLanguage === 'solo') { score -= 1; signals.push('solo_language'); }

    if (websiteData.hasTeamPage) { score += 1; signals.push('has_team_page'); }
    if (websiteData.employeeSignals && websiteData.employeeSignals.length > 0) {
        score += websiteData.employeeSignals.length;
        signals.push(...websiteData.employeeSignals);
    }

    if (chData && chData.directorCount > 1) { score += 1; signals.push(`${chData.directorCount}_directors`); }
    if (chData && chData.filingCategory && ['small', 'medium', 'large'].some(s => chData.filingCategory.includes(s))) {
        score += 2; signals.push('filing_' + chData.filingCategory);
    }

    let category;
    if (score <= 1) category = 'Solo';
    else if (score <= 4) category = 'Small';
    else if (score <= 7) category = 'Established';
    else category = 'Large';

    return { category, score, signals, isLtd, isVat };
}

function calculateFitScore(lead, websiteData, gbpData, chData, crossPlatformMatch) {
    let score = 0;
    const reasons = [];

    const reviews = parseInt(lead.review_count) || 0;
    if (reviews >= 50) { score += 3; reasons.push('active_profile'); }
    else if (reviews >= 20) { score += 2; reasons.push('decent_profile'); }
    else if (reviews >= 5) { score += 1; reasons.push('has_reviews'); }

    if ((lead.emergency_callout || '').toLowerCase() === 'yes') { score += 2; reasons.push('emergency_callout'); }

    const yearsMatch = String(lead.years_on_checkatrade || '').match(/(\d+)/);
    const years = yearsMatch ? parseInt(yearsMatch[1]) : 0;
    if (years >= 2) { score += 2; reasons.push('invested_in_platform'); }

    const rating = parseFloat(lead.overall_rating) || 0;
    if (rating >= 9.5) { score += 2; reasons.push('high_rating'); }
    else if (rating >= 8) { score += 1; reasons.push('good_rating'); }

    if (websiteData.allPhones.length > 0 || websiteData.allEmails.length > 0) {
        score += 1; reasons.push('contactable');
    }

    if (gbpData && gbpData.googleReviews >= 20) { score += 2; reasons.push('strong_google'); }
    else if (gbpData && gbpData.googleReviews >= 5) { score += 1; reasons.push('has_google_reviews'); }

    if (websiteData.competitorTools && websiteData.competitorTools.length > 0) {
        score += 2; reasons.push('uses_biz_tools:' + websiteData.competitorTools.join('+'));
    }

    if (websiteData.hasOnlineBooking) { score += 1; reasons.push('has_booking'); }

    const platformCount = crossPlatformMatch ? crossPlatformMatch.platforms.length : 0;
    if (platformCount >= 3) { score += 2; reasons.push('3+_platforms'); }
    else if (platformCount >= 2) { score += 1; reasons.push('2+_platforms'); }

    if (chData && chData.dateOfCreation) {
        const companyAge = new Date().getFullYear() - parseInt(chData.dateOfCreation.substring(0, 4));
        if (companyAge >= 5) { score += 1; reasons.push('company_5+_years'); }
    }

    let tier;
    if (score >= 12) tier = 'A';
    else if (score >= 8) tier = 'B';
    else if (score >= 4) tier = 'C';
    else tier = 'D';

    return { tier, score, reasons };
}

function calculateContactCompleteness(enriched) {
    let score = 0;
    if (enriched.mobile) score++;
    if (enriched.email_primary) score++;
    if (enriched.website) score++;
    if (enriched.facebook || enriched.instagram || enriched.linkedin_company) score++;
    return score;
}

function calculatePainSignals(enriched) {
    const signals = [];
    if ((enriched.emergency_callout || '').toLowerCase() === 'yes' && !enriched.mobile) {
        signals.push('promises_fast_but_unreachable');
    }
    const platformCount = parseInt(enriched.platform_count) || 0;
    if (platformCount >= 3 && !enriched.website) {
        signals.push('heavy_platform_user_no_web_presence');
    }
    const reviews = parseInt(enriched.review_count) || 0;
    if (reviews >= 100 && !enriched.has_online_booking) {
        signals.push('busy_but_manual_booking');
    }
    if (enriched.competitor_tools && !enriched.has_online_booking) {
        signals.push('has_software_but_gaps');
    }
    if (enriched.is_ltd === 'Yes' && enriched.company_age >= 5 && (parseInt(enriched.contact_completeness) || 0) <= 1) {
        signals.push('established_but_invisible');
    }
    return signals;
}

// ============================================================
// Output columns
// ============================================================

const OUTPUT_HEADERS = [
    // Identity
    'company_name', 'first_name', 'last_name', 'full_name', 'role',
    'trade_type', 'location', 'postcode', 'registered_address',
    // Contact
    'mobile', 'landline', 'all_phones', 'email_primary', 'all_emails',
    'website', 'facebook', 'instagram', 'linkedin_company', 'linkedin_owner',
    'checkatrade_phone', 'google_phone',
    // Reputation
    'overall_rating', 'review_count', 'years_on_checkatrade',
    'google_reviews', 'google_rating',
    'last_review_date', 'review_response_rate',
    // Business Intelligence
    'company_size', 'is_ltd', 'is_vat', 'team_language', 'has_team_page',
    'employee_signals', 'competitor_tools', 'services_listed',
    'has_online_booking', 'has_live_chat', 'website_platform',
    'sic_codes', 'filing_category', 'company_age', 'company_status',
    'director_count', 'director_occupation', 'psc_name', 'last_accounts_date',
    // LinkedIn
    'linkedin_company_size', 'linkedin_owner_name', 'linkedin_owner_title',
    // Scoring
    'sniper_fit_tier', 'sniper_fit_score', 'sniper_fit_reasons',
    'contact_completeness', 'pain_signals',
    // Meta
    'platforms', 'platform_count', 'match_confidence',
    'phone_source', 'website_source', 'name_source',
    'other_platform_ratings',
    // Internal
    'profile_url', 'handle', 'companies_house_number'
];

// ============================================================
// Checkpoint
// ============================================================

function checkpointPath(tradeSlug) {
    const suffix = CONFIG.totalInstances > 1 ? `-i${CONFIG.instance}` : '';
    return path.join(CONFIG.outputDir, `checkpoint-${tradeSlug}${suffix}.json`);
}

function saveCheckpoint(tradeSlug, enrichedLeads, lastIndex, stats) {
    const data = { lastIndex, count: enrichedLeads.length, timestamp: new Date().toISOString() };
    fs.writeFileSync(checkpointPath(tradeSlug), JSON.stringify(data));
    // Also write partial CSV
    const instanceSuffix = CONFIG.totalInstances > 1 ? `-i${CONFIG.instance}` : '';
    const outPath = path.join(CONFIG.outputDir, `enriched-${tradeSlug}s${instanceSuffix}.csv`);
    const headerLine = OUTPUT_HEADERS.join(',');
    const rows = enrichedLeads.map(row => OUTPUT_HEADERS.map(h => csvEscape(row[h] || '')).join(','));
    fs.writeFileSync(outPath, [headerLine, ...rows].join('\n'));
    // Write live stats JSON for --stats reader
    if (stats) {
        const statsPath = path.join(CONFIG.outputDir, `stats-${tradeSlug}.json`);
        fs.writeFileSync(statsPath, JSON.stringify({ ...stats, tradeSlug, lastIndex, timestamp: new Date().toISOString() }, null, 2));
    }
    console.log(`  [Checkpoint] ${enrichedLeads.length} leads saved (index ${lastIndex})`);
}

function loadCheckpoint(tradeSlug) {
    const cp = checkpointPath(tradeSlug);
    if (!CONFIG.resume || !fs.existsSync(cp)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(cp, 'utf-8'));
        // Load existing enriched data from CSV
        const csvPath = path.join(CONFIG.outputDir, `enriched-${tradeSlug}s.csv`);
        if (fs.existsSync(csvPath)) {
            const rows = parseCSV(csvPath);
            return { lastIndex: data.lastIndex, leads: rows };
        }
        return { lastIndex: data.lastIndex, leads: [] };
    } catch { return null; }
}

// ============================================================
// Main enrichment loop
// ============================================================

async function enrichTrade(tradeSlug, tradeName, inputFile, crossPlatformData) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ENRICHING: ${tradeName} (${tradeSlug})`);
    console.log(`${'='.repeat(60)}`);

    const leads = parseCSV(inputFile);
    if (leads.length === 0) { console.log('  No leads found'); return; }

    // Instance splitting
    const leadsPerInstance = Math.ceil(leads.length / CONFIG.totalInstances);
    const startIdx = (CONFIG.instance - 1) * leadsPerInstance;
    const endIdx = Math.min(startIdx + leadsPerInstance, leads.length);
    const instanceLeads = leads.slice(startIdx, endIdx);

    console.log(`  Total: ${leads.length} | Instance ${CONFIG.instance}/${CONFIG.totalInstances}: ${instanceLeads.length} (${startIdx}-${endIdx - 1})`);

    // Resume from checkpoint
    const checkpoint = loadCheckpoint(tradeSlug);
    let enrichedLeads = checkpoint ? checkpoint.leads : [];
    const resumeFrom = checkpoint ? checkpoint.lastIndex + 1 - startIdx : 0;

    if (checkpoint) {
        console.log(`  Resuming from index ${resumeFrom} (${enrichedLeads.length} already done)`);
    }

    // Stats
    const stats = {
        total: 0, mobiles: 0, emails: 0, websites: 0,
        chMatches: 0, crossPlatformMatches: 0, dissolved: 0,
        fitTiers: { A: 0, B: 0, C: 0, D: 0 },
        sizeCats: { Solo: 0, Small: 0, Established: 0, Large: 0 },
        phoneSources: {}, websiteSources: {}, nameSources: {},
        landlines: 0, socials: 0, bookings: 0, chats: 0,
        competitorToolLeads: 0, painSignalLeads: 0,
        multiPlatform: 0
    };
    const startTime = Date.now();

    // ==== Apify Tier 1 pre-batch (LinkedIn) ====
    let apifyResults = new Map();
    const apifyAccountsPath = path.resolve('./apify-accounts.json');
    if (fs.existsSync(apifyAccountsPath)) {
        // Find leads that need LinkedIn enrichment
        const needsLinkedIn = instanceLeads.filter((lead, idx) => {
            if (idx < resumeFrom) return false; // skip already-enriched
            const existing = enrichedLeads.find(e => e.company_name === lead.company_name);
            return !existing || (!existing.linkedin_company && !existing.linkedin_owner);
        });

        if (needsLinkedIn.length > 0) {
            console.log(`\n[Apify] Running Tier 1 batch for ${needsLinkedIn.length} leads needing LinkedIn...`);
            const batchCsvPath = path.join(CONFIG.outputDir, `apify-batch-${tradeSlug}.csv`);
            const batchHeaders = ['company_name', 'full_name', 'location', 'trade_type'];
            const batchRows = needsLinkedIn.map(lead => ({
                company_name: lead.company_name || '',
                full_name: lead.owner_name || '',
                location: lead.location || '',
                trade_type: lead.trade_type || tradeName
            }));
            writeCSV(batchCsvPath, batchHeaders, batchRows);

            try {
                const apifyScript = path.resolve(__dirname, 'apify-linkedin.js');
                const resultPath = path.join(CONFIG.outputDir, `apify-results-${tradeSlug}.csv`);
                execFileSync('node', [apifyScript, '--input', batchCsvPath, '--output', resultPath], {
                    timeout: 45 * 60 * 1000, // 45 min max
                    stdio: 'inherit'
                });
                // Load results into map
                if (fs.existsSync(resultPath)) {
                    const apifyRows = parseCSV(resultPath);
                    for (const row of apifyRows) {
                        if (row.linkedin_company || row.linkedin_owner) {
                            apifyResults.set(row.company_name, row);
                        }
                    }
                    console.log(`[Apify] Loaded ${apifyResults.size} Tier 1 matches`);
                }
            } catch (err) {
                console.log(`[Apify] Batch failed (continuing without Tier 1): ${err.message}`);
            }
            // Clean up batch file
            try { fs.unlinkSync(batchCsvPath); } catch {}
        }
    } else {
        console.log('[Apify] No apify-accounts.json found, skipping Tier 1');
    }

    // Google CSE config for Tier 2
    const googleSearchOpts = {
        key: process.env.GOOGLE_CSE_KEY || '',
        cx: process.env.GOOGLE_CSE_CX || ''
    };
    if (!googleSearchOpts.key) {
        console.log('[LinkedIn] No GOOGLE_CSE_KEY set, Tier 2 disabled');
    }

    // Launch browser for enrichment
    if (!CONFIG.noProxy) {
        loadProxies(CONFIG.proxyFile);
    } else {
        console.log('[Proxy] --no-proxy flag set, running on direct connection');
    }
    let browser = await launchBrowser();
    let page = await newPage(browser);
    let searchesSinceRotate = 0;

    try {
        for (let i = resumeFrom; i < instanceLeads.length; i++) {
            // Rotate browser periodically -- force-kill old one to prevent zombie Chrome
            if (searchesSinceRotate >= CONFIG.browserRotateEvery) {
                await forceCloseBrowser(browser);
                await sleep(2000 + Math.random() * 2000);
                try {
                    browser = await launchBrowser();
                    page = await newPage(browser);
                } catch (launchErr) {
                    console.log(`  [WARN] Browser launch failed, retrying after cleanup...`);
                    await cleanupAllBrowsers();
                    await sleep(5000);
                    browser = await launchBrowser();
                    page = await newPage(browser);
                }
                searchesSinceRotate = 0;
            }

            const lead = instanceLeads[i];
            const globalIdx = startIdx + i;
            const companyName = lead.company_name || '';
            const location = lead.location || '';
            const tradeType = lead.trade_type || tradeName;
            const ownerNameRaw = lead.owner_name || '';
            const checkatradePhone = '';  // Not in scrape data -- CT phone is tracking
            const profileUrl = lead.profile_url || '';
            const handle = lead.handle || '';
            const inputPhone = cleanUKPhone(lead.phone || '');  // Carry phone from master file

            console.log(`\n[${i + 1}/${instanceLeads.length}] ${companyName}`);
            stats.total++;

            // ==== GROUP 1: Raw Checkatrade data (already in lead object) ====

            // ==== GROUP 2: Cross-platform match (free, instant) ====
            const crossMatch = matchCrossPlatform(lead, crossPlatformData);
            let website = crossMatch.website_url || '';
            let websiteSource = '';
            let phoneSource = '';

            if (crossMatch.match_confidence !== 'none') {
                stats.crossPlatformMatches++;
                if (website) websiteSource = 'cross_platform';
                if (crossMatch.phones.length > 0) phoneSource = 'cross_platform';
                console.log(`  [XP] Match: ${crossMatch.match_confidence} | Platforms: ${crossMatch.platforms.join(', ')}`);
            }

            // ==== GROUP 5: Companies House API (fast HTTP, no browser) ====
            // Moved before CT scrape: fast, gives real name, filters dissolved companies early
            let chData = null;
            const isLtd = /\b(ltd|limited|plc)\b/i.test(companyName);
            let firstName = '', lastName = '', fullName = '', role = '', nameSource = '';

            if (isLtd && CONFIG.companiesHouseApiKey) {
                chData = await lookupCompaniesHouse(companyName);
                if (chData) {
                    if (chData.skip) {
                        console.log(`  [CH] Skipping ${chData.status} company`);
                        stats.dissolved++;
                        continue; // Skip dissolved companies before wasting browser time
                    }
                    stats.chMatches++;
                    if (chData.directors && chData.directors.length > 0) {
                        const director = chData.directors[0];
                        const parsed = parseDirectorName(director.name);
                        firstName = parsed.firstName;
                        lastName = parsed.lastName;
                        fullName = parsed.fullName;
                        role = director.occupation || 'Director';
                        nameSource = 'companies_house';
                        console.log(`  [CH] Director: ${fullName}`);
                    }
                }
            }

            // ==== GROUP 3: Checkatrade profile scrape ====
            // Extracts: website link, services, review data. Phones are ALL tracking -- never used as contact.
            let ctProfileData = null;
            let lastReviewDate = '';
            let reviewResponseRate = '';
            let servicesListed = '';

            if (profileUrl && !CONFIG.noProxy) {
                try {
                    ctProfileData = await scrapeCheckatradeProfile(page, profileUrl, checkatradePhone);
                    if (ctProfileData) {
                        if (ctProfileData.website && !website) {
                            website = ctProfileData.website;
                            websiteSource = 'checkatrade_profile';
                        }
                        if (ctProfileData.lastReviewDate) lastReviewDate = ctProfileData.lastReviewDate;
                        if (ctProfileData.reviewResponseRate) reviewResponseRate = ctProfileData.reviewResponseRate;
                        if (ctProfileData.services && ctProfileData.services.length) {
                            servicesListed = ctProfileData.services.slice(0, 10).join('; ');
                        }
                        // Merge emails from CT profile (emails are fine, phones are not)
                        if (ctProfileData.emails && ctProfileData.emails.length) {
                            crossMatch.emails = crossMatch.emails || [];
                            crossMatch.emails.push(...ctProfileData.emails);
                        }
                    }
                } catch (err) {
                    await checkForBlock(err);
                }
                searchesSinceRotate++;
            } else if (profileUrl && CONFIG.noProxy) {
                console.log('  [CT] Skipped (no proxy)');
            }

            // Filter website for non-UK TLDs
            if (website && NON_UK_TLDS.some(t => website.toLowerCase().includes(t))) {
                website = '';
                websiteSource = '';
            }

            // ==== GROUP 4: Website scrape (only if website found) ====
            let websiteData = {
                allPhones: [], mobileNumbers: [], landlineNumbers: [],
                allEmails: [], facebook: '', instagram: '', postcode: '',
                teamLanguage: 'unclear', hasTeamPage: false, employeeSignals: [],
                ownerNameFromSite: '', competitorTools: [],
                hasOnlineBooking: false, hasLiveChat: false, websitePlatform: ''
            };

            if (website) {
                console.log(`  [Website] ${website}`);
                try {
                    websiteData = await scrapeWebsite(page, website, checkatradePhone);
                    if (websiteData.mobileNumbers.length && !phoneSource) phoneSource = 'website';
                    searchesSinceRotate++;
                } catch (err) {
                    await checkForBlock(err);
                }
            }

            // ==== GROUP 6: Search engine cascade (only if no website yet) ====
            if (!website) {
                const foundWebsite = await searchWebForWebsite(page, companyName, location, tradeType);
                if (foundWebsite) {
                    website = foundWebsite;
                    websiteSource = 'search_engine';
                    console.log(`  [Search] Found: ${website}`);
                    websiteData = await scrapeWebsite(page, website, checkatradePhone);
                    if (websiteData.mobileNumbers.length) phoneSource = 'website_via_search';
                }
                searchesSinceRotate++;
            }

            // ==== GROUP 6b: Facebook page (only if still no mobile) ====
            let fbPageUrl = websiteData.facebook || '';
            if (!websiteData.mobileNumbers.length && !crossMatch.phones.length) {
                const fbData = await findFacebookPage(page, companyName, location, tradeType);
                if (fbData.fbUrl && !fbPageUrl) fbPageUrl = fbData.fbUrl;
                if (fbData.mobiles.length) {
                    const validFbMobiles = fbData.mobiles.filter(n => isValidUKMobile(n) && !isTrackingNumber(n, checkatradePhone));
                    if (validFbMobiles.length) {
                        websiteData.mobileNumbers.push(...validFbMobiles);
                        websiteData.allPhones.push(...validFbMobiles);
                        phoneSource = 'facebook';
                        console.log(`  [FB] Phone: ${validFbMobiles[0]}`);
                    }
                }
                if (fbData.emails.length) {
                    websiteData.allEmails.push(...fbData.emails);
                    if (fbData.emails.length) console.log(`  [FB] Email: ${fbData.emails[0]}`);
                }
                searchesSinceRotate++;
            }

            // ==== GROUP 7: Google Business Profile (always -- uses Maps direct) ====
            let gbpData = { googleReviews: 0, googleRating: '', googlePhone: '' };
            gbpData = await findGoogleBusiness(page, companyName, location, tradeType);
            if (gbpData.googleReviews) console.log(`  [Google] ${gbpData.googleRating}* (${gbpData.googleReviews} reviews)`);
            // Use Google phone if we still don't have one
            let googlePhone = '';
            if (gbpData.googlePhone) {
                const cleanedGPhone = cleanUKPhone(gbpData.googlePhone);
                if (!isTrackingNumber(cleanedGPhone, checkatradePhone)) {
                    googlePhone = cleanedGPhone;
                    if (isValidUKMobile(cleanedGPhone) && !websiteData.mobileNumbers.length && !crossMatch.phones.length) {
                        websiteData.mobileNumbers.push(cleanedGPhone);
                        websiteData.allPhones.push(cleanedGPhone);
                        phoneSource = 'google_maps';
                        console.log(`  [Google] Phone: ${cleanedGPhone}`);
                    }
                }
            }
            searchesSinceRotate++;

            // ==== GROUP 8: LinkedIn (3-tier cascade) ====
            let linkedIn = { companyPage: '', ownerProfile: '', companySize: '', ownerName: '', ownerTitle: '', tier: '' };
            linkedIn = await findLinkedIn(page, companyName, location, fullName, tradeType, apifyResults, googleSearchOpts);
            searchesSinceRotate++;

            // ==== GROUP 9: Directory fallbacks (only if still no mobile) ====
            if (!websiteData.mobileNumbers.length && !crossMatch.phones.length) {
                console.log('  [Dir] Searching directories...');
                const dirData = await searchDirectories(page, companyName, location, tradeType);
                if (dirData.mobiles.length) {
                    const validMobiles = dirData.mobiles.filter(n => isValidUKMobile(n));
                    websiteData.mobileNumbers.push(...validMobiles);
                    websiteData.allPhones.push(...validMobiles);
                    phoneSource = 'directory';
                }
                if (dirData.website && !website) {
                    website = dirData.website;
                    websiteSource = 'directory';
                    websiteData = await scrapeWebsite(page, website, checkatradePhone);
                }
                searchesSinceRotate++;
            }

            // ==== Name resolution (CH > website > PSC > Checkatrade) ====
            if (!lastName && websiteData.ownerNameFromSite) {
                const siteName = extractName(websiteData.ownerNameFromSite);
                firstName = siteName.firstName;
                lastName = siteName.lastName;
                fullName = siteName.fullName;
                nameSource = 'website';
            }
            if (!lastName && chData && chData.pscName) {
                const pscParsed = parseDirectorName(chData.pscName);
                firstName = pscParsed.firstName;
                lastName = pscParsed.lastName;
                fullName = pscParsed.fullName;
                nameSource = 'companies_house_psc';
            }
            if (!firstName) {
                const ctName = extractName(ownerNameRaw);
                firstName = ctName.firstName;
                lastName = ctName.lastName;
                fullName = ctName.fullName;
                if (fullName) nameSource = 'checkatrade';
            }

            // ==== Merge all phone data ====
            // Seed from master file phone column if enrichment found nothing
            if (inputPhone && !websiteData.mobileNumbers.length && !crossMatch.phones.length) {
                if (isValidUKMobile(inputPhone) && !isTrackingNumber(inputPhone, checkatradePhone)) {
                    websiteData.mobileNumbers.push(inputPhone);
                    websiteData.allPhones.push(inputPhone);
                    if (!phoneSource) phoneSource = 'master_input';
                    console.log(`  [Master] Phone: ${inputPhone}`);
                } else if (isValidUKLandline(inputPhone)) {
                    websiteData.landlineNumbers.push(inputPhone);
                    websiteData.allPhones.push(inputPhone);
                    if (!phoneSource) phoneSource = 'master_input';
                    console.log(`  [Master] Landline: ${inputPhone}`);
                }
            }
            const allMobiles = [...new Set([
                ...websiteData.mobileNumbers,
                ...crossMatch.phones.filter(n => isValidUKMobile(n) && !isTrackingNumber(n, checkatradePhone))
            ])];
            const allLandlines = [...new Set([
                ...websiteData.landlineNumbers,
                ...(crossMatch.phones || []).filter(n => isValidUKLandline(n) && !isTrackingNumber(n, checkatradePhone))
            ])];
            const allPhones = [...new Set([...allMobiles, ...allLandlines])];

            // Merge all emails
            const allEmails = [...new Set([
                ...websiteData.allEmails,
                ...(crossMatch.emails || [])
            ])].filter(e => e && e.includes('@'));

            // ==== GROUP 10: Scoring ====
            const sizeData = calculateCompanySize(lead, websiteData, chData);
            const fitData = calculateFitScore(lead, websiteData, gbpData, chData, crossMatch);

            // Company age
            let companyAge = '';
            if (chData && chData.dateOfCreation) {
                companyAge = String(new Date().getFullYear() - parseInt(chData.dateOfCreation.substring(0, 4)));
            }

            // Registered address
            const regAddr = chData && chData.registeredAddress
                ? [chData.registeredAddress.address_line_1, chData.registeredAddress.locality,
                   chData.registeredAddress.postal_code].filter(Boolean).join(', ')
                : '';

            // Build enriched record
            const enriched = {
                company_name: companyName,
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                role: role,
                trade_type: tradeType,
                location: location,
                postcode: websiteData.postcode || '',
                registered_address: regAddr,
                mobile: allMobiles[0] || '',
                landline: allLandlines[0] || '',
                all_phones: allPhones.join('; '),
                email_primary: allEmails[0] || '',
                all_emails: allEmails.join('; '),
                website: website,
                facebook: fbPageUrl || websiteData.facebook,
                instagram: websiteData.instagram,
                linkedin_company: linkedIn.companyPage,
                linkedin_owner: linkedIn.ownerProfile,
                checkatrade_phone: checkatradePhone,
                google_phone: googlePhone,
                overall_rating: lead.overall_rating || '',
                review_count: lead.review_count || '',
                years_on_checkatrade: lead.years_on_checkatrade || '',
                google_reviews: String(gbpData.googleReviews || ''),
                google_rating: gbpData.googleRating || '',
                last_review_date: lastReviewDate,
                review_response_rate: reviewResponseRate,
                company_size: sizeData.category,
                is_ltd: sizeData.isLtd ? 'Yes' : 'No',
                is_vat: sizeData.isVat ? 'Yes' : 'No',
                team_language: websiteData.teamLanguage,
                has_team_page: websiteData.hasTeamPage ? 'Yes' : 'No',
                employee_signals: (websiteData.employeeSignals || []).join('; '),
                competitor_tools: (websiteData.competitorTools || []).join('; '),
                services_listed: servicesListed,
                has_online_booking: websiteData.hasOnlineBooking ? 'Yes' : 'No',
                has_live_chat: websiteData.hasLiveChat ? 'Yes' : 'No',
                website_platform: websiteData.websitePlatform || '',
                sic_codes: chData ? chData.sicCodes || '' : '',
                filing_category: chData ? chData.filingCategory || '' : '',
                company_age: companyAge,
                company_status: chData ? chData.companyStatus || '' : '',
                director_count: chData ? String(chData.directorCount || '') : '',
                director_occupation: chData && chData.directors && chData.directors[0]
                    ? chData.directors[0].occupation || '' : '',
                psc_name: chData ? chData.pscName || '' : '',
                last_accounts_date: chData ? chData.lastAccountsDate || '' : '',
                linkedin_company_size: linkedIn.companySize || '',
                linkedin_owner_name: linkedIn.ownerName || '',
                linkedin_owner_title: linkedIn.ownerTitle || '',
                sniper_fit_tier: fitData.tier,
                sniper_fit_score: String(fitData.score),
                sniper_fit_reasons: fitData.reasons.join('; '),
                contact_completeness: '',
                pain_signals: '',
                platforms: lead.platforms || (crossMatch.platforms.length > 0
                    ? ['checkatrade', ...crossMatch.platforms].join(', ')
                    : 'checkatrade'),
                platform_count: lead.platform_count || String(1 + crossMatch.platforms.length),
                match_confidence: crossMatch.match_confidence,
                phone_source: phoneSource,
                website_source: websiteSource,
                name_source: nameSource,
                other_platform_ratings: crossMatch.other_platform_ratings || '',
                profile_url: profileUrl,
                handle: handle,
                companies_house_number: chData ? chData.companyNumber || '' : ''
            };

            enriched.contact_completeness = String(calculateContactCompleteness(enriched));
            enriched.pain_signals = calculatePainSignals(enriched).join('; ');

            enrichedLeads.push(enriched);

            // Update stats
            if (allMobiles.length > 0) stats.mobiles++;
            if (allLandlines.length > 0) stats.landlines++;
            if (allEmails.length > 0) stats.emails++;
            if (website) stats.websites++;
            if (websiteData.facebook || websiteData.instagram) stats.socials++;
            if (websiteData.hasOnlineBooking) stats.bookings++;
            if (websiteData.hasLiveChat) stats.chats++;
            if (websiteData.competitorTools && websiteData.competitorTools.length) stats.competitorToolLeads++;
            if (enriched.pain_signals) stats.painSignalLeads++;
            if (crossMatch.platforms.length > 0) stats.multiPlatform++;
            stats.fitTiers[fitData.tier] = (stats.fitTiers[fitData.tier] || 0) + 1;
            stats.sizeCats[sizeData.category] = (stats.sizeCats[sizeData.category] || 0) + 1;
            if (phoneSource) stats.phoneSources[phoneSource] = (stats.phoneSources[phoneSource] || 0) + 1;
            if (websiteSource) stats.websiteSources[websiteSource] = (stats.websiteSources[websiteSource] || 0) + 1;
            if (nameSource) stats.nameSources[nameSource] = (stats.nameSources[nameSource] || 0) + 1;

            // Log summary
            const hasContact = allMobiles.length > 0 ? 'MOB' : (allLandlines.length > 0 ? 'LAND' : 'NO-PHONE');
            console.log(`  ${fitData.tier}${fitData.score} | ${sizeData.category} | ${hasContact} | ${allEmails.length ? 'EMAIL' : 'NO-EMAIL'} | ${website ? 'WEB' : 'NO-WEB'}`);

            // Checkpoint
            if ((i + 1) % CONFIG.checkpointEvery === 0) {
                saveCheckpoint(tradeSlug, enrichedLeads, globalIdx, stats);
            }

            // Telegram alert
            if ((i + 1) % CONFIG.telegramEvery === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = (stats.total / elapsed * 3600).toFixed(0);
                const remaining = instanceLeads.length - i - 1;
                const eta = remaining > 0 ? ((remaining / stats.total) * elapsed / 60).toFixed(0) : 0;
                sendTelegram(
                    `[Enrich ${tradeName}] I${CONFIG.instance}\n` +
                    `${stats.total}/${instanceLeads.length} done\n` +
                    `Mobiles: ${stats.mobiles} (${(stats.mobiles/stats.total*100).toFixed(0)}%)\n` +
                    `Emails: ${stats.emails} (${(stats.emails/stats.total*100).toFixed(0)}%)\n` +
                    `Websites: ${stats.websites} (${(stats.websites/stats.total*100).toFixed(0)}%)\n` +
                    `Rate: ${rate}/hr | ETA: ${eta}min`
                );
            }

            // Delay between leads
            await jitterDelay(CONFIG.minDelay, CONFIG.maxDelay);
            resetBlockErrors();
        }

    } finally {
        await forceCloseBrowser(browser);
        await cleanupAllBrowsers(); // Catch any stragglers
    }

    // Final save
    saveCheckpoint(tradeSlug, enrichedLeads, startIdx + instanceLeads.length - 1, stats);

    // Final stats
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${tradeName} COMPLETE`);
    console.log(`  ${stats.total} leads in ${elapsed}min`);
    console.log(`  Mobiles: ${stats.mobiles} (${(stats.mobiles/stats.total*100).toFixed(0)}%)`);
    console.log(`  Emails: ${stats.emails} (${(stats.emails/stats.total*100).toFixed(0)}%)`);
    console.log(`  Websites: ${stats.websites} (${(stats.websites/stats.total*100).toFixed(0)}%)`);
    console.log(`  CH matches: ${stats.chMatches}`);
    console.log(`  Cross-platform: ${stats.crossPlatformMatches}`);
    console.log(`${'='.repeat(60)}`);

    sendTelegram(
        `[Enrich DONE] ${tradeName} I${CONFIG.instance}\n` +
        `${stats.total} leads in ${elapsed}min\n` +
        `Mobiles: ${stats.mobiles} (${(stats.mobiles/stats.total*100).toFixed(0)}%)\n` +
        `Emails: ${stats.emails} (${(stats.emails/stats.total*100).toFixed(0)}%)\n` +
        `Websites: ${stats.websites} (${(stats.websites/stats.total*100).toFixed(0)}%)`
    );
}

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('\n=== Enrich Leads Lite ===');
    console.log(`Input:    ${CONFIG.inputDir}`);
    console.log(`Output:   ${CONFIG.outputDir}`);
    console.log(`Instance: ${CONFIG.instance}/${CONFIG.totalInstances}`);
    console.log(`CH API:   ${CONFIG.companiesHouseApiKey ? 'Yes' : 'No'}`);
    console.log(`Resume:   ${CONFIG.resume}`);
    console.log('');

    ensureDir(CONFIG.outputDir);

    // Discover trades from input directory
    const filePrefix = CONFIG.useMaster ? 'master-' : 'all-uk-';
    const fileRegex = CONFIG.useMaster ? /^master-(.+)\.csv$/ : /^all-uk-(.+)\.csv$/;

    const files = fs.readdirSync(CONFIG.inputDir)
        .filter(f => f.endsWith('.csv') && f.startsWith(filePrefix));

    const trades = files.map(f => {
        const match = f.match(fileRegex);
        if (!match) return null;
        const slug = CONFIG.useMaster ? match[1] : match[1].replace(/s$/, '');
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return { slug, name, file: path.join(CONFIG.inputDir, f), size: fs.statSync(path.join(CONFIG.inputDir, f)).size };
    }).filter(Boolean);

    // Filter to single trade if specified
    let tradesToProcess = trades;
    if (CONFIG.trade) {
        const tradeSlug = slugify(CONFIG.trade);
        tradesToProcess = trades.filter(t => t.slug === tradeSlug || t.slug === CONFIG.trade);
        if (tradesToProcess.length === 0) {
            console.error(`Trade not found: ${CONFIG.trade}`);
            console.log('Available trades:', trades.map(t => t.slug).join(', '));
            process.exit(1);
        }
    } else {
        // Sort by priority order, then by file size descending
        tradesToProcess.sort((a, b) => {
            const aPri = TRADE_PRIORITY.indexOf(a.slug);
            const bPri = TRADE_PRIORITY.indexOf(b.slug);
            if (aPri >= 0 && bPri >= 0) return aPri - bPri;
            if (aPri >= 0) return -1;
            if (bPri >= 0) return 1;
            return b.size - a.size;
        });
    }

    if (CONFIG.skipTrades.length > 0) {
        tradesToProcess = tradesToProcess.filter(t => !CONFIG.skipTrades.includes(t.slug));
        console.log(`Skipping trades: ${CONFIG.skipTrades.join(', ')}`);
    }

    console.log(`Trades to process (${tradesToProcess.length}):`);
    for (const t of tradesToProcess) {
        const rows = parseCSV(t.file);
        console.log(`  ${t.name}: ${rows.length} leads`);
    }

    // Build cross-platform index (one-time, all trades)
    console.log('\nBuilding cross-platform index...');
    const crossPlatformData = buildCrossPlatformIndex(null); // null = load all trades
    console.log(`  Index: ${crossPlatformData.index.size} unique names from ${crossPlatformData.totalLoaded} rows`);
    console.log(`  Phone index: ${crossPlatformData.phoneIndex.size} numbers`);
    console.log(`  Domain index: ${crossPlatformData.domainIndex.size} domains`);

    // Process each trade
    for (const trade of tradesToProcess) {
        await enrichTrade(trade.slug, trade.name, trade.file, crossPlatformData);
    }

    console.log('\n=== All trades complete ===');
}

// ============================================================
// Stats mode -- read enriched CSVs and show dashboard
// ============================================================

function showStats() {
    const outputDir = CONFIG.outputDir;
    if (!fs.existsSync(outputDir)) {
        console.log('No output directory found. Run enrichment first.');
        process.exit(0);
    }

    // Collect all enriched CSVs
    const csvFiles = fs.readdirSync(outputDir).filter(f => f.startsWith('enriched-') && f.endsWith('.csv'));
    const statsFiles = fs.readdirSync(outputDir).filter(f => f.startsWith('stats-') && f.endsWith('.json'));
    const checkpointFiles = fs.readdirSync(outputDir).filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'));

    if (csvFiles.length === 0 && statsFiles.length === 0) {
        console.log('No enriched data found yet.');
        process.exit(0);
    }

    // Load input counts for progress tracking
    const inputDir = CONFIG.inputDir;
    const inputCounts = {};
    if (fs.existsSync(inputDir)) {
        for (const f of fs.readdirSync(inputDir).filter(f => f.startsWith('all-uk-') && f.endsWith('.csv'))) {
            const match = f.match(/^all-uk-(.+)\.csv$/);
            if (match) {
                const slug = match[1].replace(/s$/, '');
                const rows = parseCSV(path.join(inputDir, f));
                inputCounts[slug] = rows.length;
            }
        }
    }

    // Aggregate stats from enriched CSVs
    const totals = {
        leads: 0, mobiles: 0, landlines: 0, emails: 0, websites: 0,
        facebook: 0, instagram: 0, linkedin: 0,
        hasBooking: 0, hasChat: 0, hasCompetitorTools: 0,
        hasPainSignals: 0, hasName: 0,
        fitA: 0, fitB: 0, fitC: 0, fitD: 0,
        solo: 0, small: 0, established: 0, large: 0,
        multiPlatform: 0, isLtd: 0, isVat: 0,
        phoneSources: {}, websiteSources: {}, nameSources: {},
        platformCounts: { 1: 0, 2: 0, 3: 0, '4+': 0 },
        contactCompleteness: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
        cmsPlatforms: {}
    };

    const tradeStats = [];

    for (const f of csvFiles) {
        const match = f.match(/^enriched-(.+)s\.csv$/);
        if (!match) continue;
        const tradeSlug = match[1];
        const tradeName = tradeSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const rows = parseCSV(path.join(outputDir, f));

        const ts = {
            trade: tradeName, slug: tradeSlug,
            total: rows.length, input: inputCounts[tradeSlug] || '?',
            mobiles: 0, emails: 0, websites: 0, fitA: 0, fitB: 0
        };

        // Load live stats JSON if available (has timing info)
        let liveStats = null;
        const liveStatsPath = path.join(outputDir, `stats-${tradeSlug}.json`);
        if (fs.existsSync(liveStatsPath)) {
            try { liveStats = JSON.parse(fs.readFileSync(liveStatsPath, 'utf-8')); } catch {}
        }
        ts.liveStats = liveStats;

        for (const row of rows) {
            totals.leads++;
            if (row.mobile) { totals.mobiles++; ts.mobiles++; }
            if (row.landline) totals.landlines++;
            if (row.email_primary) { totals.emails++; ts.emails++; }
            if (row.website) { totals.websites++; ts.websites++; }
            if (row.facebook) totals.facebook++;
            if (row.instagram) totals.instagram++;
            if (row.linkedin_company || row.linkedin_owner) totals.linkedin++;
            if (row.has_online_booking === 'Yes') totals.hasBooking++;
            if (row.has_live_chat === 'Yes') totals.hasChat++;
            if (row.competitor_tools) totals.hasCompetitorTools++;
            if (row.pain_signals) totals.hasPainSignals++;
            if (row.first_name) totals.hasName++;
            if (row.is_ltd === 'Yes') totals.isLtd++;
            if (row.is_vat === 'Yes') totals.isVat++;

            const tier = row.sniper_fit_tier;
            if (tier === 'A') { totals.fitA++; ts.fitA++; }
            else if (tier === 'B') { totals.fitB++; ts.fitB++; }
            else if (tier === 'C') totals.fitC++;
            else if (tier === 'D') totals.fitD++;

            const size = row.company_size;
            if (size === 'Solo') totals.solo++;
            else if (size === 'Small') totals.small++;
            else if (size === 'Established') totals.established++;
            else if (size === 'Large') totals.large++;

            const pc = parseInt(row.platform_count) || 1;
            if (pc >= 4) totals.platformCounts['4+']++;
            else totals.platformCounts[pc] = (totals.platformCounts[pc] || 0) + 1;
            if (pc >= 2) totals.multiPlatform++;

            const cc = parseInt(row.contact_completeness) || 0;
            totals.contactCompleteness[cc] = (totals.contactCompleteness[cc] || 0) + 1;

            if (row.phone_source) totals.phoneSources[row.phone_source] = (totals.phoneSources[row.phone_source] || 0) + 1;
            if (row.website_source) totals.websiteSources[row.website_source] = (totals.websiteSources[row.website_source] || 0) + 1;
            if (row.name_source) totals.nameSources[row.name_source] = (totals.nameSources[row.name_source] || 0) + 1;

            if (row.website_platform) totals.cmsPlatforms[row.website_platform] = (totals.cmsPlatforms[row.website_platform] || 0) + 1;
        }

        tradeStats.push(ts);
    }

    const totalInput = Object.values(inputCounts).reduce((a, b) => a + b, 0);
    const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '0%';
    const bar = (n, d, width = 20) => {
        const filled = d > 0 ? Math.round(n / d * width) : 0;
        return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
    };

    // Print dashboard
    console.log('\n' + '='.repeat(70));
    console.log('  ENRICHMENT DASHBOARD');
    console.log('='.repeat(70));

    console.log(`\n  PROGRESS: ${totals.leads} / ${totalInput} leads enriched (${pct(totals.leads, totalInput)})`);
    console.log(`  ${bar(totals.leads, totalInput, 40)}`);

    console.log('\n  --- CONTACT YIELD ---');
    console.log(`  Mobiles:    ${totals.mobiles.toString().padStart(5)} ${bar(totals.mobiles, totals.leads)} ${pct(totals.mobiles, totals.leads)}`);
    console.log(`  Landlines:  ${totals.landlines.toString().padStart(5)} ${bar(totals.landlines, totals.leads)} ${pct(totals.landlines, totals.leads)}`);
    console.log(`  Emails:     ${totals.emails.toString().padStart(5)} ${bar(totals.emails, totals.leads)} ${pct(totals.emails, totals.leads)}`);
    console.log(`  Websites:   ${totals.websites.toString().padStart(5)} ${bar(totals.websites, totals.leads)} ${pct(totals.websites, totals.leads)}`);
    console.log(`  Facebook:   ${totals.facebook.toString().padStart(5)} ${bar(totals.facebook, totals.leads)} ${pct(totals.facebook, totals.leads)}`);
    console.log(`  Instagram:  ${totals.instagram.toString().padStart(5)} ${bar(totals.instagram, totals.leads)} ${pct(totals.instagram, totals.leads)}`);
    console.log(`  LinkedIn:   ${totals.linkedin.toString().padStart(5)} ${bar(totals.linkedin, totals.leads)} ${pct(totals.linkedin, totals.leads)}`);
    console.log(`  Named:      ${totals.hasName.toString().padStart(5)} ${bar(totals.hasName, totals.leads)} ${pct(totals.hasName, totals.leads)}`);

    console.log('\n  --- CONTACT COMPLETENESS (0-4) ---');
    for (let c = 4; c >= 0; c--) {
        const n = totals.contactCompleteness[c] || 0;
        console.log(`  Score ${c}:    ${n.toString().padStart(5)} ${bar(n, totals.leads)} ${pct(n, totals.leads)}`);
    }

    console.log('\n  --- SNIPER FIT TIERS ---');
    console.log(`  Tier A:     ${totals.fitA.toString().padStart(5)} ${bar(totals.fitA, totals.leads)} ${pct(totals.fitA, totals.leads)}  (hot prospects)`);
    console.log(`  Tier B:     ${totals.fitB.toString().padStart(5)} ${bar(totals.fitB, totals.leads)} ${pct(totals.fitB, totals.leads)}  (good fit)`);
    console.log(`  Tier C:     ${totals.fitC.toString().padStart(5)} ${bar(totals.fitC, totals.leads)} ${pct(totals.fitC, totals.leads)}  (possible)`);
    console.log(`  Tier D:     ${totals.fitD.toString().padStart(5)} ${bar(totals.fitD, totals.leads)} ${pct(totals.fitD, totals.leads)}  (low priority)`);

    console.log('\n  --- COMPANY SIZE ---');
    console.log(`  Solo:       ${totals.solo.toString().padStart(5)} ${bar(totals.solo, totals.leads)} ${pct(totals.solo, totals.leads)}`);
    console.log(`  Small:      ${totals.small.toString().padStart(5)} ${bar(totals.small, totals.leads)} ${pct(totals.small, totals.leads)}`);
    console.log(`  Established:${totals.established.toString().padStart(5)} ${bar(totals.established, totals.leads)} ${pct(totals.established, totals.leads)}`);
    console.log(`  Large:      ${totals.large.toString().padStart(5)} ${bar(totals.large, totals.leads)} ${pct(totals.large, totals.leads)}`);

    console.log('\n  --- BUSINESS INTEL ---');
    console.log(`  Ltd:        ${totals.isLtd.toString().padStart(5)} ${bar(totals.isLtd, totals.leads)} ${pct(totals.isLtd, totals.leads)}`);
    console.log(`  VAT:        ${totals.isVat.toString().padStart(5)} ${bar(totals.isVat, totals.leads)} ${pct(totals.isVat, totals.leads)}`);
    console.log(`  Booking:    ${totals.hasBooking.toString().padStart(5)} ${bar(totals.hasBooking, totals.leads)} ${pct(totals.hasBooking, totals.leads)}`);
    console.log(`  Live chat:  ${totals.hasChat.toString().padStart(5)} ${bar(totals.hasChat, totals.leads)} ${pct(totals.hasChat, totals.leads)}`);
    console.log(`  Biz tools:  ${totals.hasCompetitorTools.toString().padStart(5)} ${bar(totals.hasCompetitorTools, totals.leads)} ${pct(totals.hasCompetitorTools, totals.leads)}`);
    console.log(`  Pain sigs:  ${totals.hasPainSignals.toString().padStart(5)} ${bar(totals.hasPainSignals, totals.leads)} ${pct(totals.hasPainSignals, totals.leads)}`);

    console.log('\n  --- PLATFORM COVERAGE ---');
    console.log(`  1 platform: ${(totals.platformCounts[1] || 0).toString().padStart(5)} ${bar(totals.platformCounts[1] || 0, totals.leads)} ${pct(totals.platformCounts[1] || 0, totals.leads)}`);
    console.log(`  2 platforms:${(totals.platformCounts[2] || 0).toString().padStart(5)} ${bar(totals.platformCounts[2] || 0, totals.leads)} ${pct(totals.platformCounts[2] || 0, totals.leads)}`);
    console.log(`  3 platforms:${(totals.platformCounts[3] || 0).toString().padStart(5)} ${bar(totals.platformCounts[3] || 0, totals.leads)} ${pct(totals.platformCounts[3] || 0, totals.leads)}`);
    console.log(`  4+ platfrms:${(totals.platformCounts['4+'] || 0).toString().padStart(5)} ${bar(totals.platformCounts['4+'] || 0, totals.leads)} ${pct(totals.platformCounts['4+'] || 0, totals.leads)}`);

    // Phone sources breakdown
    if (Object.keys(totals.phoneSources).length > 0) {
        console.log('\n  --- PHONE SOURCES ---');
        const sorted = Object.entries(totals.phoneSources).sort((a, b) => b[1] - a[1]);
        for (const [src, count] of sorted) {
            console.log(`  ${src.padEnd(25)} ${count.toString().padStart(5)} ${bar(count, totals.mobiles, 15)} ${pct(count, totals.mobiles)}`);
        }
    }

    // Website sources breakdown
    if (Object.keys(totals.websiteSources).length > 0) {
        console.log('\n  --- WEBSITE SOURCES ---');
        const sorted = Object.entries(totals.websiteSources).sort((a, b) => b[1] - a[1]);
        for (const [src, count] of sorted) {
            console.log(`  ${src.padEnd(25)} ${count.toString().padStart(5)} ${bar(count, totals.websites, 15)} ${pct(count, totals.websites)}`);
        }
    }

    // Name sources breakdown
    if (Object.keys(totals.nameSources).length > 0) {
        console.log('\n  --- NAME SOURCES ---');
        const sorted = Object.entries(totals.nameSources).sort((a, b) => b[1] - a[1]);
        for (const [src, count] of sorted) {
            console.log(`  ${src.padEnd(25)} ${count.toString().padStart(5)} ${bar(count, totals.hasName, 15)} ${pct(count, totals.hasName)}`);
        }
    }

    // CMS platforms
    if (Object.keys(totals.cmsPlatforms).length > 0) {
        console.log('\n  --- WEBSITE PLATFORMS ---');
        const sorted = Object.entries(totals.cmsPlatforms).sort((a, b) => b[1] - a[1]);
        for (const [cms, count] of sorted) {
            console.log(`  ${cms.padEnd(15)} ${count.toString().padStart(5)} ${bar(count, totals.websites, 15)} ${pct(count, totals.websites)}`);
        }
    }

    // Per-trade breakdown
    console.log('\n  --- PER TRADE ---');
    console.log('  ' + 'Trade'.padEnd(22) + 'Done'.padStart(5) + '/' + 'Total'.padStart(5) +
                '  Mob%'.padStart(6) + ' Eml%'.padStart(6) + ' Web%'.padStart(6) +
                '   A'.padStart(5) + '   B'.padStart(5) + '  Status');

    for (const ts of tradeStats.sort((a, b) => b.total - a.total)) {
        const progress = ts.input === '?' ? '' : pct(ts.total, ts.input);
        let status = '';
        if (ts.liveStats && ts.liveStats.timestamp) {
            const age = (Date.now() - new Date(ts.liveStats.timestamp).getTime()) / 1000;
            if (age < 300) status = 'RUNNING';
            else if (age < 3600) status = `${Math.round(age / 60)}min ago`;
            else status = `${Math.round(age / 3600)}hr ago`;
        }
        if (ts.total >= (ts.input || Infinity)) status = 'DONE';

        console.log('  ' +
            ts.trade.padEnd(22) +
            ts.total.toString().padStart(5) + '/' +
            String(ts.input).padStart(5) +
            pct(ts.mobiles, ts.total).padStart(6) +
            pct(ts.emails, ts.total).padStart(6) +
            pct(ts.websites, ts.total).padStart(6) +
            ts.fitA.toString().padStart(5) +
            ts.fitB.toString().padStart(5) +
            ('  ' + status)
        );
    }

    // SMS-ready estimate
    const smsReady = totals.mobiles;
    const emailReady = totals.emails;
    const hotLeads = totals.fitA + totals.fitB;
    console.log('\n  --- OUTREACH READY ---');
    console.log(`  SMS-ready (have mobile):          ${smsReady}`);
    console.log(`  Email-ready (have email):          ${emailReady}`);
    console.log(`  Hot prospects (Tier A + B):         ${hotLeads}`);
    // Count A/B leads with mobiles
    let hotContactable = 0;
    for (const f of csvFiles) {
        const rows = parseCSV(path.join(outputDir, f));
        for (const row of rows) {
            if ((row.sniper_fit_tier === 'A' || row.sniper_fit_tier === 'B') && row.mobile) {
                hotContactable++;
            }
        }
    }
    console.log(`  Hot + contactable (A/B + mobile):   ${hotContactable}`);

    console.log('\n' + '='.repeat(70));
}

if (hasFlag('stats')) {
    showStats();
} else {
    main().catch(async (err) => {
        console.error('Fatal error:', err);
        await cleanupAllBrowsers();
        sendTelegram(`[Enrich FATAL] ${err.message}`);
        process.exit(1);
    });
}
