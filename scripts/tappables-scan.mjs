/**
 * tappables-scan.mjs: the pure half of the dead-controls audit (W8). No fs, no deps.
 *
 * Shared by `scripts/gen-tappables.mjs` (writes docs/design/reviews/tappables.md) and
 * `apps/mobile/tests-deno/no-op-handlers.test.ts` (fails on a silent no-op), so the
 * inventory and the check can never disagree about what a tappable or a no-op is.
 *
 * It is a scanner, not a TypeScript parser. Comments and string contents are masked
 * first (offsets kept), so a `<Pressable>` named in a comment or a string is never an
 * element. Known blind spots, by design: a JS string with an apostrophe in JSX text on
 * the SAME line as an element; regex literals containing quotes; elements created
 * without JSX (React.createElement). None occur in apps/mobile today.
 */

/** Elements that are tappable by type, whatever props they carry. */
export const TAPPABLE_TYPES = new Set([
  'Pressable',
  'PressableScale',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'Link',
]);

/**
 * Props that make an element a tappable in the inventory: the press family, plus the
 * action props composites forward to an inner Pressable (EmptyState's onAction, a
 * failure card's onRetry, a SegmentedControl's onChange).
 */
export const TAP_PROPS = new Set([
  'onPress',
  'onLongPress',
  'onAction',
  'onSecondaryAction',
  'onRetry',
  'onSelect',
  'onValueChange',
]);

/** `onChange` is a tap on a control (segments, pills, tabs), a keystroke on a field. */
const TEXT_FIELDS = /^(TextInput|Field|SymbolSearchField|BottomSheetTextInput)$/;

/**
 * Callback props the no-op check ignores: none today. A no-op on ANY `on*` prop is
 * flagged, because a composite can turn any callback into a control (EmptyState's
 * onAction is a button). Add an entry only with the reason the no-op is the job.
 */
export const NO_OP_PROP_ALLOW = new Map();

/**
 * No-ops that are deliberate, each with where its reason lives. A finding is allowed
 * when it is in `file` and its source line contains `snippet`. Keep this short: the
 * fix is almost always "does its job" or "hidden / disabled with its reason". An
 * object literal that carries its own `disabled: true` is accepted without an entry.
 */
export const NO_OP_ALLOW = [
  {
    file: 'app/join-league.tsx',
    snippet: "{ label: 'Join', onPress: undefined }",
    reason: "disabled with its reason: the Button sets disabled={view.action === 'join_disabled'}, an action that only comes from block 'left_league', whose blockMessage renders in the WarnPanel above the button",
  },
];

// ---------------------------------------------------------------------------
// masking
// ---------------------------------------------------------------------------

/**
 * Same-length copy of `src` with comment text and string contents replaced by spaces
 * (newlines kept, so offsets and line numbers match the original). Quotes stay.
 * A ' or " string must close on its own line (JS strings cannot span lines), so an
 * apostrophe in JSX text ("Don't") is left alone instead of swallowing the file.
 */
export function mask(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  // Template-literal nesting: each entry is the brace depth at which a `${` opened.
  const tpl = [];
  let depth = 0;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (tpl.length && depth === tpl[tpl.length - 1] && c === '}') {
      // Close of `${ ... }`: resume the template body.
      tpl.pop();
      i = scanTemplate(i + 1);
      continue;
    }
    if (c === '/' && next === '/' && src[i - 1] !== ':' && src[i - 1] !== '\\') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (j < n && src[j] === c) {
        blank(i + 1, j);
        i = j + 1;
      } else i++;
      continue;
    }
    if (c === '`') {
      i = scanTemplate(i + 1);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return out.join('');

  // Masks a template body from `start` to its closing backtick, or stops at `${`.
  function scanTemplate(start) {
    let j = start;
    while (j < n) {
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === '`') {
        blank(start, j);
        return j + 1;
      }
      if (src[j] === '$' && src[j + 1] === '{') {
        blank(start, j);
        tpl.push(depth);
        return j + 2;
      }
      j++;
    }
    blank(start, n);
    return n;
  }
}

// ---------------------------------------------------------------------------
// JSX elements
// ---------------------------------------------------------------------------

export function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** End offset (exclusive) of a balanced `{...}` starting at `start` in masked text. */
function braceEnd(m, start) {
  let d = 0;
  for (let i = start; i < m.length; i++) {
    if (m[i] === '{') d++;
    else if (m[i] === '}') {
      d--;
      if (d === 0) return i + 1;
    }
  }
  return m.length;
}

