# Draft order modes: random (set at T−1h) or manual, never commissioner-first

**Branch:** `feat/draft-order-modes`. **Migrations:**
- `20261013000000_draft_order_modes.sql`, in the apply path.
- `deferred/20261013000001_schedule_draft_order_notify.sql`, held.

**Product rule (Giorgio, 2026-09-29):** the draft order is a per-league setting, and it is never automatically commissioner-first.

| Mode | Who sets it | When it's set (final) |
|---|---|---|
| `random` (default) | the server (`gen_random_uuid`), exactly once | `draft_date − 1h`: revealed and final at the same instant |
| `manual` | the commissioner, starting from a random seed | the commissioner may edit and switch mode until `draft_date − 1h`; the order is then set as-is |
| `legacy` | backfill only | drafts that had already started when the migration was pushed. They keep the old derived order verbatim. |

"T−1h" is precisely the **later of** `draft_date − 1h` and the league reaching **4 members** (`MIN_DRAFT_MEMBERS`, `draft-control/rules.ts`). The member floor exists because of a bug the regression test found. Finalizing an order when only the commissioner is in the league, then appending everyone else in join order, puts the commissioner first every time.

## State

`league_draft_order_meta.state` is an explicit discriminator. It is never inferred from NULL timestamps.

```
(no row)  --reveal/seed-->  open  --T−1h-->  finalized  --start-->  locked
                              \_______________start (backstop)______/
```

| State | Reorder | Join | Leave |
|---|---|---|---|
| no row | — | nothing to do | nothing to do |
| `open` | commissioner (`set_draft_order`) | a random slot while the seed is unedited; append once edited | remove, close the gap |
| `finalized` | **no** | **append** (announced slots preserved, plus a notice) | remove, close the gap |
| `locked` | **no**, for any role incl. service_role | **refused** | refused while `in_progress`; allowed after `completed` (the order is kept as history) |

- **Enforcement.** A row trigger on `league_draft_order` and a meta trigger enforce these rules for every role; BYPASSRLS does not bypass triggers. No API role has write grants on the order tables.
- **The time gate is checked everywhere, not flipped once.** Every read and write path finalizes a due league on the spot, under the leagues row lock. The cron only makes the finalize (and so the notice) *on time* for a league nobody opens.

## Who writes the order

| Path | Does |
|---|---|
| `get_draft_order(league)` (authenticated, a member) | Reads. It also reveals lazily: finalizes a due league, and seeds a manual league's first order. |
| `set_draft_order(league, ids[])` (authenticated, the commissioner) | Saves a manual order: an exact permutation of the current members, while open. |
| `leagues.draft_order_mode` UPDATE (the commissioner, via [I2a]) | Switches mode while open. `trg_leagues_order_mode` enforces the rules. |
| `league_members` INSERT/DELETE (any writer) | `trg_league_members_draft_order` appends, removes, or refuses. It is the one choke point for five membership writers. |
| Draft start (draft-control, or the [I2a] direct flip) | `trg_leagues_order_start`: materialize if absent, finalize, reconcile (recorded in `reconciled_at_start`), lock. |
| `finalize_due_draft_orders()` (service_role) | The cron's on-time finalize. |

Randomness lives only in `_draft_order_materialize`, which no API role can execute. The order is generated once, under the leagues row lock (`FOR NO KEY UPDATE`), with the meta PRIMARY KEY as the backstop.

## Notification

- **In-app record:** `league_notifications`, one `draft_order_set` row per human member (bots excluded).
  - It is written in the SAME transaction as the finalize, whichever path finalizes it.
  - A partial UNIQUE index makes it exactly once.
  - A late joiner after the finalize gets their own row.
  - **Every** finalize notifies, including the start backstop (Orchestrator decision, 2026-09-29).
  - The one exception: migration §11 finalizes, **silently**, the leagues that are already past due at push time (≥ 4 members). Otherwise the first cron tick would push about abandoned test leagues. The pre-check lists them.
  - SELECT is owner-only.
- **Push:** the `draft-order-notify` edge function (cron only, `cron-auth.ts` guard). It claims each `pending` row with a conditional UPDATE (status + attempt count), then reads the member's **current** position. The body is built server-side, using the Design Lead's copy verbatim (board @ 4ab3429):
  - Title: the league name.
  - Random: "The draft order is set. You pick 4th. The draft starts at 7:00 PM ET."
  - Manual: "The commissioner set the draft order. You pick 4th. The draft starts at 7:00 PM ET."
  - The time is shown **time only, in America/New_York**, because no per-user time zone is stored (the `lib/marketHours.ts` convention). It is labeled "ET", as the app labels Eastern times everywhere (Orchestrator, 2026-09-29).
  - The "starts at" sentence is dropped when the date is TBD or the draft has already started (the start-backstop notice).
  - Delivery states: `pending` → `sending` → `sent` | `no_device` | `skipped` | `failed`. A transient failure retries up to 3 times.
  - Token handling reuses `send-notification`'s logic verbatim via `_shared/push.ts`. Tokens never leave the function, and F8 exposure is not widened.

