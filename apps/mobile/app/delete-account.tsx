import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, type ScrollView, type TextInput } from 'react-native';
import { router } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { DeleteAccountView } from '@/components/shell/DeleteAccountView';
import { useSession } from '@/lib/SessionProvider';
import { deleteAccount } from '@/lib/account/accountApi';
import { ALERT_BODY, ALERT_DELETE, ALERT_KEEP, ALERT_TITLE } from '@/lib/account/deleteCopy';
import { fixtureKind, fixtureLeagues, fixtureState } from '@/lib/account/deleteCapture';
import { applyOutcome, askConfirm, confirmDelete, keepAccount, setProof, type DeleteState } from '@/lib/account/deleteFlow';
import { loadDeleteLeagues } from '@/lib/account/deleteLeaguesApi';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import { setDeletedNotice } from '@/lib/account/deletedNotice';
import { endSessionAfterDeletion } from '@/lib/account/endSession';
import { leagueLine, type DeleteLeagueInput } from '@/lib/account/leagueLines';
import { proofKindFor } from '@/lib/account/proofKind';
import { proveWithApple, proveWithGoogle } from '@/lib/auth/socialSignIn';
import type { SocialProofResult } from '@/lib/auth/socialOutcome';
import { DELETE_FIXTURE } from '@/lib/shell/captureDev';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';
import { useFixtureScrollEnd } from '@/lib/shell/fixtureRoute';

// Account deletion (W4) — the delete screen's container (plan 2026-10-21; board "Decided"). It owns the state machine
// (lib/account/deleteFlow.ts) and the calls; components/shell/DeleteAccountView.tsx only draws.
//
//   proof in hand -> "Delete my account" opens the alert -> "Delete" is the ONLY thing that sends.
// The alert opens from the state (phase 'confirming'), never from the tap itself, so the screen cannot show it
// without the state machine having agreed, and "Keep my account" / a dismissal return to editing and send nothing.
export default function DeleteAccountScreen() {
  const { user, signOut } = useSession();
  const label = useDeletedManagerLabel();
  const meId = user?.id ?? '';
  const realKind = proofKindFor(user?.identities);
  const [state, setState] = useState<DeleteState>(() => fixtureState(DELETE_FIXTURE, realKind));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [password, setPassword] = useState(() => (DELETE_FIXTURE === 'password_ready' || DELETE_FIXTURE === 'failed' || DELETE_FIXTURE === 'running' || DELETE_FIXTURE === 'alert') && fixtureKind(DELETE_FIXTURE, realKind) === 'password' ? 'fixture-password' : '');
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  useFixtureScrollEnd(scrollRef); // DEV captures only: EXPO_PUBLIC_SHELL_SCROLL_END=1 shows the foot of a long (XXXL) screen
  const [inputs, setInputs] = useState<DeleteLeagueInput[] | null>(null);

  useEffect(() => {
    if (!meId) return;
    if (DELETE_FIXTURE) {
      setInputs(fixtureLeagues(meId));
      return;
    }
    let live = true;
    void loadDeleteLeagues(meId, label).then((r) => {
      if (live) setInputs(r);
    });
    return () => {
      live = false;
    };
  }, [meId, label]);
  // A refused password: clear the field and put the cursor back in it (the button stays dimmed until they type again).
  const rejected = state.proofRejected && state.kind === 'password';
  useEffect(() => {
    if (!rejected) return;
    setPassword('');
    inputRef.current?.focus();
    // The keyboard comes up over the foot of the screen: bring the refusal under the field (and the dimmed button) back into view.
    // Layout-driven, not one timer: when the keyboard finishes opening (or its frame changes), and again shortly after
    // for a keyboard that was already up or a slow phone.
    const toEnd = () => scrollRef.current?.scrollToEnd({ animated: true });
    const subs = [Keyboard.addListener('keyboardDidShow', toEnd), Keyboard.addListener('keyboardDidChangeFrame', toEnd)];
    const timers = [setTimeout(toEnd, 350), setTimeout(toEnd, 900)];
    return () => {
      subs.forEach((x) => x.remove());
      timers.forEach(clearTimeout);
    };
  }, [rejected]);
  const leagues = useMemo(() => (inputs ? inputs.map((l) => leagueLine(l, meId, label, Date.now())) : null), [inputs, meId, label]);

  const onPassword = useCallback((v: string) => {
    setPassword(v);
    setState((s) => setProof(s, v.length > 0 ? { kind: 'password', password: v } : null, Date.now()));
  }, []);

  const onProof = useCallback((r: SocialProofResult) => {
    if (r.kind === 'proof') setState((s) => setProof(s, r.proof, Date.now()));
    // cancelled / unavailable / error: say nothing and leave the button dimmed (the proof line is the reason)
  }, []);
  const onApple = useCallback(() => void proveWithApple().then(onProof), [onProof]);
  const onGoogle = useCallback(() => void proveWithGoogle().then(onProof), [onProof]);

  // The button only ASKS. The alert is the state's.
  const onAsk = useCallback(() => setState((s) => askConfirm(s)), []);

  const send = useCallback(async () => {
    const { state: next, body, proofAt } = confirmDelete(stateRef.current);
    if (!body) return;
    setState(next);
    const outcome = await deleteAccount(body, proofAt);
    setState((s) => applyOutcome(s, outcome));
    if (outcome.kind !== 'deleted') return;
    // The server deleted the auth user: every device is signed out. Raise the line BEFORE the local clear so Sign in
    // shows it from its first render; the auth guard then lands the signed-out stack (Sign in) by itself.
    setDeletedNotice(true);
    if (SHELL_FIXTURE) await signOut();
    else await endSessionAfterDeletion();
  }, [signOut]);

  // Open the native alert exactly when the state says so.
  const phase = state.phase;
  useEffect(() => {
    if (phase !== 'confirming') return;
    Alert.alert(
      ALERT_TITLE,
      ALERT_BODY,
      [
        { text: ALERT_KEEP, style: 'cancel', onPress: () => setState((s) => keepAccount(s)) },
        { text: ALERT_DELETE, style: 'destructive', onPress: () => void send() },
      ],
      { cancelable: true, onDismiss: () => setState((s) => keepAccount(s)) },
    );
  }, [phase, send]);

  // DEV capture only: 'alert' presses the real button once, so the native alert is the real one.
  useEffect(() => {
    if (DELETE_FIXTURE === 'alert') onAsk();
  }, [onAsk]);

  return (
    <AuthScaffold ref={scrollRef} back={{ label: 'Profile', onPress: () => (router.canGoBack() ? router.back() : router.replace('/profile')) }}>
      <DeleteAccountView
        state={state}
        leagues={leagues}
        label={label}
        password={password}
        inputRef={inputRef}
        onPassword={onPassword}
        onApple={onApple}
        onGoogle={onGoogle}
        onDelete={onAsk}
      />
    </AuthScaffold>
  );
}
