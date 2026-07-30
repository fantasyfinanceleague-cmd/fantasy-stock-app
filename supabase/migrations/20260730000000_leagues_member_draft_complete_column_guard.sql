-- ============================================================================
-- COLUMN-SCOPE the member draft-completion UPDATE path on `leagues`
-- Closes F1 (HIGH) + F11 (MEDIUM)
-- ============================================================================
-- ROOT CAUSE (both findings, one policy):
--   RLS policy "leagues_update_member_draft_complete" (20260712000001) lets ANY
--   member run the in_progress -> completed UPDATE:
--       using       (is_member(id) and draft_status = 'in_progress')
--       with check  (is_member(id) and draft_status = 'completed')
--   RLS WITH CHECK constrains only the ROW predicate, never WHICH COLUMNS the
--   statement writes. So the same UPDATE a member is allowed to issue for the
--   draft_status flip may ALSO carry other columns in its SET list, and RLS will
--   not object as long as the resulting row still satisfies the predicate:
--     * F1 (HIGH):   member sets commissioner_id = <their own uid> in the same
--                    UPDATE  -> full league takeover.
--     * F11 (MEDIUM): member rewrites league_start_date / league_end_date (or,
--                    after they are set, rewrites them again) -> distorts the
--                    scoring window for every participant.
--   Neither is reachable through the app UI, but both are reachable directly over
--   PostgREST with the publishable key + a member session.
--
-- WHY A TRIGGER, NOT A TIGHTER POLICY:
--   Postgres RLS has no per-column WITH CHECK for UPDATE. A BEFORE UPDATE trigger
--   is the standard way to constrain the SET list. It runs AFTER RLS admits the
--   row, as SECURITY DEFINER, and can compare NEW against OLD column-by-column.
--   We compare the WHOLE row (NEW IS DISTINCT FROM a neutralized OLD) rather than
--   enumerating columns, so any column added to `leagues` in the future is
--   protected by default on the member path — no follow-up migration needed.
--
-- THE TWO LEGITIMATE MEMBER COMPLETION PATHS (must both keep working):
--   * mobile apps/mobile/app/(tabs)/draft.tsx:257
--       .update({ draft_status: 'completed' })                  -- one column
--   * web   apps/web/src/pages/DraftPage.jsx:568-575
--       .update({ draft_status: 'completed',
--                 league_start_date: <computed>,
--                 league_end_date:   <computed> })              -- three columns
--     This web path has NO commissioner gate — the completeDraft useEffect
--     (DraftPage.jsx:508-509) fires for ANY member when the draft is complete.
--     At completion time league_start_date / league_end_date are still NULL
--     (20251230000000_add_league_duration.sql:8-9 create them nullable, unset
--     until this very UPDATE). So on this path those two columns legitimately
--     transition NULL -> computed scoring-window value, together with the
--     draft_status flip. That NULL->value stamp is the carve-out below.
--
-- THE GUARD (member path only): build a NEUTRALIZED copy of OLD by copying onto
--   it ONLY the changes a completing member is allowed to make, then require the
--   incoming NEW to be identical to it. Allowed changes:
--     1. draft_status                    -- always (this is the transition)
--     2. league_start_date               -- ONLY when OLD.league_start_date IS NULL
--     3. league_end_date                 -- ONLY when OLD.league_end_date   IS NULL
--   The NULL guards on 2 & 3 are what distinguish a legitimate FIRST-TIME stamp
--   from an attacker REWRITING an already-set date (F11): once a date is non-NULL
--   it is not copied onto the neutralized OLD, so any attempt to change it makes
--   NEW differ and the statement raises. commissioner_id, name, budget_mode,
--   budget_amount, salary_cap_limit, num_participants, num_rounds, season_status,
--   current_week, current_season_id, and every other column are never copied, so
--   any change to them on the member path raises insufficient_privilege (F1).
--
-- SCOPE — who the guard applies to (three-way on auth.uid()):
--   * auth.uid() IS NULL                          -> service_role / owner / cron
--       (definer edge functions, migrations). No-op: full rights preserved.
--   * auth.uid()::text = OLD.commissioner_id       -> the commissioner.
--       No-op: full rights preserved (leagues_update_commissioner already
--       authorizes their writes; this trigger must not narrow them).
--   * auth.uid() IS NOT NULL AND
--     auth.uid()::text <> OLD.commissioner_id      -> a non-commissioner caller.
--       Guarded as above. (RLS still requires is_member(id) to reach here at all,
--       so a non-member never gets this far; a member who is not the commissioner
--       is the only caller the guard actually constrains.)
--   commissioner_id is `text not null` (20250818225829_create_leagues.sql:6);
--   auth.uid() is uuid, hence the ::text cast — same convention as the B1 helpers
--   and the start_new_league_season lockdown.
-- ============================================================================

create or replace function public.enforce_leagues_member_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  neutralized public.leagues;
begin
  -- service_role / owner / cron: auth.uid() is NULL. Not the member path.
  if auth.uid() is null then
    return new;
  end if;

  -- the commissioner: full rights, governed by leagues_update_commissioner.
  if auth.uid()::text = old.commissioner_id then
    return new;
  end if;

  -- NON-COMMISSIONER member path: permit ONLY the sanctioned completion changes.
  -- Start from OLD and copy on ONLY the allowed transitions.
  neutralized := old;
  neutralized.draft_status := new.draft_status;                 -- (1) always allowed

  if old.league_start_date is null then                         -- (2) first-time stamp only
    neutralized.league_start_date := new.league_start_date;
  end if;

  if old.league_end_date is null then                           -- (3) first-time stamp only
    neutralized.league_end_date := new.league_end_date;
  end if;

  -- If NEW differs from the neutralized OLD in ANYTHING else, the member tried to
  -- write a column they may not (commissioner_id takeover = F1, or an already-set
  -- date rewrite / any other field = F11), so refuse.
  if new is distinct from neutralized then
    raise exception 'insufficient_privilege: a non-commissioner member may only complete the draft (draft_status, plus a first-time league_start_date/league_end_date stamp) on this league'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_leagues_member_update_columns() from public;

drop trigger if exists trg_leagues_member_update_columns on public.leagues;
create trigger trg_leagues_member_update_columns
  before update on public.leagues
  for each row
  execute function public.enforce_leagues_member_update_columns();