/**
 * Every capitalised JSX opening tag in `src`: its name, line and attributes (raw value
 * text from the ORIGINAL source, so strings and comments survive for reporting).
 * A `<` straight after an identifier is a generic (`useState<T>`), never an element.
 */
export function jsxElements(src, masked = mask(src)) {
  const out = [];
  const re = /<([A-Z][\w.]*)(?=[\s/>])/g;
  let mt;
  while ((mt = re.exec(masked))) {
    const before = masked[mt.index - 1];
    if (before && /[\w$.]/.test(before)) continue;
    const name = mt[1];
    const attrs = [];
    let i = mt.index + 1 + name.length;
    let closed = false;
    while (i < masked.length) {
      while (/\s/.test(masked[i])) i++;
      if (masked[i] === '>') {
        closed = true;
        i++;
        break;
      }
      if (masked[i] === '/' && masked[i + 1] === '>') {
        closed = true;
        i += 2;
        break;
      }
      if (masked[i] === '{') {
        const end = braceEnd(masked, i);
        attrs.push({ name: '...', value: src.slice(i + 1, end - 1).trim(), line: lineAt(src, i), spread: true });
        i = end;
        continue;
      }
      const nm = /^[A-Za-z_][\w:.-]*/.exec(masked.slice(i, i + 80));
      if (!nm) break; // not JSX after all (a comparison, a type): stop quietly
      const attrStart = i;
      i += nm[0].length;
      while (masked[i] === ' ') i++;
      if (masked[i] !== '=') {
        attrs.push({ name: nm[0], value: 'true', line: lineAt(src, attrStart) });
        continue;
      }
      i++;
      while (/\s/.test(masked[i])) i++;
      if (masked[i] === '"' || masked[i] === "'") {
        const q = masked[i];
        const end = masked.indexOf(q, i + 1);
        attrs.push({ name: nm[0], value: src.slice(i, end + 1), line: lineAt(src, attrStart) });
        i = end + 1;
      } else if (masked[i] === '{') {
        const end = braceEnd(masked, i);
        attrs.push({ name: nm[0], value: src.slice(i + 1, end - 1).trim(), maskedValue: masked.slice(i + 1, end - 1).trim(), line: lineAt(src, attrStart) });
        i = end;
      } else break;
    }
    if (!closed) continue;
    out.push({ name, line: lineAt(src, mt.index), index: mt.index, attrs });
  }
  return out;
}

// ---------------------------------------------------------------------------
// handlers and destinations
// ---------------------------------------------------------------------------

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
/** Comments out of a handler label (a URL's `//` survives: it follows a colon). */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The body text of a function named `name` declared in this file (`function name(`,
 * `const name = (...) =>`, `const name = useCallback((...) =>`), or null.
 */
export function namedFunctionBody(src, masked, name) {
  const esc = name.replace(/[$]/g, '\\$');
  const decl = new RegExp(
    `(?:function\\s+${esc}\\s*\\(|(?:const|let)\\s+${esc}\\s*(?::[^=]+)?=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=>)`,
  );
  const m = decl.exec(masked);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (m[0].startsWith('function')) {
    // skip the parameter list, then any return type, to the body brace
    let d = 1;
    while (i < masked.length && d) {
      if (masked[i] === '(') d++;
      else if (masked[i] === ')') d--;
      i++;
    }
    i = masked.indexOf('{', i);
    return src.slice(i, braceEnd(masked, i));
  }
  while (/\s/.test(masked[i])) i++;
  if (masked[i] === '{') return src.slice(i, braceEnd(masked, i));
  // expression body: up to the end of the statement on this line
  const eol = masked.indexOf('\n', i);
  return src.slice(i, eol === -1 ? masked.length : eol);
}

