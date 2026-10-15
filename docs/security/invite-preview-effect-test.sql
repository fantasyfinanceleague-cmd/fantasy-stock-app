-- ============================================================================
-- INVITE-PREVIEW EFFECT TEST (Onboarding W3). Three parts, run in this order in the
-- Supabase SQL editor, each as its OWN run (the editor shows only the last result):
--
--   BEFORE the function is deployed, right after `db push` of 20261124000000_invite_preview.sql
--   and the one Vault step (see the migration header; Giorgio generates the value himself):
--       select vault.create_secret('<output of: openssl rand -hex 32>', 'invite_preview_ip_salt',
--                                  'salt for hashing client IPs in the invite-preview limiter');
--   PART 1  grants and the salt           READ-ONLY. Every row must say ok = true.
--   PART 2  the lookup and the limiter    Rolls itself back (ends by RAISING). Every line must end in PASS.
--   AFTER `supabase functions deploy invite-preview`:
--   PART 3  the HTTP half, with a forged client-IP header (curl, at the bottom of this file).
--
-- Replace <TEST_INVITE_CODE> and <EXPECTED_LEAGUE_NAME> (PART 2 only) with the code and name of any real league
-- that is still before its draft.
-- ============================================================================

-- ============================================================================
-- PART 1: READ-ONLY. One row per check; `ok` must be true on every row, and the last row says whether ALL are.
-- No value is ever selected from Vault (the salt is checked as a boolean only).
-- ============================================================================
with
tbl as (select c.oid, c.relowner, c.relrowsecurity, coalesce(c.relacl, acldefault('r', c.relowner)) as acl
          from pg_class c where c.oid = 'public.invite_preview_limits'::regclass),
