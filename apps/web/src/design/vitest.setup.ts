import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

// findBy*/waitFor wait up to 1s by default. The onboarding flow tests chain several awaited (mocked) calls per
// screen; under machine load that was occasionally just over a second. A longer WAIT does not slow a passing test
// (it returns the moment the element appears) and does not hide a real failure (it still fails, a few seconds later).
configure({ asyncUtilTimeout: 4000 });
