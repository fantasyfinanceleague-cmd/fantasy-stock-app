/**
 * The capture seam, wired to the app's globals (3c). `SEAM_ON` is the dev build AND
 * EXPO_PUBLIC_GAME_SEAM='1'. Production never sees a fixture response. The gate
 * itself lives in devSeamGate.ts, where it is tested.
 */
import { seamActive } from './devSeamGate';

export const SEAM_ON: boolean = seamActive(typeof __DEV__ !== 'undefined' ? __DEV__ : false, process.env.EXPO_PUBLIC_GAME_SEAM);
