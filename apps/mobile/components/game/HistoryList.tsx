/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { radius, space } from '@/constants/tokens';
import { historySeasons, type HistoryRow } from '@/lib/game/history';
import { useLargeText } from '@/components/sp/useLargeText';
import { yourNameStyle, yourRowTint, youA11y } from '@/lib/game/managerRow';

/** League › History (R10): every season of the lineage, its champion, and its frozen
 * final standings, newest first. An unfinished season shows no champion. */
export function HistoryList({ rows, myUserId }: { rows: HistoryRow[]; myUserId: string }) {
  const { colors } = useTheme();
  const seasons = historySeasons(rows);
  const gainColor = (v: number) => (v > 0 ? colors.gain : v < 0 ? colors.loss : colors.text);
  // Large text: the record and gain go under the name (one line squeezed it to a letter per line).
  const largeText = useLargeText();
  return (
    <View style={styles.stack}>
      <Text variant="title">History</Text>
      {seasons.map((s) => (
        <Card key={s.leagueId} style={styles.card}>
          <View style={styles.head}>
            <Text variant="headline">{`Season ${s.seasonNumber}`}</Text>
            {s.myRecord ? <Text variant="callout" tone="secondary">{s.myRecord}</Text> : null}
          </View>
          {s.champion ? <Text variant="caption" tone="secondary">{`Champion ${s.champion}`}</Text> : <Text variant="caption" tone="secondary">Not finished yet</Text>}
          {s.standings.map((st) => (
            <View key={st.user_id} style={[styles.row, yourRowTint(st.user_id === myUserId, colors.youTint)]} accessible accessibilityLabel={`${st.rank}, ${st.display_name}${youA11y(st.user_id === myUserId)}, ${st.wins}–${st.losses}, ${formatMoney(st.points_for, { sign: 'always' })}`}>
              <Text variant="callout" style={styles.rank}>{st.rank}</Text>
              {largeText ? (
                <View style={styles.name}>
                  <Text variant="callout" style={yourNameStyle(st.user_id === myUserId)}>{st.display_name}</Text>
                  <View style={styles.statsLine}>
                    <Text variant="caption" tone="secondary">{`${st.wins}–${st.losses}`}</Text>
                    <Text variant="callout" style={{ color: gainColor(st.points_for) }}>{formatMoney(st.points_for, { sign: 'always' })}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text variant="callout" style={[styles.name, yourNameStyle(st.user_id === myUserId)]}>{st.display_name}</Text>
                  <Text variant="caption" tone="secondary">{`${st.wins}–${st.losses}`}</Text>
                  <Text variant="callout" style={[styles.gain, { color: gainColor(st.points_for) }]}>{formatMoney(st.points_for, { sign: 'always' })}</Text>
                </>
              )}
            </View>
          ))}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  rank: { minWidth: 24, textAlign: 'right' },
  name: { flex: 1, minWidth: 0 },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[2] },
  gain: { minWidth: 92, textAlign: 'right' },
});
