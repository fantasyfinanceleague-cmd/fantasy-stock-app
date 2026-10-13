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
    // Any opening tag without a style (`<Card>`, `<Card key={…}>`, `<Card variant=…>`).
    for (const m of code.matchAll(/<Card\b([^>]*)>/g)) {
      assert(m[1].includes('style='), `${path} mounts a Card with no style (no padding: text flush on the edge): ${m[0].slice(0, 60)}`);
    }
  }
  // W4 League (Game Night): Schedule and History are no longer cards: their rows are the
  // standings' `surface` tiles on the page (ScheduleList's own `row`, HistoryList's ManagerRow).
  for (const f of ['ChampBanner', 'RenewalReview', 'RenewalAsk', 'DraftLobby', 'BracketView', 'RenewalRoster']) {
    assert(SOURCES[`components/game/${f}.tsx`].includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), f);
  }
  assert(SOURCES['components/game/ScheduleList.tsx'].includes("row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingVertical: space[4], paddingHorizontal: space[4], borderRadius: radius.row },"));
  assert(SOURCES['components/game/HistoryList.tsx'].includes('<ManagerRow'));
  for (const f of ['RenewalCountsCard', 'RunItBackCard']) {
    assert(SOURCES[`components/home/${f}.tsx`].includes('card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },'), f);
  }
});
