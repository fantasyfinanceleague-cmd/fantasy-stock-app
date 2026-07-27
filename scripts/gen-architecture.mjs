#!/usr/bin/env node
/**
 * gen-architecture.mjs — build docs/architecture/architecture.json from the repo.
 *
 * No dependencies. Node built-ins only.
 *
 *   node scripts/gen-architecture.mjs            # write architecture.json
 *   node scripts/gen-architecture.mjs --check    # exit 1 if stale, 0 if current
 *   node scripts/gen-architecture.mjs --allow-literal=<job>   # waive a redaction hit
 *
 * WHAT IS DERIVED vs MERGED
 *   Derived from files : edge functions, their local module imports, env vars, auth
 *                        guards, verify_jwt (config.toml), client/function call sites
 *                        with file:line, migration DDL.
 *   Merged from prod   : function ACLs, search_path pins, RLS policy names, cron jobs
 *                        (docs/architecture/db-snapshot.json — hand-refreshed).
 *   Merged from humans : prose (docs/architecture/annotations.json — NEVER overwritten).
 *
 * The load-bearing idea is the declared/db/drift split on Postgres nodes. Migration text
 * is a CLAIM; db-snapshot.json is REALITY. Per CLAUDE.md, `REVOKE ... FROM PUBLIC` does
 * not clear Supabase's default anon/authenticated grants and `CREATE OR REPLACE FUNCTION`
 * does not reset privileges, so a migration saying "locked down" is not evidence that a
 * function is locked down. Only proacl is. Flattening the two would launder exactly the
 * bug class this repo already shipped twice.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs/architecture');
const OUT_JSON = join(OUT_DIR, 'architecture.json');
const SNAPSHOT_JSON = join(OUT_DIR, 'db-snapshot.json');
const ANNOTATIONS_JSON = join(OUT_DIR, 'annotations.json');

const GENERATOR_VERSION = 1;
const SCHEMA_VERSION = 1;
const DB_SNAPSHOT_STALE_AFTER_DAYS = 14;

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes('--check');
const ALLOWED_LITERALS = argv
  .filter((a) => a.startsWith('--allow-literal='))
  .map((a) => a.slice('--allow-literal='.length));

// ---------------------------------------------------------------------------
// tiny fs helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.expo', 'ios', 'android', '.next']);

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split('\\').join('/');
const read = (p) => readFileSync(p, 'utf8');
const sha = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex').slice(0, 32);

/** Map a character offset to a 1-indexed line number. */
function lineAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** Run a regex over content, yielding {match, line}. */
function scan(content, re) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = rx.exec(content)) !== null) {
    out.push({ m, line: lineAt(content, m.index) });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

/** Strip SQL comments so DDL regexes don't match prose. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 1. config.toml — verify_jwt per function
// ---------------------------------------------------------------------------

function parseConfigToml() {
  const p = join(ROOT, 'supabase/config.toml');
  const out = {};
  if (!existsSync(p)) return out;
  const content = read(p);
  let current = null;
  content.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    const sec = line.match(/^\[functions\.([\w-]+)\]$/);
    if (sec) {
      current = sec[1];
      out[current] = { verifyJwt: null, enabled: null, line: i + 1 };
      return;
    }
    if (line.startsWith('[')) { current = null; return; }
    if (!current) return;
    const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kv) return;
    if (kv[1] === 'verify_jwt') out[current].verifyJwt = kv[2].trim() === 'true';
    if (kv[1] === 'enabled') out[current].enabled = kv[2].trim() === 'true';
  });
  return out;
}

// ---------------------------------------------------------------------------
// 2. Call-site scanning (the greps)
// ---------------------------------------------------------------------------

const RE_INVOKE = /supabase\s*\.\s*functions\s*\.\s*invoke\(\s*['"]([\w-]+)['"]/;
// `.rpc('name'` on any client handle (supabase, admin, sb, ...)
const RE_RPC = /\.\s*rpc\(\s*['"](\w+)['"]/;
const RE_FROM = /\.\s*from\(\s*['"](\w+)['"]\s*\)/;
const RE_ENV = /(?:Deno\.env\.get|\benv)\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/;
const RE_LOCAL_IMPORT = /from\s+['"]\.\/([\w.\-]+\.ts)['"]/;
const RE_URL = /['"`](https:\/\/([a-z0-9.\-]+)\/[^'"`\s]*)['"`]/;

/** After `.from('t')`, find the first PostgREST verb to classify the edge. */
function verbAfterFrom(content, endIndex) {
  const tail = content.slice(endIndex, endIndex + 400);
  const m = tail.match(/\.\s*(select|insert|update|upsert|delete)\b/);
  return m ? m[1] : 'select';
}

const VENDOR_HOSTS = {
  'data.alpaca.markets': { id: 'ext.alpaca-data', label: 'Alpaca Market Data', sublabel: 'data.alpaca.markets' },
  'api.alpaca.markets': { id: 'ext.alpaca-trading', label: 'Alpaca Trading', sublabel: 'api.alpaca.markets' },
  'paper-api.alpaca.markets': { id: 'ext.alpaca-trading', label: 'Alpaca Trading', sublabel: 'paper-api.alpaca.markets' },
  'finnhub.io': { id: 'ext.finnhub', label: 'Finnhub', sublabel: 'finnhub.io' },
  'www.nasdaqtrader.com': { id: 'ext.nasdaqtrader', label: 'NASDAQ Trader', sublabel: 'nasdaqtrader.com' },
};

function scanCallSites(files) {
  const invokes = [];
  const rpcs = [];
  const tableOps = [];
  const vendorCalls = [];
  for (const file of files) {
    const content = read(file);
    const r = rel(file);
    for (const { m, line } of scan(content, RE_INVOKE)) invokes.push({ file: r, line, target: m[1] });
    for (const { m, line } of scan(content, RE_RPC)) rpcs.push({ file: r, line, target: m[1] });
    for (const { m, line } of scan(content, RE_FROM)) {
      tableOps.push({ file: r, line, table: m[1], verb: verbAfterFrom(content, m.index + m[0].length) });
    }
    for (const { m, line } of scan(content, RE_URL)) {
      const vendor = VENDOR_HOSTS[m[2]];
      if (vendor) vendorCalls.push({ file: r, line, host: m[2], url: m[1] });
    }
  }
  return { invokes, rpcs, tableOps, vendorCalls };
}

// ---------------------------------------------------------------------------
// 3. Edge functions
// ---------------------------------------------------------------------------

function scanEdgeFunctions() {
  const dir = join(ROOT, 'supabase/functions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && !n.startsWith('_'))
    .sort()
    .map((name) => {
      const fnDir = join(dir, name);
      const entry = join(fnDir, 'index.ts');
      const files = readdirSync(fnDir).sort();
      const modules = files.filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'));
      const tests = files.filter((f) => f.endsWith('.test.ts'));
      let imports = [], envVars = [], serveLine = null, lines = 0, authGuard = null;
      if (existsSync(entry)) {
        const content = read(entry);
        lines = content.split('\n').length;
        imports = [...new Set(scan(content, RE_LOCAL_IMPORT).map(({ m }) => m[1]))].sort();
        envVars = [...new Set(scan(content, RE_ENV).map(({ m }) => m[1]))].sort();
        const serve = scan(content, /Deno\.serve\(/)[0];
        serveLine = serve ? serve.line : null;
        if (/constantTimeEqual|timingSafeEqual/.test(content) && /SB_SECRET_KEY_CRON/.test(content)) {
          authGuard = 'apikey header, constant-time, fail-closed';
        } else if (/isAuthorized/.test(content)) {
          authGuard = 'in-code guard (isAuthorized)';
        }
      }
      return { name, entry: existsSync(entry) ? rel(entry) : null, serveLine, lines, modules, tests, imports, envVars, authGuard };
    });
}

// ---------------------------------------------------------------------------
// 4. Migrations
// ---------------------------------------------------------------------------

function scanMigrations() {
  const dir = join(ROOT, 'supabase/migrations');
  if (!existsSync(dir)) return { files: [], tables: {}, functions: {}, policies: {}, rlsEnabled: new Set(), cron: {} };
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const tables = {};
  const functions = {};
  const policies = {};
  const rlsEnabled = new Set();
  const cron = {};

  const touch = (bag, key, file, line) => {
    (bag[key] ||= { definedIn: [], firstSeen: null }).definedIn.push({ file, line });
    bag[key].firstSeen ||= file;
  };

  for (const f of files) {
    const raw = read(join(dir, f));
    const sql = stripSqlComments(raw);
    const r = `supabase/migrations/${f}`;
    for (const { m, line } of scan(sql, /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i))
      touch(tables, m[1].toLowerCase(), r, line);
    for (const { m, line } of scan(sql, /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i))
      touch(tables, m[1].toLowerCase(), r, line);
    for (const { m, line } of scan(sql, /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/i))
      touch(functions, m[1].toLowerCase(), r, line);
    for (const { m } of scan(sql, /alter\s+table\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/i))
      rlsEnabled.add(m[1].toLowerCase());
    for (const { m, line } of scan(sql, /create\s+policy\s+"?([^"\n]+?)"?\s+on\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i))
      touch(policies, `${m[2].toLowerCase()}::${m[1].trim()}`, r, line);
    for (const { m, line } of scan(sql, /cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/i))
      (cron[m[1]] ||= []).push({ file: r, line, schedule: m[2] });
  }
  return { files, tables, functions, policies, rlsEnabled, cron };
}

// ---------------------------------------------------------------------------
// 5. db-snapshot.json
// ---------------------------------------------------------------------------

const KEY_SHAPED = [
  { name: 'sb_key', re: /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/ },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'redaction_marker', re: /\[REDACTED:(\w+)\]/ },
];

function loadSnapshot() {
  if (!existsSync(SNAPSHOT_JSON)) {
    return { present: false, raw: '', data: null, hash: sha('') };
  }
  const raw = read(SNAPSHOT_JSON);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`db-snapshot.json is not valid JSON: ${e.message}\n` +
         `A truncated copy-paste is the usual cause. Re-run docs/architecture/db-snapshot.sql\n` +
         `and copy the ENTIRE db_snapshot cell.`);
  }

  // Independent re-scan for key-shaped literals in cron commands.
  for (const [i, job] of (data.cronJobs || []).entries()) {
    for (const pat of KEY_SHAPED) {
      const hit = pat.re.exec(job.command || '');
      if (!hit) continue;
      if (ALLOWED_LITERALS.includes(job.jobname)) continue;
      fail(
        `REFUSING TO BUILD — found a key-shaped literal in cron.job.command.\n\n` +
        `  job:     ${job.jobname}\n` +
        `  field:   cronJobs[${i}].command\n` +
        `  matched: ${hit[0].slice(0, 12)}… (${hit[0].length} chars, position ${hit.index})\n\n` +
        `A cron job is carrying an inlined key instead of reading it from\n` +
        `vault.decrypted_secrets. Per CLAUDE.md, exposure requires rotation.\n\n` +
        `DO THIS, IN ORDER:\n` +
        `  1. ROTATE that key now. It is in a DB catalog and may already be in\n` +
        `     this file's git history.\n` +
        `  2. Reschedule the job to read the new key from vault:\n` +
        `       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '<secret>')\n` +
        `  3. Re-run docs/architecture/db-snapshot.sql and replace db-snapshot.json.\n` +
        `  4. Re-run: node scripts/gen-architecture.mjs\n\n` +
        `Do NOT delete the match from db-snapshot.json to get past this check —\n` +
        `that hides the exposure without rotating the key.\n\n` +
        `If this is a false positive (a long quoted identifier, not a key), waive it with:\n` +
        `  node scripts/gen-architecture.mjs --allow-literal=${job.jobname}`
      );
    }
  }
  return { present: true, raw, data, hash: sha(raw) };
}

