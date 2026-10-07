/**
 * scripts/arch-call-sites.mjs: the architecture map's wrapper attribution and its
 * blind-spot report. Reads fixture files only (no network, no DB):
 *   deno test --allow-read supabase/tests/arch_call_sites.test.ts
 *
 * WHY: the mobile UI routes most server calls through dev-seam wrappers (seamRpc,
 * seamInvoke, seamUpdateLeague, ...). gen-architecture.mjs matched only
 * `supabase.rpc('literal')`, so those calls were INVISIBLE and `--check` still said
 * "current" about a map that could not see them (CLAUDE.md "success signals": a verdict
 * wider than its evidence). The seam code is not on main yet, so the fixtures are the
 * REAL files copied from origin/ui/mobile-league-setup @ 572ada6 (seamCalls.ts,
 * categoryData.ts, RenewalRoster.tsx, useAllMatchups.ts, useDraftRoom.ts,
 * QueueEditor.tsx) plus minimal skeletons that keep the real call lines (league.tsx,
 * createLeague.tsx) and synthetic edge cases (edgeCases, loose, unrelated, queryLike).
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  analyzeCalls,
  findFunctions,
  literalOf,
  maskComments,
  matchClose,
  parseImports,
  resolveLiterals,
} from '../../scripts/arch-call-sites.mjs';

const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/arch-seam/${name}.fixture`, import.meta.url));

const PATHS: Record<string, string> = {
  'apps/mobile/lib/game/seamCalls.ts': 'seamCalls.ts',
  'apps/mobile/lib/categoryData.ts': 'categoryData.ts',
  'apps/mobile/components/game/RenewalRoster.tsx': 'RenewalRoster.tsx',
  'apps/mobile/lib/game/useAllMatchups.ts': 'useAllMatchups.ts',
  'apps/mobile/lib/game/useDraftRoom.ts': 'useDraftRoom.ts',
  'apps/mobile/components/game/QueueEditor.tsx': 'QueueEditor.tsx',
  'apps/mobile/app/(tabs)/league.tsx': 'league.tsx',
  'apps/mobile/app/create-league.tsx': 'createLeague.tsx',
  'apps/mobile/components/edge/Edge.tsx': 'edgeCases.tsx',
  'apps/mobile/lib/loose.ts': 'loose.ts',
  'apps/mobile/lib/unrelated.ts': 'unrelated.ts',
  'apps/mobile/lib/queryLike.ts': 'queryLike.ts',
  'apps/mobile/components/other/Other.tsx': 'otherSeam.tsx',
  'apps/mobile/lib/pureHelper.ts': 'pureHelper.ts',
};

async function load() {
  const files = [];
  for (const [path, name] of Object.entries(PATHS)) files.push({ path, content: await fixture(name) });
  return files;
}

interface Site { file: string; line: number; target?: string; table?: string; verb?: string; via?: string; inferred?: boolean }
const short = (f: string) => f.replace('apps/mobile/', '');
const fmt = (s: Site) => `${short(s.file)} ${s.target ?? s.table}${s.verb ? '.' + s.verb : ''}${s.via ? ' via ' + s.via : ''}`;
const viaOnly = (xs: Site[]) => xs.filter((x) => x.via).map(fmt).sort();

// ---------------------------------------------------------------------------
// Lexing and resolution units
// ---------------------------------------------------------------------------

Deno.test('maskComments: blanks comments, keeps strings, keeps length and line numbers', () => {
  const src = [
    "const a = 'https://x.test//not-a-comment'; // supabase.rpc(commented)",
    '/* block\n supabase.functions.invoke(blocked) */',
    'const t = `${ x /* inner */ } // still template`;',
    "supabase.rpc('real');",
  ].join('\n');
  const m = maskComments(src);
  assertEquals(m.length, src.length);
  assertEquals(m.split('\n').length, src.split('\n').length);
  assert(m.includes("'https://x.test//not-a-comment'"), 'a // inside a string is not a comment');
  assertFalse(m.includes('commented'));
  assertFalse(m.includes('blocked'));
  assert(m.includes("supabase.rpc('real')"));
});

Deno.test('literalOf / resolveLiterals: literals, ternaries, const chains; never let/var, never a guess', () => {
  assertEquals(literalOf("'renew_league'"), 'renew_league');
  assertEquals(literalOf('`plain`'), 'plain');
  assertEquals(literalOf('`a_${b}`'), null);
  assertEquals(literalOf('name'), null);

  const src = [
    "const one = 'a';",
    "const pick = cond ? 'x' : other ? 'y' : 'z';",
    'const alias = one;',
    "let mutable = 'm';",
    'const unknown = compute();',
    "const mixed = flag ? 'p' : unknown;",
  ].join('\n');
  const at = src.length;
  assertEquals(resolveLiterals(src, 'alias', at), ['a']);
  assertEquals(resolveLiterals(src, 'pick', at)?.sort(), ['x', 'y', 'z']);
  assertEquals(resolveLiterals(src, "cond ? 'u' : 'v'", at)?.sort(), ['u', 'v']);
  assertEquals(resolveLiterals(src, 'mutable', at), null, 'a let can be reassigned');
  assertEquals(resolveLiterals(src, 'unknown', at), null);
  assertEquals(resolveLiterals(src, 'mixed', at), null, 'one unprovable branch makes the whole thing unprovable');
  assertEquals(resolveLiterals(src, 'a?.b', at), null, 'optional chaining is not a ternary');
});

