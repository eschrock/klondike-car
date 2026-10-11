/**
 * Phase 3b Stage 1, WS-A: the Ackermann front end PARTS (front-end.ts) on `defaultParams()`; Phase 3c-1 (D-53): ride mode, the stick, cables, mode plate and pin,
 * centering springs and the front brakes are gone, the tongue drives the bellcrank through one link pin.
 * Kinematics are in ackermann.test.ts; this file covers the parts, their articulation, clearances over the steering sweep and the published geometry.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams } from '../params';
import { lockLimits, poseMatrices, solveSteer } from './ackermann';
import { transformPoint, partsOverlap } from './bounds';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { TOW_STOP_BLOCK_IN, TOW_STOP_GAP_IN } from './front-layout';
import { LINK_PIN_HEAD_IN, frontStackTop } from './front-stack';
import type { Part, Vec2, Vec3 } from './types';

const P0 = defaultParams();
const L0 = computeLayout(P0);
const F = L0.front;
const build = (steerDeg = 0, extra: Record<string, unknown> = {}) => buildModel(P0, { steerDeg, ...extra });
const byId = (parts: Part[], id: string) => parts.find((x) => x.id === id);
const need = (parts: Part[], id: string) => { const x = byId(parts, id); if (!x) throw new Error(`missing part ${id}`); return x; };

const FRONT_IDS = ['beam-F', 'kp-bracket-L', 'kp-bracket-R', 'spindle-L', 'spindle-R', 'steer-arm-L', 'steer-arm-R', 'kingpin-bolt-L', 'kingpin-bolt-R', 'tie-rod', 'drag-link', 'bellcrank', 'bell-bracket',
  'bell-standoff', 'tongue-link-pin', 'steer-stop-tow-L', 'steer-stop-tow-R', 'tongue', 'tongue-plate', 'tongue-link',
  'tongue-hinge-top', 'tongue-hinge-bottom', 'tongue-hinge-wall-L', 'tongue-hinge-wall-R', 'tongue-hinge-pin', 'eyebolt-T', 'bridle'];
/** Ride mode parts removed at Phase 3c-1 (D-53): none of them may come back. */
const GONE_IDS = ['cable-crossbar', 'mode-pin', 'centering-spring-L', 'centering-spring-R', 'stick-bracket', 'ride-stick', 'stick-guard', 'stick-cable-A', 'stick-cable-B', 'stick-cable-A-up', 'stick-cable-B-end', 'cable-guide-R'];

