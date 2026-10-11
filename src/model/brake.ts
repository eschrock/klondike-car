/**
 * The handler's rear brake (Phase 3c-1, D-53): a basic "just in case" wagon brake, simplified from the D-38/D-48 cross-shaft mechanism. Bolted only, no welding.
 *
 *   hand lever (6061-T6 flat bar, standing behind the rear transom on a pivot bracket) ── short link (two flat bars) ── brake BEAM (6061-T6 square tube across the
 *   tail, behind the rear tires) ── a lined steel-backed shoe at each end facing the rear of the tread.
 *
 * Pulling the grip back pivots the lever; its tail pushes the link forward, which pushes the beam forward into both tires at once (the beam is a rigid bar, so the two
 * shoes see equal force). A spring on the lever returns it. The beam slides fore-aft in a notch in each cabin rail (the notches are its guides, `frame.ts`) and rests on a
 * keeper strap under each notch. The parking hold is a hitch pin through the lever and one of a row of holes in the pivot ear (a quadrant concentric with the pivot).
 *
 * `brakeGeometry` is the single source for the kinematics (lever ratio, stroke, grip travel) in the vertical x-z plane; both the part builder and the analysis
 * (`analysis/brake.ts`) read it. Pose s = 0 is released, s = 1 is applied (shoes on the tread). The shoes sit on the rear of the tread a few degrees below the axle line
 * (`brake-layout.ts`), so the normal force is nearly horizontal and the friction nearly vertical. Plain TS (no three.js).
 */
import { FRAME_STYLE, type Params } from '../params';
import { STEP, box, cylinder, segment, span, SIDES, IN3_PER_FT3, unitDir, type Ctx } from './build-utils';
import { CLEVIS_HALF_IN, beamLayout, type BeamLayout } from './brake-layout';
import type { Layout } from './layout';
import { multiply, rotationX, translation } from './mat4';
import { boltLength, inchesText, railSection } from './rear-mount';
import { buildHandle } from './handle';
import type { Joint, Part, Vec2, Vec3 } from './types';

const RAD = Math.PI / 180;
/** Running gap between stacked flat parts (in): a tolerance, not a design number. */
const STACK_GAP_IN = 0.0625;
/** Brake lining density (woven / molded sheet, about 120 lb/ft³): a placeholder for a purchased item. */
const LINING_LB_PER_IN3 = 0.07;
const STEEL_LB_PER_IN3 = 0.2836;
const RETURN_SPRING_MASS_LB = 0.1;
const GRIP_RADIUS_IN = 0.5;
const GRIP_LENGTH_IN = 6;
/** Number of parking holes before / after the design hole, and the ear plate's width around the arc. */
const PARK_HOLES_BEFORE = 1;
const PARK_HOLES_AFTER = 3;
const PARK_BAND_IN = 0.55;
const STEEL_FINISH = 'Finish: zinc-plated or painted steel; stainless fasteners; epoxy barrier coat where steel or aluminum touches wet tannin-rich oak (BRIEF §5.2).';
const YARD = (what: string): Part['sourcing'] => ({ vendor: `Local steel yard or Metals Depot / McMaster-Carr (${what})` });
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

// ── 2D helpers on (x, z) ──
export type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const norm = (a: V2) => Math.hypot(a[0], a[1]);
/** Rotate `p` counter-clockwise (seen with +x right, +z up) by `th` about `c`. */
export function rot2(p: V2, c: V2, th: number): V2 {
  const x = p[0] - c[0], z = p[1] - c[1];
  const co = Math.cos(th), si = Math.sin(th);
  return [c[0] + x * co - z * si, c[1] + x * si + z * co];
}

/** Lined shoe length along the tread (in): the purchased lined steel-backed shoe (D-56). */
export const shoeLengthIn = (p: Params): number => p.brakeLinedShoeLengthIn;
/** Lined shoe width across the tread (in). */
export const shoeWidthIn = (p: Params): number => p.brakeLinedShoeWidthIn;
/** Radial thickness of the lined shoe in inches (steel back + lining). */
export const linedShoeThickIn = (p: Params): number => p.brakeShoeBackThickIn + p.brakeLiningThickIn;

/** Positions across the cart (|y|, left side; mirror for the right). */
export interface BrakeY {
  /** Lever bar (centered on y = 0), link bars and pivot ears: |y| ranges. */
  lever: [number, number];
  link: [number, number];
  ear: [number, number];
  /** Shoe (lined face width) and the beam's half length. */
  pad: [number, number];
  beamHalf: number;
  /** Shoe center |y|. */
  shoeC: number;
}

