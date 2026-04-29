# Testing Roadmap

Comprehensive testing plan beyond the season simulation test runner.

## Status

| # | Test Suite | Priority | Status |
|---|-----------|----------|--------|
| 1 | [Mid-week trade scoring](#1-mid-week-trade-scoring) | High | Done |
| 2 | [Three-way tiebreaker stress test](#2-three-way-tiebreaker-stress-test) | High | Pending |
| 3 | [Content moderation](#3-content-moderation) | Medium | Pending |
| 4 | [Concurrent league processing](#4-concurrent-league-processing) | Medium | Pending |

---

## 1. Mid-Week Trade Scoring

**File under test:** `supabase/functions/process-week-results/index.ts` — `calculateUserScore()` (lines 214-351)

The simulation runner only tests "hold all week" scenarios. The scoring function has complex FIFO logic for mid-week trades that is completely untested.

### Test cases

**Buy-then-sell same week (no week-start holding)**
- User buys 5 shares of AAPL at $150 on Wednesday, sells all 5 at $160 on Thursday
- Expected: gain = 5 × ($160 - $150) = $50

**Partial sell (held from Monday, sold some mid-week, held rest to Friday)**
- User holds 10 shares at week-start price $100
- Sells 6 mid-week at $110
- Friday close price = $120
- Expected: gain = 6 × ($110 - $100) + 4 × ($120 - $100) = $60 + $80 = $140

**Multiple buys same symbol, then sell (FIFO ordering)**
- 5 shares held from Monday at $100 (week-start)
- Buys 5 more mid-week at $120
- Sells 7 mid-week at $130
- Remaining 3 held to Friday close at $125
- Expected: sell first depletes 5 from week-start ($130-$100 = $30 each = $150), then 2 from mid-week buy ($130-$120 = $10 each = $20). Remaining 3 mid-week buy shares held to Friday: 3 × ($125-$120) = $15. Total = $150 + $20 + $15 = $185

**Negative gain (loss)**
- User holds 5 shares at week-start price $200
- Friday close = $180
- Expected: gain = 5 × ($180 - $200) = -$100

**Mid-week buy held to Friday**
- No week-start holding for this symbol
- Buys 10 shares at $50 on Tuesday
- Friday close = $55
- Expected: gain = 10 × ($55 - $50) = $50

**Empty mid-week trades (pure hold)**
- 3 shares at week-start $100, Friday close $115
- No trades
- Expected: gain = 3 × ($115 - $100) = $45 (baseline sanity check)

### Implementation approach

Add these as negative tests in the simulation runner. Seed a 2T-1W-2P league, inject specific `trades` rows with timestamps inside the matchup week, and set snapshot prices to produce known gains. Validate that the edge function computes exact expected gains.

---

## 2. Three-Way Tiebreaker Stress Test

**File under test:** `supabase/functions/process-week-results/index.ts` — `applyTiebreakers()` (lines 460-499), `getHeadToHead()` (lines 504-524)

Current simulation tests produce clean standings where no two teams have the same record. Real leagues frequently have multi-way ties.

### Test cases

**Three-way tie with head-to-head differentiation**
- 6 teams, design gains so 3 teams finish with identical W-L records
- Head-to-head among the 3 tied teams should break the tie
- Verify seeding order matches H2H results

**All teams tied (points-for tiebreaker)**
- Similar to TIED-GAINS but with 6+ teams and 4-team playoffs
- All teams have same W-L and same H2H → falls to points_for
- Override snapshots so points_for differs slightly between teams
- Verify seeding order matches points_for ranking

**Two separate tie groups**
- 8 teams: top 3 tied at 5-2, next 3 tied at 3-4, bottom 2 at 1-6
- Verify correct seeding within each tie group
- Verify playoff bracket uses correct seeds

### Implementation approach

Add as negative tests in the simulation runner. Requires careful gain design so specific matchup outcomes produce desired W-L records. May need per-week snapshot overrides (different gains per week) instead of uniform gains.

---

## 3. Content Moderation

**File under test:** `packages/shared/utils/contentModeration.ts`

Known issue: username validation isn't catching blocked words in the app. Need to verify the utility functions work correctly AND that the app actually calls them.

### Test cases

**Direct blocked words**
- Common profanity (the full blocked word list)
- Case variations (FUCK, Fuck, fUcK)

**Evasion patterns**
- Character substitution: f*ck, sh!t, a$$, b1tch
- Spacing/underscores: f u c k, f_u_c_k
- Leetspeak: f4ck, sh1t

**Reserved usernames**
- Exact matches: admin, moderator, staff, support
- Partial matches: admin_user, theadmin
- Case insensitive: ADMIN, Admin

**Should NOT be blocked**
- Normal words that contain blocked substrings (e.g., "scunthorpe", "assassin", "cocktail")
- Short/empty strings
- Numbers only

**App integration**
- Trace where `validateUsername` is called in the mobile app
- Verify the signup/profile-edit flows actually invoke it

### Implementation approach

Standalone test script (no Supabase calls needed). Pure function testing. Also audit the mobile app to find where validation is called and whether it's being bypassed.

---

## 4. Concurrent League Processing

**What it tests:** Multiple leagues being processed by the edge function simultaneously.

Now that `process-week-results` supports `league_id` scoping, we can run parallel calls. But the cron job (no league_id) processes all leagues at once — need to verify leagues don't contaminate each other.

### Test cases

**Parallel scoped calls**
- Seed 4 test leagues simultaneously
- Call edge function 4 times in parallel (each scoped to its league)
- Verify each league's results are independent and correct

**Unscoped call with multiple test leagues**
- Seed 4 test leagues
- Call edge function ONCE with no league_id (simulates real cron)
- Verify all 4 leagues processed correctly in one pass
- Verify standings/playoffs for each are independent

**Mixed completion states**
- Seed 3 leagues: one completed, one mid-season, one not started
- Call edge function (unscoped)
- Verify only the mid-season league gets processed

### Implementation approach

Add to simulation runner. Seed multiple leagues with different testIndex values, then call edge function in parallel or once without scoping.
