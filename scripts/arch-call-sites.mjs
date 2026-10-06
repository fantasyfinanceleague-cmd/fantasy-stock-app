/**
 * arch-call-sites.mjs — what gen-architecture.mjs's call-site scanner cannot see by
 * grepping for `.rpc('x')`, and the honest accounting of what it STILL cannot see.
 *
 * Pure: no fs, no git, no Node-only APIs (it is imported by a Deno test and by the
 * generator). Input is [{ path, content }]; output is plain data.
 *
 * WHY THIS EXISTS
 *   The mobile UI routes most server calls through small wrappers (the dev seam:
 *   seamRpc, seamInvoke, seamUpdateLeague, ...). The old scanner matched only
 *   `supabase.rpc('literal')`, so a call written `seamRpc('renew_league', ...)` was
 *   INVISIBLE, and the wrapper's own `supabase.rpc(name, ...)` (a variable, not a
 *   literal) was dropped without a word. `--check` then reported "current" for a map
 *   that could not see those edges: a verdict (the map is complete) wider than its
 *   evidence (the literal calls). CLAUDE.md "success signals" #5/#7 and the
 *   scope-of-the-verdict rule.
 *
 * WHAT IT DOES
 *   1. Finds wrapper DEFINITIONS in the source, not a list of names:
 *        forwarder  a function that passes one of its PARAMETERS as the name of a call
 *                   (`.rpc(name, ...)`, `.functions.invoke(fn, ...)`, `.from(table)`).
 *                   Its callers' first argument IS the name. Needs no marker at all.
 *        seam stub  a function whose body begins `if (SEAM_ON) return ...;` and then
 *                   performs real calls (its own, or via a function it calls). Its
 *                   callers inherit those calls. SEAM_ON is the one name this knows;
 *                   it is the dev-seam gate, see SEAM_GATE.
 *        callback   a function that CALLS one of its parameters (`real()`): the real
 *                   call lives in the closure the caller passes, which the direct scan
 *                   already sees. Its first argument is NOT a table (seamTable's is a
 *                   fixture key, 'matchups_week'), so it must not be parsed as one.
 *   2. Attributes each wrapper call to the same edge a direct call would make, parsing
 *      the name argument the same way (a string literal), plus a bounded inference for
 *      `const x = c ? 'a' : 'b'; wrapper(x)`, marked `inferred`.
 *   3. REPORTS what it could not attribute (a dynamic or templated name, a wrapper
 *      passed around as a value, a callback with no visible call, a forwarder it does
 *      not understand). Nothing is silently dropped, so the map states its blind spots.
 *
 * WHAT IT STILL CANNOT SEE (and says so in the docs it feeds)
 *   - a wrapper reached through a re-export / alias it cannot resolve by file name,
 *   - methods on objects/classes (`client.rpc(name)` inside a class method is reported
 *     as unattributed, not guessed),
 *   - a seam stub that is gated by something other than SEAM_ON,
 *   - names built at runtime, which are reported rather than resolved.
 *
 * Comments are masked before any of this runs: prose that mentions `.rpc(name)` (and
 * this repo's functions are full of it) is not a call.
 */

export const SEAM_GATE = 'SEAM_ON';

// ---------------------------------------------------------------------------
// Lexing helpers (just enough JS: strings, templates, comments, brackets)
// ---------------------------------------------------------------------------

/** Same-length copy of `src` with every comment blanked (newlines kept, so line numbers hold). */
export function maskComments(src) {
  const out = src.split('');
  const n = src.length;
  const ctx = [{ t: 'code', depth: 0, isExpr: false }];
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    const top = ctx[ctx.length - 1];
    if (top.t === 'code') {
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
        continue;
      }
      if (c === '/' && d === '*') {
        out[i] = ' '; out[i + 1] = ' '; i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
        if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
        continue;
      }
      if (c === "'" || c === '"') {
        // A string ends at its quote or at a newline, so a stray quote inside a regex
        // literal can only spoil the rest of its own line.
        i++;
        while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
        i++;
        continue;
      }
      if (c === '`') { ctx.push({ t: 'tpl' }); i++; continue; }
      if (top.isExpr) {
        if (c === '{') top.depth++;
        else if (c === '}') {
          if (top.depth === 0) { ctx.pop(); i++; continue; }
          top.depth--;
        }
      }
      i++;
      continue;
    }
    // inside a template literal
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { ctx.pop(); i++; continue; }
    if (c === '$' && d === '{') { ctx.push({ t: 'code', depth: 0, isExpr: true }); i += 2; continue; }
    i++;
  }
  return out.join('');
}

