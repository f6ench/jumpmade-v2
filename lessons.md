# Lessons

Patterns, mistakes, what to do differently next time.

---

## 2026-03-12 -- Don't filter directory listings as "fake" websites without testing impact

Adding 25+ directory domains to SKIP_DOMAINS dropped website yield from 47% to 27%. Directory listings (provenexpert, mylocalservices, etc.) still contain useful contact data and improve lead scoring. Test the impact of any filter change on a small batch before applying to the full pipeline.

---

## 2026-03-12 -- Local enrichment tests underperform vs proxy-enabled runs

Local test without proxies showed lower numbers because DDG/Google rate-limit after ~3 search calls per lead. With 4,000 proxies on OpenClaw, early results showed 40% mobiles vs 20% locally. Always test enrichment with proxies to get realistic yield numbers.

---

## 2026-03-12 -- Bark category slugs can't be auto-derived, must be manually mapped

Bark uses non-obvious URL slugs ('dj' -> 'dj-hire', 'handyman' -> 'handymen', 'children entertainer' -> 'childrens-entertainers'). Cloudflare blocks all programmatic discovery of the category list (WebFetch 403, stealth Puppeteer timeouts). Solution: manually compile the full category list and slug mapping. Some slugs may be wrong -- the scraper handles this with built-in error logging.

---

## 2026-03-12 -- Windows schtasks is unreliable for SSH-deployed background processes

Spent hours debugging schtasks on second laptop. Issues: (1) SYSTEM user context doesn't have PATH to node, (2) bat files created via SSH echo have trailing whitespace that corrupts env vars, (3) SCP deployment races with schtasks that already launched old versions, (4) taskkill doesn't always work as expected. Direct SSH execution works fine but doesn't survive disconnect. nohup on Linux (OpenClaw) just works.

Rule: for persistent background scraping, use Linux with nohup. Don't fight Windows schtasks for processes deployed via SSH.

---

## 2026-03-12 -- TrustATrader URL slugs are not auto-derivable from trade names

TrustATrader uses inconsistent URL patterns: some trades pluralize ('plumbers'), some don't ('handyman', 'pest-control'), some use completely different slugs ('bricklaying-masonry' for 'Bricklayer'). Auto-appending 's' caused ~30% of trades to return 0 results. Fixed with explicit URL_SLUG_MAP.

Rule: when scraping directory sites, verify URL patterns for every category manually or with a test run before the full scrape. Don't assume consistent URL patterns.

---

## 2026-03-12 -- Launch nohup instances in separate SSH sessions

Two nohup processes launched in the same SSH command (separated by &) only starts the first one reliably. The second process either doesn't start or gets killed when SSH disconnects. Always launch each instance in a separate SSH session.

---

## 2026-03-11 -- 3 concurrent Puppeteer scrapers per proxy endpoint is too many

Running 3 concurrent Puppeteer instances through the same rotating proxy endpoint caused Checkatrade to rate-limit after the first trade completed. 25/26 trades got "Failed to load" on every page. 2 concurrent works fine. The proxy endpoint is the same host:port with different session IDs, but the target site likely sees burst traffic patterns from the same IP range.

Rule: max 2 concurrent Puppeteer scrapers per machine/proxy endpoint for Checkatrade. If you need more throughput, add more machines rather than more concurrency.

---

## 2026-03-11 -- Tailscale doesn't auto-start after laptop restart

Both scraper laptops restarted (possibly power/update related) and Tailscale didn't reconnect automatically. Scrapers ran into issues and we couldn't monitor or fix them for ~6 hours until manual remote desktop login.

Rule: set Tailscale to start on boot and auto-connect. On Windows: check Tailscale settings for "Run at startup". On Linux: `sudo systemctl enable tailscaled`.

---

## 2026-03-10 (EVE) -- Copy env vars from old project before decommissioning

When migrating Railway projects, export all env vars from the old project first (`railway variables --json`). The Telegram bot tokens for Sniper OS (dev bot + Alec bot) were different from the scraper health check bot tokens stored in memory. Using the wrong tokens would have sent alerts to the wrong chat. Always pull from the live project, not from notes.

---

## 2026-03-10 -- Windows SSH + background processes need schtasks, not start /B

On Windows, `start /B` and `Start-Process` both fail to keep processes running after SSH disconnect. The only reliable method is `schtasks /Create` + `schtasks /Run` -- creates a Windows scheduled task that runs independently of any session. Also: Windows OpenSSH administrators_authorized_keys requires specific icacls permissions (SYSTEM:F + Administrators:F, inheritance removed) or key auth silently fails.

---

## 2026-03-10 -- Slugify functions need explicit plural handling

The slugify function was producing double-s filenames (e.g., `kitchenss.csv`, `bathroomss.csv`) because the trade name already ended in "s" and the filename template appended another "s". Fix: add `.replace(/-?s$/, '')` to strip trailing "s" before the filename adds one. Check all places slugify is used when fixing -- it was duplicated across 8 files.

