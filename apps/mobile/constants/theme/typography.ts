// Stockpile — Typography Scale (Inter)

import { colors } from './colors';

export const typography = {
  display: {
    fontFamily: 'Inter_700Bold',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  h1: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  h2: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  h3: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  caption: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: colors.textSecondary,
  },
  micro: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
    color: colors.textTertiary,
  },
  mono: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
    fontVariant: ['tabular-nums'] as const,
    color: colors.textPrimary,
  },
} as const;
