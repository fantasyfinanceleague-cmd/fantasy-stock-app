/**
 * Sheet scroll + pinned action (P1, Design Lead, 2026-10-16). The stock sheet had no scroll view: at
 * XXXL Dynamic Type its lower half was clipped and "Review buy" could not be reached. The ruling:
 * the CONTENT scrolls, the ACTION (with the reason line a disabled one carries) is pinned in a
 * footer outside the scroll, on the sheet's own surface, no rule line above it (§9C). At Large the
 * sheet is content-sized, so the footer sits where the button sat inline (pixel-identical).
 *
 * These are structural pins on the source (a render needs the device): for each fixed sheet, the
 * action is inside the `footer` slot of <SheetBody> and NOT inside the scroll children, and the
 * Large-size spacing is conserved. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

/** Source without comments, so a pin never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

function src(path: string): string {
  const s = SOURCES[path];
  assert(s !== undefined, `${path} is in the source manifest`);
  return code(s);
}

/** The text of the balanced `{...}` / `(...)` group that opens at `open` (the index of its opener). */
function group(text: string, open: number): string {
  const pairs: Record<string, string> = { '{': '}', '(': ')' };
  const opener = text[open];
  const closer = pairs[opener];
  assert(closer, `an opener at ${open}`);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

/** The `footer={...}` slot of the <SheetBody ...> that starts at or after `from`. */
function footerSlot(text: string, from = 0): string {
  const at = text.indexOf('footer={', text.indexOf('<SheetBody', from));
  assert(at >= 0, 'a <SheetBody footer={...}>');
  const slot = group(text, at + 'footer='.length);
  // `footer={footer}` names a `const footer = (...)` built above.
  if (slot.trim() === 'footer') return group(text, text.indexOf('const footer = (') + 'const footer = '.length);
  return slot;
}

/** What a <SheetBody> scrolls: its children (the text between its open tag and its close tag). */
function scrollPart(text: string, from = 0): string {
  const open = text.indexOf('<SheetBody', from);
  assert(open >= 0, 'a <SheetBody>');
  // The open tag ends at the first `>` outside braces.
  let depth = 0;
  let i = open;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    else if (text[i] === '>' && depth === 0) break;
  }
  const close = text.indexOf('</SheetBody>', i);
  assert(close >= 0, 'a </SheetBody>');
  return text.slice(i + 1, close);
}

function assertInFooterNotScroll(text: string, tokens: string[], from = 0): void {
  const footer = footerSlot(text, from);
  const scroll = scrollPart(text, from);
  for (const t of tokens) {
    assert(footer.includes(t), `"${t}" is in the footer`);
    assert(!scroll.includes(t), `"${t}" is NOT in the scroll body`);
  }
}

// ── The shared layout ─────────────────────────────────────────────────────────────

Deno.test('SheetBody: the footer is outside the scroll view, after it, and shrinks nothing', () => {
  const sheet = src('components/sp/Sheet.tsx');
  const body = sheet.slice(sheet.indexOf('export function SheetBody'), sheet.indexOf('export function Sheet('));
  const scrollEnd = body.indexOf('</ScrollView>');
  const footerAt = body.indexOf('testID="sheet-footer"');
  assert(scrollEnd > 0 && footerAt > scrollEnd, 'the footer View comes after </ScrollView>, not inside it');
  assert(body.includes('{children}') && body.indexOf('{children}') < scrollEnd, 'children render inside the scroll');
  assert(!body.slice(0, scrollEnd).includes('{footer}'), 'the footer is not a scroll child');
});

Deno.test('SheetBody: the wrapper and the scroll shrink inside the sheet\'s 90% ceiling; the footer does not', () => {
  const sheet = src('components/sp/Sheet.tsx');
  assert(/bodyShell:\s*\{[^}]*flexShrink:\s*1[^}]*minHeight:\s*0/.test(sheet), 'bodyShell: flexShrink 1, minHeight 0');
  assert(/scroll:\s*\{[^}]*flexShrink:\s*1/.test(sheet), 'scroll: flexShrink 1');
  assert(sheet.includes("maxHeight: '90%'"), 'the sheet still caps at 90%');
  assert(!/footer[A-Za-z]*:\s*\{[^}]*flexShrink:\s*[1-9]/.test(sheet), 'the footer never shrinks');
});

