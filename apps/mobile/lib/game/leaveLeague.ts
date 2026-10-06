/**
 * The league settings "Leave league" row (3c). Its placement is decided on the
 * Design Lead's leave board; the leave behaviour is not built. The row stays off
 * until the flow ships, behind EXPO_PUBLIC_LEAVE_LEAGUE=1. Pure: the caller passes
 * the flag value in, so the rule is testable without process.env.
 */
export function leaveLeagueEnabled(flag: string | undefined): boolean {
  return flag === '1';
}
