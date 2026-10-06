/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, Text as RNText, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { phaseChipStyle, phaseChipText, phaseChipUppercase, type LeaguePhase } from '@/components/sp/logic/phaseChip';

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

export type { LeaguePhase } from '@/components/sp/logic/phaseChip';

export interface PhaseChipProps {
  phase: LeaguePhase;
  /**
   * Phase 3b-1 (Design Lead ruling): overrides the TEXT only — "Week 6",
   * "Draft Sat 7:00 PM ET", "Final". The phase still decides the style
   * (live dot, inverse final, default). Shown in SENTENCE case — only the
   * default phase texts are uppercase tags.
   */
  label?: string;
  /**
   * Carry-over from the 3b-1 review, fixed in 3b-2: `colors.inset` (the
   * 'live'/'default' styles' fill) is nearly IDENTICAL to `colors.bg` in
   * Light (#F0F3F7 vs #F3F5F8) — invisible for a chip sitting directly on
   * the page background (ShellHeader's header chip), though correct as a
   * sunken fill ON a card/sheet surface (LeagueSheetRow, inside the
   * surface-coloured sheet). Set true ONLY for the page-background case:
   * swaps the fill to `colors.surface` plus a hairline border instead.
   * The 'final' (inverse) style is unaffected either way — it already
   * pops on any background by design.
   */
  onPageBackground?: boolean;
}

export function PhaseChip({ phase, label, onPageBackground = false }: PhaseChipProps) {
  const { colors } = useTheme();
  const meta = { label: phaseChipText(phase, label), style: phaseChipStyle(phase) };
  const tagStyle = type.tag;

  let backgroundColor: string;
  let textColor: string;
  let dotColor: string | null;
  let borderColor: string | null = null;

  switch (meta.style) {
    case 'live':
      backgroundColor = onPageBackground ? colors.surface : colors.inset;
      textColor = colors.liveText;
      dotColor = colors.live;
      if (onPageBackground) borderColor = colors.border;
      break;
    case 'final':
      backgroundColor = colors.inverseBg;
      textColor = colors.inverseFg;
      dotColor = null;
      break;
    case 'default':
    default:
      backgroundColor = onPageBackground ? colors.surface : colors.inset;
      textColor = colors.text;
      dotColor = null;
      if (onPageBackground) borderColor = colors.border;
      break;
  }

  return (
    <View style={[styles.base, { backgroundColor }, borderColor ? { borderWidth: StyleSheet.hairlineWidth, borderColor } : null]}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <RNText
        // The tag's own ceiling (type.tag.maxScale): the raw RNText doesn't
        // get it from <Text>, and uncapped the chip outgrew its fixed dot
        // and the header it sits in at Accessibility XL (3b-1 capture).
        maxFontSizeMultiplier={tagStyle.maxScale}
        style={{
          fontFamily: tagStyle.fontFamily,
          fontSize: tagStyle.fontSize,
          lineHeight: tagStyle.lineHeight,
          letterSpacing: tagStyle.letterSpacing,
          // A custom `label` is sentence case (Design Lead ruling, final).
          textTransform: phaseChipUppercase(label) ? tagStyle.textTransform : undefined,
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
