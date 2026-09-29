import { describe, expect, it } from 'vitest';
import { digitDiff } from './digitDiff';

describe('digitDiff', () => {
  it('same-length strings: only the differing position is true', () => {
    // "56.80" vs "56.90": '5','6','.' match, '8'->'9' differs, '0' matches.
    expect(digitDiff('56.80', '56.90')).toEqual([false, false, false, true, false]);
  });

  it('identical strings: nothing changed', () => {
    expect(digitDiff('$100.00', '$100.00')).toEqual(new Array(7).fill(false));
  });

  it('next grew a leading digit: the new position and every shifted one change', () => {
    // "99" -> "100": right-aligned, "_99" vs "100" — all three differ.
    expect(digitDiff('99', '100')).toEqual([true, true, true]);
  });

  it('next shrank: still compares by right alignment', () => {
    // "100" -> "99": right-aligned, "100" vs "_99" — next's two positions
    // align against prev's LAST two characters ("0","0"), so "9" vs "0" and
    // "9" vs "0" both differ. prev's leading "1" has no counterpart in next
    // and is simply dropped, not compared.
    expect(digitDiff('100', '99')).toEqual([true, true]);
  });

  it('first paint (empty prev): everything is "changed" by this function', () => {
    // Callers gate first-paint separately (never animate on first render);
    // digitDiff itself just reports positional difference.
    expect(digitDiff('', '$0.00')).toEqual(new Array(5).fill(true));
  });
});
