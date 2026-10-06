/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { PhaseChip } from '@/components/sp/PhaseChip';
import { LeaguePill } from '@/components/shell/LeaguePill';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useSession } from '@/lib/SessionProvider';
import { chipLabelFor, chipPhaseFor } from '@/lib/shell/leagueSheet';

// Phase 3b-1 — every tab's header (spec row 10; DESIGN_DIRECTION §3 IA):
// the league pill on the left of every league-scoped header, and on Home
// the avatar on the right (Profile left the tab bar; the avatar is its
// entry). With no leagues there is nothing to scope, so the header shows
// the screen's title instead of a pill (board "Home with no leagues").

export interface ShellHeaderProps {
  /** Shown when there is no active league (zero leagues). */
  title: string;
  /** Home only: the avatar that opens Profile. */
  showAvatar?: boolean;
  /** League-scoped tabs (Matchup / League / Portfolio): the active league's
   * PhaseChip right of the pill, like the board's headers. Home has none. */
  showPhase?: boolean;
}

export function ShellHeader({ title, showAvatar = false, showPhase = false }: ShellHeaderProps) {
  const insets = useSafeAreaInsets();
  const { activeLeague, leagues, loading, sheetLeagues, activeLeagueId } = useLeagueContext();
  const activeSheet = showPhase ? sheetLeagues.find((l) => l.id === activeLeagueId) ?? null : null;
  const { username, user } = useSession();
  const displayName = username ?? user?.email ?? '';

  return (
    <View style={[styles.header, { paddingTop: insets.top + space[3] }]}>
      {activeLeague ? (
        <LeaguePill name={activeLeague.name} totalLeagues={leagues.length} />
      ) : loading ? (
        // Leagues still loading (e.g. right after sign-in): hold the pill's
        // place rather than flash the no-leagues title and swap it out.
        <View style={styles.pending} />
      ) : (
        <ScreenTitle style={styles.title}>{title}</ScreenTitle>
      )}
      {activeSheet ? (
        // Wrapped: PhaseChip's own alignSelf would pin it to the row's top.
        <View style={styles.chip}>
          <PhaseChip phase={chipPhaseFor(activeSheet.seasonPhase, activeSheet.marketOpen)} label={chipLabelFor(activeSheet)} onPageBackground />
        </View>
      ) : null}
      {showAvatar ? (
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          hitSlop={4}
        >
          <Avatar name={displayName} size={36} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingBottom: space[4],
  },
  title: {
    flexShrink: 1,
  },
  pending: {
    minHeight: 36,
  },
  chip: {
    alignSelf: 'center',
  },
});
