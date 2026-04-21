# Enrichment Pipeline Tuning Log

Real-time record of issues discovered and fixes applied during enrichment runs.

## 2026-03-24: Full 288-trade enrichment run (plumbers first)

### Fix 1: "Verified,," junk entries (02:00)
- **Problem**: 46% of TrustATrader leads were anonymous placeholder entries with no company name, producing D0 junk scores
- **Impact**: ~2,176 junk rows out of 91,735 total across all master files
- **Fix**: Python filter script removed "Verified,," rows from master-links before enrichment
- **Result**: 0% D0 junk after fix (was 47% before)

### Fix 2: Master file phone column ignored (02:15)
- **Problem**: `enrich-leads-lite.js` ignored the `phone` column from input CSV -- phones scraped from TrustATrader/RatedPeople were never used
- **Impact**: Mobile conversion dropped to ~5% because only website-scraped phones were captured
- **Fix**: Added `inputPhone` variable at line 1566, fallback injection before phone merge step -- seeds phone from master file if enrichment found nothing, with tracking number filter
- **Result**: Mobile conversion jumped from 5% to 29%

### Fix 3: TrustATrader tracking number prefixes (02:30)
- **Problem**: 75% of master file phones from TrustATrader were platform call-tracking VoIP numbers (07307, 07360, 07308, 07309)
- **Impact**: Junk tracking numbers stored as real mobiles
- **Fix**: Added `PLATFORM_TRACKING_PREFIXES = ['07307', '07360', '07308', '07309']` to `isTrackingNumber()` in both `enrich-leads-lite.js` and `fix-enriched.js`
- **Result**: Mobile conversion improved from 29% to 33%+ (tracking numbers filtered out)

### Fix 4: `website_via_search` not in TRUSTED_SOURCES (02:40)
- **Problem**: `fix-enriched.js` Phase 1 stripped 31 leads with legitimate website-sourced phones because `website_via_search` wasn't in TRUSTED_SOURCES
- **Impact**: Lost 31 valid phone numbers during post-processing
- **Fix**: Added `website_via_search` to TRUSTED_SOURCES array in `fix-enriched.js`
- **Result**: Phones from search-engine website discovery preserved

### Fix 5: Apify 403 spam (02:50)
- **Problem**: All 5 Apify free accounts exhausted (403 "Monthly usage hard limit exceeded"), enricher spammed 67 batches of failed API calls per trade
- **Impact**: Wasted time on failed API calls, noisy logs
- **Fix**: Renamed `apify-accounts.json` to `.bak` on OpenClaw so enricher skips Apify entirely
- **Result**: LinkedIn enrichment disabled for this run, no more API spam

### Fix 6: Cross-platform phones bypass tracking filter (03:05)
- **Problem**: `crossMatch.phones` merged into final mobile/landline with only `isValidUKMobile()` check, NOT `isTrackingNumber()`. 164 tracking numbers (07307/07360) from cross-platform index contaminated 18% of plumber leads
- **Source breakdown**: 91x 07307, 67x 07360, 6x 07308 -- all from `cross_platform` phone source
- **Fix**: Added `&& !isTrackingNumber(n, checkatradePhone)` to both `crossMatch.phones.filter()` calls at lines 1794 and 1798
- **Result**: Enricher restarted from checkpoint 901/1229. Remaining leads will be clean. Existing 164 contaminated leads in plumber file will be cleaned by fix-enriched.js Phase 1 later
- **Deployed**: OpenClaw (live) + local copy

---

## Running Conversion Rates (plumber trade, lead 901/1229)

| Metric | Rate | Count |
|--------|------|-------|
| Mobile | 44%* | 404/899 |
| Landline | 20% | 186/899 |
| Any phone | 48%* | 439/899 |
| Email | 30% | 272/899 |
| Website | 63% | 567/899 |
| A tier | 0.7% | 6/899 |
| B tier | 67% | 605/899 |
| C tier | 28% | 255/899 |
| D tier | 2% | 20/899 |

*Includes 164 tracking numbers from Fix 6. True mobile rate after cleanup: ~27% (240/899). Future leads from 901+ will be clean.

## Phone Source Distribution

| Source | Count | Notes |
|--------|-------|-------|
| cross_platform | 324 | 164 are tracking numbers (Fix 6) |
| website_via_search | 45 | Clean |
| website | 39 | Clean |
| website_rescrape | 22 | Clean |
| master_input | 2 | Fallback from master CSV |

## Known Tracking Prefixes

| Prefix | Platform | Type |
|--------|----------|------|
| 07307 | TrustATrader | VoIP call tracking |
| 07360 | TrustATrader | VoIP call tracking |
| 07308 | TrustATrader | VoIP call tracking |
| 07309 | TrustATrader | VoIP call tracking |
| 03xxx | Various | Non-geographic |
| 084xx | Various | Revenue share |
| 087xx | Various | Premium rate |
| 070xx | Various | Personal numbering |

## Speed

~68-71 leads/hour (including browser restarts and proxy rotation)

## Proxy Status

5.77 GB of 48 GB remaining on Immaculate IPs Scraping Residentials. 20 GB top-up in Stripe checkout (pending payment).
