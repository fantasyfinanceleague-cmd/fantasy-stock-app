/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
// Create league (3c-2): the board's four steps — League, Season, Draft,
// Stakes ("Create league · Season" / "· Draft step"; League and Stakes have
// no frame and are composed from the same vocabulary). The step machine and
// its gates live in lib/game/createLeagueSteps.ts; handleCreate and every
// write below are unchanged from the nine-step screen this replaces.
import { Alert, Share, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { validateLeagueName } from '@/lib/contentModeration';
import { generateInviteCode } from '@/lib/inviteCode';
import SlotBuilder from '@/components/SlotBuilder';
import { playoffLine } from '@/lib/playoffs';
import {
  type Category,
  type SlotDraft,
  type StakeMode,
  DEFAULT_BUDGET_CAP,
  DEFAULT_NOTIONAL_PER_SLOT,
  STAKE_MODE_OPTIONS,
  fetchCategories,
  validateSlotConfig,
} from '@/lib/categoryData';
import { seamInsertLeague, seamInsertMember, seamSaveLeagueSlots } from '@/lib/game/seamCalls';
import {
  DRAFT_ORDER_OPTIONS,
  IF_TIME_RUNS_OUT_COPY,
  type DraftOrderMode,
  DEFAULT_PICK_SECONDS,
  PICK_SECONDS_OPTIONS,
  draftOrderCaption,
  pickSecondsCaption,
} from '@/lib/game/createLeagueSetup';
import {
  BUDGET_PRESETS,
  CREATE_ROUNDS_BOUNDS,
  DRAFT_DATE_LATER,
  CREATE_STEPS,
  CREATE_STEP_COPY,
  DURATION_OPTIONS,
  MANAGER_SIZES,
  type CreateStep,
  byeExpectedCopy,
  leagueNameError,
  nextStep,
  playoffTeamsSub,
  prevStep,
  roundRobinCaption,
  seasonCheckCaption,
  stakesStepError,
  stepManagers,
  stepNumber,
  stepWeeks,
  stepWithin,
  weeksShown,
} from '@/lib/game/createLeagueSteps';
import { byeNoticeCopy } from '@/lib/game/draftLobby';
import { PRICE_TIERS_NEED_A_SLOT, rosterSlotsCaption } from '@/lib/game/slotBuilderCopy';
import { draftDateTimeLabel } from '@/lib/home/draftCountdown';
import { draftDateForSave, seedDraftDate } from '@/lib/game/draftDateSave';
import { draftTimeRefusal } from '@/lib/game/autoStart';
import { stakesLine } from '@/lib/stakesLine';
import { INVITE_CODE_LABEL } from '@/lib/home/homeCopy';
import {
  CREATED_LINE,
  CREATED_NO_DATE,
  CREATE_FAILED,
  GO_TO_LEAGUE,
  SLOTS_NOT_SAVED,
  createdTitle,
  createdWithoutDate,
  inviteShareMessage,
} from '@/lib/game/createLeagueDone';
import { space, typeFontFamily } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Chip } from '@/components/sp/Chip';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Field } from '@/components/shell/Field';
import { SetupScaffold } from '@/components/game/SetupScaffold';
import { Stepper } from '@/components/game/Stepper';
import { DraftDateSheet } from '@/components/game/DraftDateSheet';
import { ChoiceRow, RowDivider, RowKey, RowWrap, SettingRow, SetupCard, SwitchRow, WarnNote } from '@/components/game/SetupRows';

interface WizardState {
  name: string;
  type: 'matchup' | 'duration';
  size: number;
  stakeMode: StakeMode;
  notionalPerSlot: string;
  budgetCap: string;
  allowUndraftable: boolean;
  slots: SlotDraft[];
  durationDays: number;
  numWeeks: number;
  playoffTeams: number;
  numRounds: number;
  draftDate: Date | null;
  draftDateTBD: boolean;
  draftOrder: DraftOrderMode;
  pickSeconds: number;
}

const TYPE_OPTIONS: { value: WizardState['type']; label: string; help: string }[] = [
  { value: 'matchup', label: 'Matchup', help: 'Weekly head-to-head battles with playoffs at the end.' },
  { value: 'duration', label: 'Duration', help: 'Best portfolio gains at the end wins it all.' },
];

