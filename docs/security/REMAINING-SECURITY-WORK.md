# Remaining security work — Claude Security scan (rev 2f2906c, 2026-07-30)

Self-contained handoff so a **new session** can pick this up without the local
`CLAUDE-SECURITY-*/` report directory (which is gitignored and does not travel
with the repo). It records: (1) the status of all 13 findings, (2) the full
build specs for the 3 findings NOT yet fixed, and (3) the deploy checklist for
the fixes that ARE in the branch but need prod steps.

Fixes landed on branch `security/claude-security-fixes-20260730` (commit 2dd699f).

> **2026-09-24:** branch re-merged with `main` @ `2be4638`. F1/F6 migrations re-timed
> `20260730000000/01` → `20260925000000/01` (prod's latest applied is `20260816000000`,
> and `db push` refuses older pending files). F7 is done in code. The **deploy order now
> lives only in `docs/security/DEPLOY-RUNBOOK.md`**. The checklist that used to close this
> file has been removed so the two can't drift apart.

---

## Status of all 13 findings

| ID | Sev | Status | Where |
|----|-----|--------|-------|
| F1 | HIGH | ✅ fixed in code | migration `20260925000000` (leagues UPDATE column-guard trigger; authored as `20260730000000`) |
| F2 | HIGH | ✅ fixed in code | `apps/mobile/lib/recoveryNonce.ts` + `_layout.tsx` + `forgot-password.tsx` — needs redirect-allowlist config (see Deploy) |
| F3 | MED | ✅ fixed in code | `apps/web/src/utils/inviteCode.js`, `apps/mobile/lib/inviteCode.ts` |
| F4 | MED | ✅ fixed in code | (closed by F3 — shared CSPRNG helpers) |
| F5 | MED | ✅ **deployed** (from `2dd699f`; observed 2026-09-25) — reconciled on merge | `refresh-symbols/index.ts` + `config.toml` (apikey gate, verify_jwt=false). Prod has run this since an unknown date after 2026-07-30: `refresh_symbols_daily` returns `200 {"ok":true,"count":13246}` and a credential-free GET reaches our code (405). `main`'s code/config were the stale side (the earlier "still 401s" note here was wrong). Hazard until merge: deploying it from `main` reverts F5. Main's `20260811000000` cron reschedule + this function = the whole fix. This branch's duplicate cron migration `20260728000002` was dropped. |
| F6 | MED | ✅ fixed in code | migration `20260925000001` (league_standings INSERT bounded to zero; authored as `20260730000001`) |
| F7 | MED | ✅ fixed in code | new `send-notification` edge function (shared-league check, closed type map) + `apps/mobile/lib/notifications.ts` cut-over. Client half ships with the 1.1.0 EAS build. Hardened 2026-09-24 (error checks, Expo ticket status, unbuilt types removed). |
| **F8** | MED | ❌ **TODO** | push-token relocation (phase 2, staged). Precondition: F7 deployed **and** 1.0.0 mobile binaries drained — see below |
| F9 | MED | ✅ **deployed** (from `2dd699f`; deployed code identical to the branch tip) — reconciled on merge | `historical-bars/index.ts` (date validation + encoding). Hazard until merge: deploying it from `main` reverts F9. |
| **F10** | MED | ❌ **TODO** | matchup schedule forgery — see below |
| F11 | MED | ✅ fixed in code | (closed by F1 — same policy trigger) |
| F12 | LOW | ✅ **superseded by main** | `place-order` was deleted on main (DR-001 in-house simulator; trades now go through `record-trade` / `validate-and-record-pick`), and main's applied `20260811000002` drops the same client `trades` INSERT policy. This branch's `20260730000004` and its client edits were dropped in the 2026-09-01 merge. |
| F13 | LOW | ✅ fixed in code | `apps/mobile/app/(tabs)/profile.tsx` (re-auth gate) |

---

## TODO 1 — F7 + F8: Expo push token is a bearer capability readable by every authenticated user

**The problem.** `expo_push_token` lives on `user_profiles`, whose SELECT policy is
`TO authenticated USING (true)` (migration `20260728000001`). So every authenticated
user can read every other user's token via a plain PostgREST select **or a Realtime
subscription** (`user_profiles` is in the `supabase_realtime` publication, added
`20251210100000`). The token is a bearer capability: possession alone lets anyone POST
to `https://exp.host/--/api/v2/push/send` (see `apps/mobile/lib/notifications.ts`,
`sendPushNotification`) and deliver an arbitrary titled/bodied/deep-linked push to that
device. So any user can spam/phish any other user's device (F7), and the token is
broadcast to every authenticated reader (F8).

**Why it wasn't auto-patched (the coupling).** The app sends notifications
**cross-user** today — the draft-turn notification reads the *next picker's* token
client-side. Relocating the token to an owner-only-RLS table (which closes the leak)
would break that send path unless sending is **simultaneously** moved server-side. And
a column-level REVOKE is **insufficient**: Realtime authorizes by RLS, not column
grants, so while the column exists on a published table it keeps broadcasting. The
column must physically leave `user_profiles`.

**A design decision is required first:** enumerate every notification the app sends
(e.g. draft-your-turn, matchup-scored, trade-filled, …) so the server-side send
function can derive title/body from a closed `notification_type` enum instead of
accepting client-supplied strings. Do NOT skip this — accepting client content on the
server would re-open a spam/phishing vector.

