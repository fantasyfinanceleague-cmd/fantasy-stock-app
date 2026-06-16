import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { Colors } from '@/constants/Colors';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%' as const, height = 20, borderRadius = 4, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton width={100} height={14} />
      <View style={{ height: 8 }} />
      <Skeleton width={180} height={36} />
      <View style={{ height: 4 }} />
      <Skeleton width={80} height={14} />
    </View>
  );
}

export function SkeletonHolding() {
  return (
    <View style={styles.holdingRow}>
      <View>
        <Skeleton width={60} height={16} />
        <View style={{ height: 4 }} />
        <Skeleton width={80} height={12} />
      </View>
      <View style={styles.holdingRight}>
        <Skeleton width={70} height={16} />
        <View style={{ height: 4 }} />
        <Skeleton width={50} height={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#E2E8F0',
  },
  card: {
    backgroundColor: Colors.glassBg,
    marginHorizontal: 24,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  holdingRow: {
    backgroundColor: Colors.glassBg,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holdingRight: {
    alignItems: 'flex-end',
  },
});
