/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Chip> (§9A, "One design, two themes", 2026-09-29). A generic
// selectable pill (league filter, phase filter, segmented option). For the
// broadcast phase badge specifically, use <PhaseChip>, not this component
// directly.

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

export function Chip({ label, selected = false, onPress, disabled }: ChipProps) {
  const { colors } = useTheme();

  // Selected state uses the PAIRS-verified "selected nav / icon tile"
  // pairing (accent text on accentTint) — NOT a solid accent fill with
  // onAccent text, which was tried first here and computed out to only
  // ~2.4:1 in Dark (accent there is a light pastel blue; white text on it
  // fails badly). accent-on-accentTint is 4.50:1 Light / 4.74:1 Dark.
  const selectedBg = colors.accentTint;
  const idleBg = colors.sunken;
  const selectedText = colors.accent;
  const idleText = colors.text2;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      haptic={false}
      style={[
        styles.base,
        { backgroundColor: selected ? selectedBg : idleBg, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text variant="callout" color={selected ? selectedText : idleText} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
});
