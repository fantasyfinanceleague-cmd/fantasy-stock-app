/**
 * Moved to lib/time/marketWeek.ts (Phase 3c: Home and Matchup both read
 * it, and lib/weekStatus.ts needs it for U1). This re-export keeps any
 * in-flight branch's old import path compiling; new code imports from
 * lib/time/marketWeek directly. Delete once no importer remains.
 */
export * from '../time/marketWeek';
