import { Redirect } from 'expo-router';

/**
 * The legacy draft screen is retired (UX final sweep S-2, "every screen on the new
 * UI"). Its last job, the finalize heal, now runs inside the new draft room
 * (components/game/DraftRoom.tsx, Draft complete's "Finishing the draft…" with Try
 * again), and its manual Start path went with it (the server starts drafts:
 * #133). The route stays only so a stale link (fantasystockapp://draft, an old
 * push) lands somewhere real: the League tab, which shows the lobby or the room
 * by phase.
 */
export default function LegacyDraftRoute() {
  return <Redirect href="/(tabs)/league" />;
}
