import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

export type BannerVariant = 'error' | 'warning' | 'success' | 'info';

interface BannerProps {
  variant?: BannerVariant;
  message: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
}

const VARIANT: Record<
  BannerVariant,
  { bg: string; border: string; fg: string; icon: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  error: { bg: Colors.errorBg, border: Colors.errorBorder, fg: Colors.error, icon: 'alert-circle' },
  warning: { bg: Colors.warningBg, border: Colors.warningBorder, fg: Colors.warning, icon: 'warning' },
  success: { bg: Colors.successBg, border: Colors.successBorder, fg: Colors.success, icon: 'checkmark-circle' },
  info: { bg: Colors.infoBg, border: Colors.infoBorder, fg: Colors.info, icon: 'information-circle' },
};

/**
 * Inline, non-blocking status banner. Use for load failures, form-level
 * errors, and confirmations. Reserve Alert.alert for destructive-action
 * confirmations that must interrupt.
 */
export function Banner({ variant = 'info', message, title, style }: BannerProps) {
  const v = VARIANT[variant];
  return (
    <View
      style={[styles.box, { backgroundColor: v.bg, borderColor: v.border }, style]}
      accessibilityRole="alert"
    >
      <Ionicons name={v.icon} size={18} color={v.fg} style={styles.icon} />
      <View style={styles.textContainer}>
        {title ? <Text style={[styles.title, { color: v.fg }]}>{title}</Text> : null}
        <Text style={[styles.message, { color: v.fg }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  icon: {
    marginRight: 8,
    marginTop: 1,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
});