Deno.test('SheetBody: no rule line over the footer (§9C): the content just scrolls under it', () => {
  const sheet = src('components/sp/Sheet.tsx');
  assert(!/borderTopWidth|borderBottomWidth|borderWidth|hairline|Divider/i.test(sheet), 'Sheet.tsx draws no border or divider');
  for (const f of [
    'components/money/StockSheetBody.tsx', 'components/money/TradeReviewPanel.tsx', 'components/money/SalePicker.tsx',
    'components/game/LeaveLeagueSheets.tsx', 'components/game/RenewalChangeSheet.tsx', 'components/game/DraftDateSheet.tsx',
  ]) {
    const s = src(f);
    const footerStyle = s.match(/footer:\s*\{[^}]*\}/)?.[0] ?? '';
    assert(footerStyle !== '', `${f} has a footer style`);
    assert(!/border|backgroundColor|shadow|elevation/i.test(footerStyle), `${f}: the footer style has no border, fill or shadow`);
  }
});

// ── Each fixed sheet: the action is in the footer, the reason with it ────────────────

Deno.test('Stock sheet: Review buy / Review sell is pinned, WITH its reason line, warn panel and market note', () => {
  const s = src('components/money/StockSheetBody.tsx');
  // The main view: the footer is the `const footer` that the <SheetBody footer={footer}> receives.
  const at = s.indexOf('const footer = (');
  assert(at > 0);
  const footer = group(s, at + 'const footer = '.length);
  for (const t of ['stock-sheet-review', 'action.reason', 'WarnPanel text={keepMoney(warnBlock)}', 'model.marketNote', 'stock-sheet-pick-another', 'COPY.alpacaCredit']) {
    assert(footer.includes(t), `"${t}" is in the footer`);
  }
  const main = s.indexOf('<SheetBody contentContainerStyle={styles.scrollContent} footerStyle={styles.footer} footer={footer}>');
  assert(main > 0, 'the main view passes that footer');
  const scroll = scrollPart(s, main);
  for (const t of ['stock-sheet-review', 'action.reason', 'warnBlock', 'model.marketNote', 'stock-sheet-pick-another']) {
    assert(!scroll.includes(t), `"${t}" is NOT in the scroll body`);
  }
  // What scrolls: the header, the price, the chart, the position, the Buy | Sell control.
  for (const t of ['SheetHeader', 'RollingMoney', 'StockChart', 'Your position', 'SegmentedControl']) assert(scroll.includes(t), `"${t}" scrolls`);
});

Deno.test('Stock sheet: the pre-review refusal view pins Try again / Edit under its message', () => {
  const s = src('components/money/StockSheetBody.tsx');
  const from = s.indexOf('open.warn ?') - 1200;
  assertInFooterNotScroll(s, ['label="Edit"', 'COPY.tryAgain'], from);
});

Deno.test('Trade review: submit, Done, the next step and Try again are pinned; the lines scroll', () => {
  const s = src('components/money/TradeReviewPanel.tsx');
  assertInFooterNotScroll(s, ['trade-review-submit', 'trade-review-done', 'trade-review-try-again', 'NEXT_LABEL[nextStep]', 'review.caption', 'COPY.alpacaCredit']);
  const scroll = scrollPart(s);
  for (const t of ['review.lines.map', 'review.title', 'WarnPanel', 'label="Edit"'.slice(0, 0) + 'accessibilityLabel="Edit"']) assert(scroll.includes(t), `"${t}" scrolls`);
});

Deno.test('Sale picker: "Use …" is pinned; the sources scroll', () => {
  const s = src('components/money/SalePicker.tsx');
  assertInFooterNotScroll(s, ['sale-picker-use', 'COPY.useSaleButton(symbol)']);
  assert(scrollPart(s).includes('rows.map'), 'the sources scroll');
});

Deno.test('Leave league: Leave and Stay are pinned WITH the refusal line; the bullets scroll', () => {
  const s = src('components/game/LeaveLeagueSheets.tsx');
  const leave = s.indexOf('export function LeaveLeagueSheet(');
  const transfer = s.indexOf('export function TransferCommissionerSheet(');
  const leaveSrc = s.slice(leave, transfer);
  assertInFooterNotScroll(leaveSrc, ['leave-league-confirm', 'leave-league-stay', '{error}']);
  assert(scrollPart(leaveSrc).includes('copy.bullets.map'), 'the bullets scroll');
  const transferSrc = s.slice(transfer);
  assertInFooterNotScroll(transferSrc, ['transfer-hand-over', 'transfer-cancel', '{error}']);
  assert(scrollPart(transferSrc).includes('candidates.map'), 'the candidate list scrolls');
});

Deno.test('Draft time: "Set draft time" and "Set later" are pinned; the wheel scrolls', () => {
  const s = src('components/game/DraftDateSheet.tsx');
  assertInFooterNotScroll(s, ['draft-time-set', 'draft-time-later']);
  const scroll = scrollPart(s);
  for (const t of ['picker', 'lineText', 'PICKER_HELPER']) assert(scroll.includes(t), `"${t}" scrolls`);
});

