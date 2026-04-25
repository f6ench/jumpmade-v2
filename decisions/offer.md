# Decision — V2 Offer (Price + Guarantee)

**Date:** 2026-04-21 (Day 3 of V2)
**Status:** LOCKED
**Owner:** Joseph French
**Next review:** 2026-06-16 (first strategic review point, per Override #1)

---

## The offer

**The Jumpmade Partnership — for UK Plumbers**

- **Setup fee:** £300 (one-time, upon signing)
- **Retainer:** £250 / month
- **30-day Zero-Risk Guarantee:** 6 booked jobs in the first 30 days, or 100% refund (setup returned + first month returned)
- **Guarantee condition:** applies when the client receives at least 30 lead notifications across their platforms in the 30-day window. If lead volume falls below 30, Jumpmade diagnoses upstream (coverage, platform subscription health, profile strength) rather than triggering the refund — the problem is not the response mechanism

---

## What the client receives

Included in the partnership (14 items, expanded 2026-04-22 from V1 delivery audit):

**Lead response and qualification**
1. Lead response across up to 8 platforms: Checkatrade, MyBuilder, Bark, Rated People, MyJobQuote, Airtasker, Google Lead Form, Facebook Lead Ads. Each enabled per-client based on their existing lead mix. (Expanded from 6 → 8 per Override #3, 2026-04-25.)
2. 60-second automated first-reply on every qualifying lead
3. AI-driven qualification conversation on SMS and WhatsApp
4. Automatic job booking onto the client's Google Calendar

**Booking and appointment management**
5. Appointment reminders — automatic SMS 24 hours, 1 hour, and 5 minutes before each booked job
6. No-show recovery — automatic SMS plus reschedule link when a customer misses an appointment

**Phone and call handling**
7. Call routing configuration — inbound calls ring client's phone first, voicemail AI as fallback
8. Business-hours auto-response — SMS sent outside business hours managing customer expectations
9. Missed call handler — SMS alert to client when an inbound call routes to voice AI

**Business-asset templates**
10. Professional estimate templates — branded PDF quotes with client logo, payment terms
11. Professional invoice templates — branded PDF invoices with bank details, sequential numbering

**Client-facing tooling**
12. Lead Connector mobile app — real-time notifications on client's phone (Lead Connector branded on Starter tier; Jumpmade-branded post-Unlimited upgrade)

**Operations and reporting**
13. Monthly revenue-delivered report (leads received → quoted → booked → paid)
14. Onboarding in under 7 days from payment to live lead flow

**For the first 3 paying customers only:** personalised Loom onboarding videos (3 videos walking through the setup — same format delivered to Alec in V1). Bundled with the case-study commitment concession. Customers 4+ receive the standard onboarding process supported by a self-serve video library (to be built post-customer-3).

Explicitly not included (written into the contract, hold-price rule applies):

- SEO, website design, website updates
- Content marketing, social media management
- Review management (Trustpilot / Google)
- General growth consulting or strategy calls outside the scope above
- Custom software features
- Voice AI (deferred until customer 10+)

### Deliberately left out of the offer description (no explicit call-out)

The following were considered for the "not included" list but deliberately kept off the offer doc to avoid a defensive-sounding scope boundary. Each remains out-of-scope in practice; if a client asks, the answer is simply "no — not in the partnership":

Lead sourcing / platform account setup. Nurture and re-engagement campaigns. Cost audits or billing analysis. Custom GHL workflow development. Client-facing Telegram alerts. Review-request automation. Daily pipeline pulse reports.

Rule of thumb: the offer lists what clients get and names the obvious exclusions (website, SEO, social). Everything else is answered on demand with "not included" rather than pre-listed.

---

## Cost basis and unit economics

Per-client variable cost (concierge phase, on GHL Starter tier — verified 2026-04-22):

| Item | Cost / month |
|---|---|
| GHL Starter tier share (at 3 clients, £97 ÷ 3) | ~£32 |
| Claude / GPT API | ~£15 |
| Twilio SMS + WhatsApp | ~£20 |
| n8n cloud share | ~£5 |
| **Cash variable cost (concierge phase)** | **~£72** |

At £250/mo retainer with £72 variable cost during concierge: **cash gross margin = £178/client = 71%**.

Post-customer-4 upgrade to GHL Unlimited ($297/mo = ~£235):

| Item | Cost / month |
|---|---|
| GHL Unlimited tier share (at 5 clients, £235 ÷ 5) | ~£47 |
| Claude / GPT API | ~£15 |
| Twilio SMS + WhatsApp | ~£20 |
| n8n cloud share | ~£5 |
| **Cash variable cost (post-upgrade)** | **~£87** |

Post-upgrade margin at £250 retainer = £163/client = **65%**. Within exit-gate 4's margin tolerance.

Founder time in the concierge phase (~5 hrs/month per client) is treated as R&D, not priced in. Once the playbook is stable and onboarding is delegated to a non-founder operator (exit gate 3), founder-time cost drops to zero and true gross margin rises above 70% — clearing exit-gate 4's threshold for Unlimited tier too.

Year-one revenue per retained client: £300 + (£250 × 12) = **£3,300**.
Year-one cash margin per retained client: ~£2,000-2,200 depending on tier mix (67% blended).

Five customers retained through year one = £16,500 revenue, ~£10,500-11,100 cash margin.

**Concierge-phase cash savings from starting on Starter:** ~£200/month × 3 months = **£600 preserved** before the Unlimited upgrade triggers at customer #4. See `decisions/delivery-platform.md` → "Starter tier decision log" for full reasoning.

---

## Client-side ROI logic

Plumber break-even: one booked job per month at £200 avg value covers the retainer. Two jobs per month = net-positive.

Scenario comparison (year one):

| Scenario | Jobs/month | Avg value | Annual revenue | Plumber ROI vs £3,300 cost |
|---|---|---|---|---|
| Conservative | 3 | £200 | £7,200 | 2.2× |
| Base case | 5 | £250 | £15,000 | 4.5× |
| Strong | 8 | £300 | £28,800 | 8.7× |

The guarantee threshold (6 jobs in 30 days) sits between base case and strong. Plumbers who hit the guarantee are earning a 4×+ return on the partnership. Plumbers who fail the guarantee get 100% refund and walk away with no financial loss.

---

## Guarantee risk analysis

Estimated failure rate at 6 jobs: 30–40% of concierge-phase customers, assuming unvalidated Alec-level performance data.

Per-failure cost to Jumpmade:

| Item | Amount |
|---|---|
| Setup fee refunded | £300 |
| Month 1 retainer refunded | £250 |
| Variable cost of month 1 | ~£90 |
| **Total Jumpmade loss per failed guarantee** | **£640** |

Expected failures across first 5 customers: 1.5–2. Expected refund cost: £960–£1,280.

This is a real cash cost and must be budgeted before launch. It is the price of a credible zero-risk guarantee during concierge phase and the data it generates on ICP fit (which plumber profiles hit 6 jobs and which don't). The failures are diagnostic — they refine ICP for customers 6–30.

**Before customer #1 onboards, back-test against Alec's V1 data.** Pull the last 30 days of Alec's live-system operation (prior to the February shutoff). If Alec averaged 6+ booked jobs, the threshold is right. If he averaged 4–5, the threshold is aggressive and this decision should be revisited before launch — drop to 5 with a written note. This back-test is the single most important calibration task remaining.

---

## Special terms for first 3 customers (optional concession)

For the first three V2 customers only, Jumpmade may waive the £300 setup fee in exchange for a written commitment to:

- Provide a case-study testimonial (written or video) after month 1
- Allow Jumpmade to publish their booked-job numbers in anonymised form

This is a time-limited concierge-phase offer, designed to fund exit-gate 5 (three published case studies with real customer numbers). Not advertised on the landing page — used as a closing lever on high-intent warm-intro calls where the prospect is friction-resistant.

---

## Triggers to revisit

Per the 8-week strategic lockup (Override #1), offer pricing and guarantee are fixed until **2026-06-16**. Tactical iteration inside the tier band is permitted under rules.md — meaning the following changes do not require override:

- Raising retainer from £250 → £280 or £300 at customer 5+ after first case studies collected
- Tightening guarantee to 5 jobs (if data shows 6 is too aggressive after 2–3 customers)
- Adding lead-volume clauses based on real customer lead distribution

What does require an override:

- Changing guarantee structure (e.g. refund → performance-based)
- Dropping the guarantee entirely
- Changing retainer outside the £150–£400 band
- Changing setup-fee structure outside the £0–£500 band
- Adding new deliverables to "included" (scope expansion)

---

## Next decisions in the checklist

- Day 10 (2026-05-01): Landing page live at jumpmade.com — see `offer/landing-page-copy.md`
- Day 14 (2026-05-05): First 5 warm-intro outreach touches sent
- Day 21 (2026-05-12): First paying V2 customer target

First Monday metrics file (`metrics/wk-17.md`) published to Seyi by 2026-04-27 10:00.