describe('steering parts: the part list', () => {
  const parts = build();
  it('every published front-end id is present, ids are unique, and each part has a fab, step, explode, finite transform and (for bought parts) sourcing', () => {
    for (const id of FRONT_IDS) expect(byId(parts, id), id).toBeDefined();
    expect(new Set(parts.map((x) => x.id)).size).toBe(parts.length);
    const mine = parts.filter((x) => FRONT_IDS.includes(x.id) || /^(tongue-hinge|spindle|steer-arm|kingpin-bolt|kp-bracket)/.test(x.id));
    for (const x of mine) {
      expect(x.fab, x.id).toBeDefined();
      expect(x.step, x.id).toBeGreaterThan(0);
      expect(x.explode && x.explode.every(Number.isFinite) && x.explode.some((v) => v !== 0), x.id).toBe(true);
      expect(x.transform.every(Number.isFinite), x.id).toBe(true);
      expect(x.massLb, x.id).toBeGreaterThan(0);
      if (x.kind === 'purchased') expect(x.sourcing?.vendor, x.id).toBeTruthy();
      if (x.fab === 'outsource') expect(x.sourcing?.vendor, x.id).toBeTruthy();
    }
  });
  it('the old turntable family is gone from the new front end, the front axle rod, oak beam and U-bolts too', () => {
    for (const id of ['turntable', 'kingpin', 'kingpin-crossbar', 'axle-F', 'clamp-FL1', 'clamp-FL2', 'kp-carrier', 'eyebolt-L', 'bridle-L', 'nose-access-panel']) expect(byId(parts, id), id).toBeUndefined();
    expect(parts.some((x) => x.body === 'steer')).toBe(false);
    expect(parts.some((x) => /^(bolster|side-bearer|steer-stop-[LR]|stop-block)/.test(x.id))).toBe(false);
  });
  it('bolted only: no part is welded (every steel front-end part is cut, bought or outsourced) and every bolt joint has a diameter', () => {
    for (const x of parts.filter((q) => FRONT_IDS.includes(q.id))) {
      expect(['drill-tap', 'outsource', 'buy', 'print', 'table-saw']).toContain(x.fab);
      for (const j of x.joints ?? []) if (j.type === 'bolt') expect(j.diaIn ?? 0, `${x.id} -> ${j.to}`).toBeGreaterThan(0);
      expect(`${x.notes ?? ''} ${x.sourcing?.vendor ?? ''}`.toLowerCase()).not.toMatch(/\bweld(ed|ing)? (the|it|to|a)\b/);
    }
  });
  it('masses are sensible: the front end totals within the spec 11.1 estimate plus the re-laid linkage', () => {
    const sum = (re: RegExp) => parts.filter((x) => re.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(need(parts, 'beam-F').massLb).toBeGreaterThan(5);
    expect(need(parts, 'beam-F').massLb).toBeLessThan(9);
    expect(sum(/^spindle-/)).toBeCloseTo(2 * P0.spindleMassLb, 6);
    const frontEnd = parts.filter((x) => FRONT_IDS.includes(x.id) || /^tongue-hinge/.test(x.id)).reduce((a, x) => a + x.massLb, 0);
    expect(frontEnd).toBeGreaterThan(16);
    expect(frontEnd).toBeLessThan(28);
  });
  it('the ride-mode parts are gone (no stick, cables, mode plate, mode pin, cross-bar, centering springs or cable slot guide); the bridle is the only rope', () => {
    for (const id of GONE_IDS) expect(byId(parts, id), id).toBeUndefined();
    expect(parts.some((x) => /^(stick-|ride-stick|cable-|centering-|mode-)/.test(x.id))).toBe(false);
    expect(need(parts, 'bridle').material).toBe('rope');
  });
});

describe('steering parts: articulation', () => {
  const MOVING: Record<string, string> = { 'spindle-L': 'steer-L', 'steer-arm-L': 'steer-L', 'spindle-R': 'steer-R', 'steer-arm-R': 'steer-R', 'wheel-FL': 'steer-L', 'wheel-FR': 'steer-R', 'tie-rod': 'tie-rod', bellcrank: 'bellcrank', 'bell-standoff': 'bellcrank', 'tongue-link-pin': 'bellcrank', tongue: 'tongue', 'tongue-plate': 'tongue', 'eyebolt-T': 'tongue', 'drag-link': 'drag-link', 'tongue-link': 'tongue-link' };
  it('buildModel at steerDeg 0 and 20 moves knuckles, wheels, tie rod, bellcrank and tongue, and leaves the beam, brackets and hull fixed', () => {
    const a = build(0), b = build(20);
    for (const id of Object.keys(MOVING)) expect(need(a, id).transform, id).not.toEqual(need(b, id).transform);
    for (const id of ['beam-F', 'kp-bracket-L', 'kp-bracket-R', 'bell-bracket', 'tongue-hinge-top', 'tongue-hinge-bottom', 'tongue-hinge-wall-L', 'tongue-hinge-pin', 'steer-stop-tow-L', 'deck', 'rail-nose-L', 'transom-front', 'wheel-RL', 'kingpin-bolt-L']) {
      const x = byId(a, id);
      if (!x) continue;
      expect(need(b, id).transform, id).toEqual(x.transform);
    }
    for (const id of ['spindle-L', 'tie-rod', 'tongue']) expect(need(b, id).body).toBe(MOVING[id]);
    expect(need(b, 'wheel-FL').body).toBe('wheel-FL');
  });
  it('each moving part carries exactly the pose of its body (the neutral transform times poseMatrices)', () => {
    const deg = 22;
    const n = build(0), s = build(deg);
    const sol = solveSteer(F.ack, deg);
    const pose = poseMatrices(F.ack, sol);
    const mul = (m: number[], t: number[]) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += m[k * 4 + r] * t[c * 4 + k]; return o; };
    for (const [id, body] of Object.entries(MOVING)) {
      const want = mul(pose[body as keyof typeof pose], need(n, id).transform);
      need(s, id).transform.forEach((v, i) => expect(v, `${id}[${i}]`).toBeCloseTo(want[i], 9));
    }
  });
  it('the tie rod ends stay on the steering arm tips and the drag link and tongue link keep their lengths over the whole range (every part moves rigidly with its pins)', () => {
    for (const d of [-35.5, -20, 0, 20, 35.5]) {
      const parts = build(d);
      const tie = need(parts, 'tie-rod');
      const ends = [-1, 1].map((k) => transformPoint(tie.transform, [0, 0, (k * F.ack.tieLen) / 2]));
      const tipL = transformPoint(need(parts, 'steer-arm-L').transform, F.armTip.L), tipR = transformPoint(need(parts, 'steer-arm-R').transform, F.armTip.R);
      // The rod's local z runs along the car's y axis at neutral, so the two ends are (right, left).
      const toLeft = Math.hypot(ends[1][0] - tipL[0], ends[1][1] - tipL[1]), toRight = Math.hypot(ends[0][0] - tipR[0], ends[0][1] - tipR[1]);
      expect(toLeft, `L @${d}`).toBeLessThan(1e-6);
      expect(toRight, `R @${d}`).toBeLessThan(1e-6);
      const bell = need(parts, 'bellcrank');
      const out = transformPoint(bell.transform, [F.bellcrank.outPin[0], F.bellcrank.outPin[1], F.bellcrank.z]);
      const dl = need(parts, 'drag-link');
      const dEnd = transformPoint(dl.transform, [-F.bellcrank.dragLinkLen / 2, 0, 0]);
      expect(Math.hypot(dEnd[0] - out[0], dEnd[1] - out[1]), `drag link @${d}`).toBeLessThan(1e-6);
      const inn = transformPoint(bell.transform, [F.bellcrank.inPin[0], F.bellcrank.inPin[1], 0]);
      const tl = need(parts, 'tongue-link');
      const tEnd = transformPoint(tl.transform, [F.bellcrank.tongueLinkLen / 2, 0, 0]);
      expect(Math.hypot(tEnd[0] - inn[0], tEnd[1] - inn[1]), `tongue link @${d}`).toBeLessThan(1e-6);
    }
  });
  it('the steer angle is clamped to the tow lock (inner wheel)', () => {
    const big = build(90);
    expect(Math.atan2(need(big, 'spindle-L').transform[1], need(big, 'spindle-L').transform[0]) * (180 / Math.PI)).toBeCloseTo(35.5, 6);
  });
});

