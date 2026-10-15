import { CAPTURE } from '@/lib/shell/captureDev';
import { inviteFixture } from './inviteFixture';
import { usePendingInvite, type PendingInvite } from './usePendingInvite';

// The invite the signed-out arrival shows: W3's pending invite, or (DEV captures only) the fixture
// EXPO_PUBLIC_INVITE_FIXTURE names. The one place the app root and the arrival screen both ask.
const FIXTURE: PendingInvite | null = CAPTURE.invite ? inviteFixture(CAPTURE.invite) : null;

export function useArrivalInvite(): PendingInvite | null {
  const pending = usePendingInvite();
  return FIXTURE ?? pending;
}