---

## 2026-03-10 -- Research the market before building scrapers for a new geography

US market analysis revealed structural differences that change everything: no single dominant platform (need multi-platform from day 1), mandatory state licensing (free public data for enrichment), shared leads (speed-to-respond is the #1 value prop), TCPA regulations on SMS ($500-1,500 per violation), and 50-state geographic complexity. If we'd just started building Angi scrapers without this research, we'd have missed the HVAC-first strategy (highest job values + seasonal urgency), the public permit/license data advantage, and the 10DLC SMS compliance requirement.

Rule: before expanding to a new market, do the full research first. Platform mapping, regulatory scan, competitor analysis, pricing benchmarks. A day of research saves weeks of building the wrong thing.

---

## 2026-03-10 -- Match scraper approach to site architecture

Different sites need different scraping strategies. Trying Puppeteer on everything wastes time and gets blocked. Better approach: identify the rendering tech first, then choose the lightest tool that works.
- Server-side HTML (TrustATrader): standard Puppeteer page.evaluate()
- Remix SSR (Rated People): plain HTTP + JSON extraction from __remixContext -- no browser needed
- Internal JSON API (MyJobQuote): plain HTTP to their API endpoint -- no browser needed
- Cloudflare-protected (Bark): puppeteer-extra-plugin-stealth + longer delays + browser rotation
- Custom CAPTCHA (MyBuilder): stealth plugin + human test detection + auto-resolve wait

Rule: always check robots.txt and do a plain HTTP request first. If you get clean HTML or JSON, skip Puppeteer entirely. Only use stealth plugin for sites that actively block automation.

---

## 2026-03-01 (PM4) -- Always add workflow conditions AND time windows from day one

Stale Handler fired on all leads regardless of whether they'd replied, and at any hour. Two separate problems that compounded: customers who'd already been handled got follow-ups, and sometimes at 3am. Both should have been in the original workflow design.

Rule: Every follow-up workflow needs (1) a condition checking whether the contact has already engaged, and (2) a business-hours send window. Treat these as mandatory, not optional.

## 2026-03-01 (PM) -- Telegram bots: clear webhook on startup, strip @bot suffix

Telegram bot was silently failing because a stale webhook was intercepting messages before polling could receive them. Fix: call deleteWebhook() on startup before starting polling. Also: Telegram sends commands with @BotName suffix (e.g. /sniper_on@SniperOSBot) which must be stripped before matching. And chat IDs from env vars need trimming. All three are easy to miss and cause silent failures.

## 2026-03-01 -- Build a kill switch before going live with any client

Alec had no way to properly stop the system when things went wrong. "Pausing AI in GHL" isn't enough -- leads were still being claimed. Every client needs a real off switch from day one: an API endpoint (and eventually Telegram command) that stops lead claiming at the source. Add this to onboarding checklist.

## 2026-03-01 -- When a client is angry, turn everything off first, fix second

Don't try to patch while the system is live. Turn it off completely, fix everything, test, then turn back on. Alec's frustration escalated because the system kept doing things while we were trying to fix it.

## 2026-02-28 -- Never put client's personal number in AI messages

Alec's number in the AI first message caused customers to call/text him directly. GHL lost visibility, follow-ups kept firing to handled leads, and we wasted money on duplicate SMS. The whole automation loop breaks when conversations happen off-platform.

Rule: AI messages should never contain the client's personal contact details. All communication must flow through the app so the system can track state.

## 2026-02-28 -- Always check SMS segment length

4+ segment messages (460+ chars) cost 4x a single segment. 51 such messages ate 43% of Alec's SMS budget. Should have enforced character limits in the AI prompt from day one.

Rule: AI SMS responses must stay under 160 chars (1 segment). If they need to be longer, 320 chars max (2 segments). Audit new prompts by checking actual message lengths in GHL before going live.

## 2026-02-28 -- Add time restrictions to all automated workflows

8 messages sent between midnight-6am. No customer wants a 3am text from their plumber's AI assistant. Should have been caught during workflow setup.

Rule: Every automated SMS workflow gets an 8am-8pm send window. No exceptions.

## 2026-02-28 -- Audit costs before setting retainer price

We set GBP 75/mo retainer before knowing actual GHL costs. Got lucky -- margin is healthy (68-84%). But should have run at least one billing cycle first.

Rule: For new clients, estimate GHL costs before quoting retainer. Factor in expected SMS volume, AI usage, and phone number costs. Target minimum 60% margin.

## 2026-02-24 -- Demo the product before it's polished at your own risk

Feb 24 call with Alec surfaced 4 blockers. He wasn't upset, but it delayed payment. Better to fix obvious issues before showing the client.

Rule: Before any client demo, test the full flow yourself. Send a test lead, read the AI messages, check the contact record, try the estimate. If anything looks wrong, fix it first.