## API: `rpc('get_draft_order', { p_league_id })`

```
{ ok, mode: 'random'|'manual'|'legacy', state: 'open'|'finalized'|'locked',
  draft_date, finalize_at /* draft_date − 1h; the reveal time for random */,
  revealed, revealed_at, finalized, finalized_at, locked, locked_at,
  order: [{ position, user_id }] | null   /* bots included; null = not revealed */,
  num_rounds, member_count, min_members, waiting_for_members,
  is_commissioner, can_edit_order, can_change_mode, server_now }
```

- Refusals: `{ ok:false, reason: 'not_authenticated' | 'not_a_member' }`.
- `set_draft_order` refusals: `not_a_member`, `not_commissioner`, `locked`, `not_manual`, `finalized`, `not_a_permutation`.
- Mode-change errors (errcode 22023): `draft_order_mode_locked`, `draft_order_reveal_passed`, `draft_order_mode_invalid`.
- Client helpers live in `apps/mobile/lib/draftOrder.ts` (`parseDraftOrder`, `snakePickNumbers`, `myPosition`).

## Callers migrated

`computeDraftOrder` is deleted. Everything below reads the stored order:
- `loadDraftContext`. Once a draft has started it refuses with `draft_order_invalid` unless the order is an exact permutation of the members (`checkStoredOrder`).
- `planSeason` / `finalizeDraft`: the roster is the order.
- mobile `draft.tsx` and web `DraftPage.jsx`.

`supabase/tests/draft_order_no_derivation.test.ts` fails if a derivation comes back. SQL never did turn math and still doesn't: `get_draft_clock` and `overdue_draft_turns` are unchanged.

## HUMAN ACTIONS (in order, after merge)

1. **Pre-check (read-only).** Run the query in the migration header. Stop unless:
   - `ids_ascii` is true on every row;
   - every `in_progress` league's `round1_actual` is a prefix of `backfill_order`;
   - no league is due to start between step 2 and step 3.
2. **Push.** Run `supabase db push --dry-run`, then `supabase db push`, from the refreshed deploy checkout. The dry-run must list exactly `20261013000000`.
3. **Deploy immediately:** `validate-and-record-pick`, `draft-autopick-sweep`, `draft-control`, `draft-order-notify`. Byte-verify each. The upload lists must include `_shared/draft-validation.ts`, `_shared/draft-write.ts` and `_shared/schedule.ts`, plus `_shared/push.ts` and `draft-order-notify/plan.ts` for the notifier.
   - Also run a no-credential POST to `draft-order-notify`: it must return the function's own `401 {"error":"Unauthorized"}`.
   - Between steps 2 and 3, the old edge code still enforces commissioner-first.
4. **Effect test.** Run `docs/security/draft-order-modes-effect-test.sql`: 24/24 PASS. Then run the proacl/relacl queries at the bottom of the migration.
5. **Re-capture** `docs/architecture/db-snapshot.json`. The 16 "ABSENT from prod snapshot" drift rows then clear.
6. **Promote the cron** per `supabase/migrations/deferred/README.md` (manual run first).
7. **Ship the mobile change with 1.1.0.** An app without it computes commissioner-first locally, so it shows the wrong picker in any league with a new random order.

## Monitoring

```sql
-- Invariant: every started league has a locked order that fits its members.
SELECT l.id, l.name, l.draft_status, m.state
  FROM leagues l LEFT JOIN league_draft_order_meta m ON m.league_id = l.id
 WHERE coalesce(l.draft_status,'not_started') <> 'not_started'
   AND (m.state IS DISTINCT FROM 'locked'
        OR (l.draft_status = 'in_progress' AND NOT public._draft_order_matches_members(l.id)));
-- Overdue finalizes (cron not keeping up): should be empty a minute after T−1h.
SELECT l.id, l.draft_date FROM leagues l
 WHERE coalesce(l.draft_status,'not_started') = 'not_started'
   AND now() >= l.draft_date - interval '1 hour'
   AND (SELECT count(*) FROM league_members x WHERE x.league_id = l.id) >= 4
   AND NOT EXISTS (SELECT 1 FROM league_draft_order_meta m WHERE m.league_id = l.id AND m.state <> 'open');
-- Push delivery.
SELECT push_status, count(*) FROM league_notifications GROUP BY 1;
```