export default function CreateLeagueWizard() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { refresh, setActiveLeagueId } = useLeagueContext();

  const [step, setStep] = useState<CreateStep>('league');
  const [creating, setCreating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // The done screen (Design Lead ruling), in place of the old "League Created!" Alert.
  const [created, setCreated] = useState<{ name: string; inviteCode: string; noDate: boolean } | null>(null);
  // Inline, under the Draft date row: a chosen date with no value (draftDateForSave).
  const [dateError, setDateError] = useState<string | null>(null);
  // Inline, under the name field (Design Lead ruling), never an Alert.
  const [nameError, setNameError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { fetchCategories().then(setCategories); }, []);

  const [state, setState] = useState<WizardState>({
    name: '',
    type: 'matchup',
    size: 8,
    stakeMode: 'fixed_notional',
    notionalPerSlot: String(DEFAULT_NOTIONAL_PER_SLOT),
    budgetCap: String(DEFAULT_BUDGET_CAP),
    allowUndraftable: false,
    slots: [],
    durationDays: 30,
    numWeeks: 11,
    playoffTeams: 4,
    numRounds: 6,
    draftDate: null,
    draftDateTBD: true, // Default to TBD
    draftOrder: 'random',
    pickSeconds: DEFAULT_PICK_SECONDS,
  });
  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  const minWeeks = state.size - 1;
  // Flexible playoffs (Giorgio, 2026-09-29): any P from 2 up to the league
  // size, equal included. Clamped like numWeeks, so shrinking the league never
  // leaves a stale P above it.
  const playoffTeams = Math.min(Math.max(state.playoffTeams, 2), state.size);
  // The weeks the insert writes (max(numWeeks, minWeeks), below), shown as such.
  const shownWeeks = weeksShown(state.numWeeks, state.size);

  const goBack = () => {
    const prev = prevStep(step);
    if (prev) setStep(prev);
    else router.dismiss();
  };

  const handleCreate = async () => {
    if (!user?.id) {
      // Unreachable behind the auth gate; logged, never shown (Design Lead ruling).
      console.error('Create league: no signed-in user');
      return;
    }

    // Never send draft_date: undefined (a live 1.1.0 bug): Set later is null, a
    // chosen date must have a value.
    const draftDateValue = draftDateForSave(state.draftDateTBD, state.draftDate);
    if (!draftDateValue.ok) {
      setDateError(draftDateValue.error);
      setStep('draft');
      return;
    }

    setCreating(true);
    try {
      const effectiveWeeks = state.type === 'matchup' ? Math.max(state.numWeeks, minWeeks) : null;

      // stake_mode is authoritative. budget_mode is deprecated and no longer
      // written (DB default applies); salary_cap_limit is retired — drop
      // migration authored on this branch. budget_amount only means anything
      // in budget_cap mode.
      const { data: league, error: leagueError } = await seamInsertLeague({
          name: state.name.trim(),
          commissioner_id: user.id,
          invite_code: generateInviteCode(),
          num_participants: state.size,
          num_rounds: state.numRounds,
          stake_mode: state.stakeMode,
          notional_per_slot: parseInt(state.notionalPerSlot) || DEFAULT_NOTIONAL_PER_SLOT,
          allow_undraftable: state.allowUndraftable,
          ...(state.stakeMode === 'budget_cap'
            ? { budget_amount: parseInt(state.budgetCap) || DEFAULT_BUDGET_CAP }
            : {}),
          league_type: state.type,
          duration_days: state.type === 'duration' ? state.durationDays : 30,
          num_weeks: effectiveWeeks,
          playoff_teams: state.type === 'matchup' ? playoffTeams : null,
          draft_status: 'not_started',
          draft_order_mode: state.draftOrder,
          pick_seconds: state.pickSeconds,
          draft_date: draftDateValue.value,
      });

      if (leagueError) throw leagueError;

      const { error: memberError } = await seamInsertMember({
        league_id: league.id,
        user_id: user.id,
        role: 'commissioner',
      });

      if (memberError) throw memberError;

      if (state.slots.length > 0) {
        try {
          await seamSaveLeagueSlots(league.id, state.slots);
        } catch (slotErr) {
          console.error('Slot save failed:', slotErr);
          Alert.alert(SLOTS_NOT_SAVED.title, SLOTS_NOT_SAVED.message);
        }
      }

      await refresh();
      setActiveLeagueId(league.id);

      setCreated({
        name: state.name,
        inviteCode: league.invite_code,
        noDate: createdWithoutDate(state.draftDateTBD, state.draftDate),
      });
    } catch (error: any) {
      // The raw message is logged, never shown (Design Lead ruling).
      console.error('Failed to create league:', error);
      // A draft-time refusal (trg_leagues_draft_time: not a quarter hour, under
      // an hour out) goes back to the Draft step, inline under the date.
      const refusal = draftTimeRefusal(error);
      if (refusal) {
        setDateError(refusal);
        setStep('draft');
        return;
      }
      Alert.alert(CREATE_FAILED.title, CREATE_FAILED.message);
    } finally {
      setCreating(false);
    }
  };

  const slotErrors = validateSlotConfig(state.slots, state.numRounds);

  const goNext = () => {
    if (step === 'league') {
      const error = leagueNameError(state.name, validateLeagueName);
      setNameError(error);
      if (error) return;
    }
    if (step === 'draft') {
      const date = draftDateForSave(state.draftDateTBD, state.draftDate);
      setDateError(date.ok ? null : date.error);
      if (!date.ok) return;
    }
    if (step === 'stakes') {
      // Price tiers NEED slot price ranges (they are the anti-skew mechanism);
      // other modes go straight on — category slots stay optional via
      // league settings. The reasons show inline (Roster slots, the slots).
      if (stakesStepError(state.stakeMode, state.slots.length, slotErrors)) return;
      handleCreate();
      return;
    }
    const next = nextStep(step);
    if (next) setStep(next);
  };

  const draftDateValue = state.draftDateTBD
    ? 'TBD'
    : draftDateTimeLabel(state.draftDate?.toISOString() ?? null) ?? 'Pick a date & time';

  // ── Step 1 · League ───────────────────────────────────────────────────
  const renderLeague = () => (
    <>
      <Field
        label="League name"
        value={state.name}
        onChangeText={(text) => {
          patch({ name: text });
          if (nameError) setNameError(null);
        }}
        error={nameError}
        placeholder="Give your league a name"
        autoCapitalize="words"
        autoFocus
        returnKeyType="next"
        onSubmitEditing={goNext}
        helper="Don't worry. You will be able to change this later."
      />
      <View style={styles.section}>
        <RowKey>League type</RowKey>
        <SetupCard>
          {TYPE_OPTIONS.map((t, i) => (
            <View key={t.value}>
              {i > 0 ? <RowDivider /> : null}
              <ChoiceRow title={t.label} help={t.help} selected={state.type === t.value} onPress={() => patch({ type: t.value })} />
            </View>
          ))}
        </SetupCard>
      </View>
    </>
  );

  // ── Step 2 · Season (board: "Create league · Season") ─────────────────
  const renderSeason = () => {
    const bye = state.type === 'matchup' ? byeNoticeCopy(state.size, shownWeeks) : null;
    return (
      <>
        <SetupCard style={styles.cardStack}>
          <Stepper
            label="Managers"
            sub="How many you expect, you included"
            value={state.size}
            onStep={(d) => patch({ size: stepManagers(state.size, d) })}
            canDecrement={state.size > MANAGER_SIZES[0]}
            canIncrement={state.size < MANAGER_SIZES[MANAGER_SIZES.length - 1]}
          />
          {state.type === 'matchup' ? (
            <>
              <Stepper
                label="Regular season"
                value={shownWeeks}
                unit="weeks"
                onStep={(d) => patch({ numWeeks: stepWeeks(state.numWeeks, state.size, d) })}
                canDecrement={shownWeeks > minWeeks}
                canIncrement
              />
              <Text variant="caption" tone="secondary">{roundRobinCaption(minWeeks)}</Text>
              {bye ? <WarnNote title={bye} line={byeExpectedCopy(state.size)} /> : null}
              <View style={styles.tight}>
                <Stepper
                  label="Playoff teams"
                  sub={playoffTeamsSub(state.size)}
                  value={playoffTeams}
                  onStep={(d) => patch({ playoffTeams: stepWithin(playoffTeams, d, 2, state.size) })}
                  canDecrement={playoffTeams > 2}
                  canIncrement={playoffTeams < state.size}
                />
                <Text variant="caption" style={styles.tabular}>{playoffLine(playoffTeams) ?? ''}</Text>
                <Text variant="caption" tone="secondary" style={styles.tabular}>
                  {seasonCheckCaption(shownWeeks, playoffTeams)}
                </Text>
              </View>
            </>
          ) : null}
        </SetupCard>
        {state.type === 'duration' ? (
          <View style={styles.section}>
            <RowKey>How long will your league run?</RowKey>
            <SetupCard>
              {DURATION_OPTIONS.map((d, i) => (
                <View key={d.value}>
                  {i > 0 ? <RowDivider /> : null}
                  <ChoiceRow title={d.label} help={d.desc} selected={state.durationDays === d.value} onPress={() => patch({ durationDays: d.value })} />
                </View>
              ))}
            </SetupCard>
          </View>
        ) : null}
      </>
    );
  };

  // ── Step 3 · Draft (board: DraftSettingsScreen) ───────────────────────
  const renderDraft = () => (
    <>
      <SetupCard style={styles.cardStack}>
        <View style={styles.spread}>
          <Text variant="headline">Pick clock</Text>
          <Text variant="callout" style={[styles.bold, styles.tabular]}>{`${state.pickSeconds} seconds`}</Text>
        </View>
        <SegmentedControl
          options={PICK_SECONDS_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
          value={String(state.pickSeconds)}
          onChange={(v) => patch({ pickSeconds: Number(v) })}
        />
        <Text variant="caption" tone="secondary">{pickSecondsCaption(state.pickSeconds)}</Text>
      </SetupCard>

      <SetupCard>
        <SettingRow
          label="Draft time"
          value={draftDateValue}
          valueColor={state.draftDateTBD ? colors.warnText : undefined}
          onPress={() => {
            // Seed the value the picker shows, so accepting it unchanged commits a date.
            patch({ draftDateTBD: false, draftDate: seedDraftDate(state.draftDate, new Date()) });
            setDateError(null);
            setShowDatePicker(true);
          }}
        />
        <RowDivider />
        <View style={styles.block}>
          <RowKey>Draft order</RowKey>
          <SegmentedControl
            options={DRAFT_ORDER_OPTIONS}
            value={state.draftOrder}
            onChange={(v) => patch({ draftOrder: v as DraftOrderMode })}
          />
          <Text variant="caption" tone="secondary">{draftOrderCaption(state.draftOrder)}</Text>
        </View>
        <RowDivider />
        <View style={styles.block}>
          <Stepper
            label="Rounds"
            sub="One per roster slot"
            value={state.numRounds}
            onStep={(d) => patch({ numRounds: stepWithin(state.numRounds, d, CREATE_ROUNDS_BOUNDS.min, CREATE_ROUNDS_BOUNDS.max) })}
            canDecrement={state.numRounds > CREATE_ROUNDS_BOUNDS.min}
            canIncrement={state.numRounds < CREATE_ROUNDS_BOUNDS.max}
          />
        </View>
        <RowDivider />
        <View style={styles.block}>
          <RowKey>If time runs out</RowKey>
          <Text variant="caption" tone="secondary">{IF_TIME_RUNS_OUT_COPY}</Text>
        </View>
      </SetupCard>

      {dateError ? (
        <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">
          {dateError}
        </Text>
      ) : null}
      {state.draftDateTBD ? (
        <Text variant="caption" tone="secondary">
          {DRAFT_DATE_LATER}
        </Text>
      ) : null}

      <DraftDateSheet
        visible={showDatePicker && !state.draftDateTBD}
        value={state.draftDate}
        onChange={(d) => patch({ draftDate: d, draftDateTBD: false })}
        onSetLater={() => {
          patch({ draftDateTBD: true, draftDate: null });
          setDateError(null);
        }}
        onClose={() => setShowDatePicker(false)}
      />
    </>
  );

  // ── Step 4 · Stakes (no frame: composed) ──────────────────────────────
  const renderStakes = () => (
    <>
      <SetupCard>
        {STAKE_MODE_OPTIONS.map((opt, i) => (
          <View key={opt.value}>
            {i > 0 ? <RowDivider /> : null}
            <ChoiceRow title={opt.label} help={opt.help} selected={state.stakeMode === opt.value} onPress={() => patch({ stakeMode: opt.value })} />
          </View>
        ))}
      </SetupCard>

      {state.stakeMode === 'fixed_notional' ? (
        <Field
          label="Stake per slot ($)"
          value={state.notionalPerSlot}
          onChangeText={(text) => patch({ notionalPerSlot: text.replace(/[^0-9]/g, '') })}
          keyboardType="numeric"
          placeholder={String(DEFAULT_NOTIONAL_PER_SLOT)}
          helper="Each pick simulates this dollar amount (fractional shares)."
        />
      ) : null}

      {state.stakeMode === 'budget_cap' ? (
        <View style={styles.section}>
          <Field
            label="Budget cap ($)"
            value={state.budgetCap}
            onChangeText={(text) => patch({ budgetCap: text.replace(/[^0-9]/g, '') })}
            keyboardType="numeric"
            placeholder={String(DEFAULT_BUDGET_CAP)}
          />
          <RowWrap>
            {BUDGET_PRESETS.map((amount) => (
              <Chip
                key={amount}
                label={`$${parseInt(amount).toLocaleString()}`}
                selected={state.budgetCap === amount}
                onPress={() => patch({ budgetCap: amount })}
              />
            ))}
          </RowWrap>
        </View>
      ) : null}

      <SetupCard>
        <SwitchRow
          label="Allow non-draftable stocks (full universe)"
          sub="Off (default): only vetted draftable stocks. On: the entire universe, including penny stocks and micro-caps."
          value={state.allowUndraftable}
          onValueChange={(value) => patch({ allowUndraftable: value })}
        />
      </SetupCard>

      {state.stakeMode === 'price_tiers' ? (
        <View style={styles.section}>
          <Text variant="headline" accessibilityRole="header">Roster slots</Text>
          <Text variant="caption" tone="secondary">
            {rosterSlotsCaption('price_tiers')}
          </Text>
          {state.slots.length === 0 ? (
            <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">
              {PRICE_TIERS_NEED_A_SLOT}
            </Text>
          ) : null}
          <SlotBuilder
            slots={state.slots}
            onChange={(slots) => patch({ slots })}
            categories={categories}
            leagueSize={state.size}
            numRounds={state.numRounds}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="headline" accessibilityRole="header">League summary</Text>
        <SetupCard>
          <SettingRow label="Name" value={state.name} />
          <RowDivider />
          <SettingRow label="Type" value={state.type === 'matchup' ? 'Matchup' : 'Duration'} />
          <RowDivider />
          <SettingRow label="Teams" value={String(state.size)} />
          <RowDivider />
          <SettingRow
            label="Stakes"
            // The shared stakes line (Design Lead: one line across Join and this
            // summary), with the amounts the insert writes.
            value={stakesLine(state.stakeMode, {
              notionalPerSlot: parseInt(state.notionalPerSlot) || DEFAULT_NOTIONAL_PER_SLOT,
              budgetAmount: parseInt(state.budgetCap) || DEFAULT_BUDGET_CAP,
            })}
          />
          <RowDivider />
          <SettingRow
            label="Draft"
            value={state.draftDateTBD ? 'TBD' : draftDateTimeLabel(state.draftDate?.toISOString() ?? null) ?? 'TBD'}
            valueColor={state.draftDateTBD ? colors.warnText : undefined}
          />
        </SetupCard>
      </View>
    </>
  );

  const renderStep = () => {
    switch (step) {
      case 'league': return renderLeague();
      case 'season': return renderSeason();
      case 'draft': return renderDraft();
      case 'stakes': return renderStakes();
      default: return null;
    }
  };

  if (created) {
    const share = async () => {
      try {
        await Share.share({ message: inviteShareMessage(created.inviteCode) });
      } catch {
        // A dismissed share sheet is not an error.
      }
    };
    return (
      <SetupScaffold
        title={createdTitle(created.name)}
        subtitle={CREATED_LINE}
        footer={<Button label={GO_TO_LEAGUE} onPress={() => router.replace('/(tabs)/league')} />}
      >
        {/* The pre-draft Home invite-code card (board). */}
        <SetupCard style={styles.codeCard}>
          <View style={styles.grow}>
            <Text variant="caption" tone="secondary">{INVITE_CODE_LABEL}</Text>
            <Text variant="title" style={styles.code} selectable>{created.inviteCode}</Text>
          </View>
          <Button label="Share" variant="secondary" size="sm" onPress={() => void share()} />
        </SetupCard>
        {created.noDate ? (
          <Text variant="body" tone="secondary">{CREATED_NO_DATE}</Text>
        ) : null}
      </SetupScaffold>
    );
  }

  const last = step === 'stakes';
  const blocked =
    (step === 'league' && !state.name.trim()) ||
    (last && stakesStepError(state.stakeMode, state.slots.length, slotErrors) !== null);

  return (
    <SetupScaffold
      back={{ label: step === 'league' ? 'Cancel' : 'Back', onPress: goBack }}
      step={{ number: stepNumber(step), total: CREATE_STEPS.length }}
      title={CREATE_STEP_COPY[step].title}
      subtitle={CREATE_STEP_COPY[step].subtitle}
      footer={
        <Button
          label={last ? 'Create league' : 'Next'}
          onPress={goNext}
          disabled={blocked}
          status={creating ? 'loading' : 'idle'}
        />
      }
    >
      {renderStep()}
    </SetupScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  cardStack: {
    paddingVertical: space[5],
    gap: space[5],
  },
  tight: {
    gap: space[2],
  },
  block: {
    paddingVertical: space[4],
    gap: space[3],
  },
  spread: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[2],
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  codeCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[5],
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
    gap: space[1],
  },
  code: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
});
