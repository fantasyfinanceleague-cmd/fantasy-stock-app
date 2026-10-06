/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { space } from '@/constants/tokens';
import { historySeasons, type HistoryRow } from '@/lib/game/history';

/** League › History (R10): every season of the lineage, its champion, and its frozen
 * final standings, newest first. An unfinished season shows no champion. */
export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const seasons = historySeasons(rows);
  return (
    <View style={styles.stack}>
      <Text variant="title">History</Text>
      {seasons.map((s) => (
        <Card key={s.leagueId}>
          <View style={styles.head}>
            <Text variant="headline">{`Season ${s.seasonNumber}`}</Text>
            {s.myRecord ? <Text variant="callout" tone="secondary">{s.myRecord}</Text> : null}
          </View>
          {s.champion ? <Text variant="caption" tone="secondary">{`Champion ${s.champion}`}</Text> : <Text variant="caption" tone="secondary">Not finished yet</Text>}
          {s.standings.map((st) => (
            <View key={st.user_id} style={styles.row}>
              <Text variant="callout" style={styles.rank}>{st.rank}</Text>
              <Text variant="callout" style={styles.name}>{st.display_name}</Text>
              <Text variant="caption" tone="secondary">{`${st.wins}–${st.losses}`}</Text>
              <Text variant="callout" style={styles.gain}>{formatMoney(st.points_for, { sign: 'always' })}</Text>
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  rank: { width: 22, textAlign: 'right' },
  name: { flex: 1 },
  gain: { minWidth: 92, textAlign: 'right' },
});
