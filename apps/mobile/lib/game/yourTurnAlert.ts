import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { CHIME_AUDIO_MODE } from './yourTurn';
import { claimYourTurn } from './yourTurnPush';

// The your-turn chime (3c-2): our own file, made by scripts/gen-turn-chime.mjs
// (0.42 s; tests-deno/turn-chime.test.ts checks it byte for byte). Never a downloaded sound.
const YOUR_TURN_CHIME = require('../../assets/sounds/your-turn.wav');

// App-wide, not per screen: the foreground push handler and the draft room share
// these, so a turn both paths see buzzes and chimes once (lib/game/yourTurnPush.ts).
const claimed = new Set<string>();
let player: AudioPlayer | null = null;
let audioMode: Promise<void> | null = null;

function playChime(): void {
  try {
    player ??= createAudioPlayer(YOUR_TURN_CHIME);
    const p = player;
    audioMode ??= setAudioModeAsync(CHIME_AUDIO_MODE).catch(() => {});
    // A player that has finished stays at its end: rewind, then play.
    void audioMode
      .then(() => p.seekTo(0))
      .catch(() => {})
      .finally(() => {
        try {
          p.play();
          // DEV only: the chime's evidence in the Metro log (a simulator recording has no audio).
          if (__DEV__) setTimeout(() => console.info(`[your-turn] chime ${p.playing ? 'playing' : 'NOT playing'} (${p.duration.toFixed(2)} s file)`), 120);
        } catch {
          // no player: nothing to play (the haptic and the banner or card still say it)
        }
      });
  } catch {
    // no player: nothing to play
  }
}

/** Your turn's one buzz (Warning haptic) + chime, once per turn app-wide. `key` is
 * yourTurnKey(league, pick). Returns whether this call alerted (false: already did). */
export function alertYourTurn(key: string): boolean {
  if (!claimYourTurn(claimed, key)) return false;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  playChime();
  return true;
}
