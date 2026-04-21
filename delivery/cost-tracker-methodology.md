# Alec -- Cost Tracker

Ongoing cost analysis for One Plumbing Ltd (GHL sub-account: 8VeP75GXCJyFr13d6U13).

---

## Month-over-Month

| Month | Total | SMS Out | SMS In | Conv AI | Phone | Validation | Voice | Email | Margin (on GBP 75) |
|-------|-------|---------|--------|---------|-------|------------|-------|-------|---------------------|
| Feb 2026 | $30.03 | $25.05 | $1.76 | $1.37 | $1.15 | $0.35 | $0.11 | $0.01 | ~GBP 51 (68%) |
| Mar 2026 (projected) | $15-18 | ~$12 | ~$2 | ~$1.50 | $1.15 | $0.35 | ~$0.15 | $0.01 | ~GBP 61-63 (81-84%) |

---

## Feb 2026 Deep Dive

**Source:** alec-billing/feb-2026.csv (exported from GHL)
**Period:** Feb 1-28, 2026
**Total:** $30.03 (~GBP 24)

### SMS Breakdown (83% of total spend)

| Segments | Messages | Cost | % of SMS | Avg cost/msg |
|----------|----------|------|----------|--------------|
| 1 (0-160 chars) | 163 | $8.54 | 34% | $0.0524 |
| 2 (161-306 chars) | 47 | $4.93 | 20% | $0.1048 |
| 3 (307-459 chars) | 5 | $0.79 | 3% | $0.1572 |
| 4+ (460+ chars) | 51 | $10.77 | 43% | $0.2096+ |
| **Total outbound** | **266** | **$25.05** | **100%** | |

Inbound SMS: 202 messages, $1.76 ($0.0075 each -- negligible cost)

### Other Costs

| Service | Cost | Notes |
|---------|------|-------|
| Conversation AI | $1.37 | 133 transactions. Cheap. |
| Phone number | $1.15 | Monthly UK number rental |
| Number validation | $0.35 | 6 validations at $0.005 each |
| Voice (inbound) | $0.11 | 300 min free tier, minimal usage |
| Email | $0.01 | Negligible |

### Key Findings

1. **4+ segment messages are the #1 cost problem.** 51 messages at 4+ segments = $10.77 (43% of SMS spend). These are the old robotic AI responses -- long, formal, essay-like. v2.1 prompt caps messages at 160 chars.

2. **Overnight sends.** 8 messages sent between midnight-6am. Follow-up workflows have no time restrictions. Fix: add 8am-8pm window.

3. **Stale follow-ups.** Day 2 and Day 4 sequences firing to leads Alec already handled off-app (because his personal number was in the AI message). Fix: remove number from prompt + add "has NOT replied" condition to workflows.

4. **Inbound SMS is cheap.** $0.0075/msg. Not a cost concern.

5. **Conversation AI is cheap.** $1.37 for 133 transactions. Not a cost concern.

### Cost Projections After Fixes

| Fix | Estimated saving | How |
|-----|-----------------|-----|
| v2.1 prompt (short messages) | ~$8/mo | Eliminates 4+ segment messages, most go to 1 segment |
| Pause stale follow-ups | ~$4-6/mo | Stop sending to already-handled leads |
| Time restrictions | ~$1/mo | Fewer unnecessary overnight sends |
| **Total projected saving** | **~$13-15/mo** | |

**Projected monthly cost after fixes:** $15-18 (~GBP 12-14)
**Margin on GBP 75 retainer:** GBP 61-63 (81-84%)

---

## Margin Analysis

| Scenario | Monthly cost | Margin | Margin % |
|----------|-------------|--------|----------|
| Current (Feb 2026) | ~GBP 24 | ~GBP 51 | 68% |
| After v2.1 fixes | ~GBP 12-14 | ~GBP 61-63 | 81-84% |
| If lead volume doubles | ~GBP 22-26 | ~GBP 49-53 | 65-71% |
| Worst case (high volume + no fixes) | ~GBP 40+ | ~GBP 35 | 47% |

GBP 75 retainer is sustainable at current and projected volumes. If Alec scales significantly (50+ leads/mo consistently), may need to revisit -- but unlikely to be a problem.

---

## Commentary

### 2026-02-28

First full audit. The system has been live since Feb 10 and we only now looked at costs. Should have done this in week 1.

Main takeaway: SMS is 83% of costs, and the fixable portion (4+ segments + stale follow-ups + overnight) accounts for roughly half the SMS spend. v2.1 deployment is the single biggest cost lever.

GHL's pricing model is transparent and predictable. No hidden costs. Voice AI is essentially free at current usage. Conversation AI is a rounding error. The only thing that matters is SMS segment count.

Next audit: after v2.1 has been live for 2 weeks. Compare segment distribution before/after.