bad_roles as (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
lookup as (select p.oid, p.proowner, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'invite_preview_lookup'),
salt_fn as (select p.oid, p.proowner, p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'invite_preview_ip_salt'),
lock_fn as (select p.oid, p.proowner, coalesce(p.proacl, acldefault('f', p.proowner)) as acl
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'invite_preview_try_lock'),
checks(check_name, ok, detail) as (
  select 'table: RLS on, no policies',
         (select relrowsecurity from tbl) and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invite_preview_limits'),
         'policies=' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'invite_preview_limits')
  union all
  -- relacl: NO entry for PUBLIC (grantee 0), anon, authenticated or service_role
  select 'table: no PUBLIC / anon / authenticated / service_role privilege (relacl)',
         not exists (select 1 from tbl, aclexplode(tbl.acl) a where a.grantee = 0 or a.grantee in (select oid from bad_roles)),
         coalesce((select acl::text from tbl), '(missing)')
  union all
  select 'lookup: exactly one overload', (select count(*) from lookup) = 1, 'n=' || (select count(*) from lookup)
  union all
  -- proacl: service_role CAN execute; PUBLIC, anon and authenticated CANNOT (the default grants are the trap)
  select 'lookup: service_role=X, and NO PUBLIC / anon=X / authenticated=X (proacl)',
         exists (select 1 from lookup, aclexplode(lookup.acl) a join pg_roles r on r.oid = a.grantee
                  where r.rolname = 'service_role' and a.privilege_type = 'EXECUTE')
         and not exists (select 1 from lookup, aclexplode(lookup.acl) a
                          where a.privilege_type = 'EXECUTE'
                            and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
         coalesce((select acl::text from lookup), '(missing)')
  union all
  -- the EFFECTIVE privilege (inheritance through role membership, column grants): what the roles can really do
  select 'lookup: effective privilege: anon / authenticated cannot execute, service_role can',
         not has_function_privilege('anon', (select oid from lookup), 'EXECUTE')
         and not has_function_privilege('authenticated', (select oid from lookup), 'EXECUTE')
         and has_function_privilege('service_role', (select oid from lookup), 'EXECUTE'),
         'has_function_privilege'
  union all
  select 'table: effective privilege: no client role can select / insert / update / delete / reference',
         not exists (select 1 from bad_roles r cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('REFERENCES'), ('TRIGGER'), ('TRUNCATE')) as p(priv)
                      where has_table_privilege(r.oid, (select oid from tbl), p.priv))
         and not exists (select 1 from bad_roles r, pg_attribute at
                          where at.attrelid = (select oid from tbl) and at.attnum > 0 and not at.attisdropped
                            and (has_column_privilege(r.oid, (select oid from tbl), at.attnum, 'SELECT')
                                 or has_column_privilege(r.oid, (select oid from tbl), at.attnum, 'INSERT')
                                 or has_column_privilege(r.oid, (select oid from tbl), at.attnum, 'UPDATE'))),
         'has_table_privilege / has_column_privilege'
  union all
  select 'salt helper: effective privilege: no client role (service_role included) can execute',
         (select count(*) from salt_fn) = 1
         and not exists (select 1 from bad_roles r where has_function_privilege(r.oid, (select oid from salt_fn), 'EXECUTE')),
         'has_function_privilege'
  union all
  select 'lookup: lock_timeout = 1s',
         coalesce((select proconfig::text like '%lock_timeout=1s%' from lookup), false),
         coalesce((select proconfig::text from lookup), '(missing)')
  union all
  -- OWNER: a SECURITY DEFINER function runs with its owner's rights, so the owner must be the privileged role
  -- the migration ran as (and not, say, a role someone later gave away ownership to)
  select 'functions and the limiter table are owned by postgres',
         (select pg_get_userbyid(relowner) = 'postgres' from tbl)  -- an owner bypasses RLS
         and (select count(*) from lookup) = 1 and (select count(*) from salt_fn) = 1 and (select count(*) from lock_fn) = 1
         and (select pg_get_userbyid(proowner) = 'postgres' from lookup)
         and (select pg_get_userbyid(proowner) = 'postgres' from salt_fn)
         and (select pg_get_userbyid(proowner) = 'postgres' from lock_fn),
         coalesce((select pg_get_userbyid(proowner) from lookup), '?') || ' / ' || coalesce((select pg_get_userbyid(proowner) from salt_fn), '?')
           || ' / ' || coalesce((select pg_get_userbyid(proowner) from lock_fn), '?')
  union all
  select 'lock helper: owner only (no PUBLIC / anon / authenticated / service_role can execute)',
         (select count(*) from lock_fn) = 1
         and not exists (select 1 from lock_fn, aclexplode(lock_fn.acl) a where a.grantee = 0 or a.grantee in (select oid from bad_roles))
         and not exists (select 1 from bad_roles r where has_function_privilege(r.oid, (select oid from lock_fn), 'EXECUTE')),
         coalesce((select acl::text from lock_fn), '(missing)')
  union all
  select 'lookup: SECURITY DEFINER with search_path pinned',
         coalesce((select prosecdef from lookup), false) and coalesce((select proconfig::text like '%search_path=%' from lookup), false),
         coalesce((select proconfig::text from lookup), '(missing)')
  union all
  -- the salt helper: owner only (not even service_role)
  select 'salt helper: owner only (no PUBLIC / anon / authenticated / service_role)',
         (select count(*) from salt_fn) = 1
         and not exists (select 1 from salt_fn, aclexplode(salt_fn.acl) a where a.grantee = 0 or a.grantee in (select oid from bad_roles)),
         coalesce((select acl::text from salt_fn), '(missing)')
  union all
  select 'salt helper: SECURITY DEFINER with search_path pinned',
         coalesce((select prosecdef from salt_fn), false) and coalesce((select proconfig::text like '%search_path=%' from salt_fn), false),
         coalesce((select proconfig::text from salt_fn), '(missing)')
  union all
  -- BOOLEAN ONLY: never select the secret. Without it the function fails closed (rate_limited for everyone).
  select 'vault: secret invite_preview_ip_salt exists and is >= 16 characters',
         exists (select 1 from vault.decrypted_secrets where name = 'invite_preview_ip_salt' and length(decrypted_secret) >= 16),
         'value not shown'
)
select check_name, ok, detail from (
  select check_name, ok, detail, 0 as sort_key from checks
  union all
  select 'ALL CHECKS', bool_and(ok), count(*) filter (where not ok) || ' failing', 1 from checks
) x
order by sort_key, check_name;

