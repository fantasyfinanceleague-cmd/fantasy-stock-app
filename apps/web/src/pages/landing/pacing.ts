// /01 "How it works" pacing (Giorgio, round 4: "way too fast … you don't
// really get to see what happens"; Design Lead: draft ≈420vh, compete
// ≈300vh, climb ≈160vh, every discrete beat held ≥ 35vh). The chapter's
// pinned scroll length is the sum; its progress 0–1 maps onto these beats.
// Shared by every tier, so switching tiers never changes a scroll length.

export const CHAPTER_BEATS = {
  draft: 420,
  compete: 300,
  climb: 160,
  /** Draft: 12 picks, one beat each (35vh). */
  picks: 12,
  /** Compete: Mon open + 5 daily closes share this much, then FINAL holds. */
  competeDays: 220,
  competeFinal: 80,
  get total() {
    return this.draft + this.compete + this.climb;
  },
} as const;

export interface ChapterState {
  step: 0 | 1 | 2;
  picks: number;
  clock: number;
  day: number;
  final: boolean;
  climb: boolean;
}

/** Scroll progress through the pinned chapter (0–1) → what the phone shows. */
export function chapterStateAt(progress: number): ChapterState {
  const b = CHAPTER_BEATS;
  const vh = Math.max(0, Math.min(1, progress)) * b.total;
  if (vh < b.draft) {
    const pickPos = (vh / b.draft) * b.picks;
    return {
      step: 0,
      picks: Math.floor(pickPos),
      // The clock runs down within each pick, in quarter steps.
      clock: Math.floor((pickPos % 1) * 4) / 4,
      day: 0,
      final: false,
      climb: false,
    };
  }
  if (vh < b.draft + b.compete) {
    const c = vh - b.draft;
    const days = c < b.competeDays ? Math.floor((c / b.competeDays) * 6) : 5;
    return { step: 1, picks: b.picks, clock: 0, day: Math.min(5, days), final: c >= b.competeDays, climb: false };
  }
  const k = (vh - b.draft - b.compete) / b.climb;
  return { step: 2, picks: b.picks, clock: 0, day: 5, final: true, climb: k >= 0.4 };
}
