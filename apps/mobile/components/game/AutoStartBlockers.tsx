import { DraftBlockersCard } from '@/components/game/DraftBlockersCard';
import { DraftDateSheet } from '@/components/game/DraftDateSheet';
import type { useDraftAutoStart } from '@/lib/game/useDraftAutoStart';

// 3c-2 — the commissioner's blockers card bound to useDraftAutoStart, with the
// postponed draft's new-time sheet. The League tab's lobby and Home both render
// this, so the fixes behave the same in both places.

export interface AutoStartBlockersProps {
  auto: ReturnType<typeof useDraftAutoStart>;
  phase: 'risk' | 'postponed';
  playoffTeams: number | null;
  inviteCode: string | null;
}

export function AutoStartBlockers({ auto, phase, playoffTeams, inviteCode }: AutoStartBlockersProps) {
  const f = auto.fixes;
  return (
    <>
      <DraftBlockersCard
        phase={phase}
        deadlineLabel={phase === 'risk' ? auto.roomLabel : auto.postponedLabel}
        blockers={auto.fixable}
        memberCount={auto.ds.memberCount}
        playoffTeams={playoffTeams}
        onSetPlayoffTeams={(t) => void f.setPlayoffTeams(t)}
        onReconfirm={(c) => void f.reconfirm(c)}
        inviteCode={inviteCode}
        onShareInvite={f.shareInvite}
        onPickNewTime={f.openPicker}
        busy={f.busy}
        error={f.fixError}
      />
      <DraftDateSheet
        visible={f.pickingTime}
        initial={null}
        onConfirm={(d) => void f.saveDraftTime(d)}
        onClose={f.closePicker}
      />
    </>
  );
}
