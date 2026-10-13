/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, Text as RNText, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { phaseChipStyle, phaseChipText, phaseChipUppercase, type LeaguePhase } from '@/components/sp/logic/phaseChip';
import { chipLook } from '@/components/sp/logic/gameNight';

// Stockpile — <PhaseChip>, the §9C "Chip" (Game Night, 2026-10-12; first built §9A).
// SOURCE OF TRUTH: §3's "one league-lifecycle model" table and §9's
// `type.tag`.
//
// Visual only, by design (the Phase 2 brief): it takes the phase string and
// renders the broadcast tag for it. It does NOT decide which phase a league
// is in — that's the shared `getSeasonPhase` helper (extended in a later
// phase per §3), so no screen infers phase on its own by re-deriving it here.
//
// Three looks by phase type (logic/phaseChip.ts decides the type; logic/gameNight.ts's
// `chipLook` the colours): live-type (live_open, drafting, playoffs in progress) is the
// accent chip with its dot; final-type and the rest are `inset` + `text`, no dot.
// Deliberately NOT built on the shared <Text> primitive: the tag face and its own
// Dynamic Type cap are set here directly.

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
   * True ONLY for a chip sitting directly on the page background (ShellHeader's header
   * chip): the `inset` chips then take the card `rim` as an edge so they read on the page
   * (the 3b-2 fix's intent). The live chip's tint needs none.
   */
  onPageBackground?: boolean;
}

export function PhaseChip({ phase, label, onPageBackground = false }: PhaseChipProps) {
  const { colors } = useTheme();
  const meta = { label: phaseChipText(phase, label), style: phaseChipStyle(phase) };
  const tagStyle = type.tag;

  // Game Night (§9C "Chip"): live = `accentTint` + `liveText` with the dot drawn; FINAL (and
  // every other phase) = `inset` + `text`. On the page background the inset chips take the
  // card `rim` as an edge (the 3b-2 fix's intent: a chip on the page must have an edge);
  // the live chip's tint is its own edge. Pairs: liveText / accentTint over bg and surface,
  // live dot on accentTint, text on inset (contrastPairs.ts).
  const look = chipLook(meta.style === 'live' ? 'live' : meta.style === 'final' ? 'final' : 'default', colors);
  const backgroundColor = look.fill;
  const textColor = look.ink;
  const dotColor = look.dot;
  const borderColor = onPageBackground && meta.style !== 'live' ? colors.rim : null;

  return (
    <View style={[styles.base, { backgroundColor }, borderColor ? { borderWidth: 1, borderColor } : null]}>
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
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[2],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});
