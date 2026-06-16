// Stockpile — Shadow Definitions for Light Theme

import { Platform, ViewStyle } from 'react-native';

export const shadows: Record<string, ViewStyle> = {
  card: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: {
      elevation: 2,
    },
    default: {},
  }) as ViewStyle,

  cardLifted: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
    },
    android: {
      elevation: 4,
    },
    default: {},
  }) as ViewStyle,
};
