/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { EmptyState, type EmptyStateIconProps } from '@/components/sp/EmptyState';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { useLeagueContext } from '@/lib/LeagueContext';
import { chipPhaseFor } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — the honest placeholder for a tab whose real screen belongs to
// a later phase (spec row 16: Matchup → 3c, League → 3c, Portfolio → 3e,
// Home's league state → 3b-2). It says plainly that the screen is coming,
// shows the active league's phase through the shared PhaseChip, and keeps
// the shell (header, pill, tab bar) fully working around it. No old screen
// is restyled piecemeal.

export interface PhasePlaceholderProps {
  title: string;
  icon: (props: EmptyStateIconProps) => ReactNode;
  heading: string;
  message: string;
  showAvatar?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** S5: pull to refresh with the rising bars (Home). */
  onRefresh?: () => Promise<void>;
}

export function PhasePlaceholder({
  title,
  icon,
  heading,
  message,
  showAvatar,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  onRefresh,
}: PhasePlaceholderProps) {
  const { colors } = useTheme();
  const { sheetLeagues, activeLeagueId } = useLeagueContext();
  const active = sheetLeagues.find((l) => l.id === activeLeagueId) ?? null;

  const body = (
    <>
      {active ? (
        <View style={styles.chip}>
          <PhaseChip phase={chipPhaseFor(active.seasonPhase, active.marketOpen)} />
        </View>
      ) : null}
      <EmptyState
        icon={icon}
        title={heading}
        message={message}
        actionLabel={actionLabel}
        onAction={onAction}
        secondaryActionLabel={secondaryActionLabel}
        onSecondaryAction={onSecondaryAction}
      />
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ShellHeader title={title} showAvatar={showAvatar} />
      {onRefresh ? (
        <BarsRefresh onRefresh={onRefresh} contentContainerStyle={styles.content}>
          {body}
        </BarsRefresh>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space[5],
    paddingBottom: space[10],
  },
  // The wrapper centres itself; PhaseChip's own alignSelf: 'flex-start'
  // would otherwise pin it to the left.
  chip: {
    alignSelf: 'center',
  },
});
