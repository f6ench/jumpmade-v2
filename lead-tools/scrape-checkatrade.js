const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    trade: process.argv[2] || 'plumber',
    location: process.argv[3] || 'Oxford',
    maxPages: parseInt(process.argv[4]) || 10,
    outputDir: './output',
    delay: 2000 // ms between page loads
};

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Generate output filename
function getOutputFilename() {
    const date = new Date().toISOString().split('T')[0];
    const sanitizedLocation = CONFIG.location.replace(/[^a-zA-Z0-9]/g, '-');
    return `checkatrade-${CONFIG.trade}-${sanitizedLocation}-${date}.csv`;
}

// Extract lead data from a trade card element
async function extractLeadData(page, cardSelector) {
    return await page.evaluate((selector) => {
        const cards = document.querySelectorAll(selector);
        const leads = [];

        cards.forEach(card => {
            try {
                // Company name
                const nameEl = card.querySelector('h2, h3, [class*="name"], [class*="title"]');
                const companyName = nameEl ? nameEl.textContent.trim() : '';

                // Rating
                const ratingEl = card.querySelector('[class*="rating"], [class*="score"]');
                const rating = ratingEl ? ratingEl.textContent.trim().match(/[\d.]+/)?.[0] || '' : '';

                // Reviews count
                const reviewsEl = card.querySelector('[class*="review"]');
                const reviewsText = reviewsEl ? reviewsEl.textContent.trim() : '';
                const reviews = reviewsText.match(/(\d+)/)?.[1] || '';

                // Location/Area
                const locationEl = card.querySelector('[class*="location"], [class*="area"], address');
                const area = locationEl ? locationEl.textContent.trim() : '';

                // Profile URL
                const linkEl = card.querySelector('a[href*="/trades/"]');
                const profileUrl = linkEl ? linkEl.href : '';
                const handle = profileUrl.split('/trades/')[1]?.split('/')[0]?.split('?')[0] || '';

                // Trade type
                const tradeEl = card.querySelector('[class*="trade"], [class*="category"]');
                const tradeType = tradeEl ? tradeEl.textContent.trim() : '';

                // Description snippet
                const descEl = card.querySelector('[class*="description"], [class*="snippet"], p');
                const description = descEl ? descEl.textContent.trim().substring(0, 200) : '';

                if (companyName && profileUrl) {
                    leads.push({
                        companyName,
                        rating,
                        reviews,
                        area,
                        profileUrl,
                        handle,
                        tradeType,
                        description
                    });
                }
            } catch (e) {
                console.error('Error extracting card:', e);
            }
        });

        return leads;
    }, cardSelector);
}

