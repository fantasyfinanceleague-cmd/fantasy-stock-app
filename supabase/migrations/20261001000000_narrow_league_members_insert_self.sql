-- ============================================================================
-- SECURITY FIX (MEDIUM): narrow the interim league_members INSERT-self policy
-- to the one legitimate caller it still serves: a league's creator adding
-- themselves as commissioner right after creating the league.
-- ============================================================================
-- FINDING (2026-09-25, mid-draft-join worker; orchestrator-assessed MEDIUM)
-- The interim [I4] policy `league_members_insert_self`
-- (20260712000002_rls_b1_02_league_members.sql:25) is:
--     for insert to authenticated with check (user_id = auth.uid()::text)
-- and nothing else. Any authenticated user who knows a league's UUID could
-- INSERT themselves via PostgREST with ANY role value, bypassing
-- join_league_by_code's invite code, capacity check, and draft_status gate.
-- is_commissioner() reads leagues.commissioner_id, so a forged
-- role='commissioner' grants no commissioner POWERS -- the only client that
-- reads league_members.role is UI display (apps/web/src/Header.jsx:113,
-- apps/mobile/app/(tabs)/leagues.tsx:792). The real damage is membership
-- itself: member-level reads (picks, trades, standings, matchups), adding
-- bots via [I6] (for which membership is the only gate), and reshuffling
-- computeDraftOrder mid-draft.
--
-- INSERT-PATH INVENTORY (full grep of apps/web, apps/mobile,
-- supabase/functions, migrations, scripts -- 2026-09-25)
-- Client paths, all under RLS, all self-inserting the caller as commissioner
-- immediately after the caller's own `leagues` insert (gated by [I1]
-- commissioner_id = auth.uid()::text) succeeds, no `.select()` chained:
--   apps/web/src/hooks/useLeagues.js:150      .upsert({..., role:'commissioner'})
--   apps/mobile/app/create-league.tsx:150     .insert({..., role:'commissioner'})
--   apps/mobile/app/(tabs)/leagues.tsx:233    .insert({..., role:'commissioner'})
-- All three leagues inserts set (or default to) draft_status = 'not_started'.
-- Server paths, which bypass RLS entirely and are unaffected by this policy:
--   join_league_by_code (20260716000000, SECURITY DEFINER, EXECUTE granted to
--     service_role only) -- inserts role='member' after its own invite-code,
--     capacity and season-status checks.
--   scripts/seed-test-league.sql -- owner-run seed, not client-reachable.
-- The bot path (apps/web/src/pages/DraftPage.jsx:659, role='member',
-- user_id like 'bot-%') is gated by the separate [I6] policy, untouched here.
-- No edge function and no other migration inserts into league_members.
-- Conclusion: [I4]'s only remaining legitimate use is "creator self-inserts
-- as commissioner into their own, not-yet-started league" -- so that is
-- exactly what the narrowed predicate states.
--
-- WHY role = 'commissioner' IS REQUIRED, NOT JUST user_id = auth.uid()
-- A caller self-inserting as 'member' matches no legitimate path (join
-- inserts 'member' but runs as service_role, not as the caller under RLS),
-- so it is refused by design -- it would only produce a mislabelled
-- commissioner row with no corresponding commissioner-power grant anywhere
-- else in the schema.
--
-- WHY draft_status = 'not_started' IS SAFE FOR EVERY CREATE-LEAGUE CALLER
-- All three client call sites insert (or rely on the DB default for)
-- draft_status = 'not_started' on the SAME leagues row this policy checks,
-- and none of them insert into league_members before that leagues insert
-- commits. There is no legitimate creator self-insert into a league whose
-- draft is already 'in_progress' or 'completed' -- a commissioner who left
-- via [I5] and tries to rejoin mid-draft is exactly the reshuffle vector this
-- closes.
--
-- WHY AN INLINE EXISTS, NOT A NEW is_commissioner()-STYLE HELPER FUNCTION
-- The draft_status check needs a `leagues` row read regardless, so one
-- subquery covers both the commissioner-identity and draft-status checks.
-- Adding a new SECURITY DEFINER function would add a new grant surface that
-- itself needs REVOKE FROM PUBLIC + REVOKE FROM anon verification (see
-- CLAUDE.md "Postgres function grants") for no benefit over an inline EXISTS.
--
-- RETURNING / INSERT..RETURNING VISIBILITY (58518d4 / 9a2518b precedent)
-- None of the three client call sites chain `.select()` after this insert,
-- so supabase-js sends `Prefer: return=minimal` and the SELECT policy is
-- never evaluated against the new row in-statement. Even if a client adds
-- `.select()` later: every row this policy admits has user_id = auth.uid()
-- and the league_members SELECT policy (20260811000005) has the direct
-- `user_id = auth.uid()::text` clause added for exactly this trap -- no
-- subquery, so no command-id visibility issue. The web upsert
-- (`INSERT ... ON CONFLICT DO UPDATE`) is unaffected on its UPDATE arm:
-- league_members has no UPDATE policy, so the conflict path was already
-- refused before this change and remains so.
--
-- [I6] RESIDUAL (left alone, by design -- see orchestrator note)
-- [I6] `league_members_insert_bot` (user_id like 'bot-%' and
-- is_member(league_id)) still lets ANY member add bots at ANY time,
-- including mid-draft, with any role. The computeDraftOrder reshuffle vector
-- therefore survives through bots until [I6] is dropped by
-- supabase/migrations/deferred/20260929000000_drop_I6_I2b.sql on branch
-- feat/mobile-draft-start-search-finalize (not yet merged) once draft-control
-- ships server-side bot seeding.
--
-- Previous policy (for rollback):
--   create policy "league_members_insert_self" on league_members
--     for insert to authenticated
--     with check (user_id = auth.uid()::text);
-- ============================================================================

drop policy "league_members_insert_self" on league_members;

create policy "league_members_insert_self" on league_members
  for insert to authenticated
  with check (
    user_id = auth.uid()::text
    and role = 'commissioner'
    and exists (
      select 1 from leagues l
      where l.id = league_members.league_id
        and l.commissioner_id = auth.uid()::text
        and l.draft_status = 'not_started'
    )
  );