export interface BrakeGeom {
  ok: boolean;
  why: string;
  /** Wheel radius and center (x, z). */
  r: number;
  O: V2;
  /** Beam, shoe angle, stroke and the rail notch (brake-layout.ts). */
  bl: BeamLayout;
  /** Half-angle of the shoe arc (rad). */
  shoeHalfAngle: number;
  // Lever and link, in the vertical x-z plane
  /** Lever pivot, tilt (rad from vertical, top leaning back), unit vector pivot to grip (released), tail length (pivot to link pin). */
  Q: V2;
  tilt: number;
  e: V2;
  tailIn: number;
  /** Link pin on the lever tail, released and applied; pin on the beam clevis, released and applied; pin to pin length. */
  T0: V2;
  T1: V2;
  B0: V2;
  B1: V2;
  linkLen: number;
  /** Lever rotation released to applied (rad, CCW = grip toward the rear). */
  thetaL: number;
  /** Lever bar: tail end and grip end (released) along e, and the grip center. */
  barTail: V2;
  barTop: V2;
  G0: V2;
  G1: V2;
  gripZ: number;
  /** Distance from the pivot to the link line (applied) and the link's forward direction cosine. */
  dQ: number;
  ux: number;
  /** Vertical distance pivot to grip at the applied pose (the hand's lever arm for a horizontal pull). */
  lGrip: number;
  /** The link carries compression under a hand pull (the lever tail pushes the beam). */
  linkTension: boolean;
  /** N_total / F_hand, hand force horizontal at the grip, no efficiency: cart rolling forward and backward. */
  ratioFwd: number;
  ratioRev: number;
  ratioCrit: number;
  critical: 'forward' | 'reverse';
  /** Horizontal grip travel released to applied (in). */
  gripTravelIn: number;
  /** Pivot bracket: base plate (x range of the plate, z range) and the quadrant hole radius / angles. */
  base: { x0: number; x1: number; z0: number; z1: number };
  park: { radius: number; angles: number[]; designIndex: number };
  y: BrakeY;
}

const solveLever = (T0: V2, B1: V2, Q: V2, linkLen: number): number | null => {
  // |rot(T0, Q, θ) − B1| = linkLen, smallest θ > 0 (grip toward the rear).
  const f = (th: number) => norm(sub(rot2(T0, Q, th), B1)) - linkLen;
  let a = 0, fa = f(0);
  const STEP_RAD = 0.002;
  for (let i = 1; i <= 400; i++) {
    const b = i * STEP_RAD, fb = f(b);
    if (fa === 0) return a;
    if (fa * fb <= 0) {
      let lo = a, hi = b;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (f(lo) * f(m) <= 0) hi = m; else lo = m;
      }
      return (lo + hi) / 2;
    }
    a = b; fa = fb;
  }
  return null;
};

export function railGeometry(p: Params, L: Layout) {
  const rail = railSection(p, L);
  return { rail, bl: beamLayout(p, L.r, rail.zBot, rail.xEnd) };
}

export function brakeGeometry(p: Params, L: Layout): BrakeGeom {
  const r = L.r;
  const O: V2 = [0, r];
  const { bl } = railGeometry(p, L);
  const mu = p.brakePadMu;
  const barT = p.brakeBarThickIn;
  const plateT = p.brakePlateThickIn;
  const pinD = p.brakeClevisPinDiameterIn;
  const lever = p.brakeLeverWidthIn;
  const tilt = p.brakeLeverTiltDeg * RAD;
  const e: V2 = [-Math.sin(tilt), Math.cos(tilt)];
  const tailIn = p.brakeLeverTailIn;

  // Pivot bracket base plate stands on the transom's rear face; the lever bar clears it by the standoff.
  const xPlate = L.xRear;
  const baseX1 = xPlate, baseX0 = xPlate - plateT;
  const Qx = baseX0 - p.brakeLeverStandoffIn - lever / 2;
  const Q: V2 = [Qx, bl.zB + tailIn * Math.cos(tilt)];
  const T0 = sub(Q, mul(e, tailIn));
  // The beam clevis tab sticks out of the beam's rear face far enough for a pin with an edge distance of 1.5 pin diameters.
  const earReach = 0.5 + 1.5 * pinD;
  const B0: V2 = [bl.xRear - earReach, bl.zB];
  const linkLen = norm(sub(B0, T0));
  const B1: V2 = [B0[0] + bl.stroke, B0[1]];
  const th = solveLever(T0, B1, Q, linkLen);
  const thetaL = th ?? 0;
  const T1 = rot2(T0, Q, thetaL);

  // Lever bar: from just below the tail pin up to the grip (the grip dowel sits on top of the bar).
  const gripZ = p.rearHandleHeightIn - p.brakeLeverGripBelowHandleIn;
  const up = Math.max(1, (gripZ - Q[1]) / Math.cos(tilt));
  const G0 = add(Q, mul(e, up));
  const G1 = rot2(G0, Q, thetaL);
  const barTail = sub(Q, mul(e, tailIn + 1.5 * pinD));
  const barTop = add(Q, mul(e, up - GRIP_RADIUS_IN));

  const u: V2 = linkLen > 1e-9 ? mul(sub(B1, T1), 1 / Math.max(1e-9, norm(sub(B1, T1)))) : [1, 0];
  const dQ = Math.abs(cross(sub(T1, Q), u));
  const lGrip = G1[1] - Q[1];
  // Hand pull back at the grip: CCW moment F·lGrip about the pivot; the link (pushing the tail rearward) balances it. The beam receives F_link along u.
  const crossTQ = cross(sub(T1, Q), u);
  const linkTension = Math.abs(crossTQ) > 1e-9 ? -lGrip / crossTQ > 0 : true;
  const beta = bl.beta;
  // Beam force F_c = F_link·u_x. Each shoe feels N along n = (−cos β, −sin β) plus friction μN along t = (−sin β, cos β)·σ (σ = +1 cart rolling forward: the rear
  // of the tread moves up and back). The x balance of the beam: F_c = Σ N (cos β + σ μ sin β).
  const safe = (sigma: number) => {
    const k = Math.cos(beta) + sigma * mu * Math.sin(beta);
    return k > 1e-6 && dQ > 1e-6 ? (lGrip / dQ) * u[0] / k : 0;
  };
  const ratioFwd = safe(1);
  const ratioRev = safe(-1);
  const critical: 'forward' | 'reverse' = ratioFwd < ratioRev ? 'forward' : 'reverse';

  // y positions
  const earY0 = barT / 2 + STACK_GAP_IN;
  const linkY0 = barT / 2 + STACK_GAP_IN;
  const ry = p.rearTrackIn / 2;
  const padW = Math.max(0.5, Math.min(shoeWidthIn(p), p.tireWidthIn - 0.3));
  const y: BrakeY = {
    lever: [0, barT / 2],
    link: [linkY0, linkY0 + barT],
    ear: [earY0, earY0 + plateT],
    pad: [ry - padW / 2, ry + padW / 2],
    beamHalf: ry + 1,
    shoeC: ry,
  };

  // Parking quadrant: holes at the applied angle and a few either side.
  const R = p.brakeParkRadiusIn;
  const step = p.brakeParkPitchIn / R;
  const angles: number[] = [];
  for (let k = -PARK_HOLES_BEFORE; k <= PARK_HOLES_AFTER; k++) angles.push(thetaL + k * step);
  // Base plate z range: from just below the pivot to a plate height above it (it stands on the transom's rear face, whose bottom edge is below this: brake-layout validator rule).
  const base = { x0: baseX0, x1: baseX1, z0: Q[1] - 0.45, z1: Q[1] + 1.6 };

  const why = th === null ? 'the link does not close: no lever angle reaches the applied beam position' : '';
  const ok = th !== null && ratioCrit0(ratioFwd, ratioRev) > 0;
  return {
    ok, why, r, O, bl, shoeHalfAngle: shoeLengthIn(p) / (2 * r), Q, tilt, e, tailIn, T0, T1, B0, B1, linkLen, thetaL, barTail, barTop, G0, G1, gripZ, dQ, ux: u[0], lGrip, linkTension,
    ratioFwd, ratioRev, ratioCrit: ratioCrit0(ratioFwd, ratioRev), critical, gripTravelIn: G0[0] - G1[0], base, park: { radius: R, angles, designIndex: PARK_HOLES_BEFORE }, y,
  };
}

