/**
 * The sp Card has no padding or radius of its own (callers set both: DraftCountdownCard,
 * ThisWeekCard, StandingsTable). The capture pass (final sweep S-1) found twelve game
 * cards mounted bare, so their text sat flush on the card edge: Schedule, the bracket,
 * the champion banner, the draft lobby and the Run it back card, counts, ask, roster and review. Each now
 * takes the shared padding; this guard keeps a bare Card out of the game screens.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('no game screen mounts a bare sp Card (it has no padding of its own)', () => {
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!(path.startsWith('components/game/') || path.startsWith('components/home/') || path.startsWith('app/(tabs)/'))) continue;
    // Code lines only (a comment may name `<Card>`).
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(!code.includes('<Card>'), `${path} mounts a bare <Card> (no padding: text flush on the edge)`);
  }
  for (const f of ['ChampBanner', 'RenewalReview', 'RenewalAsk', 'DraftLobby', 'BracketView', 'RenewalRoster', 'ScheduleList']) {
    assert(SOURCES[`components/game/${f}.tsx`].includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), f);
  }
  for (const f of ['RenewalCountsCard', 'RunItBackCard']) {
    assert(SOURCES[`components/home/${f}.tsx`].includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), f);
  }
});
