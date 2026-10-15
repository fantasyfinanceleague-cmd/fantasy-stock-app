/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { router, Stack } from 'expo-router';

import { radius, space, type } from '@/constants/tokens';
import { Button, FULL_WIDTH_FONT_SCALE, type ButtonStatus } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { Field } from '@/components/shell/Field';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useArrivalInvite } from '@/lib/invite/useArrivalInvite';
import { fixtureJoinedRows, joinedFactRows } from '@/lib/join/joinedFacts';
import { supabase } from '@/lib/supabase';
import { JOIN_FIXTURE } from '@/lib/join/devFixture';
import { CAPTURE } from '@/lib/shell/captureDev';
import { keepDots } from '@/lib/game/keepDots';
import { pushAskRouteFor } from '@/lib/shell/pushAsk';
import {
  FIXTURE_NETWORK_MS, fixtureJoinResponse, fixturePrefill, fixturePreviewResponse,
} from '@/lib/join/joinFixtureGate';
import {
  JOIN_COPY, errorMessage, interpretJoin, interpretPreview, joinedView, previewView, refineBlock,
  type JoinBlock, type PreviewLeague,
} from '@/lib/join/joinPreview';

// 3f — Join a league (1.2.0; board key-screens.html #join-league). Four steps:
// code → (finding) → preview → joined. The preview IS the confirmation: the
// button names the league, and nothing is joined before it. It shows ONLY what
// preview-league returns (a member COUNT, no faces).
//
// - A bad code and a failed lookup are the only errors under the field. Every
//   refusal for a league the server FOUND stays on the preview, as an Alert
//   card, so the reason names the league.
// - No server text ever reaches the screen (lib/join/joinPreview.ts maps every
//   outcome to copy written there).
// - Under the dev-only JOIN_FIXTURE flag (lib/join/devFixture.ts) the two invokes below are
//   answered locally, so every state is reachable without a real code or join.
//   The real parse/view code runs on top; nothing is written.
//
// Game Night (W4 Onboarding): the preview's rows sit in the §9C Card and divide by space,
// never a line; a refusal is the WarnPanel (`warnTint`, its own `warnText` ink, no icon), as on
// the money screens; Joined's medallion is the trade-done one (a check in `onYou` on `you`).

type Step = 'code' | 'preview' | 'joined';

/** The preview rows' Dynamic Type ceiling (callout 13 → 26pt), under the league name's display
 * (51pt at its 1.6× cap), so the name stays the screen's loudest line. */
const PREVIEW_ROW_MAX_SCALE = 2;

/** The two server calls. Kept inline (not in a lib) so the architecture map's call-site anchors stay on this screen. */
async function callPreview(code: string): Promise<{ data: unknown; error: unknown }> {
  if (JOIN_FIXTURE) {
    // `checking` holds the spinner forever (a capture of the loading frame).
    if (JOIN_FIXTURE === 'checking') return new Promise(() => {});
    if (JOIN_FIXTURE === 'typing') return fixturePreviewResponse('preview');
    await new Promise((r) => setTimeout(r, FIXTURE_NETWORK_MS));
    // join_race: the preview is joinable, the JOIN is what refuses.
    return fixturePreviewResponse(JOIN_FIXTURE === 'join_race' ? 'preview' : JOIN_FIXTURE);
  }
  const { data, error } = await supabase.functions.invoke('preview-league', { body: { code } });
  return { data, error };
}

async function callJoin(code: string): Promise<{ data: unknown; error: unknown }> {
  if (JOIN_FIXTURE) {
    await new Promise((r) => setTimeout(r, FIXTURE_NETWORK_MS));
    return fixtureJoinResponse(JOIN_FIXTURE);
  }
  const { data, error } = await supabase.functions.invoke('join-league', { body: { code } });
  return { data, error };
}

