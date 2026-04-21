# Lead Tools

Checkatrade scraper and lead enrichment tools for Sniper OS.

## Setup

```bash
cd lead-tools
npm install
```

## Part 1: Scrape Checkatrade

Scrapes Checkatrade search results for a specific trade and location.

```bash
# Usage: node scrape-checkatrade.js [trade] [location] [max_pages]

# Examples:
node scrape-checkatrade.js plumber Oxford 10
node scrape-checkatrade.js plumber "Milton Keynes" 5
node scrape-checkatrade.js electrician Birmingham 20
```

**Output:** `output/checkatrade-[trade]-[location]-[date].csv`

**Fields collected:**
- company_name
- owner_name
- area
- phone (Checkatrade proxy)
- rating
- reviews
- trade_type
- years_on_checkatrade
- vat_number
- profile_url
- handle
- description

## Part 2: Enrich Leads

Takes a CSV of leads and finds their real contact details (website, phone, email).

```bash
# Usage: node enrich-leads.js [input_csv] [output_csv]

# Examples:
node enrich-leads.js ./input/leads.csv ./output/enriched.csv
node enrich-leads.js ./output/checkatrade-plumber-Oxford-2026-02-21.csv ./output/enriched-oxford.csv
```

**Input CSV requirements:**
- Must have headers
- Needs columns: `company_name`, `area` (or similar)
- Optional: `owner_name`, `phone`

**Output fields:**
- company_name
- first_name (extracted from owner_name)
- last_name (extracted from owner_name)
- full_name
- area
- checkatrade_phone
- real_phone (found on website)
- email (found on website)
- website
- rating
- reviews
- trade_type
- profile_url

## Full Workflow

1. Scrape Checkatrade for leads:
   ```bash
   node scrape-checkatrade.js plumber Oxford 10
   ```

2. Enrich with real contact details:
   ```bash
   node enrich-leads.js ./output/checkatrade-plumber-Oxford-2026-02-21.csv ./output/enriched-oxford.csv
   ```

3. Import `enriched-oxford.csv` into GHL

## Notes

- **Rate limiting:** Built-in 2 second delays between requests
- **Success rate:** Expect ~60-70% website match, ~50% real phone/email
- **Checkatrade changes:** If scraping breaks, selectors may need updating
- **Headless browser:** Uses Puppeteer - no visible browser window
