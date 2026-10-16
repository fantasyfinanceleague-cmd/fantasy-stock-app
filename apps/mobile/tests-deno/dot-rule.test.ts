/**
 * W8, the dot rule (Design Lead ruling, 2026-10-15): ONE rule app-wide, keepDots. A "·" may END
 * a line and NEVER starts one. W4's 12599265 had put a second, opposite rule on "You're in"
 * (a no-break space AFTER the dot, so the dot started the next line: "Sat, Oct 10 / · 7:00 PM
 * ET"); it is reverted, and that sentence now goes through keepDots.
 *
 * Hermes cannot be run here, so the pin simulates the line breaker over the DISPLAYED string:
 * the only break opportunities are U+0020 spaces (a no-break space never breaks, which is the
 * whole mechanism), a greedy wrap at every width from 8 to 60 characters, and no wrapped line
 * may start with "·".
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import * as keepDotsModule from '../lib/game/keepDots.ts';
import { NBSP, keepDots, keepDotsIn } from '../lib/game/keepDots.ts';
import { joinedView } from '../lib/join/joinPreview.ts';
import { SOURCES } from './sourceManifest.generated.ts';

/** Greedy wrap: break only at a plain space; a run wider than `width` overflows on its own line. */
function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line === '') line = w;
    else if ((line + ' ' + w).length <= width) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Every width the sentence could meet: a line never starts with a dot. */
function noLineStartsWithDot(text: string): string[] {
  const bad: string[] = [];
  for (let width = 8; width <= 60; width++) {
    for (const line of wrap(text, width)) if (line.trimStart().startsWith('·')) bad.push(`width ${width}: ${JSON.stringify(line)}`);
  }
  return bad;
}

/** The sentence exactly as the "You're in" screen displays it. */
function displayed(draftDate: string | null): string {
  const v = joinedView('Serie A Traders', draftDate);
  return keepDotsIn(v.body, v.when ?? '');
}

Deno.test('the rule has one helper: dotStartsLine (W4\'s reversed variant) is gone', () => {
  assertEquals('dotStartsLine' in keepDotsModule, false);
  for (const [path, src] of Object.entries(SOURCES)) assert(!src.includes('dotStartsLine'), `${path} still uses dotStartsLine`);
});

Deno.test('"You\'re in": the draft sentence never starts a line with "·" at any width', () => {
  for (const date of ['2026-10-10T23:00:00Z', '2026-11-05T01:00:00Z', '2026-12-25T18:30:00Z']) {
    const text = displayed(date);
    assert(text.includes('·'), 'the sentence carries its dot');
    assertEquals(noLineStartsWithDot(text), [], text);
  }
});

Deno.test('"You\'re in": the break falls AFTER the dot ("Sat, Oct 10 · / 7:00 PM ET"), and each segment stays whole', () => {
  const text = displayed('2026-10-10T23:00:00Z');
  // Every dot is glued to the segment before it and followed by a plain space.
  assert(text.includes(`Sat,${NBSP}Oct${NBSP}10${NBSP}· 7:00${NBSP}PM${NBSP}ET.`), JSON.stringify(text));
  // At the XXXL width the date breaks as the ruling says, with "The draft is" free to wrap before it.
  const lines = wrap(text, 14);
  assert(lines.some((l) => l.endsWith('Oct 10 ·')), JSON.stringify(lines));
  assert(lines.some((l) => l.startsWith('7:00 PM ET.')), JSON.stringify(lines));
});

Deno.test('"You\'re in": no date falls back to the plain copy, untouched', () => {
  assertEquals(displayed(null), joinedView('X', null).body);
});

Deno.test('keepDotsIn: only the phrase is glued; the sentence around it wraps freely', () => {
  assertEquals(keepDotsIn('The draft is Sat, Oct 10 · 7:00 PM ET. Then more words.', 'Sat, Oct 10 · 7:00 PM ET'),
    `The draft is Sat,${NBSP}Oct${NBSP}10${NBSP}· 7:00${NBSP}PM${NBSP}ET. Then more words.`);
  assertEquals(keepDotsIn('No dots here', ''), 'No dots here');
  assertEquals(keepDotsIn('a sentence', 'absent phrase'), 'a sentence');
  // A "$&" in a name must not be read as a replacement pattern.
  assertEquals(keepDotsIn("Tom's $& league", "Tom's $& league"), "Tom's $& league");
});

Deno.test('keepDots (the one rule) still ends a line with the dot, never starts one', () => {
  assertEquals(noLineStartsWithDot(keepDots('Round 2 of 6 · Pick 11 · Your turn this round')), []);
  assertEquals(noLineStartsWithDot(keepDots('Sat, Oct 10 · 7:00 PM ET')), []);
});

Deno.test('the mutation the pin must catch: a space AFTER the dot glued instead (W4\'s 12599265) starts lines with the dot', () => {
  const reversed = 'The draft is Sat, Oct 10 · 7:00 PM ET. The draft order is set an hour before.';
  assert(noLineStartsWithDot(reversed).length > 0, 'the simulator sees a line that starts with a dot');
});

Deno.test('the screen routes the sentence through keepDotsIn (source pin)', () => {
  const src = SOURCES['app/join-league.tsx'];
  assert(src.includes('{keepDotsIn(v.body, v.when ?? \'\')}'));
});