/** Index just past the string/template literal that starts at `i` (src[i] is its opening quote). */
function skipLiteral(src, i) {
  const q = src[i];
  const n = src.length;
  if (q === '`') {
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        const close = matchClose(src, i + 1);
        i = close < 0 ? n : close + 1;
        continue;
      }
      i++;
    }
    return i + 1;
  }
  i++;
  while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
  return i + 1;
}

const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Index of the bracket matching the one at `openIdx`, or -1. Skips strings and templates. */
export function matchClose(src, openIdx) {
  const stack = [OPEN[src[openIdx]]];
  let i = openIdx + 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(src, i); continue; }
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
    i++;
  }
  return -1;
}

/** Split src[start, end) on commas that sit at bracket depth 0. Returns [{ text, start, end }]. */
function splitTopLevel(src, start, end) {
  const parts = [];
  let depth = 0;
  let angle = 0; // generics in a type annotation: `args: Record<string, unknown>` is ONE parameter
  let segStart = start;
  let i = start;
  while (i < end) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(src, i); continue; }
    if (c === '<' && /[\w$>]/.test(src[i - 1] ?? '')) angle++;
    else if (c === '>' && angle > 0 && src[i - 1] !== '=') angle--;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0 && angle === 0) { parts.push({ text: src.slice(segStart, i), start: segStart, end: i }); segStart = i + 1; }
    i++;
  }
  if (src.slice(segStart, end).trim() !== '') parts.push({ text: src.slice(segStart, end), start: segStart, end });
  return parts;
}

const lineOf = (src, idx) => { let l = 1; for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) l++; return l; };

const IDENT = '[A-Za-z_$][\\w$]*';
const isIdent = (s) => new RegExp(`^${IDENT}$`).test(s);

// ---------------------------------------------------------------------------
// Names: string literals, and a bounded constant-propagation
// ---------------------------------------------------------------------------

const RE_STRING = /^(['"`])([^'"`\\\n$]*)\1$/;

/** 'x' | "x" | `x` (no interpolation) -> x, else null. */
export function literalOf(expr) {
  const m = RE_STRING.exec(expr.trim());
  return m ? m[2] : null;
}

/** End index (exclusive) of the expression that starts at `from`: the first top-level `;`, or a newline that does not continue it. */
function expressionEnd(src, from) {
  let depth = 0;
  let i = from;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return i; depth--; }
    else if (depth === 0 && c === ';') return i;
    else if (depth === 0 && c === '\n') {
      const rest = src.slice(i + 1).match(/^\s*(\S+)/);
      // A line that begins with `?`, `:`, `.`, `&&`, `||`, `??` continues the expression.
      if (!rest || !/^(\?|:|\.|&&|\|\||\+|-|\*|\/)/.test(rest[1])) return i;
    }
    i++;
  }
  return n;
}

/** Index of the first top-level occurrence of `ch` in `s` (a lone `?` is not `?.` or `??`), or -1. */
function topLevelIndexOf(s, ch) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(s, i) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ch) {
      if (ch === '?' && (s[i + 1] === '.' || s[i + 1] === '?')) { if (s[i + 1] === '?') i++; continue; }
      return i;
    }
  }
  return -1;
}

/**
 * Every string literal `expr` can evaluate to, or null if any branch is not provable.
 * Handles a literal, a ternary of resolvable branches, parentheses, `as const`, and a
 * `const x = <resolvable>` declared earlier in the same file. `let`/`var` are NOT
 * resolved: they can be reassigned. Depth-bounded.
 */
