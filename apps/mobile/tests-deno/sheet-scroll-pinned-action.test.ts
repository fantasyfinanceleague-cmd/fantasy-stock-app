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
import { SCROLL_SLACK, scrollsFurther } from '../components/sp/logic/sheetScroll.ts';
import { type as TYPE } from '../constants/tokens/type.ts';

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
  for (const t of ['stock-sheet-review', 'action.reason', '!warnBlock && action.reason', 'WarnPanel text={keepMoney(warnBlock)}', 'model.marketNote', 'stock-sheet-pick-another', 'COPY.alpacaCredit']) {
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

// ── Footer text never outgrows the footer's button (DL, 2026-10-19: "Set later" outranked its button) ────────

/** Every <Text ...> opening tag in `text` (up to its closing `>` outside braces). */
function textTags(text: string): string[] {
  const tags: string[] = [];
  let at = text.indexOf('<Text');
  while (at >= 0) {
    let depth = 0;
    let i = at;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      else if (text[i] === '>' && depth === 0) break;
    }
    tags.push(text.slice(at, i + 1));
    at = text.indexOf('<Text', i);
  }
  return tags;
}

Deno.test('Footer text: the shared cap IS the Button label\'s ceiling (headline), and the footers\' own caps do not exceed it', () => {
  const sheet = src('components/sp/Sheet.tsx');
  const cap = Number(/export const SHEET_FOOTER_MAX_SCALE = ([\d.]+);/.exec(sheet)?.[1]);
  assertEquals(cap, TYPE.headline.maxScale, 'the footer cap equals the button label\'s (headline) maxScale');
  assert(src('components/sp/Button.tsx').includes("variant={size === 'md' ? 'headline' : 'callout'}"), 'the Button label is still headline at md');
  for (const [f, name] of [['components/money/StockSheetBody.tsx', 'SHEET_TEXT_MAX_SCALE'], ['components/money/TradeReviewPanel.tsx', 'REVIEW_TEXT_MAX_SCALE']]) {
    const v = Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(src(f))?.[1]);
    assert(v <= cap, `${f}: ${name} (${v}) is within the footer cap (${cap})`);
  }
});

Deno.test('Footer text: every <Text> in a SheetBody footer carries a maxFontSizeMultiplier (Set later, error lines, captions, the credit)', () => {
  const files: [string, string[]][] = [
    ['components/money/StockSheetBody.tsx', ['<SheetBody contentContainerStyle={styles.scrollContent} footerStyle={styles.footer} footer={footer}>']],
    ['components/money/TradeReviewPanel.tsx', ['<SheetBody']],
    ['components/game/DraftDateSheet.tsx', ['<SheetBody']],
    ['components/game/LeaveLeagueSheets.tsx', ['export function LeaveLeagueSheet(', 'export function TransferCommissionerSheet(']],
  ];
  let checked = 0;
  for (const [f, starts] of files) {
    const s = src(f);
    for (const start of starts) {
      const from = s.indexOf(start);
      assert(from >= 0);
      const footer = footerSlot(s, from);
      for (const tag of textTags(footer)) {
        assert(tag.includes('maxFontSizeMultiplier='), `${f}: a footer <Text> with no cap: ${tag.slice(0, 90)}`);
        checked++;
      }
    }
  }
  assert(checked === 8, `checked the footers' texts (${checked})`);
  // The two named by the Design Lead, by name.
  assert(src('components/game/DraftDateSheet.tsx').includes('maxFontSizeMultiplier={SHEET_FOOTER_MAX_SCALE} color={colors.accent}'), 'Set later is capped with the shared footer cap');
  assert(group(src('components/money/StockSheetBody.tsx'), src('components/money/StockSheetBody.tsx').indexOf('const footer = (') + 'const footer = '.length).includes('stock-sheet-pick-another'), '"Pick another stock" is a Button in the footer (its label is the Button\'s own headline cap)');
});

// ── The soft bottom edge (DL, 2026-10-19) ───────────────────────────────────────────

Deno.test('Scroll fade rule: shown only while the content overflows AND there is more below', () => {
  // Large: nothing overflows, however the view bounces.
  assertEquals(scrollsFurther({ content: 500, layout: 500, offset: 0 }), false, 'exactly fits');
  assertEquals(scrollsFurther({ content: 400, layout: 500, offset: 0 }), false, 'smaller than the view');
  assertEquals(scrollsFurther({ content: 500, layout: 500, offset: -30 }), false, 'top bounce on a content that fits must not flash it');
  assertEquals(scrollsFurther({ content: 500 + SCROLL_SLACK, layout: 500, offset: 0 }), false, 'sub-pixel rounding is not more to scroll');
  // XXXL: it overflows.
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: 0 }), true, 'top of an overflowing body');
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: 200 }), true, 'middle');
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: 400 }), false, 'scrolled to the end: gone');
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: 399.5 }), false, 'within the slack of the end');
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: 450 }), false, 'bounced past the end');
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: -20 }), true, 'top bounce while overflowing');
  // Unmeasured or garbage values never show it.
  assertEquals(scrollsFurther({ content: 0, layout: 0, offset: 0 }), false, 'before layout');
  assertEquals(scrollsFurther({ content: 900, layout: 0, offset: 0 }), false, 'no layout height yet');
  assertEquals(scrollsFurther({ content: NaN, layout: 500, offset: 0 }), false);
  assertEquals(scrollsFurther({ content: 900, layout: 500, offset: Infinity }), false);
});

