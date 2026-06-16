import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform, Dimensions, KeyboardAvoidingView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { supabase } from '@/lib/supabase';
import { validateLeagueName } from '@/lib/contentModeration';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// App accent colors (matching existing color scheme)
const ACCENT = Colors.primary; // #3b82f6 - Blue
const ACCENT_BG = Colors.primaryBg; // rgba(59, 130, 246, 0.2)
const ACCENT_LIGHT = Colors.primaryLight; // #60a5fa

type Step = 'welcome' | 'name' | 'type' | 'size' | 'budget' | 'duration' | 'matchup' | 'draft';

interface WizardState {
  name: string;
  type: 'matchup' | 'duration';
  size: number;
  budgetMode: 'budget' | 'no-budget';
  budgetAmount: string;
  durationDays: number;
  numWeeks: number;
  playoffTeams: number;
  numRounds: number;
  draftDate: Date | null;
  draftDateTBD: boolean;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function CreateLeagueWizard() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refresh, setActiveLeagueId } = useLeagueContext();

  const [step, setStep] = useState<Step>('welcome');
  const [creating, setCreating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [state, setState] = useState<WizardState>({
    name: '',
    type: 'matchup',
    size: 8,
    budgetMode: 'budget',
    budgetAmount: '100000',
    durationDays: 30,
    numWeeks: 11,
    playoffTeams: 4,
    numRounds: 6,
    draftDate: null,
    draftDateTBD: true, // Default to TBD
  });

  const minWeeks = state.size - 1;
  const getPlayoffOptions = () => {
    const allOptions = [2, 4, 8];
    return allOptions.filter(o => o < state.size);
  };

  // Navigation helpers
  const goBack = () => {
    switch (step) {
      case 'welcome':
        router.dismiss();
        break;
      case 'name': setStep('welcome'); break;
      case 'type': setStep('name'); break;
      case 'size': setStep('type'); break;
      case 'budget': setStep('size'); break;
      case 'duration': setStep('budget'); break;
      case 'matchup': setStep('budget'); break;
      case 'draft': setStep(state.type === 'duration' ? 'duration' : 'matchup'); break;
    }
  };

  const handleClose = () => {
    router.dismiss();
  };

  const goNext = () => {
    switch (step) {
      case 'welcome': setStep('name'); break;
      case 'name':
        if (!state.name.trim()) {
          Alert.alert('Required', 'Please enter a league name');
          return;
        }
        const contentCheck = validateLeagueName(state.name.trim());
        if (!contentCheck.isValid) {
          Alert.alert('Error', contentCheck.reason || 'League name is not allowed');
          return;
        }
        setStep('type');
        break;
      case 'type': setStep('size'); break;
      case 'size': setStep('budget'); break;
      case 'budget':
        setStep(state.type === 'duration' ? 'duration' : 'matchup');
        break;
      case 'duration': setStep('draft'); break;
      case 'matchup': setStep('draft'); break;
      case 'draft': handleCreate(); break;
    }
  };

  const handleCreate = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'You must be logged in to create a league');
      return;
    }

    setCreating(true);
    try {
      const capDisabled = state.budgetMode === 'no-budget';
      const budget = capDisabled ? null : (parseInt(state.budgetAmount) || 100000);
      const effectiveWeeks = state.type === 'matchup' ? Math.max(state.numWeeks, minWeeks) : null;

      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .insert({
          name: state.name.trim(),
          commissioner_id: user.id,
          invite_code: generateInviteCode(),
          num_participants: state.size,
          num_rounds: state.numRounds,
          budget_mode: state.budgetMode,
          budget_amount: budget || 100000,
          salary_cap_limit: budget,
          league_type: state.type,
          duration_days: state.type === 'duration' ? state.durationDays : 30,
          num_weeks: effectiveWeeks,
          playoff_teams: state.type === 'matchup' ? state.playoffTeams : null,
          draft_status: 'not_started',
          draft_date: state.draftDateTBD ? null : state.draftDate?.toISOString(),
        })
        .select()
        .single();

      if (leagueError) throw leagueError;

      const { error: memberError } = await supabase
        .from('league_members')
        .insert({
          league_id: league.id,
          user_id: user.id,
          role: 'commissioner',
        });

      if (memberError) throw memberError;

      await refresh();
      setActiveLeagueId(league.id);

      const tbdMessage = state.draftDateTBD
        ? '\n\nRemember to set a draft date before starting the draft!'
        : '';

      Alert.alert(
        'League Created!',
        `"${state.name}" is ready!\n\nInvite Code: ${league.invite_code}${tbdMessage}`,
        [{ text: 'OK', onPress: () => router.replace('/(tabs)') }]
      );
    } catch (error: any) {
      console.error('Failed to create league:', error);
      Alert.alert('Error', error.message || 'Failed to create league');
    } finally {
      setCreating(false);
    }
  };

  // Render each step
  const renderWelcome = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.heroSection}>
        <Text style={styles.heroIcon}>📈</Text>
        <Text style={styles.heroTitle}>FANTASY</Text>
        <Text style={styles.heroTitleBold}>STOCK LEAGUE</Text>
        <Text style={styles.heroSubtitle}>Build your portfolio. Beat your friends.</Text>
      </View>

      <View style={styles.welcomeButtons}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => setStep('name')}
        >
          <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>Create League</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            router.dismiss();
            setTimeout(() => router.push('/join-league'), 100);
          }}
        >
          <Ionicons name="search-outline" size={20} color={ACCENT} />
          <Text style={styles.secondaryButtonText}>Join a League</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderName = () => (
    <KeyboardAvoidingView
      style={styles.stepContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.stepContent}>
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>League Name</Text>
          <TextInput
            style={styles.textInput}
            value={state.name}
            onChangeText={(text) => setState({ ...state, name: text })}
            placeholder="Give your league a name"
            placeholderTextColor={Colors.textDark}
            autoCapitalize="words"
            autoFocus
          />
          <View style={styles.inputUnderline} />
          <Text style={styles.inputHint}>Don't worry. You will be able to change this later.</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.nextButton, !state.name.trim() && styles.nextButtonDisabled]}
        onPress={goNext}
        disabled={!state.name.trim()}
      >
        <Text style={styles.nextButtonText}>Next</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );

  const renderType = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepContent}>
        <Text style={styles.stepSubtitle}>You can change it later in the settings</Text>

        <View style={styles.cardGrid}>
          <TouchableOpacity
            style={[styles.typeCard, state.type === 'matchup' && styles.typeCardSelected]}
            onPress={() => setState({ ...state, type: 'matchup' })}
          >
            {state.type === 'matchup' && <View style={styles.popularBadge}><Text style={styles.popularBadgeText}>Popular</Text></View>}
            <View style={styles.typeCardIcon}>
              <Ionicons name="people" size={32} color={state.type === 'matchup' ? ACCENT : Colors.textMuted} />
            </View>
            <Text style={[styles.typeCardTitle, state.type === 'matchup' && styles.typeCardTitleSelected]}>
              Matchup
            </Text>
            {state.type === 'matchup' && (
              <Text style={styles.typeCardDesc}>Weekly head-to-head battles with playoffs at the end.</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.typeCard, state.type === 'duration' && styles.typeCardSelected]}
            onPress={() => setState({ ...state, type: 'duration' })}
          >
            {state.type === 'duration' && <View style={styles.popularBadge}><Text style={styles.popularBadgeText}>Simple</Text></View>}
            <View style={styles.typeCardIcon}>
              <Ionicons name="trending-up" size={32} color={state.type === 'duration' ? ACCENT : Colors.textMuted} />
            </View>
            <Text style={[styles.typeCardTitle, state.type === 'duration' && styles.typeCardTitleSelected]}>
              Duration
            </Text>
            {state.type === 'duration' && (
              <Text style={styles.typeCardDesc}>Best portfolio gains at the end wins it all.</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.nextButton} onPress={goNext}>
        <Text style={styles.nextButtonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSize = () => {
    const sizes = state.type === 'matchup'
      ? [4, 6, 8, 10, 12, 14, 16]  // Even numbers for matchups
      : [2, 4, 6, 8, 10, 12, 14, 16];

    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepContent}>
          <Text style={styles.stepSubtitle}>You can change it later in the settings</Text>

          <View style={styles.sizeGrid}>
            {sizes.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.sizeButton, state.size === size && styles.sizeButtonSelected]}
                onPress={() => setState({ ...state, size })}
              >
                <Text style={[styles.sizeButtonText, state.size === size && styles.sizeButtonTextSelected]}>
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.nextButton} onPress={goNext}>
          <Text style={styles.nextButtonText}>Next</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderBudget = () => (
    <KeyboardAvoidingView
      style={styles.stepContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.stepSubtitle}>How much can each team spend?</Text>

        <View style={styles.cardRow}>
          <TouchableOpacity
            style={[styles.budgetCard, state.budgetMode === 'budget' && styles.budgetCardSelected]}
            onPress={() => setState({ ...state, budgetMode: 'budget' })}
          >
            <Ionicons name="wallet" size={28} color={state.budgetMode === 'budget' ? ACCENT : Colors.textMuted} />
            <Text style={[styles.budgetCardTitle, state.budgetMode === 'budget' && styles.budgetCardTitleSelected]}>
              Salary Cap
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.budgetCard, state.budgetMode === 'no-budget' && styles.budgetCardSelected]}
            onPress={() => setState({ ...state, budgetMode: 'no-budget' })}
          >
            <Ionicons name="infinite" size={28} color={state.budgetMode === 'no-budget' ? ACCENT : Colors.textMuted} />
            <Text style={[styles.budgetCardTitle, state.budgetMode === 'no-budget' && styles.budgetCardTitleSelected]}>
              No Limit
            </Text>
          </TouchableOpacity>
        </View>

        {state.budgetMode === 'budget' && (
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>Budget Amount</Text>
            <View style={styles.amountInputContainer}>
              <Text style={styles.currencySymbol}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={state.budgetAmount}
                onChangeText={(text) => setState({ ...state, budgetAmount: text.replace(/[^0-9]/g, '') })}
                keyboardType="numeric"
                placeholder="100000"
                placeholderTextColor={Colors.textDark}
              />
            </View>

            <View style={styles.presetRow}>
              {['50000', '100000', '250000', '500000'].map((amount) => (
                <TouchableOpacity
                  key={amount}
                  style={[styles.presetButton, state.budgetAmount === amount && styles.presetButtonSelected]}
                  onPress={() => setState({ ...state, budgetAmount: amount })}
                >
                  <Text style={[styles.presetButtonText, state.budgetAmount === amount && styles.presetButtonTextSelected]}>
                    ${parseInt(amount).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.nextButton} onPress={goNext}>
        <Text style={styles.nextButtonText}>Next</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );

  const renderDuration = () => {
    const durations = [
      { value: 7, label: '1 Week', desc: 'Quick game' },
      { value: 30, label: '1 Month', desc: 'Standard' },
      { value: 90, label: '3 Months', desc: 'Quarter' },
      { value: 180, label: '6 Months', desc: 'Half year' },
      { value: 365, label: '1 Year', desc: 'Full season' },
    ];

    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepContent}>
          <Text style={styles.stepSubtitle}>How long will your league run?</Text>

          <View style={styles.durationList}>
            {durations.map((d) => (
              <TouchableOpacity
                key={d.value}
                style={[styles.durationItem, state.durationDays === d.value && styles.durationItemSelected]}
                onPress={() => setState({ ...state, durationDays: d.value })}
              >
                <View>
                  <Text style={[styles.durationLabel, state.durationDays === d.value && styles.durationLabelSelected]}>
                    {d.label}
                  </Text>
                  <Text style={styles.durationDesc}>{d.desc}</Text>
                </View>
                {state.durationDays === d.value && (
                  <Ionicons name="checkmark-circle" size={24} color={ACCENT} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.nextButton} onPress={goNext}>
          <Text style={styles.nextButtonText}>Next</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderMatchup = () => {
    const playoffOptions = getPlayoffOptions();

    return (
      <View style={styles.stepContainer}>
        <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.stepSubtitle}>Configure your matchup league</Text>

          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>Regular Season Length</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setState({ ...state, numWeeks: Math.max(minWeeks, state.numWeeks - 1) })}
              >
                <Ionicons name="remove" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{state.numWeeks}</Text>
                <Text style={styles.stepperValueLabel}>weeks</Text>
              </View>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => setState({ ...state, numWeeks: state.numWeeks + 1 })}
              >
                <Ionicons name="add" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.settingHint}>Min {minWeeks} weeks for round robin</Text>
          </View>

          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>Playoff Teams</Text>
            <View style={styles.playoffGrid}>
              {playoffOptions.map((num) => (
                <TouchableOpacity
                  key={num}
                  style={[styles.playoffButton, state.playoffTeams === num && styles.playoffButtonSelected]}
                  onPress={() => setState({ ...state, playoffTeams: num })}
                >
                  <Text style={[styles.playoffButtonText, state.playoffTeams === num && styles.playoffButtonTextSelected]}>
                    {num} teams
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        <TouchableOpacity style={styles.nextButton} onPress={goNext}>
          <Text style={styles.nextButtonText}>Next</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderDraft = () => (
    <View style={styles.stepContainer}>
      <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.stepSubtitle}>Final step - set up your draft</Text>

        <View style={styles.settingSection}>
          <Text style={styles.settingLabel}>Stocks Per Team</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setState({ ...state, numRounds: Math.max(3, state.numRounds - 1) })}
            >
              <Ionicons name="remove" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.stepperValue}>
              <Text style={styles.stepperValueText}>{state.numRounds}</Text>
              <Text style={styles.stepperValueLabel}>stocks</Text>
            </View>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setState({ ...state, numRounds: Math.min(12, state.numRounds + 1) })}
            >
              <Ionicons name="add" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.settingSection}>
          <Text style={styles.settingLabel}>Draft Date & Time</Text>

          {/* TBD Option */}
          <TouchableOpacity
            style={[styles.tbdOption, state.draftDateTBD && styles.tbdOptionSelected]}
            onPress={() => setState({ ...state, draftDateTBD: true, draftDate: null })}
          >
            <View style={styles.tbdRadio}>
              {state.draftDateTBD && <View style={styles.tbdRadioInner} />}
            </View>
            <Text style={[styles.tbdText, state.draftDateTBD && styles.tbdTextSelected]}>
              TBD - Set later
            </Text>
          </TouchableOpacity>

          {/* Pick a date option */}
          <TouchableOpacity
            style={[styles.tbdOption, !state.draftDateTBD && styles.tbdOptionSelected]}
            onPress={() => {
              setState({ ...state, draftDateTBD: false });
              setShowDatePicker(true);
            }}
          >
            <View style={styles.tbdRadio}>
              {!state.draftDateTBD && <View style={styles.tbdRadioInner} />}
            </View>
            <Ionicons name="calendar" size={18} color={!state.draftDateTBD ? ACCENT : Colors.textMuted} />
            <Text style={[styles.tbdText, !state.draftDateTBD && styles.tbdTextSelected]}>
              {state.draftDate
                ? state.draftDate.toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Pick a date & time'}
            </Text>
          </TouchableOpacity>

          {showDatePicker && !state.draftDateTBD && (
            <>
              <DateTimePicker
                value={state.draftDate || new Date()}
                mode="datetime"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant="light"
                onChange={(event, selectedDate) => {
                  if (Platform.OS !== 'ios') setShowDatePicker(false);
                  if (selectedDate) setState({ ...state, draftDate: selectedDate, draftDateTBD: false });
                }}
                minimumDate={new Date()}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.datePickerDone}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.datePickerDoneText}>Done</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {state.draftDateTBD && (
            <Text style={styles.tbdWarning}>
              You'll need to set a draft date before starting the draft
            </Text>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>League Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Name</Text>
            <Text style={styles.summaryValue}>{state.name}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Type</Text>
            <Text style={styles.summaryValue}>{state.type === 'matchup' ? 'Matchup' : 'Duration'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Teams</Text>
            <Text style={styles.summaryValue}>{state.size}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Budget</Text>
            <Text style={styles.summaryValue}>
              {state.budgetMode === 'budget' ? `$${parseInt(state.budgetAmount).toLocaleString()}` : 'No limit'}
            </Text>
          </View>
          <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.summaryLabel}>Draft</Text>
            <Text style={[styles.summaryValue, state.draftDateTBD && { color: Colors.warning }]}>
              {state.draftDateTBD ? 'TBD' : state.draftDate?.toLocaleDateString() || 'TBD'}
            </Text>
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.nextButton, styles.doneButton, creating && styles.nextButtonDisabled]}
        onPress={goNext}
        disabled={creating}
      >
        {creating ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.nextButtonText}>Create League</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderStep = () => {
    switch (step) {
      case 'welcome': return renderWelcome();
      case 'name': return renderName();
      case 'type': return renderType();
      case 'size': return renderSize();
      case 'budget': return renderBudget();
      case 'duration': return renderDuration();
      case 'matchup': return renderMatchup();
      case 'draft': return renderDraft();
      default: return null;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header - shown on all screens */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={step === 'welcome' ? handleClose : goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={Colors.textMuted} />
        </TouchableOpacity>
        {step !== 'welcome' && (
          <Text style={styles.headerTitle}>
            {step === 'name' && 'Name your league'}
            {step === 'type' && 'League Type'}
            {step === 'size' && 'League Size'}
            {step === 'budget' && 'Budget'}
            {step === 'duration' && 'Duration'}
            {step === 'matchup' && 'Season Settings'}
            {step === 'draft' && 'Draft Settings'}
          </Text>
        )}
        <View style={styles.headerSpacer} />
      </View>

      {renderStep()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 52,
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

  // Welcome screen
  welcomeContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  heroIcon: {
    fontSize: 80,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '400',
    color: Colors.textPrimary,
    letterSpacing: 2,
  },
  heroTitleBold: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 1,
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  welcomeButtons: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 16,
    borderRadius: 30,
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: ACCENT,
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.5,
  },

  // Step container
  stepContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  stepSubtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    marginBottom: 24,
  },

  // Text input (name step)
  inputContainer: {
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
    marginBottom: 8,
  },
  textInput: {
    fontSize: 18,
    color: Colors.textPrimary,
    paddingVertical: 12,
  },
  inputUnderline: {
    height: 2,
    backgroundColor: ACCENT,
    marginBottom: 12,
  },
  inputHint: {
    fontSize: 13,
    color: Colors.textMuted,
  },

  // Type cards
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  typeCardSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  typeCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  typeCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  typeCardTitleSelected: {
    color: ACCENT,
  },
  typeCardDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    left: -1,
    backgroundColor: ACCENT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopLeftRadius: 14,
    borderBottomRightRadius: 8,
  },
  popularBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // Size grid
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  sizeButton: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  sizeButtonSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  sizeButtonText: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sizeButtonTextSelected: {
    color: ACCENT,
  },

  // Budget
  cardRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  budgetCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 8,
  },
  budgetCardSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  budgetCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  budgetCardTitleSelected: {
    color: ACCENT,
  },
  amountSection: {
    marginTop: 8,
  },
  amountLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
    marginBottom: 12,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  currencySymbol: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.textMuted,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: Colors.textPrimary,
    paddingVertical: 16,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  presetButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  presetButtonSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  presetButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  presetButtonTextSelected: {
    color: ACCENT,
  },

  // Duration list
  durationList: {
    gap: 12,
  },
  durationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  durationItemSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  durationLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  durationLabelSelected: {
    color: ACCENT,
  },
  durationDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Settings (matchup/draft)
  settingSection: {
    marginBottom: 28,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  settingHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
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
  playoffGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  playoffButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  playoffButtonSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  playoffButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  playoffButtonTextSelected: {
    color: ACCENT,
  },

  // Date picker
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateButtonText: {
    fontSize: 16,
    color: Colors.textPrimary,
  },
  dateButtonPlaceholder: {
    fontSize: 16,
    color: Colors.textDark,
  },
  datePickerDone: {
    alignItems: 'flex-end',
    paddingVertical: 8,
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT,
  },

  // Summary
  summaryCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },

  // Next button
  nextButton: {
    backgroundColor: ACCENT,
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: Colors.border,
  },
  nextButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  doneButton: {
    backgroundColor: Colors.success,
  },

  // TBD options
  tbdOption: {
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
  tbdOptionSelected: {
    backgroundColor: ACCENT_BG,
    borderColor: ACCENT,
  },
  tbdRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tbdRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  tbdText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textMuted,
  },
  tbdTextSelected: {
    color: Colors.textPrimary,
  },
  tbdWarning: {
    fontSize: 13,
    color: Colors.warning,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