export function resolveLiterals(masked, expr, atIndex, depth = 0) {
  if (depth > 4) return null;
  let e = expr.trim().replace(/\s+as\s+(?:const|string)\s*$/, '').trim();
  if (e.startsWith('(') && matchClose(e, 0) === e.length - 1) return resolveLiterals(masked, e.slice(1, -1), atIndex, depth + 1);
  const lit = literalOf(e);
  if (lit !== null) return [lit];
  const q = topLevelIndexOf(e, '?');
  if (q >= 0) {
    const rest = e.slice(q + 1);
    const c = topLevelIndexOf(rest, ':');
    if (c < 0) return null;
    const a = resolveLiterals(masked, rest.slice(0, c), atIndex, depth + 1);
    const b = resolveLiterals(masked, rest.slice(c + 1), atIndex, depth + 1);
    return a && b ? [...new Set([...a, ...b])] : null;
  }
  if (isIdent(e)) {
    const re = new RegExp(`(?:^|[\\s;{}(])const\\s+${e.replace(/\$/g, '\\$')}\\s*(?::[^=;]+)?=\\s*`, 'g');
    let last = null;
    let m;
    while ((m = re.exec(masked)) !== null) { if (m.index < atIndex) last = m; else break; }
    if (!last) return null;
    const start = last.index + last[0].length;
    return resolveLiterals(masked, masked.slice(start, expressionEnd(masked, start)), last.index, depth + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Functions: definitions, parameters, bodies
// ---------------------------------------------------------------------------

/** First top-level `{` of a function's body after its `)`, skipping a `: ReturnType<{...}>`. */
function bodyBraceAfter(src, from) {
  let angle = 0;
  let i = from;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipLiteral(src, i); continue; }
    if (c === '<') angle++;
    else if (c === '>' && src[i - 1] !== '=') angle = Math.max(0, angle - 1);
    else if (c === '(') { const m = matchClose(src, i); if (m < 0) return -1; i = m; }
    else if (c === '{' && angle === 0) return i;
    else if (c === '{') { const m = matchClose(src, i); if (m < 0) return -1; i = m; }
    else if (c === ';' || c === '=' && src[i + 1] !== '>') { if (angle === 0) return -1; }
    i++;
  }
  return -1;
}

function parseParams(src, openParen) {
  const close = matchClose(src, openParen);
  if (close < 0) return null;
  const parts = splitTopLevel(src, openParen + 1, close);
  const params = parts.map((p) => {
    const m = new RegExp(`^\\s*(?:\\.\\.\\.)?\\s*(${IDENT})\\s*(?:[?:=]|$)`).exec(p.text);
    return m ? m[1] : null; // a destructured parameter has no name to forward
  });
  return { params, close };
}

/**
 * Every function in `masked`: { name, params, bodyStart, bodyEnd, defIdx }.
 * `function f(...) {}`, `const f = (...) => {}` / `=> expr`, `const f = async function (...) {}`,
 * and `const f = x => ...`. Methods and anonymous callbacks are not named defs; they still
 * count as enclosing scopes for parameter lookup (see enclosingFunctions).
 */
export function findFunctions(masked) {
  const defs = [];
  const seen = new Set();
  const add = (d) => { if (d.bodyStart >= 0 && d.bodyEnd > d.bodyStart && !seen.has(`${d.name}@${d.defIdx}`)) { seen.add(`${d.name}@${d.defIdx}`); defs.push(d); } };

  const reFn = new RegExp(`(?:^|[\\s;{}(,=])(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})?\\s*(<[^()]*?>)?\\s*\\(`, 'g');
  let m;
  while ((m = reFn.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    const p = parseParams(masked, open);
    if (!p) continue;
    const bs = bodyBraceAfter(masked, p.close + 1);
    if (bs < 0) continue;
    add({ name: m[1] || null, params: p.params, bodyStart: bs, bodyEnd: matchClose(masked, bs), defIdx: m.index });
  }

  const reArrow = new RegExp(`(?:^|[\\s;{}])(?:export\\s+)?(?:const|let|var)\\s+(${IDENT})\\s*(?::[^=]+?)?=\\s*(?:async\\s+)?(?:(<[^()]*?>)?\\s*\\(|(${IDENT})\\s*=>)`, 'g');
  while ((m = reArrow.exec(masked)) !== null) {
    let params;
    let afterParams;
    if (m[3]) { params = [m[3]]; afterParams = m.index + m[0].length - 2; /* before => */ afterParams = masked.indexOf('=>', afterParams) ; }
    else {
      const open = m.index + m[0].length - 1;
      const p = parseParams(masked, open);
      if (!p) continue;
      params = p.params;
      // optional `: ReturnType` then `=>`
      let j = p.close + 1;
      while (/\s/.test(masked[j] ?? '')) j++;
      if (masked[j] === ':') {
        let angle = 0;
        while (j < masked.length && !(angle === 0 && masked.startsWith('=>', j))) {
          if (masked[j] === '<') angle++; else if (masked[j] === '>' && masked[j - 1] !== '=') angle--;
          else if (masked[j] === '(' || masked[j] === '{') { const c = matchClose(masked, j); if (c < 0) break; j = c; }
          else if (masked[j] === ';') break;
          j++;
        }
      }
      if (!masked.startsWith('=>', j)) continue; // `const x = (a + b)`: not a function
      afterParams = j;
    }
    if (afterParams < 0) continue;
    let k = afterParams + 2;
    while (/\s/.test(masked[k] ?? '')) k++;
    if (masked[k] === '{') add({ name: m[1], params, bodyStart: k, bodyEnd: matchClose(masked, k), defIdx: m.index });
    else add({ name: m[1], params, bodyStart: k, bodyEnd: expressionEnd(masked, k), defIdx: m.index });
  }

  // `const f = async function (a) {` / `const f = function (a) {`
  const reFnExpr = new RegExp(`(?:^|[\\s;{}])(?:export\\s+)?(?:const|let|var)\\s+(${IDENT})\\s*=\\s*(?:async\\s+)?function\\s*\\*?\\s*(?:${IDENT})?\\s*\\(`, 'g');
  while ((m = reFnExpr.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    const p = parseParams(masked, open);
    if (!p) continue;
    const bs = bodyBraceAfter(masked, p.close + 1);
    if (bs < 0) continue;
    add({ name: m[1], params: p.params, bodyStart: bs, bodyEnd: matchClose(masked, bs), defIdx: m.index });
  }
  return defs;
}

/** Anonymous scopes whose parameters can also be forwarded: `(x) => {...}` / `function (x) {...}` inside another body. */
function findAnonymousScopes(masked) {
  const scopes = [];
  const re = /(?:async\s+)?(?:\(([^()]*)\)|(\b[A-Za-z_$][\w$]*\b))\s*=>\s*(\{)?/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const raw = m[1] ?? m[2] ?? '';
    const params = raw.split(',').map((s) => { const x = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)/.exec(s); return x ? x[1] : null; });
    const bs = m[3] ? m.index + m[0].length - 1 : m.index + m[0].length;
    const be = m[3] ? matchClose(masked, bs) : expressionEnd(masked, bs);
    if (be > bs) scopes.push({ name: null, params, bodyStart: bs, bodyEnd: be, defIdx: m.index });
  }
  return scopes;
}

/** Functions whose body contains `idx`, innermost first. */
function enclosing(scopes, idx) {
  return scopes.filter((s) => idx > s.bodyStart && idx < s.bodyEnd).sort((a, b) => (a.bodyEnd - a.bodyStart) - (b.bodyEnd - b.bodyStart));
}

// ---------------------------------------------------------------------------
// Imports (to tell a wrapper from an unrelated function of the same name)
// ---------------------------------------------------------------------------

/**
 * { localName -> { imported, from } } for `import { a, b as c } from '...'` and `import a from '...'`.
 * @returns {Record<string, { imported: string, from: string }>}
 */
export function parseImports(masked) {
  /** @type {Record<string, { imported: string, from: string }>} */
  const out = {};
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const clause = m[1];
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const x = new RegExp(`^\\s*(?:type\\s+)?(${IDENT})(?:\\s+as\\s+(${IDENT}))?\\s*$`).exec(part);
        if (x) out[x[2] || x[1]] = { imported: x[1], from: m[2] };
      }
    }
    const def = /^\s*(?:type\s+)?(IDENT)\s*(?:,|$)/.source.replace('IDENT', IDENT);
    const dm = new RegExp(def).exec(clause.replace(/\{[\s\S]*?\}/, ''));
    if (dm) out[dm[1]] = { imported: 'default', from: m[2] };
  }
  return out;
}

