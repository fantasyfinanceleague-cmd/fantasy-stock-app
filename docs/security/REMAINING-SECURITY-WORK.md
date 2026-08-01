# Remaining security work — Claude Security scan (rev 2f2906c, 2026-07-30)

Self-contained handoff so a **new session** can pick this up without the local
`CLAUDE-SECURITY-*/` report directory (which is gitignored and does not travel
with the repo). It records: (1) the status of all 13 findings, (2) the full
build specs for the 3 findings NOT yet fixed, and (3) the deploy checklist for
the fixes that ARE in the branch but need prod steps.

Fixes landed on branch `security/claude-security-fixes-20260730` (commit 2dd699f).

---

## Status of all 13 findings

| ID | Sev | Status | Where |
|----|-----|--------|-------|
| F1 | HIGH | ✅ fixed in code | migration `20260730000000` (leagues UPDATE column-guard trigger) |
| F2 | HIGH | ✅ fixed in code | `apps/mobile/lib/recoveryNonce.ts` + `_layout.tsx` + `forgot-password.tsx` — needs redirect-allowlist config (see Deploy) |
| F3 | MED | ✅ fixed in code | `apps/web/src/utils/inviteCode.js`, `apps/mobile/lib/inviteCode.ts` |
| F4 | MED | ✅ fixed in code | (closed by F3 — shared CSPRNG helpers) |
| F5 | MED | ✅ fixed in code | `refresh-symbols/index.ts` + `config.toml` (apikey gate, verify_jwt=false) |
| F6 | MED | ✅ fixed in code | migration `20260730000001` (league_standings INSERT bounded to zero) |
| **F7** | MED | ❌ **TODO** | push-token send authorization — see below |
| **F8** | MED | ❌ **TODO** | push-token relocation — see below (same work as F7) |
| F9 | MED | ✅ fixed in code | `historical-bars/index.ts` (date validation + encoding) |
| **F10** | MED | ❌ **TODO** | matchup schedule forgery — see below |
| F11 | MED | ✅ fixed in code | (closed by F1 — same policy trigger) |
| F12 | LOW | ✅ fixed in code | `place-order/index.ts` + migration `20260730000004` + both TradeModals + DraftPage |
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

**Build spec (ordered):**

1. **New migration** (`~20260730000005_*.sql`) — mirrors the already-drafted
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

Note: the F6 patch (`20260730000001`) is the interim `league_standings` hardening; when
this server-side work lands, the standings init should move server-side too and F6's
interim policy can be retired.

---

## Deploy checklist for the fixes ALREADY in this branch

These are code-only until deployed (per the repo's prod/secret handoff model):

1. **F12:** deploy `place-order` **before** `supabase db push` of `20260730000004`
   (else trades briefly fail to record in the gap).
2. **F5:** deploy `refresh-symbols`; confirm the `verify_jwt` true→false flip took (a
   no-credential request must hit OUR 401 JSON, not the gateway's generic 401); then
   reschedule the daily `refresh_symbols_daily` cron to send the `apikey` from
   `vault.decrypted_secrets`.
3. **F1, F6:** `supabase db push`, then verify the live policy/trigger via `pg_policies`
   / `pg_trigger` — a clean push is not evidence the change landed.
4. **F2:** ensure the Supabase Auth **redirect-URL allowlist preserves the `?rn=` query
   param** (e.g. allow `fantasystockapp://reset-password?**` or `fantasystockapp://**`)
   and **test the password-reset flow end-to-end** — otherwise the fail-closed nonce
   check will reject legitimate resets. F2 is also the one change not run through the
   independent agent-verifier panel (design was verified; the expo-crypto RNG swap was
   implemented directly), so give it an extra manual look.
5. After all Supabase changes: re-run `node scripts/gen-architecture.mjs` and re-capture
   `docs/architecture/db-snapshot.json` (the drift panel stays red until then).