-- ============================================================================
-- PART 2: the lookup and the limiter. NOTHING persists: the DO block ends by RAISING, which rolls everything back
-- (including the limiter rows it creates) and prints the result table in the editor's error panel.
--
-- EXPECTED (every line ends in PASS):
--   T1  a real code -> found, the right league name, a SHORT answer (no ids)  PASS
--   T2  an unknown code -> {"status":"not_found"}                              PASS
--   T3  the 11th request from one address after 10 misses -> rate_limited,
--       even for a REAL code                                                   PASS
--   T4  the limiter stores a 64-hex salted digest, never a raw address         PASS
-- ============================================================================
do $$
declare
  c_code  constant text := '<TEST_INVITE_CODE>';
  c_name  constant text := '<EXPECTED_LEAGUE_NAME>';
  out     text := '';
  n       int;
  r       jsonb;
  i       int;
begin
  -- T1
  r := public.invite_preview_lookup(c_code, '198.51.100.1');
  out := out || format(E'T1 real code -> status=%s name=%s keys=%s  %s\n', r ->> 'status', r ->> 'name',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k),
    case when r ->> 'status' = 'found' and r ->> 'name' = c_name
          and not (r ? 'id') and not (r ? 'league_id') and not (r ? 'invite_code') and not (r ? 'commissioner_id') then 'PASS'
         when r ->> 'status' = 'rate_limited' then 'FAIL (rate_limited: is the Vault salt created? PART 1 says)'
         else 'FAIL' end);

  -- T2
  r := public.invite_preview_lookup('NOSUCHCODE9', '198.51.100.2');
  out := out || format(E'T2 unknown code -> %s  %s\n', r::text, case when r = '{"status": "not_found"}'::jsonb then 'PASS' else 'FAIL' end);

  -- T3: ten misses from one address, then the next request is refused, a real code included.
  for i in 1..10 loop
    r := public.invite_preview_lookup('MISS' || i || 'ZZZZZZ', '198.51.100.3');
  end loop;
  r := public.invite_preview_lookup(c_code, '198.51.100.3');
  out := out || format(E'T3 after 10 misses, a REAL code from that address -> %s  %s\n', r ->> 'status',
    case when r ->> 'status' = 'rate_limited' then 'PASS' else 'FAIL' end);

  -- T4
  select count(*) into n from public.invite_preview_limits where subject like 'ip:%' and subject !~ '^ip:[0-9a-f]{64}$';
  out := out || format(E'T4 limiter rows whose subject is not a 64-hex digest: %s; rows containing a raw address: %s  %s\n', n,
    (select count(*) from public.invite_preview_limits where subject like '%198.51.100.%'),
    case when n = 0 and not exists (select 1 from public.invite_preview_limits where subject like '%198.51.100.%') then 'PASS' else 'FAIL' end);

  raise exception E'\n%\n(rolled back on purpose)', out;
end;
$$;

