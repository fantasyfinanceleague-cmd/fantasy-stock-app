// The FULL tier's lazy chunk (round 4). Everything WebGL — three, fiber,
// drei and the scenes — lives behind this module, which FullSlot imports
// only after first paint, only when the capability gate says FULL.
import HeroScene from './HeroScene';
import InsideScene from './InsideScene';
import ChapterScene from './ChapterScene';
import LeaguesScene from './LeaguesScene';
import CtaScene from './CtaScene';

export const scenes = {
  hero: HeroScene,
  inside: InsideScene,
  chapter: ChapterScene,
  leagues: LeaguesScene,
  cta: CtaScene,
};
