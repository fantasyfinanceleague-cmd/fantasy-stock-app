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
// Amended (Design Lead, Round 3, 2026-09-29): every phase used to render as
// one inverted style with a white dot on the live phase — which threw away
// the actual live signal (inverseFg carries no "this is live" meaning by
// itself). Now three styles by phase type, matching the board's own chips:
//   - live-type (live_open, drafting, playoffs in progress): inset
//     background, liveText label, a real live-coloured dot — `live` on
//     `inset` is a board-verified graphic pair (3.03:1 Light / 8.18:1 Dark).
//   - final-type (week_final, season_complete): inverseBg/inverseFg, no
//     dot — this is the one case that still wants to "pop" regardless of
//     theme, the same reasoning <Chyron> uses.
//   - everything else (pre_draft, pre_season, live_closed): inset
//     background, plain text label, no dot.
// Deliberately NOT built on the shared <Text> primitive: <Text> resolves
// colour from the theme's normal text roles, and the final-type style needs
// the inverted pair, not a plain text role.

export type LeaguePhase =
  | 'pre_draft'
  | 'drafting'
  | 'pre_season'
  | 'live_open'
  | 'live_closed'
  | 'week_final'
  | 'playoffs'
  | 'season_complete';

type PhaseStyle = 'live' | 'final' | 'default';

interface PhaseMeta {
  label: string;
  style: PhaseStyle;
}

const PHASE_META: Record<LeaguePhase, PhaseMeta> = {
  pre_draft: { label: 'Pre-draft', style: 'default' },
  drafting: { label: 'Drafting', style: 'live' },
  pre_season: { label: 'Pre-season', style: 'default' },
  live_open: { label: 'Live', style: 'live' },
  live_closed: { label: 'Closed', style: 'default' },
  week_final: { label: 'Final', style: 'final' },
  playoffs: { label: 'Playoffs', style: 'live' },
  season_complete: { label: 'Complete', style: 'final' },
};

export interface PhaseChipProps {
  phase: LeaguePhase;
}

export function PhaseChip({ phase }: PhaseChipProps) {
  const { colors } = useTheme();
  const meta = PHASE_META[phase];
  const tagStyle = type.tag;

  let backgroundColor: string;
  let textColor: string;
  let dotColor: string | null;

  switch (meta.style) {
    case 'live':
      backgroundColor = colors.inset;
      textColor = colors.liveText;
      dotColor = colors.live;
      break;
    case 'final':
      backgroundColor = colors.inverseBg;
      textColor = colors.inverseFg;
      dotColor = null;
      break;
    case 'default':
    default:
      backgroundColor = colors.inset;
      textColor = colors.text;
      dotColor = null;
      break;
  }

  return (
    <View style={[styles.base, { backgroundColor }]}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <RNText
        style={{
          fontFamily: tagStyle.fontFamily,
          fontSize: tagStyle.fontSize,
          lineHeight: tagStyle.lineHeight,
          letterSpacing: tagStyle.letterSpacing,
          textTransform: tagStyle.textTransform,
          color: textColor,
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