export default function JoinLeagueScreen() {
  const { refresh, setActiveLeagueId } = useLeagueContext();
  // Inside the invite-arrival flow (a pending invite) a full league reads "Ask whoever invited you";
  // a typed code keeps "Ask your commissioner" (Planner, 2026-10-14).
  const invited = useArrivalInvite() !== null;
  // At accessibility sizes a preview row stacks (label over value), so a value never wraps a word
  // at a time beside its label (W4 Onboarding, XXXL: "Sat, Oct / 10 · / 7:00 PM / ET").
  const { fontScale } = useWindowDimensions();
  const stackRows = fontScale >= FULL_WIDTH_FONT_SCALE;

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState(JOIN_FIXTURE ? fixturePrefill(JOIN_FIXTURE) : '');
  const [findStatus, setFindStatus] = useState<ButtonStatus>('idle');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [league, setLeague] = useState<PreviewLeague | null>(null);
  const [block, setBlock] = useState<JoinBlock | null>(null);
  const [actionStatus, setActionStatus] = useState<ButtonStatus>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [joinedName, setJoinedName] = useState('');
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // Drops the answer to a lookup the user has already walked away from.
  const request = useRef(0);
  const trimmed = code.trim();
  const finding = findStatus === 'loading';

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  function backToCode(clear: boolean) {
    request.current += 1;
    setStep('code');
    setLeague(null);
    setBlock(null);
    setActionError(null);
    setActionStatus('idle');
    setFindStatus('idle');
    if (clear) setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function find() {
    if (finding || !trimmed) return;
    const mine = ++request.current;
    setFieldError(null);
    setFindStatus('loading');
    Keyboard.dismiss();
    let outcome;
    try {
      const { data, error } = await callPreview(trimmed);
      outcome = interpretPreview(data, error);
    } catch {
      outcome = interpretPreview(null, new Error('network'));
    }
    if (mine !== request.current) return;
    setFindStatus('idle');
    if (outcome.kind === 'bad_code') {
      setFieldError(JOIN_COPY.badCode);
      return;
    }
    if (outcome.kind === 'error') {
      setFieldError(errorMessage(outcome.error));
      return;
    }
    setLeague(outcome.league);
    setBlock(outcome.block);
    setActionError(null);
    setActionStatus('idle');
    setStep('preview');
  }

  async function join() {
    if (actionStatus !== 'idle' || !league) return;
    const mine = ++request.current;
    setActionError(null);
    setActionStatus('loading');
    let outcome;
    try {
      const { data, error } = await callJoin(trimmed);
      outcome = interpretJoin(data, error);
    } catch {
      outcome = interpretJoin(null, new Error('network'));
    }
    if (mine !== request.current) return;
    if (outcome.kind === 'error') {
      setActionStatus('idle');
      setActionError(errorMessage(outcome.error));
      return;
    }
    if (outcome.kind === 'refused') {
      // The league changed since the preview (it filled, the draft started):
      // the same preview, now carrying the reason.
      setActionStatus('idle');
      const refined = refineBlock(outcome.block, league.draftStatus);
      setBlock(refined);
      // The Draft row must agree with the line under it.
      if (refined === 'draft_in_progress') setLeague({ ...league, draftStatus: 'in_progress' });
      return;
    }
    // Joined. A real join refreshes the league list so the new league is the
    // active one when "Go to the league" lands on its Home; a fixture joins nothing.
    if (!JOIN_FIXTURE) {
      await refresh();
      setActiveLeagueId(outcome.leagueId);
    }
    setJoinedName(outcome.leagueName);
    setJoinedId(JOIN_FIXTURE ? null : outcome.leagueId);
    setActionStatus('idle');
    setStep('joined');
  }

  /** "Open the league" for someone already in it: join-league answers already_member WITH the league id (the preview never carries one) and writes nothing. */
  async function open() {
    if (actionStatus !== 'idle') return;
    const mine = ++request.current;
    setActionError(null);
    setActionStatus('loading');
    let outcome;
    try {
      const { data, error } = await callJoin(trimmed);
      outcome = interpretJoin(data, error);
    } catch {
      outcome = interpretJoin(null, new Error('network'));
    }
    if (mine !== request.current) return;
    setActionStatus('idle');
    if (outcome.kind === 'error') {
      setActionError(errorMessage(outcome.error));
      return;
    }
    const id = outcome.kind === 'joined' ? outcome.leagueId : outcome.kind === 'refused' ? outcome.leagueId : null;
    if (!id) {
      setBlock('unknown');
      return;
    }
    if (!JOIN_FIXTURE) {
      await refresh();
      setActiveLeagueId(id);
    }
    router.replace('/(tabs)');
  }

  // DEV captures only (lib/shell/captureKnobs.ts): press Find league, then Join, by themselves,
  // so each fixture's preview, refusal and the joined screen open on a cold launch.
  useEffect(() => {
    if (!JOIN_FIXTURE || !CAPTURE.joinAuto) return;
    if (step === 'code' && findStatus === 'idle' && !fieldError && !league) void find();
    if (step === 'preview' && CAPTURE.joinAuto === 'join' && block === null && actionStatus === 'idle') void join();
    // Steps only: each fires once per state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const view = league ? previewView(league, block, { invited }) : null;

  if (step === 'joined' && league) {
    // The notifications ask comes right after joining (when it is due), then Home.
    return <Joined name={joinedName} draftDate={league.draftDate} leagueId={joinedId} fixtureLeague={JOIN_FIXTURE ? league : null} onContinue={() => void pushAskRouteFor('/(tabs)').then((to) => router.replace(to as never))} />;
  }

  if (step === 'preview' && view) {
    const primary =
      view.action === 'join' ? { label: `Join ${view.name}`, onPress: join }
      : view.action === 'open' ? { label: 'Open the league', onPress: open }
      : view.action === 'join_disabled' ? { label: 'Join', onPress: undefined }
      : { label: 'Try another code', onPress: () => backToCode(true) };
    return (
      <AuthScaffold back={{ label: 'Invite code', onPress: () => backToCode(false) }}>
        <View style={styles.previewHead}>
          <Text variant="caption" tone="secondary">
            {`Invite code ${trimmed.toUpperCase()}`}
          </Text>
          <ScreenTitle>{view.name}</ScreenTitle>
        </View>
        <Card style={styles.rows}>
          {view.rows.map((row) => (
            <View
              key={row.label}
              accessible
              accessibilityLabel={`${row.label}, ${row.value}`}
              style={stackRows ? styles.rowStacked : styles.row}
            >
              <Text variant="callout" tone="secondary" maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE}>
                {row.label}
              </Text>
              {/* keepDots: wraps only between "·" segments, never inside "7:00 PM ET". */}
              <Text variant="callout" numberOfLines={0} maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE} style={stackRows ? styles.rowValueStacked : styles.rowValue}>
                {keepDots(row.value)}
              </Text>
            </View>
          ))}
        </Card>
        {view.message ? <WarnPanel text={view.message} /> : null}
        {actionError ? <WarnPanel text={actionError} /> : null}
        <Button
          label={primary.label}
          variant={view.action === 'another' ? 'secondary' : 'primary'}
          status={actionStatus}
          disabled={view.action === 'join_disabled'}
          onPress={primary.onPress}
        />
        {view.caption ? (
          <Text variant="caption" tone="secondary" style={styles.caption}>
            {view.caption}
          </Text>
        ) : null}
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      back={{ label: 'Your leagues', onPress: leave }}
      footer={<Button label="Find league" status={findStatus} disabled={!trimmed} onPress={find} />}
    >
      <ScreenTitle>Join a league</ScreenTitle>
      <Text variant="body" tone="secondary">
        {JOIN_COPY.codeIntro}
      </Text>
      <Field
        ref={inputRef}
        label="Invite code"
        value={code}
        onChangeText={(v) => {
          setCode(v);
          if (fieldError) setFieldError(null);
        }}
        autoFocus
        editable={!finding}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={find}
        error={fieldError}
      />
    </AuthScaffold>
  );
}

/** Joined: the league's pre-draft Home is one tap away ("Go to the league"). */
function Joined({ name, draftDate, leagueId, fixtureLeague, onContinue }: { name: string; draftDate: string | null; leagueId: string | null; fixtureLeague: PreviewLeague | null; onContinue: () => void }) {
  // C1: the facts are read AFTER the join, as a member (the league and its member count in the context join() just refreshed), never from the preview.
  const { leagues, sheetLeagues } = useLeagueContext();
  const joined = leagueId ? leagues.find((l) => l.id === leagueId) : null;
  const members = leagueId ? sheetLeagues.find((l) => l.id === leagueId)?.membersJoined ?? null : null;
  const rows = joined ? joinedFactRows(joined, members) : fixtureLeague ? fixtureJoinedRows(fixtureLeague) : [];
  const { reduced, duration, easing } = useMotion();
  const pop = useSharedValue(reduced ? 1 : 0.8);
  useEffect(() => {
    pop.value = reduced ? 1 : withTiming(1, { duration: duration.slow, easing: easing.settle });
  }, [reduced, duration.slow, easing.settle, pop]);
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value >= 1 ? 1 : (pop.value - 0.8) * 5, transform: [{ scale: pop.value }] }));
  const v = joinedView(name, draftDate);
  return (
    <AuthScaffold>
      {/* Nothing to go back to: the join is done, so no back arrow and no swipe-back. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={styles.center}>
        <Animated.View style={popStyle}>
          <Icon name="check" size="medallion" tone="onYou" discTone="you" />
        </Animated.View>
        <ScreenTitle style={styles.centerText}>{v.title}</ScreenTitle>
        <Text variant="body" tone="secondary" maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE} style={styles.centerText}>
          {v.body}
        </Text>
        {rows.length > 0 ? (
          <Card style={[styles.rows, styles.joinedRows]}>
            {rows.map((row) => (
              <View key={row.label} accessible accessibilityLabel={`${row.label}, ${row.value}`} style={styles.row}>
                <Text variant="callout" tone="secondary" maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE}>
                  {row.label}
                </Text>
                <Text variant="callout" numberOfLines={0} maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE} style={styles.rowValue}>
                  {keepDots(row.value)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
        <View style={styles.centerButton}>
          <Button label="Go to the league" onPress={onContinue} />
        </View>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  previewHead: {
    gap: space[1],
  },
  // Rows divide by space (§9C rule 2): each row's own 12pt padding, plus the card's 8pt.
  rows: {
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[4],
    minHeight: 44,
    paddingVertical: space[3],
  },
  rowStacked: {
    gap: space[1],
    minHeight: 44,
    paddingVertical: space[3],
  },
  rowValueStacked: {
    fontFamily: type.headline.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: type.headline.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  joinedRows: {
    alignSelf: 'stretch',
  },
  caption: {
    textAlign: 'center',
  },
  center: {
    alignItems: 'center',
    gap: space[4],
    paddingTop: space[10],
  },
  centerText: {
    textAlign: 'center',
  },
  centerButton: {
    alignSelf: 'stretch',
    marginTop: space[4],
  },
});
