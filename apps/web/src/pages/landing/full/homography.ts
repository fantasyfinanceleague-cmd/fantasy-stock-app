// The CSS matrix3d that maps a w × h element (origin 0 0) onto an arbitrary
// quad — a 2D projective transform (homography). Unlike a CSS 3D camera
// (perspective + preserve-3d, which drei's <Html transform> relies on), it
// needs no 3D rendering context, so every engine draws it identically; iOS
// WebKit put drei's screens ~30px off the GL device.
// Corners in order: top-left, top-right, bottom-right, bottom-left.
// Heckbert, "Fundamentals of Texture Mapping and Image Warping" (1989).

export type Quad = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

export function homographyMatrix3d(w: number, h: number, q: Quad): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, k: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0;
    b = x2 - x1;
    d = y1 - y0;
    e = y2 - y1;
    g = 0;
    k = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + k * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + k * y3;
  }
  const c = x0;
  const f = y0;
  // Unit square → quad, composed with (x, y) → (x / w, y / h).
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(8)).join(',')})`;
}

/** Applies the homography to a point — for tests. */
export function applyHomography(w: number, h: number, q: Quad, x: number, y: number): [number, number] {
  const m = homographyMatrix3d(w, h, q)
    .slice(9, -1)
    .split(',')
    .map(Number);
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}
