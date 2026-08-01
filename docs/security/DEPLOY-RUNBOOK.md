# Deploy runbook — security fixes (branch `security/claude-security-fixes-20260730`)

Turnkey, ordered checklist to ship the 10 in-code fixes from the 2026-07-30 Claude
Security scan. Every step here is **prod-mutating and yours to run** (the repo's
handoff model keeps deploys/`db push`/dashboard config off automation). Golden rule
throughout: **verify the EFFECT, not the command's output** — a clean `db push` or a
`succeeded` cron log is not evidence the change landed.

Ordering principle: land the **backward-compatible** changes first (they don't break
currently-live clients), do the **coordinated** one (F12) deliberately, and merge to
`main` LAST (merging = the web Vercel prod deploy).

Fixes and where they live: see `docs/security/REMAINING-SECURITY-WORK.md`.

---

## Phase A — Supabase dashboard config (additive, zero risk)

- [ ] **F2 redirect allowlist.** Supabase → Auth → URL Configuration → add a redirect
  URL that preserves the query param: `fantasystockapp://reset-password?**` (or the
  broader `fantasystockapp://**`). Additive — the old plain `redirectTo` still matches,
  so nothing breaks by adding it.

## Phase B — Backward-compatible backend (safe with old clients live; any order)

- [ ] **F9 — historical-bars.** `supabase functions deploy historical-bars`
  - Verify: a request with a bad date (`"start":"2020-01-01&feed=sip"`) returns **our**
    HTTP 400 `invalid_start`, and a normal `YYYY-MM-DD` request still returns bars.
- [ ] **F5 — refresh-symbols.** `supabase functions deploy refresh-symbols` (carries
  `verify_jwt=false` from `config.toml`).
  - Verify the flip took: a **no-credential** POST must hit OUR handler 401
    (`{"error":"Unauthorized"}`), NOT the gateway's generic 401. Also check the
    dashboard Verify-JWT toggle. (A verify_jwt flip may not take on the first deploy.)
  - Then reschedule the daily `refresh_symbols_daily` cron to send the `apikey` from
    `vault.decrypted_secrets` (it 401s today, so this is a fix-forward, not a break).
> **F1 + F6 migrations are NOT pushed here.** `supabase db push` applies ALL pending
> migrations in one shot — it cannot push just F1/F6 without also applying F12's
> `20260730000004` (which drops the client `trades` INSERT policy). Since that drop
> must happen inside the F12 window (after `place-order` is deployed and clients
> updated), the **single `db push` lives in Phase C** and applies all three new
> migrations together. F1 and F6 are backward-compatible, so landing them in that same
> push is fine. Do NOT run `db push` in Phase B.
>
> Sanity-check what's pending before the push: `supabase migration list` should show
> exactly `20260730000000`, `20260730000001`, `20260730000004` as remote-unapplied
> (prod should already be at `20260728000001`). If older migrations are unexpectedly
> pending, stop and investigate before pushing.

## Phase C — F12 (coordinated: client + server must move together)

> **Requires an OPEN market.** The safety step (verify `place-order` records a real
> fill server-side *before* the `db push` drops the client-insert fallback) needs a
> genuine Alpaca fill. Paper orders placed while the market is closed queue rather than
> fill, and `place-order` only records on `status === 'filled'`. So run Phase C during
> market hours; do NOT drop the policy on faith.