Deno.test('Scroll fade: drawn only when the rule says so, on the surface, no rule line, in the footer\'s own view above its top edge', () => {
  const sheet = src('components/sp/Sheet.tsx');
  const body = sheet.slice(sheet.indexOf('export function SheetBody'), sheet.indexOf('export function Sheet('));
  assert(body.includes('scrollsFurther(metrics.current)'), 'the rule decides');
  assert(/\{fade \? \(\s*(\/\/[^\n]*\n\s*)*<LinearGradient/.test(body), 'the fade is rendered only under `fade`');
  assert(body.includes('colors={[clearOf(colors.surface), colors.surface]}'), 'the sheet surface at alpha 0 into the surface');
  assert(!/transparent/.test(body), 'never the `transparent` keyword (black at 0: a grey fade)');
  assert(body.includes('pointerEvents="none"'), 'it never eats a touch');
  assertEquals((body.match(/<LinearGradient/g) ?? []).length, 1, 'exactly one fade');
  // Placement: AFTER the scroll closes, inside the footer's View (so it exists only with a footer), before {footer}.
  const scrollEnd = body.indexOf('</ScrollView>');
  const footerView = body.indexOf('testID="sheet-footer"');
  const fadeAt = body.indexOf('<LinearGradient');
  assert(scrollEnd > 0 && footerView > scrollEnd && fadeAt > footerView, 'the fade is inside the footer view, not a scroll child');
  assert(fadeAt < body.indexOf('{footer}'), 'and before the footer\'s own content');
  assert(/fade: \{[^}]*position: 'absolute'[^}]*bottom: '100%'[^}]*height: SHEET_FADE_HEIGHT/.test(sheet), 'its bottom edge is the footer\'s top edge: it sits over the scroll\'s last lines');
  assertEquals(Number(/export const SHEET_FADE_HEIGHT = (\d+);/.exec(sheet)?.[1]), 24, '~24pt');
  assert(!/borderTopWidth|borderBottomWidth|borderWidth|hairline/i.test(sheet), 'no rule line, anywhere in Sheet.tsx');
  assert(body.includes('setFade((prev) => (prev === next ? prev : next))'), 'state flips only when the answer changes (no re-render per scroll frame)');
  for (const ev of ['onLayout', 'onContentSizeChange', 'onScroll']) assert(body.includes(ev), `${ev} feeds the metrics`);
  // The scroll is the wrapper's direct child (no extra View between them: an extra wrapper changed iOS text fitting).
  assert(/<View style=\{styles\.bodyShell\}>\s*<ScrollView/.test(body), 'ScrollView is the shell\'s direct child');
});

// ── No shrink-to-fit text in a scrolled sheet body (found at Large on a held stock, 2026-10-19) ───────────

Deno.test('Scrolled sheet bodies: no adjustsFontSizeToFit text (iOS collapsed the stock sheet\'s ticker badge to a fraction of its size); the badge is sized by length', () => {
  for (const f of [
    'components/money/StockSheetBody.tsx', 'components/money/TradeReviewPanel.tsx', 'components/money/SalePicker.tsx',
    'components/game/LeaveLeagueSheets.tsx', 'components/game/RenewalChangeSheet.tsx', 'components/game/DraftDateSheet.tsx',
    'components/shell/HowItWorksSheet.tsx',
  ]) {
    assert(!src(f).includes('adjustsFontSizeToFit'), `${f}: no adjustsFontSizeToFit inside a scroll body`);
  }
  const stock = src('components/money/StockSheetBody.tsx');
  assert(stock.includes('style={tickerTileSize(symbol)}'), 'the badge text takes its size from the ticker\'s length');
  assert(/symbol\.length >= 5 \? TICKER_TILE_LONG : TICKER_TILE_SIZE/.test(stock), 'five or more characters take the smaller size');
  assertEquals(Number(/TICKER_TILE_SIZE = \{ fontSize: (\d+)/.exec(stock)?.[1]), TYPE['ticker.tile'].fontSize, 'up to four characters are at the ticker.tile token size');
  assert(Number(/TICKER_TILE_LONG = \{ fontSize: (\d+)/.exec(stock)?.[1]) >= Math.floor(TYPE['ticker.tile'].fontSize * 0.85), 'the long size is the old fit\'s floor (0.85)');
});