Deno.test('findFunctions: generics + an object-literal return type, arrows, expression bodies, destructured params', () => {
  const src = [
    'export async function seamTable<T>(\n  name: SeamTableName,\n  real: () => PromiseLike<{ data: T[] | null; error: unknown }>,\n): Promise<{ data: T[] | null; error: unknown }> {\n  return real();\n}',
    'export const a = async (x: string, args: Record<string, unknown>) => { return x; };',
    'const b = (n: string): Promise<void> => n;',
    'const c = async d => d;',
    'function e({ p, q }: P, r) { return r; }',
    'const notAFunction = (1 + 2) * 3;',
  ].join('\n');
  const defs = findFunctions(maskComments(src));
  const by = Object.fromEntries(defs.map((d: { name: string; params: (string | null)[] }) => [d.name, d.params]));
  assertEquals(by.seamTable, ['name', 'real']);
  assertEquals(by.a, ['x', 'args'], '`args: Record<string, unknown>` is ONE parameter, not two');
  assertEquals(by.b, ['n']);
  assertEquals(by.c, ['d']);
  assertEquals(by.e, [null, 'r'], 'a destructured parameter has no name to forward');
  assertFalse('notAFunction' in by);
  const m = maskComments(src);
  const body = defs.find((d: { name: string }) => d.name === 'seamTable');
  assertEquals(m[body.bodyStart], '{');
  assertEquals(matchClose(m, body.bodyStart), body.bodyEnd);
});

Deno.test('parseImports: named, aliased, default, type-only', () => {
  const imp = parseImports(maskComments([
    "import { a, b as c, type D } from './x';",
    "import e from '../y';",
    "import type { F } from './z';",
  ].join('\n')));
  assertEquals(imp.a, { imported: 'a', from: './x' });
  assertEquals(imp.c, { imported: 'b', from: './x' });
  assertEquals(imp.D, { imported: 'D', from: './x' });
  assertEquals(imp.e, { imported: 'default', from: '../y' });
  assertEquals(imp.F, { imported: 'F', from: './z' });
});

// ---------------------------------------------------------------------------
// Wrappers are found from their DEFINITIONS
// ---------------------------------------------------------------------------

Deno.test('definitions: forwarders, seam stubs and the callback wrapper are derived, with no list of names', async () => {
  const r = analyzeCalls(await load());
  const got = r.wrappers.map((w: { name: string; kind: string }) => `${w.name}:${w.kind}`).sort();
  assertEquals(got, [
    'looseRpc:forwarder:rpc',        // no seam gate and no "seam" in its name: structure alone
    'readAll:forwarder:table',       // a table-name forwarder
    'seamInsertLeague:seam-stub',
    'seamInsertMember:seam-stub',
    'seamInvoke:forwarder:invoke',
    'seamRpc:forwarder:rpc',
    'seamSaveLeagueSlots:seam-stub',
    'seamTable:callback',
    'seamUpdateLeague:seam-stub',
  ]);
});

Deno.test('forwarders: the first argument is parsed the way a direct call is; a ternary of literals is INFERRED', async () => {
  const r = analyzeCalls(await load());
  assertEquals(viaOnly(r.rpcs), [
    'components/edge/Edge.tsx get_home_league via looseRpc',
    'components/edge/Edge.tsx literal_ok via seamRpc',
    'components/game/QueueEditor.tsx set_draft_queue via seamRpc',
    'components/game/RenewalRoster.tsx nudge_renewal via seamRpc',
    'components/game/RenewalRoster.tsx remove_renewal_invitee via seamRpc',
    'lib/game/useDraftRoom.ts get_draft_clock via seamRpc',
    'lib/game/useDraftRoom.ts get_draft_order via seamRpc',
    'lib/game/useDraftRoom.ts get_league_display_names via seamRpc',
    'app/(tabs)/league.tsx renew_league via seamRpc',
  ].sort());
  const inferred = r.rpcs.filter((s: Site) => s.inferred).map((s: Site) => s.target).sort();
  assertEquals(inferred, ['nudge_renewal', 'remove_renewal_invitee'], 'RenewalRoster: `const rpc = a ? "nudge_renewal" : "remove_renewal_invitee"`');
  assertEquals(viaOnly(r.invokes), [
    'app/(tabs)/league.tsx draft-control via seamInvoke',
    'app/(tabs)/league.tsx draft-control via seamInvoke',
    'lib/game/useAllMatchups.ts quote via seamInvoke',
  ].sort());
  // line numbers are the CALLER's line, not the wrapper's
  const league = r.rpcs.find((s: Site) => s.target === 'renew_league');
  assertEquals(league.line, 10);
});

