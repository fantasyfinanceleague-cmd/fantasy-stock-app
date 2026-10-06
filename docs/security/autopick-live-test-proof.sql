-- ============================================================================
-- AUTO-PICK LIVE TEST PROOF: run in the Supabase SQL editor (prod) AFTER the
-- manual sweeps of docs/migrations/AUTOPICK_CRON_LIVE.md step 5. READ-ONLY.
-- Nothing persists: the block ends by RAISING, and the result lands in the
-- editor's error panel.
--
-- Replace <TEST_LEAGUE_ID> (one place, below) with the test league's id.
--
-- WHAT IT PROVES: the overdue turns got picks written by the SWEEP (no app was
-- open), that those picks passed the same gate a manual pick does (slot rules,
-- ownership, positive price/quantity), that none is a SKIP, that they are
-- gap-free, and that each was recorded no earlier than pick_seconds after the
-- turn's clock anchor.
--
-- WHAT IT CANNOT PROVE: that the app really was closed. A bot pick has
-- pick_source 'bot' whether the sweep or a 1.1.0 client's bot_pick wrote it; the
-- runbook's "force-quit the app before the first sweep" is what makes 'bot'
-- evidence of the sweep. (Human turns are unambiguous: only the sweep writes
-- auto_queue / auto_best, as no shipped client sends auto_pick.)
--
-- EXPECTED: every line ends in PASS (INFO lines are for the eyes). Any FAIL: stop,
-- do NOT promote the cron, send the output to the Orchestrator.
-- ============================================================================
do $$
declare
  l_id uuid := '<TEST_LEAGUE_ID>';
  out text := '';
  lg record;
  total int; human_auto int; bots int; skips int; bad int; slots int;
  mn int; mx int; dist int;
  listing text;
