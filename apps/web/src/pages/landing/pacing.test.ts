// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CHAPTER_BEATS, chapterStateAt } from './pacing';

// Round 4 pacing (Giorgio: the draft was "way too fast"; Design Lead: draft
// ≈420vh, compete ≈300vh, climb ≈160vh, every beat held ≥ 35vh). One
// module drives every tier, so FULL and ENHANCED share the same scroll
// lengths and beats by construction — a tier switch never jumps.

const sample = (step = 0.25) => {
  const out: Array<{ vh: number; key: string }> = [];
  for (let vh = 0; vh <= CHAPTER_BEATS.total; vh += step) {
    const s = chapterStateAt(vh / CHAPTER_BEATS.total);
    out.push({ vh, key: JSON.stringify(s) });
  }
  return out;
};

describe('the /01 chapter pacing', () => {
  it('is ≈880vh: draft 420, compete 300, climb 160', () => {
    expect([CHAPTER_BEATS.draft, CHAPTER_BEATS.compete, CHAPTER_BEATS.climb, CHAPTER_BEATS.total]).toEqual([420, 300, 160, 880]);
  });

  it('gives each draft round ≥ 60vh (Design Lead) — here 210vh', () => {
    expect(CHAPTER_BEATS.draft / 2).toBeGreaterThanOrEqual(60);
  });

  it('holds every discrete beat (pick, day, FINAL, climb) for ≥ 35vh of scroll', () => {
    // Beats ignore the draft clock, which ticks within a pick by design.
    const s = sample().map(({ vh, key }) => {
      const o = JSON.parse(key);
      delete o.clock;
      return { vh, key: JSON.stringify(o) };
    });
    const runs: number[] = [];
    let start = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i].key !== s[i - 1].key) {
        runs.push(s[i].vh - start);
        start = s[i].vh;
      }
    }
    runs.push(CHAPTER_BEATS.total - start);
    // Picks are exactly 35vh each; allow one 0.25vh sampling step of slack.
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(35 - 0.25);
  });

  it('walks the story in order: 12 picks, Mon open → Fri close, FINAL, then the climb', () => {
    const states = sample(1).map((x) => JSON.parse(x.key));
    const picks = [...new Set(states.filter((st) => st.step === 0).map((st) => st.picks))];
    expect(picks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const days = [...new Set(states.filter((st) => st.step === 1).map((st) => st.day))];
    expect(days).toEqual([0, 1, 2, 3, 4, 5]);
    expect(states.at(-1)).toMatchObject({ step: 2, final: true, climb: true });
  });
});
