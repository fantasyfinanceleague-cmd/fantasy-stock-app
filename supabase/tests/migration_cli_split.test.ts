/**
 * Guard: every migration must split cleanly under the Supabase CLI's own
 * statement splitter, the one `supabase db push` runs before sending SQL.
 *
 * Why this exists: the CLI does not send a migration file as-is. It splits it
 * into statements with a small state machine (supabase/cli pkg/parser/state.go,
 * v2.67.1) and sends each one as a prepared statement. That splitter treats the
 * word "atomic" outside quotes/comments as the start of a SQL-standard
 * `BEGIN ATOMIC ... END` function body and stops splitting until it sees END.
 * 20261102000000_record_trade_atomic.sql named its function record_trade_atomic
 * (bare), so the whole file went out as ONE statement and Postgres refused it
 * (42601 "cannot insert multiple commands into a prepared statement") on the
 * first prod push, 2026-10-06. Nothing was applied, but the PGlite suite could
 * not catch it: PGlite's exec runs multi-statement text directly, never the
 * CLI's splitter.
 *
 * The port below is faithful to the Go source, including its quirks (a bare
 * "atomic" suffix anywhere, a single "-" entering CommentState). A file is
 * CLEAN when the splitter ends in a resting state (ready, or inside a trailing
 * line comment). Ending anywhere else (inside an ATOMIC block, a quote, a
 * dollar quote, a block comment) means the CLI would glue statements together.
 *
 * Fix for a failure: quote the identifier (public."my_atomic_fn"), which the
 * splitter skips and Postgres treats as the same lowercase name.
 *
 * Reads files only: deno test --allow-read supabase/tests/migration_cli_split.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';

type State =
  | { k: 'ready' }
  | { k: 'comment' }
  | { k: 'block'; depth: number }
  | { k: 'quote'; delim: string; escape: boolean }
  | { k: 'dollar'; delim: string }
  | { k: 'tag'; offset: number }
  | { k: 'escape' }
  | { k: 'atomic'; prev: State; delim: string };

// Returns null to emit a token (the Go `return nil`).
function next(s: State, r: string, data: string): State | null {
  switch (s.k) {
    case 'ready':
      switch (r) {
        case '$': return { k: 'tag', offset: data.length - r.length };
        case "'": case '"': return { k: 'quote', delim: r, escape: false };
        case '-': return { k: 'comment' };
        case '/': return { k: 'block', depth: 0 };
        case '\\': return { k: 'escape' };
        case ';': return null;
        case '(': return { k: 'atomic', prev: s, delim: ')' };
        case 'c': case 'C': {
          const tail = data.slice(-'ATOMIC'.length);
          if (tail.length === 6 && tail.toUpperCase() === 'ATOMIC') {
            return { k: 'atomic', prev: s, delim: 'END' };
          }
          return s;
        }
        default: return s;
      }
    case 'comment':
      if (r === '-') return { k: 'dollar', delim: '\n' };
      return next({ k: 'ready' }, r, data);
    case 'block': {
      const w = data.slice(-2);
      if (w === '/*') { s.depth += 1; return s; }
      if (s.depth === 0) return next({ k: 'ready' }, r, data);
      if (w === '*/') {
        s.depth -= 1;
        if (s.depth === 0) return { k: 'ready' };
      }
      return s;
    }
    case 'quote':
      if (s.escape) {
        if (r === s.delim) { s.escape = false; return s; }
        return next({ k: 'ready' }, r, data);
      }
      if (r === s.delim) s.escape = true;
      return s;
    case 'dollar':
      if (data.slice(-s.delim.length) === s.delim) return { k: 'ready' };
      return s;
    case 'tag':
      if (r === '$') return { k: 'dollar', delim: data.slice(s.offset) };
      if (/[\p{L}\p{N}_]/u.test(r)) return s;
      return next({ k: 'ready' }, r, data);
    case 'escape':
      return { k: 'ready' };
    case 'atomic': {
      const curr = next(s.prev, r, data);
      if (curr !== null) s.prev = curr;
      if (s.prev.k === 'ready') {
        const w = data.slice(-s.delim.length);
        if (w.toUpperCase() === s.delim.toUpperCase()) return { k: 'ready' };
      }
      return s;
    }
  }
}

/** Split like the CLI; return the statements and the state at EOF. */
export function cliSplit(sql: string): { stmts: string[]; end: State } {
  const stmts: string[] = [];
  let state: State = { k: 'ready' };
  let buf = '';
  for (const r of sql) { // iterates code points, like utf8.DecodeRune
    buf += r;
    const n = next(state, r, buf);
    if (n === null) {
      stmts.push(buf);
      buf = '';
      state = { k: 'ready' };
    } else {
      state = n;
    }
  }
  if (buf.trim().length > 0) stmts.push(buf);
  return { stmts, end: state };
}

const atRest = (s: State) =>
  s.k === 'ready' || s.k === 'comment' || (s.k === 'dollar' && s.delim === '\n');

const MIGRATIONS = new URL('../migrations/', import.meta.url);

async function sqlFiles(): Promise<URL[]> {
  const out: URL[] = [];
  for (const sub of ['', 'deferred/']) {
    for await (const e of Deno.readDir(new URL(sub, MIGRATIONS))) {
      if (e.isFile && e.name.endsWith('.sql')) out.push(new URL(sub + e.name, MIGRATIONS));
    }
  }
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

Deno.test('the port reproduces the 2026-10-06 failure (bare "atomic" glues the file)', () => {
  const broken = 'create function public.record_trade_atomic(a int) returns int\n' +
    'language sql as $$ select 1 $$;\nrevoke all on function public.record_trade_atomic(int) from anon;\n';
  const b = cliSplit(broken);
  assertEquals(b.stmts.length, 1, 'the CLI sends one glued statement');
  assertEquals(b.end.k, 'atomic');

  const fixed = broken.replaceAll('public.record_trade_atomic', 'public."record_trade_atomic"');
  const f = cliSplit(fixed);
  assertEquals(f.stmts.length, 2);
  assert(atRest(f.end));
});

Deno.test('a real BEGIN ATOMIC body still splits as one statement, then resumes', () => {
  const sql = 'create function f() returns int language sql\nbegin atomic\n  select 1;\n  select 2;\nend;\nselect 3;\n';
  const r = cliSplit(sql);
  assertEquals(r.stmts.length, 2);
  assert(atRest(r.end));
});

Deno.test('every migration (incl. deferred/) splits cleanly under the CLI splitter', async () => {
  const bad: string[] = [];
  for (const f of await sqlFiles()) {
    const sql = await Deno.readTextFile(f);
    const { stmts, end } = cliSplit(sql);
    if (!atRest(end)) {
      bad.push(`${f.pathname.split('/migrations/')[1]}: ends inside ${end.k} after ${stmts.length} statement(s)`);
    }
  }
  assertEquals(bad, [], 'these files would be glued into one statement by `supabase db push`:\n' + bad.join('\n'));
});
