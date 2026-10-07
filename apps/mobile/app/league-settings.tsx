/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
// League settings (3c-2). No frame of its own: the board says the Create
// league Draft and Season controls "appear in League settings until the draft
// starts", so this is composed from those steps plus the Season 2 review's
// card-of-rows vocabulary (RibReview). handleSave, the save-outcome rules
// (lib/game/settingsSave) and the seam writes are unchanged.
import { Alert, Share, StyleSheet, View } from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
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
import {
  COMMISSIONER_ROW, COMMISSIONER_YOU, leaveLeagueEnabled, leaveRowView, leaveSheetCopy, leaveWindow, transferAllowed, transferCandidates,
  transferUnknownLine,
} from '@/lib/game/leaveLeague';
import { useLeaveLeague } from '@/lib/game/useLeaveLeague';
import { COMMISSIONER_FALLBACK } from '@/lib/game/autoStart';
import { LeaveLeagueRow, LeaveLeagueSheet, TransferCommissionerSheet } from '@/components/game/LeaveLeagueSheets';
import { DEFAULT_PICK_SECONDS, PICK_SECONDS_OPTIONS, pickClockLocked, pickSecondsCaption } from '@/lib/game/createLeagueSetup';
import { leagueNameError, stepWithin } from '@/lib/game/createLeagueSteps';
import { PRICE_TIERS_NEED_A_SLOT, rosterSlotsCaption } from '@/lib/game/slotBuilderCopy';
import { SETTINGS_LOCKED } from '@/lib/game/leagueSettingsEntry';
import { draftDateTimeLabel } from '@/lib/home/draftCountdown';
import { draftDateForSave, updatedOneRow } from '@/lib/game/draftDateSave';
import { DATE_LOCKED_AFTER_ROOM, draftTimeLocked, draftTimeRefusal } from '@/lib/game/autoStart';
import { useDraftStatus } from '@/lib/game/useDraftStatus';
import { space, typeFontFamily } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Field } from '@/components/shell/Field';
import { SetupScaffold } from '@/components/game/SetupScaffold';
import { Stepper } from '@/components/game/Stepper';
import { DraftDateSheet } from '@/components/game/DraftDateSheet';
import { ChoiceRow, LockNote, RowDivider, SettingRow, SetupCard, SwitchRow, WarnNote } from '@/components/game/SetupRows';

/** The leave flow's kill switch (item 13; board #call-leave). On: members reach League settings too (Invite
 * code, Commissioner, Leave league), the commissioner gets the Commissioner row's transfer, and the Leave row
 * is real. Off: exactly the commissioner-only screen as before. */
const LEAVE_LEAGUE_ON = leaveLeagueEnabled(process.env.EXPO_PUBLIC_LEAVE_LEAGUE);