const ratioCrit0 = (a: number, b: number) => Math.min(a, b);

/** Rigid pose of the linkage at s ∈ [0, 1] (0 released, 1 applied): the closing lever angle and the pin, grip and beam positions. */
export function brakePose(g: BrakeGeom, s: number): { thetaL: number; T: V2; B: V2; G: V2; dx: number } {
  const dx = s * g.bl.stroke;
  const B: V2 = [g.B0[0] + dx, g.B0[1]];
  const thetaL = s <= 0 ? 0 : s >= 1 ? g.thetaL : solveLever(g.T0, B, g.Q, g.linkLen) ?? 0;
  return { thetaL, T: rot2(g.T0, g.Q, thetaL), B, G: rot2(g.G0, g.Q, thetaL), dx };
}

// ── Part helpers ──
/** Part from a profile in the model x–z plane, extruded across y from `yHi` down to `yHi − depth` (profile origin at (ox, oz)). */
export function planarExtrusion(ctx: Ctx, s: {
  id: string; partNo?: string; name: string; mat: 'steel' | 'fixed'; outline: Vec2[]; origin: V2; yHi: number; depth: number;
  fab?: Part['fab']; joints?: Joint[]; notes?: string; explode?: Vec3; cg?: Vec3;
  kind?: Part['kind']; massLb?: number; material?: string; sourcing?: Part['sourcing']; removable?: boolean; group?: Part['group'];
}): Part {
  const { p } = ctx;
  let a = 0;
  for (let i = 0; i < s.outline.length; i++) {
    const [x1, y1] = s.outline[i], [x2, y2] = s.outline[(i + 1) % s.outline.length];
    a += x1 * y2 - x2 * y1;
  }
  const area = Math.abs(a) / 2;
  const vol = area * s.depth;
  const massLb = s.massLb !== undefined ? s.massLb : (vol / IN3_PER_FT3) * p.steelDensityPcf;
  const xs = s.outline.map((q) => q[0]), zs = s.outline.map((q) => q[1]);
  const part: Part = {
    id: s.id, name: s.name, group: s.group ?? 'brake', kind: s.kind ?? (s.mat === 'steel' ? 'metal' : 'purchased'),
    material: s.material ?? (s.mat === 'steel' ? 'A36 steel plate' : 'purchased'),
    geometry: { type: 'extrusion', outline: s.outline, depth: s.depth },
    // local (x, y, z) → model (x, yHi − z, oz + y): Rx(+90°) then translate.
    transform: multiply(translation(s.origin[0], s.yHi, s.origin[1]), rotationX(Math.PI / 2)),
    body: 'chassis', massLb, fab: s.fab ?? (s.mat === 'steel' ? 'outsource' : 'buy'), step: STEP.brake,
    explode: s.explode ?? [-1, 0, -0.3],
  };
  if (s.partNo) part.partNo = s.partNo;
  if (s.removable) part.removable = true;
  if (s.mat === 'steel') {
    const spans = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].sort((q, w) => q - w);
    part.stock = { t: s.depth, w: spans[0], l: spans[1] };
  }
  if (s.sourcing) part.sourcing = s.sourcing;
  if (s.joints) part.joints = s.joints;
  if (s.notes) part.notes = s.notes;
  if (s.cg) part.cgIn = s.cg;
  return part;
}

