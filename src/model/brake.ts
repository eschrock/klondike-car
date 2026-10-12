/**
 * The handler's foot brake (Phase 3c-3, D-55): a drag bar like the Alaskan sled's in the packet (reference/05), on the rear tires. Bolted only, no welding.
 *
 *   oak PEDAL BAR (behind the transom, 3.25 in off the ground) ── through a slot in the rear end of each A36 plate swing ARM ── the arm pivots on a 3/8" bolt through
 *   a BRACKET tongue bolted to the outside of the cabin rail ── a slot at the front of the arm carries the aluminum SHOE BEAM with a lined steel-backed SHOE at each end.
 *
 * Stepping on the bar swings both arms: the bar goes down, the beam and shoes go forward onto the rear of each tread. Two extension springs lift the bar; a HOOK hung
 * on a bolt through the rear transom drops over a stud on the toe guard and parks it (kick the hook sideways to release it). The aluminum TOE GUARD on the bar's
 * front stops a boot sliding toward the tire. The handlebow (handle.ts) is a plain handle again.
 *
 * `brake-layout.ts` is the single source for the kinematics; both the part builder here and the analysis (`analysis/brake.ts`) read it. Pose s = 0 is released
 * (the model default), s = 1 is applied (shoes on the tread). Plain TS (no three.js).
 */
import type { Params } from '../params';
import { STEP, box, cylinder, SIDES, IN3_PER_FT3, unitDir, type Ctx } from './build-utils';
import { ARM_WEB_IN, HOOK_STANDOFF_IN, atPose, brakeGeometry, hull2, rot2, sub, type BrakeGeom, type V2 } from './brake-layout';
import { buildHandle } from './handle';
import { basisMatrix, profilePart } from './profile';
import { boltLength, inchesText } from './rear-mount';
import type { Joint, Part, Vec2, Vec3 } from './types';

export { atPose, brakeGeometry, rot2, hull2 };
export type { BrakeGeom, V2 };

const RAD = Math.PI / 180;
void RAD;
/** Brake lining density (woven / molded sheet, about 120 lb/ft³): a placeholder for a purchased item. */
const LINING_LB_PER_IN3 = 0.07;
const STEEL_LB_PER_IN3 = 0.2836;
const SPRING_MASS_LB = 0.08;
const STEEL_FINISH = 'Finish: zinc-plated or painted steel; stainless fasteners; epoxy barrier coat where steel or aluminum touches wet tannin-rich oak (BRIEF §5.2).';
const YARD = (what: string): Part['sourcing'] => ({ vendor: `Local steel yard or Metals Depot / McMaster-Carr (${what})` });
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Lined shoe length along the tread (in): the purchased lined steel-backed shoe (D-56). */
export const shoeLengthIn = (p: Params): number => p.brakeLinedShoeLengthIn;
/** Lined shoe width across the tread (in). */
export const shoeWidthIn = (p: Params): number => p.brakeLinedShoeWidthIn;
/** Radial thickness of the lined shoe in inches (steel back + lining). */
export const linedShoeThickIn = (p: Params): number => p.brakeShoeBackThickIn + p.brakeLiningThickIn;

const loopCw = (pts: V2[]): V2[] => [...pts].reverse();
const circleCw = (c: V2, r: number, n = 14): V2[] => Array.from({ length: n }, (_, i): V2 => [c[0] + r * Math.cos((-2 * Math.PI * i) / n), c[1] + r * Math.sin((-2 * Math.PI * i) / n)]);

