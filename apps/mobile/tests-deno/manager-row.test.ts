/**
 * One manager row everywhere (UX final sweep S-10; Giorgio, 2026-10-08: "just bold the
 * users name. dont need to put the (you), people know their name. just bold it." and
 * "blue tint as well"; board #call-manager-row @ b4edc955). Your name bold on a
 * you-tint row, others regular, no visible "(you)", VoiceOver still hears "you".
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { YOUR_NAME_WEIGHT, yourNameStyle, yourRowTint, youA11y } from '../lib/game/managerRow.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('your name bold, your row tinted, "you" for VoiceOver; everyone else plain', () => {
  assertEquals(YOUR_NAME_WEIGHT, '700');
  assertEquals(yourNameStyle(true), { fontWeight: '700' });
  assertEquals(yourNameStyle(false), null);
  assertEquals(yourRowTint(true, '#EEF'), { backgroundColor: '#EEF', borderRadius: 8, marginHorizontal: -8, paddingHorizontal: 8 });
  assertEquals(yourRowTint(true, '#EEF', 0)?.marginHorizontal, -0);
  assertEquals(yourRowTint(false, '#EEF'), null);
  assertEquals(youA11y(true), ', you');
  assertEquals(youA11y(false), '');
});

Deno.test('no screen shows a visible "(you)" (source guard)', () => {
  for (const [path, src] of Object.entries(SOURCES)) {
    if (path.startsWith('tests-deno')) continue;
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(!/>\s*\(you\)\s*</.test(code) && !/>\s*\{?['"`]?\s*\(you\)/.test(code), `${path} renders a visible "(you)"`);
  }
});

Deno.test('every manager list marks you with the shared row (source guards)', () => {
  const uses = (path: string, ...needles: string[]) => {
    const src = SOURCES[path];
    for (const n of needles) assert(src.includes(n), `${path}: ${n}`);
  };
  uses('components/game/StandingsTable.tsx', 'yourRowTint(r.isYou, colors.youTint, 0)', 'style={yourNameStyle(r.isYou)}', '${r.name}${youA11y(r.isYou)}');
  uses('components/home/StandingsCard.tsx', 'yourNameStyle(r.isYou)', 'r.isYou ? colors.youTint', '${youA11y(r.isYou)}');
  uses('components/game/HistoryList.tsx', "yourRowTint(st.user_id === myUserId, colors.youTint)", 'yourNameStyle(st.user_id === myUserId)', 'youA11y(st.user_id === myUserId)');
  uses('components/game/DraftLobby.tsx', 'yourRowTint(id === myUserId, colors.youTint)', 'yourNameStyle(id === myUserId)', 'youA11y(id === myUserId)');
  // Where bold already means something (the winner; "Running back"), the tint alone marks you.
  uses('components/game/BracketView.tsx', 'yourRowTint(mine, colors.youTint)', 'youA11y(mine)', "style={isWinner ? styles.bold : null}");
  uses('components/game/RenewalRoster.tsx', 'yourRowTint(p.user_id === myUserId, colors.youTint)', 'youA11y(p.user_id === myUserId)');
  // All matchups: the tint replaces the old inset bar on your game's card.
  uses('components/game/MatchScoreboard.tsx', "size === 'compact' && aIsYou ? { backgroundColor: colors.youTint } : null", 'yourNameStyle(true)');
  assert(SOURCES['app/(tabs)/league.tsx'].includes("<HistoryList rows={history.rows} myUserId={user?.id ?? ''} />"));
});
