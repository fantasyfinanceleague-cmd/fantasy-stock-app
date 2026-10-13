/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/sp/Text';
import { ManagerRow, MANAGER_ROW_GAP } from '@/components/sp/gn';
import { space } from '@/constants/tokens';
import { historySeasons, historyStandings, type HistoryRow, type HistoryPlace, type HistorySeason } from '@/lib/game/history';
import type { PodiumGameRow } from '@/lib/game/finalStandings';
import { COPY as GAME_COPY } from '@/lib/game/gameCopy';
import { useStandingsLayout } from '@/components/game/StandingsTable';

/** League › History (R10): every season of the lineage, its champion, and its frozen
 * final standings, newest first. An unfinished season shows no champion. A finished
 * season is ordered by its playoff result with medals, as League › Standings is
 * (GS-8 = GS-4): `playoffs` holds each season's playoff games (get_season_matchups).
 * Game Night (W4): the rows are the one manager row (S-10), as on Standings: `surface`
 * tiles 6pt apart, your row tinted and ringed, the medal disc in the rank cell. The names
 * are the server's, frozen as they were (a leaver stays named in the seasons they played). */
export function HistoryList({ rows, myUserId, playoffs }: { rows: HistoryRow[]; myUserId: string; playoffs: Map<string, PodiumGameRow[]> | null }) {
  const seasons = historySeasons(rows).map((s) => ({ ...s, table: historyStandings(s, playoffs?.get(s.leagueId) ?? null) }));
  return (
    <View style={styles.stack}>
      {seasons.map((s) => (
        <SeasonBlock key={s.leagueId} season={s} table={s.table} myUserId={myUserId} />
      ))}
    </View>
  );
}

function SeasonBlock({ season: s, table, myUserId }: { season: HistorySeason; table: { places: HistoryPlace[]; medals: boolean }; myUserId: string }) {
  const figures = table.places.map(({ standing: st }) => ({ record: `${st.wins}–${st.losses}`, seasonGain: st.points_for }));
  const layout = useStandingsLayout(figures, false, table.medals);
  return (
    <View style={styles.season}>
      <View style={styles.head}>
        <Text variant="headline">{`Season ${s.seasonNumber}`}</Text>
        {/* 1.5× (19.5pt): never above the rows' gains (W4 DL gate). */}
        {s.myRecord ? <Text variant="callout" tone="secondary" maxFontSizeMultiplier={1.5}>{s.myRecord}</Text> : null}
      </View>
      {/* GS-8b: once the playoffs order the season, say so (Standings' own subtitle), so a
          silver above a better record doesn't read as a mistake. */}
      <View style={styles.subHead}>
        {s.champion ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6}>{`Champion ${s.champion}`}</Text> : <Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6}>Not finished yet</Text>}
        {table.medals ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6}>{GAME_COPY.finalStandingsSubtitle}</Text> : null}
      </View>
      <View style={styles.rows}>
        {table.places.map(({ standing: st, place, tag }) => (
          <ManagerRow
            key={st.user_id}
            rank={place}
            showMove={false}
            name={st.display_name}
            isYou={st.user_id === myUserId}
            record={`${st.wins}–${st.losses}`}
            seasonGain={st.points_for}
            medal={table.medals}
            // GS-8b: the podium's tags, as Standings shows them ("Champion" / "Runner-up").
            tag={tag}
            stacked={layout.stacked}
            textCap={layout.textCap}
            recordWidth={layout.recordWidth}
            gainWidth={layout.gainWidth}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Seasons are blocks on the page (24pt apart), their rows the standings' tiles.
  stack: { gap: space[7] },
  season: { gap: space[3] },
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: space[3] },
  subHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space[3], marginTop: -space[2] },
  rows: { gap: MANAGER_ROW_GAP },
});
