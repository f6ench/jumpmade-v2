# Decision — V2 Delivery Platform

**Date:** 2026-04-21 (Day 3 of V2)
**Status:** DECIDED
**Owner:** Joseph French
**Next review:** 2026-06-16 (first strategic review point, per Override #1)

---

## One-line decision

Re-subscribe **GoHighLevel (Pro tier)** as the CRM + SMS layer, retain the existing **Railway-housed Sniper-OS backend** for Checkatrade lead ingestion only, use **n8n (cloud)** as the orchestration layer for all other lead sources and for AI conversation routing, replace GHL native Conversation AI with **external AI (Claude / GPT) via n8n**, use **Square** as the payment processor to support cash-in-hand plumbers, defer voice AI and in-house platform build entirely.

---

## The V2 stack

| Layer | Tool | Role |
|---|---|---|
| CRM of record | GHL (Pro tier, $297/mo) | Contact + opportunity management, SMS sender, invoice engine |
| Checkatrade ingestion | Existing Railway-housed Sniper OS backend (unchanged) | Email listener → Checkatrade API → Gemini score → GHL push |
| Other lead sources | n8n (cloud) — **config only, no custom code** | MyBuilder, Bark, Rated People, Google Lead Form, Facebook Lead Ads → normalised → GHL |
| Conversation AI | Claude / GPT API via n8n | Replaces GHL native Conversation AI. Books appointments, qualifies leads, sends to plumber |
| Messaging | Twilio via GHL, WhatsApp Business via Twilio | New-lead channel. Separate from plumber's personal numbers. |
| Payments | Square (UK availability to verify) | Card + cash both supported. Removes "no payment processor" invoice notice. |
| Calendar | Google Calendar | Plumber's existing calendar, integrated via GHL booking |
| Client-facing mobile app | None by default | Plumber never logs in. SMS + WhatsApp + calendar only. Lead Connector offered on request to multi-plumber businesses. |

---

## GHL tier progression

| Customer count | GHL tier | Approx. monthly |
|---|---|---|
| 0–2 | Pro (SaaS) | $297 |
| 3–7 | Unlimited | $497 |
| 8+ | Agency SaaS | ~$497 + rebill |

Do NOT start on Agency tier. Saves ~£100–200/mo until customer count justifies it.

---

## Cost pass-through mechanic

Every V2 client contract itemises an **"Infrastructure fee"** of **£80–100/mo**, bundled into the retainer. This covers:

- GHL sub-account license
- SMS / Twilio usage baseline
- AI token baseline (Claude / GPT)
- n8n cloud allocation

Client-facing framing: *"You own your sub-account; we manage it. The infrastructure fee keeps your delivery layer live."*

Net effect: core variable tech costs are revenue-neutral or revenue-positive per client. Jumpmade's P&L carries only the Pro-tier base cost until customer 3.

---

## Why Square specifically for plumbers

- **Cash payments tracked at 0% fee.** Plumber marks "paid in cash" in Square; invoice closes out, no card processor takes a cut. Matches how most UK plumbers already operate.
- **Card payments available at ~1.75%** for customers who prefer digital. Plumber is never *forced* to take card; the option simply exists on the invoice. Some customers (typically younger homeowners) will pick card over cash, which is found revenue the plumber would otherwise miss.
- **Removes the "no payment processor connected" notice** that GHL surfaced on every V1 invoice — which was one of Alec's documented frictions.
- **Tax paper trail preserved** in both directions. Cash marked in Square shows up in the plumber's records for HMRC the same as a card transaction. No off-book risk introduced.
- **UK availability requires verification** (listed in open items below). Stripe is the fallback if Square isn't available on the current GHL tier.

---

## Known limitations being accepted

The V1 audit and the GHL review (2026-04-21) identified these. V2 accepts and mitigates them rather than rebuilding:

- **Sniper OS Checkatrade auth dies without warning** (known V1 issue). Mitigation: manual re-auth watched during concierge phase.
- **Sniper OS JSON file state** has race-condition risk at 10x volume. Mitigation: volume is low in concierge phase; revisit at customer 5+.
- **GHL native Conversation AI hallucinates.** Mitigation: routed around via external Claude/GPT through n8n.
- **GHL native Voice AI is weak.** Mitigation: voice AI deferred entirely until customer 10+.
- **No Tradify API.** Mitigation: don't integrate. Send qualified lead to plumber; they enter into Tradify manually if they want.
- **Photo attachments don't work well over SMS in UK.** Mitigation: WhatsApp as default channel for image exchange; email fallback.

---

## Config vs. code — the line that keeps V2 inside the concierge mandate

The V2 stack uses n8n, Claude / GPT APIs, and existing Sniper OS all at once. Important clarification so this doesn't get re-debated every few weeks:

- **Using existing Sniper OS code as-is** (Checkatrade ingestion only, no feature additions) = ALLOWED. Running existing working software is not "building." First new platform connector written in Sniper OS would cross the line.
- **Configuring n8n workflows** (drag-and-drop email triggers, API calls, webhooks, field mappings) = ALLOWED. Same category as setting up a Zapier zap. Each new lead source = ~1–2 hours of configuration, NOT a code release.
- **Writing custom n8n nodes, self-hosting n8n on custom infrastructure, or extending Sniper OS with new platform parsers** = BUILDING. BLOCKED until customer 5+ per concierge mandate.
- **Manual delivery** (founder watching an inbox, WhatsApping plumber directly, typing SMS replies by hand) = ENCOURAGED, especially in first 14 days.

Practical consequence: all six lead sources in the stack table above (Checkatrade via Sniper OS, MyBuilder + Bark + Rated People via n8n config, Google Lead Form + Facebook Lead Ads via native GHL integrations) are **launch-ready** under the concierge mandate. The charter's "multi-platform within the vertical" rule is not deferred to post-customer-5. It is V2's Day-1 footprint, implemented via configuration and existing code, never via new custom code.

Onboarding reality: do not try to activate all six sources for customer #1. Each plumber gets only the sources they actually use. Some plumbers will be Checkatrade-only, some Bark-heavy, some multi-platform. Match the customer, not the stack.

---

## Rejected alternatives

1. **In-house bespoke build using Claude Code.** REJECTED — see `override-log.md` Override #2 (2026-04-21). Re-considered only at customer 20+ AND £5k MRR sustained 2 months.
2. **Pure n8n rebuild of Checkatrade ingestion.** REJECTED — duplicates existing working Sniper OS code. Reconsider at customer 5+ or if current ingestion silently drops a critical lead.
3. **Agency tier at launch.** REJECTED — premature, saves ~£100–200/mo.
4. **GHL native Conversation AI.** REJECTED — hallucination risk documented in V1 (booked wrong appointments). External AI via n8n is the architectural fix.
5. **Voice AI in V2 launch.** REJECTED — luxury feature. Plumber phone + 1-hour-callback is sufficient for concierge phase.
6. **PandaDoc for formal quoting.** DEFERRED — not needed for £80–300 daily plumbing jobs. Revisit at customer 10+ when multi-plumber businesses with £1k+ job tickets justify it.
7. **White-label Lead Connector branding.** DEFERRED — cosmetic. Save the ~£200/mo until V3.
8. **Porting plumber's existing business number into the system.** REJECTED — creates friction with their existing customer base. V2 uses a separate Twilio number for new-lead handling only; plumber's own number stays untouched.

---

## Triggers for revisiting

| Decision | Trigger to re-open |
|---|---|
| Replace Sniper OS with n8n / Postgres ingestion | Customer 5+ OR first critical lead silently dropped |
| In-house platform build | Customer 20+ AND £5k MRR sustained 2 months |
| Add voice AI | Customer 10+ AND clear demand signal from plumbers |
| Add PandaDoc for quoting | Customer 10+ AND multi-plumber business signs with £1k+ ticket size |
| White-label Lead Connector | Post-exit-gate (all 7 gates met) |
| Upgrade GHL tier | Tier table above |

None of these are to be re-opened before their trigger, per the 8-week lockup.

---

## Open items to verify within 48 hours

- [ ] Square payment processor availability in UK region on current GHL Pro tier
- [ ] GHL Pro tier sub-account count limit (need headroom to 5)
- [ ] Twilio UK phone number availability and pricing for SMS + WhatsApp Business
- [ ] n8n cloud tier sizing — Starter (~£20/mo) should suffice for 1–5 customers
- [ ] Sniper OS backend health check — confirm it boots cleanly on Railway after ~3 weeks off

These verifications happen **this week**, before the first warm-intro outreach. A failed verification on any of Square / Twilio / Sniper OS means the stack needs a specific revision before customer 1 onboarding.

---

## Next decision on the checklist

**Day 7 (2026-04-28):** Lock the named mechanism — "The Strike Window" or alternative. Document in `jumpmade-v2/decisions/named-mechanism.md`.
