import { InviteArrival } from '@/components/shell/InviteArrival';
import { useArrivalInvite } from '@/lib/invite/useArrivalInvite';

// Onboarding W4 — the signed-out arrival from an invite link. Mounted only while an invite is
// pending (app/_layout.tsx guards it on useArrivalInvite), so `invite` is non-null here; the guard
// dropping it (the invite cleared) leaves the navigator on the next signed-out screen.
export default function InviteScreen() {
  const invite = useArrivalInvite();
  return invite ? <InviteArrival invite={invite} /> : null;
}
