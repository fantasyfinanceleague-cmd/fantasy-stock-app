/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/constants/tokens';
import { PressableScale, PressableScaleProps } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <Button> (Phase 2 foundation). SOURCE OF TRUTH: §9.
// Primary is stadium navy on EITHER surface — §9: "Primary buttons are
// stadium navy: neutral, and not a team colour" — so it stays fixed rather
// than reading from <Surface>. Secondary/ghost/destructive adapt their
// border/text to the ambient surface so they don't go invisible on a
// stadium background.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends Omit<PressableScaleProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// Both sizes clear the 44pt minimum tap target (Apple HIG / WCAG 2.5.5).
const HEIGHT: Record<ButtonSize, number> = { md: 52, sm: 44 };
const PADDING_X: Record<ButtonSize, number> = { md: space[6], sm: space[5] };

export function Button({ label, variant = 'primary', size = 'md', disabled, ...rest }: ButtonProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';

  const borderColor = onGame ? color.surface.game.line : color.border.control;
  const onSurfaceTextColor = onGame ? color.text.onGame.primary : color.text.primary;

  let backgroundColor: string | undefined;
  let textColor: string;
  let borderWidth = 0;

  switch (variant) {
    case 'primary':
      backgroundColor = color.action.primary.bg;
      textColor = color.action.primary.fg;
      break;
    case 'destructive':
      backgroundColor = color.status.danger;
      textColor = color.action.primary.fg;
      break;
    case 'secondary':
      backgroundColor = undefined;
      textColor = onSurfaceTextColor;
      borderWidth = 1;
      break;
    case 'ghost':
    default:
      backgroundColor = undefined;
      textColor = onSurfaceTextColor;
      break;
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={[
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING_X[size],
          borderRadius: radius.md,
          backgroundColor,
          borderWidth,
          borderColor,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      {...rest}
    >
      <View style={styles.content}>
        <Text variant={size === 'md' ? 'headline' : 'callout'} color={textColor} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
