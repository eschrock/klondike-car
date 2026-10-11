/**
 * The Ackermann front end (Phase 3b, D-51/D-53, spec 1.1 and 1.3; WS-A Stage 1; simplified for Phase 3c-1, D-53): steel tube front beam, bolt-on kingpin
 * brackets, purchased racing-kart spindles, tie rod, drag link, bellcrank, the tongue (hinged ahead of the beam) with its tongue link and the tow-lock stops.
 * There is ONE steering input, the tongue the pullers steer by: its link drives the bellcrank through a single clevis pin, and the bellcrank's output arm drives the
 * tie rod through the drag link. (The bellcrank stays: the tongue ear moves fore-aft while the tie-rod center moves sideways, so a straight link between them
 * would be a toggle; the bellcrank turns that motion through the 90 degrees.) Everything is bolted: no shop welding (the brackets and plates are outsourced).
 *
 * Geometry comes from `Layout.front` (front-layout.ts) and the steered pose of each rigid body from `ctx.pose` (ackermann.poseMatrices): parts are placed in
 * the NEUTRAL frame with `body` set to the moving body, and `customPart` multiplies the pose in.
 */
import { solveSteer } from './ackermann';
import { convexHull, discPts } from './front-layout';
import { IN3_PER_FT3, STEP, roughOf, woodMassLb, type Ctx } from './build-utils';
import { translation } from './mat4';
import { toLocal } from './joinery';
import { circlePath, customPart, mergeMeshes, pathLength, tubeAlong, type CustomPartSpec } from './mesh-utils';
import { boltLength, inchesText, washerThick } from './rear-mount';
import type { Joint, Mat4, Part, Vec2, Vec3 } from './types';

