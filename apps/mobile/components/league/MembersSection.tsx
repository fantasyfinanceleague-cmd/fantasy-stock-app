/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useSeatInk } from '@/components/sp/useSeatInk';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { RowDivider, SetupCard } from '@/components/game/SetupRows';
import { FIND_NEW_MANAGER } from '@/lib/account/deleteCopy';
import type { MemberRowModel } from '@/lib/account/findManager';
import { COMMISSIONER_ROW } from '@/lib/game/leaveLeague';
import { JOIN_COPY } from '@/lib/join/joinPreview';

// Account deletion (W4) — League settings › "Members · N" after the draft (board "Decided": the Members pill).
// Each manager is a row: avatar, name, a "Commissioner" tag on the commissioner. A deleted manager's seat reads
// "Former manager" in the secondary ink over the default avatar (Avatar and useSeatInk own both), and the COMMISSIONER
// alone sees the "Find a new manager" pill on it. Everyone else's rows are the same shape; the pill is the only difference.

/** The row's text caps at 2× (as Profile's rows do) so a name never outgrows the screen's title. */
const ROW_MAX_SCALE = 2;

export function MembersSection({ rows, findable, busyId, failed, onFind }: {
  rows: MemberRowModel[];
  /** Whether the viewer may find a new manager for a deleted seat right now (lib/account/findManager.ts canFindNewManager). */
  findable: boolean;
  busyId: string | null;
  failed: boolean;
  onFind: (seatUserId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text variant="caption" tone="secondary" accessibilityRole="header" style={styles.tag}>
        {`Members · ${rows.length}`}
      </Text>
      <SetupCard>
        {rows.map((r, i) => (
          <View key={r.userId}>
            {i > 0 ? <RowDivider /> : null}
            <MemberRow row={r} showFind={findable && r.deleted} busy={busyId === r.userId} onFind={() => onFind(r.userId)} />
          </View>
        ))}
      </SetupCard>
      {failed ? <WarnPanel text={JOIN_COPY.unreachable} /> : null}
    </View>
  );
}

function MemberRow({ row, showFind, busy, onFind }: { row: MemberRowModel; showFind: boolean; busy: boolean; onFind: () => void }) {
  const seatInk = useSeatInk(row.name);
  return (
    <View style={styles.row} accessible={!showFind} accessibilityLabel={`${row.name}${row.isCommissioner ? `, ${COMMISSIONER_ROW}` : ''}`}>
      <Avatar name={row.name} size={32} tone={row.isYou ? 'you' : 'neutral'} />
      <Text variant="body" maxFontSizeMultiplier={ROW_MAX_SCALE} color={seatInk} style={[styles.name, row.isYou ? styles.you : null]}>
        {row.name}
      </Text>
      {row.isCommissioner ? (
        <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_MAX_SCALE}>
          {COMMISSIONER_ROW}
        </Text>
      ) : null}
      {showFind ? <Button label={FIND_NEW_MANAGER} variant="secondary" size="sm" status={busy ? 'loading' : 'idle'} onPress={onFind} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  tag: {
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space[4],
    rowGap: space[3],
    minHeight: 52,
    paddingVertical: space[3],
  },
  name: {
    flex: 1,
    minWidth: 120,
  },
  you: {
    fontWeight: '800',
  },
});