const disc = (c: V2, rad: number, n = 14): V2[] => Array.from({ length: n }, (_, i): V2 => [c[0] + rad * Math.cos((2 * Math.PI * i) / n), c[1] + rad * Math.sin((2 * Math.PI * i) / n)]);
function hull2(pts: V2[]): V2[] {
  const q = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [];
  for (const v of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  const hi: V2[] = [];
  for (const v of [...q].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], v) <= 0) hi.pop(); hi.push(v); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** Flat bar in the x–z plane from a to b: `thickY` across the cart, `widthPlane` in the plane, centered on y. */
function flatBar(ctx: Ctx, s: {
  id: string; partNo?: string; name: string; a: V2; b: V2; y: number; thickY: number; widthPlane: number; mat: 'steel' | 'fixed'; massLb?: number; material?: string; kind?: Part['kind'];
  fab?: Part['fab']; joints?: Joint[]; notes?: string; explode?: Vec3; sourcing?: Part['sourcing']; removable?: boolean; stock?: Part['stock'];
}): Part {
  const seg = segment([s.a[0], s.y, s.a[1]], [s.b[0], s.y, s.b[1]], s.thickY, s.widthPlane);
  return box(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: s.mat, massLb: s.massLb, material: s.material, kind: s.kind, step: STEP.brake, fab: s.fab, joints: s.joints,
    notes: s.notes, explode: s.explode, sourcing: s.sourcing, removable: s.removable, stock: s.stock, ...seg,
  });
}

/** Pin or rod along y. */
const pinY = (ctx: Ctx, s: { id: string; partNo?: string; name: string; c: V2; y0: number; y1: number; radius: number; massLb: number; material: string; fab?: Part['fab']; joints?: Joint[]; notes?: string; sourcing?: Part['sourcing']; removable?: boolean; explode?: Vec3 }): Part =>
  cylinder(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: 'fixed', kind: 'purchased', massLb: s.massLb, material: s.material, fab: s.fab ?? 'buy', step: STEP.brake,
    center: [s.c[0], (s.y0 + s.y1) / 2, s.c[1]], axis: 'y', radius: s.radius, length: Math.abs(s.y1 - s.y0), joints: s.joints, notes: s.notes, explode: s.explode, sourcing: s.sourcing, removable: s.removable,
  });

/** Aluminum flat bar mass (lb) for a section × length. */
const alLb = (p: Params, volIn3: number) => (volIn3 / IN3_PER_FT3) * p.aluminumDensityPcf;

/**
 * Brake parts at pose `s` (0 released, 1 applied; the model default is 0). `analysis/brake.ts` calls this at s = 0 … 1 to sweep the stroke.
 */