Deno.test('Renewal change: the choice, its refusal and the note are the footer part of the ask; the question scrolls', () => {
  const ask = src('components/game/RenewalAsk.tsx');
  const at = ask.indexOf('const footer = (');
  assert(at > 0, 'RenewalAskBody builds a footer part');
  const footer = group(ask, at + 'const footer = '.length);
  assert(footer.includes('<RenewalChoice') && footer.includes('ASK_CHANGE_NOTE'), 'choice + note in the footer part');
  const body = ask.slice(ask.indexOf('const body = ('), at);
  assert(!body.includes('RenewalChoice') && !body.includes('ASK_CHANGE_NOTE'), 'not in the body part');
  assert(body.includes('askQuestion(commissionerName)') && body.includes('ASK_LINE'), 'the question scrolls');
  assert(ask.includes('layout ? <>{layout({ body, footer })}</> : <>{body}{footer}</>'), 'the card keeps one run (no layout)');
  const sheet = src('components/game/RenewalChangeSheet.tsx');
  assert(/layout=\{\(\{ body, footer \}\) =>/.test(sheet) && sheet.includes('footer={footer}'), 'the sheet passes the footer part to SheetBody');
  assert(scrollPart(sheet).includes('{body}') && !scrollPart(sheet).includes('{footer}'), 'the body part scrolls, the footer part does not');
});

Deno.test('How it works: no commit action; the content scrolls inside the sheet (no footer)', () => {
  const s = src('components/shell/HowItWorksSheet.tsx');
  assert(s.includes('<SheetBody contentContainerStyle='), 'a scroll body');
  assert(!/footer=\{/.test(s), 'no footer: the × is its only control');
  assert(/paddingBottom:\s*Math\.max\(insets\.bottom, space\[5\]\) \+ space\[3\]/.test(s), 'the home-indicator inset is kept');
});

// ── Large is pixel-identical: the split conserves the old spacing ───────────────────

Deno.test('Large: scroll bottom padding (the old gap) + footer bottom padding (the old padding) per sheet', () => {
  const pairs: [string, RegExp, RegExp][] = [
    ['components/money/StockSheetBody.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*space\[5\]/, /footer:\s*\{[^}]*gap:\s*space\[5\][^}]*paddingBottom:\s*space\[7\]/],
    ['components/money/TradeReviewPanel.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*space\[5\]/, /footer:\s*\{[^}]*gap:\s*space\[5\][^}]*paddingBottom:\s*space\[7\]/],
    ['components/money/SalePicker.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*12/, /footer:\s*\{\s*paddingHorizontal:\s*20\s*\}/],
    ['components/game/LeaveLeagueSheets.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*space\[4\]/, /footer:\s*\{[^}]*gap:\s*space\[4\][^}]*paddingBottom:\s*space\[4\]/],
    ['components/game/DraftDateSheet.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*space\[4\]/, /footer:\s*\{[^}]*gap:\s*space\[4\][^}]*paddingBottom:\s*space\[4\]/],
    ['components/game/RenewalChangeSheet.tsx', /scrollContent:\s*\{[^}]*paddingBottom:\s*space\[2\]/, /footer:\s*\{[^}]*gap:\s*space\[2\][^}]*paddingBottom:\s*space\[4\]/],
  ];
  for (const [f, scrollPad, footerPad] of pairs) {
    const s = src(f);
    assert(scrollPad.test(s), `${f}: scroll bottom padding = the old gap`);
    assert(footerPad.test(s), `${f}: footer gap / bottom padding = the old body's`);
  }
});

// ── The audit: every Sheet consumer is accounted for ────────────────────────────────

Deno.test('Audit: every file that opens a <Sheet> either uses SheetBody, scrolls on its own, or is a known exception', () => {
  const SELF_SCROLLING = new Set([
    'components/SlotBuilder.tsx', // category picker: a ScrollView of rows, no commit button (a row IS the choice)
    'components/sp/gn/PlayerCard.tsx', // PlayerCardBody is one ScrollView
    'app/design-gallery.tsx', // dev gallery, a two-line sample
  ]);
  const consumers = Object.keys(SOURCES).filter((p) => /<Sheet[\s>]/.test(code(SOURCES[p])) && p !== 'components/sp/Sheet.tsx');
  assert(consumers.length >= 8, `found the consumers (${consumers.length})`);
  for (const p of consumers) {
    const s = code(SOURCES[p]);
    if (SELF_SCROLLING.has(p)) {
      assert(s.includes('ScrollView') || p === 'app/design-gallery.tsx', `${p} scrolls on its own`);
      continue;
    }
    // MoneyHost hosts the stock sheet: its body components use SheetBody.
    if (p === 'components/money/MoneyHost.tsx') continue;
    assert(s.includes('SheetBody'), `${p} opens a Sheet but its content does not use SheetBody: add it, or list it as an exception with why`);
  }
});
