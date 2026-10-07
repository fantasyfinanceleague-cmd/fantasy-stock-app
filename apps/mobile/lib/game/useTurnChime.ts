import { useCallback, useEffect } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { CHIME_AUDIO_MODE } from './yourTurn';

// The your-turn chime (3c-2): our own file, made by scripts/gen-turn-chime.mjs
// (0.42 s; tests-deno/turn-chime.test.ts checks it byte for byte). Never a downloaded sound.
const YOUR_TURN_CHIME = require('../../assets/sounds/your-turn.wav');

/** Returns `play`: the chime from the top. A failure is silent (the haptic and the card still say it). */
export function useTurnChime(): () => void {
  const player = useAudioPlayer(YOUR_TURN_CHIME);
  useEffect(() => {
    setAudioModeAsync(CHIME_AUDIO_MODE).catch(() => {});
  }, []);
  return useCallback(() => {
    try {
      // A player that has finished stays at its end: rewind, then play.
      player.seekTo(0).catch(() => {}).finally(() => {
        try {
          player.play();
        } catch {
          // released (the room unmounted): nothing to play
        }
      });
    } catch {
      // released: nothing to play
    }
  }, [player]);
}