// Scrape individual profile page for more details
async function scrapeProfilePage(page, profileUrl) {
    try {
        // Clean URL - remove hash params
        const cleanUrl = profileUrl.split('#')[0];
        await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1500);

        // Try to click "Show phone number" button to reveal phone
        try {
            const phoneButton = await page.$('button:has-text("Show phone"), [class*="phone"] button, button[class*="reveal"], button[class*="Phone"]');
            if (phoneButton) {
                await phoneButton.click();
                await sleep(1000);
            }
        } catch (e) {
            // Button might not exist or already clicked
        }

        // Also try clicking any element that might reveal phone
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const phoneBtn = buttons.find(b =>
                    b.textContent.toLowerCase().includes('phone') ||
                    b.textContent.toLowerCase().includes('call')
                );
                if (phoneBtn) phoneBtn.click();
            });
            await sleep(500);
        } catch (e) {}

        const data = await page.evaluate(() => {
            const result = {
                phone: '',
                ownerName: '',
                yearsOnCheckatrade: '',
                fullDescription: '',
                vatNumber: '',
                overallRating: '',
                qualityRating: '',
                reliabilityRating: '',
                communicationRating: '',
                reviewCount: '',
                services: '',
                isLtd: false,
                freeEstimates: false,
                emergencyCallout: false,
                insuranceWork: false,
                location: ''
            };

            const bodyText = document.body.innerText;

            // Phone number - look for revealed number
            const phonePatterns = [
                /(?:tel:|phone:?\s*)?(0\d{3,4}\s?\d{3}\s?\d{3,4})/gi,
                /(?:tel:|phone:?\s*)?(07\d{3}\s?\d{3}\s?\d{3})/gi
            ];
            for (const pattern of phonePatterns) {
                const matches = bodyText.match(pattern);
                if (matches) {
                    result.phone = matches[0].replace(/[^\d]/g, '');
                    if (result.phone.length >= 10) break;
                }
            }

            // Also check tel: links
            const telLinks = document.querySelectorAll('a[href^="tel:"]');
            telLinks.forEach(link => {
                const num = link.href.replace('tel:', '').replace(/\s/g, '');
                if (num.length >= 10 && !result.phone) {
                    result.phone = num;
                }
            });

            // Owner/Contact name - look for "Owner" label
            const ownerMatch = bodyText.match(/Owner\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (ownerMatch) {
                result.ownerName = ownerMatch[1];
            } else {
                // Fallback: look for Mr/Mrs/Ms pattern
                const nameMatch = bodyText.match(/(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+/);
                if (nameMatch) {
                    result.ownerName = nameMatch[0];
                }
            }

            // Years on Checkatrade
            const yearsMatch = bodyText.match(/(\d+)\s*years?\s*on\s*Checkatrade/i);
            if (yearsMatch) {
                result.yearsOnCheckatrade = yearsMatch[1] + ' years on Checkatrade';
            }

            // VAT number
            const vatMatch = bodyText.match(/VAT\s*Registered\s*(?:Yes:?\s*)?(\d{9,12})/i);
            if (vatMatch) {
                result.vatNumber = vatMatch[1];
            } else {
                const vatMatch2 = bodyText.match(/VAT\s*Registered\s*Yes/i);
                if (vatMatch2) {
                    // Try to find number nearby
                    const numMatch = bodyText.match(/(\d{9,12})/);
                    if (numMatch) result.vatNumber = numMatch[1];
                }
            }

            // Ratings - look for the rating breakdown
            const overallMatch = bodyText.match(/(\d+\.?\d*)\s*\/\s*10/);
            if (overallMatch) {
                result.overallRating = overallMatch[1];
            }

            const qualityMatch = bodyText.match(/Quality\s*(?:of\s*work)?\s*(\d+\.?\d*)/i);
            if (qualityMatch) result.qualityRating = qualityMatch[1];

            const reliabilityMatch = bodyText.match(/Reliability\s*(\d+\.?\d*)/i);
            if (reliabilityMatch) result.reliabilityRating = reliabilityMatch[1];

            const communicationMatch = bodyText.match(/Communication\s*(\d+\.?\d*)/i);
            if (communicationMatch) result.communicationRating = communicationMatch[1];

            // Review count
            const reviewMatch = bodyText.match(/Reviews?\s*\((\d+)\)/i) || bodyText.match(/(\d+)\s*reviews?/i);
            if (reviewMatch) result.reviewCount = reviewMatch[1];

            // Services - collect all service items
            const serviceElements = document.querySelectorAll('[class*="service"] li, [class*="Service"] span, ul li');
            const services = [];
            serviceElements.forEach(el => {
                const text = el.textContent.trim();
                if (text.length > 3 && text.length < 50 && !text.includes('©')) {
                    services.push(text);
                }
            });
            // Dedupe and limit
            result.services = [...new Set(services)].slice(0, 15).join('; ');

            // Business flags
            result.isLtd = /\b(Ltd|Limited|LTD|PLC)\b/.test(bodyText);
            result.freeEstimates = /Free\s*Estimates?/i.test(bodyText);
            result.emergencyCallout = /24\s*(?:Hour|hr)?\s*Call[- ]?out|Emergency/i.test(bodyText);
            result.insuranceWork = /Insurance\s*Work/i.test(bodyText);

            // Location/Area
            const locationMatch = bodyText.match(/(?:covers?|based\s*in|serving)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
            if (locationMatch) result.location = locationMatch[1];

            // Description
            const descEl = document.querySelector('[class*="about"], [class*="description"], [class*="intro"]');
            if (descEl) {
                result.fullDescription = descEl.textContent.trim().substring(0, 500);
            }

            return result;
        });

        return data;
    } catch (error) {
        console.error(`Error scraping profile ${profileUrl}: ${error.message}`);
        return {
            phone: '',
            ownerName: '',
            yearsOnCheckatrade: '',
            fullDescription: '',
            vatNumber: '',
            overallRating: '',
            qualityRating: '',
            reliabilityRating: '',
            communicationRating: '',
            reviewCount: '',
            services: '',
            isLtd: false,
            freeEstimates: false,
            emergencyCallout: false,
            insuranceWork: false,
            location: ''
        };
    }
}

// Main scraping function
async function scrapeCheckatrade() {
    console.log('\n=== Checkatrade Scraper ===');
    console.log(`Trade: ${CONFIG.trade}`);
    console.log(`Location: ${CONFIG.location}`);
    console.log(`Max pages: ${CONFIG.maxPages}`);
    console.log('');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Set extra headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    const allLeads = [];
    let pageNum = 1;

    try {
        while (pageNum <= CONFIG.maxPages) {
            // New Checkatrade URL format: /Search/Trade/in/Location
            const searchUrl = `https://www.checkatrade.com/Search/${encodeURIComponent(CONFIG.trade)}/in/${encodeURIComponent(CONFIG.location)}${pageNum > 1 ? '?page=' + pageNum : ''}`;

            console.log(`Scraping page ${pageNum}: ${searchUrl}`);

            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(CONFIG.delay);

            // Handle cookie consent popup
            try {
                const acceptButton = await page.$('button:has-text("Accept all cookies"), [id*="accept"], [class*="accept"]');
                if (acceptButton) {
                    await acceptButton.click();
                    console.log('  Accepted cookies');
                    await sleep(1000);
                }
            } catch (e) {
                // Cookie popup might not appear, that's ok
            }

            await sleep(1000);

            // Debug: Save screenshot and HTML for first page
            if (pageNum === 1) {
                await page.screenshot({ path: './output/debug-screenshot.png', fullPage: true });
                const html = await page.content();
                fs.writeFileSync('./output/debug-page.html', html);
                console.log('Debug: Saved screenshot and HTML to output folder');
            }

            // Try multiple card selectors (Checkatrade may change their HTML)
            const cardSelectors = [
                '[data-testid="trade-card"]',
                '[class*="TradeCard"]',
                '[class*="trade-card"]',
                '[class*="SearchResult"]',
                '[class*="search-result"]',
                '.search-results article',
                'article[class*="result"]',
                'a[href*="/trades/"]'
            ];

            let leads = [];
            for (const selector of cardSelectors) {
                console.log(`  Trying selector: ${selector}`);
                leads = await extractLeadData(page, selector);
                console.log(`  Found ${leads.length} leads with this selector`);
                if (leads.length > 0) break;
            }

            // Fallback: Extract all trade links directly
            if (leads.length === 0) {
                console.log('  Trying fallback: extract trade links directly');
                leads = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a[href*="/trades/"]'));
                    const seen = new Set();
                    const results = [];

                    links.forEach(link => {
                        const href = link.href;
                        const handle = href.split('/trades/')[1]?.split('/')[0]?.split('?')[0];

                        if (handle && !seen.has(handle) && handle.length > 3) {
                            seen.add(handle);

                            // Try to find parent card and extract info
                            let parent = link.closest('article, div[class*="card"], div[class*="Card"], li');
                            let companyName = '';
                            let area = '';

                            if (parent) {
                                const nameEl = parent.querySelector('h2, h3, h4, [class*="name"], [class*="title"]');
                                if (nameEl) companyName = nameEl.textContent.trim();

                                const areaEl = parent.querySelector('[class*="location"], [class*="area"], address, span');
                                if (areaEl) area = areaEl.textContent.trim();
                            }

                            // If no name found, use the link text or handle
                            if (!companyName) {
                                companyName = link.textContent.trim() || handle.replace(/-/g, ' ');
                            }

                            results.push({
                                companyName,
                                area,
                                profileUrl: href,
                                handle,
                                rating: '',
                                reviews: '',
                                tradeType: '',
                                description: ''
                            });
                        }
                    });

                    return results;
                });
                console.log(`  Fallback found ${leads.length} trade links`);
            }

            if (leads.length === 0) {
                console.log('No more results found. Stopping.');
                break;
            }

            console.log(`Found ${leads.length} leads on page ${pageNum}`);

            // Scrape each profile for detailed info
            for (let i = 0; i < leads.length; i++) {
                const lead = leads[i];
                console.log(`  [${i + 1}/${leads.length}] Scraping profile: ${lead.companyName}`);

                const profileData = await scrapeProfilePage(page, lead.profileUrl);
                Object.assign(lead, profileData);

                allLeads.push(lead);
                await sleep(1000);
            }

            pageNum++;
        }

        // Generate CSV
        const csvHeader = [
            'company_name',
            'owner_name',
            'location',
            'phone',
            'overall_rating',
            'quality_rating',
            'reliability_rating',
            'communication_rating',
            'review_count',
            'years_on_checkatrade',
            'vat_number',
            'is_ltd',
            'free_estimates',
            'emergency_callout',
            'insurance_work',
            'services',
            'profile_url',
            'description'
        ].join(',');

        const csvRows = allLeads.map(lead => {
            // Clean handle from URL params
            const cleanHandle = (lead.handle || '').split('#')[0];
            const cleanUrl = (lead.profileUrl || '').split('#')[0];

            return [
                `"${(lead.companyName || '').replace(/"/g, '""')}"`,
                `"${(lead.ownerName || '').replace(/"/g, '""')}"`,
                `"${(lead.location || lead.area || '').replace(/"/g, '""')}"`,
                `"${(lead.phone || '').replace(/"/g, '""')}"`,
                lead.overallRating || '',
                lead.qualityRating || '',
                lead.reliabilityRating || '',
                lead.communicationRating || '',
                lead.reviewCount || '',
                `"${(lead.yearsOnCheckatrade || '').replace(/"/g, '""')}"`,
                `"${(lead.vatNumber || '').replace(/"/g, '""')}"`,
                lead.isLtd ? 'Yes' : 'No',
                lead.freeEstimates ? 'Yes' : 'No',
                lead.emergencyCallout ? 'Yes' : 'No',
                lead.insuranceWork ? 'Yes' : 'No',
                `"${(lead.services || '').replace(/"/g, '""')}"`,
                `"${cleanUrl}"`,
                `"${(lead.fullDescription || lead.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
            ].join(',');
        });

        const csvContent = [csvHeader, ...csvRows].join('\n');
        const outputPath = path.join(CONFIG.outputDir, getOutputFilename());

        fs.writeFileSync(outputPath, csvContent, 'utf-8');

        console.log('\n=== Scraping Complete ===');
        console.log(`Total leads: ${allLeads.length}`);
        console.log(`Output file: ${outputPath}`);

    } catch (error) {
        console.error('Scraping error:', error);
    } finally {
        await browser.close();
    }

    return allLeads;
}

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Run
scrapeCheckatrade().catch(console.error);