const ARROW = /^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>\s*/;
const FN = /^(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*/;

/** True when `body` (a `{...}` block) holds nothing but whitespace and comments. */
function emptyBlock(body) {
  if (!body.startsWith('{')) return false;
  const inner = mask(body.slice(1, -1));
  return inner.trim() === '';
}

/**
 * Why `value` (a JSX prop expression) is a no-op, or null when it does something.
 * Resolves a bare identifier to its declaration in the same file, one level.
 */
export function noOpReason(value, src, masked) {
  const v = value.trim();
  if (/^(undefined|null|void 0)$/.test(v)) return `bare ${v}`;
  if (/^noop$/i.test(v) || /^[\w.]*\.noop$/i.test(v)) return 'noop';
  const arrow = ARROW.exec(v) ?? FN.exec(v);
  if (arrow) {
    const body = v.slice(arrow[0].length).trim();
    if (/^(undefined|null|void 0)$/.test(body)) return `returns ${body}`;
    if (emptyBlock(body)) return /TODO|FIXME/.test(body) ? 'TODO only' : body.length > 2 ? 'comment only' : 'empty body';
    return null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(v)) {
    const body = namedFunctionBody(src, masked, v);
    if (body == null) return null;
    const b = body.trim();
    if (/^(undefined|null|void 0);?$/.test(b)) return `${v} returns ${b}`;
    if (emptyBlock(b)) return `${v}: ${/TODO|FIXME/.test(b) ? 'TODO only' : 'empty body'}`;
  }
  return null;
}

/**
 * Where a handler goes, from its text: a route, a sheet, a URL, a share or an alert.
 * Calls are found on the MASKED text (a `)` inside '/(tabs)/league' is not a paren),
 * and their arguments read back from the original.
 */
export function destinationOf(text) {
  const t = oneLine(stripComments(text));
  const m = mask(t);
  const found = [];
  const push = (s) => {
    if (!found.includes(s)) found.push(s);
  };
  const args = (re, fmt) => {
    for (const x of m.matchAll(re)) {
      const open = x.index + x[0].length;
      const close = valueEnd(m, open);
      fmt(x, t.slice(open, close).trim().slice(0, 50));
    }
  };
  args(/router\.(push|replace|navigate|dismissTo)\(/g, (x, a) => push(`route ${x[1]}(${a})`));
  if (/router\.(back|dismiss)\(\)/.test(m)) push('route back');
  args(/navigation\.navigate\(/g, (_x, a) => push(`tab ${a}`));
  args(/Linking\.openURL\(/g, (_x, a) => push(`url ${a}`));
  if (/Share\.share\(/.test(m)) push('share sheet');
  if (/Alert\.alert\(/.test(m)) push('alert');
  args(/\b(set\w*(?:Sheet|Visible|Open|Show|Modal|Picker|Confirm)\w*)\(/g, (x, a) => push(`sheet ${x[1]}(${a})`));
  return found;
}

/**
 * The inventory row facts for one prop: handler label and destination.
 * `propNames` are the enclosing component's own props (a pass-through is the caller's).
 */
export function describeHandler(value, src, masked, propNames) {
  const v = value.trim();
  const isName = /^[A-Za-z_$][\w$.]*$/.test(v);
  const handler = isName ? v : `inline: ${oneLine(stripComments(v)).slice(0, 60)}`;
  let dest = destinationOf(v);
  if (isName && !v.includes('.')) {
    if (propNames.has(v)) dest = [`prop ${v} (the caller's)`];
    else {
      const body = namedFunctionBody(src, masked, v);
      if (body) {
        dest = destinationOf(body);
        if (!dest.length) dest = [`fn ${v}`];
      } else if (/^on[A-Z]/.test(v)) dest = [`prop ${v} (the caller's)`];
      else if (/^set[A-Z]/.test(v)) dest = [`state ${v}`];
      else dest = [`fn ${v} (from a hook or import)`];
    }
  } else if (isName) dest = [`prop ${v}`];
  if (!dest.length) {
    const bare = /\?\s*([A-Za-z_$][\w$]*)\s*:\s*undefined$/.exec(v);
    const calls = [...mask(v).matchAll(/([A-Za-z_$][\w$.]*)\(/g)]
      .map((c) => c[1])
      .filter((c) => !/^(Haptics\..*|catch|then|.*\.catch|.*\.then|void|async|if|Number|String|Boolean|Date\.now|Platform\..*)$/.test(c));
    if (bare) dest = [`fn ${bare[1]} (conditional)`];
    else if (calls.length) dest = [`${/^set[A-Z]/.test(calls[0]) ? 'state' : 'fn'} ${calls[0]}`];
  }
  return { handler, destination: dest.join('; ') || '—' };
}

/** Prop names the components in `src` destructure (`function X({ a, b }: P)` / `= ({ a }) =>`). */
export function componentPropNames(masked) {
  const names = new Set();
  for (const m of masked.matchAll(/(?:function\s+[A-Z]\w*\s*\(\s*\{|=\s*\(\s*\{)([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const id = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(part);
      if (id) names.add(id[1]);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// the two products
// ---------------------------------------------------------------------------

function isTapProp(elName, propName) {
  if (TAP_PROPS.has(propName)) return true;
  return propName === 'onChange' && !TEXT_FIELDS.test(elName);
}

/**
 * Inventory rows for one file: every tappable element (by type, or by a tap prop).
 * One row per tap prop; a tappable-by-type element with no tap prop gets one row
 * whose handler says what it has instead (a spread, a Link href, or nothing).
 */
export function inventoryFile(file, src) {
  const masked = mask(src);
  const propNames = componentPropNames(masked);
  const rows = [];
  for (const el of jsxElements(src, masked)) {
    const tapAttrs = el.attrs.filter((a) => !a.spread && isTapProp(el.name, a.name));
    const byType = TAPPABLE_TYPES.has(el.name);
    if (!tapAttrs.length && !byType) continue;
    const disabledAttr = el.attrs.find((a) => a.name === 'disabled');
    const disabled = disabledAttr ? oneLine(disabledAttr.value).slice(0, 40) : '';
    if (!tapAttrs.length) {
      const href = el.attrs.find((a) => a.name === 'href');
      const spread = el.attrs.find((a) => a.spread);
      rows.push({
        file,
        line: el.line,
        element: el.name,
        prop: href ? 'href' : spread ? '...' : '—',
        handler: href ? oneLine(href.value).slice(0, 60) : spread ? `spread {...${spread.value.replace(/^\.\.\./, '')}}` : '(none)',
        destination: href ? `route ${oneLine(href.value).slice(0, 50)}` : spread ? `props of ${spread.value.replace(/^\.\.\./, '')}` : '—',
        disabled,
      });
      continue;
    }
    for (const a of tapAttrs) {
      const { handler, destination } = describeHandler(a.value, src, masked, propNames);
      rows.push({ file, line: a.line, element: el.name, prop: a.name, handler, destination, disabled });
    }
  }
  return rows;
}

/** No-op findings for one file: any `on*` prop whose handler does nothing. */
export function noOpFindings(file, src) {
  const masked = mask(src);
  const findings = [];
  for (const el of jsxElements(src, masked)) {
    for (const a of el.attrs) {
      if (a.spread || !/^on[A-Z]/.test(a.name) || NO_OP_PROP_ALLOW.has(a.name)) continue;
      const reason = noOpReason(a.value, src, masked);
      if (reason) findings.push({ file, line: a.line, element: el.name, prop: a.name, reason, value: oneLine(a.value).slice(0, 60) });
    }
  }
  findings.push(...objectNoOps(file, src, masked));
  // A `noop` helper anywhere is a no-op waiting to be wired in.
  for (const m of masked.matchAll(/\bnoop\b/gi)) {
    const line = lineAt(src, m.index);
    if (!findings.some((f) => f.line === line)) findings.push({ file, line, element: '—', prop: '—', reason: 'noop identifier', value: 'noop' });
  }
  const srcLines = src.split('\n');
  return findings.filter((f) => !NO_OP_ALLOW.some((a) => a.file === file && (srcLines[f.line - 1] ?? '').includes(a.snippet)));
}

/** End of an object-literal value starting at `i`: the `,` / `}` / `)` / `]` / `;` at depth 0. */
function valueEnd(m, i) {
  let d = 0;
  for (; i < m.length; i++) {
    const c = m[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') {
      if (d === 0) return i;
      d--;
    } else if (d === 0 && (c === ',' || c === ';' || c === '\n')) return i;
  }
  return i;
}

/** The innermost `{ ... }` object literal around offset `at` in masked text. */
function enclosingLiteral(m, at) {
  let d = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (m[i] === '}') d++;
    else if (m[i] === '{') {
      if (d === 0) {
        start = i;
        break;
      }
      d--;
    }
  }
  if (start === -1) return null;
  return { start, end: braceEnd(m, start) };
}

/**
 * `{ onPress: () => {} }` and friends: handlers built as data (an AuthScaffold back
 * action, a primary-button descriptor, a player-card action) never appear as a JSX
 * attribute, so the attribute scan alone would miss them. A TypeScript member
 * (`onPress: () => void`) is not a no-op and is not flagged.
 */
export function objectNoOps(file, src, masked = mask(src)) {
  const out = [];
  for (const m of masked.matchAll(/([{,]\s*)(on[A-Z]\w*)\s*:\s*/g)) {
    const vStart = m.index + m[0].length;
    const value = src.slice(vStart, valueEnd(masked, vStart)).trim();
    const reason = noOpReason(value, src, masked);
    if (!reason) continue;
    const lit = enclosingLiteral(masked, m.index + m[1].length);
    const literal = lit ? src.slice(lit.start, lit.end) : '';
    if (/\bdisabled\s*:\s*true\b/.test(literal)) continue; // disabled in the same breath
    out.push({ file, line: lineAt(src, m.index + m[1].length), element: '{…}', prop: m[2], reason, value: oneLine(literal || value).slice(0, 60) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// the committed inventory (docs/design/reviews/tappables.md)
// ---------------------------------------------------------------------------

/** Files the inventory and the check skip: the dev-only gallery is a catalogue of demos. */
export const EXCLUDED_FILES = new Set(['app/design-gallery.tsx']);

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * The markdown for docs/design/reviews/tappables.md from `[path, source]` pairs (paths
 * relative to apps/mobile, already filtered to app/ and components/, sorted). Pure, so
 * the Deno test can rebuild it from the source manifest and compare.
 */
export function renderTappables(files) {
  const rows = [];
  const findings = [];
  for (const [f, src] of files) {
    if (EXCLUDED_FILES.has(f)) continue;
    rows.push(...inventoryFile(f, src));
    findings.push(...noOpFindings(f, src));
  }
  const fileCount = new Set(rows.map((r) => r.file)).size;
  const disabledRows = rows.filter((r) => r.disabled);
  const passThrough = rows.filter((r) => /^prop /.test(r.destination)).length;

  const lines = [];
  lines.push('<!-- GENERATED by scripts/gen-tappables.mjs. Do not hand-edit: run `node scripts/gen-tappables.mjs`. -->');
  lines.push('');
  lines.push('# Tappables inventory (W8)');
  lines.push('');
  lines.push(
    'Every tappable element in `apps/mobile/app` and `apps/mobile/components` (the dev-only `design-gallery.tsx` excluded), ' +
      'with its handler and, where the code says, its destination. PRODUCT_RULES, "Nothing tappable does nothing": ' +
      'every control either does its job, or is not shown / disabled with its reason.',
  );
  lines.push('');
  lines.push(`- **${rows.length}** tappables in **${fileCount}** files.`);
  lines.push(`- **${passThrough}** forward a prop (\`prop …\`): the destination is the caller's, listed at the call site.`);
  lines.push(`- **${disabledRows.length}** carry a \`disabled\` expression: whether its reason is visible is checked on the simulator pass (W8 part 2).`);
  lines.push(`- Static no-op check (\`apps/mobile/tests-deno/no-op-handlers.test.ts\`): **${findings.length}** finding${findings.length === 1 ? '' : 's'}.`);
  lines.push('');
  lines.push('Destination kinds: `route` (expo-router), `tab` (tab bar), `sheet` (a state setter that opens a sheet or modal), ' +
    '`state` (a state setter in place), `share sheet`, `alert`, `url`, `fn` (a function, named), `prop` (forwarded to the caller).');
  lines.push('');
  if (findings.length) {
    lines.push('## No-op findings');
    lines.push('');
    lines.push('| Where | Element | Prop | Why | Value |');
    lines.push('|---|---|---|---|---|');
    for (const x of findings) lines.push(`| \`${x.file}:${x.line}\` | ${cell(x.element)} | ${x.prop} | ${cell(x.reason)} | \`${cell(x.value)}\` |`);
    lines.push('');
  }
  lines.push('## Inventory');
  lines.push('');
  lines.push('| Where | Element | Prop | Handler | Destination | Disabled when |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(
      `| \`${r.file}:${r.line}\` | ${cell(r.element)} | ${cell(r.prop)} | \`${cell(r.handler)}\` | ${cell(r.destination)} | ${r.disabled ? `\`${cell(r.disabled)}\`` : ''} |`,
    );
  }
  lines.push('');
  return { markdown: lines.join('\n'), rows, findings };
}
