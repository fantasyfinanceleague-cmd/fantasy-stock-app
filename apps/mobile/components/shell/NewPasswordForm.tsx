/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { space } from '@/constants/tokens';
import { PASSWORD_REQUIREMENTS, PASSWORD_RULE_SENTENCE, checkPassword } from '@/constants/passwordRules';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useMotion } from '@/components/sp/motion';
import { Field } from '@/components/shell/Field';
import { ScreenTitle } from '@/components/shell/ScreenTitle';

// Phase 3b-1 — "Set a new password" (board "Change password"), shared by
// Reset password (spec row 5, the recovery link) and Change password (row
// 13). Strings verbatim from the old reset-password.tsx: "Set a new
// password", "New password", "Confirm new password", "Passwords don't
// match.", "Update password", "Cancel", "Please enter a new password.",
// "Your password needs: …". Errors are inline and instant (§4); the button
// goes loading → ✓ done (held `quick`) before `onDone` runs.

export interface NewPasswordFormProps {
  /** Performs the update; resolves to a user-facing error, or null on success. */
  submit: (password: string) => Promise<string | null>;
  onDone: () => void;
  onCancel: () => void;
}

export function NewPasswordForm({ submit, onDone, onCancel }: NewPasswordFormProps) {
  const { duration } = useMotion();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmRef = useRef<TextInput>(null);

  const rules = PASSWORD_REQUIREMENTS.map((r) => ({ label: r.label, ok: r.test(password) }));

  async function handleUpdate() {
    if (status !== 'idle') return;
    setPasswordError(null);
    setConfirmError(null);
    if (!password) {
      setPasswordError('Please enter a new password.');
      return;
    }
    const { failing } = checkPassword(password);
    if (failing.length > 0) {
      setPasswordError(`Your password needs: ${failing.map((r) => r.label.toLowerCase()).join(', ')}.`);
      return;
    }
    if (password !== confirm) {
      setConfirmError("Passwords don't match.");
      return;
    }
    setStatus('loading');
    const error = await submit(password);
    if (error) {
      setStatus('idle');
      setPasswordError(error);
      return;
    }
    setStatus('done');
    setTimeout(onDone, duration.quick);
  }

  return (
    <>
      <View style={styles.heading}>
        <ScreenTitle>Set a new password</ScreenTitle>
        <Text variant="body" tone="secondary">
          {PASSWORD_RULE_SENTENCE}
        </Text>
      </View>
      <View style={styles.fields}>
        <Field
          label="New password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (passwordError) setPasswordError(null);
          }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          autoFocus
          error={passwordError}
          rules={rules}
        />
        <Field
          ref={confirmRef}
          label="Confirm new password"
          value={confirm}
          onChangeText={(v) => {
            setConfirm(v);
            if (confirmError) setConfirmError(null);
          }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleUpdate}
          error={confirmError}
        />
      </View>
      <Button label="Update password" status={status} onPress={handleUpdate} disabled={!password || !confirm} />
      <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel} hitSlop={8}>
        <Text variant="body" tone="secondary">
          Cancel
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: space[2],
  },
  fields: {
    gap: space[5],
  },
  cancel: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
});
