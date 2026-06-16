import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext, League } from '@/lib/LeagueContext';
import { supabase } from '@/lib/supabase';
import { validateLeagueName } from '@/lib/contentModeration';

const ACCENT = Colors.primary;
const ACCENT_BG = Colors.primaryBg;

export default function LeagueSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { leagues, refresh } = useLeagueContext();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Find the league
  const league = leagues.find(l => l.id === leagueId);

  // Form state
  const [name, setName] = useState('');
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftDateTBD, setDraftDateTBD] = useState(true);
  const [budgetMode, setBudgetMode] = useState<'budget' | 'no-budget'>('budget');
  const [budgetAmount, setBudgetAmount] = useState('100000');
  const [numParticipants, setNumParticipants] = useState(8);
  const [numRounds, setNumRounds] = useState(6);
  const [startingNewSeason, setStartingNewSeason] = useState(false);

  // Initialize form with league data
  useEffect(() => {
    if (league) {
      setName(league.name);
      setDraftDateTBD(!league.draft_date);
      setDraftDate(league.draft_date ? new Date(league.draft_date) : null);
      setBudgetMode(league.budget_mode);
      setBudgetAmount(String(league.budget_amount || 100000));
      setNumParticipants(league.num_participants);
      setNumRounds(league.num_rounds);
    }
  }, [league]);

  const handleClose = () => {
    router.dismiss();
  };

  // Check if user is commissioner
  const isCommissioner = league?.commissioner_id === user?.id;

  // Check if settings are locked (draft started or completed)
  const isLocked = league?.draft_status === 'in_progress' || league?.draft_status === 'completed';

  const handleSave = async () => {
    if (!league || !user?.id) return;

    // Validate name
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a league name');
      return;
    }

    const contentCheck = validateLeagueName(trimmedName);
    if (!contentCheck.isValid) {
      Alert.alert('Error', contentCheck.reason || 'League name is not allowed');
      return;
    }

    setSaving(true);

    try {
      const budgetAmt = budgetMode === 'no-budget' ? null : parseInt(budgetAmount) || 100000;

      const { error } = await supabase
        .from('leagues')
        .update({
          name: trimmedName,
          draft_date: draftDateTBD ? null : draftDate?.toISOString(),
          budget_mode: budgetMode,
          budget_amount: budgetAmt || 100000,
          salary_cap_limit: budgetAmt,
          num_participants: numParticipants,
          num_rounds: numRounds,
        })
        .eq('id', league.id);

      if (error) throw error;

      await refresh();

      Alert.alert('Success', 'League settings updated', [
        { text: 'OK', onPress: () => router.dismiss() }
      ]);
    } catch (error: any) {
      console.error('Failed to update league:', error);
      Alert.alert('Error', error.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleStartNewSeason = async () => {
    if (!league || !user?.id) return;

    Alert.alert(
      'Start New Season',
      'This will:\n\n• Reset all standings to 0-0\n• Generate a new matchup schedule\n• Keep all current league members\n\nAre you sure you want to start a new season?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Season',
          style: 'default',
          onPress: async () => {
            setStartingNewSeason(true);
            try {
              const { error } = await supabase.rpc('start_new_league_season', {
                p_league_id: league.id,
              });

              if (error) throw error;

              await refresh();

              Alert.alert(
                'New Season Started!',
                'The league has been reset for a new season. Good luck!',
                [{ text: 'OK', onPress: () => router.dismiss() }]
              );
            } catch (error: any) {
              console.error('Failed to start new season:', error);
              Alert.alert('Error', error.message || 'Failed to start new season');
            } finally {
              setStartingNewSeason(false);
            }
          },
        },
      ]
    );
  };

  if (!league) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleClose}>
            <Ionicons name="close" size={28} color={Colors.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>League Settings</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>League not found</Text>
        </View>
      </View>
    );
  }

  if (!isCommissioner) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleClose}>
            <Ionicons name="close" size={28} color={Colors.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>League Settings</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centerContent}>
          <Ionicons name="lock-closed" size={48} color={Colors.textMuted} />
          <Text style={styles.errorText}>Only the commissioner can edit settings</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleClose}>
          <Ionicons name="close" size={28} color={Colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>League Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Lock Warning */}
          {isLocked && (
            <View style={styles.lockWarning}>
              <Ionicons name="lock-closed" size={18} color={Colors.warning} />
              <Text style={styles.lockWarningText}>
                {league.draft_status === 'completed'
                  ? 'Draft completed - settings are locked'
                  : 'Draft in progress - settings are locked'}
              </Text>
            </View>
          )}

          {/* League Name */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>League Name</Text>
            <TextInput
              style={[styles.textInput, isLocked && styles.inputDisabled]}
              value={name}
              onChangeText={setName}
              placeholder="League name"
              placeholderTextColor={Colors.textDark}
              editable={!isLocked}
            />
          </View>

          {/* Draft Date */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Draft Date</Text>

            <TouchableOpacity
              style={[styles.radioOption, draftDateTBD && styles.radioOptionSelected, isLocked && styles.inputDisabled]}
              onPress={() => !isLocked && setDraftDateTBD(true)}
              disabled={isLocked}
            >
              <View style={styles.radio}>
                {draftDateTBD && <View style={styles.radioInner} />}
              </View>
              <Text style={[styles.radioText, draftDateTBD && styles.radioTextSelected]}>
                TBD - Set later
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.radioOption, !draftDateTBD && styles.radioOptionSelected, isLocked && styles.inputDisabled]}
              onPress={() => {
                if (isLocked) return;
                setDraftDateTBD(false);
                setShowDatePicker(true);
              }}
              disabled={isLocked}
            >
              <View style={styles.radio}>
                {!draftDateTBD && <View style={styles.radioInner} />}
              </View>
              <Ionicons name="calendar" size={18} color={!draftDateTBD ? ACCENT : Colors.textMuted} />
              <Text style={[styles.radioText, !draftDateTBD && styles.radioTextSelected]}>
                {draftDate
                  ? draftDate.toLocaleString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Pick a date & time'}
              </Text>
            </TouchableOpacity>

            {showDatePicker && !draftDateTBD && !isLocked && (
              <>
                <DateTimePicker
                  value={draftDate || new Date()}
                  mode="datetime"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant="light"
                  onChange={(event, selectedDate) => {
                    if (Platform.OS !== 'ios') setShowDatePicker(false);
                    if (selectedDate) setDraftDate(selectedDate);
                  }}
                  minimumDate={new Date()}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity style={styles.datePickerDone} onPress={() => setShowDatePicker(false)}>
                    <Text style={styles.datePickerDoneText}>Done</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Budget Mode */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Budget Mode</Text>
            <View style={styles.cardRow}>
              <TouchableOpacity
                style={[styles.modeCard, budgetMode === 'budget' && styles.modeCardSelected, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setBudgetMode('budget')}
                disabled={isLocked}
              >
                <Ionicons name="wallet" size={24} color={budgetMode === 'budget' ? ACCENT : Colors.textMuted} />
                <Text style={[styles.modeCardText, budgetMode === 'budget' && styles.modeCardTextSelected]}>
                  Salary Cap
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeCard, budgetMode === 'no-budget' && styles.modeCardSelected, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setBudgetMode('no-budget')}
                disabled={isLocked}
              >
                <Ionicons name="infinite" size={24} color={budgetMode === 'no-budget' ? ACCENT : Colors.textMuted} />
                <Text style={[styles.modeCardText, budgetMode === 'no-budget' && styles.modeCardTextSelected]}>
                  No Limit
                </Text>
              </TouchableOpacity>
            </View>

            {budgetMode === 'budget' && (
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={[styles.budgetInput, isLocked && styles.inputDisabled]}
                  value={budgetAmount}
                  onChangeText={(text) => setBudgetAmount(text.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="100000"
                  placeholderTextColor={Colors.textDark}
                  editable={!isLocked}
                />
              </View>
            )}
          </View>

          {/* Number of Teams */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Number of Teams</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setNumParticipants(Math.max(4, numParticipants - 1))}
                disabled={isLocked}
              >
                <Ionicons name="remove" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{numParticipants}</Text>
                <Text style={styles.stepperValueLabel}>teams</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepperBtn, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setNumParticipants(Math.min(16, numParticipants + 1))}
                disabled={isLocked}
              >
                <Ionicons name="add" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Stocks Per Team */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Stocks Per Team</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setNumRounds(Math.max(1, numRounds - 1))}
                disabled={isLocked}
              >
                <Ionicons name="remove" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{numRounds}</Text>
                <Text style={styles.stepperValueLabel}>stocks</Text>
              </View>
              <TouchableOpacity
                style={[styles.stepperBtn, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setNumRounds(Math.min(12, numRounds + 1))}
                disabled={isLocked}
              >
                <Ionicons name="add" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* League Info (Read-only) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>League Info</Text>
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Type</Text>
                <Text style={styles.infoValue}>
                  {league.league_type === 'matchup' ? 'Matchup' : 'Duration'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>
                  {league.league_type === 'matchup' ? 'Season' : 'Duration'}
                </Text>
                <Text style={styles.infoValue}>
                  {league.league_type === 'matchup'
                    ? `${league.num_weeks} weeks`
                    : `${league.duration_days} days`}
                </Text>
              </View>
              {league.league_type === 'matchup' && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Playoff Teams</Text>
                  <Text style={styles.infoValue}>{league.playoff_teams}</Text>
                </View>
              )}
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoLabel}>Invite Code</Text>
                <Text style={[styles.infoValue, { color: ACCENT }]}>{league.invite_code}</Text>
              </View>
            </View>
          </View>

          {/* Start New Season - Only show when season is completed */}
          {league.season_status === 'completed' && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Season Complete</Text>
              <View style={styles.seasonCompleteCard}>
                <View style={styles.seasonCompleteHeader}>
                  <Ionicons name="trophy" size={24} color={Colors.gold} />
                  <Text style={styles.seasonCompleteText}>
                    The current season has ended. Start a new season to reset standings and begin a new competition with the same members.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.newSeasonButton, startingNewSeason && styles.newSeasonButtonDisabled]}
                  onPress={handleStartNewSeason}
                  disabled={startingNewSeason}
                >
                  {startingNewSeason ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={20} color="#FFFFFF" />
                      <Text style={styles.newSeasonButtonText}>Start New Season</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Save Button */}
        {!isLocked && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  // Lock warning
  lockWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.warningBg,
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    gap: 8,
  },
  lockWarningText: {
    flex: 1,
    fontSize: 14,
    color: Colors.warning,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },

  // Text input
  textInput: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputDisabled: {
    opacity: 0.5,
  },

  // Radio options
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 12,
  },
  radioOptionSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  radioText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textMuted,
  },
  radioTextSelected: {
    color: Colors.textPrimary,
  },

  // Date picker
  datePickerDone: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT,
  },

  // Mode cards
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  modeCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 8,
  },
  modeCardSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  modeCardText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  modeCardTextSelected: {
    color: ACCENT,
  },

  // Budget input
  budgetInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 12,
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textMuted,
    marginRight: 4,
  },
  budgetInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    paddingVertical: 14,
  },

  // Stepper
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 12,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    alignItems: 'center',
    marginHorizontal: 32,
    minWidth: 60,
  },
  stepperValueText: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  stepperValueLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },

  // Info card
  infoCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveButton: {
    backgroundColor: Colors.success,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: Colors.border,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // New Season section
  seasonCompleteCard: {
    backgroundColor: Colors.goldBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  seasonCompleteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  seasonCompleteText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  newSeasonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  newSeasonButtonDisabled: {
    opacity: 0.6,
  },
  newSeasonButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
