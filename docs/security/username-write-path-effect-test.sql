-- ============================================================================
-- USERNAME WRITE PATH EFFECT TEST
-- (supabase/migrations/20261007000000_username_write_path.sql,
--  branch fix/username-write-path)
--
-- Run in the Supabase SQL editor AFTER `db push` of 20261007000000.
--
-- Shape (same pattern as game-data-asks-effect-test.sql): ONE DO block,
-- rolled back at the end by a deliberate RAISE EXCEPTION, so NOTHING
-- persists — including the auth.users fixtures and the user_profiles rows the
-- live handle_new_user_profile trigger creates for them. The results are the
-- RAISE's message (the editor shows only that). Never add a `commit`.
--
-- Role/JWT switches use set_config('role', ..., true) /
-- set_config('request.jwt.claims', ..., true), the way PostgREST does. They
-- are made OUTSIDE the per-case begin/exception blocks: a case that raises
-- rolls back its subtransaction, which would also revert a role switch made
-- inside it.
--
-- auth.users COLUMN LIST: the minimal set proven against the live schema by
-- home-summary-display-names-effect-test.sql / game-data-asks (id, email,
-- created_at, updated_at, aud, role, instance_id, raw_user_meta_data).
--
-- FIXTURE NAMES are random-suffixed (fx<letter>_<10 hex>, 13 chars) so they
-- cannot collide with a real prod username.
--
-- EXPECTED OUTPUT (all PASS):
--   L  CHECK constraint present and validated                     -> PASS
--   M  grants: authenticated can execute both, anon cannot         -> PASS
--   T  trigger: valid signup metadata persisted for A and B        -> PASS
--   A  A: set_username(valid new name) -> 'ok', row updated        -> PASS
--   A2 A: set_username(same name again) -> 'ok' (idempotent)       -> PASS
--   D  A: set_username(own name re-cased) -> 'ok', row re-cased    -> PASS
--   B  B: set_username(A's name, other case) -> 'taken', B unchanged -> PASS
--   C  B: NULL, '', too short/long, space, non-ASCII, punctuation,
--        trailing newline -> all 'invalid', B unchanged           -> PASS
--   J  B: check_usernames statuses, duplicates collapsed, order kept -> PASS
--   J2 B: check_usernames with 11 candidates -> 22023             -> PASS
--   J3 B: check_usernames(NULL) and ('{}') -> 0 rows              -> PASS
--   G  B: direct UPDATE own username to 'bad name!' -> 23514      -> PASS
--   G2 B: direct UPSERT (PostgREST shape) with bad name -> 23514  -> PASS
--   H  B: direct UPDATE own username to NULL -> allowed (1 row)   -> PASS
--   I  B: direct UPDATE of A's row -> 0 rows, A unchanged         -> PASS
--   E  anon: set_username -> 42501                                -> PASS
--   F  anon: check_usernames -> 42501                             -> PASS
--   K  trigger: invalid signup metadata still stored as NULL      -> PASS
--      (regression: the CHECK must never fire inside the trigger)
--   N  no JWT (editor role): set_username -> 42501                -> PASS
-- ============================================================================
do $$
declare
  sfx     text := substr(md5(random()::text), 1, 10);
  u_a     uuid := gen_random_uuid();
  u_b     uuid := gen_random_uuid();
  u_k     uuid := gen_random_uuid();
  name_a  text := 'fxa_' || sfx;          -- A's signup name
  name_b  text := 'fxb_' || sfx;          -- B's signup name
  new_a   text := 'fxn_' || sfx;          -- A's new name via RPC
  free_n  text := 'fxf_' || sfx;          -- never assigned to anyone
  res     text;
  cur     text;
  n       int;
  got     text;
  bad     text;
  bad_list text;
  out     text := E'\n';
begin
  -- ==========================================================================
  -- Fixtures (editor's privileged role). The live trigger creates profiles.
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
  values
    (u_a, 'fixture-a-' || u_a || '@username-write-path-test.invalid', now(), now(),
     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
     jsonb_build_object('username', name_a)),
    (u_b, 'fixture-b-' || u_b || '@username-write-path-test.invalid', now(), now(),
     'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
     jsonb_build_object('username', name_b));

  -- L: the constraint exists and is VALIDATED (not NOT VALID).
  select count(*) into n from pg_constraint
   where conrelid = 'public.user_profiles'::regclass
     and conname = 'user_profiles_username_format' and convalidated;
  out := out || case when n = 1
    then E'L  CHECK constraint present and validated -> PASS\n'
    else format(E'L  CHECK constraint present and validated -> found=%s  FAIL\n', n) end;

  -- M: grants (has_function_privilege follows role membership + PUBLIC).
  out := out || case when
        has_function_privilege('authenticated', 'public.set_username(text)', 'execute')
    and has_function_privilege('authenticated', 'public.check_usernames(text[])', 'execute')
    and not has_function_privilege('anon', 'public.set_username(text)', 'execute')
    and not has_function_privilege('anon', 'public.check_usernames(text[])', 'execute')
    then E'M  grants: authenticated can execute both, anon cannot -> PASS\n'
    else E'M  grants: authenticated can execute both, anon cannot -> FAIL (run the proacl query)\n' end;

  -- T: trigger persisted the valid signup names.
  select count(*) into n from public.user_profiles
   where (id = u_a and username = name_a) or (id = u_b and username = name_b);
  out := out || case when n = 2
    then E'T  trigger: valid signup metadata persisted for A and B -> PASS\n'
    else format(E'T  trigger: valid signup metadata persisted -> matched=%s  FAIL\n', n) end;

  -- ==========================================================================
  -- As A
  -- ==========================================================================
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

  begin
    res := public.set_username(new_a);
    select username into cur from public.user_profiles where id = u_a;
    out := out || case when res = 'ok' and cur = new_a
      then E'A  A: set_username(valid new name) -> ''ok'', row updated -> PASS\n'
      else format(E'A  A: set_username(valid) -> res=%s row=%s  FAIL\n', res, cur) end;
  exception
    when others then out := out || format(E'A  A: set_username(valid) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.set_username(new_a);
    select username into cur from public.user_profiles where id = u_a;
    out := out || case when res = 'ok' and cur = new_a
      then E'A2 A: set_username(same name again) -> ''ok'' (idempotent) -> PASS\n'
      else format(E'A2 A: set_username(same again) -> res=%s row=%s  FAIL\n', res, cur) end;
  exception
    when others then out := out || format(E'A2 A: set_username(same again) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.set_username(upper(new_a));
    select username into cur from public.user_profiles where id = u_a;
    out := out || case when res = 'ok' and cur = upper(new_a)
      then E'D  A: set_username(own name re-cased) -> ''ok'', row re-cased -> PASS\n'
      else format(E'D  A: set_username(re-cased own) -> res=%s row=%s  FAIL\n', res, cur) end;
  exception
    when others then out := out || format(E'D  A: set_username(re-cased own) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  -- A's current name is now upper(new_a).

  -- ==========================================================================
  -- As B
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);

  begin
    res := public.set_username(lower(new_a));   -- A holds upper(new_a)
    select username into cur from public.user_profiles where id = u_b;
    out := out || case when res = 'taken' and cur = name_b
      then E'B  B: set_username(A''s name, other case) -> ''taken'', B unchanged -> PASS\n'
      else format(E'B  B: set_username(A''s name) -> res=%s B.row=%s  FAIL\n', res, cur) end;
  exception
    when others then out := out || format(E'B  B: set_username(A''s name) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    bad_list := '';
    foreach bad in array array[
      null, '', 'ab', repeat('a', 21), 'has space', 'ünï_name', 'x;--drop',
      'name' || chr(10), ' ' || name_b, 'dash-name'
    ] loop
      res := public.set_username(bad);
      if res is distinct from 'invalid' then
        bad_list := bad_list || format(' [%s => %s]', coalesce(quote_literal(bad), 'NULL'), res);
      end if;
    end loop;
    select username into cur from public.user_profiles where id = u_b;
    out := out || case when bad_list = '' and cur = name_b
      then E'C  B: NULL/''''/short/long/space/non-ASCII/punct/newline -> all ''invalid'', B unchanged -> PASS\n'
      else format(E'C  B: invalid inputs -> mismatches:%s B.row=%s  FAIL\n', bad_list, cur) end;
  exception
    when others then out := out || format(E'C  B: invalid inputs -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- J: taken (A's, other case) / own name available / free available /
  -- invalid / duplicate collapsed / NULL element -> one (NULL,'invalid') row.
  begin
    select string_agg(coalesce(c.username, 'NULL') || '=' || c.status, ',' order by c.ord)
      into got
      from public.check_usernames(array[
        lower(new_a), name_b, free_n, 'ab', lower(new_a), null
      ]) with ordinality as c(username, status, ord);
    if got = format('%s=taken,%s=available,%s=available,ab=invalid,NULL=invalid',
                    lower(new_a), name_b, free_n) then
      out := out || E'J  B: check_usernames statuses, duplicates collapsed, order kept -> PASS\n';
    else
      out := out || format(E'J  B: check_usernames -> %s  FAIL\n', got);
    end if;
  exception
    when others then out := out || format(E'J  B: check_usernames -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into n from public.check_usernames(
      array['aaa1','aaa2','aaa3','aaa4','aaa5','aaa6','aaa7','aaa8','aaa9','aaa10','aaa11']);
    out := out || format(E'J2 B: check_usernames with 11 candidates -> returned %s rows, no error  FAIL\n', n);
  exception
    when sqlstate '22023' then out := out || E'J2 B: check_usernames with 11 candidates -> 22023 -> PASS\n';
    when others then out := out || format(E'J2 B: check_usernames with 11 -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select (select count(*) from public.check_usernames(null))
         + (select count(*) from public.check_usernames('{}'::text[])) into n;
    out := out || case when n = 0
      then E'J3 B: check_usernames(NULL) and (''{}'') -> 0 rows -> PASS\n'
      else format(E'J3 B: check_usernames(NULL/{}) -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'J3 B: check_usernames(NULL/{}) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- G: the own-row UPDATE policy still admits the write; the CHECK refuses it.
  begin
    update public.user_profiles set username = 'bad name!' where id = u_b;
    out := out || E'G  B: direct UPDATE own username to ''bad name!'' -> accepted  FAIL\n';
  exception
    when check_violation then out := out || E'G  B: direct UPDATE own username to ''bad name!'' -> 23514 -> PASS\n';
    when others then out := out || format(E'G  B: direct UPDATE bad name -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- G2: the exact shape the clients send (supabase-js .upsert(..., {onConflict:'id'})).
  begin
    insert into public.user_profiles (id, username) values (u_b, 'x')
    on conflict (id) do update set id = excluded.id, username = excluded.username;
    out := out || E'G2 B: direct UPSERT with bad name -> accepted  FAIL\n';
  exception
    when check_violation then out := out || E'G2 B: direct UPSERT (PostgREST shape) with bad name -> 23514 -> PASS\n';
    when others then out := out || format(E'G2 B: direct UPSERT bad name -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- H: NULL stays allowed on the direct path (load-bearing for 3b-1).
  begin
    update public.user_profiles set username = null where id = u_b;
    get diagnostics n = row_count;
    out := out || case when n = 1
      then E'H  B: direct UPDATE own username to NULL -> allowed (1 row) -> PASS\n'
      else format(E'H  B: direct UPDATE own to NULL -> rows=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'H  B: direct UPDATE own to NULL -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- I: the own-row policy still refuses another user's row (silently: 0 rows).
  begin
    update public.user_profiles set username = 'fxh_' || sfx where id = u_a;
    get diagnostics n = row_count;
    select username into cur from public.user_profiles where id = u_a;
    out := out || case when n = 0 and cur = upper(new_a)
      then E'I  B: direct UPDATE of A''s row -> 0 rows, A unchanged -> PASS\n'
      else format(E'I  B: direct UPDATE of A''s row -> rows=%s A.row=%s  FAIL\n', n, cur) end;
  exception
    when others then out := out || format(E'I  B: direct UPDATE of A''s row -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ==========================================================================
  -- As anon
  -- ==========================================================================
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);

  begin
    res := public.set_username('fxe_' || sfx);
    out := out || format(E'E  anon: set_username -> returned %s  FAIL\n', res);
  exception
    when insufficient_privilege then out := out || E'E  anon: set_username -> 42501 -> PASS\n';
    when others then out := out || format(E'E  anon: set_username -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into n from public.check_usernames(array['fxe_' || sfx]);
    out := out || format(E'F  anon: check_usernames -> returned %s rows  FAIL\n', n);
  exception
    when insufficient_privilege then out := out || E'F  anon: check_usernames -> 42501 -> PASS\n';
    when others then out := out || format(E'F  anon: check_usernames -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ==========================================================================
  -- Back to the editor's privileged role
  -- ==========================================================================
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- K: invalid signup metadata -> trigger stores NULL; the CHECK must never
  -- fire inside the trigger (it would block every signup).
  begin
    insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id, raw_user_meta_data)
    values (u_k, 'fixture-k-' || u_k || '@username-write-path-test.invalid', now(), now(),
            'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
            jsonb_build_object('username', 'bad name!'));
    select count(*) into n from public.user_profiles where id = u_k and username is null;
    out := out || case when n = 1
      then E'K  trigger: invalid signup metadata still stored as NULL -> PASS\n'
      else format(E'K  trigger: invalid metadata -> null-row matches=%s  FAIL\n', n) end;
  exception
    when others then out := out || format(E'K  trigger: invalid metadata -> %s %s  FAIL (signups would break)\n', sqlstate, sqlerrm);
  end;

  -- N: no JWT at all (auth.uid() NULL) -> loud 42501, never a NULL-keyed write.
  begin
    res := public.set_username('fxz_' || sfx);
    out := out || format(E'N  no JWT: set_username -> returned %s  FAIL\n', res);
  exception
    when insufficient_privilege then out := out || E'N  no JWT (editor role): set_username -> 42501 -> PASS\n';
    when others then out := out || format(E'N  no JWT: set_username -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- Deliberate: rolls back every fixture (auth.users + trigger-created
  -- profiles + all updates above) and displays `out`.
  raise exception 'USERNAME WRITE PATH EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