const baseName = (spec) => spec.replace(/\/index$/, '').split('/').pop().replace(/\.(tsx?|jsx?|mjs)$/, '');
const fileBase = (path) => path.replace(/\/index\.(tsx?|jsx?)$/, '').split('/').pop().replace(/\.(tsx?|jsx?|mjs)$/, '');

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

const RE_RPC_CALL = /\.\s*rpc\s*\(/g;
const RE_INVOKE_CALL = /\.\s*functions\s*\.\s*invoke\s*\(/g;
const RE_FROM_CALL = /\.\s*from\s*\(/g;
const RE_VERB_AFTER_FROM = /^\s*\.\s*(select|insert|update|upsert|delete)\b/;

/**
 * After `.from('t')`, the PostgREST verb and (for selects) the column list. Shared with
 * gen-architecture.mjs: columns are load-bearing, `.select('key_id')` and `.select()`
 * are different security stories.
 */
export function opAfterFrom(content, endIndex) {
  const tail = content.slice(endIndex, endIndex + 400);
  const m = tail.match(/\.\s*(select|insert|update|upsert|delete)\b/);
  if (!m) return { verb: 'select', columns: null };
  const verb = m[1];
  if (verb !== 'select') return { verb, columns: null };
  const rest = tail.slice(m.index);
  const quoted = rest.match(/^\.\s*select\(\s*(['"`])([\s\S]*?)\1/);
  if (quoted) return { verb, columns: quoted[2].replace(/\s+/g, ' ').trim() };
  if (/^\.\s*select\(\s*\)/.test(rest)) return { verb, columns: '*' };
  return { verb, columns: null };
}

/** A direct supabase call in `masked`: { kind: 'rpc'|'invoke'|'table', idx, open, args, after }. */
function directCalls(masked) {
  const calls = [];
  const grab = (re, kind) => {
    let m;
    const rx = new RegExp(re.source, 'g');
    while ((m = rx.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchClose(masked, open);
      if (close < 0) continue;
      if (kind === 'table' && !RE_VERB_AFTER_FROM.test(masked.slice(close + 1, close + 400))) continue; // Array.from(x), not a query
      calls.push({ kind, idx: m.index, open, close, args: splitTopLevel(masked, open + 1, close) });
    }
  };
  grab(RE_RPC_CALL, 'rpc');
  grab(RE_INVOKE_CALL, 'invoke');
  grab(RE_FROM_CALL, 'table');
  return calls.sort((a, b) => a.idx - b.idx);
}

const trunc = (s, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/**
 * @param files [{ path, content }]  one scan surface (the client files, or the function files)
 * @param existingKeys Set of `kind|file|line|target` the caller's literal scan already produced
 * @returns { invokes, rpcs, tableOps, unattributed, wrappers }  ADDITIONAL sites + the accounting
 */
export function analyzeCalls(files, existingKeys = new Set(), { gate = SEAM_GATE } = {}) {
  const sites = { invokes: [], rpcs: [], tableOps: [] };
  const unattributed = [];
  const wrappers = [];
  const closureCalls = []; // calls of a callback wrapper whose closure makes a visible call: accounted for, edge comes from the closure

  const info = new Map(); // path -> { content, masked, named, scopes, imports }
  for (const f of files) {
    const masked = maskComments(f.content);
    const named = findFunctions(masked);
    info.set(f.path, { ...f, masked, named, scopes: [...named, ...findAnonymousScopes(masked)], imports: parseImports(masked) });
  }

  const addSite = (kind, file, line, target, extra = {}) => {
    const key = `${kind}|${file}|${line}|${target}${kind === 'table' ? `|${extra.verb}` : ''}`;
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    if (kind === 'rpc') sites.rpcs.push({ file, line, target, ...extra });
    else if (kind === 'invoke') sites.invokes.push({ file, line, target, ...extra });
    else sites.tableOps.push({ file, line, table: target, ...extra });
  };
  const report = (file, line, kind, reason, expr) => unattributed.push({ file, line, kind, reason, expr: trunc(expr) });

  // ---- 1. direct calls: literal -> site; param -> forwarder; resolvable -> inferred; else REPORT
  const forwarders = []; // { name, file, def, kind, paramIndex, verb, columns }
  const directBySite = new Map(); // path -> direct calls (for seam-stub ops)
  for (const [path, fi] of info) {
    const calls = directCalls(fi.masked);
    directBySite.set(path, calls);
    for (const c of calls) {
      const line = lineOf(fi.masked, c.idx);
      const arg0 = c.args[0]?.text ?? '';
      const lit = literalOf(arg0);
      const op = c.kind === 'table' ? opAfterFrom(fi.masked, c.close + 1) : null;
      if (lit !== null) {
        if (c.kind === 'table') addSite('table', path, line, lit, { verb: op.verb, columns: op.columns });
        else addSite(c.kind, path, line, lit);
        continue;
      }
      const name = arg0.trim();
      // A parameter of an enclosing function? Then THIS function is a forwarder.
      let forwarded = false;
      if (isIdent(name)) {
        for (const scope of enclosing(fi.scopes, c.idx)) {
          const pi = scope.params.indexOf(name);
          if (pi >= 0) {
            if (scope.name) {
              forwarders.push({ name: scope.name, file: path, kind: c.kind, paramIndex: pi, verb: op?.verb, columns: op?.columns, line });
            } else {
              report(path, line, c.kind, 'forwards-a-parameter-of-an-anonymous-function', arg0);
            }
            forwarded = true;
            break;
          }
        }
      }
      if (forwarded) continue;
      const resolved = resolveLiterals(fi.masked, arg0, c.idx);
      if (resolved) {
        for (const t of resolved) {
          if (c.kind === 'table') addSite('table', path, line, t, { verb: op.verb, columns: op.columns, inferred: true });
          else addSite(c.kind, path, line, t, { inferred: true });
        }
        continue;
      }
      report(path, line, c.kind, /\$\{/.test(arg0) ? 'templated-name' : 'dynamic-name', arg0);
    }
  }

  // ---- 2. other wrapper shapes, from their definitions
  const stubs = []; // { name, file, ops }
  const callbacks = []; // { name, file, paramIndex }
  const defsByName = (name) => [...info.entries()].flatMap(([p, fi]) => fi.named.filter((d) => d.name === name).map((d) => ({ path: p, def: d })));

  /** Direct literal ops inside a body range, plus the ops of named functions it calls (depth-bounded). */
  const opsInBody = (path, def, depth = 0, seen = new Set()) => {
    const fi = info.get(path);
    const ops = [];
    for (const c of directBySite.get(path) ?? []) {
      if (c.idx < def.bodyStart || c.idx > def.bodyEnd) continue;
      const lit = literalOf(c.args[0]?.text ?? '');
      if (lit === null) continue;
      ops.push(c.kind === 'table' ? { kind: 'table', target: lit, ...opAfterFrom(fi.masked, c.close + 1) } : { kind: c.kind, target: lit });
    }
    if (depth >= 3) return ops;
    const body = fi.masked.slice(def.bodyStart, def.bodyEnd);
    const re = new RegExp(`(?<![.\\w$])(${IDENT})\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(body)) !== null) {
      const callee = m[1];
      if (['if', 'for', 'while', 'switch', 'return', 'function', 'catch', 'await', 'typeof', 'void', 'new'].includes(callee)) continue;
      const imported = fi.imports[callee];
      const candidates = defsByName(imported?.imported ?? callee).filter((d) =>
        d.path === path || (imported && fileBase(d.path) === baseName(imported.from)));
      for (const cand of candidates) {
        const k = `${cand.path}#${cand.def.name}`;
        if (seen.has(k) || cand.def === def) continue;
        seen.add(k);
        ops.push(...opsInBody(cand.path, cand.def, depth + 1, seen));
      }
    }
    return ops;
  };

  const gateRe = new RegExp(`(?:^|[;{}\\s])if\\s*\\(\\s*${gate}\\s*\\)\\s*(?:return\\b|\\{[^}]*?\\breturn\\b)`);
  for (const [path, fi] of info) {
    for (const def of fi.named) {
      if (!def.name) continue;
      // callback wrapper: a parameter that is CALLED in the body, in a function that is itself
      // gated by the dev seam (it chooses between a fixture and the caller's real closure).
      // A callback parameter alone is far too common (any pure helper taking a `price` fn).
      const wholeBody = fi.masked.slice(def.bodyStart, def.bodyEnd);
      if (new RegExp(`\\b${gate}\\b`).test(wholeBody)) {
        def.params.forEach((p, idx) => {
          if (p && new RegExp(`(?<![.\\w$])${p.replace(/\$/g, '\\$')}\\s*\\(`).test(wholeBody)) callbacks.push({ name: def.name, file: path, paramIndex: idx });
        });
      }
      // seam stub: `if (SEAM_ON) return ...` as a TOP-LEVEL statement of the body, then real ops
      const body = fi.masked.slice(def.bodyStart + 1, def.bodyEnd);
      const top = topLevelOnly(body);
      if (gateRe.test(top)) {
        const ops = dedupeOps(opsInBody(path, def));
        if (ops.length) stubs.push({ name: def.name, file: path, ops, line: lineOf(fi.masked, def.defIdx) });
      }
    }
  }

  for (const f of forwarders) wrappers.push({ name: f.name, file: f.file, line: f.line, kind: `forwarder:${f.kind}`, detail: `argument ${f.paramIndex} is the ${f.kind === 'table' ? 'table' : f.kind === 'rpc' ? 'RPC' : 'function'} name` });
  for (const s of stubs) wrappers.push({ name: s.name, file: s.file, line: s.line, kind: 'seam-stub', detail: s.ops.map((o) => o.kind === 'table' ? `${o.target}.${o.verb}` : `${o.kind}:${o.target}`).join(', ') });
  for (const c of callbacks) wrappers.push({ name: c.name, file: c.file, line: 0, kind: 'callback', detail: `argument ${c.paramIndex} is a closure that makes the real call` });

  // ---- 3. wrapper CALLS -> sites (or REPORT)
  const all = [
    ...forwarders.map((w) => ({ ...w, shape: 'forwarder' })),
    ...stubs.map((w) => ({ ...w, shape: 'stub' })),
    ...callbacks.map((w) => ({ ...w, shape: 'callback' })),
  ];
  const byName = new Map();
  for (const w of all) { if (!byName.has(w.name)) byName.set(w.name, []); byName.get(w.name).push(w); }

  for (const [path, fi] of info) {
    const ignored = [];
    const reImp = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w$*{][\s\S]*?)\s+from\s+['"][^'"]+['"]|(?:^|[\s;])export\s*\{[^}]*\}/g;
    let im;
    while ((im = reImp.exec(fi.masked)) !== null) ignored.push([im.index, im.index + im[0].length]);
    for (const w of all) if (w.file === path) {
      const d = fi.named.find((x) => x.name === w.name);
      if (d) ignored.push([d.defIdx, d.bodyStart]);
    }
    for (const [name, defs] of byName) {
      // the names this file can call it by, and whether it is the same wrapper at all
      const locals = new Set();
      for (const [local, imp] of Object.entries(fi.imports)) {
        if (imp.imported === name && defs.some((d) => fileBase(d.file) === baseName(imp.from))) locals.add(local);
      }
      const here = defs.filter((d) => d.file === path);
      if (here.length) locals.add(name);
      for (const local of locals) {
        const re = new RegExp(`(?<![.\\w$])${local.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
        let m;
        while ((m = re.exec(fi.masked)) !== null) {
          // Not a use: an import/export specifier, or the wrapper's own definition header.
          if (ignored.some(([a, b]) => m.index >= a && m.index < b)) continue;
          const line = lineOf(fi.masked, m.index);
          let k = m.index + local.length;
          while (/\s/.test(fi.masked[k] ?? '')) k++;
          // explicit type arguments: `seamTable<{ symbol: string }>('draft_queue', ...)`
          if (fi.masked[k] === '<') {
            let angle = 0;
            let j = k;
            for (; j < fi.masked.length; j++) {
              const c = fi.masked[j];
              if (c === '{' || c === '(' || c === '[') { const e = matchClose(fi.masked, j); if (e < 0) break; j = e; continue; }
              if (c === '<') angle++;
              else if (c === '>' && fi.masked[j - 1] !== '=') { angle--; if (angle === 0) break; }
            }
            k = j + 1;
            while (/\s/.test(fi.masked[k] ?? '')) k++;
          }
          if (fi.masked[k] !== '(') {
            report(path, line, `wrapper:${name}`, 'wrapper-used-as-a-value', name);
            continue;
          }
          const close = matchClose(fi.masked, k);
          if (close < 0) continue;
          const args = splitTopLevel(fi.masked, k + 1, close);
          for (const w of defs) {
            if (w.shape === 'forwarder') {
              const a = args[w.paramIndex]?.text ?? '';
              const lit = literalOf(a);
              const resolved = lit !== null ? [lit] : resolveLiterals(fi.masked, a, m.index);
              if (!resolved) { report(path, line, `wrapper:${name}`, /\$\{/.test(a) ? 'templated-name' : 'dynamic-name', a); continue; }
              for (const t of resolved) {
                const x = { via: name, inferred: lit === null };
                if (w.kind === 'table') addSite('table', path, line, t, { verb: w.verb ?? 'select', columns: w.columns ?? null, ...x });
                else addSite(w.kind, path, line, t, x);
              }
            } else if (w.shape === 'stub') {
              if (path === w.file) continue; // its own direct calls are already sites
              for (const o of w.ops) {
                if (o.kind === 'table') addSite('table', path, line, o.target, { verb: o.verb, columns: o.columns, via: name });
                else addSite(o.kind, path, line, o.target, { via: name });
              }
            } else {
              if (path === w.file) continue;
              const cb = args[w.paramIndex]?.text ?? '';
              if (/\.\s*(?:rpc|from|functions\s*\.\s*invoke)\s*\(/.test(cb)) closureCalls.push({ file: path, line, wrapper: name });
              else report(path, line, `wrapper:${name}`, 'callback-without-a-visible-call', cb);
            }
          }
        }
      }
    }
  }

  return { ...sites, unattributed: dedupeReports(unattributed), wrappers, closureCalls };
}

/** `body` with everything nested inside any bracket blanked, so only top-level statements remain. */
function topLevelOnly(body) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') { const e = skipLiteral(body, i); out += ' '.repeat(e - i); i = e - 1; continue; }
    if (c === '{') {
      // keep the braces of an `if (GATE) {` so the gate regex can see its `return`
      const before = out.slice(-40);
      if (depth === 0 && /if\s*\(\s*\w+\s*\)\s*$/.test(before)) {
        const close = matchClose(body, i);
        if (close > 0) { out += body.slice(i, close + 1); i = close; continue; }
      }
      depth++;
      out += ' ';
      continue;
    }
    if (c === '}') { depth--; out += ' '; continue; }
    out += depth === 0 ? c : (c === '\n' ? '\n' : ' ');
  }
  return out;
}

function dedupeOps(ops) {
  const seen = new Set();
  return ops.filter((o) => { const k = `${o.kind}|${o.target}|${o.verb ?? ''}|${o.columns ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function dedupeReports(list) {
  const seen = new Set();
  return list.filter((r) => { const k = `${r.file}:${r.line}|${r.kind}|${r.reason}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
