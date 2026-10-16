/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { Sheet, SheetBody } from '@/components/sp/Sheet';
import { RenewalAskBody, type RenewalAnswer } from './RenewalAsk';

export interface RenewalChangeSheetProps {
  visible: boolean;
  leagueId: string;
  /** The commissioner's real name (from the roster), for the ask's question. */
  commissionerName: string;
  /** The caller's answer today: it opens selected. */
  current: RenewalAnswer;
  onClose: () => void;
  /** A new answer was saved: the caller re-reads the roster. */
  onChanged: () => void;
}

/** GS-10 (board RibMemberList, "Change"): the ask itself, verbatim (Design Lead, 2026-10-11:
 * the board draws no separate sheet; the ask's copy is the design), with the current answer
 * selected, on the same respond_to_renewal. The same answer again writes nothing and closes.
 * A refusal shows in place under the choice, and is gone on the next opening. */
export function RenewalChangeSheet({ visible, leagueId, commissionerName, current, onClose, onChanged }: RenewalChangeSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {/* Keyed on visible: it stays drawn while the sheet slides away, and mounts fresh on the next opening. */}
      <RenewalAskBody
        key={visible ? 'open' : 'closed'}
        leagueId={leagueId}
        commissionerName={commissionerName}
        answered={current}
        onSaved={() => onChanged()}
        onSame={onClose}
        // The question scrolls; the choice (with a refusal) and the note are pinned under it.
        layout={({ body, footer }) => (
          <SheetBody contentContainerStyle={styles.scrollContent} footerStyle={styles.footer} footer={footer}>
            <View style={styles.stack}>
              <View style={styles.head}>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} hitSlop={8}>
                  <Icon name="close" size="headline" tone="text2" />
                </Pressable>
              </View>
              {body}
            </View>
          </SheetBody>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Scroll body + pinned footer (SheetBody): the scroll's bottom padding stands in for the gap above
  // the footer, the footer carries the bottom padding, so at Large the sheet is what it was.
  scrollContent: {
    paddingHorizontal: space[6],
    paddingBottom: space[2],
  },
  stack: {
    gap: space[2],
  },
  footer: {
    gap: space[2],
    paddingHorizontal: space[6],
    paddingBottom: space[4],
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: -space[4],
  },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
