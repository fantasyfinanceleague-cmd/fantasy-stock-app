// motion.spring.lively (DESIGN_DIRECTION.md §4/§9): "Game surfaces only:
// tug-of-war lead change, score slam (B); unused in A". Deliberately NOT
// exported from ../tokens.ts — importing this module IS the enforcement
// that keeps a money-surface component from reaching for the overshoot
// spring by accident. Only components under src/design/game/** should ever
// import from here.
export const spring = {
  lively: { damping: 14, stiffness: 220, mass: 1 },
};