describe('steering parts: one input, the tongue', () => {
  it('the tongue-link pin sits over the bellcrank input pin on the standoff, moves with the bellcrank, and there is exactly one of it', () => {
    for (const d of [0, 20, -20]) {
      const parts = build(d);
      expect(parts.filter((x) => x.id === 'tongue-link-pin')).toHaveLength(1);
      const t = need(parts, 'tongue-link-pin');
      expect(t.body).toBe('bellcrank');
      expect(t.removable).toBe(true);
      const neutral = need(build(0), 'tongue-link-pin').transform;
      expect(neutral[12]).toBeCloseTo(F.bellcrank.linkPinAt[0], 6);
      expect(neutral[13]).toBeCloseTo(F.bellcrank.linkPinAt[1], 6);
    }
  });
  it('no part of the ride-mode controls exists in any view (ViewState has no mode)', () => {
    for (const parts of [build(0), build(20), buildModel(P0, { removed: true })]) {
      expect(parts.some((x) => /^(ride-stick|stick-|cable-|centering-spring|mode-pin|mode-plate)/.test(x.id))).toBe(false);
    }
  });
  it('transport (removed) drops the tongue family (and the link pin), keeps the beam, brackets and linkage', () => {
    const t = buildModel(P0, { removed: true });
    for (const id of ['tongue', 'tongue-link', 'tongue-plate', 'eyebolt-T', 'bridle', 'tongue-link-pin']) expect(byId(t, id), id).toBeUndefined();
    for (const id of ['beam-F', 'bellcrank', 'tie-rod', 'spindle-L', 'drag-link']) expect(byId(t, id), id).toBeDefined();
  });
});

