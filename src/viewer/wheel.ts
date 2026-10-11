import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Geometry } from '../model/types';

type WheelGeo = Extract<Geometry, { type: 'wheel' }>;

/**
 * Wheel (D-44): rounded-sidewall tire with a lugged (herringbone) or ribbed tread, a dished charcoal rim, a hub barrel and
 * brass hub caps, like the concept art. Axle along local Y. The outer bounds match `localBounds`: tread / lug tips reach
 * the diameter, the sidewall reaches half the tire width, the hub barrel reaches max(width, hubLength) / 2.
 *
 * Merged into one geometry with groups in this order, so the caller supplies five materials:
 * 0 tire, 1 lugs (both rubber), 2 rim, 3 hub barrel, 4 hub caps.
 */
export function buildWheelGeometry(g: WheelGeo, tread: 'lug' | 'rib' = 'lug', lugCount = 26): THREE.BufferGeometry {
  const R = g.diameter / 2;
  const hw = g.width / 2;
  const hubR = Math.min(g.hubDiameter / 2, R * 0.45);
  const hubHalf = Math.max(g.width, g.hubLength) / 2;
  const rimR = Math.min(Math.max(hubR * 1.35, R * 0.56), R * 0.78);
  const lugH = tread === 'lug' ? Math.min(0.38, R * 0.06) : 0;
  const Rt = R - lugH;
  const s = Math.min(hw, Rt - rimR) * 0.4; // shoulder radius

  const v2 = (r: number, y: number): THREE.Vector2 => new THREE.Vector2(r, y);

  // Tire cross-section (r, y), lower sidewall -> shoulder -> tread -> upper sidewall -> bead, mirrored about y = 0.
  const half: THREE.Vector2[] = [];
  const SW = 8;
  for (let i = 0; i <= SW; i++) {
    const t = i / SW;
    half.push(v2(rimR + (Rt - s - rimR) * t, -hw * (0.8 + 0.2 * Math.pow(Math.sin((t * Math.PI) / 2), 0.7))));
  }
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    half.push(v2(Rt - s + s * Math.sin(a), -hw + s - s * Math.cos(a)));
  }
  if (tread === 'rib') {
    // Three circumferential grooves in the crown.
    const w = hw - s;
    for (const c of [-0.5, 0, 0.5]) {
      const y0 = c * w;
      const gw = w * 0.07;
      half.push(v2(Rt, y0 - gw * 2), v2(Rt - 0.14, y0 - gw), v2(Rt - 0.14, y0 + gw), v2(Rt, y0 + gw * 2));
    }
  }
  const profile: THREE.Vector2[] = [...half];
  for (let i = half.length - 1; i >= 0; i--) {
    // Mirror (skip points already on the centerline).
    const p = half[i];
    if (p.y < -1e-6) profile.push(v2(p.x, -p.y));
  }
  profile.push(v2(rimR, hw * 0.8), v2(rimR, -hw * 0.8));
  const tire = new THREE.LatheGeometry(profile, 56);

  // Lugs: two rows of chevron blocks, built with the axle along Z, then turned onto Y.
  const lugs: THREE.BufferGeometry[] = [];
  if (lugH > 0) {
    const pitch = (2 * Math.PI * Rt) / lugCount;
    const rowW = (hw - s * 0.7) * 0.92;
    const base = new THREE.BoxGeometry(pitch * 0.4, lugH + 0.08, rowW * 0.62);
    for (let row = 0; row < 2; row++) {
      const side = row === 0 ? 1 : -1;
      for (let i = 0; i < lugCount; i++) {
        const m = new THREE.Matrix4()
          .makeRotationZ((i + (row ? 0.5 : 0)) * ((2 * Math.PI) / lugCount))
          .multiply(new THREE.Matrix4().makeTranslation(0, Rt + lugH / 2 - 0.12, side * rowW * 0.5))
          .multiply(new THREE.Matrix4().makeRotationY(side * 0.62));
        lugs.push(base.clone().applyMatrix4(m));
      }
    }
    base.dispose();
  }
  const lugGeo = lugs.length ? mergeGeometries(lugs) : emptyGeo();
  lugs.forEach((l) => l.dispose());
  lugGeo.rotateX(Math.PI / 2); // axle Z -> Y

  // Dished rim.
  const rimPts = [
    v2(hubR * 0.8, -hw * 0.5), v2(rimR * 0.82, -hw * 0.5), v2(rimR - 0.1, -hw * 0.74), v2(rimR + 0.06, -hw * 0.8),
    v2(rimR + 0.06, hw * 0.8), v2(rimR - 0.1, hw * 0.74), v2(rimR * 0.82, hw * 0.5), v2(hubR * 0.8, hw * 0.5),
  ];
  const rim = new THREE.LatheGeometry(rimPts, 40);

  // Hub barrel (steel) and brass caps at both ends.
  const barrelR = hubR * 0.5;
  const capLen = Math.min(0.5, hubHalf * 0.25);
  const barrel = new THREE.LatheGeometry([v2(0.01, -hubHalf + capLen * 0.2), v2(barrelR, -hubHalf + capLen * 0.2), v2(barrelR, hubHalf - capLen * 0.2), v2(0.01, hubHalf - capLen * 0.2)], 28);
  const capPts = (sgn: number): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      out.push(v2(barrelR * 0.78 * Math.cos(a) + 0.01, sgn * (hubHalf - capLen + capLen * Math.sin(a))));
    }
    return out;
  };
  const capA = new THREE.LatheGeometry(capPts(-1), 28);
  const capB = new THREE.LatheGeometry(capPts(1), 28);
  const caps = mergeGeometries([capA, capB])!;

  const merged = mergeGeometries([tire, lugGeo, rim, barrel, caps], true)!;
  [tire, lugGeo, rim, barrel, capA, capB, caps].forEach((x) => x.dispose());
  return merged;
}

function emptyGeo(): THREE.BufferGeometry {
  // A degenerate single triangle keeps the merged group indices aligned when a tire has no lugs.
  const e = new THREE.BufferGeometry();
  e.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  e.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  e.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  e.setIndex([0, 1, 2]);
  return e;
}
