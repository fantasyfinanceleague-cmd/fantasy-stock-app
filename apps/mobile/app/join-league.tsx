import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { supabase } from '@/lib/supabase';

const ACCENT = Colors.primary;
const ACCENT_BG = Colors.primaryBg;

type Step = 'code' | 'preview';

interface LeaguePreview {
  name: string;
  league_type: 'matchup' | 'duration';
  num_participants: number;
  current_members: number;
  budget_amount: number | null;
  budget_mode: string;
  draft_date: string | null;
  draft_status: string;
  duration_days: number | null;
  num_weeks: number | null;
  commissioner_name: string;
}

const REASON_MSG: Record<string, string> = {
  already_member:   'You are already a member of this league',
  league_full:      'This league is full',
  invite_expired:   'This invite has already been used or expired',
  season_completed: "This league's season has ended",
  invalid_code:     'Invalid invite code. Please check and try again.',
};

export default function JoinLeagueScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refresh, setActiveLeagueId } = useLeagueContext();

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [league, setLeague] = useState<LeaguePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    router.dismiss();
  };

  const goBack = () => {
    if (step === 'preview') {
      setStep('code');
      setLeague(null);
      setError(null);
    } else {
      handleClose();
    }
  };

  const lookupCode = async () => {
    if (!code.trim()) {
      setError('Please enter an invite code');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'You must be logged in to join a league');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Server-side by-code lookup (RLS-bypassing, rate-limited) — leagues/
      // league_members/league_invites stay members-only to the client.
      const { data, error: fnErr } = await supabase.functions.invoke('preview-league', {
        body: { code: code.trim() },
      });

      if (fnErr) { setError('Something went wrong. Please try again.'); return; }
      if (!data.found) { setError(REASON_MSG.invalid_code); return; }
      // Hard reasons (full / already-member / expired / season over) block at the
      // lookup step with an inline error — matches current UX (no preview card).
      // Draft-started stays SOFT: joinable=true, the preview shows the warning.
      if (!data.joinable) { setError(REASON_MSG[data.reason] ?? 'You cannot join this league'); return; }

      setLeague(data.league);
      setStep('preview');
    } catch (err: any) {
      console.error('Error looking up code:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!league || !user?.id) return;

    setJoining(true);

    try {
      // Entire join runs server-side & atomically (join_league_by_code): row-locked
      // capacity check, re-validation, member insert, invite accept — all via the
      // secret key, so league_members/league_invites are never client-written.
      const { data, error: fnErr } = await supabase.functions.invoke('join-league', {
        body: { code: code.trim() },
      });

      if (fnErr) { Alert.alert('Error', 'Failed to join league'); return; }
      if (!data.ok) {
        if (data.reason === 'already_member') Alert.alert('Already Joined', 'You are already a member of this league');
        else Alert.alert('Cannot join', REASON_MSG[data.reason] ?? 'Unable to join this league');
        return;
      }

      // Refresh leagues and set active (id comes from the join response — member now)
      await refresh();
      setActiveLeagueId(data.league.id);

      Alert.alert(
        'Welcome!',
        `You've joined "${data.league.name}"!`,
        [{ text: 'OK', onPress: () => router.replace('/(tabs)') }]
      );
    } catch (err: any) {
      console.error('Error joining league:', err);
      Alert.alert('Error', err.message || 'Failed to join league');
    } finally {
      setJoining(false);
    }
  };

  const formatDraftDate = (dateStr: string | null) => {
    if (!dateStr) return 'TBD';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const renderCodeInput = () => (
    <KeyboardAvoidingView
      style={styles.stepContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.stepContent}>
        <View style={styles.iconContainer}>
          <Ionicons name="ticket-outline" size={64} color={ACCENT} />
        </View>

        <Text style={styles.title}>Enter Invite Code</Text>
        <Text style={styles.subtitle}>
          Ask your league commissioner for the 6-character invite code
        </Text>

        <View style={styles.codeInputContainer}>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(text) => {
              setCode(text.toUpperCase());
              setError(null);
            }}
            placeholder="ABC123"
            placeholderTextColor={Colors.textDark}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            autoFocus
          />
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.nextButton, (!code.trim() || loading) && styles.nextButtonDisabled]}
        onPress={lookupCode}
        disabled={!code.trim() || loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.nextButtonText}>Look Up</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );

  const renderPreview = () => {
    if (!league) return null;

    const draftStarted = league.draft_status !== 'not_started';

    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepContent}>
          <View style={styles.previewHeader}>
            <View style={styles.leagueIconLarge}>
              <Text style={styles.leagueIconText}>
                {league.league_type === 'matchup' ? '🤑' : '📈'}
              </Text>
            </View>
            <Text style={styles.leagueName}>{league.name}</Text>
            <Text style={styles.commissionerText}>
              Hosted by {league.commissioner_name}
            </Text>
          </View>

          <View style={styles.previewCard}>
            <View style={styles.previewRow}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Type</Text>
                <Text style={styles.previewValue}>
                  {league.league_type === 'matchup' ? 'Matchup' : 'Duration'}
                </Text>
              </View>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Members</Text>
                <Text style={styles.previewValue}>
                  {league.current_members}/{league.num_participants}
                </Text>
              </View>
            </View>

            <View style={styles.previewRow}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Budget</Text>
                <Text style={styles.previewValue}>
                  {league.budget_mode === 'no-budget'
                    ? 'No Limit'
                    : `$${(league.budget_amount || 0).toLocaleString()}`}
                </Text>
              </View>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>
                  {league.league_type === 'duration' ? 'Duration' : 'Season'}
                </Text>
                <Text style={styles.previewValue}>
                  {league.league_type === 'duration'
                    ? `${league.duration_days} days`
                    : `${league.num_weeks} weeks`}
                </Text>
              </View>
            </View>

            <View style={[styles.previewRow, styles.previewRowLast]}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Draft</Text>
                <Text style={[
                  styles.previewValue,
                  !league.draft_date && styles.previewValueMuted
                ]}>
                  {formatDraftDate(league.draft_date)}
                </Text>
              </View>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Status</Text>
                <View style={[
                  styles.statusBadge,
                  draftStarted ? styles.statusBadgeActive : styles.statusBadgePending
                ]}>
                  <Text style={styles.statusBadgeText}>
                    {draftStarted ? 'In Progress' : 'Draft Pending'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {draftStarted && (
            <View style={styles.warningContainer}>
              <Ionicons name="information-circle" size={18} color={Colors.warning} />
              <Text style={styles.warningText}>
                The draft has already started. You may need to wait for the next season.
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, styles.joinButton, joining && styles.nextButtonDisabled]}
          onPress={handleJoin}
          disabled={joining}
        >
          {joining ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="enter-outline" size={20} color="#FFFFFF" />
              <Text style={styles.nextButtonText}>Join League</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={goBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={Colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {step === 'code' ? 'Join League' : 'League Preview'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {step === 'code' ? renderCodeInput() : renderPreview()}
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

  // Step container
  stepContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },

  // Code input screen
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  codeInputContainer: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 8,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  codeInput: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    paddingVertical: 16,
    letterSpacing: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 6,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
  },

  // Preview screen
  previewHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  leagueIconLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: ACCENT_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  leagueIconText: {
    fontSize: 40,
  },
  leagueName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  commissionerText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  previewCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
  },
  previewRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  previewRowLast: {
    borderBottomWidth: 0,
  },
  previewItem: {
    flex: 1,
  },
  previewLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  previewValue: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  previewValueMuted: {
    color: Colors.warning,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgePending: {
    backgroundColor: Colors.warning + '30',
  },
  statusBadgeActive: {
    backgroundColor: Colors.success + '30',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.warning + '20',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: Colors.warning,
    lineHeight: 18,
  },

  // Buttons
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 30,
    gap: 8,
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
  joinButton: {
    backgroundColor: Colors.success,
  },
});
