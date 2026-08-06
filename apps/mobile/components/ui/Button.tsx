import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Colors } from '@/constants/Colors';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'success'
  | 'danger'
  | 'dangerOutline';

export type ButtonSize = 'md' | 'sm';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon element (e.g. an Ionicons node). */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const CONTAINER: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: Colors.primary },
  secondary: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  success: { backgroundColor: Colors.success },
  danger: { backgroundColor: Colors.error },
  dangerOutline: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.error,
  },
};

const TEXT_COLOR: Record<ButtonVariant, string> = {
  primary: Colors.white,
  secondary: Colors.textPrimary,
  ghost: Colors.primary,
  success: Colors.white,
  danger: Colors.white,
  dangerOutline: Colors.error,
};

/**
 * The app's single button. Handles disabled + loading states and
 * accessibility uniformly so screens never re-implement them.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
}: ButtonProps) {
  const blocked = disabled || loading;
  const textColor = TEXT_COLOR[variant];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        CONTAINER[variant],
        blocked && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={blocked}
      activeOpacity={0.8}
      hitSlop={size === 'sm' ? { top: 8, bottom: 8, left: 4, right: 4 } : undefined}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: blocked, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text
            style={[
              size === 'sm' ? styles.textSm : styles.textMd,
              { color: textColor },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  md: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    minHeight: 48,
  },
  sm: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 36,
  },
  disabled: {
    opacity: 0.5,
  },
  icon: {
    marginRight: 6,
  },
  textMd: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  textSm: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
