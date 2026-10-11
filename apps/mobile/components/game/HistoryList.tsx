/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { radius, space } from '@/constants/tokens';
import { historySeasons, historyStandings, type HistoryRow } from '@/lib/game/history';
import type { PodiumGameRow } from '@/lib/game/finalStandings';
import { MEDAL, MedalDisc, useMedalDiscSize } from '@/components/game/MedalDisc';
import { COPY as GAME_COPY } from '@/lib/game/gameCopy';
import { useLargeText } from '@/components/sp/useLargeText';
import { yourNameStyle, yourRowTint, youA11y } from '@/lib/game/managerRow';

/** League › History (R10): every season of the lineage, its champion, and its frozen
 * final standings, newest first. An unfinished season shows no champion. A finished
 * season is ordered by its playoff result with medals, as League › Standings is
 * (GS-8 = GS-4): `playoffs` holds each season's playoff games (get_season_matchups). */
export function HistoryList({ rows, myUserId, playoffs }: { rows: HistoryRow[]; myUserId: string; playoffs: Map<string, PodiumGameRow[]> | null }) {
  const { colors } = useTheme();
  const seasons = historySeasons(rows).map((s) => ({ ...s, table: historyStandings(s, playoffs?.get(s.leagueId) ?? null) }));
  const gainColor = (v: number) => (v > 0 ? colors.gain : v < 0 ? colors.loss : colors.text);
  // Large text: the record and gain go under the name (one line squeezed it to a letter per line).
  const largeText = useLargeText();
  const disc = useMedalDiscSize();
  return (
    <View style={styles.stack}>
      <Text variant="title">History</Text>
      {seasons.map((s) => (
        <Card key={s.leagueId} style={styles.card}>
          <View style={styles.head}>
            <Text variant="headline">{`Season ${s.seasonNumber}`}</Text>
            {s.myRecord ? <Text variant="callout" tone="secondary">{s.myRecord}</Text> : null}
          </View>
          {/* GS-8b: once the playoffs order the season, say so (Standings' own subtitle), so a
              silver above a better record doesn't read as a mistake. */}
          <View style={styles.subHead}>
            {s.champion ? <Text variant="caption" tone="secondary">{`Champion ${s.champion}`}</Text> : <Text variant="caption" tone="secondary">Not finished yet</Text>}
            {s.table.medals ? <Text variant="caption" tone="secondary">{GAME_COPY.finalStandingsSubtitle}</Text> : null}
          </View>
          {s.table.places.map(({ standing: st, place, tag }) => {
            const medal = s.table.medals ? MEDAL[place] : undefined;
            return (
              <View key={st.user_id} style={[styles.row, yourRowTint(st.user_id === myUserId, colors.youTint)]} accessible accessibilityLabel={`${medal ? `${medal.label}, ` : ''}${place}, ${st.display_name}${youA11y(st.user_id === myUserId)}${tag ? `, ${tag}` : ''}, ${st.wins}–${st.losses}, ${formatMoney(st.points_for, { sign: 'always' })}`}>
                <View style={[styles.rankCell, { width: Math.max(28, disc + 8) }]}>
                  {medal ? <MedalDisc place={place} size={disc} /> : <Text variant="callout" style={styles.rank}>{place}</Text>}
                </View>
                {largeText ? (
                  <View style={styles.name}>
                    <Text variant="callout" style={yourNameStyle(st.user_id === myUserId)}>{st.display_name}</Text>
                    {tag ? <Text variant="caption" tone="secondary">{tag}</Text> : null}
                    <View style={styles.statsLine}>
                      <Text variant="caption" tone="secondary">{`${st.wins}–${st.losses}`}</Text>
                      <Text variant="callout" style={{ color: gainColor(st.points_for) }}>{formatMoney(st.points_for, { sign: 'always' })}</Text>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.name}>
                      <Text variant="callout" style={yourNameStyle(st.user_id === myUserId)}>{st.display_name}</Text>
                      {/* GS-8b: the podium's tags, as Standings shows them ("Champion" / "Runner-up"). */}
                      {tag ? <Text variant="caption" tone="secondary">{tag}</Text> : null}
                    </View>
                    <Text variant="caption" tone="secondary">{`${st.wins}–${st.losses}`}</Text>
                    <Text variant="callout" style={[styles.gain, { color: gainColor(st.points_for) }]}>{formatMoney(st.points_for, { sign: 'always' })}</Text>
                  </>
                )}
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  stack: { gap: space[3] },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  // One fixed-width rank cell, centred, so medal discs and plain places line up (Standings' G-6 rule).
  rankCell: { alignItems: 'center' },
  rank: { textAlign: 'center' },
  name: { flex: 1, minWidth: 0 },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[2] },
  gain: { minWidth: 92, textAlign: 'right' },
});
