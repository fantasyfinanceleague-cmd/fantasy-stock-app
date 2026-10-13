// Stockpile — the Game Night primitives (DESIGN_DIRECTION §9C, W3, 2026-10-12). New
// components that change SHAPE from their §9A predecessors live here, beside the old ones,
// so W4 can move each screen over on its own gate. The ones that only changed values were
// updated in place: sp/Card (surface + rim), sp/PhaseChip (the §9C Chip), sp/Avatar
// (`tone`, `ring`), shell/ShellTabBar.
export { Scoreboard } from './Scoreboard';
export type { GnScoreboardProps } from './Scoreboard';
export { RosterRow, GroupHead } from './RosterRow';
export type { RosterHalf, RosterRowProps, GroupHeadProps } from './RosterRow';
export { rosterHalfLabel } from './RosterRow';
export { DraftTile } from './DraftTile';
export { CategoryPill } from './CategoryPill';
export type { DraftTileProps } from './DraftTile';
export { ManagerRow, MANAGER_ROW_GAP } from './ManagerRow';
export type { ManagerRowProps } from './ManagerRow';
export { RangePills } from './RangePills';
export type { RangePillsProps } from './RangePills';
export { Chart } from './Chart';
export type { ChartProps, UnderRow } from './Chart';
export { PlayerCard, PlayerCardBody } from './PlayerCard';
export type { PlayerCardProps, PlayerCardOwnership, PlayerCardOwnerInfo } from './PlayerCard';