Deno.test('forwarder of a TABLE name: the verb and columns come from the wrapper\'s own query', async () => {
  const r = analyzeCalls(await load());
  const t = r.tableOps.find((s: Site) => s.via === 'readAll');
  assertEquals([t.table, t.verb, t.columns], ['profiles', 'select', 'id, name']);
});

Deno.test('seam stubs: callers inherit the stub\'s real calls, including through a function it calls', async () => {
  const r = analyzeCalls(await load());
  assertEquals(viaOnly(r.tableOps).filter((x) => !x.includes('readAll')), [
    'app/(tabs)/league.tsx leagues.update via seamUpdateLeague',
    'app/(tabs)/league.tsx leagues.update via seamUpdateLeague',
    'app/create-league.tsx league_draft_slots.delete via seamSaveLeagueSlots',
    'app/create-league.tsx league_draft_slots.insert via seamSaveLeagueSlots',
    'app/create-league.tsx league_members.insert via seamInsertMember',
    'app/create-league.tsx leagues.insert via seamInsertLeague',
  ].sort());
  // seamSaveLeagueSlots's ops come from saveLeagueSlots in categoryData.ts (transitive)
  const wrapper = r.wrappers.find((w: { name: string }) => w.name === 'seamSaveLeagueSlots');
  assertEquals(wrapper.detail, 'league_draft_slots.delete, league_draft_slots.insert');
});

Deno.test('callback wrapper: its first argument is a fixture key, NOT a table; the closure\'s own call is the edge', async () => {
  const r = analyzeCalls(await load());
  // seamTable('matchups_week', ...) / ('matchups_playoff', ...) must not mint tables named after fixture keys
  const tables = new Set(r.tableOps.map((s: Site) => s.table));
  assertFalse(tables.has('matchups_week'));
  assertFalse(tables.has('matchups_playoff'));
  assertEquals(r.tableOps.filter((s: Site) => s.via === 'seamTable').length, 0);
  // the closures' direct calls ARE sites (they would also be found by the plain scan)
  assert(r.tableOps.some((s: Site) => s.table === 'drafts' && short(s.file) === 'lib/game/useDraftRoom.ts'));
  assert(r.tableOps.some((s: Site) => s.table === 'draft_queue' && short(s.file) === 'lib/game/useDraftRoom.ts'),
    'seamTable<{ ... }>(...) with explicit type arguments is still a call');
});

Deno.test('a same-named function that is NOT imported from the wrapper\'s module is not the wrapper', async () => {
  const r = analyzeCalls(await load());
  // unrelated.ts defines its own seamRpc; Other.tsx imports a seamRpc from a different module
  for (const f of ['lib/unrelated.ts', 'components/other/Other.tsx']) {
    const mine = [...r.rpcs, ...r.invokes, ...r.tableOps].filter((s: Site) => short(s.file) === f);
    assertEquals(mine.length, 0, f);
    assertEquals(r.unattributed.filter((u: { file: string }) => short(u.file) === f).length, 0, f);
  }
});

Deno.test('a pure helper that calls a function parameter is NOT a wrapper, and its callers are not blind spots', async () => {
  const r = analyzeCalls(await load());
  assertFalse(r.wrappers.some((w: { name: string }) => w.name === 'summarize'), 'a callback parameter alone is far too common to mean "wrapper"');
  assertEquals(r.unattributed.filter((u: { file: string }) => short(u.file) === 'lib/pureHelper.ts').length, 0);
});

// ---------------------------------------------------------------------------
// The blind spots are REPORTED, not dropped
// ---------------------------------------------------------------------------

Deno.test('every call the scanner cannot attribute is reported, with where and why', async () => {
  const r = analyzeCalls(await load());
  const got = r.unattributed.map((u: { file: string; line: number; kind: string; reason: string }) => `${short(u.file)}:${u.line} ${u.kind} ${u.reason}`);
  assertEquals(got, [
    'components/edge/Edge.tsx:9 wrapper:seamRpc dynamic-name',
    'components/edge/Edge.tsx:10 wrapper:seamRpc templated-name',
    'components/edge/Edge.tsx:11 wrapper:seamRpc wrapper-used-as-a-value',
    'components/edge/Edge.tsx:12 wrapper:seamInvoke dynamic-name',
    'components/edge/Edge.tsx:13 wrapper:seamTable callback-without-a-visible-call',
    'lib/queryLike.ts:10 invoke dynamic-name',            // a class method: a parameter of a function it cannot name
  ]);
  const first = r.unattributed[0];
  assertEquals(first.expr, 'which', 'the expression is quoted so a human can resolve it');
});

