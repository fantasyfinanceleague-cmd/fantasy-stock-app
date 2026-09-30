/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { forwardRef, ReactNode, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// Phase 3b-1 — the board's form field (docs/design/screens/screens.css
// .ks-field*): a label, a 50pt box on `surface` with a `borderStrong`
// hairline, 2pt `accent` when focused, 2pt `danger` with an error, then the
// error / helper / rules lines beneath.
//
// Errors appear INSTANTLY (DESIGN_DIRECTION §4, "error states never
// animate"; Design Lead ruling 2026-09-29) — there is deliberately no
// animation anywhere in this file. They are announced to VoiceOver through
// accessibilityLiveRegion.

export interface FieldRule {
  ok: boolean;
  label: string;
}

export interface FieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  error?: string | null;
  /** Marks the box as in error without a message of its own (the message sits under a sibling field). */
  invalid?: boolean;
  helper?: string;
  /** Live rule checklist (✓ met in `gain`, ○ not yet in `text2`). */
  rules?: FieldRule[];
  /** Right-hand slot inside the box (the username availability state). */
  trailing?: ReactNode;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, invalid = false, helper, rules, trailing, onFocus, onBlur, ...input },
  ref
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const inError = !!error || invalid;
  const emphasised = inError || focused;
  const borderColor = inError ? colors.danger : focused ? colors.accent : colors.borderStrong;

  return (
    <View style={styles.field}>
      <Text variant="callout" style={styles.label}>
        {label}
      </Text>
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderWidth: emphasised ? 2 : 1,
            // Keep the text from shifting when the border thickens.
            paddingHorizontal: emphasised ? space[4] + 1 : space[4] + 2,
          },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          placeholderTextColor={colors.text2}
          selectionColor={colors.accent}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text }]}
          {...input}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {helper ? (
        <Text variant="caption" tone="secondary">
          {helper}
        </Text>
      ) : null}
      {rules && rules.length ? (
        <View style={styles.rules}>
          {rules.map((rule) => {
            const color = rule.ok ? colors.gain : colors.text2;
            // Glyph and label are separate so a label that wraps (Accessibility
            // XL) hangs under its own text, not under the glyph.
            return (
              <View
                key={rule.label}
                accessible
                accessibilityLabel={`${rule.label}, ${rule.ok ? 'met' : 'not met'}`}
                style={styles.ruleRow}
              >
                <Text variant="caption" color={color} style={styles.rule}>
                  {rule.ok ? '✓' : '○'}
                </Text>
                <Text variant="caption" color={color} style={[styles.rule, styles.ruleLabel]}>
                  {rule.label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    gap: space[2] + 2,
  },
  label: {
    fontFamily: type.headline.fontFamily,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    paddingVertical: space[4],
  },
  trailing: {
    marginLeft: space[3],
  },
  error: {
    fontFamily: type.headline.fontFamily,
  },
  rules: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: space[4],
    rowGap: space[1],
  },
  ruleRow: {
    flexDirection: 'row',
    gap: space[2],
    maxWidth: '100%',
  },
  rule: {
    fontFamily: type.headline.fontFamily,
  },
  ruleLabel: {
    flexShrink: 1,
  },
});
