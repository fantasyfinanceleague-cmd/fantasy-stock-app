/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { RefObject, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { space } from '@/constants/tokens';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { accessibleLeagueRow, chipLabelFor, chipPhaseFor, formatLeagueMeta, type SheetLeague } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — one league in the sheet: name, "2nd of 6 · 4–1", PhaseChip,
// and a check on the active league (board "League sheet"). The name sits in
// its own View so ShellOverlay can measure it as S3's flight origin.
// Game Night (W4 Onboarding): rows are divided by space, never a line (§9C rule 2).

export interface LeagueSheetRowProps {
  league: SheetLeague;
  selected: boolean;
  onPick: (id: string, name: string, rowLabel: RefObject<View | null>) => void;
}

export function LeagueSheetRow({ league, selected, onPick }: LeagueSheetRowProps) {
  const labelRef = useRef<View>(null);
  const meta = formatLeagueMeta(league);
  // At accessibility sizes the chip grows with Dynamic Type; beside the name
  // it squeezed the text into "Ser…" / "joine d". Stacked, nothing truncates.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;
  const chip = <PhaseChip phase={chipPhaseFor(league.seasonPhase, league.marketOpen)} label={chipLabelFor(league)} />;

  return (
    <PressableScale
      onPress={() => onPick(league.id, league.name, labelRef)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibleLeagueRow(league, selected)}
      style={styles.row}
    >
      <View style={styles.text}>
        <View ref={labelRef} collapsable={false} style={styles.label}>
          <Text variant="headline" numberOfLines={stacked ? undefined : 1}>
            {league.name}
          </Text>
        </View>
        {meta ? (
          <Text variant="caption" tone="secondary" style={styles.meta}>
            {meta}
          </Text>
        ) : null}
        {stacked ? <View style={styles.chipStacked}>{chip}</View> : null}
      </View>
      {stacked ? null : chip}
      <View style={styles.check}>
        {selected ? <Icon name="check" size="headline" tone="accent" /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[4],
    minHeight: 56,
  },
  text: {
    flex: 1,
    gap: space[1],
  },
  label: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  meta: {
    fontVariant: ['tabular-nums'],
  },
  chipStacked: {
    flexDirection: 'row',
    marginTop: space[2],
  },
  check: {
    width: 20,
    alignItems: 'center',
  },
});
