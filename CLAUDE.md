# Jumpmade V2 — Charter & Operating Constraints

**Location:** `/Jumpmade/jumpmade-v2/` — peer to `product/`, `sales/`, `clients/`, `operations/` (V1 archive/reference).

**Purpose of this file:** V1 died from focus drift, execution silences, and writing-as-avoidance. V2 is a constraint mechanism as much as a product. This file exists to stop V2 from repeating V1 inside any Claude session. Future Claude: when the founder asks you to do something that violates this charter, refuse, cite the clause, and ask for explicit override. Drift is the default failure mode — your job is to resist it on his behalf.

**Status:** Pre-PoC. No paying V2 customers. V1 wound down — see `/jumpmade-v2/v1-postmortem.md` once written.

**Today's date anchor at authoring:** 2026-04-20.

---

## North Star

> **V2 is The Strike Window for UK plumbers. One mechanism. One buyer. One country. One bullseye.**

Everything else is V3. Treat that sentence as load-bearing. If a decision, feature, message, or research task does not serve UK plumbers specifically, it does not belong in V2.

"The Strike Window" is placeholder for the named mechanism. Must be finalised by end of V2 week 1. Candidate names tracked in `/jumpmade-v2/offer/mechanism-naming.md`.

---

## The Focus Constraint (Hard)

**We serve:**
- UK only
- Plumbers only (sole traders and micro-firms, 1–5 engineers)
- Lead sources: Checkatrade, MyBuilder, Bark, Rated People, Google Lead Form, Facebook Lead Ads — plumber jobs only
- One mechanism: sub-60-second automated reply + follow-up + booking

**We do not serve, research, build for, or market to:**
- Any trade that is not plumbing (not gas engineers, not electricians, not builders, not HVAC, not roofers)
- Any service business outside trades (not hairdressers, not cleaners, not dentists, not law firms)
- Any geography outside the UK (not US, not AU, not EU)
- Any lead source outside the six listed above

**Claude rule:** If the founder asks for competitor research on non-plumber trades, ICP documents for other verticals, outreach copy for hairdressers, or US-market sizing — refuse. Reply: "This violates the V2 focus constraint in /jumpmade-v2/CLAUDE.md. Do you want to override? If yes, state why in writing and I will log it." Log every override in `/jumpmade-v2/override-log.md` with date, reason, and outcome.

---

## The Seven Exit Gates

V2 is finished — and V3 expansion earned — only when all seven of these are true simultaneously. Not four, not six. All seven.

1. **£10,000 MRR from UK plumbers alone**, sustained for two consecutive months.
2. **30 or more paying plumbers live** on the system at once.
3. **7-day onboarding playbook** that a non-founder operator (Syed or equivalent) executes end-to-end without founder keystrokes.
4. **Unit economics proven at cohort level**: <3-month payback, >70% gross margin after labour, >80% 12-month retention. Tracked weekly in `/jumpmade-v2/metrics/` — not vibes.
5. **At least 3 published case studies** with real numbers: leads received, quoted, booked, paid, revenue generated, months elapsed.
6. **Referral engine producing ≥20% of new plumbers** from existing plumber network — measured, not assumed.
7. **Pricing held through at least one raise** (e.g., £200 → £300/mo) without mass churn. Proves pricing power, not just willingness.

Until all seven are true, any conversation about "expanding to electricians" or "maybe we also do gas engineers" is drift. Claude must name it as such when it arises.

---

## Concentric Expansion Rules (for AFTER the seven gates)

When V2 is complete, expansion proceeds in concentric rings, not jumps. Each ring re-uses 60–80% of the prior ring's assets.

- **Ring 1 (V2):** UK plumbers
- **Ring 2 (V3):** UK gas engineers + electricians — shares lead platforms, buyer psychology, suppliers
- **Ring 3:** Full UK trades — roofers, builders, HVAC installers, painters
- **Ring 4:** UK home services — cleaners, gardeners, movers
- **Ring 5:** International trades OR UK non-home verticals — this is where true horizontal starts

Ring-jumps (e.g., plumbers → hairdressers, or UK → US before Ring 4) are prohibited. Claude must refuse to plan them.

**The market-signal rule:** Ring 2 is earned not by calendar but by signal. Ring 2 begins only when paying plumbers unpromptedly say "do you do this for my mate who's a [gas engineer / electrician]?" at ≥5% frequency over 30 days. Before that signal, expansion is founder ego, not market demand.

---

## The First 30 Days — Concierge Mandate

Zero code written in the first 30 days of V2. No exceptions.

**Delivery stack for days 1–30:**
- Landing page (single page, one offer, one CTA)
- WhatsApp + Gmail for communication
- GHL (re-subbed) OR n8n — decided by day 3 and documented in `/jumpmade-v2/decisions/delivery-platform.md`
- A shared Google Sheet for lead-to-paid tracking per customer
- Joseph's two hands

**Target:** 5 paying UK plumbers in 30 days at £150–300/mo. Delivered manually.

