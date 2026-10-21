/**
 * Shared by the freeze suites (not a test): the Supabase role/auth simulation, the stub tables around `leagues`, the replay of
 * every `leagues` column DDL from supabase/migrations/, and CLASSIFICATION, the decision for every leagues column.
 *  - freeze_league_rules.pglite.test.ts: the freeze as of its own migration (20261104000000);
 *  - freeze_league_rules_later_guards.pglite.test.ts: the FULL chain, with the guards that came after it (20261107*, 20261110*,
 *    20261111*), and docs/security/freeze-league-rules-effect-test.sql.
 */
export const ROOT = new URL('../../', import.meta.url);

export const SCHEMA_PRE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
-- Supabase's own definition: the legacy per-claim GUC, else request.jwt.claims (what
-- PostgREST and the effect file's set_config set).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;
export const SCHEMA_POST = `
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text, joined_at timestamptz not null default clock_timestamp(),
  primary key (league_id, user_id));
create table categories (id uuid primary key default gen_random_uuid(), slug text unique, name text);
-- Stubs the pick-clock / draft-order SQL functions are validated against (as in
-- draft_order_modes.pglite.test.ts).
-- drafts is prod-only (no CREATE TABLE in the repo): the columns insertGatedPick writes. league_id's FK
-- is modelled as ON DELETE CASCADE; the effect block's F2 line reports prod's actual FK.
create table drafts (id serial primary key, league_id uuid not null references leagues(id) on delete cascade,
  user_id text, symbol text, entry_price numeric, quantity numeric, round int, pick_number int,
  slot_id uuid, created_at timestamptz default now());
create table draft_sessions (id serial primary key, league_id uuid);
create table draft_settings (id serial primary key, league_id uuid);
create table symbols (symbol text primary key, active boolean default true, is_draftable boolean not null default false,
  price_unsupported boolean not null default false, last_price numeric, market_cap numeric, gics_industry text);
create table category_rules (gics_industry text unique not null, category_id uuid not null references categories(id));
create table symbol_category_overrides (symbol text not null, category_id uuid not null references categories(id),
  unique (symbol, category_id));
`;

/**
 * Every leagues DDL statement in the migrations that shapes its COLUMNS, in
 * apply order (deferred/ is not applied, so not read). Line and block comments
 * are stripped and statements split on ';'. FK REFERENCES clauses are
 * stripped (the referenced tables are not in this replica).
 *
 * COMPLETENESS: every statement that mentions `table leagues` is either
 * replayed (CREATE TABLE, or ALTER with ADD|DROP|RENAME COLUMN) or one of the
 * known non-column forms (constraints, RLS, ALTER COLUMN defaults). Anything
 * else -- `ADD foo int` without COLUMN, a quoted "leagues", DDL inside a DO
 * block or a function body -- lands in `unhandled` and fails the
 * classification step, so the replay can never silently miss a column.
 */
export async function leaguesColumnDdl(): Promise<{ ddl: string[]; unhandled: string[] }> {
  const dir = new URL('supabase/migrations/', ROOT);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  files.sort();
  const ddl: string[] = [];
  const unhandled: string[] = [];
  const mentions = /\b(create|alter)\s+table\s+(if\s+(not\s+)?exists\s+)?(only\s+)?("?public"?\s*\.\s*)?"?leagues"?(?![\w])/i;
  const startsWith = /^(create\s+table(\s+if\s+not\s+exists)?|alter\s+table(\s+if\s+exists)?(\s+only)?)\s+(public\.)?leagues\b/i;
  const nonColumn = /^alter\s+table(\s+if\s+exists)?(\s+only)?\s+(public\.)?leagues\s+((add|drop)\s+constraint\b|(enable|disable|force|no\s+force)\s+row\s+level\s+security\b|alter\s+column\s+\w+\s+(set|drop)\s+(default|not\s+null)\b|replica\s+identity\b)/i;
  for (const f of files) {
    const sql = (await Deno.readTextFile(new URL(f, dir))).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const raw of sql.split(';')) {
      const st = raw.trim();
      if (!mentions.test(st)) continue;
      if (!startsWith.test(st)) { unhandled.push(`${f}: ${st.slice(0, 120)}`); continue; }
      if (/^create/i.test(st) || /\b(add|drop|rename)\s+column\b/i.test(st)) {
        ddl.push(st.replace(
          /\breferences\s+[\w.]+\s*(\([^)]*\))?(\s+on\s+(delete|update)\s+(set\s+null|cascade|restrict|no\s+action|set\s+default))*/gi, ''));
      } else if (!nonColumn.test(st)) {
        unhandled.push(`${f}: ${st.slice(0, 120)}`);
      }
    }
  }
  return { ddl, unhandled };
}

