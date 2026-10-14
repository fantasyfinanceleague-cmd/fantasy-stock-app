/**
 * W8 dead-controls audit, the static half (Giorgio, 2026-10-12: "we can't have buttons
 * that don't do anything, links that don't do anything"; PRODUCT_RULES "Nothing
 * tappable does nothing"). Fails on a silent no-op handler anywhere in the app outside
 * the dev-only design-gallery.tsx: `() => {}`, `undefined`, `noop`, a body that is
 * only a comment or a TODO, a named handler declared empty, and the same shapes built
 * as data (`{ label, onPress: () => {} }`). A control that can't act is hidden, or
 * disabled with its reason (an object literal carrying `disabled: true`, or an entry
 * in NO_OP_ALLOW naming where the reason shows).
 *
 * The scanner is scripts/tappables-scan.mjs, the same one that writes
 * docs/design/reviews/tappables.md, so the check and the inventory agree.
 * Whether a `disabled` control's reason is VISIBLE is not decidable from source; the
 * inventory lists every `disabled` expression for the simulator pass (W8 part 2).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { EXCLUDED_FILES, NO_OP_ALLOW, inventoryFile, noOpFindings, renderTappables } from '../../../scripts/tappables-scan.mjs';
import committed from '../../../docs/design/reviews/tappables.md' with { type: 'text' };

const appFiles = Object.keys(SOURCES).filter((f) => /^(app|components|lib)\//.test(f) && !EXCLUDED_FILES.has(f));

type Finding = { file: string; line: number; prop: string; reason: string; value: string };
const show = (fs: Finding[]) => fs.map((x) => `${x.file}:${x.line} ${x.prop} (${x.reason}): ${x.value}`).join('\n');

Deno.test('no handler in the app is a silent no-op (design-gallery.tsx excepted)', () => {
  assert(appFiles.length > 300, 'the source manifest lost the app: regenerate it');
  const findings: Finding[] = appFiles.flatMap((f) => noOpFindings(f, SOURCES[f]));
  assertEquals(findings.length, 0, `no-op handlers (does its job, or hidden / disabled with its reason):\n${show(findings)}`);
});

Deno.test('every NO_OP_ALLOW entry still excuses a line that exists (no stale waivers)', () => {
  for (const a of NO_OP_ALLOW as { file: string; snippet: string; reason: string }[]) {
    assert(SOURCES[a.file]?.includes(a.snippet), `stale NO_OP_ALLOW entry: ${a.file} no longer contains ${a.snippet}`);
    assert(a.reason.length > 40, `NO_OP_ALLOW entry for ${a.file} needs its reason`);
  }
});

Deno.test('docs/design/reviews/tappables.md is current (run `node scripts/gen-tappables.mjs`)', () => {
  const inventoried = Object.keys(SOURCES)
    .filter((f) => /^(app|components)\//.test(f))
    .map((f) => [f, SOURCES[f]]);
  assertEquals(renderTappables(inventoried).markdown, committed);
});

// ---------------------------------------------------------------------------
// The detector itself: every shape it must catch, and what it must leave alone.
// A green app is only evidence if the scan can see a red one.
// ---------------------------------------------------------------------------

const reasons = (src: string) => (noOpFindings('fixture.tsx', src) as Finding[]).map((f) => `${f.prop}: ${f.reason}`);

Deno.test('detector: catches every no-op shape on a JSX prop', () => {
  assertEquals(reasons('<Button label="Go" onPress={() => {}} />'), ['onPress: empty body']);
  assertEquals(reasons('<Pressable onPress={undefined}><Text>x</Text></Pressable>'), ['onPress: bare undefined']);
  assertEquals(reasons('<Pressable onPress={null} />'), ['onPress: bare null']);
  assertEquals(reasons('<ListRow title="a" onPress={() => undefined} />'), ['onPress: returns undefined']);
  assertEquals(reasons('<Chip onPress={async () => {}} />'), ['onPress: empty body']);
  assertEquals(reasons('<Chip onPress={(_e) => {}} />'), ['onPress: empty body']);
  assertEquals(reasons('<Chip onPress={function () {}} />'), ['onPress: empty body']);
  assertEquals(reasons('<Button\n  onPress={() => {\n    // wired later\n  }}\n/>'), ['onPress: comment only']);
  assertEquals(reasons('<Button onPress={() => { /* TODO: open the sheet */ }} />'), ['onPress: TODO only']);
  // Any `on*` prop: a composite turns its callback into a button (EmptyState's onAction).
  assertEquals(reasons('<EmptyState title="t" actionLabel="Create" onAction={() => {}} />'), ['onAction: empty body']);
  assertEquals(reasons('<LoadFailure onRetry={() => {}} />'), ['onRetry: empty body']);
});