-- ============================================================================
-- PART 3: AFTER DEPLOY. The edge function and the one thing SQL cannot see: WHICH ADDRESS THE LIMITER KEYS ON.
-- Deploy from the deploy checkout (CLAUDE.md): `supabase functions deploy invite-preview --project-ref haiaaifjcclsvmkfqgmd`;
-- the "Uploading asset" list must include respond.ts, ../_shared/web-origin.ts, ../preview-league/reason.ts and
-- ../_shared/draft-start-policy.ts. Then, from a terminal (replace URL once):
--
--   URL=https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/invite-preview
--   post() { curl -s -w ' [%{http_code}]\n' -X POST "$URL" -H 'content-type: application/json' "${@:2}" -d "{\"code\":\"$1\"}"; }
--
-- 3a  A verify_jwt true->false flip may not take on the first deploy (CLAUDE.md). With NO credential at all:
--       post NOSUCHCODE9
--     EXPECT  {"found":false} [200]       (OUR code answered)
--     NOT     {"code":401,...}            (the gateway refused: re-deploy and check the dashboard Verify-JWT toggle)
--       post <TEST_INVITE_CODE>
--     EXPECT  {"found":true,"name":"<EXPECTED_LEAGUE_NAME>","inviter":"<the commissioner's username>","reason":null} [200]
--     Reset the limiter in the SQL editor:   delete from public.invite_preview_limits;
--
-- 3b  FORGED CLIENT-IP HEADERS must NOT buy a fresh limiter bucket. From YOUR network, no header:
--       for i in 1 2 3 4 5 6 7 8 9 10; do post "MISS${i}XXXXXX"; done
--     EXPECT  ten {"found":false} [200]   (each takes about half a second: the response floor)
--       post <TEST_INVITE_CODE>
--     EXPECT  {"error":"rate_limited"} [429]      <- your real address is over its 10 misses an hour: keyed correctly
--     Now the same real code, with a forged header each time (every one is a bypass attempt):
--       post <TEST_INVITE_CODE> -H 'x-forwarded-for: 6.6.6.6'
--       post <TEST_INVITE_CODE> -H 'x-forwarded-for: 6.6.6.6, 7.7.7.7'
--       post <TEST_INVITE_CODE> -H 'cf-connecting-ip: 6.6.6.7'
--       post <TEST_INVITE_CODE> -H 'x-real-ip: 6.6.6.8'
--     EXPECT  {"error":"rate_limited"} [429] for ALL FOUR.
--     FAIL    any {"found":true,...} [200]: the limiter keyed on a value the caller chose. Do NOT go live; tell the
--             Orchestrator which header got through (respond.ts clientIp reads cf-connecting-ip, else the right-most
--             x-forwarded-for hop). The global 300 misses/hour ceiling still bounds enumeration, but the
--             per-address limits are then worthless.
--
-- 3f  The lookup is NOT callable through PostgREST by a client key. With the app's PUBLISHABLE key (public; it is in the
--     app's env as EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY), as anon:
--       curl -s -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/rest/v1/rpc/invite_preview_lookup \
--            -H "apikey: $PUBLISHABLE" -H "authorization: Bearer $PUBLISHABLE" -H 'content-type: application/json' \
--            -d '{"p_code":"NOSUCHCODE9","p_ip":"203.0.113.1"}' -w ' [%{http_code}]\n'
--     EXPECT  a permission-denied / 42501 error body [401 or 403]. FAIL: any {"status":...} body.
--     (Signed in as a real user the answer must be the same: the function is service_role only.)
--
-- 3c  The other direction: callers on DIFFERENT networks must not share a bucket. From a second network (phone data,
--     Wi-Fi off), with the first one still locked out:
--       post <TEST_INVITE_CODE>
--     EXPECT  {"found":true,...} [200].   A 429 here means the function sees only a proxy address for everyone:
--     tell the Orchestrator (every caller then shares one bucket, and 10 misses an hour locks out the whole world).
--
-- 3d  CORS:  curl -si -X OPTIONS "$URL" -H 'Origin: https://fantasy-stock-app.vercel.app' | grep -i access-control-allow-origin
--     EXPECT that origin echoed. With -H 'Origin: https://evil.vercel.app' EXPECT the web origin back, not itself.
--
-- 3e  CLEAN UP in the SQL editor:   delete from public.invite_preview_limits;
-- ============================================================================
