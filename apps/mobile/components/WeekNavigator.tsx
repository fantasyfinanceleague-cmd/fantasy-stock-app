import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { getPlayoffRoundLabel } from '@/lib/weekStatus';

interface WeekNavigatorProps {
  currentWeek: number;
  selectedWeek: number;
  totalWeeks?: number;
  maxWeek?: number;
  onWeekChange: (week: number) => void;
  disabled?: boolean;
  phase?: 'regular' | 'playoffs' | 'completed';
  playoffRoundForWeek?: (week: number) => string | null;
}

export default function WeekNavigator({
  currentWeek,
  selectedWeek,
  totalWeeks,
  maxWeek,
  onWeekChange,
  disabled = false,
  phase,
  playoffRoundForWeek,
}: WeekNavigatorProps) {
  const effectiveMax = maxWeek ?? currentWeek;
  const canGoPrev = selectedWeek > 1 && !disabled;
  const canGoNext = (() => {
    if (disabled || selectedWeek >= effectiveMax) return false;
    if (phase === 'regular' && totalWeeks && selectedWeek >= totalWeeks) return false;
    return true;
  })();
  const isViewingCurrent = phase === 'completed'
    ? selectedWeek === effectiveMax
    : selectedWeek === currentWeek;
  const isViewingPast = phase === 'completed'
    ? selectedWeek < effectiveMax
    : selectedWeek < currentWeek;

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
        <Text style={styles.weekText}>
          {totalWeeks && selectedWeek > totalWeeks && playoffRoundForWeek
            ? (getPlayoffRoundLabel(playoffRoundForWeek(selectedWeek)) || `Week ${selectedWeek}`)
            : `Week ${selectedWeek}`
          }
        </Text>
        {isViewingCurrent && phase !== 'completed' && (
          <View style={styles.badgeCurrent}>
            <Text style={styles.badgeTextCurrent}>Current</Text>
          </View>
        )}
        {(isViewingPast || (isViewingCurrent && phase === 'completed')) && (
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

      {/* Total weeks - hide during playoffs/completed since weeks extend beyond regular season */}
      {totalWeeks && phase === 'regular' && (
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
    backgroundColor: '#F8FAFC',
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
    backgroundColor: '#F1F5F9',
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
    borderColor: '#0891B2',
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
    color: '#FFFFFF',
  },
  totalWeeks: {
    fontSize: 12,
    color: Colors.textMuted,
    marginLeft: 4,
  },
});
