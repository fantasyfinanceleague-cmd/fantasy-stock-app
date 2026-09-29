/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { RefObject, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { space } from '@/constants/tokens';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { accessibleLeagueRow, chipPhaseFor, formatLeagueMeta, type SheetLeague } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — one league in the sheet: name, "2nd of 6 · 4–1", PhaseChip,
// and a check on the active league (board "League sheet"). The name sits in
// its own View so ShellOverlay can measure it as S3's flight origin.

export interface LeagueSheetRowProps {
  league: SheetLeague;
  selected: boolean;
  first: boolean;
  onPick: (id: string, name: string, rowLabel: RefObject<View | null>) => void;
}

export function LeagueSheetRow({ league, selected, first, onPick }: LeagueSheetRowProps) {
  const { colors } = useTheme();
  const labelRef = useRef<View>(null);
  const meta = formatLeagueMeta(league);

  return (
    <PressableScale
      onPress={() => onPick(league.id, league.name, labelRef)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibleLeagueRow(league, selected)}
      style={[styles.row, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}
    >
      <View style={styles.text}>
        <View ref={labelRef} collapsable={false} style={styles.label}>
          <Text variant="headline" numberOfLines={1}>
            {league.name}
          </Text>
        </View>
        {meta ? (
          <Text variant="caption" tone="secondary" style={styles.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
      <PhaseChip phase={chipPhaseFor(league.seasonPhase, league.marketOpen)} />
      <View style={styles.check}>
        {selected ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
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
  check: {
    width: 20,
    alignItems: 'center',
  },
});
