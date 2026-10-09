-- symbols becomes signed-in only (Stage 2 of 2).
--
-- Giorgio, 2026-10-08: "I don't want people to be able to scrape anything and
-- the more secure and locked down this can be the better." He chose making
-- public.symbols signed-in only over keeping it public. Before this, the
-- out-of-band policy "read symbols" (FOR SELECT TO PUBLIC USING (true); no
-- migration creates it or the table) let anyone holding the publishable anon
-- key page through every row: ~15k tickers with names, GICS industry, market
-- cap, last price, draftability.
--
-- PRECONDITION (the ORDER matters): symbols-search and symbol-name must ALREADY
-- be deployed from a tree containing 3cbee6a2 (they query symbols with the
-- caller's JWT) and 69b63e01 (symbols-search returns 500 on a failed read). The
-- old deployed versions query as anon; pushing this first makes stock search
-- and symbol names return nothing for EVERY player, with no error (the old
-- symbols-search swallowed read errors and returned { items: [] }). Verify the
-- deploy by source, not behaviour: before this push the PUBLIC policy still
-- lets anon through, so old and new functions answer identically. Grep the
-- downloaded symbols-search for 'lookup_failed' and both for
-- "req.headers.get('Authorization')".
--
-- WHAT IT DOES
--   * drops the PUBLIC "read symbols" policy;
--   * adds symbols_select_authenticated: FOR SELECT TO authenticated USING (true)
--     (reference data, same rows for every signed-in player);
--   * REVOKE ALL ... FROM anon: the table grant, not just RLS. Supabase grants
--     ALL on every public table to anon by default (CLAUDE.md "Postgres function
--     grants" -- the same trap for tables); without a policy anon would see 0
--     rows, but with the grant gone it is refused outright (42501), which is the
--     state the effect check below asserts;
--   * trims authenticated to SELECT only (the draft_queue precedent,
--     20261010000000): no write policy exists so INSERT/UPDATE/DELETE were
--     already refused, but TRUNCATE is not governed by RLS at all. No client
--     writes symbols; every writer (refresh-symbols, enrich-symbols,
--     _shared/draft-write.ts last_price) uses the secret key = service_role;
--   * leaves service_role untouched (it bypasses RLS).
--
-- SECURITY DEFINER readers are unaffected and need no change: set_draft_queue
-- (authenticated-only) reports unknown tickers, which a signed-in caller can
-- read anyway; auto_pick_search_candidates / draft_feasibility_pool are
-- service_role-only; get_portfolio_ledger is SECURITY INVOKER for authenticated.
--
-- POST-PUSH CHECKS (SQL editor; submit each numbered block ON ITS OWN -- an
-- error skips the rest of a submitted script and can leave the session in an
-- aborted transaction):
--
--   -- 1. Privileges, no transaction needed. EXPECT: f | t | f | f | t
--   SELECT has_table_privilege('anon', 'public.symbols', 'SELECT')          AS anon_select,
--          has_table_privilege('authenticated', 'public.symbols', 'SELECT') AS auth_select,
--          has_table_privilege('authenticated', 'public.symbols', 'INSERT') AS auth_insert,
--          has_table_privilege('authenticated', 'public.symbols', 'TRUNCATE') AS auth_truncate,
--          has_table_privilege('service_role', 'public.symbols', 'UPDATE')  AS svc_update;
--   -- and the raw ACL: no anon= entry, no bare =r (PUBLIC), authenticated=r only.
--   SELECT relacl FROM pg_class WHERE oid = 'public.symbols'::regclass;
--   -- If anon_select is still t: the default grant came from another grantor
--   -- (e.g. supabase_admin's default privileges) and survived this REVOKE.
--   -- relacl names the grantor after the slash; revoke as/for that grantor.
--
--   -- 2. Policies: exactly one, to authenticated.
--   SELECT policyname, roles, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'symbols';
--   -- EXPECT ONE row: symbols_select_authenticated | {authenticated} | SELECT | true
--
--   -- 3. Effect, anon. EXPECT ERROR 42501 "permission denied for table symbols".
--   --    0 rows would mean the policy is gone but the GRANT survived: FAIL.
--   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.symbols;
--   -- then, as its own submission:
--   ROLLBACK;
--
--   -- 4. Effect, signed in. EXPECT the full count (~15k), not 0.
--   BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.symbols; ROLLBACK;
--
--   -- 5. Effect, end to end. Signed in, in the app: stock search finds AAPL and
--   --    a stock sheet shows its name (symbols-search now returns 500 on a
--   --    refused read, so an empty list is a real "no matches"). Signed out:
--   --    GET /rest/v1/symbols?select=symbol&limit=1 with only the publishable
--   --    key returns 401 / code 42501, not rows.
--
--   Then re-capture docs/architecture/db-snapshot.json (db-snapshot.sql) so the
--   map's "symbols PUBLIC read" drift row clears.

alter table public.symbols enable row level security;

drop policy if exists "read symbols" on public.symbols;
drop policy if exists symbols_select_authenticated on public.symbols;
create policy symbols_select_authenticated on public.symbols
  for select to authenticated using (true);

-- PUBLIC too: the table was created out-of-band, so a bare =r grant cannot be
-- ruled out from the repo (relacl check 1 shows it either way).
revoke all on table public.symbols from public;
revoke all on table public.symbols from anon;
revoke insert, update, delete, truncate, references, trigger on table public.symbols from authenticated;
grant select on table public.symbols to authenticated;
