-- ============================================================================
-- Run it back (2/6): notification kinds + the renewal reply record
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.9.
-- league_notifications gains the renewal kinds, a subject (the player the event
-- is about) and a detail snapshot. The detail is written at event time, so a
-- later push shows what the event said, not the live state.
--
-- THE kind CHECK MUST BE THE UNION OF EVERY PRIOR MIGRATION'S LIST. This file
-- re-creates the constraint, and it applies AFTER prod's current 14-kind CHECK
-- (20261111000000), so a short list here does not just fail to ADD kinds --
-- it DROPS 8 that prod's auto-start, leave-league and commissioner-transfer
-- features already use, breaking every one of their notification inserts with
-- 23514 the moment this pushes. Every migration since 20261107000000 kept this
-- constraint a superset of PR #94's kinds for exactly this reason (their own
-- comments say so); this file must return the favor. RE-LIST EVERY KIND when
-- re-creating this CHECK again, never just the ones a change adds.
--
-- PROVISIONAL TIMESTAMP: re-stamp before release (see 20261115000000's header).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'league_notifications_kind_check';    -- fourteen kinds, unchanged from 20261111000000
-- ============================================================================

alter table public.league_notifications
  drop constraint if exists league_notifications_kind_check;
alter table public.league_notifications
  add constraint league_notifications_kind_check check (kind in (
    'draft_order_set',
    -- PR #94 (Run it back), this file's own kinds:
    'renewal_invite',   -- to each invited Season 1 player: "are you in?"
    'renewal_reply',    -- to the commissioner, per answer
    'renewal_nudge',    -- to a pending player, at most once per 24 h
    'renewal_removed',  -- to a player the commissioner removed (final)
    'season_set',       -- to every member, when the review is applied
    -- Every kind added by a prior migration, carried forward unchanged:
    'member_left',               -- #126 (20261107000000): to the commissioner
    'commissioner_transferred',  -- #132 (20261110000000): to the new commissioner
    'draft_room_open',           -- #133 (20261111000000): everyone, with your position
    'draft_started',             -- #133: everyone
    'draft_at_risk',             -- #133: the commissioner
    'draft_at_risk_reminder',    -- #133: the commissioner, T-2h
    'draft_postponed',           -- #133: everyone
    'draft_time_set'             -- #133: everyone (debounced)
  ));

alter table public.league_notifications
  add column if not exists subject_user_id text,
  add column if not exists detail jsonb not null default '{}'::jsonb;

comment on column public.league_notifications.subject_user_id is
  'The user the event is ABOUT (the player who replied, or the commissioner for an invite). NULL for kinds with no subject.';
comment on column public.league_notifications.detail is
  'Snapshot of the event as it happened (names, counts, season number). Written once; never recomputed for the push.';

-- Exactly once per recipient for the one-shot kinds. renewal_reply and
-- renewal_nudge are many-per-recipient by design (one per event), so no index.
create unique index if not exists league_notifications_renewal_invite_uidx
  on public.league_notifications (league_id, user_id) where kind = 'renewal_invite';
create unique index if not exists league_notifications_renewal_removed_uidx
  on public.league_notifications (league_id, user_id) where kind = 'renewal_removed';
create unique index if not exists league_notifications_season_set_uidx
  on public.league_notifications (league_id, user_id) where kind = 'season_set';
