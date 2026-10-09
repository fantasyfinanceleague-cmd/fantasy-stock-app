/**
 * expo-audio (3c-2, the your-turn chime) is a playback-only dependency. Its config
 * plugin adds a microphone usage string (iOS) and RECORD_AUDIO (Android) unless told
 * not to; we never record, so both stay off (an unused mic string is an App Review
 * question we don't need to answer).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import app from '../app.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };

Deno.test('expo-audio is on the SDK 54 line and its plugin asks for no microphone', () => {
  assertEquals((pkg.dependencies as Record<string, string>)['expo-audio'], '~1.1.1');
  const plugins = app.expo.plugins as unknown[];
  const entry = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === 'expo-audio');
  assertEquals(entry, ['expo-audio', { microphonePermission: false, recordAudioAndroid: false }]);
  assertEquals(JSON.stringify(app).includes('NSMicrophoneUsageDescription'), false);
});
