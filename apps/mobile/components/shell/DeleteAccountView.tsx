/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { Field } from '@/components/shell/Field';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { loadApple } from '@/lib/auth/socialSignIn';
import { canAsk, type DeleteState } from '@/lib/account/deleteFlow';
import {
  CONFIRMED_WITH_APPLE, CONFIRMED_WITH_GOOGLE, CONTINUE_WITH_GOOGLE, DELETE_BUTTON, DELETE_FAILED, DELETE_LEAD, DELETE_TITLE,
  PROOF_PASSWORD, PROOF_SOCIAL, pastSeasonsLine,
} from '@/lib/account/deleteCopy';
import type { DeleteLeagueLine } from '@/lib/account/leagueLines';
import { proofInHand } from '@/lib/account/proofKind';

// Account deletion (W4) — the delete screen, board "Decided" (B: one line per league). Presentational: the route
// (app/delete-account.tsx) owns the state machine and the calls.
//
// Top to bottom: the title, "This deletes your account right away.", one Card with each league's name and what
// happens to it, "Past seasons keep your results under “{label}”.", the proof (a password field, or Apple / Google),
// the one plain failure line, and the destructive pill (lossFill with onYou ink: the same Button the Sell and Leave
// league sheets use). The button stays DIMMED until the proof is in hand; the proof line right above it is its
// visible reason (UX rule 8). After an Apple/Google proof, "Confirmed with …" replaces the provider button.
// While the request runs the button is a spinner and nothing on the screen takes a tap.

/** Body copy caps at 2× (as Profile's rows do), so the screen scrolls rather than a line outgrowing the title. */
const BODY_MAX_SCALE = 2;

export interface DeleteAccountViewProps {
  state: DeleteState;
  /** null while the leagues load or when they could not be read (no list is drawn, never a guessed one). */
  leagues: DeleteLeagueLine[] | null;
  label: string;
  password: string;
  onPassword: (v: string) => void;
  onApple: () => void;
  onGoogle: () => void;
  onDelete: () => void;
}

export function DeleteAccountView({ state, leagues, label, password, onPassword, onApple, onGoogle, onDelete }: DeleteAccountViewProps) {
  const { colors } = useTheme();
  const sending = state.phase === 'sending';
  const proven = proofInHand(state.proof, state.kind);

  return (
    <View style={styles.stack} pointerEvents={sending ? 'none' : 'auto'}>
      <ScreenTitle>{DELETE_TITLE}</ScreenTitle>
      <Text variant="body" maxFontSizeMultiplier={BODY_MAX_SCALE}>
        {DELETE_LEAD}
      </Text>

      {leagues && leagues.length > 0 ? (
        <Card style={styles.card}>
          {leagues.map((l, i) => (
            <View key={l.id} style={[styles.league, i > 0 ? styles.leagueGap : null]}>
              <Text variant="callout" maxFontSizeMultiplier={BODY_MAX_SCALE} style={styles.leagueName}>
                {l.name}
              </Text>
              <Text variant="callout" tone="secondary" maxFontSizeMultiplier={BODY_MAX_SCALE}>
                {l.line}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text variant="body" tone="secondary" maxFontSizeMultiplier={BODY_MAX_SCALE}>
        {pastSeasonsLine(label)}
      </Text>

      {state.kind === 'password' ? (
        <Field
          label={PROOF_PASSWORD}
          value={password}
          onChangeText={onPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          invalid={state.proofRejected}
          editable={!sending}
        />
      ) : proven ? (
        <View style={styles.confirmed} accessible accessibilityLiveRegion="polite">
          <Icon name="check" size="body" tone="gain" />
          <Text variant="callout" color={colors.gain} maxFontSizeMultiplier={BODY_MAX_SCALE} style={styles.bold}>
            {state.kind === 'apple' ? CONFIRMED_WITH_APPLE : CONFIRMED_WITH_GOOGLE}
          </Text>
        </View>
      ) : (
        <View style={styles.proofBlock}>
          <Text variant="callout" tone="secondary" maxFontSizeMultiplier={BODY_MAX_SCALE} style={styles.bold}>
            {PROOF_SOCIAL}
          </Text>
          <ProviderButton kind={state.kind} onApple={onApple} onGoogle={onGoogle} />
        </View>
      )}

      {state.failed ? <WarnPanel text={DELETE_FAILED} /> : null}

      <Button
        label={DELETE_BUTTON}
        variant="destructive"
        status={sending ? 'loading' : 'idle'}
        disabled={!canAsk(state) && !sending}
        onPress={onDelete}
        fullWidth
      />
    </View>
  );
}

const APPLE_HEIGHT = 52; // the md Button's minHeight, so the provider buttons sit like Sign in's

function ProviderButton({ kind, onApple, onGoogle }: { kind: 'apple' | 'google' | 'password'; onApple: () => void; onGoogle: () => void }) {
  const { resolvedTheme } = useTheme();
  if (kind === 'apple') {
    const apple = loadApple();
    if (!apple) return null;
    // Apple's NATIVE button (App Review 4.8 / the HIG), flipped with the theme, exactly as Sign in draws it.
    return (
      <apple.AppleAuthenticationButton
        buttonType={apple.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={resolvedTheme === 'dark' ? apple.AppleAuthenticationButtonStyle.WHITE : apple.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={APPLE_HEIGHT / 2}
        style={styles.apple}
        onPress={onApple}
      />
    );
  }
  return <Button label={CONTINUE_WITH_GOOGLE} variant="secondary" onPress={onGoogle} />;
}

const styles = StyleSheet.create({
  stack: {
    gap: space[5],
  },
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  league: {
    gap: space[1],
    paddingVertical: space[2],
  },
  leagueGap: {
    marginTop: space[2],
  },
  leagueName: {
    fontWeight: '700',
  },
  proofBlock: {
    gap: space[3],
  },
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
  },
  bold: {
    fontWeight: '700',
  },
  apple: {
    height: APPLE_HEIGHT,
    width: '100%',
  },
});
