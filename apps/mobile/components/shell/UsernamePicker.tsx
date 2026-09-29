/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { space } from '@/constants/tokens';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Chip } from '@/components/sp/Chip';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { Field } from '@/components/shell/Field';
import { UsernameStatusIcon } from '@/components/shell/UsernameStatusIcon';
import { validateUsername } from '@/lib/contentModeration';
import { checkUsernames, setUsername } from '@/lib/shell/usernameApi';
import {
  initialUsernameState,
  pickAvailable,
  usernameReducer,
  usernameSuggestions,
  usernameView,
} from '@/lib/shell/usernameMachine';

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

export interface UsernamePickerProps {
  /** The account's current username (edit mode), or null (first run). */
  current: string | null;
  /** For email-derived suggestions. */
  email: string | null;
  /** Called after set_username returned 'ok' and the ✓ has shown. */
  onSaved: (username: string) => void;
}

export function UsernamePicker({ current, email, onSaved }: UsernamePickerProps) {
  const { reduced, duration, stagger } = useMotion();
  // Edit mode starts on the current name ("unchanged": nothing to save yet).
  const [state, dispatch] = useReducer(usernameReducer, initialUsernameState, (init) =>
    current ? usernameReducer(init, { type: 'input', value: current, contentOk: true, current }) : init
  );
  const [value, setValue] = useState(current ?? '');
  const view = usernameView(state);
  const emailLocal = email ? email.split('@')[0] : null;
  const latest = useRef(state);
  latest.current = state;

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
    const offered = usernameSuggestions(candidate, emailLocal, new Date().getFullYear());
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
    if (result === 'ok') setTimeout(() => onSaved(candidate), duration.quick);
  }

  const buttonStatus: ButtonStatus = state.kind === 'submitting' ? 'loading' : state.kind === 'saved' ? 'done' : 'idle';

  return (
    <>
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Pick a username
        </Text>
        <Text variant="body" tone="secondary">
          Shown to your league on standings and matchups
        </Text>
      </View>

      <Field
        label="Username"
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="nickname"
        returnKeyType="done"
        onSubmitEditing={onContinue}
        autoFocus
        maxLength={40}
        error={view.error}
        trailing={<UsernameStatusIcon state={view.trailing} />}
        rules={view.rules}
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

      <Button
        label="Continue"
        status={buttonStatus}
        onPress={onContinue}
        disabled={!view.canContinue && buttonStatus === 'idle'}
      />
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
  exit: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
