/**
 * The Matchup scoreboard's layout (final sweep S-1, seen in the capture pass once the
 * fixture identity was fixed): the text sat flush on the card edge (the sp Card has no
 * padding of its own) and the two hero scores ran into each other ("+$213.60+$90.45").
 * Fixed with ThisWeekCard's pattern (#167): card padding, and score cells that really
 * split the row (flex 1 + minWidth 0), the opponent's hugging its own edge.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the scoreboard card has its own padding, and its scores can never overlap (source guards)', () => {
  const sb = SOURCES['components/game/MatchScoreboard.tsx'];
  assert(sb.includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[1] },'));
  assert(sb.includes("style={[styles.card, size === 'compact' ? styles.compact : null, size === 'compact' && aIsYou ? { backgroundColor: colors.youTint } : null]}"));
  assert(sb.includes('scoreCell: { flex: 1, minWidth: 0 },'));
  assert(sb.includes("scoreCellRight: { alignItems: 'flex-end' },"));
  assert(sb.includes('<View style={[styles.scoreCell, styles.scoreCellRight]}>'));
  assert(/scoresRow:\s*\{[^}]*gap: space\[5\]/.test(sb));
  // One size for both scores that fits a phone's half-row (score.lg, as ThisWeekCard).
  assert(sb.includes("const scoreVariant = size === 'hero' ? 'score.lg' : 'score.md';"));
  // The digits shrink to fit once given a bounded width (the safety net for an unusual value).
  assert(SOURCES['components/sp/game/ScoreDigits.tsx'].includes('adjustsFontSizeToFit'));
});
