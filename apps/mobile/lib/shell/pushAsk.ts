// Onboarding W4 — the stored half of the notifications ask (policy: lib/shell/pushAskPolicy.ts).
// AsyncStorage holds what the person did the one time we asked; expo-notifications says what the OS
// permission is. A read that fails is reported as 'declined' / 'unavailable': never ask because
// storage or the OS call failed.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

import { CAPTURE } from './captureDev';
import { pushAskDestination, pushAskRoute, type OsPush, type PushAskDestination, type PushAskRecord } from './pushAskPolicy';

const KEY = 'sp.push.ask.v1';

export async function readPushAskRecord(): Promise<PushAskRecord> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'continued' || v === 'declined' ? v : null;
  } catch {
    return 'declined';
  }
}

export async function writePushAskRecord(value: 'continued' | 'declined'): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value);
  } catch {
    // Best effort: the worst case is one more ask on this device.
  }
}

export async function readOsPush(): Promise<OsPush> {
  // DEV capture only (lib/shell/captureKnobs.ts): a simulator has no push token, so the ask is
  // reachable in the sim only under this knob.
  if (CAPTURE.pushAsk) return 'undetermined';
  if (!Device.isDevice) return 'unavailable';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

/**
 * Where to go after a league was joined or created: the ask in front of `next` when it is due,
 * else `next` itself. Never throws, so a failure here can never strand the person on the ending.
 */
export async function pushAskRouteFor(next: PushAskDestination): Promise<string> {
  try {
    const [record, os] = await Promise.all([readPushAskRecord(), readOsPush()]);
    return pushAskRoute(record, os, next) ?? next;
  } catch {
    return next;
  }
}

export { pushAskDestination };
