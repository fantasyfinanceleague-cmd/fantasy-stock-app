/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Rect } from 'react-native-svg';

import { color, radius, space, type } from '@/constants/tokens';
import type { ThemeColors, ThemeMode } from '@/constants/tokens';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme, type ThemePreference } from '@/components/sp/ThemeProvider';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { useChangeAppearance } from '@/components/shell/ThemeDip';

// Phase 3b-1 — Appearance (spec row 12, board "Appearance"): System / Light
// / Dark, System by default, saved on the device (ThemeProvider already
// persists it). Switching applies live through ThemeDip.
//
// The preview swatches are the ONLY place both themes appear together
// (spec), so they read color.light / color.dark directly — the deliberate
// exception to "components read useTheme() only". System's swatch is
// split: Light on the left, Dark on the right. Copy: the board's new line.

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function AppearancePicker() {
  const { preference } = useTheme();
  const changeAppearance = useChangeAppearance();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;

  return (
    <>
      <View style={[styles.options, stacked ? styles.optionsStacked : null]} accessibilityRole="radiogroup">
        {OPTIONS.map((o) => (
          <ThemeOption key={o.id} id={o.id} label={o.label} selected={preference === o.id} onPress={() => changeAppearance(o.id)} stacked={stacked} />
        ))}
      </View>
      <Text variant="body" tone="secondary">
        System follows your phone&apos;s light or dark setting. Saved on this device.
      </Text>
    </>
  );
}

function ThemeOption({ id, label, selected, onPress, stacked }: { id: ThemePreference; label: string; selected: boolean; onPress: () => void; stacked: boolean }) {
  const { colors, elevation } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={id === 'system' ? `${label}, matches your phone` : label}
      style={[
        styles.option,
        stacked ? styles.optionStacked : null,
        elevation.card,
        { backgroundColor: colors.surface },
      ]}
    >
      {/* The selection ring is its own layer (the board's box-shadow ring),
          so selecting never shifts the card's contents. */}
      {selected ? <View pointerEvents="none" style={[styles.ring, { borderColor: colors.accent }]} /> : null}
      <Swatch kind={id} />
      <Text variant="body" style={styles.label}>
        {label}
      </Text>
      <View style={[styles.radio, selected ? { borderWidth: 6, borderColor: colors.accent } : { borderWidth: 2, borderColor: colors.borderStrong }]} />
    </PressableScale>
  );
}

const W = 72;
const H = 96;

function SwatchHalf({ t, clip }: { t: ThemeColors; clip?: string }) {
  return (
    <G clipPath={clip}>
      <Rect width={W} height={H} rx={10} fill={t.bg} />
      <Rect x={8} y={12} width={40} height={7} rx={3.5} fill={t.text} />
      <Rect x={8} y={26} width={56} height={30} rx={6} fill={t.surface} stroke={t.border} />
      <Rect x={14} y={34} width={26} height={9} rx={3} fill={t.text} />
      <Rect x={14} y={47} width={44} height={3} rx={1.5} fill={t.accent} />
      <Rect x={8} y={62} width={56} height={10} rx={5} fill={t.surface} stroke={t.border} />
    </G>
  );
}

function Swatch({ kind }: { kind: ThemePreference }) {
  const { colors } = useTheme();
  const mode: ThemeMode = kind === 'dark' ? 'dark' : 'light';
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id="sw-l">
          <Rect width={W / 2} height={H} />
        </ClipPath>
        <ClipPath id="sw-r">
          <Rect x={W / 2} width={W / 2} height={H} />
        </ClipPath>
      </Defs>
      {kind === 'system' ? (
        <>
          <SwatchHalf t={color.light} clip="url(#sw-l)" />
          <SwatchHalf t={color.dark} clip="url(#sw-r)" />
        </>
      ) : (
        <SwatchHalf t={color[mode]} />
      )}
      <Rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} fill="none" stroke={colors.border} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  options: {
    flexDirection: 'row',
    gap: space[4],
  },
  optionsStacked: {
    flexDirection: 'column',
  },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[5],
    paddingHorizontal: space[3],
    borderRadius: radius.lg,
  },
  optionStacked: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: space[5],
    gap: space[5],
  },
  label: {
    fontFamily: type.headline.fontFamily,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderRadius: radius.lg,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
  },
});