Deno.test('detector: resolves a named handler declared empty in the same file', () => {
  assertEquals(reasons('const handleGo = () => {};\n<Button onPress={handleGo} />'), ['onPress: handleGo: empty body']);
  assertEquals(reasons('function handleGo() {\n  // TODO\n}\n<Button onPress={handleGo} />'), ['onPress: handleGo: TODO only']);
  assertEquals(reasons('const handleGo = useCallback(() => {}, []);\n<Button onPress={handleGo} />'), ['onPress: handleGo: empty body']);
});

Deno.test('detector: a noop helper is flagged wherever it appears', () => {
  assertEquals(reasons('import { noop } from "./util";\n<Button onPress={noop} />'), ['onPress: noop', '—: noop identifier']);
  assertEquals(reasons('const handlers = { press: noop };'), ['—: noop identifier']);
});

Deno.test('detector: handlers built as data are checked too', () => {
  assertEquals(reasons("<AuthScaffold back={{ label: 'Back', onPress: () => {} }} />"), ['onPress: empty body']);
  assertEquals(reasons("const primary = { label: 'Join', onPress: undefined };"), ['onPress: bare undefined']);
  // Disabled in the same literal, with a note: the rule's "disabled with its reason".
  assertEquals(reasons("const a = { label: 'Draft', onPress: undefined, disabled: true, note: 'Not your turn' };"), []);
});

Deno.test('detector: real handlers, conditional handlers and TypeScript members are not no-ops', () => {
  assertEquals(reasons("<Button onPress={() => router.push('/league')} />"), []);
  assertEquals(reasons('<Button onPress={() => {\n  // Opening writes nothing.\n  setOpen(true);\n}} />'), []);
  assertEquals(reasons('const go = () => setOpen(true);\n<Button onPress={go} />'), []);
  assertEquals(reasons('<Pressable onPress={view.enabled ? onPress : undefined} disabled={!view.enabled} />'), []);
  assertEquals(reasons('type P = { onPress: () => void; onClose?: () => void };'), []);
  assertEquals(reasons('interface P {\n  onAction: () => void;\n}'), []);
  // Inner empties that are not the handler: a swallowed haptics promise.
  assertEquals(reasons('<Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(v); }} />'), []);
  // Comments and strings never make elements.
  assertEquals(reasons("// <Button onPress={() => {}} />\nconst s = '<Button onPress={() => {}} />';"), []);
});

Deno.test('inventory: a row names the handler and its destination', () => {
  const rows = inventoryFile(
    'x.tsx',
    [
      'function Card({ onRetry }: P) {',
      "  const openSheet = () => setSheetOpen(true);",
      '  return (<>',
      "    <Button label=\"League\" onPress={() => router.push('/(tabs)/league')} />",
      '    <Pressable onPress={openSheet} disabled={busy} />',
      '    <LoadFailure onRetry={onRetry} />',
      '  </>);',
      '}',
    ].join('\n'),
  ) as { line: number; element: string; prop: string; handler: string; destination: string; disabled: string }[];
  assertEquals(
    rows.map((r) => [r.line, r.element, r.prop, r.destination, r.disabled]),
    [
      [4, 'Button', 'onPress', "route push('/(tabs)/league')", ''],
      [5, 'Pressable', 'onPress', 'sheet setSheetOpen(true)', 'busy'],
      [6, 'LoadFailure', 'onRetry', "prop onRetry (the caller's)", ''],
    ],
  );
});