// ── clearances ──
type Pair = { a: RegExp; b: RegExp; why: string };
const ALLOW: Pair[] = [
  { a: /^beam-F$/, b: /^rail-nose-[LR]$/, why: 'the nose rails are notched for the beam (WS-B, front-mount.ts); the sweep has no notch geometry' },
  { a: /^kp-bracket-[LR]$/, b: /^(spindle-[LR]|kingpin-bolt-[LR])$/, why: 'the spindle boss sits between the bracket leaves and the kingpin bolt passes through both (bounding box of a C channel)' },
  { a: /^kp-bracket-[LR]$/, b: /^wheel-F[LR]$/, why: 'the C-channel bounding box over-covers its round leaf; the leaf disc is tangent to the tire inner face at every angle (tested analytically below)' },
  { a: /^spindle-[LR]$/, b: /^(wheel-F[LR]|kingpin-bolt-[LR])$/, why: 'the stub passes through the wheel bore and the bolt through the boss (bounding boxes)' },
  { a: /^spindle-[LR]$/, b: /^beam-F$/, why: 'the spindle mesh bounding box is axis-aligned in its neutral frame and over-covers when turned; the mesh vertices clear the beam by >= 0.2" (tested below)' },
  { a: /^steer-arm-[LR]$/, b: /^(tie-rod|steer-stop-tow-[LR])$/, why: 'rod end bolted on the arm tip; the arm plate bounding box over-covers its hull at the lock (the plate-to-stop gap is tested analytically below)' },
  { a: /^kingpin-bolt-[LR]$/, b: /^(kp-bracket-[LR]|spindle-[LR])$/, why: 'the bolt passes through the leaves and the boss' },
  { a: /^(bell-standoff|tongue-link-pin|tongue-link|tongue-plate)$/, b: /^(bell-standoff|tongue-link-pin|tongue-link|tongue-plate|tongue-hinge-pin|bellcrank)$/, why: 'pins pass through the link ends, the standoff top and the plates (drawn solid)' },
  { a: /^tongue$/, b: /^(tongue-hinge-pin|eyebolt-T)$/, why: 'the hinge pin and the eye bolt pass through holes in the tongue' },
  { a: /^tongue-hinge-(top|bottom)$/, b: /^tongue-hinge-pin$/, why: 'the hinge pin passes through the plates' },
  { a: /^tongue-hinge-pin$/, b: /^(tongue-plate|tongue-hinge-top|tongue-hinge-bottom)$/, why: 'the hinge pin passes through the ear plate and the plates' },
  { a: /^bridle$/, b: /^eyebolt-T$/, why: 'rope tied to the eye' },
];
const matches = (r: Pair, a: Part, b: Part) => (r.a.test(a.id) && r.b.test(b.id)) || (r.a.test(b.id) && r.b.test(a.id));
const FRONT_RE = /^(wheel-F|beam-F|kp-bracket|spindle|steer-arm|kingpin-bolt|tie-rod|drag-link|bellcrank|bell-|steer-stop-tow|tongue|eyebolt-T|bridle)/;

function sweepOverlaps(degs: number[]): { bad: string[] } {
  const bad: string[] = [];
  for (const d of degs) {
    const parts = build(d);
    const solid = parts.filter((x) => !x.payload && x.group !== 'reference' && !/^brake-/.test(x.id));
    const front = solid.filter((x) => FRONT_RE.test(x.id));
    for (const a of front) {
      for (const b of solid) {
        if (a === b || (front.includes(b) && a.id > b.id)) continue;
        const o = partsOverlap(a, b);
        if (o <= 0.05) continue;
        if (ALLOW.some((r) => matches(r, a, b))) continue;
        bad.push(`${d}: ${a.id} x ${b.id} ${o.toFixed(2)}"`);
      }
    }
  }
  return { bad };
}

describe('steering parts: overlaps over the steering sweep', () => {
  const lockOuter = lockLimits(F.ack).outerDeg;
  it('no unintended overlaps with the rest of the cart at the tow sweep in 5 deg steps; the nose joists are split around the linkage corridor', () => {
    const degs: number[] = [];
    for (let d = -35.5; d <= 35.5 + 1e-9; d += 5) degs.push(Math.round(d * 2) / 2);
    degs.push(0, 35.5, -35.5, lockOuter, -lockOuter);
    const { bad } = sweepOverlaps(degs);
    expect(bad).toEqual([]);
  });
});