export default function LeagueSettingsScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { leagues, refresh, homeSummaryByLeague } = useLeagueContext();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();

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
  // Validation is inline (Design Lead ruling), never an Alert: the name under
  // its field, price tiers with no slot under Roster slots, slot errors on the slots.
  const [nameError, setNameError] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

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

  // Auto-start: the draft time can't change once the room opens (T−1h), until
  // the draft starts, except when postponed. From the server's start_state.
  const draftStatus = useDraftStatus(league?.id ?? null, !!league && isCommissioner && !isLocked, 0);
  const dateLocked = !isLocked && draftTimeLocked(draftStatus.startState);

  // Leaving and the commissioner's transfer (item 13). The server decides; the
  // window here only shapes the row and the sheet.
  const leaveOn = LEAVE_LEAGUE_ON && !!league;
  const leaving = useLeaveLeague(league?.id ?? null, leaveOn, user?.id ?? '', league?.name ?? '');
  const membershipWindow = leaveWindow({ seasonStatus: league?.season_status, draftStatus: league?.draft_status, draftDate: league?.draft_date }, Date.now());
  const commissionerName = leaving.names.find((n) => n.user_id === league?.commissioner_id)?.display_name?.trim() || COMMISSIONER_FALLBACK;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const onLeave = async () => {
    const out = await leaving.leave();
    if (out.kind === 'left' || out.kind === 'hidden') {
      setLeaveOpen(false);
      await refresh();
      // The league is gone from your leagues (left) or hidden: Home, with the next league.
      router.replace('/(tabs)');
      return;
    }
    // A leave's unknown outcome was re-read (useLeaveLeague), so here it is left, hidden or a line.
    setLeaveError(out.kind === 'refused' ? out.line : null);
  };
  const onTransfer = async (userId: string) => {
    const out = await leaving.transfer(userId);
    if (out.kind === 'transferred') {
      setTransferOpen(false);
      await refresh(); // you're a member now: the screen re-renders as a member's, Leave league open
      return;
    }
    setLeaveError(out.kind === 'refused' ? out.line : out.kind === 'unknown' ? transferUnknownLine() : null);
    if (out.kind === 'unknown') void refresh(); // the title moved or it didn't: the screen shows which
  };
  const leaveBlock = leaveOn && league ? (
    <>
      <LeaveLeagueRow
        view={leaveRowView(membershipWindow, isCommissioner, league.draft_date)}
        onPress={() => {
          setLeaveError(null);
          setLeaveOpen(true);
        }}
      />
      <LeaveLeagueSheet
        visible={leaveOpen}
        copy={leaveSheetCopy(membershipWindow, { leagueName: league.name, commissionerName, seasonNumber: homeSummaryByLeague.get(league.id)?.season_number ?? null, draftDate: league.draft_date })}
        busy={leaving.busy}
        error={leaveError}
        onLeave={() => void onLeave()}
        onStay={() => setLeaveOpen(false)}
      />
    </>
  ) : null;
  // The commissioner's view only: a member's screen has no commissioner controls at all.
  const transferSheet = leaveOn && league && isCommissioner ? (
    <>
      <TransferCommissionerSheet
        visible={transferOpen}
        candidates={transferCandidates(leaving.memberIds, leaving.names, user?.id ?? '')}
        busy={leaving.busy}
        error={leaveError}
        onTransfer={(id) => void onTransfer(id)}
        onClose={() => setTransferOpen(false)}
      />
    </>
  ) : null;

  const handleSave = async () => {
    if (!league || !user?.id) return;

    // Validate name (inline: blank, then moderation on the trimmed name)
    const trimmedName = name.trim();
    const nameProblem = leagueNameError(name, validateLeagueName);
    setNameError(nameProblem);
    if (nameProblem) return;

    // Never send draft_date: undefined (a live 1.1.0 bug: the screen said
    // Success while the date stayed NULL). Set later is null; a chosen date must have a value.
    const draftDateValue = draftDateForSave(draftDateTBD, draftDate);
    setDateError(draftDateValue.ok ? null : draftDateValue.error);
    if (!draftDateValue.ok) return;

    setSaving(true);

    try {
      if (stakeMode === 'price_tiers' && slots.length === 0) {
        setSlotsError(PRICE_TIERS_NEED_A_SLOT);
        setSaving(false);
        return;
      }
      setSlotsError(null);
      // Slot errors already show on the slots themselves (SlotBuilder).
      const slotErrors = validateSlotConfig(slots, numRounds);
      if (slotErrors.length > 0) {
        setSaving(false);
        return;
      }

      // stake_mode written only when chosen — '' (legacy NULL league) leaves
      // the column untouched rather than writing a default the commissioner
      // didn't pick. budget_mode / salary_cap_limit: retired, never written.
      const patch: Record<string, unknown> = {
        name: trimmedName,
        draft_date: draftDateValue.value,
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
      const res = await seamUpdateLeague(league.id, patch);
      if (res.error) {
        // A draft-time refusal (not a quarter hour, under an hour out, or the room
        // is open) shows inline under the date, never as a raw error.
        const refusal = draftTimeRefusal(res.error);
        if (refusal) {
          setDateError(refusal);
          return;
        }
        const outcome = settingsSaveOutcome({ patchError: res.error, slotsError: null });
        Alert.alert(outcome.title ?? 'Not saved', outcome.message ?? '');
        return;
      }
      // An update that matched no row (RLS, a stale league) resolves with no
      // error: that is "Not saved", never a success (CLAUDE.md, false success).
      if (!updatedOneRow(res)) {
        Alert.alert('Not saved', "Your settings didn't save. Try again.");
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

  // A member (leave flow on), Design Lead ruling: ONLY Invite code (with Share), the
  // Commissioner's name (read-only) and Leave league. No commissioner controls, not
  // even disabled ones.
  if (league && !isCommissioner && leaveOn) {
    const code = league.invite_code;
    return (
      <SetupScaffold back={{ label: 'Cancel', onPress: handleClose }} title="League settings">
        <SetupCard>
          <View style={styles.inviteRow}>
            <View style={styles.grow}>
              <Text variant="callout" style={styles.key}>Invite code</Text>
              <Text variant="callout" color={colors.accent} style={styles.bold}>{code}</Text>
            </View>
            <Button label="Share" variant="secondary" size="sm" onPress={() => void Share.share({ message: `Join my league with code ${code}` })} />
          </View>
          <RowDivider />
          <SettingRow label={COMMISSIONER_ROW} value={commissionerName} />
        </SetupCard>
        {leaveBlock}
      </SetupScaffold>
    );
  }

  if (!league || !isCommissioner) {
    return (
      <SetupScaffold back={{ label: 'Cancel', onPress: handleClose }} title="League settings">
        <View style={styles.center}>
          {league ? <Icon name="lock" size="title" tone="text2" /> : null}
          <Text variant="body" tone="secondary" style={styles.centerText}>
            {league ? 'Only the commissioner can edit settings' : 'League not found'}
          </Text>
        </View>
      </SetupScaffold>
    );
  }

  const clockLocked = pickClockLocked(league?.draft_status ?? 'not_started');
  const draftDateValue = draftDateTBD
    ? 'TBD'
    : draftDate
      ? draftDateTimeLabel(draftDate.toISOString()) ?? 'Pick a draft time'
      : 'Pick a draft time';

  return (
    <SetupScaffold
      back={{ label: 'Cancel', onPress: handleClose }}
      title="League settings"
      footer={!isLocked ? <Button label="Save changes" onPress={handleSave} status={saving ? 'loading' : 'idle'} /> : undefined}
    >
      {isLocked ? <LockNote text={SETTINGS_LOCKED} /> : null}

      {/* sp Field has no disabled look of its own; dim it while locked, as before. */}
      <View style={isLocked && styles.dim}>
        <Field
          label="League name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError) setNameError(null);
          }}
          error={nameError}
          placeholder="League name"
          editable={!isLocked}
        />
      </View>

      {/* Draft: the Create league Draft step's controls (board). */}
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">Draft</Text>
        <SetupCard style={styles.cardStack}>
          <View style={styles.spread}>
            <Text variant="callout" style={styles.key}>Pick clock</Text>
            <Text variant="callout" style={[styles.bold, styles.tabular]}>{`${pickSeconds} seconds`}</Text>
          </View>
          {/* Frozen once the draft starts (trg_leagues_pick_clock). */}
          {clockLocked ? (
            <Text variant="caption" tone="secondary">{`${pickSeconds} seconds per pick. The draft has started, so this is set.`}</Text>
          ) : (
            <>
              <SegmentedControl
                options={PICK_SECONDS_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
                value={String(pickSeconds)}
                onChange={(v) => setPickSeconds(Number(v))}
              />
              <Text variant="caption" tone="secondary">{pickSecondsCaption(pickSeconds)}</Text>
            </>
          )}
        </SetupCard>
        <SetupCard>
          <SettingRow
            label="Draft time"
            value={draftDateValue}
            valueColor={draftDateTBD ? colors.warnText : undefined}
            sub={dateLocked ? DATE_LOCKED_AFTER_ROOM : undefined}
            disabled={isLocked || dateLocked}
            onPress={isLocked || dateLocked ? undefined : () => {
              // Opening writes nothing: the sheet holds the time until "Set draft time" (ruling B).
              setDateError(null);
              setShowDatePicker(true);
            }}
          />
          <RowDivider />
          <View style={styles.block}>
            <Stepper
              label="Rounds"
              sub="One per roster slot"
              value={numRounds}
              onStep={(d) => setNumRounds(stepWithin(numRounds, d, 1, 12))}
              canDecrement={numRounds > 1}
              canIncrement={numRounds < 12}
              disabled={isLocked}
            />
          </View>
        </SetupCard>
      </View>

      {dateError ? (
        <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">
          {dateError}
        </Text>
      ) : null}

      {/* Teams: bounds = DB CHECK leagues_num_participants_range (4-16). */}
      <SetupCard style={styles.cardStack}>
        <Stepper
          label="Teams"
          value={numParticipants}
          onStep={(d) => setNumParticipants(stepWithin(numParticipants, d, 4, 16))}
          canDecrement={numParticipants > 4}
          canIncrement={numParticipants < 16}
          disabled={isLocked}
        />
      </SetupCard>

      {/* Stakes (Phase 4). */}
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">Stakes</Text>
        {stakeMode === '' ? (
          <WarnNote alert title="This league has no stake mode yet — drafting is blocked until you choose one." />
        ) : null}
        <SetupCard>
          {STAKE_MODE_OPTIONS.map((opt, i) => (
            <View key={opt.value}>
              {i > 0 ? <RowDivider /> : null}
              <ChoiceRow
                title={opt.label}
                help={opt.help}
                selected={stakeMode === opt.value}
                onPress={() => {
                  if (isLocked) return;
                  setStakeMode(opt.value);
                  setSlotsError(null);
                }}
                disabled={isLocked}
              />
            </View>
          ))}
        </SetupCard>
        {stakeMode === 'fixed_notional' ? (
          <View style={isLocked && styles.dim}>
            <Field
              label="Stake per slot ($)"
              value={notionalPerSlot}
              onChangeText={(text) => setNotionalPerSlot(text.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder={String(DEFAULT_NOTIONAL_PER_SLOT)}
              editable={!isLocked}
            />
          </View>
        ) : null}
        {stakeMode === 'budget_cap' ? (
          <View style={isLocked && styles.dim}>
            <Field
              label="Budget cap ($)"
              value={budgetCap}
              onChangeText={(text) => setBudgetCap(text.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder={String(DEFAULT_BUDGET_CAP)}
              editable={!isLocked}
            />
          </View>
        ) : null}
        <SetupCard>
          <SwitchRow
            label="Allow non-draftable stocks (full universe)"
            sub="Off (default): only vetted draftable stocks. On: the entire universe, including penny stocks and micro-caps."
            value={allowUndraftable}
            onValueChange={setAllowUndraftable}
            disabled={isLocked}
          />
        </SetupCard>
      </View>

      {/* Roster slots (Phase 4). */}
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">Roster slots</Text>
        <Text variant="caption" tone="secondary">
          {rosterSlotsCaption(stakeMode)}
        </Text>
        {slotsError ? (
          <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">
            {slotsError}
          </Text>
        ) : null}
        <SlotBuilder
          slots={slots}
          onChange={(next) => {
            setSlots(next);
            setSlotsError(null);
          }}
          categories={categories}
          leagueSize={numParticipants}
          numRounds={numRounds}
          disabled={isLocked}
        />
      </View>

      {/* League info (read-only). */}
      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">League info</Text>
        <SetupCard>
          <SettingRow label="Type" value={league.league_type === 'matchup' ? 'Matchup' : 'Duration'} />
          <RowDivider />
          <SettingRow
            label={league.league_type === 'matchup' ? 'Season' : 'Duration'}
            value={league.league_type === 'matchup' ? `${league.num_weeks} weeks` : `${league.duration_days} days`}
          />
          {league.league_type === 'matchup' ? (
            <>
              <RowDivider />
              <SettingRow label="Playoff teams" value={String(league.playoff_teams)} />
            </>
          ) : null}
          <RowDivider />
          <SettingRow label="Invite code" value={league.invite_code} valueColor={colors.accent} />
          {leaveOn ? (
            <>
              <RowDivider />
              {/* Q4 = A: transfer first, from the Commissioner row (only when the title can change hands). */}
              <SettingRow
                label={COMMISSIONER_ROW}
                value={COMMISSIONER_YOU}
                onPress={transferAllowed(membershipWindow) ? () => {
                  setLeaveError(null);
                  setTransferOpen(true);
                } : undefined}
              />
            </>
          ) : null}
        </SetupCard>
      </View>

      {leaveBlock}
      {transferSheet}

      <DraftDateSheet
        visible={showDatePicker && !isLocked && !dateLocked}
        initial={draftDate}
        onConfirm={(d) => {
          setDraftDateTBD(false);
          setDraftDate(d);
        }}
        onSetLater={() => {
          setDraftDateTBD(true);
          setDateError(null);
        }}
        onClose={() => setShowDatePicker(false)}
      />
    </SetupScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  cardStack: {
    paddingVertical: space[5],
    gap: space[4],
  },
  block: {
    paddingVertical: space[4],
  },
  spread: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[2],
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    minHeight: 44,
  },
  grow: {
    flex: 1,
  },
  key: {
    fontFamily: typeFontFamily.semiBold,
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  dim: {
    opacity: 0.5,
  },
  center: {
    alignItems: 'center',
    gap: space[4],
    paddingTop: space[9],
  },
  centerText: {
    textAlign: 'center',
  },
});
