/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet } from 'react-native';

import { color, radius, space } from '@/constants/tokens';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <Chip> (Phase 2 foundation). A generic selectable pill (league
// filter, phase filter, segmented option). For the broadcast phase badge
// specifically, use <PhaseChip>, not this component directly.

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}

export function Chip({ label, selected = false, onPress, disabled }: ChipProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';

  const selectedBg = color.brand;
  const idleBg = onGame ? color.surface.game.raised : color.surface.money.sunken;
  const selectedText = color.action.primary.fg;
  const idleText = onGame ? color.text.onGame.secondary : color.text.secondary;

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