/** Vertices of a mesh part in the world. */
function worldVerts(x: Part): Vec3[] {
  if (x.geometry.type !== 'mesh') return [];
  const out: Vec3[] = [];
  for (let i = 0; i < x.geometry.positions.length; i += 3) out.push(transformPoint(x.transform, [x.geometry.positions[i], x.geometry.positions[i + 1], x.geometry.positions[i + 2]]));
  return out;
}
const boxDist = (p: Vec3, b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }) =>
  Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1), Math.max(b.z0 - p[2], 0, p[2] - b.z1));

describe('steering parts: analytic clearances over the sweep', () => {
  const sweep = [-35.5, -30, -26, -20, -10, 0, 10, 20, 30, 35.5];
  it('the spindle meshes clear the beam, both bracket webs, the tie rod and the drag link by 0.15" at every angle (1 deg steps of the tow range)', () => {
    const beamBox = { x0: F.beam.x - F.beam.thick / 2, x1: F.beam.x + F.beam.thick / 2, y0: -F.beam.len / 2, y1: F.beam.len / 2, z0: F.beam.bot, z1: F.beam.top };
    let worst = Infinity;
    for (let d = -35; d <= 35; d += 1) {
      const parts = build(d);
      for (const tag of ['L', 'R'] as const) {
        const sp = need(parts, `spindle-${tag}`);
        const web = F.bracket[tag].web;
        for (const v of worldVerts(sp)) {
          worst = Math.min(worst, boxDist(v, beamBox), boxDist(v, web));
        }
      }
    }
    expect(worst).toBeGreaterThan(0.15);
  });
  it('the steering arms pass under the beam (0.25" clear, plate top to beam bottom) and the tie rod runs behind it at every angle', () => {
    expect(F.beam.bot - (F.tieRod.z + P0.steerArmThickIn / 2)).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(F.beam.bot - (F.tieRod.z + P0.tieRodDiaIn / 2)).toBeGreaterThanOrEqual(0.25 - 1e-9);
    const rear = F.beam.x - F.beam.thick / 2;
    for (const d of sweep) {
      const parts = build(d);
      const tie = need(parts, 'tie-rod');
      for (const k of [-1, 1]) {
        const e = transformPoint(tie.transform, [0, 0, (k * F.ack.tieLen) / 2]);
        // The rod end eye (radius = the rod end bolt) is behind the beam rear face, or under it by the z gap above.
        expect(e[0] - P0.tieRodEndDiaIn / 2 < rear + 0.5, `${d}`).toBe(true);
      }
    }
  });
  it('the tow-lock stop meets the inner steering arm at the lock: gap 1/16" at 35.5 deg, never touched before it, not touched by the arm of the outer wheel', () => {
    const sat = (A: Vec2[], B: Vec2[]): number => {
      // Signed separation (> 0 = gap) of two convex polygons by the best separating axis (a lower bound of the distance).
      let best = -Infinity;
      for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const n: Vec2 = [b[1] - a[1], a[0] - b[0]]; const m = Math.hypot(...n); n[0] /= m; n[1] /= m;
        const pa = A.map((q) => q[0] * n[0] + q[1] * n[1]), pb = B.map((q) => q[0] * n[0] + q[1] * n[1]);
        best = Math.max(best, Math.max(Math.min(...pa) - Math.max(...pb), Math.min(...pb) - Math.max(...pa)));
      }
      return best;
    };
    const rotPoly = (poly: Vec2[], c: Vec2, deg: number): Vec2[] => poly.map((q) => { const a = (deg * Math.PI) / 180, dx = q[0] - c[0], dy = q[1] - c[1]; return [c[0] + Math.cos(a) * dx - Math.sin(a) * dy, c[1] + Math.sin(a) * dx + Math.cos(a) * dy]; });
    for (const tag of ['L', 'R'] as const) {
      const s = tag === 'L' ? 1 : -1;
      const st = F.towStop[tag];
      const b = TOW_STOP_BLOCK_IN / 2;
      const c = Math.cos(st.rotRad), sn = Math.sin(st.rotRad);
      const block: Vec2[] = ([[-b, -b], [b, -b], [b, b], [-b, b]] as Vec2[]).map(([x, y]) => [st.center[0] + c * x - sn * y, st.center[1] + sn * x + c * y]);
      const hull = F.knuckle[tag].armHull;
      const K = F.kp[tag];
      const k2: Vec2 = [K[0], K[1]];
      const gapAt = (deg: number) => sat(rotPoly(hull, k2, deg), block);
      // The inner wheel turns +lock on the left knuckle (left turn) and -lock on the right.
      expect(gapAt(s * 35.5)).toBeGreaterThan(TOW_STOP_GAP_IN - 0.02);
      expect(gapAt(s * 35.5)).toBeLessThan(TOW_STOP_GAP_IN + 0.02);
      for (let a = 0; a < 35.5 - 1e-9; a += 0.5) expect(gapAt(s * a), `${tag} @${a}`).toBeGreaterThan(0);
      // The outer wheel (the other direction, to the outer lock) is nowhere near.
      const outer = lockLimits(F.ack).outerDeg;
      for (let a = 0; a <= outer; a += 1) expect(gapAt(-s * a), `${tag} outer @${a}`).toBeGreaterThan(0.5);
    }
  });
  it('the bracket leaf (radius kingpinBracketLeafRadiusIn about the kingpin) stays outside the tire inner face at every steering angle, and the web/leaf stack is inside the beam length', () => {
    const inner = F.ack.scrub - P0.tireWidthIn / 2; // kingpin axis to the tire inner face, measured across the wheel plane (always)
    expect(inner).toBeGreaterThanOrEqual(P0.kingpinBracketLeafRadiusIn - 1e-9);
    for (const tag of ['L', 'R'] as const) {
      const br = F.bracket[tag];
      expect(Math.abs(br.web.y0) < F.beam.len / 2 + P0.kingpinBracketThickIn + 1e-9).toBe(true);
      expect(br.lowerLeaf.z1).toBeLessThan(br.upperLeaf.z0);
      // the boss (radius, length) fits between the leaves with the shim allowance
      expect(br.upperLeaf.z0 - br.lowerLeaf.z1).toBeGreaterThanOrEqual(P0.spindleBossLengthIn - 1e-9);
      // the web is far enough from the kingpin axis for the boss: radius + KPI lean + web
      const lean = (P0.spindleBossAboveStubIn + P0.spindleBossLengthIn / 2) * Math.tan((P0.kingpinInclinationDeg * Math.PI) / 180);
      expect(Math.abs(F.kp[tag][1]) - F.beam.len / 2 - P0.kingpinBracketThickIn).toBeGreaterThanOrEqual(P0.spindleBossRadiusIn + lean - 1e-9);
    }
  });
});

