/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, Text as RNText, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <PhaseChip> (§9A, "One design, two themes", 2026-09-29).
// SOURCE OF TRUTH: §3's "one league-lifecycle model" table and §9's
// `type.tag`.
//
// Visual only, by design (the Phase 2 brief): it takes the phase string and
// renders the broadcast tag for it. It does NOT decide which phase a league
// is in — that's the shared `getSeasonPhase` helper (extended in a later
// phase per §3), so no screen infers phase on its own by re-deriving it here.
//
// Self-contained: a phase badge keeps its own small "broadcast tag" look
// wherever it's placed, always inverted relative to the current theme
// (colors.inverseBg/Fg — the PAIRS list's own "FINAL chip, selected toggle"
// pair) rather than matching the surrounding card — the same way a "LIVE"
// badge in a broadcast graphic doesn't change style with what's behind it.
// Deliberately NOT built on the shared <Text> primitive, since <Text>
// resolves colour from the theme's normal text roles and this chip's colour
// is always inverted, never the theme's plain text colour.

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
  /** Only the phase that's actually live gets a dot. */
  live?: boolean;
}

const PHASE_META: Record<LeaguePhase, PhaseMeta> = {
  pre_draft: { label: 'Pre-draft' },
  drafting: { label: 'Drafting' },
  pre_season: { label: 'Pre-season' },
  live_open: { label: 'Live', live: true },
  live_closed: { label: 'Closed' },
  week_final: { label: 'Final' },
  playoffs: { label: 'Playoffs' },
  season_complete: { label: 'Complete' },
};

export interface PhaseChipProps {
  phase: LeaguePhase;
}

export function PhaseChip({ phase }: PhaseChipProps) {
  const { colors } = useTheme();
  const meta = PHASE_META[phase];
  const tagStyle = type.tag;

  return (
    <View style={[styles.base, { backgroundColor: colors.inverseBg }]}>
      {/* colors.live, not inverseFg, was tried here first — computed out to
          1.46:1 in Dark (colors.live there is tuned for the app's normal
          navy background, not this chip's INVERTED light one) against the
          3:1 graphic minimum. inverseFg is guaranteed to contrast with
          inverseBg by definition, so the dot uses that instead — the label
          text already carries "Live"; this dot is a secondary cue, not the
          only signal. */}
      {meta.live ? <View style={[styles.dot, { backgroundColor: colors.inverseFg }]} /> : null}
      <RNText
        style={{
          fontFamily: tagStyle.fontFamily,
          fontSize: tagStyle.fontSize,
          lineHeight: tagStyle.lineHeight,
          letterSpacing: tagStyle.letterSpacing,
          textTransform: tagStyle.textTransform,
          color: colors.inverseFg,
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