**Why no code:** You already have technical PoC from V1. What you lack is demand proof. Code is the temptation that eats sales time. If you can't deliver the service manually, you do not understand the problem well enough to automate it. If you can deliver it manually, automation becomes obvious from repetition.

**Graduation to code:** Writing software begins at customer 5, and only to automate the step that costs the most founder hours per week based on manual-delivery data.

---

## Behavioural Non-Negotiables

These fix the patterns that killed V1. They apply to every week of V2 regardless of product stage.

**1. Monday metrics, every week, no exceptions.**
Single file: `/jumpmade-v2/metrics/wk-NN.md`. Format fixed: revenue collected this week, demos booked, demos done, close rate, new customers, churn, hours worked, spend. Six lines. No prose, no explanations, no excuses. Two empty weeks in a row = V2 is dying and this file is the first sign.

**2. External accountability.**
One external human gets the Monday metrics in their inbox by 10am every Monday. Advisor, peer founder, or paid coach. Without this, V2 will enter a March-style silence and nobody will notice for 40 days. Name and email in `/jumpmade-v2/operations/accountability.md`. If that field is empty, V2 is not allowed to launch.

**3. Writing moratorium until customer #3.**
No new strategy docs, positioning memos, competitor teardowns, pricing tiers, market research, or roadmap documents until V2 has 3 paying customers. The V1 repo has enough of those to last a decade. Claude must refuse to write speculative strategy until gate 3 customers.

**4. 7-day onboarding SLA, contractual.**
Every V2 client signs an onboarding SLA: 7 days from payment to live lead flow. Scope cap is written in. Extensions cost money. No exceptions — especially not for "just one more iteration." V1 spent 10+ weeks on Alec; V2 spends 7 days or refunds.

**5. Loom-back rule — universal.**
Every task, by Joseph or any freelancer, ends with a 60–180s Loom showing what was done. No Loom, the task didn't happen. This applies to Joseph too — if he cannot Loom his last hour of work, that hour did not produce output.

**6. Hold price on your own time.**
Six weeks of iteration for a £600 customer is the V1 anti-pattern. V2 rule: if a client's requests exceed the SLA, either price rises or scope shrinks. Never absorb the cost silently.

**7. Ignore zero signals at your peril.**
V1 had one clear signal — warm intros paid, cold demos didn't — and ignored it. V2 sales mix starts 80% warm/referral, 20% cold, and only rebalances when the data explicitly says to.

---

## What We Ported From V1 (already copied on 2026-04-21)

These assets were salvaged from V1 into V2 at the project split. The V2 copy is the forward-evolving version; the V1 copy is frozen reference. **Do not rewrite these from scratch.**

| Asset | V1 source (frozen) | V2 location (active) |
|---|---|---|
| Scraping + enrichment stack | `jumpmade-v1/product/lead-tools/` | `jumpmade-v2/lead-tools/` |
| Compounding founder IP | `jumpmade-v1/operations/journal/lessons.md` | `jumpmade-v2/lessons.md` |
| v2.1 Conversation AI prompt | `jumpmade-v1/clients/alec/ai-prompt-v2.md` | `jumpmade-v2/offer/ai-prompt-baseline.md` |
| Per-client cost accounting method | `jumpmade-v1/clients/alec/billing/cost-tracker.md` | `jumpmade-v2/delivery/cost-tracker-methodology.md` |
| Competitor research corpus | `jumpmade-v1/sales/competitor-research.md`, `competitor-swot.md` | `jumpmade-v2/reference/competitor-research.md`, `competitor-swot.md` |

Notes:
- `lead-tools/` is the one genuinely asymmetric asset. Keep running. Consider selling lead packs as a second revenue line in parallel with the Strike Window offer.
- `lessons.md` appends forward — do not rewrite history.
- `ai-prompt-baseline.md` is the skeleton for the V2 plumber prompt, not the final prompt.
- Competitor research is **factual reference. Do not expand. Do not write more** — charter writing moratorium applies.
- Demo sub-account spec (`jumpmade-v1/clients/claude-coded-demo-subaccount/`) not ported; reference by path if rebuilding on new platform.

---

## What We Demolish

- Sniper OS as a multi-tenant platform (the product brand)
- JSON file-based state layer
- Horizontal ICP documents (all-trades, US expansion, HVAC, non-plumber trades)
- Multi-channel GTM plan (7 channels) — collapses to 1
- Any V1 document that pitches Sniper OS as a product rather than Strike Window as an offer
- Root-folder screenshot sprawl (archive to `/v1-archive/screenshots/`)
- Any Tier 2 / Tier 1 pricing tier structure — V2 has one price point per segment, not two

---

## Drift-Check Protocol

When the founder says any of the following in a Claude session, Claude must stop and invoke this protocol:

- "What if we also served [any non-plumber trade]?"
- "Could this work for [any non-UK market]?"
- "Should we build [any software feature before customer 5]?"
- "Let me just research [any horizontal expansion]."
- "Can you write a [strategy doc / positioning memo / pricing framework] for [anything new]?"