describe('steering parts: published geometry (Layout.front)', () => {
  it('the z stack is ordered: tie rod and arms under the beam, the drag link over the tie rod, bellcrank over them, bracket plate over the bellcrank', () => {
    const b = F.bellcrank;
    const t = P0.kingpinBracketThickIn, bt = P0.bellcrankPlateThickIn;
    expect(F.tieRod.z + P0.tieRodDiaIn / 2).toBeLessThanOrEqual(F.beam.bot - 0.25 + 1e-9);
    expect(b.dragZ - t / 2).toBeGreaterThan(F.tieRod.z + P0.tieRodDiaIn / 2);
    expect(b.z - bt / 2).toBeGreaterThan(b.dragZ + t / 2);
    expect(b.bracketZ - t / 2).toBeGreaterThan(b.z + bt / 2);
  });
  it('over the beam: the tongue passes under the front transom bottom by the linkage running clearance, the ear plate and the tongue link clear the beam top, and the whole stack is under the deck', () => {
    const T = F.tongue;
    const transomBottom = L0.deckTop - P0.crossmemberDepthIn;
    expect(T.top).toBeLessThanOrEqual(transomBottom - P0.steeringLinkClearIn + 1e-9);
    expect(T.top).toBeLessThan(L0.deckTop - P0.crossmemberDepthIn); // the tongue is under the front transom's bottom edge
    expect(T.plate.z0).toBeGreaterThan(F.beam.top);
    expect(T.link.z0).toBeGreaterThanOrEqual(T.plate.z1 - 1e-9);
    expect(T.link.z1).toBeLessThan(L0.deckBot);
    expect(T.hingeTop.z0).toBeCloseTo(T.top, 9);
    expect(T.hingeBot.z1).toBeCloseTo(T.bot, 9);
    expect(T.z).toBeCloseTo((T.top + T.bot) / 2, 9);
    expect(T.tipX).toBeCloseTo(P0.wheelbaseIn + P0.tongueLengthIn, 9);
    // The tongue-tip eye is at the tongue's own height range.
    expect(T.hinge[0]).toBeCloseTo(F.beam.x + F.beam.thick / 2 + P0.tongueHingeAheadOfBeamIn, 9);
  });
  it('the center-linkage keep-out spans the bell bracket back to the tongue hinge (Layout.front.keepOut.center) and the bellcrank pins are in it', () => {
    expect(F.keepOut.center.x0).toBeLessThan(F.bellcrank.pivot[0]);
    expect(F.keepOut.center.x1).toBeGreaterThan(F.tongue.hinge[0]);
    for (const q of [F.bellcrank.outPin, F.bellcrank.inPin]) {
      expect(q[0]).toBeGreaterThan(F.keepOut.center.x0);
      expect(q[1]).toBeLessThan(F.keepOut.center.y1);
      expect(q[1]).toBeGreaterThan(F.keepOut.center.y0);
    }
  });
  it('tow stop and arm geometry: the stops sit under the beam, the arm hull contains the kingpin axis, the foot and the tip', () => {
    for (const tag of ['L', 'R'] as const) {
      const st = F.towStop[tag];
      expect(st.center[2] + st.size[2] / 2).toBeCloseTo(F.beam.bot, 9);
      expect(st.center[2] - st.size[2] / 2).toBeLessThan(F.tieRod.z - P0.steerArmThickIn / 2);
      const hull = F.knuckle[tag].armHull;
      const xs = hull.map((q) => q[0]);
      expect(Math.min(...xs)).toBeLessThan(F.armTip[tag][0]);
      expect(Math.max(...xs)).toBeGreaterThan(F.kp[tag][0]);
      // The foot post stays clear of the tire inner face.
      expect(Math.abs(F.knuckle[tag].foot[1]) + 0.3).toBeLessThan(Math.abs(F.stub[tag][1]) - P0.tireWidthIn / 2);
    }
  });
});