/** A flat plate part (A36 steel or 6061 aluminum) from a 2D outline with holes, extruded `depth`: 'xz' toward −y from origin.y (the +y face), 'yz' toward +x from origin.x. */
function plate(ctx: Ctx, s: {
  id: string; partNo?: string; name: string; basis: 'xz' | 'yz'; outline: Vec2[]; holes?: Vec2[][]; depth: number; origin: Vec3; alum?: boolean;
  material: string; sourcing: Part['sourcing']; joints?: Joint[]; notes?: string; explode?: Vec3; fab?: Part['fab']; removable?: boolean; cg?: Vec3;
}): Part {
  const { p } = ctx;
  const areaOf = (o: Vec2[]) => { let a = 0; for (let i = 0; i < o.length; i++) { const [x1, y1] = o[i], [x2, y2] = o[(i + 1) % o.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  const area = areaOf(s.outline) - (s.holes ?? []).reduce((m, h) => m + areaOf(h), 0);
  const massLb = (area * s.depth / IN3_PER_FT3) * (s.alum ? p.aluminumDensityPcf : p.steelDensityPcf);
  const xs = s.outline.map((q) => q[0]), zs = s.outline.map((q) => q[1]);
  const spans = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].sort((a, b) => a - b);
  const part: Part = {
    id: s.id, name: s.name, group: 'brake', kind: 'metal', material: s.material,
    geometry: { type: 'extrusion', outline: s.outline.map((q) => [q[0], q[1]] as Vec2), ...(s.holes && s.holes.length ? { holes: s.holes.map((h) => h.map((q) => [q[0], q[1]] as Vec2)) } : {}), depth: s.depth },
    transform: basisMatrix(s.basis, s.origin), body: 'chassis', massLb, fab: s.fab ?? 'outsource', step: STEP.brake, explode: s.explode ?? [-1, 0, -0.3],
    stock: { t: s.depth, w: spans[0], l: spans[1] }, sourcing: s.sourcing,
  };
  if (s.partNo) part.partNo = s.partNo;
  if (s.joints) part.joints = s.joints;
  if (s.notes) part.notes = s.notes;
  if (s.removable) part.removable = true;
  if (s.cg) part.cgIn = s.cg;
  return part;
}

/** Pin, bolt or rod along y (or x, for the latch). */
const rodPart = (ctx: Ctx, s: {
  id: string; partNo?: string; name: string; c: Vec3; axis: 'x' | 'y' | 'z'; length: number; radius: number; massLb: number; material: string; fab?: Part['fab']; joints?: Joint[];
  notes?: string; sourcing?: Part['sourcing']; removable?: boolean; explode?: Vec3; rot?: { x?: number; y?: number; z?: number };
}): Part =>
  cylinder(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: 'fixed', kind: 'purchased', massLb: s.massLb, material: s.material, fab: s.fab ?? 'buy', step: STEP.brake,
    center: s.c, axis: s.axis, radius: s.radius, length: s.length, joints: s.joints, notes: s.notes, explode: s.explode, sourcing: s.sourcing, removable: s.removable, rot: s.rot,
  });

/** Aluminum mass (lb) for a volume in in³. */
const alLb = (p: Params, volIn3: number) => (volIn3 / IN3_PER_FT3) * p.aluminumDensityPcf;

/**
 * Brake parts at pose `s` (0 released, 1 applied; the model default is 0). `analysis/brake.ts` calls this at s = 0 … 1 to sweep the stroke. `movingOnly` leaves out the
 * parts that stay on the cart (brackets, pivot bolts, stop pins, the latch hook and its bolt, the handle).
 */
export function buildBrakeAt(ctx: Ctx, s: number, movingOnly = false): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const g = brakeGeometry(p, L);
  const r = L.r;
  const Y = g.y;
  const phi = s * g.thetaApp; // CCW arm swing from the released frame
  const at = (q: V2): V2 => atPose(g, s, q);
  const add1 = (x: Part | null) => { if (x) parts.push(x); };
  const fixed = (x: Part): Part | null => (movingOnly ? null : x);
  const t = p.brakePlateThickIn;
  const pivD = p.brakePivotBoltDiameterIn;
  const bd = p.brakeBracketBoltDiameterIn;
  const bolt = (to: string, count: number, diaIn: number, sz: string, note?: string): Joint => ({ type: 'bolt', to, count, diaIn, size: sz, ...(note ? { note } : {}) });
  const pinJ = (to: string, sz: string): Joint => ({ type: 'pin', to, count: 1, diaIn: pivD, size: sz });
  const rotPts = (pts: V2[]): V2[] => pts.map(at);

  // ── The oak pedal bar: passes through the arm slots, front-lower edge chamfered (the "kick") ──
  {
    const b = g.bar;
    const k = Math.min(p.brakeBarKickIn, b.w - 0.1, b.h - 0.1);
    const out: V2[] = k > 1e-6
      ? [[b.rear, b.bot], [b.front - k, b.bot], [b.front, b.bot + k], [b.front, b.top], [b.rear, b.top]]
      : [[b.rear, b.bot], [b.front, b.bot], [b.front, b.top], [b.rear, b.top]];
    const yH = Y.barHalf;
    const len = 2 * yH;
    const stock = { t: b.h, w: b.w, l: len };
    const pedal = profilePart(ctx, {
      id: 'brake-pedal', partNo: 'brake-pedal', name: 'Brake pedal bar (white oak)', group: 'brake', mat: 'oak', outline: rotPts(out) as Vec2[], depth: len, basis: 'xz', origin: [0, yH, 0],
      grain: 'y', stock, step: STEP.brake, fab: 'table-saw', explode: [-1, 0, -0.3],
      joints: SIDES.map(({ tag }): Joint => ({
        type: 'bolt', to: `brake-arm-${tag}`, count: 2, diaIn: 0.25,
        size: `2 x 1/4" 316 bolts along z through the bar, one each side of the arm, nylock nuts (they stop the bar sliding in the slot; the slot carries the stomp)`,
      })).concat([{ type: 'bolt', to: 'brake-guard', count: 4, diaIn: 0.25, size: `4 x 1/4" 316 carriage bolts along x through the guard and the bar (${f2(b.w)}" thick), fender washers and nylock nuts on the rear face`, note: 'every 6 in along the lap of the guard on the bar front' }]),
      notes: `White oak ${f2(b.h)}" x ${f2(b.w)}" x ${f2(len)}" (D-55: oak rather than aluminum, same weight, warm and grippy, shop-cut). It passes through a ${f2(b.w + 0.0625)}" x ${f2(b.h + 0.0625)}" slot in each swing arm ${f2(g.y.arm[1] - g.y.arm[0])}" plate and overhangs the arms by 1 in. Ground clearance ${f2(b.bot)}" (arms ${f2(p.brakeBarClearIn)}"), the lower front edge cut at 45 degrees for ${f2(k)}" so a root or rock rides over it (the kick). Grooved or rasped on top for grip. Epoxy-seal before the finish; a 3/4" rubber stair tread strip can be glued on top.`,
      sourcing: { vendor: `Shop-cut white oak, ${f2(b.h)}" x ${f2(b.w)}" x ${f2(len)}" (4/4 stock planed, or a 5/4 board); drill the four 1/4" bolt holes and the guard holes from the arm template` },
    });
    pedal.massLb = pedal.massLb; // mass from the profile (volume x density + finish)
    add1(pedal);
  }

  // ── The toe guard: aluminum plate on the front of the bar, carrying the latch stud ──
  {
    const gd = g.guard;
    const c = at([(gd.x0 + gd.x1) / 2, (gd.z0 + gd.z1) / 2]);
    const h = gd.z1 - gd.z0;
    add1(box(ctx, {
      id: 'brake-guard', partNo: 'brake-guard', name: 'Toe guard (aluminum plate)', group: 'brake', mat: 'fixed', kind: 'metal', step: STEP.brake, fab: 'drill-tap', explode: [1, 0, 0.3],
      massLb: alLb(p, gd.t * 2 * gd.yHalf * h) - alLb(p, 4 * Math.PI * 0.14 ** 2 * gd.t), material: `6061-T6 aluminum plate ${f2(gd.t)}"`, stock: { t: gd.t, w: h, l: 2 * gd.yHalf },
      center: [c[0], 0, c[1]], size: [gd.t, 2 * gd.yHalf, h], rot: { y: -phi },
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum sheet ${f2(gd.t)}" thick, cut ${f2(2 * gd.yHalf)}" x ${f2(h)}"; round the corners and break the edges)` },
      joints: [
        bolt('brake-pedal', 4, 0.25, `4 x 1/4" 316 carriage bolts through the guard and the pedal bar front, ${f2(0.5)}" lap on the bar`),
        bolt('brake-latch-stud', 1, p.brakeLatchPinDiameterIn, `${f2(p.brakeLatchPinDiameterIn)}" 316 bolt through the guard near its top, on the centerline`),
      ],
      notes: `Stands ${f2(p.brakeToeGuardHeightIn)}" above the top of the bar (minimum ${f2(p.brakeToeGuardMinIn)}") so a boot sliding forward off the bar meets a plate, not the tire; the open gap in front of it to the tire is ${f2(g.aApp > 0 ? Math.abs(g.guard.x0 - g.C[0]) : 0)}" or more. It also carries the latch stud. ${STEEL_FINISH.replace('steel; stainless', 'aluminum, anodized or epoxy-coated; stainless')}`,
    }));
  }

  // ── Swing arms (A36 plate): slots for the shoe beam and the pedal bar, a pivot hole ──
  for (const { s: sgn, tag } of SIDES) {
    const [ay0, ay1] = Y.arm;
    const outline = rotPts(g.arm.outline);
    const holes = [loopCw(rotPts(g.arm.beamSlot)), loopCw(rotPts(g.arm.barSlot)), circleCw(g.P, g.arm.holeR)];
    const yHi = sgn > 0 ? ay1 : -ay0;
    add1(plate(ctx, {
      id: `brake-arm-${tag}`, partNo: 'brake-arm', name: `Brake swing arm ${tag}`, basis: 'xz', outline: outline as Vec2[], holes: holes as Vec2[][], depth: t, origin: [0, yHi, 0], fab: 'outsource',
      material: `${f2(t)}" A36 steel plate, laser cut`, explode: [-1, sgn * 0.5, 0],
      sourcing: { vendor: `Outsourced laser cut ${f2(t)}" A36 plate (the DXF comes from the cut list): a ${f2(p.brakeBeamSizeIn + 0.0625)}" x ${f2(p.brakeBeamHeightIn + 0.0625)}" slot, a ${f2(p.brakePedalDepthIn + 0.0625)}" x ${f2(p.brakePedalHeightIn + 0.0625)}" slot and a ${f2(pivD + 0.04)}" pivot hole; zinc plated` },
      joints: [
        pinJ(`brake-pivot-bolt-${tag}`, `${f2(pivD)}" pivot bolt through the bracket tongue and this arm, one shear plane`),
        { type: 'dado', to: 'brake-pedal', count: 1, size: `${f2(p.brakePedalDepthIn + 0.0625)}" x ${f2(p.brakePedalHeightIn + 0.0625)}" slot: the oak bar passes through`, note: 'the slot carries the stomp (bearing across the grain)' },
        { type: 'dado', to: 'brake-beam', count: 1, size: `${f2(p.brakeBeamSizeIn + 0.0625)}" x ${f2(p.brakeBeamHeightIn + 0.0625)}" slot: the shoe beam tube passes through`, note: 'the beam is a continuous beam over the two arms' },
        { type: 'screw', to: `brake-return-spring-${tag}`, count: 1, size: 'spring hook through a 1/4" hole in the plate edge' },
      ],
      notes: `Swing arm ${f2(t)}" plate: pivot ${f2(g.d)}" above the shoe contact (lever ratio ${f2(g.ratioCrit)}:1 at the pedal, ${f2(g.reach)}" behind the pivot), the shoe beam slot just behind the tire, the bar slot at the rear end. It stands outside the bracket tongue with a ${f2(0.0625)}" washer between; swings ${f2(g.thetaApp / RAD)} degrees released to applied. ${STEEL_FINISH}`,
    }));
  }

  // ── The shoe beam: 6061-T6 rectangular tube through both arms ──
  {
    const bm = g.beam;
    const c = at(bm.c);
    const len = 2 * Y.beamHalf;
    const vol = (bm.w * bm.h - (bm.w - 2 * bm.wall) * (bm.h - 2 * bm.wall)) * len;
    add1(box(ctx, {
      id: 'brake-beam', name: 'Brake shoe beam (aluminum tube)', group: 'brake', mat: 'fixed', kind: 'metal', step: STEP.brake, fab: 'drill-tap', massLb: alLb(p, vol),
      material: `6061-T6 aluminum rectangular tube ${f2(bm.w)}" x ${f2(bm.h)}" x ${f2(bm.wall)}" wall`, stock: { t: bm.wall, w: bm.h, l: len },
      center: [c[0], 0, c[1]], size: [bm.w, len, bm.h], rot: { y: -phi }, explode: [-0.5, 0, -1],
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum rectangular tube, ${f2(bm.w)}" x ${f2(bm.h)}" x ${f2(bm.wall)}" wall, 4 ft length; cut ${f2(len)}" on the chop saw or bandsaw, drill the two shoe bolt holes from the template)` },
      joints: [
        bolt('brake-shoe-L', 1, 0.25, `1/4-20 stainless bolt through the front wall into the left shoe's back plate, crush sleeve inside the tube`),
        bolt('brake-shoe-R', 1, 0.25, `1/4-20 stainless bolt through the front wall into the right shoe's back plate, crush sleeve inside the tube`),
        { type: 'dado', to: 'brake-arm-L', count: 1, size: 'passes through the left arm slot' }, { type: 'dado', to: 'brake-arm-R', count: 1, size: 'passes through the right arm slot' },
        bolt('brake-arm-L', 2, 0.1875, '2 x #10 stainless screws through the tube and a 1/2" tab on each side of the arm slot (they stop the tube sliding)'),
      ],
      notes: `Stands ${f2(-g.Sb[0])}" behind the axle, ${f2(g.Sb[1] - bm.h / 2)}" off the ground, ${f2(g.y.beamHalf * 2)}" long; the front face touches the shoe backs. It is a continuous beam on the two arm slots: the shoe thrust bends it in plan between the arms and the shoes. Epoxy barrier coat where the aluminum meets the steel slot. ${STEEL_FINISH}`,
    }));
  }

  // ── Lined shoes (purchased, steel-backed), one at each end of the beam; translated with the beam, they rock on their bolt ──
  for (const { s: sgn, tag } of SIDES) {
    const lt = p.brakeLiningThickIn, bt = p.brakeShoeBackThickIn;
    const delta = g.shoeHalfAngle;
    const N = 8;
    const arc: Vec2[] = [];
    for (let i = 0; i <= N; i++) { const a = g.beta - delta + (2 * delta * i) / N; arc.push([-(r + lt + bt) * Math.cos(a), -(r + lt + bt) * Math.sin(a)]); }
    for (let i = N; i >= 0; i--) { const a = g.beta - delta + (2 * delta * i) / N; arc.push([-r * Math.cos(a), -r * Math.sin(a)]); }
    const faceNow = at(g.beam.face);
    const D: V2 = sub(faceNow, g.Sb);
    const [qy0, qy1] = sgn > 0 ? Y.pad : [-Y.pad[1], -Y.pad[0]];
    const depthL = Y.pad[1] - Y.pad[0];
    const areaL = shoeLengthIn(p) * depthL;
    const cgR = r + (lt + bt) / 2;
    const shoe = plate(ctx, {
      id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe ${tag} (lined, steel-backed)`, basis: 'xz', outline: arc, depth: depthL, origin: [g.O[0] + D[0], Math.max(qy0, qy1), g.O[1] + D[1]],
      material: `${f2(bt)}" steel back + ${f2(lt)}" woven / molded lining, riveted`, fab: 'buy', explode: [0.2, sgn, 0.2],
      cg: [g.O[0] + D[0] - cgR * Math.cos(g.beta), (qy0 + qy1) / 2, g.O[1] + D[1] - cgR * Math.sin(g.beta)],
      sourcing: { vendor: `Purchased lined steel-backed brake shoe (go-kart band / industrial shoe, ${f2(shoeLengthIn(p))}" x ${f2(depthL)}" lining on a ${f2(bt)}" back, radius-matched to the ${f2(2 * r)}" tire), one 1/4" mounting hole in the back. Part number to confirm.` },
      joints: [bolt('brake-beam', 1, 0.25, `1/4-20 stainless bolt, nylock nut, through the shoe back and the beam front wall; a slightly oversize hole lets the shoe rock to follow the tread`)],
      notes: `Lined steel-backed shoe, ${f2(shoeLengthIn(p))}" long x ${f2(depthL)}" wide, on the rear of the tread ${f2(g.beta / RAD)} deg below the axle line. Design μ ${f2(p.brakePadMu)} wet; ${f2(p.brakePadMuFouled)} mud-fouled (pass/fail). Test a lining sample on a wet tire first.`,
    });
    shoe.kind = 'purchased'; shoe.material = `${f2(bt)}" steel back + ${f2(lt)}" woven / molded lining, riveted`;
    shoe.massLb = areaL * (bt * STEEL_LB_PER_IN3 + lt * LINING_LB_PER_IN3) + 0.08;
    delete shoe.stock;
    add1(shoe);
  }

  // ── Bracket tongues (reaching back from the axle beam top), pivot bolts, stop pins ──
  for (const { s: sgn, tag } of SIDES) {
    const [ty0, ty1] = Y.tongue;
    const tg = g.tongue;
    const fl = tg.flange;
    const holes = [circleCw(g.P, g.arm.holeR), circleCw(g.tongue.stop, 0.14)];
    const yHi = sgn > 0 ? ty1 : -ty0;
    const flangeLb = ((fl.x1 - fl.x0) * (fl.y1 - fl.y0) * t * STEEL_LB_PER_IN3) - 2 * Math.PI * (bd / 2 + 0.02) ** 2 * t * STEEL_LB_PER_IN3;
    const bracket = plate(ctx, {
      id: `brake-bracket-${tag}`, partNo: 'brake-bracket', name: `Brake pivot bracket ${tag}`, basis: 'xz', outline: tg.outline as Vec2[], holes: holes as Vec2[][], depth: t, origin: [0, yHi, 0], fab: 'outsource',
      material: `${f2(t)}" A36 steel plate, laser cut and bent`, explode: [-0.3, sgn, -0.5],
      sourcing: { vendor: `Outsourced laser cut ${f2(t)}" A36 plate with one 90 degree bend (one blank per side, DXF from the cut list): a ${f2(pivD + 0.04)}" pivot hole, a 1/4" stop pin hole, and two ${f2(bd + 0.04)}" holes in the ${f2(fl.x1 - fl.x0)}" x ${f2(fl.y1 - fl.y0)}" flange; zinc plated` },
      joints: [
        { type: 'bolt', to: 'beam-R', count: 2, diaIn: bd, size: `2 x ${f2(bd)}" 316 hex bolts, ${inchesText(boltLength(t + tg.beam.depth, bd))}" long, DOWN through the flange and the axle beam in front of the rod, fender washers and nylock nuts under the beam`, note: `the flange lies on the beam top (z ${f2(tg.beam.top)}") at |y| ${f2(fl.y0)}" to ${f2(fl.y1)}", clear of the rod clamp plates; the bolts take the shoe thrust as shear in the beam` },
        pinJ(`brake-pivot-bolt-${tag}`, `${f2(pivD)}" pivot bolt through the tongue and the arm`),
        { type: 'screw', to: `brake-stop-pin-${tag}`, count: 1, diaIn: 0.25, size: '1/4" stop pin through the tongue, over the arm edge' },
      ],
      notes: `Bracket ${f2(t)}" A36: a vertical tongue at the hull's outer face line (|y| ${f2(ty0)}" to ${f2(ty1)}") with the pivot at its rear end ${f2(g.tongue.neck.x1 - tg.neck.x0)}" behind the beam, and a flange bent outboard over the TOP of the rear axle beam (the flange is bent from the tongue's lower edge and is not drawn; its mass is included). Two vertical bolts go through the flange and the beam in front of the rod. The shoe thrust makes a closed loop (tire, hub, rod, beam, this bracket, arm, shoe), so the rails and hangers carry none of it. ${STEEL_FINISH}`,
    });
    bracket.massLb += flangeLb;
    add1(fixed(bracket));
    add1(fixed(rodPart(ctx, {
      id: `brake-pivot-bolt-${tag}`, partNo: 'brake-pivot-bolt', name: `Arm pivot bolt ${tag}`, c: [g.P[0], sgn * (Y.boltIn + Y.boltOut) / 2, g.P[1]], axis: 'y', length: Y.boltOut - Y.boltIn, radius: pivD / 2, massLb: 0.1, removable: true,
      material: `${f2(pivD)}" 316 stainless shoulder bolt, washers, nylock nut`, explode: [0, sgn, 0],
      sourcing: { vendor: `McMaster-Carr (${f2(pivD)}" 316 stainless shoulder bolt, nylon washers each side of the arm, nylock nut; the head is on the inboard side, the nut outboard)` },
      joints: [pinJ(`brake-bracket-${tag}`, 'through the tongue'), pinJ(`brake-arm-${tag}`, 'through the arm')],
      notes: 'The arm turns on this bolt (shoulder bolt: the shoulder is the bearing, the nut is not over-tightened). Head inboard under the rail, nut outboard.',
    })));
    add1(fixed(rodPart(ctx, {
      id: `brake-stop-pin-${tag}`, partNo: 'brake-stop-pin', name: `Release stop pin ${tag}`, c: [g.tongue.stop[0], sgn * (Y.tongue[0] + Y.arm[1] + 0.1) / 2, g.tongue.stop[1]], axis: 'y', length: Y.arm[1] + 0.1 - Y.tongue[0], radius: 0.125, massLb: 0.03, removable: true,
      material: '1/4" 316 stainless bolt with a nylon sleeve, nylock nut', explode: [0, sgn, 0.5],
      sourcing: { vendor: 'McMaster-Carr (1/4" 316 stainless bolt, nylon sleeve, nylock nut)' },
      joints: [bolt(`brake-bracket-${tag}`, 1, 0.25, 'through the tongue')],
      notes: 'The release stop: the spring lifts the arm until its top edge rests against this sleeved pin, which sets the released position and the shoe gap. Adjust the shoe gap by moving it to another hole when the lining wears.',
    })));
  }

  // ── Return springs: from a hook in the arm up to an eye screw in the transom's rear face ──
  for (const { s: sgn, tag } of SIDES) {
    const sp = g.spring;
    const a = at(sp.a), e = sp.e;
    const dir: V2 = sub(e, a);
    const len = Math.hypot(dir[0], dir[1]);
    add1(rodPart(ctx, {
      id: `brake-return-spring-${tag}`, partNo: 'brake-return-spring', name: `Brake return spring ${tag}`, c: [(a[0] + e[0]) / 2, sgn * sp.y, (a[1] + e[1]) / 2], axis: 'z', length: Math.max(0.2, len), radius: 0.15, massLb: SPRING_MASS_LB, removable: true,
      rot: { y: Math.atan2(dir[0], dir[1]) }, material: '302 stainless extension spring, hook ends', explode: [-1, sgn * 0.5, 0.2],
      sourcing: { vendor: `McMaster-Carr (302 stainless extension spring, 5/16" OD, about ${f2(sp.rate)} lbf/in, ${f2(sp.lenRel)}" hook to hook released, ${f2(sp.fRel)} lbf initial tension; hooks to an arm hole and a 1/4" eye screw in the rear face of the transom)` },
      notes: `Lifts the bar: ${f2(sp.fRel)} lbf released, ${f2(sp.fApp)} lbf applied per side (the pair is ${f2(p.brakeSpringForceLbf)} lbf at the pedal when the bar is down). The eye screw goes into the rear face of the transom, ${f2(-g.spring.e[0])}" behind the axle, just above its lower edge.`,
    }));
  }

  // ── Parking latch: stud on the toe guard, hook hanging from a bolt through the rear transom ──
  {
    const st = g.stud;
    const x0 = g.guard.x0 - 0.3; // washer and head behind the guard
    const tip = st.tipRel;
    const c = at([(x0 + tip) / 2, st.c[1]]);
    add1(rodPart(ctx, {
      id: 'brake-latch-stud', partNo: 'brake-latch-stud', name: 'Parking latch stud', c: [c[0], st.y, c[1]], axis: 'x', length: tip - x0, radius: st.r, massLb: 0.07, rot: { y: -phi },
      material: `${f2(p.brakeLatchPinDiameterIn)}" 316 stainless bolt, washer and nylock nut`, explode: [1, 0, 0.3],
      sourcing: { vendor: `McMaster-Carr (${f2(p.brakeLatchPinDiameterIn)}" 316 stainless bolt, ${f2(tip - x0)}" long, flat washer, nylock nut; head behind the guard, nut on the stud side is replaced by a jam nut so the hook can pass)` },
      joints: [bolt('brake-guard', 1, p.brakeLatchPinDiameterIn, 'through the toe guard near its top')],
      notes: `Stands ${f2(st.len)}" proud of the toe guard at |y| ${f2(st.y)}", beside the hook strap; the hook tooth drops over it when the bar is stomped down (it moves ${f2(g.stud.c[1] - g.stud.zApp)}" down).`,
    }));
    const h = g.hook;
    const zTop = h.bolt[1];
    add1(fixed(plate(ctx, {
      id: 'brake-latch-hook', partNo: 'brake-latch-hook', name: 'Parking latch hook', basis: 'yz', outline: h.outline as Vec2[], holes: [h.hole] as Vec2[][], depth: t, origin: [h.x0, 0, 0], fab: 'outsource',
      material: `${f2(t)}" A36 steel plate, laser cut`, explode: [-1, 0, 0.3],
      sourcing: { vendor: `Outsourced laser cut ${f2(t)}" A36 plate: a ${f2(h.length)}" strap with a tooth and a ${f2(0.4 + 0.04)}" bolt hole; zinc plated` },
      joints: [
        bolt('transom-rear', 1, bd, `${f2(bd)}" 316 shoulder bolt, ${inchesText(boltLength(L.transom + HOOK_STANDOFF_IN + t, bd))}" long, with a ${f2(HOOK_STANDOFF_IN)}" spacer sleeve between the transom and the hook, fender washer and nylock nut inside`, `the hook hangs on it like a pendulum; the bolt is ${f2(zTop - (L.deckTop - p.crossmemberDepthIn))}" above the transom's lower edge`),
        { type: 'pin', to: 'brake-latch-stud', count: 1, diaIn: p.brakeLatchPinDiameterIn, size: 'the tooth sits over the stud when parked' },
      ],
      notes: `Parking latch hook: a ${f2(h.length)}" strap hanging plumb from a bolt through the lower edge of the rear transom on the centerline. When the bar is stomped down the stud rides over the ramped tooth (the hook swings ${f2(h.swing)}" aside and falls back) and the tooth sits ${f2(0.02)}" above it, holding the bar down against the springs and the tire thrust. KICK the strap sideways (toward -y) to release. ${STEEL_FINISH}`,
    })));
    add1(fixed(rodPart(ctx, {
      id: 'brake-latch-bolt', partNo: 'brake-latch-bolt', name: 'Latch hook bolt', c: [(h.x0 - 0.3 + (L.xRear + L.transom + 0.5)) / 2, 0, zTop], axis: 'x', length: L.xRear + L.transom + 0.5 - (h.x0 - 0.3), radius: bd / 2, massLb: 0.06, removable: true,
      material: `${f2(bd)}" 316 stainless shoulder bolt, spacer sleeve, washers, nylock nut`, explode: [-1, 0, 0],
      sourcing: { vendor: `McMaster-Carr (${f2(bd)}" 316 stainless shoulder bolt, ${f2(HOOK_STANDOFF_IN)}" spacer sleeve, fender washer, nylock nut)` },
      joints: [bolt('transom-rear', 1, bd, 'through the lower edge of the rear transom'), { type: 'pin', to: 'brake-latch-hook', count: 1, diaIn: bd, size: 'the hook hangs on it' }],
      notes: 'The hook pendulum pivot. The nut and fender washer sit in the lane between the transom and the rear storage box.',
    })));
  }

  if (!movingOnly) parts.push(...buildHandle(ctx));
  return stockPass(parts);
}

/** Every bought or cut metal part carries stock dimensions (section x cut length) and a source, for the Phase 4 bar / plate list (build review M9). */
function stockPass(parts: Part[]): Part[] {
  for (const x of parts) {
    if (x.explode) x.explode = unitDir(x.explode);
    if (x.kind !== 'metal') continue;
    if (!x.stock) {
      const gm = x.geometry;
      if (gm.type === 'box') {
        const d = [...gm.size].sort((a, b) => a - b);
        x.stock = { t: d[0], w: d[1], l: d[2] };
      } else if (gm.type === 'cylinder') x.stock = { t: 2 * gm.radius, w: 2 * gm.radius, l: gm.length };
    }
    if (!x.sourcing) x.sourcing = YARD(`${x.material}, cut on the bandsaw and drilled`);
  }
  return parts;
}

export function buildBrake(ctx: Ctx): Part[] {
  return buildBrakeAt(ctx, 0);
}

void ARM_WEB_IN;
