# V2 Launch Plan — Day 4 → Customer #1

**Date authored:** 2026-04-25 (Day 4 of V2)
**Status:** **Living plan — not gospel.** This is the current forecast, not a contract. Update as items complete, dates shift, or new constraints surface. Re-read at the start of each Monday metrics send and amend in the same commit if anything has moved.

**Date range:** Mon 2026-04-27 → Tue 2026-05-12 (Day 21)
**Goal:** First V2 paying customer signed and onboarded.

**Status as of 2026-04-27 (Day 6, Monday):** Phase 1 not started — all 6 items (1-6) outstanding. Founder intent today: complete Phase 1 in one focused sprint. Dates below reflect the late start. Day 10 page-live deadline (Fri 2026-05-01) preserved — 4 working days remaining.

---

## Source documents

Each item below traces back to one or more of these committed docs. If an item below contradicts a source doc, the source doc wins — re-amend this plan to fit.

| Doc | Authority for |
|---|---|
| `CLAUDE.md` | V2 charter, exit gates, concierge mandate, expansion rules |
| `rules.md` | Founder ground rules — especially #1 (Monday metrics) and #5 (7-day SLA) |
| `decisions/offer.md` | Locked offer, deliverables, guarantee mechanics, Alec back-test note (line 142) |
| `decisions/delivery-platform.md` | GHL stack, technical verifications, six per-client workflows |
| `offer/landing-page-copy.md` | Locked landing page copy + WhatsApp/Calendly config |
| `override-log.md` | Override #3 (platforms 6→8), Override #4 (metrics-send delay) |
| `operations/accountability.md` | Seyi as Monday metrics partner |

---

## Phase 1 — Operational setup (Mon 2026-04-27 → Tue 2026-04-28)

Two days, late start. Items 1-6 — the page CTA cannot work without these. Founder intent: complete in one focused sprint today; Tuesday as overflow for tech verifications (item 6) that may require waiting on third parties.

| # | Item | Time | Blocker | Source |
|---|---|---|---|---|
| 1 | WhatsApp Business number provisioned + verified | 30 min | Hard — page CTA hardcodes to it | `landing-page-copy.md` launch checklist |
| 2 | Calendly account — 15-min event, 24h buffer (NOT 3-day), one form question | 20 min | Hard — referenced in WhatsApp greeting | `landing-page-copy.md` config table |
| 3 | WhatsApp Business **greeting message** configured with Calendly URL | 5 min | Hard — auto-reply within 60s of first inbound message | `landing-page-copy.md` exact text |
| 4 | Phone number for *"or call"* secondary CTA — could be the WhatsApp Business number routed | Variable | Hard — replaces `[phone]` placeholder | `landing-page-copy.md` |
| 5 | Email (`joseph@jumpmade.com` or similar) for *"or email"* secondary CTA | 15 min | Hard — replaces `[email]` placeholder | `landing-page-copy.md` |
| 6 | **Technical verifications** (per `decisions/delivery-platform.md` open items): Square UK availability on GHL Pro · GHL sub-account limits · Twilio UK + WhatsApp Business pricing · n8n cloud tier sizing · Sniper OS Railway boot health | 2-3 hrs | Hard — failed verification means stack revision before customer #1 | `delivery-platform.md` lines 165-171 |

---

## Phase 2 — Build the page (Wed 2026-04-29 → Fri 2026-05-01)

Three days. Items 7-12. From blank URL to live page. Wed-Thu for build + mobile testing, Fri for go-live.

| # | Item | Time | Blocker | Notes |
|---|---|---|---|---|
| 7 | Choose hosting — Carrd recommended (60-90 min build), Framer if more design polish wanted (2-3 hr build) | 5 min | Hard | Concierge mandate forbids hand-coding |
| 8 | Build the page using committed `offer/landing-page-copy.md` | 60-180 min | Hard | Paste the locked copy section by section |
| 9 | Replace `[phone]` and `[email]` placeholders with real values | 5 min | Hard | From Phase 1 |
| 10 | Mobile render check on iPhone and Android | 15 min | Hard | UK plumbers read on van phone |
| 11 | `firstquotesystem.co.uk` 301 redirect to `jumpmade.com` | 10 min | Soft | Cosmetic — preserves the £10 already spent on the domain |
| 12 | **PAGE GOES LIVE at jumpmade.com** | — | **Day 10 deadline: Fri 2026-05-01** | First milestone |

---

## Phase 3 — Pre-outreach prep (Sat 2026-05-02 → Mon 2026-05-04)

Three days. Items 13-15. The bridge between *page exists* and *plumbers see page*.

