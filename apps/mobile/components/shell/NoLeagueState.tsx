import type { ReactNode } from 'react';
import { router } from 'expo-router';

import { Icon } from '@/components/sp/Icon';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { useLeagueContext } from '@/lib/LeagueContext';
import { LEAGUES_LOAD_FAILED, leagueFallback } from '@/lib/game/leagueView';
import { COPY as MONEY_COPY } from '@/lib/money/moneyCopy';

// Onboarding W4 (plan 2026-10-14, Decisions row 11; board #1.3 frame 10): ONE no-league state on
// every tab (Home, Matchup, League, Portfolio): the words Home already had, word for word, with
// Create a league / Join with a code. Before this, Matchup and Portfolio drew a blank tab to
// someone with no leagues (a 1.3 must-fix). Each tab passes its own title; the header, the league
// pill and the tab bar stay around it.

export const NO_LEAGUE_COPY = {
  heading: 'No leagues yet',
  message: 'Create or join a league to get started.',
  create: 'Create a league',
  join: 'Join with a code',
} as const;

export function NoLeagueState({ title, onRefresh }: { title: string; onRefresh?: () => Promise<void> }) {
  return (
    <PhasePlaceholder
      title={title}
      showAvatar
      icon={() => <Icon name="trophy" size="title" tone="text2" />}
      heading={NO_LEAGUE_COPY.heading}
      message={NO_LEAGUE_COPY.message}
      actionLabel={NO_LEAGUE_COPY.create}
      onAction={() => router.push('/create-league')}
      secondaryActionLabel={NO_LEAGUE_COPY.join}
      onSecondaryAction={() => router.push('/join-league')}
      onRefresh={onRefresh}
    />
  );
}

/** The league list read failed (never "No leagues yet" to someone whose read failed). */
export function LeaguesFailedState({ title, onRefresh }: { title: string; onRefresh: () => Promise<void> }) {
  return (
    <PhasePlaceholder
      title={title}
      showAvatar
      icon={() => <Icon name="alert" size="title" tone="text2" />}
      heading={LEAGUES_LOAD_FAILED}
      message={MONEY_COPY.loadRetryMessage}
      actionLabel={MONEY_COPY.tryAgain}
      onAction={onRefresh}
      onRefresh={onRefresh}
    />
  );
}

/**
 * Wraps a tab that has no state of its own for "no leagues": shows NoLeagueState when a read that
 * SUCCEEDED found none, LeaguesFailedState when the read failed, and the tab itself otherwise
 * (including while the list is still loading, so each tab keeps its own skeleton).
 */
export function LeagueListGate({ title, children }: { title: string; children: ReactNode }) {
  const { leagues, loading, loadFailed, refresh } = useLeagueContext();
  const fallback = leagueFallback({ loading, leagueCount: leagues.length, loadFailed });
  if (fallback === 'empty') return <NoLeagueState title={title} onRefresh={refresh} />;
  if (fallback === 'failed') return <LeaguesFailedState title={title} onRefresh={refresh} />;
  return <>{children}</>;
}
