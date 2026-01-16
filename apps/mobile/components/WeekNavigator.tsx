import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

interface WeekNavigatorProps {
  currentWeek: number;
  selectedWeek: number;
  totalWeeks?: number;
  onWeekChange: (week: number) => void;
  disabled?: boolean;
}

export default function WeekNavigator({
  currentWeek,
  selectedWeek,
  totalWeeks,
  onWeekChange,
  disabled = false
}: WeekNavigatorProps) {
  const canGoPrev = selectedWeek > 1 && !disabled;
  const canGoNext = selectedWeek < currentWeek && !disabled;
  const isViewingCurrent = selectedWeek === currentWeek;
  const isViewingPast = selectedWeek < currentWeek;

  const handlePrev = () => {
    if (canGoPrev) {
      onWeekChange(selectedWeek - 1);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onWeekChange(selectedWeek + 1);
    }
  };

  return (
    <View style={styles.container}>
      {/* Previous arrow */}
      <TouchableOpacity
        onPress={handlePrev}
        disabled={!canGoPrev}
        style={[styles.arrowButton, !canGoPrev && styles.arrowButtonDisabled]}
      >
        <Ionicons
          name="chevron-back"
          size={20}
          color={canGoPrev ? Colors.primaryLight : Colors.textDark}
        />
      </TouchableOpacity>

      {/* Week display */}
      <View style={styles.weekDisplay}>
        <Text style={styles.weekText}>Week {selectedWeek}</Text>
        {isViewingCurrent && (
          <View style={styles.badgeCurrent}>
            <Text style={styles.badgeTextCurrent}>Current</Text>
          </View>
        )}
        {isViewingPast && (
          <View style={styles.badgeFinal}>
            <Text style={styles.badgeTextFinal}>Final</Text>
          </View>
        )}
      </View>

      {/* Next arrow */}
      <TouchableOpacity
        onPress={handleNext}
        disabled={!canGoNext}
        style={[styles.arrowButton, !canGoNext && styles.arrowButtonDisabled]}
      >
        <Ionicons
          name="chevron-forward"
          size={20}
          color={canGoNext ? Colors.primaryLight : Colors.textDark}
        />
      </TouchableOpacity>

      {/* Total weeks */}
      {totalWeeks && (
        <Text style={styles.totalWeeks}>of {totalWeeks}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  arrowButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.primaryBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowButtonDisabled: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    opacity: 0.5,
  },
  weekDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 120,
    justifyContent: 'center',
  },
  weekText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  badgeCurrent: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: Colors.primaryBg,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  badgeTextCurrent: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primaryLight,
  },
  badgeFinal: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  badgeTextFinal: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  totalWeeks: {
    fontSize: 12,
    color: Colors.textMuted,
    marginLeft: 4,
  },
});