**Progress (2026-09-24):** steps 2 and 3 are **done** on this branch (`send-notification`
and the client cut-over). Steps 1, 4 and 5 are phase 2, staged in
`docs/migrations/STAGED_L2_push_token_capability.sql`. Apply it only after
`send-notification` is deployed and verified **and** every tester is on the ≥ 1.1.0
build: 1.0.0 binaries write their own token to `user_profiles.expo_push_token` and read
leaguemates' tokens from it, so dropping the column breaks them. Give the phase-2
migration a fresh timestamp later than prod's latest applied, not the `~20260730…` below.

**Build spec (ordered):**

1. **New migration** (`~20260730000005_*.sql` — re-time, see above) — mirrors the already-drafted
   `docs/migrations/STAGED_L2_push_token_capability.sql`:
   - `CREATE TABLE push_tokens (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, token text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`.
   - Enable RLS; owner-only policies (`auth.uid() = user_id`) for select/insert/update/delete.
   - Do **NOT** add `push_tokens` to the `supabase_realtime` publication.
   - Backfill: `INSERT INTO push_tokens (user_id, token) SELECT id, expo_push_token FROM user_profiles WHERE expo_push_token IS NOT NULL ON CONFLICT ...`.
   - `ALTER TABLE user_profiles DROP COLUMN expo_push_token;` (this is the line that
     closes the Realtime vector). Keep `notifications_enabled`, `username`, `avatar` on
     `user_profiles` — they are not capabilities.
2. **New `verify_jwt` edge function `send-notification`** — service_role reads the
   recipient's token from `push_tokens`, asserts the caller and recipient **share a
   league**, and derives title/body from the `notification_type` enum (server-side, not
   client strings). Add its `config.toml` entry.
3. **Repoint `apps/mobile/lib/notifications.ts`** — own-token registration reads/writes
   `push_tokens` (not `user_profiles`); the cross-user send calls the new edge function
   instead of POSTing `exp.host` directly.
4. **Grep the whole app (mobile AND web) for every `expo_push_token` reference** and fix
   each — nothing may read the dropped column.
5. Re-run `node scripts/gen-architecture.mjs`; re-capture `db-snapshot.json`.

**Human deploy:** `db push` + edge-function deploy.

---

## TODO 2 — F10: Any league member can insert arbitrary matchup pairings that drive everyone's standings

**The problem.** RLS policy `matchups_insert_members` (migration `20260712000004`) gates
INSERT only on `is_member(league_id)` — no restriction on `team1_user_id`/
`team2_user_id`/`week_number`, no commissioner requirement. The schedule is generated in
the untrusted client and inserted directly; `process-week-results` (service_role) then
scores whatever matchup rows exist. A member can craft a schedule favoring themselves
(easy opponents, #1 playoff seed).

**Why a targeted patch cannot close it.** A matchup schedule has no neutral form to bound
in RLS (the pairings ARE arbitrary data), and `completeDraft` fires for **any** member,
so a commissioner-only RLS gate would break the honest non-commissioner web completer.
A server-side regeneration cannot be made byte-identical because there are **two
divergent client generators** feeding the same policy:
- `apps/web/src/pages/DraftPage.jsx` — pairs `[commissioner, ...others.sort()]` (roster order).
- `apps/web/src/pages/Leaderboard.jsx` — pairs `allUserIds` in draft-pick/trade order (a *different* set and order).

The round-robin (`apps/web/src/utils/scheduleGenerator.js`) is order-sensitive, so the two
produce different pairings; plus a separate seeded playoff-bracket generator writes through
the same policy, and week dates derive from client wall-clock. This is exactly the
roadmap's **mini-project #2** (`[I8]`/`[I9]`, named in migration `20260712000000`).

**In progress (2026-09-24)** on `feat/server-schedule-generation` (STATUS §4 defect 1).
Whatever path writes `draft_status` / `league_start_date` / `league_end_date` must follow
the F1 trigger contract in the header of `20260925000000`. A service-role client with no
forwarded user JWT is unconstrained. A SECURITY DEFINER RPC invoked with a member's JWT
may change only `draft_status` plus a NULL→value date stamp (use
`COALESCE(col, computed)`); any other column raises 42501.

**Build spec (architectural):**
1. Pick a **single canonical roster + ordering** and collapse the two client generators
   (`DraftPage.jsx` and `Leaderboard.jsx`) onto it. *(Product decision — which behavior
   becomes canonical.)*
2. Move schedule generation into a **service_role** path — a SECURITY DEFINER RPC
   `generate_league_schedule(p_league_id)` that asserts membership, reads the canonical
   roster, regenerates pairings/weeks, and inserts matchups (definer bypasses RLS);
   idempotent; pinned `search_path`; revoked from anon, granted to authenticated.
3. Do the same for the playoff bracket and for standings init (`[I9]` — the F6 patch
   only bounds it as an interim).
4. **Then** drop `matchups_insert_members` and restrict INSERT to service_role, repointing
   every client call site.
5. Re-run `gen-architecture.mjs`; check the drift panel.

Note: the F6 patch (`20260925000001`) is the interim `league_standings` hardening; when
this server-side work lands, the standings init should move server-side too and F6's
interim policy can be retired.

---

## Deploy

See `docs/security/DEPLOY-RUNBOOK.md`. It is the single ordered sequence and
covers the pre-flight, functions, `db push`, effect-verification queries, the merge, and
the mobile EAS build.
