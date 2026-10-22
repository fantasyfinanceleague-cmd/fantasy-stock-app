import { useTheme } from '@/components/sp/ThemeProvider';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import { isDeletedSeatName } from '@/lib/account/deletedSeat';

/**
 * Account deletion (W4, Giorgio's board pick): a deleted manager's seat reads in the SECONDARY text colour, so the
 * placeholder looks like a placeholder, not a person. Returns that colour for the seat's name, `undefined` (the Text's
 * own ink) for everyone else. Pass the result as a Text's `color`.
 */
export function useSeatInk(name: string | null | undefined): string | undefined {
  const { colors } = useTheme();
  const label = useDeletedManagerLabel();
  return isDeletedSeatName(name, label) ? colors.text2 : undefined;
}
