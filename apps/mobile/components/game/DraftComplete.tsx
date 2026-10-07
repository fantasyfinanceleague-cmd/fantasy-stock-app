/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { YOUR_ROSTER } from '@/lib/game/draftRoom';
import {
  DRAFT_COMPLETE_TAG, SEE_WEEK_ONE_MATCHUP, SEE_WEEK_ONE_MATCHUPS, YOUR_TEAM_IS_SET, draftPriceLabel, rosterPickCaption, type RosterPick,
} from '@/lib/game/draftComplete';

// 3c-2, U-10: the draft's designed ending (board #game "Draft complete"), in the
// room when the last pick lands. Until the server has finished the draft (the
// schedule is written in the same step) the line is the existing "Finishing the
// draft…" and there is no button: Week 1 and its opponent aren't known yet.

export interface DraftCompleteProps {
  /** Your picks, in pick order, with round and draft price. */
  roster: readonly RosterPick[];
  /** "6 of 6 · $2,000 per slot" (the room's rosterCaption). */
  caption: string;
  /** draft_status is 'completed': the season exists. */
  finished: boolean;
  /** "Week 1 starts Mon 9:30 AM ET. You play {opponent}" (weekOneLine). */
  weekLine: string;
  /** A Week 1 bye: the button opens All matchups ("See Week 1's matchups"). */
  bye: boolean;
  onSeeMatchup: () => void;
}

export const FINISHING_THE_DRAFT = 'Finishing the draft…'; // existing copy

export function DraftComplete({ roster, caption, finished, weekLine, bye, onSeeMatchup }: DraftCompleteProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <Card style={styles.hero}>
        <Text variant="tag" color={colors.liveText}>{DRAFT_COMPLETE_TAG}</Text>
        <Text variant="title">{YOUR_TEAM_IS_SET}</Text>
        <Text variant="callout" tone={finished ? undefined : 'secondary'} accessibilityLiveRegion="polite">
          {finished ? weekLine : FINISHING_THE_DRAFT}
        </Text>
      </Card>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="headline">{YOUR_ROSTER}</Text>
          <Text variant="caption" tone="secondary">{caption}</Text>
        </View>
        <Card>
          {roster.map((r, i) => {
            const price = draftPriceLabel(r.price);
            return (
              <View
                key={r.pick}
                style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}
                accessible
                accessibilityLabel={`${r.symbol}, ${rosterPickCaption(r)}${price ? `, ${price}` : ''}`}
              >
                <View style={styles.rowText}>
                  <Text variant="callout" style={styles.ticker}>{r.symbol}</Text>
                  <Text variant="caption" tone="secondary">{rosterPickCaption(r)}</Text>
                </View>
                {price ? <Text variant="callout" style={styles.tabular}>{price}</Text> : null}
              </View>
            );
          })}
        </Card>
      </View>

      {finished ? <Button label={bye ? SEE_WEEK_ONE_MATCHUPS : SEE_WEEK_ONE_MATCHUP} onPress={onSeeMatchup} fullWidth /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  hero: { gap: space[2] },
  section: { gap: space[2] },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  ticker: { fontWeight: '700' },
  tabular: { fontVariant: ['tabular-nums'] },
});