/** Parse a proacl entry like "anon=X/postgres" -> {role, privileges}. "=X/postgres" is PUBLIC. */
function parseAcl(entry) {
  const m = /^([^=]*)=([a-zA-Z*]*)\//.exec(entry);
  if (!m) return null;
  const role = m[1] === '' ? 'PUBLIC' : m[1];
  const privileges = m[2].includes('X') ? ['EXECUTE'] : [];
  return { role, privileges };
}

function fail(msg) {
  console.error('\n' + msg + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 6. Flow definitions (curated; edges + anchors are resolved and verified)
// ---------------------------------------------------------------------------
//
// Flows are the one hand-authored part of the graph — which paths matter is a human
// judgement, not something the filesystem knows. But they are NOT hand-maintained
// line numbers, which would rot on the first refactor. Each step cites an EDGE id
// (validated against the generated edge set) and optional ANCHORS: a file plus a
// literal source substring the generator locates at build time to produce a live
// file:line. An anchor that stops matching becomes an `unverified` entry rather than
// a stale citation, so the map degrades loudly instead of lying quietly.

const FLOWS = [
  {
    id: 'flow.join-by-code',
    title: 'Join a league by code',
    trigger: { kind: 'user', detail: 'User enters an invite code on the mobile join screen' },
    steps: [
      { edge: 'e.ui.join-league->fn.preview-league', detail: 'Screen posts the code for a display-only preview. Rate-limited per-user and per-IP.', anchors: [['apps/mobile/app/join-league.tsx', "invoke('preview-league'"]] },
      { edge: 'e.fn.preview-league->pg.check_and_bump_rate_limit', detail: 'Per-user and per-IP buckets. Fail-open by design — a limiter outage must not block joins.', anchors: [['supabase/functions/preview-league/index.ts', 'check_and_bump_rate_limit']] },
      { edge: 'e.ui.join-league->fn.join-league', detail: 'On confirm, the join is performed server-side. verify_jwt=true, so the caller identity is the gateway-verified JWT.', anchors: [['apps/mobile/app/join-league.tsx', "invoke('join-league'"]] },
      { edge: 'e.fn.join-league->pg.check_and_bump_rate_limit', detail: 'Same two buckets on the mutating path.', anchors: [['supabase/functions/join-league/index.ts', 'check_and_bump_rate_limit']] },
      { edge: 'e.fn.join-league->pg.join_league_by_code', detail: 'Atomic membership insert + invite accept. p_user_id comes from the verified JWT, never the request body.', anchors: [['supabase/functions/join-league/index.ts', "rpc('join_league_by_code'"]] },
    ],
  },
  {
    id: 'flow.weekly-scoring',
    title: 'Weekly scoring',
    trigger: { kind: 'cron', detail: 'pg_cron `process-weekly-matchups` — Friday 21:15 UTC', cronJob: 'process-weekly-matchups' },
    steps: [
      { edge: 'e.cron.process-weekly-matchups->fn.process-week-results', detail: 'net.http_post with an apikey header read from vault secret `cron_apikey`.' },
      { edge: 'e.fn.process-week-results->tbl.cron_job_status#upsert', detail: 'Job marked running before any work.', anchors: [['supabase/functions/process-week-results/index.ts', "updateJobStatus(supabase, JOB_NAME, 'running'"]] },
      { edge: 'e.fn.process-week-results->tbl.matchups', detail: 'Pending matchups: team1_gain IS NULL, week_end in the past, league_type=matchup. The NULL filter is what makes a re-run idempotent.', anchors: [['supabase/functions/process-week-results/index.ts', ".is('team1_gain', null)"]] },
      { edge: 'e.fn.process-week-results->mod.process-week-results/grouping', detail: 'One batch per (league_id, week_number), sorted week-ascending. Grouping by league alone was the original bug; the sort is load-bearing for week advancement.', anchors: [['supabase/functions/process-week-results/index.ts', 'groupMatchupsByLeagueWeek(pendingMatchups)'], ['supabase/functions/process-week-results/grouping.ts', 'export function groupMatchupsByLeagueWeek']] },
      { edge: 'e.fn.process-week-results->tbl.week_snapshots', detail: 'Per batch. Presence of any row sets hasSnapshots; any week_end_price sets hasWeekEndPrices.', anchors: [['supabase/functions/process-week-results/index.ts', "week_start_price, week_end_price"]] },
      { edge: 'e.fn.process-week-results->mod.process-week-results/scoring-eligibility', detail: 'GUARDS 1 & 2 — decideBatchScoring. A snapshot-less batch is skipped whole: stale_no_snapshots (>72h) or no_snapshots_week_gt_1. Freshness is checked first, and that order is load-bearing for ops labelling.', anchors: [['supabase/functions/process-week-results/index.ts', 'decideBatchScoring({'], ['supabase/functions/process-week-results/scoring-eligibility.ts', 'export function decideBatchScoring']] },
      { edge: 'e.fn.process-week-results->tbl.trades', detail: 'Mid-week trades inside [weekStart, weekEnd], then a second read bounded to week_end so a post-week sale cannot empty holdings and flip a win to an auto-loss.', anchors: [['supabase/functions/process-week-results/index.ts', '.gte(\'created_at\', weekStart)']] },
      { edge: 'e.fn.process-week-results->tbl.drafts', detail: 'Fallback scorer input — only reachable at week 1.', anchors: [['supabase/functions/process-week-results/index.ts', "from('drafts')"]] },
      { edge: 'e.fn.process-week-results->ext.alpaca-data', detail: 'Latest quotes, IEX feed. Failures are swallowed into an empty price map rather than throwing.', anchors: [['supabase/functions/process-week-results/index.ts', 'stocks/quotes/latest']] },
      { edge: 'e.fn.process-week-results->mod.process-week-results/scoring-eligibility#user', detail: 'GUARD 3a — decideUserScorer picks full | legacy | fallback | unscoreable per user. A snapshot-less user past week 1 is unscoreable: cumulative-from-entry is all-time P/L, not a weekly delta.', anchors: [['supabase/functions/process-week-results/index.ts', 'decideUserScorer({'], ['supabase/functions/process-week-results/scoring-eligibility.ts', 'export function decideUserScorer']] },
      { edge: 'e.fn.process-week-results->mod.process-week-results/scoring-eligibility#matchup', detail: 'GUARD 3b — decideMatchupScoring refuses any matchup containing an unscoreable participant. Byes gate on team1 only. Refused matchups keep team1_gain NULL and stay pending.', anchors: [['supabase/functions/process-week-results/index.ts', 'decideMatchupScoring('], ['supabase/functions/process-week-results/scoring-eligibility.ts', 'export function decideMatchupScoring']] },
      { edge: 'e.fn.process-week-results->tbl.matchups#update', detail: 'Winner written: bye = auto-win, empty portfolio = auto-loss, else dollar gain, tiebreak percent then playoff seed.', anchors: [['supabase/functions/process-week-results/index.ts', 'winner_user_id: winnerId']] },
      { edge: 'e.fn.process-week-results->tbl.league_standings#update', detail: 'Read-then-increment, not transactional and NOT reversible. This irreversibility is the entire reason guards 1-3 refuse rather than fabricate.', anchors: [['supabase/functions/process-week-results/index.ts', 'wins: Number(existing.wins) + winsIncrement']] },
      { edge: 'e.fn.process-week-results->tbl.leagues#update', detail: 'current_week re-read per batch and advanced only when the batch IS the current week — so a guard-skipped week blocks advancement instead of being stepped over.', anchors: [['supabase/functions/process-week-results/index.ts', 'weekNumber === currentWeek']] },
      { edge: 'e.fn.process-week-results->pg.complete_league_season', detail: 'Season end, from playoffs finals or from standings when playoff_teams = 0.', anchors: [['supabase/functions/process-week-results/index.ts', "rpc('complete_league_season'"]] },
    ],
  },
  {
    id: 'flow.week-start-snapshot',
    title: 'Week-start snapshot',
    trigger: { kind: 'cron', detail: 'pg_cron `snapshot-week-start` — Mon+Tue 14:35 UTC', cronJob: 'snapshot-week-start' },
    steps: [
      { edge: 'e.cron.snapshot-week-start->fn.snapshot-week-start', detail: 'net.http_post with apikey from vault `cron_apikey`.' },
      { edge: 'e.fn.snapshot-week-start->mod.snapshot-week-start/plan', detail: 'Pure planning module — decides which league-weeks need snapshotting and what to fetch.', anchors: [['supabase/functions/snapshot-week-start/plan.ts', 'export function']] },
      { edge: 'e.fn.snapshot-week-start->ext.alpaca-data', detail: 'Historical bars for week-start prices.', anchors: [['supabase/functions/snapshot-week-start/index.ts', 'alpaca']] },
      { edge: 'e.fn.snapshot-week-start->tbl.week_snapshots#insert', detail: 'ALL-OR-NOTHING per league-week with completeness-based skip (fixed in 2caf9f8). A partial price fetch writes nothing rather than a half-week.', anchors: [['supabase/functions/snapshot-week-start/index.ts', "from('week_snapshots')"]] },
      { edge: 'e.fn.snapshot-week-start->pg.schedule_snapshot_retry', detail: 'Retry scheduling, shared with snapshot-week-end.', anchors: [['supabase/functions/snapshot-week-start/index.ts', "rpc('schedule_snapshot_retry'"]] },
    ],
  },
  {
    id: 'flow.week-end-snapshot',
    title: 'Week-end snapshot',
    trigger: { kind: 'cron', detail: 'pg_cron `snapshot-week-end` — Friday 21:05 UTC, 10 min before scoring', cronJob: 'snapshot-week-end' },
    steps: [
      { edge: 'e.cron.snapshot-week-end->fn.snapshot-week-end', detail: 'net.http_post with apikey from vault `cron_apikey`. Runs 10 minutes before process-weekly-matchups — that gap is the entire budget for writing week_end_price before scoring reads it.' },
      { edge: 'e.fn.snapshot-week-end->ext.alpaca-data', detail: 'Friday close prices.', anchors: [['supabase/functions/snapshot-week-end/index.ts', 'alpaca']] },
      { edge: 'e.fn.snapshot-week-end->tbl.week_snapshots#update', detail: 'Writes week_end_price onto existing rows. NOTE: unlike snapshot-week-start this has no extracted plan module and no unit tests — see the comparison annotation.', anchors: [['supabase/functions/snapshot-week-end/index.ts', "from('week_snapshots')"]] },
      { edge: 'e.fn.snapshot-week-end->pg.schedule_snapshot_retry', detail: 'Shared retry path.', anchors: [['supabase/functions/snapshot-week-end/index.ts', "rpc('schedule_snapshot_retry'"]] },
    ],
  },
  {
    id: 'flow.place-trade',
    title: 'Place a trade',
    trigger: { kind: 'user', detail: 'User confirms a buy or sell in TradeModal' },
    steps: [
      { edge: 'e.ui.TradeModal->fn.quote', detail: 'Live quote for the symbol before confirming.', anchors: [['apps/mobile/components/TradeModal.tsx', "invoke('quote'"]] },
      { edge: 'e.ui.TradeModal->fn.place-order', detail: 'Order submitted server-side so broker credentials never reach the client.', anchors: [['apps/mobile/components/TradeModal.tsx', 'place-order']] },
      { edge: 'e.fn.place-order->tbl.broker_credentials', detail: 'Per-user Alpaca keys read server-side.', anchors: [['supabase/functions/place-order/index.ts', "from('broker_credentials')"]] },
      { edge: 'e.fn.place-order->ext.alpaca-trading', detail: 'Order placed against the user\'s own Alpaca account. place-order does NOT touch the trades table — it returns the Alpaca order to the client.', anchors: [['supabase/functions/place-order/index.ts', 'alpaca']] },
      { edge: 'e.ui.TradeModal->tbl.trades#insert', detail: 'The trade row is written by the CLIENT after place-order returns — not server-side. So the DB record and the real Alpaca order are committed by two different actors with no transaction between them: if the app dies in this gap the order exists at the broker and not in the DB. That gap is why order reconciliation exists.', anchors: [['apps/mobile/components/TradeModal.tsx', "from('trades').insert("]] },
    ],
  },
  {
    id: 'flow.order-reconciliation',
    title: 'Order reconciliation',
    trigger: { kind: 'cron', detail: 'pg_cron `sync-alpaca-orders` — weekdays 21:30 UTC', cronJob: 'sync-alpaca-orders' },
    steps: [
      { edge: 'e.cron.sync-alpaca-orders->fn.sync-alpaca-orders', detail: 'net.http_post with apikey from vault, body {"mode":"sync-all"}. This function was a verify_jwt true->false FLIP — its in-code apikey guard is now its ONLY protection.' },
      { edge: 'e.fn.sync-alpaca-orders->tbl.broker_credentials', detail: 'Per-user keys to query each account.', anchors: [['supabase/functions/sync-alpaca-orders/index.ts', "from('broker_credentials')"]] },
      { edge: 'e.fn.sync-alpaca-orders->ext.alpaca-trading', detail: 'Fetch fills and order status.', anchors: [['supabase/functions/sync-alpaca-orders/index.ts', 'alpaca']] },
      { edge: 'e.fn.sync-alpaca-orders->tbl.trades#update', detail: 'Reconcile recorded trades against actual fills — closes the loop on Place a trade.', anchors: [['supabase/functions/sync-alpaca-orders/index.ts', "from('trades')"]] },
    ],
  },
  {
    id: 'flow.draft-stock',
    title: 'Draft a stock',
    trigger: { kind: 'user', detail: 'User makes a pick on the draft screen' },
    steps: [
      { edge: 'e.ui.draft->fn.quote', detail: 'Price lookup for the pick.', anchors: [['apps/mobile/app/(tabs)/draft.tsx', "invoke('quote'"]] },
      { edge: 'e.ui.draft->tbl.drafts#insert', detail: 'Pick written directly from the client under RLS — no edge function in this path.', anchors: [['apps/mobile/app/(tabs)/draft.tsx', "from('drafts')"]] },
    ],
  },
  {
    id: 'flow.season-reset',
    title: 'Season reset',
    trigger: { kind: 'user', detail: 'Commissioner taps reset in league settings' },
    steps: [
      { edge: 'e.ui.league-settings->pg.start_new_league_season', detail: 'Called directly from the client as an authenticated user. EXECUTE is granted to `authenticated`, so the authorization is NOT the grant — it is an INTERNAL commissioner check inside the function body. That gate is the only thing standing between any league member and a destructive season reset.', anchors: [['apps/mobile/app/league-settings.tsx', "rpc('start_new_league_season'"]] },
    ],
  },
  {
    id: 'flow.quote-fanout',
    title: 'Quote / symbol fan-out',
    trigger: { kind: 'user', detail: 'Any screen needing prices, names, or search' },
    steps: [
      { edge: 'e.fanout.quote', detail: 'quote — single-symbol live price. The most-invoked function in the app.' },
      { edge: 'e.fanout.ticker-quotes', detail: 'ticker-quotes — batch prices for the ticker strip.' },
      { edge: 'e.fanout.symbol-name', detail: 'symbol-name — display name resolution.' },
      { edge: 'e.fanout.symbols-search', detail: 'symbols-search — typeahead over the symbols table.' },
      { edge: 'e.fanout.historical-bars', detail: 'historical-bars — chart series for portfolio P/L.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 7. Build
// ---------------------------------------------------------------------------

const LAYERS = [
  { id: 'trigger', label: 'Triggers', order: 0 },
  { id: 'client', label: 'Client', order: 1 },
  { id: 'edge', label: 'Edge functions', order: 2 },
  { id: 'module', label: 'Pure modules', order: 3 },
  { id: 'db', label: 'Postgres', order: 4 },
  { id: 'external', label: 'External', order: 5 },
];

const LAYER_OF = {
  'cron-job': 'trigger',
  'client-screen': 'client', 'client-hook': 'client', 'client-component': 'client',
  'edge-function': 'edge',
  'edge-module': 'module',
  'pg-function': 'db', 'table': 'db',
  'external': 'external',
};

function clientKind(file) {
  if (/\/components\//.test(file)) return 'client-component';
  if (/\/lib\/use|\/hooks\//.test(file)) return 'client-hook';
  return 'client-screen';
}

function clientNodeId(file) {
  const base = file.replace(/^apps\/(mobile|web)\//, '').replace(/\.(tsx|ts)$/, '');
  return 'ui.' + base.replace(/^app\//, '').replace(/^\(tabs\)\//, '').replace(/^components\//, '').replace(/^lib\//, '').replace(/\//g, '.');
}

function build() {
  const config = parseConfigToml();
  const edgeFns = scanEdgeFunctions();
  const migrations = scanMigrations();
  const snapshot = loadSnapshot();

  const clientFiles = [...walk(join(ROOT, 'apps/mobile'), ['.ts', '.tsx']), ...walk(join(ROOT, 'apps/web'), ['.ts', '.tsx', '.jsx'])].sort();
  const fnFiles = walk(join(ROOT, 'supabase/functions'), ['.ts']).filter((f) => !f.endsWith('.test.ts')).sort();

  const clientSites = scanCallSites(clientFiles);
  const fnSites = scanCallSites(fnFiles);

  const nodes = new Map();
  const edges = new Map();
  const unverified = [];

  const addNode = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, { layer: LAYER_OF[n.kind], facts: {}, db: null, declared: null, drift: [], annotation: null, verified: true, ...n }); return nodes.get(n.id); };
  const addEdge = (e) => {
    const existing = edges.get(e.id);
    if (existing) { existing.callSites = [...new Set([...existing.callSites, ...e.callSites])].sort(); return existing; }
    edges.set(e.id, { annotation: null, verified: true, ...e });
    return edges.get(e.id);
  };

  // --- edge function nodes ---
  for (const fn of edgeFns) {
    const cfg = config[fn.name] || {};
    const verifyJwt = cfg.verifyJwt;
    const sub = [];
    if (verifyJwt === false) sub.push('verify_jwt=false');
    else if (verifyJwt === true) sub.push('verify_jwt=true');
    else sub.push('verify_jwt unset');
    if (fn.authGuard) sub.push('apikey guard');
    addNode({
      id: `fn.${fn.name}`, label: fn.name, sublabel: sub.join(' · '), kind: 'edge-function',
      source: fn.entry ? { path: fn.entry, line: fn.serveLine || 1 } : null,
      facts: {
        verifyJwt, verifyJwtSource: cfg.line ? `supabase/config.toml:${cfg.line}` : null,
        authGuard: fn.authGuard, localModules: fn.modules, tests: fn.tests,
        envVars: fn.envVars, lines: fn.lines,
      },
    });
    if (verifyJwt === null || verifyJwt === undefined) {
      unverified.push({ scope: `fn.${fn.name}`, claim: 'JWT verification setting', reason: 'No [functions.' + fn.name + '] block in supabase/config.toml, so the platform default applies and the repo does not record it.', resolve: 'Check the function\'s Verify-JWT toggle in the Supabase dashboard.' });
      nodes.get(`fn.${fn.name}`).verified = false;
    }
    for (const mod of fn.imports) {
      const modId = `mod.${fn.name}/${mod.replace(/\.ts$/, '')}`;
      addNode({ id: modId, label: mod, sublabel: fn.name, kind: 'edge-module',
        source: { path: `supabase/functions/${fn.name}/${mod}`, line: 1 },
        facts: { hasTests: fn.tests.includes(mod.replace(/\.ts$/, '.test.ts')) } });
      addEdge({ id: `e.fn.${fn.name}->${modId}`, from: `fn.${fn.name}`, to: modId, protocol: 'esm-import',
        payload: `import from './${mod}'`, callSites: [`supabase/functions/${fn.name}/index.ts`] });
    }
  }

  // --- cron nodes from the snapshot (authoritative) ---
  const snapCron = snapshot.data?.cronJobs || [];
  for (const job of snapCron) {
    const urlMatch = /functions\/v1\/([\w-]+)/.exec(job.command || '');
    const target = urlMatch ? urlMatch[1] : null;
    const hasApikey = /apikey/.test(job.command || '');
    addNode({
      id: `cron.${job.jobname}`, label: job.jobname, sublabel: job.schedule, kind: 'cron-job',
      source: migrations.cron[job.jobname]?.[0] ? { path: migrations.cron[job.jobname].at(-1).file, line: migrations.cron[job.jobname].at(-1).line } : null,
      facts: { schedule: job.schedule, active: job.active, username: job.username, target, sendsApikey: hasApikey },
      declared: migrations.cron[job.jobname] ? { schedule: migrations.cron[job.jobname].at(-1).schedule, definedIn: migrations.cron[job.jobname].map((c) => `${c.file}:${c.line}`) } : null,
    });
    const node = nodes.get(`cron.${job.jobname}`);
    if (node.declared && node.declared.schedule !== job.schedule) {
      node.drift.push({ field: 'schedule', declared: node.declared.schedule, live: job.schedule, severity: 'high',
        note: 'The live cron schedule differs from the latest migration that scheduled this job.' });
    }
    if (!node.declared) {
      node.drift.push({ field: 'origin', declared: '(not scheduled by any migration)', live: `active, ${job.schedule}`, severity: 'medium',
        note: 'This job exists in prod but no migration in supabase/migrations/ schedules it by this name. It was created out-of-band and is not reproducible from the repo.' });
    }
    if (target) {
      const fnNode = nodes.get(`fn.${target}`);
      addEdge({ id: `e.cron.${job.jobname}->fn.${target}`, from: `cron.${job.jobname}`, to: `fn.${target}`, protocol: 'pg-net-http',
        payload: hasApikey ? 'net.http_post · apikey from vault cron_apikey' : 'net.http_post · NO auth header',
        callSites: node.source ? [`${node.source.path}:${node.source.line}`] : [] });
      // The finding that only the snapshot can surface: cron auth vs gateway policy.
      if (!hasApikey && fnNode?.facts.verifyJwt === true) {
        node.drift.push({ field: 'auth', declared: `${target} requires a JWT (config.toml verify_jwt=true)`, live: 'cron job sends no Authorization or apikey header', severity: 'high',
          note: 'This job cannot be authenticating. The gateway rejects a header-less POST when verify_jwt=true, so every run 401s before reaching the function.' });
        // NOTE: do NOT suggest cron.job_run_details here. net.http_post is async — it
        // enqueues and returns a request id, so the job reports 'succeeded' even when
        // the HTTP call 401s. The response lands in net._http_response instead.
        unverified.push({ scope: `cron.${job.jobname}`, claim: 'this job succeeds', reason: 'Job sends no auth header but its target declares verify_jwt=true, so runs should be 401ing at the gateway. cron.job_run_details will still say succeeded: net.http_post is asynchronous, so the job status reflects the enqueue, not the HTTP response.', resolve: 'SELECT id, status_code, error_msg, created FROM net._http_response ORDER BY created DESC LIMIT 30;  -- and confirm the target table has actually changed recently; net._http_response prunes on a ~6h TTL' });
      }
      if (!hasApikey && fnNode?.facts.verifyJwt === false && !fnNode?.facts.authGuard) {
        node.drift.push({ field: 'auth', declared: `${target} has verify_jwt=false and no in-code guard`, live: 'cron job sends no auth header', severity: 'high',
          note: 'Function is reachable unauthenticated by anyone.' });
      }
    }
  }

  // --- client + function call sites ---
  const addCallSiteEdges = (sites, originFor) => {
    for (const s of sites.invokes) {
      const from = originFor(s.file);
      if (!from) continue;
      addEdge({ id: `e.${from}->fn.${s.target}`, from, to: `fn.${s.target}`, protocol: 'https-invoke',
        payload: `functions.invoke('${s.target}')`, callSites: [`${s.file}:${s.line}`] });
      if (!nodes.has(`fn.${s.target}`)) {
        unverified.push({ scope: `e.${from}->fn.${s.target}`, claim: `edge function '${s.target}' exists`, reason: 'Invoked from code but no supabase/functions/' + s.target + '/ directory.', resolve: 'Check for a renamed or deleted function.' });
        addNode({ id: `fn.${s.target}`, label: s.target, sublabel: 'MISSING', kind: 'edge-function', source: null, verified: false });
      }
    }
    for (const s of sites.rpcs) {
      const from = originFor(s.file);
      if (!from) continue;
      addEdge({ id: `e.${from}->pg.${s.target}`, from, to: `pg.${s.target}`, protocol: 'postgrest-rpc',
        payload: `rpc('${s.target}')`, callSites: [`${s.file}:${s.line}`] });
    }
    for (const s of sites.tableOps) {
      const from = originFor(s.file);
      if (!from) continue;
      // One edge PER VERB, not one lumped #write edge. An insert and an update to the
      // same table are different architectural facts (and different blast radii), and
      // collapsing them would silently label a table "written" by whichever verb the
      // scanner happened to hit first.
      const suffix = s.verb === 'select' ? '' : `#${s.verb}`;
      addEdge({ id: `e.${from}->tbl.${s.table}${suffix}`, from, to: `tbl.${s.table}`, protocol: `postgrest-${s.verb}`,
        payload: `.from('${s.table}').${s.verb}()`, callSites: [`${s.file}:${s.line}`] });
    }
    for (const s of sites.vendorCalls) {
      const from = originFor(s.file);
      if (!from) continue;
      const vendor = VENDOR_HOSTS[s.host];
      addNode({ id: vendor.id, label: vendor.label, sublabel: vendor.sublabel, kind: 'external', source: null });
      addEdge({ id: `e.${from}->${vendor.id}`, from, to: vendor.id, protocol: 'vendor-https',
        payload: s.url.replace(/\?.*$/, ''), callSites: [`${s.file}:${s.line}`] });
    }
  };

  // client origins
  const clientOrigin = (file) => {
    const id = clientNodeId(file);
    if (!nodes.has(id)) addNode({ id, label: file.split('/').pop(), sublabel: file.replace(/^apps\//, ''), kind: clientKind(file), source: { path: file, line: 1 } });
    return id;
  };
  addCallSiteEdges(clientSites, clientOrigin);

  // function origins
  const fnOrigin = (file) => {
    const m = /^supabase\/functions\/([\w-]+)\//.exec(file);
    return m && nodes.has(`fn.${m[1]}`) ? `fn.${m[1]}` : null;
  };
  addCallSiteEdges(fnSites, fnOrigin);

  // --- Postgres nodes: declared (migrations) + db (snapshot) + drift ---
  const snapFns = new Map((snapshot.data?.functions || []).map((f) => [f.name, f]));
  const snapTables = new Map((snapshot.data?.tables || []).map((t) => [t.name, t]));

  const allFnNames = new Set([...Object.keys(migrations.functions), ...snapFns.keys()]);
  for (const name of allFnNames) {
    const decl = migrations.functions[name];
    const live = snapFns.get(name);
    const id = `pg.${name}`;
    const grants = live?.acl ? live.acl.map(parseAcl).filter(Boolean).filter((g) => g.privileges.length) : null;
    const anonCallable = grants ? grants.some((g) => g.role === 'anon' || g.role === 'PUBLIC') : null;
    const authCallable = grants ? grants.some((g) => g.role === 'authenticated') : null;
    const sub = [];
    if (live?.securityDefiner) sub.push('SECURITY DEFINER');
    if (grants) sub.push(grants.filter((g) => !['postgres'].includes(g.role)).map((g) => g.role).join(', ') || 'owner only');
    addNode({
      id, label: live ? `${name}(${live.args})` : `${name}()`, sublabel: sub.join(' · ') || 'not in snapshot', kind: 'pg-function',
      source: decl ? { path: decl.definedIn.at(-1).file, line: decl.definedIn.at(-1).line } : null,
      declared: decl ? { definedIn: decl.definedIn.map((d) => `${d.file}:${d.line}`), latestDefinition: decl.definedIn.at(-1).file, redefinitions: decl.definedIn.length } : null,
      db: live ? { securityDefiner: live.securityDefiner, searchPath: live.searchPath, grants, grantsRaw: live.acl, anonCallable, authenticatedCallable: authCallable, owner: live.owner, volatility: live.volatility } : null,
      verified: !!live,
    });
    const node = nodes.get(id);
    if (!live) {
      node.drift.push({ field: 'existence', declared: 'created by migration', live: 'ABSENT from prod snapshot', severity: 'high',
        note: 'A migration creates this function but it is not in the live catalog. Either the migration was never pushed, or it was later dropped.' });
      unverified.push({ scope: id, claim: 'function exists in prod', reason: 'Present in migrations, absent from db-snapshot.json.', resolve: 'Re-capture the snapshot, or confirm the migration was applied.' });
    } else {
      if (live.securityDefiner && !live.searchPath) {
        node.drift.push({ field: 'search_path', declared: 'n/a', live: 'UNPINNED', severity: 'high',
          note: 'SECURITY DEFINER without a pinned search_path resolves unqualified names using the CALLER\'s path — the classic definer privilege-escalation footgun.' });
      }
      if (live.securityDefiner && anonCallable) {
        node.drift.push({ field: 'grants', declared: decl ? 'lockdown migrations exist for this function' : 'n/a', live: live.acl.filter((a) => a.startsWith('anon=') || a.startsWith('=')).join(', '), severity: 'high',
          note: 'SECURITY DEFINER function is callable by anon/PUBLIC. Per CLAUDE.md, REVOKE FROM PUBLIC does not clear Supabase\'s default anon grant — an explicit REVOKE ... FROM anon is required.' });
      }
      if (!live.securityDefiner && (anonCallable || authCallable)) {
        node.drift.push({ field: 'grants', declared: 'n/a', live: live.acl.join(', '), severity: 'low',
          note: 'SECURITY INVOKER, so it runs with the caller\'s own privileges and RLS applies — broad EXECUTE here is low risk. Listed for inventory completeness.' });
      }
      if (!decl) {
        node.drift.push({ field: 'origin', declared: '(no migration creates this)', live: 'exists in prod', severity: 'medium',
          note: 'Function exists in prod but no migration in the repo creates it — not reproducible from a fresh db push.' });
      }
    }
  }

  const allTableNames = new Set([...Object.keys(migrations.tables), ...snapTables.keys(), ...[...edges.values()].filter((e) => e.to.startsWith('tbl.')).map((e) => e.to.slice(4))]);
  for (const name of allTableNames) {
    const decl = migrations.tables[name];
    const live = snapTables.get(name);
    const id = `tbl.${name}`;
    addNode({
      id, label: name, sublabel: live ? (live.rlsEnabled ? `RLS · ${live.policies.length} ${live.policies.length === 1 ? 'policy' : 'policies'}` : 'RLS OFF') : 'not in snapshot',
      kind: 'table',
      source: decl ? { path: decl.definedIn[0].file, line: decl.definedIn[0].line } : null,
      declared: decl ? { touchedBy: [...new Set(decl.definedIn.map((d) => d.file))], rlsEnabled: migrations.rlsEnabled.has(name) } : null,
      db: live ? { rlsEnabled: live.rlsEnabled, rlsForced: live.rlsForced, policies: live.policies } : null,
      verified: !!live,
    });
    const node = nodes.get(id);
    if (!live) {
      unverified.push({ scope: id, claim: 'table exists in prod', reason: 'Referenced in code or migrations, absent from db-snapshot.json.', resolve: 'Re-capture the snapshot.' });
    } else {
      if (!live.rlsEnabled) {
        node.drift.push({ field: 'rls', declared: node.declared?.rlsEnabled ? 'ENABLE ROW LEVEL SECURITY in a migration' : 'n/a', live: 'RLS DISABLED', severity: 'high',
          note: 'Table has no row-level security. Any role with table privileges reads every row.' });
      }
      if (live.rlsEnabled && live.policies.length === 0) {
        node.drift.push({ field: 'policies', declared: 'n/a', live: 'RLS on, ZERO policies', severity: 'low',
          note: 'RLS with no policies denies all access except to roles that bypass RLS (service_role, table owner). This is the correct shape for a service-role-only table — confirm that is the intent.' });
      }
      const publicRolePolicies = live.policies.filter((p) => p.roles.includes('PUBLIC'));
      if (publicRolePolicies.length) {
        node.drift.push({ field: 'policy_roles', declared: 'n/a', live: `${publicRolePolicies.length} of ${live.policies.length} policies target role PUBLIC`, severity: 'low',
          note: 'A PUBLIC-role policy also applies to anon, so the predicate alone decides access. Predicates are not captured in the snapshot — read the migration to confirm each one gates on auth.uid(). Newer rls_b1_* policies target `authenticated` explicitly.' });
      }
      if (node.declared?.rlsEnabled && !live.rlsEnabled) {
        node.drift.push({ field: 'rls', declared: 'enabled by migration', live: 'disabled', severity: 'high', note: 'A migration enables RLS but prod has it off.' });
      }
    }
  }

  // --- flows: resolve anchors, validate edge ids ---
  const anchorCache = new Map();
  const resolveAnchor = (file, needle) => {
    const p = join(ROOT, file);
    if (!existsSync(p)) return null;
    if (!anchorCache.has(file)) anchorCache.set(file, read(p));
    const content = anchorCache.get(file);
    const idx = content.indexOf(needle);
    return idx === -1 ? null : `${file}:${lineAt(content, idx)}`;
  };

  const flows = FLOWS.map((flow) => {
    const steps = [];
    const flowUnverified = [];
    flow.steps.forEach((step, i) => {
      const baseId = step.edge.split('#')[0];
      let edge = edges.get(step.edge) || edges.get(baseId);
      if (!edge && step.edge.startsWith('e.fanout.')) {
        // fan-out pseudo-steps aggregate every client call site for one function
        const target = step.edge.slice('e.fanout.'.length);
        const real = [...edges.values()].filter((e) => e.to === `fn.${target}` && e.protocol === 'https-invoke');
        if (real.length) {
          steps.push({ n: i + 1, edge: real.map((e) => e.id), detail: step.detail, files: real.flatMap((e) => e.callSites).sort() });
          return;
        }
      }
      const files = [];
      for (const [file, needle] of step.anchors || []) {
        const hit = resolveAnchor(file, needle);
        if (hit) files.push(hit);
        else flowUnverified.push(`step ${i + 1}: anchor not found — ${file} no longer contains "${needle}"`);
      }
      if (!edge) {
        flowUnverified.push(`step ${i + 1}: edge '${step.edge}' was not generated from any call site`);
        steps.push({ n: i + 1, edge: step.edge, detail: step.detail, files, verified: false });
        return;
      }
      steps.push({ n: i + 1, edge: edge.id, detail: step.detail, files: files.length ? files : edge.callSites });
    });
    const nodePath = [];
    for (const s of steps) {
      const ids = Array.isArray(s.edge) ? s.edge : [s.edge];
      for (const eid of ids) {
        const e = edges.get(eid);
        if (!e) continue;
        if (!nodePath.includes(e.from)) nodePath.push(e.from);
        if (!nodePath.includes(e.to)) nodePath.push(e.to);
      }
    }
    for (const u of flowUnverified) unverified.push({ scope: flow.id, claim: 'flow step is current', reason: u, resolve: 'Update the FLOWS block in scripts/gen-architecture.mjs.' });
    return { id: flow.id, title: flow.title, trigger: flow.trigger, nodePath, steps, annotation: null, unverified: flowUnverified };
  });

  // --- annotations (merged, never overwritten) ---
  let annotations = {};
  if (existsSync(ANNOTATIONS_JSON)) {
    try { annotations = JSON.parse(read(ANNOTATIONS_JSON)); }
    catch (e) { fail(`annotations.json is not valid JSON: ${e.message}`); }
  }
  const annotate = (obj) => { if (annotations[obj.id] !== undefined) obj.annotation = annotations[obj.id]; };
  nodes.forEach(annotate);
  edges.forEach(annotate);
  flows.forEach(annotate);
  const orphanAnnotations = Object.keys(annotations).filter((k) => !k.startsWith('_') && !nodes.has(k) && !edges.has(k) && !flows.some((f) => f.id === k));

  // --- source index + hash ---
  const sourceIndex = {
    edgeFunctions: edgeFns.map((f) => `${f.name}[${f.modules.join(',')}]`).sort(),
    invokes: [...clientSites.invokes, ...fnSites.invokes].map((s) => `${s.file}:${s.line} -> ${s.target}`).sort(),
    rpcs: [...clientSites.rpcs, ...fnSites.rpcs].map((s) => `${s.file}:${s.line} -> ${s.target}`).sort(),
    tableOps: [...clientSites.tableOps, ...fnSites.tableOps].map((s) => `${s.file}:${s.line} -> ${s.table}.${s.verb}`).sort(),
    migrations: migrations.files,
    config: Object.entries(config).map(([k, v]) => `${k}=${v.verifyJwt}`).sort(),
    dbSnapshot: snapshot.hash,
  };
  const sourceHash = sha(JSON.stringify(sourceIndex));

  // --- db snapshot age ---
  let dbSnapshotBlock = { present: false, capturedAt: null, ageHours: null, ageDays: null, staleAfterDays: DB_SNAPSHOT_STALE_AFTER_DAYS, stale: true, hash: snapshot.hash, counts: null };
  if (snapshot.present) {
    const captured = new Date(snapshot.data.capturedAt);
    const ageHours = (Date.now() - captured.getTime()) / 3_600_000;
    dbSnapshotBlock = {
      present: true, capturedAt: snapshot.data.capturedAt,
      ageHours: Math.round(ageHours * 10) / 10, ageDays: Math.round((ageHours / 24) * 10) / 10,
      staleAfterDays: DB_SNAPSHOT_STALE_AFTER_DAYS, stale: ageHours / 24 > DB_SNAPSHOT_STALE_AFTER_DAYS,
      hash: snapshot.hash, database: snapshot.data.database, postgresVersion: snapshot.data.postgresVersion,
      counts: { functions: (snapshot.data.functions || []).length, tables: (snapshot.data.tables || []).length, cronJobs: (snapshot.data.cronJobs || []).length },
    };
  } else {
    unverified.push({ scope: 'dbSnapshot', claim: 'any Postgres fact', reason: 'docs/architecture/db-snapshot.json is missing — no ACLs, RLS policies, or cron jobs are known.', resolve: 'Run docs/architecture/db-snapshot.sql against prod and save the output.' });
  }

  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  const driftRows = nodeList.flatMap((n) => n.drift.map((d) => ({ node: n.id, label: n.label, ...d })));
  const sevRank = { high: 0, medium: 1, low: 2 };
  driftRows.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.node.localeCompare(b.node));

  return {
    doc: {
      _comment: 'GENERATED — do not hand-edit. Run node scripts/gen-architecture.mjs.',
      schemaVersion: SCHEMA_VERSION,
      generated: {
        commit: git(['rev-parse', 'HEAD'], 'unknown'),
        commitShort: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
        branch: git(['branch', '--show-current'], '(detached)'),
        dirty: git(['status', '--porcelain']) !== '',
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        sourceHash,
        command: 'node scripts/gen-architecture.mjs',
        generatorVersion: GENERATOR_VERSION,
      },
      dbSnapshot: dbSnapshotBlock,
      layers: LAYERS,
      nodes: nodeList,
      edges: edgeList,
      flows,
      drift: driftRows,
      unverified,
      orphanAnnotations,
      stats: {
        nodes: nodeList.length, edges: edgeList.length, flows: flows.length,
        drift: driftRows.length, driftHigh: driftRows.filter((d) => d.severity === 'high').length,
        unverified: unverified.length,
      },
      sourceIndex,
    },
    sourceIndex,
    sourceHash,
  };
}

// ---------------------------------------------------------------------------
// 8. main
// ---------------------------------------------------------------------------

const { doc, sourceIndex, sourceHash } = build();

if (CHECK_ONLY) {
  if (!existsSync(OUT_JSON)) {
    console.error('architecture.json does not exist.\n\nRun: node scripts/gen-architecture.mjs');
    process.exit(1);
  }
  const prev = JSON.parse(read(OUT_JSON));
  if (prev.generated?.sourceHash === sourceHash) {
    console.log(`architecture.json is current (${sourceHash}).`);
    process.exit(0);
  }
  console.error('architecture.json is STALE (sourceHash mismatch)\n');
  const prevIdx = prev.sourceIndex || {};
  for (const key of Object.keys(sourceIndex)) {
    const a = prevIdx[key], b = sourceIndex[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!Array.isArray(b)) { console.error(`  ~ ${key.padEnd(16)} ${a} → ${b}`); continue; }
    const prevSet = new Set(a || []), nextSet = new Set(b);
    for (const x of b) if (!prevSet.has(x)) console.error(`  + ${key.padEnd(16)} ${x}`);
    for (const x of a || []) if (!nextSet.has(x)) console.error(`  - ${key.padEnd(16)} ${x}`);
  }
  console.error('\nRun: node scripts/gen-architecture.mjs');
  process.exit(1);
}

writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2) + '\n');

// --- viewer: inline the JSON so the page works over file:// with no fetch ---
const TEMPLATE = join(ROOT, 'scripts/architecture-viewer.html');
const OUT_HTML = join(OUT_DIR, 'architecture.html');
if (existsSync(TEMPLATE)) {
  // Escape `<` as <. Still valid JSON, but makes it impossible for a string in
  // the data (a code snippet, a policy name) to terminate the <script> block early.
  const inline = JSON.stringify(doc).replace(/</g, '\\u003c');
  const PLACEHOLDER = '__ARCHITECTURE_JSON__';
  const tpl = read(TEMPLATE);
  if (!tpl.includes(PLACEHOLDER)) {
    fail(`scripts/architecture-viewer.html has no ${PLACEHOLDER} placeholder — refusing to write a data-less viewer.`);
  }
  const html = tpl
    .replace('<!doctype html>\n<!--', '<!doctype html>\n<!-- GENERATED — do not hand-edit. Edit scripts/architecture-viewer.html and run node scripts/gen-architecture.mjs. -->\n<!--')
    .replace(PLACEHOLDER, () => inline);
  writeFileSync(OUT_HTML, html);
} else {
  console.error(`warning: ${rel(TEMPLATE)} is missing — architecture.html not written.`);
}

if (!existsSync(ANNOTATIONS_JSON)) {
  writeFileSync(ANNOTATIONS_JSON, JSON.stringify({
    _comment: 'Hand-written prose keyed by node / edge / flow id. NEVER overwritten by the generator. Add explanation here, not in architecture.json.',
  }, null, 2) + '\n');
  console.log('Created docs/architecture/annotations.json (empty stub).');
}

const s = doc.stats;
console.log(`Wrote docs/architecture/architecture.json + architecture.html`);
console.log(`  ${s.nodes} nodes · ${s.edges} edges · ${s.flows} flows`);
console.log(`  ${s.drift} drift rows (${s.driftHigh} high) · ${s.unverified} unverified`);
console.log(`  db-snapshot: ${doc.dbSnapshot.present ? doc.dbSnapshot.ageDays + 'd old' : 'MISSING'}`);
console.log(`  sourceHash: ${sourceHash}`);
if (doc.orphanAnnotations.length) {
  console.log(`  note: ${doc.orphanAnnotations.length} annotation key(s) match no node/edge/flow: ${doc.orphanAnnotations.join(', ')}`);
}
