/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { space, type } from '@/constants/tokens';
import { fittedFontSize } from '@/lib/shell/fitText';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Chip } from '@/components/sp/Chip';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { EmailConfirmedChip } from '@/components/shell/EmailConfirmedChip';
import { Field } from '@/components/shell/Field';
import { UsernameStatusIcon } from '@/components/shell/UsernameStatusIcon';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { validateUsername } from '@/lib/contentModeration';
import { checkUsernames, setUsername } from '@/lib/shell/usernameApi';
import { isEmailJustConfirmed, setEmailJustConfirmed, subscribeEmailJustConfirmed } from '@/lib/auth/emailConfirmed';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';
import { pickAvailableGamertag, seededRng } from '@/lib/shell/gamertag';
import {
  HELPER_CHANGE_LATER,
  initialUsernameState,
  pickAvailable,
  usernameReducer,
  usernameSuggestions,
  usernameView,
} from '@/lib/shell/usernameMachine';
import { CAPTURE } from '@/lib/shell/captureDev';

// Onboarding W4 (plan 2026-10-14; board #1.3 frame 2): on FIRST RUN the field arrives pre-filled
// with a generated gamertag (lib/shell/gamertag.ts: {adjective}{Animal}{digits}, never a name or
// anything from the email or a sign-in provider), the server has already said it is available, and
// the primary is "Keep"; "Change" opens the field to type. If the generator can't reach the server
// (or takes longer than SUGGEST_TIMEOUT_MS) the screen is the plain form: an empty field, never a
// name nobody checked. The "✓ EMAIL CONFIRMED" chip shows above the title when the confirmation
// link brought you here, and clears when the name is kept. Profile › Username (edit mode) is
// unchanged: it starts on the current name and never suggests.
//
// Phase 3b-1 — Pick a username (spec row 8, board "Pick a username", S6).
// Shared by the first-run gate (a NULL username, before the tabs) and
// Profile › Username (edit mode). All decisions live in the pure machine
// (lib/shell/usernameMachine.ts); this component only wires it to the
// field, the two RPCs and the motion.
//
// - Rules shown inline ("3–20 characters", "Letters, numbers and
//   underscores"), checked live.
// - Availability is asked 350 ms after typing stops; results carry the
//   sequence number they were asked under, so a late answer for an old
//   input is dropped.
// - Taken → "This username is already taken." plus 3 available
//   suggestions (one check_usernames call for up to 9 candidates); the
//   chips stagger in (30 ms) — the recovery path is allowed to move.
// - Errors appear instantly, in both Reduce Motion modes (§4).

const CHECK_DEBOUNCE_MS = 350;
/** Longest the first-run screen waits for a generated name before it is just the form. */
export const SUGGEST_TIMEOUT_MS = 6000;

/** suggesting: asking the server for a free gamertag; suggested: Keep / Change; editing: the form. */
type Mode = 'suggesting' | 'suggested' | 'editing';

export interface UsernamePickerProps {
  /** The account's current username (edit mode), or null (first run). */
  current: string | null;
  /** Called after set_username returned 'ok' and the ✓ has shown. */
  onSaved: (username: string) => void;
}

