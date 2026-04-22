# V2 Charter Override Log

Every formal amendment or override to the V2 charter gets logged here with date, reasoning, and noted concerns. Overrides are the founder's prerogative, but the trail is permanent. Reviewed monthly — if overrides exceed two per month, the charter is failing and must be re-negotiated explicitly rather than eroded silently.

---

## Override #1 — 2026-04-21 — Strategic lockup reduced from 12 weeks to 8 weeks

**Charter clause amended:** Founder operating ground rules → "No reopening focus decisions mid-quarter. ICP, vertical, platform, and pricing decisions stay fixed for 12-week review cycles."

**Change:** 12-week strategic review cycle → **8-week** strategic review cycle.

**Founder's stated reason (verbatim from conversation, 2026-04-21):**
> "I'm pretty sure and confident we can do [proof of concept] in four weeks, and it makes sense to leave some sort of gap, some sort of float time, in case we don't reach that four-week goal. For that reason, I feel eight weeks makes more sense."

**Claude's noted concern (for honest record):**
Founder's reasoning is framed around *proof-of-demand timeline* — i.e. how long until positive signal arrives. This is a different question than the lockup was designed to answer. The 12-week lockup was sized as the minimum time before a founder can credibly distinguish "the vertical itself is wrong" from "my offer isn't dialed yet," "my channel hasn't scaled," or "my script needs iteration." At 4 weeks, and still at 8, a founder physically cannot make that distinction with statistical confidence — any pivot off the vertical at that point is probably off noise, not signal. The override accepts a materially weaker drift-prevention mechanism than V1's behavioural patterns would warrant. Category confusion between proof-of-demand timeline and drift-prevention timeline was flagged three times during the negotiation and not engaged with. Override accepted on founder's authority.

**Operative effect:**
- Next strategic review point: **2026-06-16** (8 weeks from 2026-04-21).
- Before that date, the founder may not reopen: UK plumber vertical, speed-to-lead mechanism, platform choice, or pricing tier band.
- All *tactical* iteration remains free and uncapped: offer specifics, outreach channel copy, script, pricing within the tier, landing page, delivery workflow.

**Review trigger at 2026-06-16:**
Founder must, before reopening any strategic decision, write in this log: (a) the specific data collected in the preceding 8 weeks — number of customer conversations, close rate, revenue collected, retention observed; (b) which hypothesis in the charter's "V2 is testing" list has failed and by what evidence; (c) why the alternative being proposed is likely to do better.

If those three are not answered in writing, the strategic decisions remain locked until they are.

---

## Override #2 — 2026-04-21 — REJECTED: In-house platform build proposed on Day 3

**Proposal:** Founder proposed building a bespoke plumber-specific platform using Claude Code, to replace GHL as V2's delivery infrastructure. Raised as a decision being weighed on Day 3 of V2, before any V2 customers exist.

**Charter clauses that would have been violated if accepted:**
- Concierge mandate: *"V2's first 30 days are manual delivery only. Zero new code until customer #5 pays."*
- Refusal rule (rules.md): *"Building software features before V2 customer #5 pays."*

**Outcome:** REJECTED. Concierge mandate held. No override granted.

**Founder's stated reasoning (paraphrased, 2026-04-21):**

Four concerns raised: (1) V1's tool kept breaking — Sniper OS and GHL both exhibited teething issues; (2) GHL felt too complex for plumbers — Alec struggled with Lead Connector app; (3) GHL has high fixed costs (£400/mo agency tier) plus high variable costs (AI tokens, SMS); (4) Claude Code makes building feel cheap, so a bespoke in-house tool seems feasible. Founder hedged toward iterating on GHL in short term, building in-house once client base justifies it.

**Claude's refusal and reasoning:**

1. **Pattern recognition.** Founder's own V1 post-mortem (Section 2, commit 96636b5) explicitly names: *"I was secretly using building the tool as a disguise to avoid selling."* The Day-3 in-house proposal is a recurrence of that exact pattern under different vocabulary. The pattern is named and the proposal is refused on that basis alone.

2. **Each underlying observation is legitimate; none of them requires building.**
   - V1 brittleness was a Sniper OS problem, not a GHL problem. Sniper OS is demolished. V2 delivery is GHL workflows + manual glue during concierge phase.
   - GHL "too complex for plumbers" is an onboarding UX problem, not a platform problem. V2 plumbers never log into GHL — their experience is SMS, WhatsApp, and calendar only. Complexity dissolves by onboarding design.
   - GHL cost structure is manageable by starting on Pro tier (not Agency) and passing the sub-account infrastructure fee to clients via contract — standard agency practice.
   - "Claude Code makes building cheap" is the 2026 version of "low-code makes building cheap." Typing is never the bottleneck. Building a customer-facing SaaS to replace GHL is 6–12 months of backend, frontend, integrations, billing, GDPR, uptime, and support.

3. **Scale of mistake if accepted.** V1 spent 2–3 months building Sniper OS as a *backend automation* with brittle result and zero revenue correlation. A customer-facing product has ~10× the surface area. At zero paying customers, an in-house rebuild is an escape from selling.

**Accepted mitigations (in lieu of in-house build):**

- GHL **Pro tier** ($297/mo) at launch, upgrade to Unlimited at customer 3, Agency at customer 8.
- **Infrastructure fee passed to every V2 client** — embedded in retainer, itemised explicitly in contract, covers sub-account license (~£80–100/mo).
- **Plumber never logs into GHL.** Onboarding assumes zero CRM touch from client. Their experience is SMS + WhatsApp + calendar only.
- **Simplified per-client deployment** — ~6 workflows, not the 29 V1 shipped. Lead ingest, first-reply SMS, quote-sent follow-up, no-show recovery, review ask, monthly report. Everything else is scope creep until customer data demands it.

**Forward-dated trigger for when in-house build becomes legitimate to reconsider:**

- Gate: **≥20 paying UK plumbers** AND **≥£5k MRR sustained 2 months**, whichever lands later.
- Before that gate: the question is permanently refused regardless of how it is framed.
- At that gate: a proper in-house decision document is warranted, requiring per-client workflow usage data, GHL variable-cost trajectory at scale, and cash-flow capacity to hire a dedicated engineer (not founder-coded).

**Why this is logged despite no override being granted:**

Recording rejected drift attempts creates a dated trail so the same question cannot silently re-surface every few weeks rebranded as a new idea. When the "maybe we should build in-house" impulse recurs at week 6 or week 10, Claude and founder reference this entry, confirm nothing material has changed, and return to the committed path. Drift that is logged is drift that cannot pretend to be novel.

**Status:** CLOSED. Proposal refused. GHL re-sub with above mitigations is the Day-3 decision, to be documented in `jumpmade-v2/decisions/delivery-platform.md`.

---
