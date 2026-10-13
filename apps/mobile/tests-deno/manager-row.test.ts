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
  // W4: League's Standings and History are the Game Night ManagerRow (it carries all three).
  uses('components/game/StandingsTable.tsx', '<ManagerRow', 'isYou={r.isYou}');
  // Home's excerpt is the Game Night ManagerRow (W4), which carries all three itself.
  uses('components/home/StandingsCard.tsx', '<ManagerRow excerpt rank={r.rank} name={r.displayName} isYou={r.isYou}');
  uses('components/sp/gn/ManagerRow.tsx', 'yourNameStyle(isYou)', 'backgroundColor: colors.youTint', '${youA11y(isYou)}');
  uses('components/game/HistoryList.tsx', '<ManagerRow', 'isYou={st.user_id === myUserId}');
  // The lobby's order (W4 Draft) is ManagerRow's tile: your tint overlay and ring, bold name, "you" for VoiceOver.
  uses('components/game/DraftLobby.tsx', '<ManagerRow key={id} kind="order" rank={i + 1} name={nameOf(id)} isYou={id === myUserId} />');
  uses('components/sp/gn/ManagerRow.tsx', '`${rank}, ${name}${youA11y(isYou)}`');
  // Where bold already means something (the winner; "Running back"), the tint alone marks you.
  uses('components/game/BracketView.tsx', 'yourRowTint(mine, colors.youTint)', 'youA11y(mine)', "style={[styles.name, isWinner ? styles.bold : null]}");
  // GS-7's champion row, when it's you: ManagerRow's your-row tile (tint over surface + the ring).
  uses('components/game/BracketView.tsx', 'style={[styles.championYou, { backgroundColor: colors.youTint, borderColor: colors.you }]}', 'borderWidth: YOU_RING');
  uses('components/game/RenewalRoster.tsx', 'yourRowTint(p.user_id === myUserId, colors.youTint)', 'youA11y(p.user_id === myUserId)');
  // All matchups: the tint replaces the old inset bar on your game's card.
  uses('components/game/MatchScoreboard.tsx', "size === 'compact' && aIsYou ? { backgroundColor: colors.youTint } : null", 'yourNameStyle(true)');
  assert(SOURCES['app/(tabs)/league.tsx'].includes("<HistoryList rows={history.rows} myUserId={user?.id ?? ''} playoffs="));
});