export const COMMISH = '11111111-1111-4111-8111-111111111111';
export const MEMBER = '22222222-2222-4222-8222-222222222222';
export const SEASON = '33333333-3333-4333-8333-333333333333';
/**
 * EVERY leagues column, classified. The 'classification' step fails when the
 * migrations add a column that is not here (or this lists one that is gone).
 *   frozen      -- trg_leagues_freeze_rules: no value change once the draft
 *                  has started (each one is exercised via FROZEN below);
 *   stamp_once  -- trg_leagues_freeze_rules: NULL -> value once (F1's carve-out);
 *   guarded     -- frozen/managed by another named guard (`by`);
 *   editable    -- deliberately writable by the commissioner after the draft.
 * F1 (20260925000000) additionally pins every column for a NON-commissioner
 * member except draft_status + the first-time date stamp, so the classes
 * below describe the COMMISSIONER's post-draft rights.
 */
export type Kind = 'frozen' | 'stamp_once' | 'guarded' | 'editable';
export const CLASSIFICATION: Record<string, { kind: Kind; by?: string; why?: string }> = {
  stake_mode: { kind: 'frozen' },
  budget_amount: { kind: 'frozen' },
  notional_per_slot: { kind: 'frozen' },
  num_rounds: { kind: 'frozen' },
  allow_undraftable: { kind: 'frozen' },
  num_weeks: { kind: 'frozen' },
  duration_days: { kind: 'frozen' },
  league_type: { kind: 'frozen' },
  num_participants: { kind: 'frozen' },
  season_status: { kind: 'frozen' },
  current_week: { kind: 'frozen' },
  current_season_id: { kind: 'frozen' },
  commissioner_id: { kind: 'frozen' },
  budget_mode: { kind: 'frozen', why: 'retired; frozen so it is not writable-but-meaningless (ruling 2026-11-04)' },
  league_start_date: { kind: 'stamp_once' },
  league_end_date: { kind: 'stamp_once' },
  draft_status: { kind: 'guarded', by: 'trg_leagues_freeze_rules', why: 'the transition table' },
  playoff_teams: { kind: 'guarded', by: 'trg_leagues_freeze_playoff_teams' },
  draft_order_mode: { kind: 'guarded', by: 'trg_leagues_order_mode' },
  pick_clock_enabled: { kind: 'guarded', by: 'trg_leagues_pick_clock' },
  draft_started_at: { kind: 'guarded', by: 'trg_leagues_pick_clock', why: 'trigger-written only' },
  pick_seconds: { kind: 'guarded', by: 'trg_leagues_pick_clock', why: 'pick_seconds_locked once started, every role' },
  id: { kind: 'guarded', by: 'FK', why: "[I2a] WITH CHECK is_commissioner(new id) is false for any new id; child FKs are ON UPDATE NO ACTION" },
  name: { kind: 'editable', why: 'ruling 2026-11-04' },
  draft_date: { kind: 'editable', why: 'ruling 2026-11-04; inert once the draft has started' },
  invite_code: { kind: 'editable', why: 'rotation is harmless: joins are gated on draft_status' },
  created_at: { kind: 'editable', why: 'display only' },
  // Run it back (20261115000000/000004): a direct client write is refused for
  // ALL three, regardless of draft_status (current_user test, not the
  // transition table), so they sit outside the frozen/stamp_once scheme.
  previous_league_id: { kind: 'guarded', by: 'trg_leagues_lineage_columns' },
  lineage_id: { kind: 'guarded', by: 'trg_leagues_lineage_columns' },
  season_number: { kind: 'guarded', by: 'trg_leagues_lineage_columns' },
};

