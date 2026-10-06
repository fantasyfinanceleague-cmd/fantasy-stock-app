/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform, ScrollView, KeyboardAvoidingView, Switch } from 'react-native';
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
import SlotBuilder from '@/components/SlotBuilder';
import {
  type Category,
  type SlotDraft,
  type StakeMode,
  DEFAULT_BUDGET_CAP,
  DEFAULT_NOTIONAL_PER_SLOT,
  STAKE_MODE_OPTIONS,
  fetchCategories,
  loadLeagueSlots,
  validateSlotConfig,
} from '@/lib/categoryData';
import { seamSaveLeagueSlots, seamUpdateLeague } from '@/lib/game/seamCalls';
import { settingsSaveOutcome } from '@/lib/game/settingsSave';
import { leaveLeagueEnabled } from '@/lib/game/leaveLeague';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { DEFAULT_PICK_SECONDS, PICK_SECONDS_OPTIONS, pickClockLocked, pickSecondsCaption } from '@/lib/game/createLeagueSetup';
import { Button, Card } from '@/components/ui';

/** Off until the leave flow ships. The row's placement is decided (Design Lead's leave board); its behaviour is not. */
const LEAVE_LEAGUE_ON = leaveLeagueEnabled(process.env.EXPO_PUBLIC_LEAVE_LEAGUE);

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
  // '' = no stake mode chosen yet (legacy NULL league) — drafting is blocked
  // until the commissioner picks one here.
  const [stakeMode, setStakeMode] = useState<'' | StakeMode>('');
  const [notionalPerSlot, setNotionalPerSlot] = useState(String(DEFAULT_NOTIONAL_PER_SLOT));
  const [budgetCap, setBudgetCap] = useState(String(DEFAULT_BUDGET_CAP));
  const [allowUndraftable, setAllowUndraftable] = useState(false);
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { fetchCategories().then(setCategories); }, []);
  const [numParticipants, setNumParticipants] = useState(8);
  const [numRounds, setNumRounds] = useState(6);
  const [pickSeconds, setPickSeconds] = useState(DEFAULT_PICK_SECONDS);

  // Initialize form with league data
  useEffect(() => {
    if (league) {
      setName(league.name);
      setDraftDateTBD(!league.draft_date);
      setDraftDate(league.draft_date ? new Date(league.draft_date) : null);
      setStakeMode((league.stake_mode ?? '') as '' | StakeMode);
      setNotionalPerSlot(String(league.notional_per_slot ?? DEFAULT_NOTIONAL_PER_SLOT));
      setBudgetCap(String(league.budget_amount ?? DEFAULT_BUDGET_CAP));
      setAllowUndraftable(!!league.allow_undraftable);
      loadLeagueSlots(league.id).then(setSlots);
      setNumParticipants(league.num_participants);
      setNumRounds(league.num_rounds);
      setPickSeconds(league.pick_seconds ?? DEFAULT_PICK_SECONDS);
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
      if (stakeMode === 'price_tiers' && slots.length === 0) {
        Alert.alert('Add a slot', 'Price tiers need at least one slot with a price bracket.');
        setSaving(false);
        return;
      }
      const slotErrors = validateSlotConfig(slots, numRounds);
      if (slotErrors.length > 0) {
        Alert.alert('Fix roster slots', slotErrors[0]);
        setSaving(false);
        return;
      }

      // stake_mode written only when chosen — '' (legacy NULL league) leaves
      // the column untouched rather than writing a default the commissioner
      // didn't pick. budget_mode / salary_cap_limit: retired, never written.
      const patch: Record<string, unknown> = {
        name: trimmedName,
        draft_date: draftDateTBD ? null : draftDate?.toISOString(),
        num_participants: numParticipants,
        num_rounds: numRounds,
        allow_undraftable: allowUndraftable,
        // Frozen once the draft starts (trg_leagues_pick_clock): written only before then.
        ...(isLocked ? {} : { pick_seconds: pickSeconds }),
      };
      if (stakeMode) {
        patch.stake_mode = stakeMode;
        patch.notional_per_slot = parseInt(notionalPerSlot) || DEFAULT_NOTIONAL_PER_SLOT;
        if (stakeMode === 'budget_cap') {
          patch.budget_amount = parseInt(budgetCap) || DEFAULT_BUDGET_CAP;
        }
      }

      // Order: the league row first. It carries the rules freeze, so a refusal
      // here writes nothing. The roster second: if it is refused after the league
      // row landed, the outcome says PARTLY saved rather than a raw error.
      const { error } = await seamUpdateLeague(league.id, patch);
      if (error) {
        const outcome = settingsSaveOutcome({ patchError: error, slotsError: null });
        Alert.alert(outcome.title ?? 'Not saved', outcome.message ?? '');
        return;
      }

      if (!isLocked) {
        try {
          await seamSaveLeagueSlots(league.id, slots);
        } catch (slotErr) {
          console.error('Roster save refused after the league row landed:', slotErr);
          const outcome = settingsSaveOutcome({ patchError: null, slotsError: slotErr as { message?: string } });
          await refresh();
          Alert.alert(outcome.title ?? 'Partly saved', outcome.message ?? '');
          return;
        }
      }

      await refresh();

      Alert.alert('Success', 'League settings updated', [
        { text: 'OK', onPress: () => router.dismiss() }
      ]);
    } catch (error: any) {
      console.error('Failed to update league:', error);
      Alert.alert('Not saved', "Your settings didn't save. Try again.");
    } finally {
      setSaving(false);
    }
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

          {/* Pick clock: frozen once the draft starts (trg_leagues_pick_clock) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pick clock</Text>
            {pickClockLocked(league?.draft_status ?? 'not_started') ? (
              <Text style={styles.stakeHelpText}>{`${pickSeconds} seconds per pick. The draft has started, so this is set.`}</Text>
            ) : (
              <>
                <SegmentedControl
                  options={PICK_SECONDS_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
                  value={String(pickSeconds)}
                  onChange={(v) => setPickSeconds(Number(v))}
                />
                <Text style={styles.stakeHelpText}>{pickSecondsCaption(pickSeconds)}</Text>
              </>
            )}
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

          {/* Stake Mode (Phase 4) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Stake Mode</Text>

            {stakeMode === '' && (
              <Text style={styles.stakeMissingBanner}>
                This league has no stake mode yet — drafting is blocked until you choose one.
              </Text>
            )}

            {STAKE_MODE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modeCard, styles.stakeModeCard, stakeMode === opt.value && styles.modeCardSelected, isLocked && styles.inputDisabled]}
                onPress={() => !isLocked && setStakeMode(opt.value)}
                disabled={isLocked}
              >
                <Ionicons
                  name={opt.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={stakeMode === opt.value ? ACCENT : Colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modeCardText, stakeMode === opt.value && styles.modeCardTextSelected]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.stakeHelpText}>{opt.help}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {stakeMode === 'fixed_notional' && (
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={[styles.budgetInput, isLocked && styles.inputDisabled]}
                  value={notionalPerSlot}
                  onChangeText={(text) => setNotionalPerSlot(text.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder={String(DEFAULT_NOTIONAL_PER_SLOT)}
                  placeholderTextColor={Colors.textDark}
                  editable={!isLocked}
                />
              </View>
            )}
            {stakeMode === 'budget_cap' && (
              <View style={styles.budgetInputContainer}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={[styles.budgetInput, isLocked && styles.inputDisabled]}
                  value={budgetCap}
                  onChangeText={(text) => setBudgetCap(text.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder={String(DEFAULT_BUDGET_CAP)}
                  placeholderTextColor={Colors.textDark}
                  editable={!isLocked}
                />
              </View>
            )}

            <View style={styles.undraftableRow}>
              <Text style={styles.undraftableLabel}>Allow non-draftable stocks (full universe)</Text>
              <Switch
                value={allowUndraftable}
                onValueChange={setAllowUndraftable}
                disabled={isLocked}
                trackColor={{ false: Colors.border, true: ACCENT }}
              />
            </View>
            <Text style={styles.stakeHelpText}>
              Off (default): only vetted draftable stocks. On: the entire universe, including penny stocks and micro-caps.
            </Text>
          </View>

          {/* Roster Slots (Phase 4) */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Roster Slots{stakeMode === 'price_tiers' ? ' (required — price brackets)' : ' (optional — category slots)'}
            </Text>
            <SlotBuilder
              slots={slots}
              onChange={setSlots}
              categories={categories}
              leagueSize={numParticipants}
              numRounds={numRounds}
              disabled={isLocked}
            />
          </View>

          {/* Number of Teams */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Number of Teams</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepperBtn, isLocked && styles.inputDisabled]}
                // bounds = DB CHECK leagues_num_participants_range (4-16)
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
            <Card style={styles.infoCardOuter}>
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
            </Card>
          </View>


          {LEAVE_LEAGUE_ON && (
            // No onPress until the leave flow ships: the row is placement only.
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={{ color: Colors.error, fontWeight: '600', fontSize: 17 }} accessibilityRole="button">
                Leave league
              </Text>
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Save Button */}
        {!isLocked && (
          <View style={styles.footer}>
            <Button
              title="Save Changes"
              onPress={handleSave}
              variant="success"
              loading={saving}
              style={styles.saveButton}
            />
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
    fontFamily: 'Inter_600SemiBold',
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
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_400Regular',
    color: Colors.warning,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 12,
  },

  // Text input
  textInput: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
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
    fontFamily: 'Inter_600SemiBold',
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
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    marginRight: 4,
  },
  budgetInput: {
    flex: 1,
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
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
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  stepperValueLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },

  // Info card
  infoCardOuter: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
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
    borderRadius: 30,
  },

  // New Season section
  // Phase 4 stake-mode UI
  stakeModeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    marginBottom: 8,
  },
  stakeHelpText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  stakeMissingBanner: {
    color: Colors.error,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    backgroundColor: Colors.errorBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    lineHeight: 18,
  },
  undraftableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },
  undraftableLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
});