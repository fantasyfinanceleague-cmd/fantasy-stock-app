/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { space, type } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { Button } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { WARN_TEXT_MAX_SCALE, WarnPanel } from '@/components/sp/WarnPanel';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { GO_TO_HOME, NOT_NOW, TAKE_THE_TEAM, takeoverQuestion } from '@/lib/account/deleteCopy';
import { deadLine, recordLine, type TakeoverPreview } from '@/lib/account/takeoverView';
import { JOIN_COPY } from '@/lib/join/joinPreview';
import { ARRIVAL_COPY } from '@/lib/invite/arrivalView';

// Account deletion (W4) — the takeover landing (board "Takeover landing" and "Already taken"). The default avatar
// over "Take over {label}'s team in {League}?" and the seat's record, centred in the space above the actions;
// "Take the team" and "Not now" dock at the bottom. A dead link has NO heading: the refusal panel and one way out
// are centred (the invite arrival's dead-link pattern, which the board names).

const DISC = 64;

/** One sentence capped so it stays a panel at XXXL. */
const LINK_MAX_SCALE = WARN_TEXT_MAX_SCALE;

export type TakeoverLandingState =
  | { kind: 'loading' }
  | Exclude<TakeoverPreview, { kind: 'member' }>
  | { kind: 'taking'; found: Extract<TakeoverPreview, { kind: 'found' }> };

export function TakeoverLanding({
  state, label, onTake, onNotNow, onHome, onRetry, takeFailed,
}: {
  state: TakeoverLandingState;
  label: string;
  onTake: () => void;
  onNotNow: () => void;
  onHome: () => void;
  onRetry: () => void;
  /** The write came back unknown: say so under the buttons (the preview's own "couldn't reach" line). */
  takeFailed: boolean;
}) {
  const { colors } = useTheme();

  if (state.kind === 'taken' || state.kind === 'dead') {
    return (
      <AuthScaffold centerBody>
        <View style={styles.actions}>
          <WarnPanel text={deadLine(state)} />
          <Link label={GO_TO_HOME} onPress={onHome} />
        </View>
      </AuthScaffold>
    );
  }

  if (state.kind === 'loading') {
    return (
      <AuthScaffold centerBody>
        <ActivityIndicator color={colors.text2} accessibilityLabel="Loading" />
      </AuthScaffold>
    );
  }

  if (state.kind === 'unknown') {
    return (
      <AuthScaffold centerBody>
        <View style={styles.actions}>
          <WarnPanel text={JOIN_COPY.unreachable} />
          <Link label={ARRIVAL_COPY.tryAgain} onPress={onRetry} />
          <Link label={NOT_NOW} onPress={onNotNow} muted />
        </View>
      </AuthScaffold>
    );
  }

  const found = state.kind === 'found' ? state : state.found;
  const taking = state.kind === 'taking';
  return (
    <AuthScaffold
      centerBody
      footer={
        <View style={styles.actions}>
          {takeFailed ? <WarnPanel text={JOIN_COPY.unreachable} /> : null}
          <Button label={TAKE_THE_TEAM} status={taking ? 'loading' : 'idle'} onPress={onTake} fullWidth />
          <Link label={NOT_NOW} onPress={onNotNow} muted disabled={taking} />
        </View>
      }
    >
      <View style={styles.block}>
        <Avatar name={label} size={DISC} tone="neutral" />
        <ScreenTitle style={styles.title}>{takeoverQuestion(label, found.leagueName)}</ScreenTitle>
        <Card style={styles.record}>
          <Text variant="headline" maxFontSizeMultiplier={LINK_MAX_SCALE} style={styles.num}>
            {recordLine(found.wins, found.losses, found.rank)}
          </Text>
        </Card>
      </View>
    </AuthScaffold>
  );
}

function Link({ label, onPress, muted = false, disabled = false }: { label: string; onPress: () => void; muted?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="link" style={styles.link}>
      <Text variant="body" maxFontSizeMultiplier={LINK_MAX_SCALE} color={muted ? colors.text2 : colors.accent} style={styles.bold}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    gap: space[4],
  },
  title: {
    textAlign: 'center',
  },
  record: {
    paddingHorizontal: space[6],
    paddingVertical: space[4],
  },
  num: {
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  actions: {
    gap: space[3],
  },
  link: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  bold: {
    fontFamily: type.headline.fontFamily,
  },
});