describe('front stack under the deck (Phase 3c-1 validator rule)', () => {
  it('frontStackTop reproduces the layout (beam top, tongue top, link top) for several decks and crossmember depths', () => {
    for (const q of [{}, { deckHeightIn: 10 }, { crossmemberDepthIn: 2.25, deckHeightIn: 10 }, { frontBeamDepthIn: 2.5, deckHeightIn: 10 }] as Partial<typeof P0>[]) {
      const p = { ...P0, ...q };
      const L = computeLayout(p);
      const fs = frontStackTop(p, L.r, L.deckTop);
      expect(fs.beamTop, JSON.stringify(q)).toBeCloseTo(L.front.beam.top, 9);
      expect(fs.tongueTop).toBeCloseTo(L.front.tongue.top, 9);
      expect(fs.linkTop).toBeCloseTo(L.front.tongue.link.z1, 9);
      expect(fs.pinTop - fs.linkTop).toBeCloseTo(LINK_PIN_HEAD_IN, 9);
    }
  });
  it('the validator refuses a deck so low that the link pin head or the rear beam hold-down would poke through it; the defaults keep 0.3 in to spare', () => {
    expect(validateParams(P0).filter((i) => i.severity === 'error')).toEqual([]);
    const L = computeLayout(P0);
    expect(L.deckBot - frontStackTop(P0, L.r, L.deckTop).pinTop).toBeGreaterThan(0.3);
    for (const deckHeightIn of [8, 8.25]) {
      const bad = validateParams({ ...P0, deckHeightIn });
      expect(bad.some((i) => i.severity === 'error' && i.keys.includes('deckHeightIn')), `deck ${deckHeightIn}`).toBe(true);
    }
  });
});
