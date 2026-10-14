/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { radius, space, typeFontFamily } from '@/constants/tokens';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// 3c-2 — the board's stepper (inventory.jsx `Stepper`: label + optional sub on
// the left, a bordered − value + box on the right). The buttons are 44 pt
// (the craft floor; the board draws 36) and use sp/Icon remove/add, never a
// text glyph (§9B). For VoiceOver the whole control is ONE adjustable element
// (swipe up/down), the native iOS stepper pattern, announcing its value. At
// accessibility sizes the box wraps under the label instead of squeezing it.

export interface StepperProps {
  label: string;
  sub?: string;
  value: number;
  unit?: string;
  onStep: (direction: 1 | -1) => void;
  canDecrement: boolean;
  canIncrement: boolean;
  disabled?: boolean;
  /** The board's blocked state (the blockers card, "8 playoff teams, but 7 teams are in"):
   * a 2 pt warn-line border on the box. Warn, never red (§9B: blockers keep
   * the warn tint; red is for field errors, losses and destructive actions). */
  emphasis?: 'warn';
}

export function Stepper({ label, sub, value, unit, onStep, canDecrement, canIncrement, disabled = false, emphasis }: StepperProps) {
  const { colors } = useTheme();
  // At accessibility sizes the box goes UNDER the label (W4 Onboarding, XL): beside it, the label's
  // column was too narrow and "Managers" broke mid-word ("Manager / s").
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;
  const down = !disabled && canDecrement;
  const up = !disabled && canIncrement;
  const valueText = unit ? `${value} ${unit}` : String(value);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityValue={{ text: valueText }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && up) onStep(1);
        if (e.nativeEvent.actionName === 'decrement' && down) onStep(-1);
      }}
      style={[styles.row, stacked && styles.rowStacked, disabled && styles.dim]}
    >
      <View style={stacked ? styles.textsStacked : styles.texts}>
        <Text variant="callout" style={styles.label}>
          {label}
        </Text>
        {sub ? (
          <Text variant="caption" tone="secondary">
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.box, emphasis === 'warn' ? { borderColor: colors.warnLine, borderWidth: 2 } : { borderColor: colors.border }]}>
        <Pressable onPress={() => down && onStep(-1)} disabled={!down} style={styles.button} hitSlop={2}>
          <Icon name="remove" size="headline" tone={down ? 'text' : 'text3'} />
        </Pressable>
        <View style={[styles.value, { borderColor: colors.border }]}>
          <Text variant="headline" style={styles.tabular}>
            {valueText}
          </Text>
        </View>
        <Pressable onPress={() => up && onStep(1)} disabled={!up} style={styles.button} hitSlop={2}>
          <Icon name="add" size="headline" tone={up ? 'text' : 'text3'} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  dim: {
    opacity: 0.5,
  },
  textsStacked: {
    alignSelf: 'stretch',
    gap: space[1],
  },
  texts: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    gap: space[1],
  },
  label: {
    fontFamily: typeFontFamily.semiBold,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    minWidth: 64,
    paddingHorizontal: space[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
