/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/Colors';
import { shadows, spacing } from '@/constants/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** false for cards whose children are full-bleed rows (lists). */
  padded?: boolean;
  /** Stronger shadow for hero / focal cards. */
  lifted?: boolean;
}

/** The app's single card surface: white, 16 radius, hairline border, soft shadow. */
export function Card({ children, style, padded = true, lifted = false }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        lifted ? shadows.cardLifted : shadows.card,
        padded ? styles.padded : styles.unpadded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  padded: {
    padding: spacing.lg,
  },
  unpadded: {
    overflow: 'hidden',
  },
});