| # | Item | Time | Blocker | Notes |
|---|---|---|---|---|
| 13 | **Alec back-test on the 6-job guarantee** — pull last 30 days of his V1 booking data, count actual booked jobs. Per `decisions/offer.md` line 142: *"the single most important calibration task remaining."* If Alec averaged 4-5 jobs/month, drop the guarantee to 5 jobs (requires Override #5 for offer change) before any plumber sees the page | 1-2 hrs | Hard | Wrong threshold = refund cash burned on every failed customer |
| 14 | **First metrics file `wk-18.md` to Seyi** by Mon 2026-05-04 10:00 (per Override #4) | 10 min | Hard | Behavioural non-negotiable |
| 15 | Identify 5 warm-intro candidates — specific names, contact methods, why each is warm. Write to `pipeline/warm-intros.md` (file to be created) | 60 min | Hard | First five touches go out Day 14 |

---

## Phase 4 — Outreach + demos (Tue 2026-05-05 → Mon 2026-05-11)

Seven days. Items 16-19. Page goes from sitting empty to receiving paid attention.

| # | Item | Time | Blocker | Notes |
|---|---|---|---|---|
| 16 | **First 5 warm-intro outreach touches sent** — Tue 2026-05-05 (Day 14) | 1-2 hrs | Hard | First paid traffic to the page |
| 17 | Demos booked (rolling) via Calendly | — | Soft | Depends on outreach response rate |
| 18 | Demos completed (rolling) | 15 min × N | Soft | Each demo is also data |
| 19 | Iterate landing page copy + sales script based on what plumbers actually say on demo calls | Ongoing | Soft | This is what customer signal is for |

---

## Phase 5 — Customer-1 readiness (parallel with Phase 4, finished Mon 2026-05-11)

Items 20-27 happen in parallel with outreach. Don't block page-live but DO block customer #1 from signing.

| # | Item | Time | Owner | Notes |
|---|---|---|---|---|
| 20 | **T&Cs page** drafted — covers 30-lead guarantee condition, refund mechanics, cancellation, data handling | 2-3 hrs | Founder (could scaffold via future Claude session) | 30-lead condition lives here, not on landing page |
| 21 | T&Cs page published — linked from landing-page footer | 15 min | Founder | Could be placeholder for first 48 hours of page-live |
| 22 | **Customer agreement / contract template** — covers all conditions + payment terms, IP, data rights, scope, cancellation | 3-4 hrs | Founder + lawyer review if budget allows | Required before any signature |
| 23 | **GHL Starter tier subscribed** — $97/mo, founder's main account | 10 min | Founder | Per `decisions/delivery-platform.md` Starter tier decision |
| 24 | **Six GHL workflows configured** — lead ingest, first-reply SMS, quote-sent follow-up, no-show recovery, review ask, monthly report | 4-6 hrs | Founder | Per `delivery-platform.md` lines 124-129 |
| 25 | **Branded estimate + invoice templates** built — with placeholders for client logo, payment terms, bank details | 2-3 hrs | Founder | Section 4 of landing page commits to these |
| 26 | **Onboarding Loom recorded** — for first 3 customers (per landing page Section 4) | 60 min after first customer signs | Founder | Per-customer, recorded post-sign |
| 27 | **Customer onboarding playbook** documented — exactly what happens between contract-signed and live-lead-flow within 7 days (the SLA) | 2-3 hrs | Founder | Required for 7-day SLA defensibility |

---

## Phase 6 — Customer #1 signs (target Tue 2026-05-12 / Day 21)

Items 28-31. The proof of demand the entire V2 charter exists to test.

| # | Item | Trigger |
|---|---|---|
| 28 | Plumber signs contract | After fit call → tour of setup → contract review |
| 29 | Plumber pays £300 setup + £250 month 1 | Contract signed |
| 30 | 7-day onboarding clock starts | Payment cleared |
| 31 | Live lead response active for customer #1 | Day 28 = Tue 2026-05-19 |

---

## Summary

- **Total items:** 31
- **Total elapsed days:** 17 (Sat 2026-04-26 → Tue 2026-05-12)
- **Hard blockers — page live:** 12 (items 1-12)
- **Hard blockers — customer #1 signs:** 8 (items 13, 15, 20-26)
- **Soft / rolling:** 11 (items 11, 14, 16-19, 27-31)

---

## Revision policy

- Re-read this file at the start of each Monday metrics send.
- If a date has slipped, amend the date here and commit alongside the metrics file.
- If an item is no longer relevant (e.g. customer #1 onboards a different way), amend the description here, do not delete it.
- If a new item surfaces (e.g. a Carrd-specific issue, a Calendly form question that needs adding), insert it in the right phase.
- Do not let this file go stale. A stale launch plan is worse than no launch plan because it gives false confidence about what's been done.
- This plan is the founder's plan. Claude amends it on request, does not own it.
