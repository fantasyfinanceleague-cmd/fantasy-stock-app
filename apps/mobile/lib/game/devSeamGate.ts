/**
 * The capture seam's gate, pure (3c): on only in a dev build AND with the flag set
 * to exactly '1'. No RN or Expo globals here, so the rule is tested under deno.
 */
export function seamActive(isDev: boolean, flag: string | undefined): boolean {
  return isDev === true && flag === '1';
}
