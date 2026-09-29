// The FULL tier's lazy chunk (round 4). Everything WebGL — three, fiber,
// drei and the scenes — lives behind this module, which FullSlot imports
// only after first paint, only when the capability gate says FULL.
import HeroScene from './HeroScene';
import InsideScene from './InsideScene';

export const scenes = {
  hero: HeroScene,
  inside: InsideScene,
};