const VENDOR = 'McMaster-Carr or equivalent';
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** 3/8 -> "3/8", 0.75 -> "3/4" (nearest 1/16). */
function frac(x: number): string {
  const w = Math.floor(x + 1e-9);
  let n = Math.round((x - w) * 16), d = 16;
  if (n === 0) return `${w}`;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: Vec3): Vec3 => { const n = len3(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mid3 = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

const basis = (o: Vec3, x: Vec3, y: Vec3, z: Vec3): Mat4 => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];

/** Transform that puts a cylinder (axis = local z) between two points. */
function alongZ(a: Vec3, b: Vec3): Mat4 {
  const d = unit3(sub3(b, a));
  const ref: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x = unit3(cross3(ref, d));
  return basis(mid3(a, b), x, cross3(d, x), d);
}

/** Transform for a flat bar between two plan points at height z: local x runs a to b. */
function barXY(a: Vec2, b: Vec2, z: number): { m: Mat4; len: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const c = dx / len, s = dy / len;
  return { m: basis([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], [c, s, 0], [-s, c, 0], [0, 0, 1]), len };
}

const steelLb = (ctx: Ctx, volIn3: number) => (volIn3 / IN3_PER_FT3) * ctx.p.steelDensityPcf;
const polyArea = (o: Vec2[]) => { let a = 0; for (let i = 0; i < o.length; i++) { const [x1, y1] = o[i], [x2, y2] = o[(i + 1) % o.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };

type Spec = Omit<CustomPartSpec, 'group'>;
/** A 'steering' group part. */
const mk = (ctx: Ctx, s: Spec): Part => customPart(ctx, { group: 'steering', ...s });

/** A plate extruded from an absolute plan outline at z0 (absolute neutral coordinates, so the pose about a world pivot applies directly). */
function plate(ctx: Ctx, s: Omit<Spec, 'geometry' | 'transform' | 'massLb' | 'stock' | 'kind' | 'material'> & { outline: Vec2[]; z0: number; t: number; material: string; mass?: 'steel'; massLb?: number }): Part {
  const area = polyArea(s.outline);
  const { outline, z0, t, mass: _m, ...rest } = s;
  void _m;
  const ext = Math.max(...outline.map((q) => q[0])) - Math.min(...outline.map((q) => q[0]));
  const wd = Math.max(...outline.map((q) => q[1])) - Math.min(...outline.map((q) => q[1]));
  return mk(ctx, {
    ...rest, kind: 'metal', massLb: s.massLb ?? steelLb(ctx, area * t),
    geometry: { type: 'extrusion', outline, depth: t }, transform: translation(0, 0, z0),
    stock: { t, w: Math.min(ext, wd), l: Math.max(ext, wd) },
  });
}

const bolt = (to: string, count: number, diaIn: number, size: string, note?: string, at?: Vec3[]): Joint => ({ type: 'bolt', to, count, diaIn, size, ...(note ? { note } : {}), ...(at ? { at } : {}) });

export function buildFrontEnd(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const F = L.front;
  const ack = F.ack;
  const parts: Part[] = [];
  const r = L.r;
  const beam = F.beam;
  const linkT = p.kingpinBracketThickIn;
  const bellT = p.bellcrankPlateThickIn;
  const tieZ = F.tieRod.z;
  const dragZ = F.bellcrank.dragZ;
  const bellZ = F.bellcrank.z;
  const armW = p.steerArmWidthIn;
  const yawLock = Math.max(...[-1, 1].map((k) => Math.abs(solveSteer(ack, k * ack.towLockInnerDeg).tongueDeg)));
  const stubD = p.spindleStub === 0 ? 17 / 25.4 : 25 / 25.4;
  const sIdx = (s: 1 | -1) => (s > 0 ? 'L' : 'R') as 'L' | 'R';
  const knuckleBody = (s: 1 | -1) => (s > 0 ? 'steer-L' : 'steer-R') as 'steer-L' | 'steer-R';

  // ── Front beam: steel rectangular tube, cut and drilled (no welds) ──
  {
    const w = p.frontBeamWallIn;
    const area = beam.thick * beam.depth - (beam.thick - 2 * w) * (beam.depth - 2 * w);
    const kpBolt = p.kingpinBracketBoltDiaIn;
    parts.push(mk(ctx, {
      id: 'beam-F', name: 'Front beam (steel tube)', kind: 'metal', material: `A500 grade B steel square tube ${frac(beam.thick)} x ${frac(beam.depth)} x ${p.frontBeamWallIn.toFixed(3)} wall`,
      geometry: { type: 'box', size: [beam.thick, beam.len, beam.depth] }, transform: translation(beam.x, 0, (beam.top + beam.bot) / 2),
      massLb: steelLb(ctx, area * beam.len), fab: 'drill-tap', step: STEP.gear, explode: [0, 0, -1],
      stock: { t: w, w: beam.thick, l: beam.len },
      sourcing: { vendor: `${VENDOR}: A500 grade B square tube ${frac(beam.thick)}" x ${frac(beam.depth)}" x ${p.frontBeamWallIn.toFixed(3)}" wall, cut ${f2(beam.len)}" long on the bandsaw or chop saw; drill the bracket bolt holes (${frac(kpBolt)}"), the hinge-bracket and bell-bracket holes and the hold-down holes from the drill templates. Zinc-plated or painted; no welding` },
      joints: [],
      notes: `Fixed beam (D-53): ${f2(beam.len)}" long, x = ${f2(beam.x)}" (${p.frontBeamBehindKingpinIn}" behind the kingpin line), top ${f2(beam.top)}" (${f2(p.frontBeamDepthIn / 2)}" above the stub axis), bottom ${f2(beam.bot)}". Underslung like the rear beam: the nose rails are notched to bear on its top (front-mount.ts, WS-B) and 316 angle hold-downs tie it to them. The bracket crush sleeves go inside the tube at the ${frac(kpBolt)}" bolts. The ends stand ${f2(ack.kpHalf - beam.len / 2)}" from the kingpin axis (boss radius + KPI lean + web).`,
    }));
  }

  // ── Kingpin brackets: 3/16" A36 C-channel from one bent flat blank (outsourced), bolted to the beam end face ──
  for (const s of [1, -1] as const) {
    const tag = sIdx(s);
    const br = F.bracket[tag];
    const t = linkT;
    const u0 = beam.len / 2, uPiv = ack.kpHalf, uEnd = uPiv + p.kingpinBracketLeafRadiusIn;
    const zLo = br.web.z0, zHi = br.upperLeaf.z1;
    const profile: Vec2[] = [
      [u0, zLo], [uEnd, zLo], [uEnd, zLo + t], [u0 + t, zLo + t],
    ];
    // C section (u = |y|, z): web against the beam end, lower leaf at the lower-leaf height, upper leaf at the upper-leaf height.
    const lo = br.lowerLeaf, up = br.upperLeaf;
    const sec: Vec2[] = [
      [u0, zLo], [u0 + t, zLo], [u0 + t, lo.z0], [uEnd, lo.z0], [uEnd, lo.z1], [u0 + t, lo.z1], [u0 + t, up.z0], [uEnd, up.z0], [uEnd, up.z1], [u0, up.z1],
    ];
    void profile; void zHi;
    const x0 = br.footprint.x0, x1 = br.footprint.x1, w = x1 - x0;
    const area = polyArea(sec);
    const m: Mat4 = [0, s, 0, 0, 0, 0, 1, 0, s, 0, 0, 0, s > 0 ? x0 : x1, 0, 0, 1];
    const bd = p.kingpinBracketBoltDiaIn;
    parts.push(mk(ctx, {
      id: `kp-bracket-${tag}`, partNo: 'kp-bracket', name: `Kingpin bracket ${tag}`, kind: 'metal', material: '3/16" A36 steel plate, laser cut and press-brake bent',
      geometry: { type: 'extrusion', outline: sec, depth: w }, transform: m, massLb: steelLb(ctx, area * w), fab: 'outsource', step: STEP.gear,
      explode: [0, s, -0.1], stock: { t, w: Math.max(...sec.map((q) => q[1])) - zLo + (uEnd - u0), l: w },
      sourcing: { vendor: `Outsourced laser cut and press-brake bend (SendCutSend / Xometry / local fab shop class), ${frac(t)}" A36 plate, one flat blank bent twice; the DXF comes from the cut list. Zinc or powder coat after bending. No welding (D-51)` },
      joints: [bolt(beam.top > 0 ? 'beam-F' : 'beam-F', 4, bd, `${frac(bd)}" grade 8 x ${inchesText(boltLength(beam.thick + t, bd))} through the beam end (web, both tube walls... bolts run fore-aft through the web and the tube, crush sleeves inside the tube), nylock nuts`, 'two rows of two bolts on the web, across the beam end face', br.bolts.map((b) => toLocal(m, b.pos)))],
      notes: `Web ${f2(t)}" on the beam end face (|y| ${f2(u0)}" to ${f2(u0 + t)}"), leaves ${f2(lo.z0)}-${f2(lo.z1)}" and ${f2(up.z0)}-${f2(up.z1)}" (gap ${f2(p.kingpinBracketGapIn)}" for the boss and shims), reaching ${f2(p.kingpinBracketLeafRadiusIn)}" past the kingpin axis at |y| ${f2(uPiv)}". Caster ${p.casterDeg} deg and KPI ${p.kingpinInclinationDeg} deg are built in as hole offsets between the upper and lower leaf (offset = leaf gap x tan angle); the kingpin bolt hole in each leaf is drilled to the offset from the cut list. Plan kinematics neglect the tilt (spec 1.2).`,
    }));
  }

  // ── Spindles: purchased racing-kart spindles (stand-in mesh), their bolt-on steering arms and the kingpin bolts ──
  const bossR = p.spindleBossRadiusIn;
  const bossH = p.spindleBossLengthIn;
  const hubIn = p.hubLengthIn / 2;
  for (const s of [1, -1] as const) {
    const tag = sIdx(s);
    const kn = F.knuckle[tag];
    const st = tag === 'L' ? F.stub.L : F.stub.R;
    // The modeled boss and bolt are VERTICAL through the kingpin point: the plan kinematics rotate a body about a vertical axis (KPI and caster neglected, spec 1.2), and a
    // tilted boss turned about a vertical axis would sweep a cone through the bracket web. The bracket holes carry the tilt (kn.bossAxis is the published design axis).
    const axis: Vec3 = [0, 0, 1];
    const bossC: Vec3 = [F.kp[tag][0], F.kp[tag][1], r + p.spindleBossAboveStubIn];
    // Boss (along the tilted kingpin axis), stub (along y, root at the hub inner face), a carrier tube from the boss to the stub root, and the foot post that carries the steering arm.
    const bossA = sub3(bossC, mul3(axis, bossH / 2)), bossB = add3(bossC, mul3(axis, bossH / 2));
    const stubRoot: Vec3 = [st[0], s * (Math.abs(st[1]) - hubIn), st[2]];
    const stubTip: Vec3 = [st[0], stubRoot[1] + s * p.spindleStubLengthIn, st[2]];
    const outward = unit3([stubRoot[0] - bossC[0], stubRoot[1] - bossC[1], 0]);
    const knee: Vec3 = [bossC[0] + outward[0] * (bossR + 0.7), bossC[1] + outward[1] * (bossR + 0.7), bossC[2] - 0.5];
    const carrierR = 0.45;
    const foot: Vec3 = [kn.foot[0], kn.foot[1], 0];
    const footTop: Vec3 = [foot[0], foot[1], st[2] + 0.2];
    const footBot: Vec3 = [foot[0], foot[1], tieZ + p.steerArmThickIn / 2];
    const mesh = mergeMeshes(
      tubeAlong([bossA, bossB], bossR, 14),
      tubeAlong([knee, [bossC[0] + outward[0] * 0.2, bossC[1] + outward[1] * 0.2, bossC[2] - 0.2]], carrierR, 10),
      tubeAlong([knee, stubRoot], carrierR, 10),
      tubeAlong([stubRoot, stubTip], stubD / 2, 12),
      tubeAlong([footTop, footBot], 0.3, 10),
    );
    parts.push(mk(ctx, {
      id: `spindle-${tag}`, partNo: 'spindle', name: `Kart spindle ${tag}`, kind: 'purchased', material: `forged chromoly racing-kart spindle, ${f2(stubD * 25.4)} mm stub (hardened)`,
      geometry: { type: 'mesh', positions: mesh.positions, indices: mesh.indices }, transform: translation(0, 0, 0), body: knuckleBody(s), massLb: p.spindleMassLb,
      fab: 'buy', step: STEP.spindles, explode: unit3([0, s, -0.5]),
      sourcing: { vendor: `Racing-kart parts retailer (kart spindle with ${f2(stubD * 25.4)} mm stub, kingpin boss ${f2(2 * bossR)}" OD, brake boss; a hardened chromoly forging). STAND-IN GEOMETRY: confirm the real part's stub diameter and length, kingpin bolt size (3/8" assumed; karts are often M8/M10), boss height, caster/KPI, steering-arm hole and arm angle (${p.ackermannAngleDeg} deg assumed), brake boss, material and any published rating before ordering (spec 12.1). Load test one spindle + bracket + wheel before riding at speed` },
      joints: [{ type: 'pin', to: `wheel-F${tag}`, count: 1, diaIn: p.wheelCotterDiaIn, size: `${f2(stubD * 25.4)} mm stub through the wheel bore sleeve; castle nut + ${frac(p.wheelCotterDiaIn)}" cotter pin retain the wheel` }],
      notes: `Stand-in parametric mesh (spec 1.1): kingpin boss R ${f2(bossR)}" x ${f2(bossH)}" long between the bracket leaves (shim stack takes up the ${f2(p.kingpinBracketGapIn - bossH)}" slack), stub root at the hub inner face, a carrier tube between them and a foot post that carries the bolt-on steering arm. Rotates about its own kingpin by the solved knuckle angle (planar; KPI and caster neglected in the rotation).`,
    }));
    // Bolt-on steering arm at the tie rod height (below the beam; it sweeps under the beam end).
    const tip = F.armTip[tag];
    const hull = kn.armHull;
    parts.push(plate(ctx, {
      id: `steer-arm-${tag}`, partNo: 'steer-arm', name: `Steering arm ${tag}`, outline: hull, z0: tieZ - p.steerArmThickIn / 2, t: p.steerArmThickIn,
      material: `${frac(p.steerArmThickIn)}" A36 steel arm (kart steering-arm kit)`, body: knuckleBody(s), fab: 'buy', step: STEP.spindles, explode: unit3([0, s, -0.6]),
      sourcing: { vendor: `Kart steering-arm kit or outsourced ${frac(p.steerArmThickIn)}" A36 plate; the tip hole takes the ${frac(p.tieRodEndDiaIn)}" rod end bolt at ${f2(p.steerArmLengthIn)}" from the kingpin axis and ${p.ackermannAngleDeg} deg off the car's axis (the Ackermann angle). Verify against the real spindle (spec 12.1/12.11)` },
      joints: [bolt(`spindle-${tag}`, 1, 0.3125, `${frac(0.3125)}" bolt up into the spindle foot post, nylock nut`), bolt('tie-rod', 1, p.tieRodEndDiaIn, `${frac(p.tieRodEndDiaIn)}" bolt through the rod end at the arm tip`)],
      notes: `Arm tip pin at (${f2(tip[0])}", ${f2(tip[1])}") at the neutral pose, z ${f2(tieZ)}": ${f2(beam.bot - (tieZ + p.steerArmThickIn / 2))}" under the beam bottom, so it sweeps under the beam end and the bracket web at every steering angle. Plate hull of the foot, the kingpin axis and the tip.`,
    }));
    // Kingpin bolt (grade 8) through the upper leaf, the boss and the lower leaf, with shim stack and nylock nut.
    const d = p.kingpinDiameterIn;
    const bracketGrip = F.bracket[tag].upperLeaf.z1 - F.bracket[tag].lowerLeaf.z0;
    const bl = boltLength(bracketGrip, d);
    // Shank from under the head (on a hardened washer on the upper leaf) down through the leaves and the boss; thread and nylock nut below the lower leaf.
    const zTopShank = F.bracket[tag].upperLeaf.z1 + washerThick(d);
    const top: Vec3 = [F.kp[tag][0], F.kp[tag][1], zTopShank], bot: Vec3 = [F.kp[tag][0], F.kp[tag][1], zTopShank - bl];
    parts.push(mk(ctx, {
      id: `kingpin-bolt-${tag}`, partNo: 'kingpin-bolt', name: `Kingpin bolt ${tag}`, kind: 'purchased', material: `grade 8 ${frac(d)}" hex bolt, hardened washers, shim stack and nylock nut`,
      geometry: { type: 'cylinder', radius: d / 2, length: bl }, transform: alongZ(bot, top), body: 'chassis',
      massLb: steelLb(ctx, Math.PI * (d / 2) ** 2 * bl * 1.2) + 0.03, fab: 'buy', step: STEP.spindles, explode: unit3([0, 0, 1]),
      sourcing: { vendor: `${VENDOR}: grade 8 hex bolt ${frac(d)}" x ${inchesText(bl)}" (unthreaded shank across the leaves and the boss), 2 hardened flat washers, 0.060" shim washers as needed, nylock nut. The bolt is the kingpin: it does not turn with the spindle (it is clamped by the leaves); the boss turns on it (bronze or needle bushing in the boss: spec 12.1)` },
      joints: [bolt(`kp-bracket-${tag}`, 2, d, `${frac(d)}" kingpin bolt through the upper and lower leaf`), bolt(`spindle-${tag}`, 1, d, `through the spindle boss bushing`)],
      notes: `Drawn vertical (the design axis is tilted ${p.casterDeg} deg back and ${p.kingpinInclinationDeg} deg in; the leaf holes carry the offset); passes the kingpin point (${f2(F.kp[tag][0])}", ${f2(F.kp[tag][1])}") at hub height. Fixed to the chassis (clamped by the leaves).`,
    }));
  }

  // ── Tie rod, drag link, bellcrank, bell bracket, input standoff and the tongue-link pin ──
  {
    const d = p.tieRodDiaIn, ed = p.tieRodEndDiaIn;
    const rodVol = Math.PI * (d / 2) ** 2 * ack.tieLen;
    parts.push(mk(ctx, {
      id: 'tie-rod', name: 'Tie rod', kind: 'purchased', material: `${frac(d)}" threaded rod with left- and right-hand ${frac(ed)}" rod ends and jam nuts (adjustable toe)`,
      geometry: { type: 'cylinder', radius: d / 2, length: ack.tieLen }, transform: alongZ([F.tieRod.x, -ack.tieLen / 2, tieZ], [F.tieRod.x, ack.tieLen / 2, tieZ]), body: 'tie-rod',
      massLb: steelLb(ctx, rodVol) + 0.25, fab: 'buy', step: STEP.linkage, explode: unit3([-0.5, 0, -1]),
      sourcing: { vendor: `${VENDOR}: ${frac(d)}" threaded rod (grade 5 or better) cut to ${f2(ack.tieLen + 2.2)}" and a left-hand and a right-hand ${frac(ed)}"-bore rod end (heim joint, 1/2"-20 shank) with jam nuts; the length (pin to pin ${f2(ack.tieLen)}") is DERIVED from the arm geometry: set toe to zero with the wheels straight, then lock the nuts` },
      joints: [bolt('steer-arm-L', 1, ed, `${frac(ed)}" bolt, rod end to the left arm tip`), bolt('steer-arm-R', 1, ed, `${frac(ed)}" bolt, rod end to the right arm tip`), bolt('drag-link', 1, ed, `${frac(ed)}" bolt through the center clevis tab to the drag link`)],
      notes: `Behind the beam (rod axis ${f2(F.tieRod.x)}" x, ${f2(beam.bot - (tieZ + d / 2))}" under the beam bottom). Length ${f2(ack.tieLen)}" pin to pin. A center clevis tab (1/8" strap, clamped with the rod) rises ${f2(dragZ - tieZ)}" to the drag link pin (mass included). Euler buckling of the 27" rod is a check (tie-rod).`,
    }));
    const dr = barXY(F.bellcrank.outPin, [F.tieRod.x, 0], dragZ);
    parts.push(mk(ctx, {
      id: 'drag-link', name: 'Drag link', kind: 'metal', material: `${frac(linkT)}" A36 flat bar link with bushed ${frac(ed)}" holes`,
      geometry: { type: 'box', size: [dr.len + p.steerArmWidthIn, p.steerArmWidthIn, linkT] }, transform: dr.m, body: 'drag-link',
      massLb: steelLb(ctx, (dr.len + p.steerArmWidthIn) * p.steerArmWidthIn * linkT), fab: 'drill-tap', step: STEP.linkage, explode: unit3([-0.5, 0, -1]),
      stock: { t: linkT, w: p.steerArmWidthIn, l: dr.len + p.steerArmWidthIn },
      sourcing: { vendor: `${VENDOR}: ${frac(linkT)}" x ${frac(p.steerArmWidthIn)}" A36 flat bar cut ${f2(dr.len + p.steerArmWidthIn)}", two ${f2(ed + 0.03)}" holes ${f2(dr.len)}" apart (derived), flanged bronze bushings; or two ${frac(ed)}" rod ends on a short rod if the length allows (it is only ${f2(dr.len)}" between pins)` },
      joints: [bolt('bellcrank', 1, ed, `${frac(ed)}" bolt at the output pin`), bolt('tie-rod', 1, ed, `${frac(ed)}" bolt at the tie-rod center clevis`)],
      notes: `Runs ACROSS the car, ${f2(dr.len)}" between pins, nearly along y: it has to carry the tie-rod center's sideways travel (the Stage 0 along-the-car layout was a near toggle; docs/phase3b-wsA-notes.md). Plane z ${f2(dragZ)}" (just over the tie rod, under the bellcrank plate).`,
    }));
    const bc = F.bellcrank;
    const pv = bc.pivot;
    const bell = plate(ctx, {
      id: 'bellcrank', name: 'Bellcrank', outline: bc.plate, z0: bellZ - bellT / 2, t: bellT, material: `${frac(bellT)}" A36 steel plate, laser cut`, body: 'bellcrank',
      fab: 'outsource', step: STEP.linkage, explode: unit3([-0.5, 0, -1]),
      sourcing: { vendor: `Outsourced laser cut ${frac(bellT)}" A36 plate (the DXF comes from the cut list); bore the pivot hole ${f2(0.3125 + 0.03)}" with a flanged bronze bushing; zinc plate` },
      joints: [bolt('bell-bracket', 1, 0.3125, `${frac(0.3125)}" grade 8 pivot bolt through the bracket plate and the bellcrank, nylock nut`, undefined, [[pv[0], pv[1], bellT / 2]])],
      notes: `Pivot at (${f2(pv[0])}", 0), ${p.bellcrankPivotAftOfKingpinIn}" behind the kingpin line. Output arm ${f2(ack.bellArm)}" at ${f2(ack.bellOutDeg ?? 0)} deg (drag link pin), input arm ${f2(ack.bellInArm ?? 0)}" at ${f2(ack.bellInDeg ?? 0)} deg (tongue-link standoff) The plate is the hull of those two pins and the pivot. Plane z ${f2(bellZ)}".`,
    });
    parts.push(bell);
    parts.push(plate(ctx, {
      id: 'bell-bracket', name: 'Bellcrank bracket', outline: bc.bracket, z0: bc.bracketZ - linkT / 2, t: linkT, material: `${frac(linkT)}" A36 steel plate, laser cut`,
      fab: 'outsource', step: STEP.gear, explode: unit3([-0.2, 0, 0.6]),
      sourcing: { vendor: `Outsourced laser cut ${frac(linkT)}" A36 plate; two ${frac(0.3125)}" through-bolts into the beam rear face (crush sleeves in the tube), nylock nuts on the front face` },
      joints: [bolt('beam-F', 2, 0.3125, `${frac(0.3125)}" grade 8 x ${inchesText(boltLength(beam.thick + linkT, 0.3125))} through the plate and the tube (fore-aft), crush sleeve, nylock nut`), bolt('bellcrank', 1, 0.3125, 'pivot bolt (counted with the bellcrank)')],
      notes: `Carries the bellcrank pivot, cantilevered ${f2(beam.x - beam.thick / 2 - pv[0])}" aft of the beam rear face, over the tie rod and the drag link (plane z ${f2(bc.bracketZ)}"). WS-D: check the bracket bending and the two bolts under the bellcrank pivot load.`,
    }));
    // Tongue-link standoff: the bellcrank input pin stands up to the tongue-link plane (over the beam).
    const so = F.tongue.link.z0;
    const soBot = bellZ + bellT / 2;
    parts.push(mk(ctx, {
      id: 'bell-standoff', name: 'Bellcrank input standoff', kind: 'purchased', material: '3/4" hex steel standoff, tapped both ends',
      geometry: { type: 'cylinder', radius: 0.375, length: so - soBot }, transform: alongZ([bc.inPin[0], bc.inPin[1], soBot], [bc.inPin[0], bc.inPin[1], so]), body: 'bellcrank',
      massLb: steelLb(ctx, Math.PI * 0.375 ** 2 * (so - soBot)) * 0.8, fab: 'buy', step: STEP.linkage, explode: unit3([-0.2, 0, -1]),
      sourcing: { vendor: `${VENDOR}: 3/4" hex steel standoff ${inchesText(so - soBot)}" long (or a turned spacer), 1/4-20 tapped; the top takes the tongue-link pin` },
      joints: [bolt('bellcrank', 1, 0.25, '1/4-20 screw up through the input arm into the standoff')],
      notes: `Lifts the tongue-link pin ${f2(so - soBot)}" so the link passes over the beam top (${f2(beam.top)}") under the deck.`,
    }));
    // Tongue-link pin: a clevis pin through the link end into the standoff top (pull it and the link, tongue and bridle come off for transport, D-9).
    {
      const sock = F.bellcrank.linkPinAt;
      const pinTopZ = F.tongue.link.z1 + 0.2;
      const pinLen = 1.4;
      parts.push(mk(ctx, {
        id: 'tongue-link-pin', name: 'Tongue link pin', kind: 'purchased', material: `${frac(p.tongueLinkPinDiaIn)}" grade 8 clevis pin with lanyard and hairpin`,
        geometry: { type: 'cylinder', radius: p.tongueLinkPinDiaIn / 2, length: pinLen }, transform: alongZ([sock[0], sock[1], pinTopZ - pinLen], [sock[0], sock[1], pinTopZ]), body: 'bellcrank',
        massLb: 0.1, fab: 'buy', step: STEP.linkage, removable: true, explode: unit3([-0.2, 0, 1]),
        sourcing: { vendor: `${VENDOR}: ${frac(p.tongueLinkPinDiaIn)}" clevis pin ${inchesText(pinLen)}" with a hairpin cotter and a stainless lanyard cable to the bell bracket (captured)` },
        joints: [bolt('bell-standoff', 1, p.tongueLinkPinDiaIn, 'through the tongue-link end into the standoff top')],
        notes: `At (${f2(sock[0])}", ${f2(sock[1])}", z ${f2(sock[2])}"). Pull it to lift the tongue link off the bellcrank (transport, D-9). The tongue drives the bellcrank directly through this pin (D-53: no mode plate, no stick).`,
      }));
    }
  }

  // ── Tow-lock stops: blocks under the beam, urethane face against the steering arm at the inner lock ──
  for (const s of [1, -1] as const) {
    const tag = sIdx(s);
    const ts = F.towStop[tag];
    const c = ts.center;
    parts.push(mk(ctx, {
      id: `steer-stop-tow-${tag}`, partNo: 'steer-stop-tow', name: `Tow-lock stop ${tag}`, kind: 'metal', material: 'A36 steel block with a urethane bumper face',
      geometry: { type: 'box', size: ts.size }, transform: basis(c, [Math.cos(ts.rotRad), Math.sin(ts.rotRad), 0], [-Math.sin(ts.rotRad), Math.cos(ts.rotRad), 0], [0, 0, 1]),
      massLb: steelLb(ctx, ts.size[0] * ts.size[1] * ts.size[2]) + 0.03, fab: 'drill-tap', step: STEP.gear, explode: unit3([0, s, -0.6]),
      stock: { t: ts.size[0], w: ts.size[1], l: ts.size[2] },
      sourcing: { vendor: `${VENDOR}: 3/4" square A36 bar cut ${f2(ts.size[2])}", 1/4-20 set screw (adjusts the lock) in the bearing face with a 1/8" urethane pad; one ${frac(0.3125)}" bolt up through the beam bottom wall into a tapped plate` },
      joints: [bolt('beam-F', 1, 0.3125, `${frac(0.3125)}" bolt up through the block into the beam bottom (backed by a plate inside the tube), nylock nut inside`)],
      notes: `Primary tow-lock stop (D-53): the steering arm of the INNER wheel meets this block's face at ${ack.towLockInnerDeg} deg (adjust with the set screw to ${ack.towLockInnerDeg} +/- 0.1). It sits under the beam at the arm's leading edge (${f2(ts.size[2])}" tall, ${f2(beam.bot - (c[2] - ts.size[2] / 2) - ts.size[2])}" under nothing else), 65% of the way out the arm; the outer wheel is held by the 4-bar.`,
    }));
  }

  // ── Tongue (hinged ahead of the beam) and its clevis, link and tie ──
  {
    const T = F.tongue;
    const hinge = T.hinge;
    const tongueLen = T.tipX - T.rearX;
    const pinD = p.tongueHingePinDiaIn;
    parts.push(mk(ctx, {
      id: 'tongue', name: 'Tongue', kind: 'lumber', material: 'white oak', geometry: { type: 'box', size: [tongueLen, p.tongueThickIn, p.tongueDepthIn] },
      transform: translation((T.rearX + T.tipX) / 2, 0, T.z), body: 'tongue', massLb: woodMassLb(p, tongueLen * p.tongueThickIn * p.tongueDepthIn, 2 * (tongueLen * (p.tongueThickIn + p.tongueDepthIn) + p.tongueThickIn * p.tongueDepthIn), p.oakDensityPcf),
      fab: 'table-saw', step: STEP.spindles, grain: 'x', removable: true, explode: unit3([1, 0, -0.1]),
      stock: { t: Math.min(p.tongueThickIn, p.tongueDepthIn), w: Math.max(p.tongueThickIn, p.tongueDepthIn), l: tongueLen },
      rough: roughOf(p, { t: Math.min(p.tongueThickIn, p.tongueDepthIn), w: Math.max(p.tongueThickIn, p.tongueDepthIn), l: tongueLen }),
      joints: [bolt('tongue-hinge-top', 1, pinD, `${frac(pinD)}" grade 8 hinge pin through the tongue (reamed hole, oiled-bronze bushing), vertical`), bolt('tongue-plate', 2, 0.25, '1/4-20 carriage bolts down through the ear plate into the tongue top, through the arc slots in the hinge top plate')],
      notes: `Oak tongue, ${p.tongueThickIn}" x ${p.tongueDepthIn}", measured from the front axle: tip at x = ${f2(T.tipX)}". Top ${f2(T.top)}" (${f2(T.top - beam.top)}" over the beam top, under the front transom), rear end rounded about the hinge pin at x = ${f2(hinge[0])}" (${p.tongueHingeAheadOfBeamIn}" ahead of the beam front face). Yaws +/- ${p.tongueMaxYawDeg} deg (the exact linkage needs ${f2(yawLock)} deg at the tow lock). Removable for transport (D-9).`,
    }));
    const earHull = hullDiscs(hinge, 0.9, T.linkPin, 0.5);
    parts.push(plate(ctx, {
      id: 'tongue-plate', name: 'Tongue ear plate', outline: earHull, z0: T.plate.z0, t: T.plate.z1 - T.plate.z0, material: `${frac(linkT)}" A36 steel plate, laser cut`, body: 'tongue',
      fab: 'outsource', step: STEP.spindles, removable: true, explode: unit3([1, 0, 0.5]),
      sourcing: { vendor: `Outsourced laser cut ${frac(linkT)}" A36 plate; hinge pin hole ${f2(pinD + 0.03)}", ear hole ${f2(p.tieRodEndDiaIn + 0.03)}", two ${f2(0.25 + 0.03)}" holes for the tongue bolts` },
      joints: [bolt('tongue-link', 1, p.tieRodEndDiaIn, `${frac(p.tieRodEndDiaIn)}" bolt at the ear`)],
      notes: `Rides on the hinge top plate, bolted to the tongue by two bolts that pass through arc slots in the top plate (+/- ${p.tongueMaxYawDeg} deg). The ear is ${f2(-p.tongueEarAheadIn)}" behind and ${f2(p.tongueLinkArmIn)}" to the right of the hinge pin: the yaw moves it fore-aft, which the tongue link transmits (the re-laid linkage, docs/phase3b-wsA-notes.md). Passes over the beam top (${f2(T.plate.z0 - beam.top)}" clear).`,
    }));
    const tl = barXY(T.linkPin, F.bellcrank.inPin, (T.link.z0 + T.link.z1) / 2);
    parts.push(mk(ctx, {
      id: 'tongue-link', name: 'Tongue link', kind: 'metal', material: `${frac(linkT)}" A36 flat bar link with bushed holes`,
      geometry: { type: 'box', size: [tl.len + armW, armW, linkT] }, transform: tl.m, body: 'tongue-link', massLb: steelLb(ctx, (tl.len + armW) * armW * linkT),
      fab: 'drill-tap', step: STEP.spindles, removable: true, explode: unit3([0.5, 0, 0.5]), stock: { t: linkT, w: armW, l: tl.len + armW },
      sourcing: { vendor: `${VENDOR}: ${frac(linkT)}" x ${frac(armW)}" A36 flat bar cut ${f2(tl.len + armW)}", holes ${f2(tl.len)}" apart (derived), flanged bronze bushings` },
      joints: [bolt('tongue-plate', 1, p.tieRodEndDiaIn, `${frac(p.tieRodEndDiaIn)}" bolt at the ear`), bolt('tongue-link-pin', 1, p.tongueLinkPinDiaIn, 'clevis pin into the standoff top')],
      notes: `${f2(tl.len)}" between pins; runs over the beam top at z ${f2(T.link.z0)}-${f2(T.link.z1)}" (${f2(T.link.z0 - beam.top)}" over it, ${f2(L.deckBot - T.link.z1)}" under the deck). Slides off its pin when the link pin is pulled: the tongue then swings free.`,
    }));
    // Hinge clevis: top and bottom plates, two walls with flanges bolted to the beam front face.
    const bf = beam.x + beam.thick / 2;
    const hx1 = hinge[0] + 0.75;
    const yIn = Math.hypot(hinge[0] - T.rearX, p.tongueThickIn / 2) + 0.25;
    const wallT = linkT;
    const mkBox = (id: string, name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, joints: Joint[], notes: string) => parts.push(mk(ctx, {
      id, partNo: id.replace(/-[LR]$/, ''), name, kind: 'metal', material: `${frac(linkT)}" A36 steel plate`, geometry: { type: 'box', size: [x1 - x0, y1 - y0, z1 - z0] },
      transform: translation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), massLb: steelLb(ctx, (x1 - x0) * (y1 - y0) * (z1 - z0)), fab: 'outsource', step: STEP.gear,
      explode: unit3([1, 0, 0.3]), stock: { t: Math.min(z1 - z0, y1 - y0), w: Math.max(Math.min(x1 - x0, Math.max(z1 - z0, y1 - y0)), 0.1), l: Math.max(x1 - x0, y1 - y0, z1 - z0) }, sourcing: { vendor: 'Outsourced laser cut A36 plate (hinge clevis kit, bent and bolted: no welding)' }, joints, notes,
    }));
    mkBox('tongue-hinge-top', 'Tongue hinge top plate', bf, hx1, -yIn, yIn, T.hingeTop.z0, T.hingeTop.z1, [bolt('tongue-hinge-wall-L', 2, 0.25, '1/4-20 screws to the left wall'), bolt('tongue-hinge-wall-R', 2, 0.25, '1/4-20 screws to the right wall')], `Upper leaf of the double-shear hinge: ${frac(p.tongueClevisThickIn)}" plate (nominal ${frac(linkT)}" modeled) over the tongue, with two arc slots for the ear-plate bolts. The ear plate rides on it.`);
    mkBox('tongue-hinge-bottom', 'Tongue hinge bottom plate', bf, hx1, -yIn, yIn, T.hingeBot.z0, T.hingeBot.z1, [bolt('tongue-hinge-wall-L', 2, 0.25, '1/4-20 screws to the left wall'), bolt('tongue-hinge-wall-R', 2, 0.25, '1/4-20 screws to the right wall')], 'Lower leaf of the double-shear hinge, under the tongue.');
    for (const s of [1, -1] as const) {
      const tag = sIdx(s);
      const y0 = s > 0 ? yIn : -yIn - wallT, y1 = s > 0 ? yIn + wallT : -yIn;
      const wallJ: Joint[] = [bolt('beam-F', 2, 0.3125, `${frac(0.3125)}" bolts through the wall's rear flange and the tube (fore-aft), crush sleeves, nylock nuts`)];
      mkBox(`tongue-hinge-wall-${tag}`, `Tongue hinge wall ${tag}`, bf, hx1, y0, y1, T.hingeBot.z0, T.hingeTop.z1, wallJ, `Side wall of the hinge box (${f2(yIn)}" off the centerline: clears the tongue's rear corner at ${p.tongueMaxYawDeg} deg yaw); a flange bent out at the rear is bolted to the beam front face (flange not drawn).`);
    }
    const pinLen = T.plate.z1 - T.hingeBot.z0 + 0.33 + 0.64;
    parts.push(mk(ctx, {
      id: 'tongue-hinge-pin', name: 'Tongue hinge pin', kind: 'purchased', material: `${frac(pinD)}" grade 8 hex bolt, hardened washers and nylock nut`,
      geometry: { type: 'cylinder', radius: pinD / 2, length: pinLen }, transform: alongZ([hinge[0], hinge[1], T.hingeBot.z0 - 0.64], [hinge[0], hinge[1], T.plate.z1 + 0.33]), body: 'chassis',
      massLb: steelLb(ctx, Math.PI * (pinD / 2) ** 2 * pinLen * 1.15) + 0.04, fab: 'buy', step: STEP.spindles, removable: true, explode: unit3([0, 0, 1]),
      sourcing: { vendor: `${VENDOR}: grade 8 hex bolt ${frac(pinD)}" x ${inchesText(pinLen - 0.4)}", 2 hardened washers, nylock nut` },
      joints: [bolt('tongue-hinge-bottom', 1, pinD, 'hinge pin: double shear between the top and bottom plates')],
      notes: `Vertical, at (${f2(hinge[0])}", ${f2(hinge[1])}"): head up over the ear plate, nut under the bottom plate. The tongue turns on it (bushing in the tongue); double shear between the fixed top and bottom plates.`,
    }));
    // Tongue-tip tie: a vertical shoulder eye bolt through the tongue, and the single bridle lead (hidden in the viewer).
    const d = p.eyeBoltDiameterIn;
    const eyeR = (d * 2.7) / 2 - (d * 0.9) / 2;
    const eyeC: Vec3 = [T.tipX - 1.5, 0, T.top + p.eyeBoltEyeOffsetIn];
    const shank: Vec3[] = [[0, 0, -(p.eyeBoltEyeOffsetIn + p.tongueDepthIn + 0.55)], [0, 0, -eyeR - (d * 0.9) / 2]];
    const ring = circlePath([0, 0, 0], [0, 1, 0], eyeR, 20);
    const em = mergeMeshes(tubeAlong(shank, d / 2, 10), tubeAlong(ring, (d * 0.9) / 2, 8, true));
    const vol = Math.PI * (d / 2) ** 2 * pathLength(shank) + Math.PI * ((d * 0.9) / 2) ** 2 * pathLength(ring, true);
    parts.push(mk(ctx, {
      id: 'eyebolt-T', partNo: 'bridle-eyebolt', name: 'Tongue tip eye bolt', kind: 'purchased', material: 'forged steel shoulder eye bolt', geometry: { type: 'mesh', positions: em.positions, indices: em.indices },
      transform: translation(eyeC[0], eyeC[1], eyeC[2]), body: 'tongue', massLb: steelLb(ctx, vol) + 0.04, fab: 'buy', step: STEP.spindles, removable: true, explode: unit3([1, 0, 0.3]),
      sourcing: { vendor: `${VENDOR}: forged shoulder eye bolt ${frac(d)}" (nut-style, ${f2(p.tongueDepthIn + 0.9)}" shank) with a ${frac(p.eyeBoltWasherDiameterIn)}" OD fender washer and lock nut under the tongue. THE EYE BOLT IS THE INTENDED WEAK LINK of the rope tie (D-47): confirm its working-load limit is at least ${p.pullForceLbf * p.bridleTieOverloadFactor} lbf at the rope angle (tongue-tie)` },
      joints: [bolt('tongue', 1, d, `${frac(d)}" shoulder eye bolt vertical through the tongue tip, ${frac(p.eyeBoltWasherDiameterIn)}" washer + nut below`)],
      notes: `Vertical eye ${f2(p.eyeBoltEyeOffsetIn)}" over the tongue top, ${f2(T.tipX - eyeC[0])}" back from the tip (D-14: the single-lead tie moved from the beam to the tongue tip).`,
    }));
    const bl = 18;
    parts.push(mk(ctx, {
      id: 'bridle', name: 'Bridle rope', kind: 'purchased', material: 'rope', geometry: { type: 'box', size: [bl, 0.5, 0.5] },
      transform: basis([eyeC[0] + bl / 2 + eyeR, 0, eyeC[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1]), body: 'tongue', massLb: 0.5, fab: 'buy', step: STEP.spindles, removable: true, explode: unit3([1, 0, 0]),
      sourcing: { vendor: `${VENDOR}: 1/2" braided polyester rope (low stretch), ${Math.round(p.bridleRopeRunIn / 12)} ft pull tails + lead; tied low to the eye with a bowline or soft shackle` },
      joints: [{ type: 'pin', to: 'eyebolt-T', count: 1, size: 'bowline or soft shackle to the eye bolt' }],
      notes: 'Single lead from the tongue-tip eye (hidden in the viewer); the pull tails continue to the pullers (D-27).',
    }));
  }

  return parts;
}

/** Hull of two discs (radii ra, rb), CCW. */
function hullDiscs(a: Vec2, ra: number, b: Vec2, rb: number): Vec2[] {
  return convexHull([...discPts(a, ra, 14), ...discPts(b, rb, 14)]);
}
