/**
 * The username format rule, client side (the app's lib/shell/usernameRules.ts).
 * The server is the truth (^[A-Za-z0-9_]{3,20}$, case-insensitive uniqueness);
 * this mirrors the FORMAT half so the field can check it live. Uniqueness and
 * content are never judged here: check_usernames / set_username decide.
 */
import { WEB_COPY } from './joinCopy';

/** Byte-for-byte the pattern in 20261007000000_username_write_path.sql. */
export const USERNAME_PATTERN = '^[A-Za-z0-9_]{3,20}$';
export const USERNAME_RE = new RegExp(USERNAME_PATTERN);

/** The rule a candidate fails first, or null when the format is valid. */
export function firstFailingRule(value: string): string | null {
  if (value.length < 3 || value.length > 20) return WEB_COPY.usernameLength;
  if (!/^[A-Za-z0-9_]+$/.test(value)) return WEB_COPY.usernameCharset;
  return null;
}
