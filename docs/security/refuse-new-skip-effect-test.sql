-- ============================================================================
-- REFUSE-NEW-SKIP EFFECT TEST: run in the Supabase SQL editor AFTER `db push`
-- of 20261106000002_drafts_refuse_new_skip.sql. NOTHING persists: every attempt
-- runs in its own BEGIN/EXCEPTION sub-block (a savepoint), and the DO block ends
-- by RAISING, which rolls everything back and prints the result table in the
-- editor's error panel. If the trigger were MISSING, the test inserts would
-- succeed and the final raise would still roll them back.
--
-- Replace <TEST_LEAGUE_ID> (one place, below) with the test league's id. Any league
-- that has at least one non-bot member works. The test user is a real UUID-shaped
-- member, never a 'bot-%' id.
--
-- EXPECTED (every line ends in PASS):
--   T0  trigger drafts_refuse_new_skip exists on public.drafts            PASS
--   T1  function refuse_new_skip_rows not executable by anon/authenticated  PASS
--   T2  INSERT symbol 'SKIP'  -> 23514 with OUR message (not another CHECK)  PASS
--   T3  INSERT symbol 'skip'  -> 23514 check_violation                    PASS
--   T4  UPDATE an existing row's symbol TO 'SKIP' -> 23514                PASS
--   T5  existing legacy SKIP rows are still readable (count shown)        PASS
-- ============================================================================
do $$
declare
  l_id uuid := '<TEST_LEAGUE_ID>';
  u text;
  existing_pick int;
  out text := '';
  n int;
  acl text;
begin
  select user_id into u from public.league_members
   where league_id = l_id and user_id not like 'bot-%' limit 1;
  if u is null then raise exception 'FAIL: league % has no non-bot member (or does not exist)', l_id; end if;

  -- T0
  select count(*) into n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
   where t.tgname = 'drafts_refuse_new_skip' and c.relname = 'drafts' and ns.nspname = 'public' and not t.tgisinternal;
  out := out || format(E'T0 trigger drafts_refuse_new_skip present: %s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);

  -- T1
  select proacl::text into acl from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'refuse_new_skip_rows';
  out := out || format(E'T1 proacl %s  %s\n', coalesce(acl, '(null = default)'),
    case when acl is not null and acl not like '%anon=%' and acl not like '%authenticated=%' then 'PASS' else 'FAIL' end);

  -- T2, T3: new SKIP rows (pick_number 99999 cannot collide with a real turn).
  begin
    insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
    values (l_id, u, 'SKIP', 0, 0, 1, 99999);
    out := out || E'T2 INSERT SKIP  -> allowed  FAIL\n';
  exception when others then
    out := out || format(E'T2 INSERT SKIP  -> %s  %s\n', sqlstate, case when sqlstate = '23514' and sqlerrm like 'SKIP rows are retired%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
    values (l_id, u, 'skip', 0, 0, 1, 99999);
    out := out || E'T3 INSERT skip  -> allowed  FAIL\n';
  exception when others then
    out := out || format(E'T3 INSERT skip  -> %s  %s\n', sqlstate, case when sqlstate = '23514' and sqlerrm like 'SKIP rows are retired%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- T4: an UPDATE that sets symbol to SKIP on a real row.
  select pick_number into existing_pick from public.drafts
   where league_id = l_id and upper(symbol) <> 'SKIP' limit 1;
  if existing_pick is null then
    out := out || E'T4 UPDATE TO SKIP  -> no non-SKIP row in this league to try (INFO)\n';
  else
    begin
      update public.drafts set symbol = 'SKIP' where league_id = l_id and pick_number = existing_pick;
      out := out || E'T4 UPDATE TO SKIP  -> allowed  FAIL\n';
    exception when others then
      out := out || format(E'T4 UPDATE TO SKIP  -> %s  %s\n', sqlstate, case when sqlstate = '23514' and sqlerrm like 'SKIP rows are retired%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
    end;
  end if;

  -- T5: history is untouched and readable (an ordinary SELECT, not blocked by the trigger).
  select count(*) into n from public.drafts where upper(symbol) = 'SKIP';
  out := out || format(E'T5 legacy SKIP rows still readable: %s  %s\n', n,
    case when n > 0 then 'PASS' else '(INFO: none exist in this database, nothing to read)' end);

  raise exception 'REFUSE-NEW-SKIP EFFECT TEST (all rolled back):%
%', case when out ~ '(^|\n)T[0-9] [^\n]*  FAIL' then ' FAIL' else ' PASS' end, out;
end;
$$;