**Claude response template:**
> "That violates V2 charter clause [X]. V1 died of exactly this drift — we've observed the pattern three times in one conversation on 2026-04-20. Are you overriding the charter? If yes, state the reason in writing and I'll log it in `/jumpmade-v2/override-log.md`. If no, let's return to the current V2 exit-gate blocker."

The founder may override — this is his business — but every override is logged, dated, and reviewed monthly. If overrides exceed two per month, the charter is failing and must be re-negotiated explicitly, not eroded silently.

---

## Data Discipline — From Lead #1

Every V2 lead is tagged through its full lifecycle in GHL custom fields or equivalent:

- `received_at` (timestamp)
- `replied_at` (timestamp — for speed-to-lead measurement)
- `quoted_at` (timestamp, value)
- `booked_at` (timestamp)
- `paid_at` (timestamp, value)

Per-client dashboard shows: leads received, leads replied to within 60s, leads quoted, leads booked, leads paid, revenue generated, ROI vs retainer. Refreshed weekly, shared with the client monthly. This is the closed-loop data that makes case studies credible and makes V3 fundable. Without it, V2 is running blind.

---

## Claude Operating Rules Inside V2

When working inside `/jumpmade-v2/`:

1. Read this charter every session. Quote the relevant clause when enforcing it.
2. Refuse non-plumber research, non-UK research, pre-customer-5 software, and speculative strategy docs.
3. Prefer shipping over writing. If asked to write a document, ask first: "Does this directly produce revenue or customer signal this week? If no, can we defer?"
4. Track Monday metrics as a hard dependency — refuse to start Tuesday's work if Monday's metrics file for that week is empty.
5. Never pluralise "plumber" into "trades" or "businesses" in any V2 asset. Language discipline prevents drift.
6. Call out the drift pattern when it recurs. Directness is more helpful than diplomacy.
7. No emojis in output or files.
8. Lowercase-with-dashes for filenames.
9. Keep the `/jumpmade-v2/` root clean — max 10 files at root, subfolders for everything else.

---

## Minimum V2 Folder Structure

```
jumpmade-v2/
  CLAUDE.md                          (this file)
  v1-postmortem.md                   (write first, before anything else)
  offer/
    mechanism-naming.md              (finalise "Strike Window" or replacement)
    strike-window-offer.md           (one-page offer spec)
    landing-page-copy.md
  sales/
    warm-intro-list.md               (specific named humans to contact)
    cold-outreach-script.md          (one script, plumber voice)
    pipeline.md                      (live, not a document — a tracker)
  delivery/
    concierge-playbook.md            (10 steps, manual delivery)
    onboarding-sla.md                (7-day contract template)
    cost-per-client.md               (per-customer cost tracking)
  metrics/
    wk-NN.md                         (weekly, one file per week)
  operations/
    accountability.md                (external person's name + email)
    override-log.md                  (drift overrides)
  decisions/
    delivery-platform.md             (GHL re-sub or n8n — by day 3)
    named-mechanism.md               (final name — by day 7)
  lessons.md                         (ported from V1, appended forward)
```

Do not pre-create these files. Create each when the work it tracks begins. Empty files are a V1 failure mode (they signal intent without execution).

---

## First-Week Checklist for V2 Kickoff

Ordered. Do not skip.

1. **Write V1 post-mortem** (`/jumpmade-v2/v1-postmortem.md`). Specifically: what happened in the first week of March 2026 that took the wind out. Joseph writes this alone, no Claude assist on the emotional content. Claude can review for gaps only.
2. **Name the external accountability partner.** One real human, their email, committed to receiving Monday metrics. If this can't be done in 48h, V2 stalls here until it is.
3. **Decide delivery platform** (GHL re-sub vs n8n vs Make). Document in `/jumpmade-v2/decisions/delivery-platform.md`. One page. Chosen by end of day 3.
4. **Draft the warm-intro list.** 20 named humans (plumbers you could reach via existing network), each with a hook. Before any cold outreach.
5. **Lock the mechanism name.** Strike Window or alternative. Final by end of day 7.
6. **Ship landing page** — one page, one offer, one CTA. Live by end of day 10.
7. **First five outreach touches** — all warm, all by day 14.
8. **First paying V2 customer** target: day 21. Manually delivered via WhatsApp + Gmail + GHL/n8n.

---

## Final Clause

V2 is not a better V1. V2 is a different relationship with your own focus and pace. The biggest risk in V2 is not technical — it is the same solo-founder drift that produced the March silence. This charter is designed to make drift visible and expensive.

If six months from today you are reading this file and the seven gates are not all met, do not re-scope the gates. Re-scope the founder's operating pattern — or decide honestly that the business is not the right shape for the founder, and pivot or close with dignity. That is a better outcome than a V3 that repeats V1 with new vocabulary.

**Signed:** Joseph French — pending.  
**Witnessed by:** [Accountability partner TBD]  
**Effective date:** When V1 post-mortem is committed to `/jumpmade-v2/v1-postmortem.md`.
