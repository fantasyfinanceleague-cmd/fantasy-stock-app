/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, Text as RNText, View } from 'react-native';

import { color, radius, space, type } from '@/constants/tokens';

// Stockpile — <PhaseChip> (Phase 2 foundation). SOURCE OF TRUTH: §3's
// "one league-lifecycle model" table and §9's `type.tag`.
//
// Visual only, by design (the Phase 2 brief): it takes the phase string and
// renders the broadcast tag for it. It does NOT decide which phase a league
// is in — that's the shared `getSeasonPhase` helper (extended in a later
// phase per §3), so no screen infers phase on its own by re-deriving it here.
//
// Self-contained rather than <Surface>-aware: a phase badge keeps its own
// small "broadcast tag" look wherever it's placed (Home's "this week" strip,
// a money-surface list row, a game scoreboard header) — the same way a
// "LIVE" badge in a broadcast graphic doesn't change style with what's
// behind it. `type.tag` (§9: "game surfaces only") describes the TYPOGRAPHY
// treatment this component always uses, not a constraint on where the chip
// itself may appear. Deliberately NOT built on the shared <Text> primitive,
// since <Text> resolves colour from the ambient <Surface> and this chip's
// colour never changes with its surroundings.

export type LeaguePhase =
  | 'pre_draft'
  | 'drafting'
  | 'pre_season'
  | 'live_open'
  | 'live_closed'
  | 'week_final'
  | 'playoffs'
  | 'season_complete';

interface PhaseMeta {
  label: string;
  /** A small live-indicator dot, only for the phase that's actually live. */
  dot?: string;
}

const PHASE_META: Record<LeaguePhase, PhaseMeta> = {
  pre_draft: { label: 'Pre-draft' },
  drafting: { label: 'Drafting' },
  pre_season: { label: 'Pre-season' },
  live_open: { label: 'Live', dot: color.live },
  live_closed: { label: 'Closed' },
  week_final: { label: 'Final' },
  playoffs: { label: 'Playoffs' },
  season_complete: { label: 'Complete' },
};

export interface PhaseChipProps {
  phase: LeaguePhase;
}

export function PhaseChip({ phase }: PhaseChipProps) {
  const meta = PHASE_META[phase];
  const tagStyle = type.tag;

  return (
    <View style={styles.base}>
      {meta.dot ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
      <RNText
        style={{
          fontFamily: tagStyle.fontFamily,
          fontSize: tagStyle.fontSize,
          lineHeight: tagStyle.lineHeight,
          letterSpacing: tagStyle.letterSpacing,
          textTransform: tagStyle.textTransform,
          color: color.text.onGame.primary,
        }}
      >
        {meta.label}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: color.surface.game.raised,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[2],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
