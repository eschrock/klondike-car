/** Column-major 4x4 helpers on plain number[] (same layout as three.js Matrix4.elements). No dependencies. */
import type { Mat4, Vec3 } from './types';

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function rotationX(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function rotationY(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function rotationZ(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a · b (apply b first, then a). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Translate by `pos` after rotating by Rz(rz)·Ry(ry)·Rx(rx) (radians). */
export function compose(pos: Vec3, rot: { x?: number; y?: number; z?: number } = {}): Mat4 {
  let r = identity();
  if (rot.z) r = multiply(r, rotationZ(rot.z));
  if (rot.y) r = multiply(r, rotationY(rot.y));
  if (rot.x) r = multiply(r, rotationX(rot.x));
  return multiply(translation(pos[0], pos[1], pos[2]), r);
}

export function translationOf(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}
