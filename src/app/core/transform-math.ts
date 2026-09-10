import { Transform } from './models';

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

export function toSvgTransform(t: Transform): string {
  const deg = t.r * RAD2DEG;
  const parts: string[] = [`translate(${t.x} ${t.y})`];
  if (deg !== 0) parts.push(`rotate(${deg})`);
  if (t.sx !== 1 || t.sy !== 1) parts.push(`scale(${t.sx} ${t.sy})`);
  if (t.px !== 0 || t.py !== 0) parts.push(`translate(${t.px} ${t.py})`);
  return parts.join(' ');
}

export interface Mat3 {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_MAT3: Mat3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function R(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function toMatrix(t: Transform): Mat3 {
  const c = Math.cos(t.r);
  const s = Math.sin(t.r);
  return {
    a: c * t.sx,
    b: s * t.sx,
    c: -s * t.sy,
    d: c * t.sy,
    e: t.x + c * t.sx * t.px - s * t.sy * t.py,
    f: t.y + s * t.sx * t.px + c * t.sy * t.py
  };
}

export function multiplyMat(m1: Mat3, m2: Mat3): Mat3 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
}

/**
 * Decompose an affine matrix into the canonical transform form
 * translate(e f) rotate(r) scale(sx sy), with the pivot absorbed (px=py=0).
 * This is the representation produced by compositing transforms (ungroup).
 */
export function decomposeMat(m: Mat3): Transform {
  const det = m.a * m.d - m.b * m.c;
  const sx = Math.hypot(m.a, m.b);
  const syAbs = Math.hypot(m.c, m.d);
  const sy = det < 0 ? -syAbs : syAbs;
  const r = Math.atan2(m.b, m.a);
  return { x: R(m.e), y: R(m.f), sx: R(sx), sy: R(sy), r: R(r), px: 0, py: 0 };
}

export function composeTransforms(outer: Transform, inner: Transform): Transform {
  return decomposeMat(multiplyMat(toMatrix(outer), toMatrix(inner)));
}

export function applyMatrixPoint(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}
