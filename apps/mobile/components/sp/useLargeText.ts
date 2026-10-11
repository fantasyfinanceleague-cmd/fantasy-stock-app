import { useWindowDimensions } from 'react-native';
import { isLargeText } from './logic/largeText';

/** True at the large text sizes, where side-by-side columns and one-line rows stack
 * (see logic/largeText.ts). Re-renders when the system text size changes. */
export function useLargeText(): boolean {
  const { fontScale } = useWindowDimensions();
  return isLargeText(fontScale);
}