**Why this one is different:** the new `place-order` **requires `league_id`** (old
clients that don't send it get HTTP 400) and the final migration **drops the client
`trades` INSERT policy** (old client-side inserts then fail). So the clients and the
server must update together. Web is automatic (merge = deploy); **mobile is the risk**
because old app-store versions linger.

**Pick a path:**

### Path 1 — coordinated window (RECOMMENDED for a small/pre-launch mobile base, or if you can force-update)
Do these back-to-back in one window:
1. [ ] Ship the mobile update (EAS build/submit + OTA from `apps/mobile/`) so devices send
   `league_id` and stop inserting trades client-side. Force-update if you can.
2. [ ] Merge the PR to `main` (deploys the new **web** client to Vercel — this is also
   your web prod deploy; only do it once you're ready for prod).
3. [ ] `supabase functions deploy place-order`.
4. [ ] Verify a real trade records server-side: place one paper trade, then
   `SELECT symbol, action, quantity, price, alpaca_order_id FROM trades ORDER BY created_at DESC LIMIT 1;`
   — values must come from the Alpaca fill.
5. [ ] `supabase db push` — this applies **all three** new migrations together
   (`20260730000000` F1, `20260730000001` F6, `20260730000004` F12). Verify each:
   - F1 trigger: `SELECT tgname FROM pg_trigger WHERE tgrelid='leagues'::regclass;`
     (expect `trg_leagues_member_update_columns`).
   - F6 policy: `SELECT polname, pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid='league_standings'::regclass;`
     (WITH CHECK bounds score columns to 0).
   - F12: `SELECT polname, polcmd FROM pg_policy WHERE polrelid='trades'::regclass;`
     — there should be **no** authenticated INSERT policy left.
> Between steps 2 and 3 there's a brief window where a new web client's trade may not
> record (new client doesn't insert client-side; old place-order doesn't record yet).
> Keep 2→3 tight. Trading itself is not broken in that window; only recording lags.

### Path 2 — transitional shim (only if you CANNOT force-update mobile)
If old mobile versions must keep working during a long rollout, do NOT deploy the strict
`place-order` or drop the policy yet. Instead:
1. Deploy a transitional `place-order` that treats `league_id` as **optional**: when
   present (new clients) it does the membership check + server-side record; when absent
   (old clients) it places the order and returns as before, letting the old client insert
   client-side (the INSERT policy still exists, so that keeps working). This preserves
   the *pre-existing* behaviour for old clients — F12 stays open for them, but there is
   no regression.
2. Roll out the new web + mobile clients.
3. Once old clients are drained, deploy the strict `place-order` (require `league_id`)
   and `db push` `20260730000004` to drop the policy — fully closing F12.
> I can draft the transitional `place-order` on request; it's not in the branch because
> Path 1 is expected for this app's scale.

## Phase D — Verify & refresh the map (after all Supabase changes)

- [ ] Re-capture the DB snapshot: run `docs/architecture/db-snapshot.sql` against prod and
  save the single output cell into `docs/architecture/db-snapshot.json`.
- [ ] `node scripts/gen-architecture.mjs`, commit the result.
- [ ] Open the map's **"claim vs reality" drift panel** and confirm the new policies/
  trigger and the `refresh-symbols` auth edge now show as matched — this is the check
  that a lockdown migration actually landed (a migration applying is not proof).

## Post-deploy smoke checks (the effect, per finding)

- [ ] **F2:** on a device, request a password reset, open the emailed link, confirm you
  reach reset-password and can set a new password (the `?rn=` nonce must survive the
  redirect — if reset fails here, the Phase A allowlist entry is wrong).
- [ ] **F1:** as a non-commissioner member, an attempt to `UPDATE leagues SET commissioner_id=...`
  during a draft is rejected; a normal draft completion still works.
- [ ] **F5:** `refresh-symbols` with a valid user JWT but no apikey → 401.
- [ ] **F12:** a direct forged `INSERT INTO trades ...` from an authenticated client is
  denied by RLS; a real trade still records via `place-order`.
- [ ] **F13:** mobile password change with a wrong current password is blocked.

## Notes / rollback
- Migrations here only ADD a trigger / TIGHTEN policies / DROP one policy. If a problem
  surfaces, the fastest mitigation is a follow-up migration re-adding the prior policy
  (do NOT edit an applied migration). The F1 trigger can be disabled with
  `DROP TRIGGER trg_leagues_member_update_columns ON leagues;` in a new migration.
- Edge-function deploys can be rolled back by redeploying the previous version.
- **F2 is the one change that skipped the independent verifier panel** (design was
  panel-verified; the expo-crypto RNG swap was implemented directly) — give it the extra
  end-to-end reset test above before trusting it.
