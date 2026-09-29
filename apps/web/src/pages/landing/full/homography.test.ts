import { describe, expect, it } from 'vitest';
import { applyHomography, type Quad } from './homography';

describe('homographyMatrix3d', () => {
  const cases: Array<[string, Quad]> = [
    ['identity-ish', [[10, 20], [290, 20], [290, 600], [10, 600]]],
    ['a turned screen (perspective quad)', [[100, 40], [300, 70], [295, 520], [105, 560]]],
    ['a shear', [[0, 0], [280, 30], [300, 610], [20, 580]]],
  ];
  it.each(cases)('maps the element corners onto the quad: %s', (_, q) => {
    const corners: Array<[number, number]> = [[0, 0], [280, 0], [280, 580], [0, 580]];
    corners.forEach(([x, y], i) => {
      const [X, Y] = applyHomography(280, 580, q, x, y);
      expect(X).toBeCloseTo(q[i][0], 2);
      expect(Y).toBeCloseTo(q[i][1], 2);
    });
  });
});
