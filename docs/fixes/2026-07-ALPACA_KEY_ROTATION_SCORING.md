# Alpaca key rotation → silent scoring-pipeline outage (2026-07-17)

**Status:** Root cause fixed; **no data remediation required**. Prevention shipped.
**Related:** `docs/api-keys-inventory.md` · `docs/migrations/MIGRATION_STATUS.md` (gotchas) · `docs/migrations/RLS_HARDENING_SPEC.md` (pre-launch findings)

---

## Summary

The shared `ALPACA_API_KEY` / `ALPACA_API_SECRET` **Supabase function secrets** still held pre-rotation (dead) values. Every function reading them failed against Alpaca with 401 — **silently**. Found while diagnosing `quote` / `historical-bars` returning non-2xx for every symbol in Expo Go.

Re-pointed to valid keys (confirmed **200** against Alpaca `/v2/account`); `supabase secrets set` applied. No redeploy needed — functions read env at runtime.

## Blast radius — 6 functions share the key, 3 of them cron

| Function | Type | Impact while the key was dead |
|---|---|---|
| `historical-bars` | client | historical P/L failed (the reported symptom) |
| `symbols-search` | client | symbol search failed |
| `ticker-quotes` | client | watchlist prices failed |
| `process-week-results` | **cron** | weekly scoring |
| `snapshot-week-start` | **cron** | Monday open snapshots |
| `snapshot-week-end` | **cron** | Friday close snapshots |

**Not** affected: `quote` and `place-order` — they use **per-user** encrypted creds from `broker_credentials`, a separate key store (see *Still open*). Same root *event* (the rotation), different root *cause*.

## ⚠️ KEY INSIGHT — the failure masqueraded as "market closed"

`isMarketOpenToday()` (`supabase/functions/snapshot-week-start/index.ts:64-89`) only returns `{open:true}` inside `if (res.ok)`. On a **401 it falls through to `{open:false}`** — a fail-closed default **indistinguishable from a market holiday**. The job then early-returns:

```
200 { message: 'Market closed (holiday), skipping Monday run' }
```

…and `updateJobStatus` records **`success`**.

> **Absence of failures in `cron_job_status` is NOT evidence the pipeline worked.**
> Verify with actual output (`week_snapshots` row gaps), never with job status alone.

Second-order effect (the one piece of good luck): because the calendar check short-circuits *before* the price fetch and insert, the job wrote **nothing** — the outage produced **gaps, not corrupt rows**. Even past that check, `fetchOpenPrices` returns an empty map on 401 → every holding hits `if (!price) continue` → `snapshots` stays empty → the insert is skipped entirely.

## Gap analysis — findings

- Snapshot production stopped for the two real-looking leagues (`23d19e02`, `c9992e34`) after **~late Feb 2026** — consistent with the key being dead for months.
- **All their matchups are already scored** (`unscored: 0`) — nothing was queued for back-scoring.
- Their week-1 fallbacks are **benign**: at week 1, cumulative-from-entry ≈ the weekly delta.
- `__TEST_SIMULATION__` (`aaaa…`) has seeded snapshots (identical timestamps, missing wk4) = **synthetic harness data**, not pipeline output.

**CONCLUSION: no data corruption to remediate.** Everything affected is pre-launch test data.

## Fixes shipped

1. **Secret re-point** — `ALPACA_API_KEY` / `ALPACA_API_SECRET` set to valid keys (confirmed 200). Restores all 6 functions including the cron pipeline.
2. **Freshness guard** — commit `1c0d438`, **DEPLOYED**. `process-week-results` now refuses to score a snapshot-less week that ended more than `FALLBACK_MAX_AGE_HOURS` (**72h**) ago: it skips, logs, and reports via `skipped` / `skipped_count` in the response, leaving `team1_gain` NULL instead of fabricating results.
   - **Why it matters:** the snapshot-less fallback (`calculatePortfolio`) values holdings at *today's* prices and returns **cumulative gain from draft entry**, not that week's delta. Applied retroactively, every missed week scores the same number → the same user "wins" all of them, and `league_standings` increments off fiction. Standings increment (read-then-+1), so a re-run **cannot** undo it.
   - This is **prevention for the next occurrence**, not repair of existing damage (none was needed).

## Still open (filed, non-urgent)

| Item | Ref | Notes |
|---|---|---|
| Per-week batching bug | `task_ac589751` | Matchups are grouped by **league only**, so a league with several unscored weeks scores them all against week[0]'s snapshots. Blocked on tracing week-advancement / playoff cardinality. |
| Cumulative-vs-delta semantics | `task_d541b74b` | The fallback is all-time P/L, not a weekly delta; correct only at week 1. Product decision: refuse week > 1 / compute a true delta / accept within the 72h window. |
| `quote` / `place-order` per-user creds | — | Scoped to **one test account** (`PK30HH40ZK`, `total_linked = 1`). Trivial re-link; deferred. Also obviated by the planned self-simulated paper-trading architecture. |
| Orphan `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` secrets | — | Dead duplicates — **no function reads them** (only `ALPACA_API_KEY`/`ALPACA_API_SECRET` are). Delete in a cleanup pass. |

## Lessons

- A third-party key going stale can present as **normal operation** rather than an error. Build health checks around **output** (rows written) and not **status** (job records).
- One shared secret spanning client **and** cron functions means a single dead value takes down user-facing features *and* the background pipeline — with only the former being noticed.
- Fail-closed defaults (`return {open:false}` on error) are correct for safety but **destroy the error signal**; they need to distinguish "genuinely closed" from "couldn't tell."
