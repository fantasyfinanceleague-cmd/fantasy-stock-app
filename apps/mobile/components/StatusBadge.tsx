import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Colors } from '@/constants/Colors';

type BadgeType = 'final' | 'live' | 'pending' | 'holiday' | 'champion';

interface StatusBadgeProps {
  type: BadgeType;
  text?: string;
  week?: number;
  holidayName?: string;
}

export default function StatusBadge({ type, text, week, holidayName }: StatusBadgeProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (type === 'live') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    }
  }, [type, pulseAnim]);

  const getBadgeConfig = () => {
    switch (type) {
      case 'final':
        return {
          backgroundColor: Colors.success,
          textColor: '#FFFFFF',
          displayText: text || 'Final',
          showDot: false,
        };
      case 'live':
        return {
          backgroundColor: Colors.errorBg,
          textColor: Colors.error,
          borderColor: '#FECACA',
          displayText: text || 'Live',
          showDot: true,
        };
      case 'pending':
        return {
          backgroundColor: Colors.primaryBg,
          textColor: Colors.primaryLight,
          borderColor: '#BFDBFE',
          displayText: text || 'Pending',
          showDot: false,
        };
      case 'holiday':
        return {
          backgroundColor: Colors.warningBg,
          textColor: Colors.warning,
          borderColor: '#FDE68A',
          displayText: text || (holidayName ? `Market closed - ${holidayName}` : 'Holiday'),
          showDot: false,
        };
      case 'champion':
        return {
          backgroundColor: Colors.gold,
          textColor: '#451a03',
          displayText: text || 'Champion',
          showDot: false,
        };
      default:
        return null;
    }
  };

  const config = getBadgeConfig();
  if (!config) return null;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: config.backgroundColor },
        config.borderColor && { borderWidth: 1, borderColor: config.borderColor },
      ]}
    >
      {config.showDot && (
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: config.textColor, opacity: pulseAnim },
          ]}
        />
      )}
      <Text style={[styles.badgeText, { color: config.textColor }]}>
        {config.displayText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