Deno.test('prose is not a call: comments are ignored, and Array.from is not a query', async () => {
  const r = analyzeCalls(await load());
  const edge = (xs: { file: string; line: number }[]) => xs.filter((x) => short(x.file) === 'components/edge/Edge.tsx').map((x) => x.line);
  assertFalse(edge(r.unattributed).includes(6), 'a // comment mentioning supabase.rpc(name)');
  assertFalse(edge(r.unattributed).includes(7), 'a /* */ comment mentioning functions.invoke(name)');
  assertFalse(edge(r.unattributed).includes(16), 'Array.from(new Set(...)) is not a table read');
  assertFalse(edge([...r.tableOps]).includes(16));
});

Deno.test('INVARIANT: every call of a wrapper is either attributed or reported, never silently dropped', async () => {
  const files = await load();
  const r = analyzeCalls(files);
  const attributed = new Set<string>([...r.rpcs, ...r.invokes, ...r.tableOps].filter((s: Site) => s.via).map((s: Site) => `${s.via}|${s.file}|${s.line}`));
  const reported = new Set<string>(r.unattributed.filter((u: { kind: string }) => u.kind.startsWith('wrapper:')).map((u: { kind: string; file: string; line: number }) => `${u.kind.slice(8)}|${u.file}|${u.line}`));
  // a callback wrapper's closure carries its own call: accounted for, recorded as such
  const closures = new Set<string>(r.closureCalls.map((c: { wrapper: string; file: string; line: number }) => `${c.wrapper}|${c.file}|${c.line}`));
  const names = r.wrappers.map((w: { name: string }) => w.name);
  for (const f of files) {
    const lines = f.content.split('\n');
    lines.forEach((text, i) => {
      for (const name of names) {
        // a call expression of the wrapper on this line: not its definition, not an import, not a comment line
        if (!new RegExp(`(?<![.\\w$])${name}\\s*(?:<[^>(]*>)?\\(`).test(text)) continue;
        if (/^\s*(\/\/|\*|\/\*)/.test(text) || /\bfunction\s/.test(text) || /^\s*import\b/.test(text)) continue;
        if (f.path.endsWith('lib/unrelated.ts') || f.path.endsWith('Other.tsx')) continue; // a different function of the same name
        if (name === 'seamTable' && f.path.endsWith('seamCalls.ts')) continue;
        const key = `${name}|${f.path}|${i + 1}`;
        assert(attributed.has(key) || reported.has(key) || closures.has(key), `silently dropped: ${key}  ${text.trim().slice(0, 80)}`);
      }
    });
  }
});

Deno.test('dedupe: a site the literal scan already produced is not added twice', async () => {
  const files = await load();
  const key = 'rpc|apps/mobile/lib/loose.ts|5|nothing';
  const keys = new Set([key]);
  analyzeCalls(files, keys);
  // the analyzer adds what it finds to the shared set, so the generator's own sites stay unique
  assert(keys.size > 1);
  const again = analyzeCalls(files, keys);
  assertEquals([...again.rpcs, ...again.invokes, ...again.tableOps].length, 0, 'a second pass over the same keys adds nothing');
});

// ---------------------------------------------------------------------------
// The generator uses it, and the verdict states its own blind spots
// ---------------------------------------------------------------------------

Deno.test('gen-architecture.mjs: wires the analysis in, hashes the blind spots, and qualifies "current"', async () => {
  const src = await Deno.readTextFile(new URL('../../scripts/gen-architecture.mjs', import.meta.url));
  assert(src.includes("from './arch-call-sites.mjs'") && src.includes('analyzeCalls('), 'the generator does not run the wrapper analysis');
  assert(/unattributed: callSiteScan\.unattributed\.map/.test(src), 'blind spots are not in sourceIndex: a change in them would not make the map stale');
  assert(/wrappers: callSiteScan\.wrappers\.map/.test(src), 'wrappers are not in sourceIndex');
  assert(/scope: 'callSiteScan'/.test(src), 'unattributed sites are not surfaced in unverified[]');
  assert(src.includes('could not be attributed and are NOT in the map'), '`--check` says "current" without qualifying what it cannot see');
  assert(src.includes('no supabase call site went unattributed'), '`--check` gives no positive statement of coverage');
  assertEquals((src.match(/\.\.\.\(s\.via \? \{ via: \[s\.via\] \} : \{\}\)/g) ?? []).length, 3,
    'rpc, invoke and table edges must each record which wrapper they came through');
});