begin
  select * into lg from public.leagues where id = l_id;
  if not found then
    raise exception 'FAIL: league % not found. Check the id.', l_id;
  end if;

  -- League names are user-controlled: strip control characters so a name can neither
  -- forge an output line nor smuggle instructions into text we hand onward.
  out := out || format(E'INFO league "%s": draft_status=%s pick_seconds=%s clock_enabled=%s\n',
    left(regexp_replace(coalesce(lg.name, ''), '[[:cntrl:]]', ' ', 'g'), 40),
    lg.draft_status, lg.pick_seconds, lg.pick_clock_enabled);

  select count(*),
         count(*) filter (where user_id not like 'bot-%' and pick_source in ('auto_queue', 'auto_best')),
         count(*) filter (where user_id like 'bot-%' and pick_source = 'bot'),
         count(*) filter (where upper(symbol) = 'SKIP'),
         min(pick_number), max(pick_number), count(distinct pick_number)
    into total, human_auto, bots, skips, mn, mx, dist
    from public.drafts where league_id = l_id;

  -- P1: the sweep produced both kinds of pick.
  out := out || format(E'P1 picks written by the sweep: %s human auto (auto_queue/auto_best), %s bot  %s\n',
    human_auto, bots, case when human_auto >= 1 and bots >= 1 then 'PASS' else 'FAIL (need >= 1 of each)' end);

  -- P2: no pick_source is on the wrong kind of manager.
  select count(*) into bad from public.drafts
   where league_id = l_id
     and ((user_id like 'bot-%' and pick_source <> 'bot' and pick_source <> 'manual')
       or (user_id not like 'bot-%' and pick_source = 'bot'));
  out := out || format(E'P2 pick_source matches the manager kind (bots: bot, humans: auto_*/manual): %s mismatches  %s\n',
    bad, case when bad = 0 then 'PASS' else 'FAIL' end);

  -- P3: never a SKIP.
  out := out || format(E'P3 SKIP rows: %s  %s\n', skips, case when skips = 0 then 'PASS' else 'FAIL' end);

  -- P4: pick numbers are 1..N with no gap and no duplicate.
  out := out || format(E'P4 pick numbers contiguous 1..%s (min %s, distinct %s of %s)  %s\n', mx, mn, dist, total,
    case when total > 0 and mn = 1 and mx = total and dist = total then 'PASS' else 'FAIL' end);

  -- P5: every pick has a positive price and quantity, and no symbol is drafted twice (ownership).
  select count(*) into bad from public.drafts
   where league_id = l_id and not (coalesce(entry_price, 0) > 0 and coalesce(quantity, 0) > 0);
  out := out || format(E'P5a price and quantity > 0 on every pick: %s violations  %s\n', bad, case when bad = 0 then 'PASS' else 'FAIL' end);
  select count(*) - count(distinct upper(symbol)) into bad from public.drafts where league_id = l_id;
  out := out || format(E'P5b no symbol drafted twice: %s duplicates  %s\n', bad, case when bad = 0 then 'PASS' else 'FAIL' end);

  -- P6: slot rules. Every pick sits in one of THIS league's slots, and no manager
  -- holds more picks in a slot than its slot_count.
  select count(*) into slots from public.league_draft_slots where league_id = l_id;
  if slots = 0 then
    out := out || E'P6 slot rules: league has no slots (INFO, not applicable)\n';
  else
    select count(*) into bad from public.drafts d
     where d.league_id = l_id
       and (d.slot_id is null
            or not exists (select 1 from public.league_draft_slots s where s.id = d.slot_id and s.league_id = l_id));
    out := out || format(E'P6a every pick in one of this league''s slots: %s outside  %s\n', bad, case when bad = 0 then 'PASS' else 'FAIL' end);
    select count(*) into bad from (
      select d.user_id, d.slot_id
        from public.drafts d join public.league_draft_slots s on s.id = d.slot_id
       where d.league_id = l_id
       group by d.user_id, d.slot_id, s.slot_count
      having count(*) > s.slot_count) over_full;
    out := out || format(E'P6b no manager over a slot''s slot_count: %s over  %s\n', bad, case when bad = 0 then 'PASS' else 'FAIL' end);
  end if;

  -- P7: timing. Every non-manual pick was recorded at least pick_seconds after its
  -- clock anchor (the previous pick's recorded_at; pick 1's anchor is draft_started_at).
  select count(*) into bad from (
    select d.pick_source, d.recorded_at,
           coalesce(lag(d.recorded_at) over (order by d.pick_number), lg.draft_started_at) as anchor
      from public.drafts d where d.league_id = l_id) x
   where x.pick_source <> 'manual'
     and x.recorded_at < x.anchor + make_interval(secs => lg.pick_seconds) - interval '1 second';
  out := out || format(E'P7 every auto/bot pick came at least %ss after its anchor: %s too early  %s\n',
    lg.pick_seconds, bad, case when bad = 0 then 'PASS' else 'FAIL' end);

  -- P8: nothing is stalled.
  select count(*) into bad from public.draft_stalls where league_id = l_id;
  out := out || format(E'P8 open draft_stalls rows: %s  %s\n', bad, case when bad = 0 then 'PASS' else 'FAIL (a turn stalled: see reason below)' end);

  -- The picks, for the eyes (gap = seconds since the previous pick / the draft start).
  select string_agg(format(E'   #%s %s %s %s x%s @%s source=%s gap=%ss', pick_number, user_id, symbol, entry_price, quantity,
                           to_char(recorded_at, 'HH24:MI:SS'), pick_source, gap), E'\n' order by pick_number)
    into listing
    from (select d.*, round(extract(epoch from d.recorded_at
                  - coalesce(lag(d.recorded_at) over (order by d.pick_number), lg.draft_started_at)))::int as gap
            from public.drafts d where d.league_id = l_id) p;
  out := out || E'INFO picks:\n' || coalesce(listing, '   (none)') || E'\n';

  raise exception 'AUTO-PICK LIVE TEST PROOF (read-only): %
%', case when out ~ '(^|\n)P[0-9][a-z]? [^\n]*  FAIL' then 'FAIL' else 'PASS' end, out;
end;
$$;