export function buildBrakeAt(ctx: Ctx, s: number, movingOnly = false): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const g = brakeGeometry(p, L);
  const pose = brakePose(g, s);
  const r = L.r;
  const { bl, y: Y } = g;
  const { rail } = railGeometry(p, L);
  const barT = p.brakeBarThickIn, barW = p.brakeBarWidthIn, plateT = p.brakePlateThickIn;
  const pinD = p.brakeClevisPinDiameterIn;
  const size = p.brakeBeamSizeIn, wall = p.brakeBeamWallIn;
  const ladder = p.frameStyle === FRAME_STYLE.ladder;
  const railId = (tag: 'L' | 'R') => (ladder ? `rail-cabin-${tag}` : `girder-cabin-${tag}`);
  const add1 = (x: Part | null) => { if (x) parts.push(x); };
  const fixed = (x: Part): Part | null => (movingOnly ? null : x);
  const yRange = (sgn: 1 | -1, a: number, b: number): [number, number] => (sgn > 0 ? [a, b] : [-b, -a]);
  const bolt = (to: string, count: number, diaIn: number, sz: string, note?: string): Joint => ({ type: 'bolt', to, count, diaIn, size: sz, ...(note ? { note } : {}) });
  const pinJoint = (to: string, sz: string): Joint => ({ type: 'pin', to, count: 1, diaIn: pinD, size: sz });

  // ── The beam (6061-T6 square tube) ──
  const beamLen = 2 * Y.beamHalf;
  const beamVol = (size * size - (size - 2 * wall) ** 2) * beamLen;
  add1(box(ctx, {
    id: 'brake-beam', name: 'Brake beam (aluminum square tube)', group: 'brake', mat: 'fixed', kind: 'metal', step: STEP.brake, fab: 'drill-tap', massLb: alLb(p, beamVol),
    material: `6061-T6 aluminum square tube ${f2(size)}" x ${f2(wall)}" wall`, stock: { t: wall, w: size, l: beamLen },
    center: [bl.xB + pose.dx, 0, bl.zB], size: [size, beamLen, size], explode: [-0.5, 0, -1],
    sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum square tube, ${f2(size)}" x ${f2(wall)}" wall, 4 ft length: the cut beam is ${f2(beamLen)}"; cut on the chop saw or bandsaw, drill the shoe holes and the clevis hole from the template)` },
    joints: [
      bolt('brake-shoe-L', 1, 0.25, `1/4-20 stainless bolt through the front wall into the left shoe's back plate, crush sleeve inside the tube`),
      bolt('brake-shoe-R', 1, 0.25, `1/4-20 stainless bolt through the front wall into the right shoe's back plate, crush sleeve inside the tube`),
      bolt('brake-clevis', 2, 0.25, `2 x 1/4-20 stainless bolts fore-aft through the tube (crush sleeves) holding the clevis foot on the rear wall`),
    ],
    notes: `Slides fore-aft ${f2(bl.stroke)}" in a ${f2(bl.notch.x1 - bl.notch.x0)}" wide notch in each cabin rail (open at the bottom; the notches are the guides) and rests on the keeper straps under them; the shoes sit ${f2(g.bl.beta / RAD)} deg below the axle line on the rear of each tread. Epoxy barrier coat where the aluminum meets the oak notch walls. ${STEEL_FINISH}`,
  }));

  // ── Lined shoes (purchased, steel-backed), one at each end of the beam ──
  for (const { s: sgn, tag } of SIDES) {
    const lt = p.brakeLiningThickIn, bt = p.brakeShoeBackThickIn;
    const delta = g.shoeHalfAngle;
    const N = 8;
    const arc: Vec2[] = [];
    for (let i = 0; i <= N; i++) { const a = bl.beta - delta + (2 * delta * i) / N; arc.push([-(r + lt + bt) * Math.cos(a), -(r + lt + bt) * Math.sin(a)]); }
    for (let i = N; i >= 0; i--) { const a = bl.beta - delta + (2 * delta * i) / N; arc.push([-r * Math.cos(a), -r * Math.sin(a)]); }
    const shift = -(1 - s) * bl.stroke; // the shoe sits on the tread when applied
    const [qy0, qy1] = yRange(sgn, Y.pad[0], Y.pad[1]);
    const depthL = Y.pad[1] - Y.pad[0];
    const areaL = shoeLengthIn(p) * depthL;
    const cgR = r + (lt + bt) / 2;
    add1(planarExtrusion(ctx, {
      id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe ${tag} (lined, steel-backed)`, mat: 'fixed', kind: 'purchased',
      material: `${f2(bt)}" steel back + ${f2(lt)}" woven / molded lining, riveted`, outline: arc, origin: [g.O[0] + shift, g.O[1]],
      yHi: Math.max(qy0, qy1), depth: depthL, massLb: areaL * (bt * STEEL_LB_PER_IN3 + lt * LINING_LB_PER_IN3) + 0.08, fab: 'buy', explode: [0.2, sgn, 0.2],
      cg: [g.O[0] + shift - cgR * Math.cos(bl.beta), (qy0 + qy1) / 2, g.O[1] - cgR * Math.sin(bl.beta)],
      sourcing: { vendor: `Purchased lined steel-backed brake shoe (go-kart band / industrial shoe, ${f2(shoeLengthIn(p))}" x ${f2(depthL)}" lining on a ${f2(bt)}" back, radius-matched to the ${f2(2 * r)}" tire), one 1/4" mounting hole in the back. Part number to confirm.` },
      joints: [bolt('brake-beam', 1, 0.25, `1/4-20 stainless bolt, nylock nut, through the shoe back and the beam front wall; a slightly oversize hole lets the shoe rock to follow the tread`)],
      notes: `Lined steel-backed shoe, ${f2(shoeLengthIn(p))}" long x ${f2(depthL)}" wide, on the rear of the tread ${f2(bl.beta / RAD)} deg below the axle line. Design μ ${f2(p.brakePadMu)} wet; ${f2(p.brakePadMuFouled)} mud-fouled (pass/fail). Test a lining sample on a wet tire first.`,
    }));
  }

  // ── Keeper straps under the rail notches ──
  for (const { s: sgn, tag } of SIDES) {
    const kx0 = bl.notch.x0 - 0.8, kx1 = bl.notch.x1 + 0.8;
    const [ky0, ky1] = yRange(sgn, rail.yIn, rail.yOut);
    const kt = p.brakeKeeperThickIn;
    add1(fixed(box(ctx, {
      id: `brake-keeper-${tag}`, partNo: 'brake-keeper', name: `Brake beam keeper strap ${tag}`, group: 'brake', mat: 'steel', step: STEP.brake, fab: 'drill-tap', explode: [0, sgn, -1],
      ...span([kx0, kx1], [ky0, ky1], [rail.zBot - kt, rail.zBot]),
      material: `${f2(kt)}" A36 steel strap`, sourcing: YARD(`${f2(kt)}" x ${f2(Math.abs(ky1 - ky0))}" A36 flat bar, cut ${f2(kx1 - kx0)}" long`),
      joints: [{ type: 'screw', to: railId(tag), count: 4, diaIn: 0.19, size: `4 x #10 x 1-1/2" stainless wood screws up into the rail bottom, two each side of the notch`, note: 'the beam rests on this strap; keep the screws out of the notch' }],
      notes: `Screwed across the open bottom of the ${f2(bl.notch.x1 - bl.notch.x0)}" rail notch so the beam cannot drop out; the beam's lower face rests on it. ${STEEL_FINISH}`,
    })));
  }

  // ── Clevis foot on the beam's rear face: the tab the link pins to ──
  {
    const hullPts = hull2([...disc(add(g.B0, [pose.dx, 0]), 0.5 + 0.5 * pinD), [bl.xRear + pose.dx, bl.zB - CLEVIS_HALF_IN], [bl.xRear + pose.dx, bl.zB + CLEVIS_HALF_IN]]);
    add1(planarExtrusion(ctx, {
      id: 'brake-clevis', name: 'Brake beam clevis tab', mat: 'steel', outline: hullPts, origin: [0, 0], yHi: barT / 2, depth: barT, fab: 'outsource', explode: [-1, 0, -0.3],
      material: `${f2(barT)}" A36 steel plate (clevis foot), laser cut`,
      sourcing: { vendor: `Outsourced laser cut ${f2(barT)}" A36 plate, hole ${f2(pinD + 0.03)}" for the link pin; the foot is bent from the same blank (flange not drawn); zinc plated` },
      joints: [bolt('brake-beam', 2, 0.25, '2 x 1/4-20 stainless bolts fore-aft through the foot and the tube rear wall (crush sleeves), nylock nuts inside'), pinJoint('brake-link-a', `${f2(pinD)}" clevis pin through the tab and both link bars`)],
      notes: `The tab sits between the two link bars (they straddle it) ${f2(g.linkLen)}" from the lever tail pin; moves with the beam.`,
    }));
  }

  // ── Link: two flat bars straddling the lever tail and the clevis tab ──
  for (const [tag, sgn] of [['a', 1], ['b', -1]] as const) {
    const [ly0, ly1] = yRange(sgn, Y.link[0], Y.link[1]);
    const lc = (ly0 + ly1) / 2;
    add1(flatBar(ctx, {
      id: `brake-link-${tag}`, partNo: 'brake-link', name: `Brake link bar ${tag.toUpperCase()}`, a: pose.T, b: pose.B, y: lc, thickY: barT, widthPlane: barW, mat: 'steel',
      fab: 'drill-tap', explode: [-1, sgn * 0.3, -0.3],
      material: `${f2(barT)}" x ${f2(barW)}" A36 flat bar, two ${f2(pinD + 0.03)}" holes ${f2(g.linkLen)}" apart`,
      sourcing: YARD(`${f2(barT)}" x ${f2(barW)}" A36 flat bar, cut ${f2(g.linkLen + barW)}" long, two holes ${f2(g.linkLen)}" apart`),
      joints: [pinJoint('brake-lever', 'clevis pin through the lever tail'), pinJoint('brake-clevis', 'clevis pin through the beam clevis tab')],
      notes: `Two bars straddle the ${f2(barT)}" lever tail and the ${f2(barT)}" clevis tab (double shear in the pins). Carries compression ${f2(g.linkLen)}" pin to pin. Adjust the stroke by moving the clevis tab bolts or filing a longer link as the shoes wear.`,
    }));
  }
  for (const [tag, pt] of [['T', pose.T], ['B', pose.B]] as const) {
    add1(pinY(ctx, {
      id: `brake-link-pin-${tag}`, partNo: 'brake-link-pin', name: tag === 'T' ? 'Link pin at the lever tail' : 'Link pin at the beam clevis', c: pt, y0: -(Y.link[1] + 0.35), y1: Y.link[1] + 0.35, radius: pinD / 2,
      massLb: 0.06, material: `${f2(pinD)}" 316 stainless clevis pin with hairpin clips`, explode: [0, 1, 0],
      sourcing: { vendor: `McMaster-Carr (${f2(pinD)}" 316 stainless clevis pin, hairpin cotter clips)` },
      joints: [pinJoint(tag === 'T' ? 'brake-lever' : 'brake-clevis', 'through the bars and the tab, hairpin clips at the ends')],
    }));
  }

  // ── Hand lever: flat aluminum bar, pivot at the bracket, grip dowel on top ──
  {
    const rotAbout = (q: V2) => rot2(q, g.Q, pose.thetaL);
    const a = rotAbout(g.barTail), b = rotAbout(g.barTop);
    add1(flatBar(ctx, {
      id: 'brake-lever', name: 'Brake hand lever (aluminum bar)', a, b, y: 0, thickY: barT, widthPlane: p.brakeLeverWidthIn, mat: 'fixed', kind: 'metal', fab: 'drill-tap', removable: true, explode: [-1, 0, 0.3],
      massLb: alLb(p, norm(sub(b, a)) * barT * p.brakeLeverWidthIn), material: `6061-T6 aluminum flat bar ${f2(barT)}" x ${f2(p.brakeLeverWidthIn)}"`,
      stock: { t: barT, w: p.brakeLeverWidthIn, l: norm(sub(b, a)) },
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum flat bar ${f2(barT)}" x ${f2(p.brakeLeverWidthIn)}", cut ${f2(norm(sub(b, a)))}"; drill the pivot, link-pin, spring and parking-pin holes from the template; round the corners)` },
      joints: [
        pinJoint('brake-pivot-pin', `${f2(p.brakePivotBoltDiameterIn)}" pivot bolt through both ears and the bar`),
        pinJoint('brake-link-a', 'link pin through the tail'),
        { type: 'pin', to: 'brake-park-pin', count: 1, diaIn: pinD, size: `${f2(pinD)}" hitch pin at ${f2(g.park.radius)}" from the pivot (stowed in the lever when released)` },
        { type: 'screw', to: 'brake-lever-grip', count: 2, diaIn: 0.19, size: '2 x #10 stainless screws up into the grip dowel' },
      ],
      notes: `Stands behind the rear transom at the centerline, ${f2(p.brakeLeverStandoffIn)}" off the pivot bracket plate, leaning ${p.brakeLeverTiltDeg} deg back; tail ${f2(g.tailIn)}" below the pivot, grip ${f2(g.G0[1] - g.Q[1])}" above it. Lifts off with the push handle for transport (the pivot bolt comes out). The beam resting on the notch rear wall (through the link) is the release stop. ${STEEL_FINISH}`,
    }));
    const gc = rotAbout(g.G0);
    const grip = cylinder(ctx, {
      id: 'brake-lever-grip', name: 'Brake lever grip', group: 'brake', mat: 'oak', step: STEP.brake, axis: 'y', radius: GRIP_RADIUS_IN, length: GRIP_LENGTH_IN, center: [gc[0], 0, gc[1]],
      removable: true, explode: [-1, 0, 0.5],
      sourcing: { vendor: `McMaster-Carr or Rockler (${f2(2 * GRIP_RADIUS_IN)}" white-oak dowel, cut ${GRIP_LENGTH_IN}")` },
      joints: [{ type: 'screw', to: 'brake-lever', count: 2, diaIn: 0.19, size: '2 x #10 stainless screws up through the bar end into the dowel' }],
      notes: 'A cross grip so a hand can pull the lever back from either side of the center, below the push-handle bar.',
    });
    grip.grain = 'z'; // the cylinder's own axis (it lies along Y in the model)
    add1(grip);
    // The parking pin is stowed through the lever (a lanyard keeps it on the cart).
    const pp = rotAbout(add(g.Q, mul(g.e, g.park.radius)));
    add1(pinY(ctx, {
      id: 'brake-park-pin', name: 'Parking hitch pin', c: pp, y0: -(barT / 2 + 0.3), y1: barT / 2 + 0.3, radius: pinD / 2, massLb: 0.05, removable: true,
      material: `${f2(pinD)}" 316 stainless hitch pin with lanyard`, explode: [0, -1, 0.5],
      sourcing: { vendor: `McMaster-Carr (${f2(pinD)}" 316 stainless hitch pin with lanyard ring)` },
      joints: [pinJoint('brake-lever', 'through the lever bar'), pinJoint('brake-pivot-ear-L', 'when parked: through the lever and one hole of the quadrant ear')],
      notes: 'Stowed in the lever bar. To park: pull the lever until a quadrant hole lines up with the lever hole, push the pin through both, and the brake stays on.',
    }));
  }

  // ── Pivot bracket: base plate on the transom's rear face, ears straddling the lever (left ear is the parking quadrant) ──
  {
    const bx0 = g.base.x0, bx1 = g.base.x1;
    const baseHalf = Y.ear[1] + 0.5;
    const bz0 = g.base.z0, bz1 = g.base.z1;
    const bd = p.brakeBracketBoltDiameterIn;
    const sockGrip = L.transom + plateT + p.blockingThickIn;
    add1(fixed(box(ctx, {
      id: 'brake-pivot-base', name: 'Brake pivot bracket plate', group: 'brake', mat: 'steel', step: STEP.brake, fab: 'outsource', explode: [-1, 0, 0],
      ...span([bx0, bx1], [-baseHalf, baseHalf], [bz0, bz1]),
      material: `${f2(plateT)}" A36 steel plate, laser cut`,
      sourcing: { vendor: `Outsourced laser cut ${f2(plateT)}" A36 plate (the DXF comes from the cut list), four ${f2(bd + 0.03)}" holes, two ${f2(0.25 + 0.03)}" ear-flange holes each side; zinc plated` },
      joints: [
        bolt('transom-rear', 4, bd, `4 x ${f2(bd)}-20 316 button-head bolts, ${inchesText(boltLength(L.transom + plateT, bd))}" long, through the plate and the transom into fender washers and nylock nuts on the inside face (in the lane behind the storage box)`, 'seated on the transom face with epoxy bedding'),
        bolt('brake-pivot-ear-L', 2, 0.25, '2 x 1/4-20 screws through the bent ear flange'), bolt('brake-pivot-ear-R', 2, 0.25, '2 x 1/4-20 screws through the bent ear flange'),
      ],
      notes: `Stands on the outside of the rear transom (x ${f2(bx0)}" to ${f2(bx1)}"), z ${f2(bz0)}" to ${f2(bz1)}", centered. The lever pull pushes it FORWARD into the transom (bearing, not bolt tension): the hand force and the link force both reach the pivot as a forward push (analysis row brake-lever). Bolt grip ${f2(sockGrip)}".`,
    })));
    // Ears: plates in the x–z plane. Left carries the parking holes.
    const earOutline = (quad: boolean): V2[] => {
      const body = hull2([...disc(g.Q, 0.8), [bx0, g.Q[1] - 0.8], [bx0, g.Q[1] + 0.8], [g.Q[0], g.Q[1] - 0.8], [g.Q[0], g.Q[1] + 0.8]]);
      if (!quad) return body;
      // The quadrant: a band of the parking radius from the first to the last hole, hulled with the pivot body.
      const a0 = g.park.angles[0], a1 = g.park.angles[g.park.angles.length - 1];
      const pts: V2[] = [];
      const R = g.park.radius;
      for (let i = 0; i <= 8; i++) {
        const th = a0 + ((a1 - a0) * i) / 8;
        const d = (rr: number): V2 => add(g.Q, mul([-Math.sin(g.tilt + th), Math.cos(g.tilt + th)], rr));
        pts.push(d(R - PARK_BAND_IN), d(R + PARK_BAND_IN));
      }
      return hull2([...body, ...pts]);
    };
    for (const { s: sgn, tag } of SIDES) {
      const quad = tag === 'L';
      const [ey0, ey1] = yRange(sgn, Y.ear[0], Y.ear[1]);
      const outline = earOutline(quad);
      add1(fixed(planarExtrusion(ctx, {
        id: `brake-pivot-ear-${tag}`, partNo: quad ? 'brake-pivot-ear-quadrant' : 'brake-pivot-ear', name: quad ? 'Brake pivot ear with parking quadrant' : 'Brake pivot ear', mat: 'steel', outline, origin: [0, 0], yHi: Math.max(ey0, ey1), depth: plateT,
        fab: 'outsource', explode: [-1, sgn * 0.5, 0.3], material: `${f2(plateT)}" A36 steel plate, laser cut`,
        sourcing: { vendor: `Outsourced laser cut ${f2(plateT)}" A36 plate (one blank with a bent flange to the base plate)${quad ? `; ${g.park.angles.length} x ${f2(pinD + 0.03)}" parking holes ${f2(p.brakeParkPitchIn)}" apart on a ${f2(g.park.radius)}" radius` : ''}; zinc plated` },
        joints: [bolt('brake-pivot-base', 2, 0.25, '2 x 1/4-20 screws through the bent flange'), pinJoint('brake-pivot-pin', 'pivot bolt hole')],
        notes: quad ? `${g.park.angles.length} parking holes ${f2(p.brakeParkPitchIn)}" apart on a ${f2(g.park.radius)}" radius about the pivot; hole ${g.park.designIndex + 1} is the design applied position (${f2(g.thetaL / RAD)} deg), the others take up shoe and tire wear.` : 'Plain ear; the lever runs between the two ears.',
      })));
    }
    const pivD = p.brakePivotBoltDiameterIn;
    add1(fixed(pinY(ctx, {
      id: 'brake-pivot-pin', name: 'Lever pivot bolt', c: g.Q, y0: -(Y.ear[1] + 0.35), y1: Y.ear[1] + 0.35, radius: pivD / 2, massLb: 0.08, removable: true,
      material: `${f2(pivD)}" 316 stainless shoulder bolt, nylock nut`, explode: [0, 1, 0],
      sourcing: { vendor: `McMaster-Carr (${f2(pivD)}" 316 stainless shoulder bolt, nylock nut, nylon washers each side of the bar)` },
      joints: [pinJoint('brake-pivot-ear-L', 'through both ears and the lever bar')],
      notes: 'The lever turns on this bolt (shoulder bolt: the shoulder is the bearing, the nut is not over-tightened). Pull it to take the lever off.',
    })));
  }

  // ── Return spring: from the lever (above the pivot) to an eye bolt on the transom's rear face ──
  {
    const above = 4;
    const a: V2 = rot2(add(g.Q, mul(g.e, above)), g.Q, pose.thetaL);
    const c: V2 = [g.base.x1, g.Q[1] + above + 0.3];
    const len = norm(sub(c, a));
    add1(cylinder(ctx, {
      id: 'brake-return-spring', name: 'Brake return spring', group: 'brake', mat: 'fixed', kind: 'purchased', material: '302 stainless extension spring, hook ends', massLb: RETURN_SPRING_MASS_LB,
      step: STEP.brake, fab: 'buy', removable: true, center: [(a[0] + c[0]) / 2, 0.55, (a[1] + c[1]) / 2], axis: 'x', radius: 0.15, length: Math.max(0.2, len),
      rot: { y: -Math.atan2(c[1] - a[1], c[0] - a[0]) + 0 },
      explode: [-1, 0.5, 0.2], sourcing: { vendor: 'McMaster-Carr (302 stainless extension spring, 5/16" OD, hooks to a lever hole and a transom eye bolt)' },
      notes: `Pulls the lever top forward (released); through the link it also draws the beam back to the notch rear wall. A few lbf: a ${f2(len)}" long spring from a lever hole ${above}" above the pivot to an eye bolt screwed into the transom face.`,
    }));
  }

  if (!movingOnly) parts.push(...buildHandle(ctx));
  return stockPass(parts);
}

/** Every bought or cut metal part carries stock dimensions (section × cut length) and a source, for the Phase 4 bar / plate list (build review M9). */
function stockPass(parts: Part[]): Part[] {
  for (const x of parts) {
    if (x.explode) x.explode = unitDir(x.explode);
    if (x.kind !== 'metal') continue;
    if (!x.stock) {
      const g = x.geometry;
      if (g.type === 'box') {
        const d = [...g.size].sort((a, b) => a - b);
        x.stock = { t: d[0], w: d[1], l: d[2] };
      } else if (g.type === 'cylinder') x.stock = { t: 2 * g.radius, w: 2 * g.radius, l: g.length };
    }
    if (!x.sourcing) x.sourcing = YARD(`${x.material}, cut on the bandsaw and drilled`);
  }
  return parts;
}

export function buildBrake(ctx: Ctx): Part[] {
  return buildBrakeAt(ctx, 0);
}

