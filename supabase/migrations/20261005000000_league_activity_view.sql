-- ============================================================================
-- league_activity: unions drafts + trades into one per-league timeline.
-- Ask #5 (docs/design/prompts/phase3-plan.md): the mobile trade-history
-- screen (apps/mobile/app/trade-history.tsx) reads only `trades` today, so a
-- user's DRAFT picks are invisible in their own trade history.
-- ============================================================================
-- WHY security_invoker: a plain view runs as its OWNER and bypasses RLS on
-- the underlying tables entirely — a view is its own privilege surface,
-- separate from the tables it selects from, which is the view-shaped twin of
-- CLAUDE.md's "REVOKE FROM PUBLIC doesn't clear default grants" lesson.
-- WITH (security_invoker = true) (PG15+; this repo runs PG17) makes the view
-- re-check RLS as the QUERYING role instead, so it inherits exactly drafts'
-- and trades' existing member-only SELECT policies — no access is granted
-- here beyond what a client can already read via two separate queries today.
--
-- EXCLUDES SKIP rows (drafts.symbol = 'SKIP', a forfeited-turn sentinel, not
-- a position — see supabase/functions/_shared/draft-validation.ts). The
-- draft recap (ask #9, already RLS-readable, no migration) is where a
-- skipped turn is rendered as "Skipped".
--
-- CASTS (CLAUDE.md "cross-table position queries need explicit casts"):
-- drafts.user_id is text, trades.user_id is uuid — ::text on both sides so
-- the UNION ALL doesn't fail on a type mismatch. Quantities are already
-- numeric on both tables (20260810000000 widened both from integer), but the
-- ::numeric casts are kept explicit so this view does not silently break if
-- either column's type changes again.
-- ============================================================================
create or replace view public.league_activity
  with (security_invoker = true)
as
  select
    'draft'::text                                           as kind,
    d.id,
    d.league_id,
    d.user_id::text                                         as user_id,
    d.symbol,
    'buy'::text                                             as action,
    d.quantity::numeric                                     as quantity,
    d.entry_price::numeric                                  as price,
    round(d.entry_price::numeric * d.quantity::numeric, 2)  as total_value,
    d.created_at                                            as occurred_at,
    d.round,
    d.pick_number
  from public.drafts d
  where d.symbol <> 'SKIP'

  union all

  select
    'trade'::text          as kind,
    t.id,
    t.league_id,
    t.user_id::text        as user_id,
    t.symbol,
    t.action,
    t.quantity::numeric    as quantity,
    t.price::numeric       as price,
    t.total_value::numeric as total_value,
    t.created_at           as occurred_at,
    null::integer          as round,
    null::integer          as pick_number
  from public.trades t;

comment on view public.league_activity is
  'Member-readable union of drafts (excl. SKIP) + trades, one timeline per '
  'league. security_invoker=true: RLS is enforced as the CALLING role via '
  'drafts'' and trades'' own policies, not the view owner''s.';

-- Explicit, not assumed: revoke any default grant, then grant only what
-- clients need. anon gets nothing (auth.uid() is NULL under the underlying
-- RLS anyway, but this keeps the view's own ACL honest on its own).
revoke all on public.league_activity from public, anon, authenticated;
grant select on public.league_activity to authenticated;

-- ============================================================================
-- HUMAN ACTION (Giorgio) — from /Users/giorgio/fantasy-stock-deploy per
-- CLAUDE.md (dry-run, then db push, then verify — never trust push output).
-- ============================================================================
--   POST-PUSH verify (relacl, not the push output):
--     SELECT relname, relacl FROM pg_class
--      WHERE relnamespace = 'public'::regnamespace AND relname = 'league_activity';
--     -> relacl must show authenticated=r/<owner> and NOT anon=r/... .
--   Effect test: docs/security/game-data-asks-effect-test.sql, section #5.
