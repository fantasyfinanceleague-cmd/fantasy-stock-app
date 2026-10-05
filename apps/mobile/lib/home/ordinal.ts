/** "1st"/"2nd"/"3rd"/"4th"... -- shared by HomeHero's rank line and
 * SeasonCompleteCard's tiles/place headline (S6, Design Lead ruling,
 * 2026-09-30: "use ordinals, not '2 of 3'") so the two never drift. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
