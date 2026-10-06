import { TeamSoFarGrid } from '@/components/home/TeamSoFarGrid';
import { Text } from '@/components/sp/Text';

// 3c-2, UX rule 11: the SEAM for the draft's ending, inside the room. The
// Design Lead is drawing it (your roster + "Week 1 starts Mon {date} 9:30 AM
// ET"); when it lands, this component is the one place to build it (a
// weekOneStartsAt prop from the season's first week). Until then it shows your
// full roster (the same grid as Home) and the existing "Finishing the draft…"
// line, and no new copy. The legacy (tabs)/draft hand-off for the finalize heal
// stays as is (DraftRoom): it is deliberately not polished.

export interface DraftCompleteProps {
  /** Your drafted symbols, in pick order. */
  symbols: readonly string[];
  numRounds: number;
}

export const FINISHING_THE_DRAFT = 'Finishing the draft…'; // existing copy

export function DraftComplete({ symbols, numRounds }: DraftCompleteProps) {
  return (
    <>
      <TeamSoFarGrid symbols={symbols} numRounds={numRounds} />
      <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
        {FINISHING_THE_DRAFT}
      </Text>
    </>
  );
}
