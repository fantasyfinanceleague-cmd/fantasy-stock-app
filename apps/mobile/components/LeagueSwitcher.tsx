import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useLeagueContext, League } from '@/lib/LeagueContext';

interface LeagueSwitcherProps {
  title?: string; // Optional title override (e.g., "Matchup", "Portfolio")
}

export default function LeagueSwitcher({ title }: LeagueSwitcherProps) {
  const { leagues, activeLeague, activeLeagueId, setActiveLeagueId } = useLeagueContext();
  const [modalVisible, setModalVisible] = useState(false);

  const displayName = title || activeLeague?.name || 'Select League';

  const handleSelectLeague = (league: League) => {
    setActiveLeagueId(league.id);
    setModalVisible(false);
  };

  const getLeagueIcon = (league: League) => {
    // Simple icon based on league type
    if (league.league_type === 'matchup') return '🤑';
    return '📈';
  };

  return (
    <>
      {/* Header bar with league name */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.headerTouchable}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
        >
          {activeLeague && (
            <Text style={styles.leagueIcon}>{getLeagueIcon(activeLeague)}</Text>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Ionicons
            name="caret-down"
            size={14}
            color={Colors.textPrimary}
            style={styles.chevron}
          />
        </TouchableOpacity>
      </View>

      {/* League selection modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalContent}>
            {/* Arrow pointer */}
            <View style={styles.arrow} />

            <ScrollView style={styles.leagueList} bounces={false}>
              {leagues.map((league, index) => {
                const isLast = index === leagues.length - 1;
                return (
                  <TouchableOpacity
                    key={league.id}
                    style={[
                      styles.leagueItem,
                      league.id === activeLeagueId && styles.leagueItemActive,
                      isLast && styles.leagueItemLast,
                    ]}
                    onPress={() => handleSelectLeague(league)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.leagueItemIcon}>{getLeagueIcon(league)}</Text>
                    <View style={styles.leagueItemInfo}>
                      <Text style={styles.leagueItemName} numberOfLines={1}>
                        {league.name}
                      </Text>
                      <Text style={styles.leagueItemMeta}>
                        {league.league_type === 'matchup' ? 'Matchup' : 'Duration'} League
                      </Text>
                    </View>
                    {league.id === activeLeagueId && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={Colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}

              {leagues.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No leagues yet</Text>
                </View>
              )}

            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    backgroundColor: Colors.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  headerTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    maxWidth: 240,
  },
  chevron: {
    marginLeft: 6,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingTop: 100,
  },
  modalContent: {
    marginHorizontal: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 400,
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: Colors.cardBg,
  },
  leagueList: {
    paddingTop: 8,
  },
  leagueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  leagueItemLast: {
    borderBottomWidth: 0,
  },
  leagueItemActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  leagueItemIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  leagueItemInfo: {
    flex: 1,
  },
  leagueItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  leagueItemMeta: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
