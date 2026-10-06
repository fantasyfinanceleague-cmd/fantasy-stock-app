-- ============================================================================
-- draft_stalls — the in-app record of an auto-pick that found NO legal stock
-- (draft-never-skips, 2026-10-05).
--
-- Before this change a turn with no legal stock wrote a SKIP sentinel row, and
-- nothing alerted anyone. Now a stalled turn writes NOTHING to drafts: the turn
-- stays open, and the failure is recorded here (one row per league pick, PK
-- (league_id, pick_number)) and pushed to the commissioner on the FIRST stall.
-- A repeat sweep only refreshes attempts / last_seen_at. Service role writes;
-- members READ their league's stalls (so the app can show "auto-pick paused").
--
-- Effect-verify after push (HUMAN ACTION):
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'draft_stalls';
--   -- expect relrowsecurity = true
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'draft_stalls';
--   -- expect SELECT for authenticated and ALL for service_role; NOTHING for anon
--
-- HUMAN ACTION: supabase db push, from the deploy checkout only (CLAUDE.md).
-- ============================================================================

create table if not exists public.draft_stalls (
  league_id     uuid not null references public.leagues(id) on delete cascade,
  pick_number   integer not null,
  picker_id     text not null,
  reason        text not null,
  attempts      integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (league_id, pick_number)
);

alter table public.draft_stalls enable row level security;

-- Members read their league's stalls. No client write policy exists, so the
-- table is writable by the service role only.
create policy "draft_stalls_select_members" on public.draft_stalls
  for select to authenticated
  using (is_member(league_id));

-- Supabase's default privileges grant anon/authenticated on new public tables;
-- RLS alone is not the boundary we want. Revoke by name, then grant the minimum.
revoke all on public.draft_stalls from anon, authenticated;
grant select on public.draft_stalls to authenticated;
grant all on public.draft_stalls to service_role;