export function UsernamePicker({ current, onSaved }: UsernamePickerProps) {
  const { reduced, duration, stagger } = useMotion();
  // Edit mode starts on the current name ("unchanged": nothing to save yet).
  const [state, dispatch] = useReducer(usernameReducer, initialUsernameState, (init) =>
    current ? usernameReducer(init, { type: 'input', value: current, contentOk: true, current }) : init
  );
  const [value, setValue] = useState(current ?? '');
  const view = usernameView(state);
  const latest = useRef(state);
  latest.current = state;
  const inputRef = useRef<TextInput>(null);
  const firstRun = current === null;
  const confirmed = useSyncExternalStore(subscribeEmailJustConfirmed, isEmailJustConfirmed);
  const [mode, setMode] = useState<Mode>(firstRun && !CAPTURE.usernamePrefill ? 'suggesting' : 'editing');
  // The suggested tag's size: the system size, shrunk only as needed (fitText.ts). null = the field's own.
  const { fontScale } = useWindowDimensions();
  const systemSize = type.body.fontSize * fontScale;
  const [fieldWidth, setFieldWidth] = useState(0);
  const [tagWidth, setTagWidth] = useState(0);
  const suggestedFit = mode === 'suggested' && tagWidth > 0 && fieldWidth > 0 ? fittedFontSize(systemSize, tagWidth, fieldWidth) : undefined;

  // First run: ask the server for a free gamertag. A fixture capture is deterministic (a seeded
  // source); a real run is random. The generated name is checked by check_usernames BEFORE it is
  // shown, so Keep never offers one nobody checked.
  useEffect(() => {
    if (mode !== 'suggesting') return;
    let cancelled = false;
    const rng = SHELL_FIXTURE ? seededRng(151) : Math.random;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SUGGEST_TIMEOUT_MS));
    void Promise.race([pickAvailableGamertag(rng, checkUsernames), timeout]).then((tag) => {
      if (cancelled) return;
      if (!tag) {
        setMode('editing');
        return;
      }
      setValue(tag);
      dispatch({ type: 'suggested', value: tag });
      setMode('suggested');
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // The suggestion lost a race (someone took it between the check and Keep): another one, silently.
  // Any other refusal shows the plain form with its reason.
  useEffect(() => {
    if (mode !== 'suggested') return;
    if (state.kind === 'taken') setMode('suggesting');
    else if (state.kind === 'server-invalid' || state.kind === 'check-failed') setMode('editing');
  }, [mode, state.kind]);

  /** Change: the field opens for typing, starting from the suggestion. */
  function startEditing() {
    setMode('editing');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // DEV captures only: start with a name typed in (e.g. a taken one), as if the user had.
  useEffect(() => {
    if (CAPTURE.usernamePrefill && current === null) onChange(CAPTURE.usernamePrefill);
    // ...and the EMAIL CONFIRMED chip, raised through the real store so keeping the name clears it.
    if (CAPTURE.confirmed === 'chip') setEmailJustConfirmed(true);
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask the server once typing pauses.
  useEffect(() => {
    if (state.kind !== 'checking') return;
    const { seq, candidate } = state;
    const timer = setTimeout(async () => {
      const rows = await checkUsernames([candidate]);
      if (!rows || !rows[0]) {
        dispatch({ type: 'check-failed', seq });
        return;
      }
      const status = rows[0].status;
      if (status !== 'taken') {
        dispatch({ type: 'check-result', seq, status });
        return;
      }
      dispatch({ type: 'check-result', seq, status, suggestions: await suggestFor(candidate) });
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Keyed on the sequence number: one check per distinct input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seq, state.kind]);

  async function suggestFor(candidate: string): Promise<string[]> {
    const offered = usernameSuggestions(candidate, Math.random, new Date().getFullYear());
    const rows = offered.length ? await checkUsernames(offered) : null;
    return rows ? pickAvailable(offered, rows) : [];
  }

  function onChange(next: string) {
    setValue(next);
    dispatch({ type: 'input', value: next, contentOk: validateUsername(next.trim()).isValid, current });
  }

  async function onContinue() {
    if (!view.canContinue) return;
    dispatch({ type: 'submit' });
    const seq = latest.current.seq;
    const candidate = value.trim();
    const result = await setUsername(candidate);
    if (result === null) {
      dispatch({ type: 'submit-failed', seq });
      return;
    }
    const suggestions = result === 'taken' ? await suggestFor(candidate) : undefined;
    dispatch({ type: 'submit-result', seq, result, suggestions });
    if (result === 'ok') {
      // The chip describes THIS sign-in; keeping the name ends it (lib/auth/emailConfirmed.ts).
      setEmailJustConfirmed(false);
      setTimeout(() => onSaved(candidate), duration.quick);
    }
  }

  const buttonStatus: ButtonStatus = state.kind === 'submitting' ? 'loading' : state.kind === 'saved' ? 'done' : 'idle';

  const picking = mode !== 'editing';
  return (
    <>
      {firstRun && confirmed ? <EmailConfirmedChip /> : null}
      <View style={styles.heading}>
        <ScreenTitle>Pick a username</ScreenTitle>
        <Text variant="body" tone="secondary">
          Shown to your league on standings and matchups
        </Text>
      </View>

      {/* The probe: the suggested tag's one-line width at the SYSTEM size, never shown. */}
      {mode === 'suggested' ? (
        <View style={styles.probeBox} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text
            variant="body"
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.probe, { fontSize: systemSize }]}
            onTextLayout={(e) => setTagWidth(e.nativeEvent.lines[0]?.width ?? 0)}
          >
            {value}
          </Text>
        </View>
      ) : null}
      <Field
        ref={inputRef}
        label="Username"
        value={mode === 'suggesting' ? '' : value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="nickname"
        returnKeyType="done"
        onSubmitEditing={onContinue}
        autoFocus={mode === 'editing' && !firstRun}
        editable={!picking}
        chosen={mode === 'suggested'}
        // A suggested name is the thing being kept, so it shows whole at every text size: the system size,
        // shrunk only as far as THIS tag needs to stay on one line (22pt floor, lib/shell/fitText.ts).
        // Typing keeps the system scale.
        inputFontSize={suggestedFit}
        onLayout={(e) => setFieldWidth(e.nativeEvent.layout.width)}
        maxLength={40}
        error={view.error}
        helper={firstRun && picking ? HELPER_CHANGE_LATER : undefined}
        trailing={<UsernameStatusIcon state={mode === 'suggesting' ? 'checking' : view.trailing} />}
        rules={picking ? undefined : view.rules}
      />

      {view.note ? (
        <Text variant="callout" tone="secondary" accessibilityLiveRegion="polite">
          {view.note}
        </Text>
      ) : null}

      {view.suggestions.length ? (
        <View style={styles.suggestions}>
          <Text variant="caption" tone="secondary">
            Available
          </Text>
          <View style={styles.chips}>
            {view.suggestions.map((s, i) => (
              <Animated.View
                key={`${state.seq}-${s}`}
                entering={
                  reduced
                    ? undefined
                    : FadeInDown.delay(stagger.delayFor(i)).duration(duration.base).reduceMotion(ReduceMotion.System)
                }
              >
                <Chip label={s} onPress={() => onChange(s)} />
              </Animated.View>
            ))}
          </View>
        </View>
      ) : null}

      {picking ? (
        <View style={styles.keepRow}>
          <Button label="Keep" status={buttonStatus} onPress={onContinue} disabled={mode === 'suggesting' || (!view.canContinue && buttonStatus === 'idle')} />
          <Button label="Change" variant="secondary" onPress={startEditing} />
        </View>
      ) : view.continueShown ? (
        <Button
          label="Continue"
          status={buttonStatus}
          onPress={onContinue}
          disabled={!view.canContinue && buttonStatus === 'idle'}
        />
      ) : null}
    </>
  );
}

/** "Sign out" / "Cancel" under the form — always reachable (spec: can't be skipped, but Sign out is always there). */
export function UsernamePickerExit({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.exit} hitSlop={8}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A zero-height box with the 4000pt probe inside: it measures and is never seen or widens the page.
  probeBox: {
    height: 0,
    overflow: 'hidden',
  },
  probe: {
    position: 'absolute',
    opacity: 0,
    width: 4000,
    fontFamily: type.body.fontFamily,
  },
  heading: {
    gap: space[2],
  },
  suggestions: {
    gap: space[3],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  keepRow: {
    gap: space[3],
  },
  exit: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
