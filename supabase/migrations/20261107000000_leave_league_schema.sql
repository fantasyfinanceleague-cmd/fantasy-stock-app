-- ============================================================================
-- Leave league (1/5): schema. The roster-reconfirmation record, the per-user
-- "hidden" stamp, and the commissioner's member_left notice kind.
-- ============================================================================
-- Plan + rulings: docs/migrations/LEAVE_LEAGUE_OPTIONS.md (Giorgio, 2026-10-05).
--
--   * A manager may leave only BEFORE the draft order is set (draft_date - 1h)
--     or AFTER the season is over. In between they are locked in for the season.
--   * A pre-draft leave puts the league into "roster needs reconfirmation": the
--     commissioner must confirm (go ahead with one fewer, or invite a
--     replacement and then confirm) before the draft can start.
--   * Leaving a finished league HIDES it for that user. Membership and every
--     row of history stay, for everyone.
--
-- league_roster_reconfirm -- one row per league while a confirmation is owed.
--   Written ONLY by the leave-league SECURITY DEFINER functions (leave_league
--   upserts it, confirm_league_roster deletes it). Its PRESENCE is the gate:
--   draft-control refuses to start while the row exists. It is keyed by league
--   (PK), so "a row exists for this league" is the exact per-league predicate,
--   not an any-row read over a partially filled set (CLAUDE.md).
--   Why a table and not a leagues column: leagues_update_commissioner ([I2a])
--   is a whole-row commissioner UPDATE, so a flag on leagues could be cleared
--   over raw PostgREST, skipping the confirm step (and its playoff_teams check).
--   It also carries WHO left, for the commissioner's banner.
--
-- league_members.hidden_at -- NULL = shown. Set only once the league's season is
--   completed, by leave_league; cleared by unhide_league. No client writes it
--   (league_members has no UPDATE policy). is_member() is unchanged, so a
--   hidden league's history stays readable to the user who hid it.
--
-- league_notifications.kind += 'member_left' -- to the (new) commissioner when
--   a manager leaves before the draft. Inserted by leave_league in the same
--   transaction; the leave-league edge function delivers the push.
--   CONFLICT NOTE (PR #94, Run it back, unmerged as of this file): its
--   20261105000001 rewrites this same CHECK with the renewal kinds. This CHECK
--   is a SUPERSET that already includes them, so applying this file after #94
--   keeps #94 working. If #94 is ever re-stamped to apply AFTER this file, its
--   CHECK must add 'member_left', or every pre-draft leave fails its insert.
--
-- PROVISIONAL TIMESTAMP: 20261107000000-04 may be re-stamped at release. Re-stamp
-- only these unapplied files, never an applied one (CLAUDE.md).
--
-- POST-PUSH EFFECT CHECKS (also in docs/security/leave-league-effect-test.sql):
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'league_roster_reconfirm';  -- t
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'league_roster_reconfirm' ORDER BY 1, 2;
--     -- authenticated SELECT, service_role SELECT (+ postgres). Nothing else.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'league_members' AND column_name = 'hidden_at';           -- 1 row
-- ============================================================================

alter table public.league_members
  add column if not exists hidden_at timestamptz;

comment on column public.league_members.hidden_at is
  'Set when the member hides a FINISHED league (leave-league after the season). NULL = shown. Membership and history are kept; get_home_summary skips hidden leagues. Written only by the leave-league SECURITY DEFINER functions.';

create table if not exists public.league_roster_reconfirm (
  league_id          uuid primary key references public.leagues(id) on delete cascade,
  departed_user_ids  text[] not null,
  members_before     int not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint league_roster_reconfirm_departed_check check (cardinality(departed_user_ids) >= 1),
  constraint league_roster_reconfirm_members_check check (members_before >= 1)
);

comment on table public.league_roster_reconfirm is
  'Leave league: one row per league whose commissioner owes a roster confirmation after a pre-draft leave. departed_user_ids = who left since the last confirmation; members_before = the member count before the first of those leaves. Its presence blocks the draft start (draft-control roster_reconfirm_required). Written only by leave_league / confirm_league_roster.';

alter table public.league_roster_reconfirm enable row level security;

-- Supabase grants ALL on new tables to the API roles by default privileges;
-- revoke by name, then grant back exactly what is read.
revoke all on table public.league_roster_reconfirm from public, anon, authenticated, service_role;
grant select on table public.league_roster_reconfirm to authenticated;   -- the banner (RLS: members only)
grant select on table public.league_roster_reconfirm to service_role;    -- draft-control's start gate

drop policy if exists league_roster_reconfirm_select_members on public.league_roster_reconfirm;
create policy league_roster_reconfirm_select_members on public.league_roster_reconfirm
  for select to authenticated
  using (public.is_member(league_id));

alter table public.league_notifications
  drop constraint if exists league_notifications_kind_check;
alter table public.league_notifications
  add constraint league_notifications_kind_check check (kind in (
    'draft_order_set',
    -- PR #94 (Run it back) kinds, kept so this CHECK is a superset of its own:
    'renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set',
    'member_left'      -- to the commissioner: a manager left before the draft
  ));
