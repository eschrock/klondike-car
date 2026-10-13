/**
 * The handler's STEP BRAKE (Phase 3c-4b, D-57 item 8; pull-pin pivot, D-65): a kick-scooter fender brake on each rear tire. No welding, no custom steel; everything is shop-cut oak,
 * a 3/8" stainless clevis pin and hitch-pin clip, rubber sheet, stainless bolts and screws, shock cord and 1/4" cord.
 *
 *   oak FLAP over the tire (a Shaper-cut tapered fender, its foot tread ending at the rear transom face) ── its front end is a TONGUE with an oak PIVOT BLOCK on it, which enters a slot
 *   in the rear of an oak KNEE ahead of the tire; a 3/8" 316 clevis PIN through the knee ears, the tongue and the block (double shear), held by a hitch-pin CLIP, is the pivot ── the knee
 *   is bolted through the rail into an oak BACKER glued to the inside of the rail ── under the flap an oak SHOE BLOCK carries a rubber PAD that lands on the tread when the handler
 *   steps on the flap's far end ── a shock-cord (bungee) set with a SNAP HOOK at the transom end lifts the flap ── two oak wedge CHOCKS hang on cords from the knees for parking.
 *   Removable (D-65): pull the pin, unhook the cord, lift the flap off (about 15 s a side, no tools); the knees and backers stay on the rails.
 *
 * `brake-layout.ts` is the single source for the kinematics; both the part builder here and the analysis (`analysis/brake.ts`) read it. Pose s = 0 is released
 * (the model default), s = 1 is applied (the pad on the tread). Plain TS (no three.js).
 */
import { STEP, box, cylinder, SIDES, unitDir, type Ctx, stainless, stainlessName } from './build-utils';
import { atPose, brakeGeometry, dot2, flapLocalX, flapOutline, hull2, PIVOT_SCREW_WOOD_IN, pivotBlockScrewPoints, polyArea, rot2, sub, type BrakeGeom, type V2 } from './brake-layout';
import { buildHandle } from './handle';
import { multiply, rotationY, translation } from './mat4';
import { basisMatrix, profilePart } from './profile';
import { boltLength, inchesText, pickWoodScrew, SCREW_DIA_IN, screwText } from './rear-mount';
import { trapezoidTriangles } from './plan-wall';
import type { Joint, Mat4, Part, ScrewFit, Vec2, Vec3 } from './types';


/** Clip a polygon in (y, z) to the strip y0 <= y <= y1 (Sutherland-Hodgman). */
function clipY(poly: V2[], y0: number, y1: number): V2[] {
  const pass = (pts: V2[], keep: (q: V2) => boolean, y: number): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const cut = (): V2 => [y, a[1] + ((c[1] - a[1]) * (y - a[0])) / (c[0] - a[0])];
      if (keep(a)) { out.push(a); if (!keep(c)) out.push(cut()); } else if (keep(c)) out.push(cut());
    }
    return out;
  };
  return pass(pass(poly, (q) => q[0] >= y0 - 1e-12, y0), (q) => q[0] <= y1 + 1e-12, y1);
}

/**
 * The SLOTTED brake knee as a triangle mesh in the MODEL frame (D-65, D-66 viewer fix): the knee's (y, z) profile extruded along x, with the slot for the flap tongue and pivot block
 * sawn from the rear face to `slotEndX` through the whole arm. That leaves the inboard ear (with the leg), the outboard ear and, ahead of the slot, the solid bridge between them. `sgn`
 * mirrors it to the right side. Also returns tight boxes for the overlap tests (the slot is NOT filled) and the wood volume (in^3).
 */
export function kneeSlottedMesh(g: BrakeGeom, sgn: 1 | -1): { positions: number[]; indices: number[]; boxes: Array<[Vec3, Vec3]>; volume: number; fullVolume: number } {
  const kn = g.knee, pv = g.pivot;
  const yFace = kn.poly[0][0];
  const prisms: Array<{ y0: number; y1: number; xa: number; xb: number }> = [
    { y0: yFace, y1: pv.ySlot[0], xa: kn.x0, xb: kn.x1 },
    { y0: pv.ySlot[0], y1: pv.ySlot[1], xa: Math.min(kn.x1, pv.slotEndX), xb: kn.x1 },
    { y0: pv.ySlot[1], y1: kn.yOut, xa: kn.x0, xb: kn.x1 },
  ];
  const lowerAt = (y: number): number => (y <= yFace + kn.legT + 1e-9 ? kn.zBot : kn.zLeg + ((kn.zArmBot - kn.zLeg) * (y - (yFace + kn.legT))) / Math.max(1e-9, kn.yOut - (yFace + kn.legT)));
  const positions: number[] = [];
  const indices: number[] = [];
  const boxes: Array<[Vec3, Vec3]> = [];
  let volume = 0;
  const my = (y: number) => sgn * y;
  for (const pr of prisms) {
    const poly = clipY(kn.poly, pr.y0, pr.y1);
    if (poly.length < 3 || pr.xb - pr.xa < 1e-6) continue;
    volume += Math.abs(polyArea(poly)) * (pr.xb - pr.xa);
    const base = positions.length / 3;
    const vert = (q: V2, x: number) => { positions.push(x, my(q[0]), q[1]); return positions.length / 3 - 1; };
    const flip = sgn < 0; // mirroring reverses the winding
    const tri = (a: number, b: number, c: number) => (flip ? indices.push(a, c, b) : indices.push(a, b, c));
    // caps: CCW in (y, z) looks along -x, so the +x cap keeps the order and the -x cap reverses it
    for (const t of trapezoidTriangles(poly)) {
      tri(vert(t[0], pr.xb), vert(t[1], pr.xb), vert(t[2], pr.xb));
      tri(vert(t[0], pr.xa), vert(t[2], pr.xa), vert(t[1], pr.xa));
    }
    // walls: one quad per profile edge, outward normal (0, dz, -dy)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) continue;
      const a0 = vert(a, pr.xa), b0 = vert(b, pr.xa), b1 = vert(b, pr.xb), a1 = vert(a, pr.xb);
      tri(a0, b0, b1); tri(a0, b1, a1);
    }
    void base;
    // tight boxes: slices of the y range, each as tall as the arm is at its inboard-most edge (a subset of the solid; the leg step is a slice edge)
    const cuts = [...new Set([pr.y0, pr.y1, yFace + kn.legT].filter((y) => y >= pr.y0 - 1e-9 && y <= pr.y1 + 1e-9))].sort((u, v) => u - v);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const n = Math.max(1, Math.ceil((cuts[k + 1] - cuts[k]) / 0.25));
      for (let j = 0; j < n; j++) {
        const ya = cuts[k] + ((cuts[k + 1] - cuts[k]) * j) / n, yb = cuts[k] + ((cuts[k + 1] - cuts[k]) * (j + 1)) / n;
        const zLo = Math.max(lowerAt(ya + 1e-7), lowerAt(yb - 1e-7));
        if (kn.zTop - zLo < 1e-6) continue;
        const ys: [number, number] = sgn > 0 ? [ya, yb] : [-yb, -ya];
        boxes.push([[pr.xa, ys[0], zLo], [pr.xb, ys[1], kn.zTop]]);
      }
    }
  }
  const fullVolume = Math.abs(polyArea(kn.poly)) * (kn.x1 - kn.x0);
  return { positions, indices, boxes, volume, fullVolume };
}

export { atPose, brakeGeometry, rot2, hull2 };
export type { BrakeGeom, V2 };

/** Rubber sheet density (about 75 lb/ft³): a placeholder for a purchased item. */
const RUBBER_LB_PER_IN3 = 0.045;
/** The pad screws sit this far off the shoe-to-flap screws, across the shoe (the note and the joint points agree). */
const PAD_SCREW_OFF_IN = 0.5;
/** Stainless density (lb/in³) for the pivot pin. */
const SS_LB_PER_IN3 = 0.29;
/** Foot tread sheet thickness on the flap (in). */
const FOOT_TREAD_THICK_IN = 0.125;
const CORD_LB_PER_IN = 0.004;
/** Shop note on every part that comes off with the flap (D-65). */
const REMOVE_NOTE = 'REMOVABLE (D-65): pull the pivot pin (take the hitch-pin clip off first), unhook the cord at the transom, lift the flap off: about 15 s a side, no tools. The knee and backer stay bolted to the rail.';
/** Hitch-pin clip (a wire R-clip for a 3/8 in pin): wire radius and leg length (in) and its mass (lb). */
const CLIP_WIRE_R_IN = 0.045, CLIP_LEN_IN = 1.1, CLIP_LB = 0.012;
/** Stainless snap hook (about 1-1/4 in) at the transom end of the return cord: size (in) and mass (lb). */
const SNAP_SIZE_IN: Vec3 = [0.45, 0.2, 1.25];
const SNAP_LB = 0.03;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const bbox = (pts: V2[]) => ({ x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), z0: Math.min(...pts.map((q) => q[1])), z1: Math.max(...pts.map((q) => q[1])) });

/** Cord stock for a straight run between two model points (a cylinder along its length: its z axis is turned to the run by Ry·Rx, as `compose` applies them). */
function cordPart(ctx: Ctx, s: { id: string; partNo: string; name: string; a: Vec3; b: Vec3; radius: number; material: string; notes: string; sourcing: Part['sourcing']; joints?: Joint[]; removable?: boolean; explode?: Vec3 }): Part {
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], dz = s.b[2] - s.a[2];
  const len = Math.max(0.2, Math.hypot(dx, dy, dz));
  return cylinder(ctx, {
    id: s.id, partNo: s.partNo, name: s.name, group: 'brake', mat: 'fixed', kind: 'purchased', massLb: len * CORD_LB_PER_IN, material: s.material, fab: 'buy', step: STEP.brake,
    center: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2], axis: 'z', radius: s.radius, length: len, rot: { x: -Math.asin(Math.max(-1, Math.min(1, dy / len))), y: Math.atan2(dx, dz) },
    joints: s.joints, notes: s.notes, sourcing: s.sourcing, removable: s.removable, explode: s.explode,
  });
}

/**
 * Brake parts at pose `s` (0 released, 1 applied; the model default is 0). `analysis/brake.ts` calls this at s = 0 … 1 to sweep the stroke. `movingOnly` leaves out the
 * parts that stay on the sled (pivot pin and clip, knees, backers, chocks and their cords, the handle).
 */
export function buildBrakeAt(ctx: Ctx, s: number, movingOnly = false): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const g = brakeGeometry(p, L);
  const Y = g.y;
  const phi = (1 - s) * g.theta; // clockwise swing from the applied pose
  const at = (q: V2): V2 => atPose(g, s, q);
  const add1 = (x: Part | null) => { if (x) parts.push(x); };
  const bd = p.brakeMountBoltDiaIn;
  const sd = SCREW_DIA_IN[8]; // #8 wood screw shank (in): the brake's wood screws are the standard #8 x 1-1/4 (D-72)
  const screw = (to: string, count: number, size: string, note?: string, fit?: ScrewFit, dia = sd): Joint => ({ type: 'screw', to, count, diaIn: dia, size, ...(fit ? { fit } : {}), ...(note ? { note } : {}) });
  const eye = (to: string, count: number, size: string): Joint => screw(to, count, size, undefined, undefined, SCREW_DIA_IN[10]); // #10 screw eyes
  const rotPts = (pts: V2[]): V2[] => pts.map(at);

  for (const { s: sgn, tag } of SIDES) {
    const yc = sgn * Y.wheel;

    // Joint points on the flap are in its LOCAL frame (x forward to the nose, y across from the tire's center line, z up from the underside, 0..thick), all derived here so the Shaper file,
    // the viewer and the block / shoe copies agree. The 'locateJoints' fallback (world box overlaps) puts points of a sloped part outside it.
    let flapMat: Mat4 | undefined;
    const bF = g.board;
    const nBlockScrews = Math.round(p.brakePivotBlockScrews);
    // D-72: every wood screw of the brake is the standard #8 x 1-1/4 (was #10 x 1-1/4 for the pivot block, #10 x 2 for the shoe and #8 x 1 for the pad: the 2 in screw ran 0.37 in
    // through the 7/8 in flap, since the shoe block is only about 3/4 in thick). The pivot block's screws cross the 5/8 in block and bite the tongue; the shoe's cross the shoe block
    // and bite the flap; the pad's cross the rubber (less the 1/8 in the heads are buried) and bite the shoe block and the flap it is glued to.
    const shoeThickIn = (() => { const o = g.shoe.outline; return Math.abs((o[2][1] + o[3][1]) / 2 - (o[0][1] + o[1][1]) / 2) * Math.cos(g.sigma); })(); // mid-length thickness, normal to the flap underside
    const blockFit = pickWoodScrew(8, g.plan.blockT, g.board.thick);
    const shoeFit = pickWoodScrew(8, shoeThickIn, g.board.thick);
    const padFit = pickWoodScrew(8, g.pad.thick - 0.125, shoeThickIn + g.board.thick);
    const xBlockMid = flapLocalX(g, (bF.s0 + g.plan.sShoulder) / 2);
    const blockScrews = pivotBlockScrewPoints(g, nBlockScrews, p.brakePivotPinDiaIn, sd);
    // Shoe screws and glue: along the shoe's top face (the flap underside), at 1/4 and 3/4 of its length, on the center line, drilled up from the underside.
    const shoeXs = g.shoe.outline.map((q) => q[0]);
    const shoeX0 = Math.min(...shoeXs), shoeX1 = Math.max(...shoeXs);
    const shoeFlapX = (f: number): number => {
      const wx = shoeX0 + f * (shoeX1 - shoeX0);
      const wz = (g.c - g.v[0] * wx) / g.v[1]; // the flap underside plane
      return flapLocalX(g, dot2(sub([wx, wz], g.P), g.u));
    };
    const shoeScrewX = [shoeFlapX(0.25), shoeFlapX(0.75)], shoeGlueX = shoeFlapX(0.5);
    // ── The oak flap: a Shaper-cut tapered fender over the tire (plan outline), its front end a narrow tongue for the pivot ──
    {
      const b = g.board;
      const c = at(b.c);
      const ang = -(g.sigma - phi);
      const vUp: V2 = [Math.sin(ang), Math.cos(ang)];
      const o3: Vec3 = [c[0] - (b.thick / 2) * vUp[0], yc, c[1] - (b.thick / 2) * vUp[1]];
      const nBS = Math.round(p.brakePivotBlockScrews);
      const flap = profilePart(ctx, {
        id: `brake-flap-${tag}`, partNo: 'brake-flap', name: `Brake flap ${tag} (white oak fender)`, group: 'brake', mat: 'oak', outline: flapOutline(g), depth: b.thick, basis: 'xy', origin: [0, 0, 0],
        grain: 'x', stock: { t: b.thick, w: b.w, l: b.len }, step: STEP.brake, fab: 'shaper-origin', removable: true, explode: [-0.4, sgn * 0.5, 1],
        joints: [
          { type: 'pin', to: `brake-pivot-pin-${tag}`, count: 1, diaIn: p.brakePivotPinDiaIn, size: `1 x ${f2(p.brakePivotPinDiaIn)}" ${stainless(p)} clevis pin through the tongue (and the pivot block on it), double shear with the knee ears`, at: [[flapLocalX(g, 0), 0, b.thick - g.plan.hPin]] },
          { type: 'glue', to: `brake-pivot-block-${tag}`, count: 1, note: 'epoxy over the whole face of the block on the tongue', at: [[xBlockMid, 0, b.thick]] },
          { ...screw(`brake-pivot-block-${tag}`, nBS, `${nBS} x ${screwText(blockFit)}" ${stainless(p)} flat-head screws down through the block into the tongue`, `all behind the pin, at least ${PIVOT_SCREW_WOOD_IN} in of oak between a screw and the cross-hole edge, alternating across the tongue`, blockFit), at: blockScrews.map(([x, y]): Vec3 => [x, y, b.thick]) },
          { ...screw(`brake-shoe-${tag}`, 2, `2 x ${screwText(shoeFit)}" ${stainless(p)} screws up through the shoe block into the flap, glued with epoxy`, 'the screws and the glue take the pad friction', shoeFit), at: shoeScrewX.map((x): Vec3 => [x, 0, 0]) },
          { type: 'glue', to: `brake-shoe-${tag}`, count: 1, note: 'epoxy, full face of the shoe block on the underside', at: [[shoeGlueX, 0, 0]] },
          { ...eye(`brake-cord-${tag}`, 1, `1 x #10 ${stainless(p)} screw eye (3/16" ring) in the rear end face of the flap, inboard`), at: [[-b.len / 2, -sgn * (Y.wheel - Y.eye), b.thick / 2]] },
        ],
        notes: `White oak ${f2(b.thick)}" x ${f2(b.w)}" x ${f2(b.len)}" (5/4 stock planed to 7/8"), grain along the flap, one board, CUT ON THE SHAPER ORIGIN from the plan outline in the part data (D-65): a tapered fender, ${f2(g.plan.wTongue)}" wide tongue at the pivot end, an S-curved flare from ${f2(g.plan.sShoulder)}" to ${f2(g.plan.sFull)}" behind the pin out to the full ${f2(b.w)}" over the tire, a 1/2" corner radius at the foot end and 1/4" at the nose. Roundover all the edges (1/4" bit) after the cut. It slopes down ${f2(g.sigma / (Math.PI / 180))} degrees toward the rear so the foot end is lower than the pivot. The FOOT END IS AT THE REAR TRANSOM FACE (nothing sticks out behind the sled, D-65: x = ${f2(g.xEnd)}"); the ribbed rubber foot tread is the last ${f2(p.brakeFootPadLengthIn)}" (the foot point is ${f2(Math.abs(g.F[0] - L.xRear))}" ${g.F[0] < L.xRear ? 'behind' : 'ahead of'} the transom face, outboard of the body). Epoxy-seal before the finish. At the foot point it stands ${f2(g.F[1])}" off the ground; stepping on it swings the pad ${f2(p.brakePadGapIn)}" onto the tread (foot stroke about ${f2(g.footDrop)}"). The tongue is drilled ${f2(p.brakePivotPinDiaIn)}" across, ${f2(g.plan.hPin)}" below the top surface and ${f2(p.brakePivotEndIn)}" from its end, together with the pivot block (clamp the block on first). ${REMOVE_NOTE}`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(b.thick)}" x ${f2(b.w)}" x ${f2(b.len)}" (a 5/4 board planed to ${f2(b.thick)}"); the pivot, shoe and eye holes are drilled from the parts as templates` },
      });
      flap.transform = multiply(translation(o3[0], o3[1], o3[2]), rotationY(ang));
      flapMat = flap.transform;
      flap.finish = { surface: 'oak' };
      add1(flap);
    }

    // ── The pivot block: a small oak block glued and screwed on the flap tongue where it enters the knee ──
    {
      const b = g.board;
      const pl = g.plan;
      // The block runs from the tongue's end (s0) to the shoulder (sShoulder) along the flap's top surface, blockT thick, tongue-wide.
      const sA = b.s0, sB = pl.sShoulder;
      const mid = (sA + sB) / 2;
      const ctr: V2 = [g.P[0] + mid * g.u[0] + (pl.blockT / 2) * g.v[0], g.P[1] + mid * g.u[1] + (pl.blockT / 2) * g.v[1]];
      const cp = at(ctr);
      const nBS = Math.round(p.brakePivotBlockScrews);
      add1(box(ctx, {
        id: `brake-pivot-block-${tag}`, partNo: 'brake-pivot-block', name: `Brake pivot block ${tag} (white oak)`, group: 'brake', mat: 'oak', step: STEP.brake, grain: 'x', fab: 'table-saw', removable: true,
        size: [sB - sA, pl.wTongue, pl.blockT], center: [cp[0], yc, cp[1]], rot: { y: -(g.sigma - phi) }, explode: [-0.2, sgn * 0.3, 1.2],
        joints: [
          { type: 'glue', to: `brake-flap-${tag}`, count: 1, note: 'epoxy, full face on the flap tongue' },
          { ...screw(`brake-flap-${tag}`, nBS, `${nBS} x ${screwText(blockFit)}" ${stainless(p)} flat-head screws down through the block into the tongue`, undefined, blockFit), at: blockScrews.map(([x, y]): Vec3 => [x - xBlockMid, y, pl.blockT / 2]) },
          { type: 'pin', to: `brake-pivot-pin-${tag}`, count: 1, diaIn: p.brakePivotPinDiaIn, size: `${f2(p.brakePivotPinDiaIn)}" clevis pin hole across, ${f2(g.plan.hPin)}" below the flap top surface` },
        ],
        notes: `White oak block ${f2(sB - sA)}" x ${f2(pl.wTongue)}" x ${f2(pl.blockT)}" (a scrap of 5/8" stock), on top of the flap tongue from its nose to the start of the flare. It deepens the tongue to ${f2(b.thick + pl.blockT)}" so the ${f2(p.brakePivotPinDiaIn)}" pin hole has ${f2(g.pivot.edgeTongueUp)}" of oak above and ${f2(g.pivot.edgeTongueDown)}" below it. Glue and screw it on, then drill the pin hole through block and tongue together with the knee clamped to them. The block enters the slot in the knee with the tongue; its top is flush with the knee top. ${REMOVE_NOTE}`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(pl.blockT)}" x ${f2(pl.wTongue)}" x ${f2(sB - sA)}"` },
      }));
    }

    // ── The rubber foot tread: a thin ribbed sheet glued on the flap's foot area, ending at the transom face with the flap ──
    {
      const b = g.board;
      const ang = -(g.sigma - phi);
      const c = at(b.c);
      const tl = Math.min(p.brakeFootPadLengthIn, b.len - 1), tw = Math.max(1, b.w - 0.5), tt = FOOT_TREAD_THICK_IN;
      const dx = -b.len / 2 + tl / 2, dz = b.thick / 2 + tt / 2; // flap-local: the rear end is -x, the top face +z
      const co = Math.cos(ang), si = Math.sin(ang);
      const tread = box(ctx, {
        id: `brake-foot-tread-${tag}`, partNo: 'brake-foot-tread', name: `Brake foot tread ${tag} (rubber sheet)`, group: 'brake', mat: 'fixed', kind: 'purchased', step: STEP.brake, fab: 'buy',
        massLb: tl * tw * tt * RUBBER_LB_PER_IN3, material: `${f2(tt)}" ribbed rubber sheet (stair tread or neoprene)`, size: [tl, tw, tt], removable: true,
        center: [c[0] + co * dx + si * dz, yc, c[1] - si * dx + co * dz], rot: { y: ang }, explode: [-0.4, sgn * 0.5, 1.2],
        joints: [{ type: 'glue', to: `brake-flap-${tag}`, count: 1, note: 'contact cement over the full face, edges sealed' }],
        sourcing: { vendor: `McMaster-Carr (${f2(tt)}" ribbed rubber stair-tread or smooth neoprene sheet, cut ${f2(tl)}" x ${f2(tw)}")`, costUsd: 3 },
        notes: `A ${f2(tl)}" x ${f2(tw)}" x ${f2(tt)}" strip of ribbed rubber on the flap's foot end (the last ${f2(p.brakeFootPadLengthIn)}"; it ends AT the rear transom face with the flap, D-65), glued with contact cement, corners rounded to the flap's. It gives a boot grip on a wet or snowy flap and finishes the end so it reads as a pedal. A few ounces. It comes off with the flap. ${REMOVE_NOTE}`,
      });
      tread.finish = { surface: 'rubber', roundoverIn: 0.03 };
      add1(tread);
    }

    let padScrewAt: Vec3[] = [];
    // ── The oak shoe block: a wedge between the flap underside and the pad ──
    {
      const outline = rotPts(g.shoe.outline);
      const [qy0, qy1] = [Y.pad[0], Y.pad[1]];
      const bb = bbox(outline);
      const origin: Vec3 = [0, sgn > 0 ? qy1 : -qy0, 0];
      // The flap's underside points (local x on its center line) in the shoe's frame: world x and z, the middle of the pad width.
      const shoeAt = (fx: number): Vec3 => { const m = flapMat!; return [m[0] * fx + m[12], m[2] * fx + m[14], (qy1 - qy0) / 2]; };
      // The pad screws go in from the tread side, 1/2 in off the shoe-to-flap screws (which come from the same side): at the same stations along the shoe, zig-zagged across it, on the curved (lower) face.
      const lowZ = (x: number): number => { let z = Infinity; for (let i = 0; i < outline.length; i++) { const a = outline[i], c = outline[(i + 1) % outline.length]; if ((a[0] - x) * (c[0] - x) <= 0 && Math.abs(c[0] - a[0]) > 1e-9) z = Math.min(z, a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])); } return z; };
      padScrewAt = shoeScrewX.map((fx, i): Vec3 => { const x = shoeAt(fx)[0]; return [x, lowZ(x), (qy1 - qy0) / 2 + (i % 2 ? -1 : 1) * PAD_SCREW_OFF_IN]; });
      const shoe = profilePart(ctx, {
        id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe block ${tag} (white oak wedge)`, group: 'brake', mat: 'oak', outline: outline as Vec2[], depth: qy1 - qy0, basis: 'xz', origin,
        grain: 'x', stock: { t: bb.z1 - bb.z0, w: qy1 - qy0, l: bb.x1 - bb.x0 }, step: STEP.brake, fab: 'bandsaw', removable: true, explode: [0.2, sgn, 0.6],
        joints: [
          { ...screw(`brake-flap-${tag}`, 2, `2 x ${screwText(shoeFit)}" ${stainless(p)} screws up through the block into the flap, glued with epoxy`, undefined, shoeFit), at: shoeScrewX.map((x) => shoeAt(x)) },
          { type: 'glue', to: `brake-flap-${tag}`, count: 1, note: 'epoxy, full face', at: [shoeAt(shoeGlueX)] },
          { ...screw(`brake-pad-${tag}`, 2, `2 x ${screwText(padFit)}" ${stainless(p)} flat-head screws (heads buried 1/8" in the rubber) through the pad into the block`, `plus contact cement over the full face; set them ${f2(PAD_SCREW_OFF_IN)} in off the shoe screws`, padFit), at: padScrewAt },
        ],
        notes: `Bandsawn from ${f2(g.shoe.w)}" thick white oak (the thickness is the pad width, across the wheel; the 3 in side is the tire-radius cut): the top face follows the flap underside (${f2(g.sigma / (Math.PI / 180))} degrees), the bottom face is cut to the tire radius (${f2(g.r + p.brakePadThickIn)}" from the axle, a template on a router sled or sandpaper on the tire), ${f2(p.brakeShoeBlockIn)}" thick at its thinnest. The rubber pad is glued and screwed on the curved face. Ends cut vertical. Glued and screwed to the flap, so it comes off with it. ${REMOVE_NOTE}`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(g.shoe.w)}" wide x ${f2(bb.z1 - bb.z0)}" x ${f2(bb.x1 - bb.x0)}" blank; the tire radius is the template` },
      });
      add1(shoe);
    }

    // ── The rubber pad, an arc strip on the tread ──
    {
      const pad = g.pad;
      const ring = rotPts([...pad.bot, ...[...pad.top].reverse()]);
      const outline = polyArea(ring) >= 0 ? ring : [...ring].reverse();
      const [qy0, qy1] = [Y.pad[0], Y.pad[1]];
      const area = Math.abs(polyArea(ring));
      const part: Part = {
        id: `brake-pad-${tag}`, partNo: 'brake-pad', name: `Brake pad ${tag} (rubber)`, group: 'brake', kind: 'purchased', material: `${f2(pad.thick)}" rubber sheet (60-70A neoprene, or veg-tan leather)`,
        geometry: { type: 'extrusion', outline: outline.map((q) => [q[0], q[1]] as Vec2), depth: qy1 - qy0 }, transform: basisMatrix('xz', [0, sgn > 0 ? qy1 : -qy0, 0]), body: 'chassis',
        massLb: area * (qy1 - qy0) * RUBBER_LB_PER_IN3, fab: 'buy', step: STEP.brake, removable: true, explode: [0.2, sgn, 0.4],
        joints: [{ ...screw(`brake-shoe-${tag}`, 2, `2 x ${screwText(padFit)}" ${stainless(p)} flat-head screws, heads buried 1/8" in the rubber, plus contact cement over the full face`, undefined, padFit), at: padScrewAt }],
        sourcing: { vendor: `McMaster-Carr (${f2(pad.thick)}" 60-70A neoprene or SBR rubber sheet; cut ${f2(pad.length)}" x ${f2(qy1 - qy0)}", or veg-tan leather of the same size)` },
        notes: `Rubber (or leather) pad ${f2(pad.length)}" x ${f2(qy1 - qy0)}" x ${f2(pad.thick)}", centered ${f2(g.alpha / (Math.PI / 180))} degrees behind the top of the tire. Design μ ${f2(p.brakePadMu)} on a wet tread, ${f2(p.brakePadMuFouled)} mud or snow fouled (pass/fail). Hangs ${f2(p.brakePadGapIn)}" off the tread released. Wears like a shoe sole: replace when the screws get close to the surface. Test a sample on a wet tire first. Comes off with the flap. ${REMOVE_NOTE}`,
      };
      add1(part);
    }

    // ── The return cord set: shock cord and its stop cord, from the flap eye to an eye screw in the rear transom ──
    {
      const bg = g.bungee;
      const E = at(bg.E);
      const a: Vec3 = [E[0], sgn * Y.eye, E[1]];
      const b: Vec3 = [bg.A[0], sgn * bg.A[1], bg.A[2]];
      const returnCord = cordPart(ctx, {
        id: `brake-cord-${tag}`, partNo: 'brake-cord', name: `Brake return bungee and stop cord ${tag}`, a, b, radius: 0.125, material: '1/4" shock cord (polyester sheath) with a 3/16" polyester stop cord',
        joints: [eye(`brake-flap-${tag}`, 1, `#10 ${stainless(p)} screw eye in the rear end face of the flap, inboard`), eye('transom-rear', 1, `#10 ${stainless(p)} screw eye in the aft face of the rear transom, near its outer corner (a backer lies behind it), the snap hook clips to it`)],
        explode: [-0.5, sgn * 0.5, 1], removable: true,
        sourcing: { vendor: `McMaster-Carr (1/4" shock cord with polyester sheath, ${f2(bg.lenRel + 2)}" cut, whipped ends tied to the eyes; 3/16" polyester braid for the stop cord, ${f2(bg.lenRel)}" between the eyes; two #10 ${stainless(p)} screw eyes)` },
        notes: `The bungee pulls the flap up with ${f2(bg.tRel)} lbf released (the stop cord, tied taut at the released length ${f2(bg.lenRel)}" between the eyes, sets the lift and holds the pad ${f2(p.brakePadGapIn)}" off the tread), stretching to ${f2(bg.tApp)} lbf when the flap is down (${f2(bg.rate)} lbf per inch). The flap eye is a screw eye in the rear END face of the flap, ${f2(0.8)}" in from its inboard edge; its ring reaches ${f2(Math.abs(bg.E[0] - g.xEnd))}" behind the flap end (${f2(Math.abs(bg.E[0] - L.xRear))}" ${bg.E[0] < L.xRear ? 'behind' : 'ahead of'} the transom face), which lets the cord clear the hull's rear corner; the transom eye is ${f2(p.brakeBungeeAnchorBelowTopIn)}" below the transom top and ${f2(p.brakeBungeeAnchorInsetIn)}" in from the side's outer face (clear of the handle sockets and of the sign zone on the sides, D-57). The cord is a wear item: replace it when it goes slack. D-65: a stainless SNAP HOOK on the transom end (the end by the handle sockets) clips to the transom eye, so the cord unhooks in a second and goes off with the flap; the other end stays tied to the flap eye. ${REMOVE_NOTE}`,
      });
      const hl = (returnCord.geometry as { length: number }).length / 2; // the cord's local +z runs from the flap eye to the transom eye
      returnCord.joints![0].at = [[0, 0, -hl]];
      returnCord.joints![1].at = [[0, 0, hl]];
      add1(returnCord);
      // the snap hook at the transom end (it stays put with the transom eye, so it is not part of the swept moving group)
      if (!movingOnly) add1(box(ctx, {
        id: `brake-snap-${tag}`, partNo: 'brake-snap', name: `Brake cord snap hook ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', step: STEP.brake, fab: 'buy', removable: true,
        massLb: SNAP_LB, material: `${stainless(p)} snap hook, about 1-1/4" overall`, size: SNAP_SIZE_IN, center: [b[0], b[1], b[2] - SNAP_SIZE_IN[2] / 2 + 0.15], explode: [-1, 0, 0.2],
        joints: [{ type: 'pin', to: 'transom-rear', count: 1, note: 'clips to the #10 stainless screw eye in the aft face of the rear transom (a clip, not a thumb-knob screw: build review MUST-11)' }],
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} steel snap hook, about 1-1/4" long, tied or swaged into the cord end)`, costUsd: 3 },
        notes: `Stainless snap hook spliced into the transom end of the return cord (the end by the handle sockets). Clip it onto the transom eye, or unclip it to take the flap off. ${REMOVE_NOTE}`,
      }));
    }

    if (movingOnly) continue;

    // ── The pivot pin (3/8" 316 clevis pin, headless, blind in the inboard ear) and its hitch-pin clip ──
    {
      const pv = g.pivot;
      const yInEnd = pv.ySlot[0] - pv.blind, yOutEnd = g.knee.yOut + 0.55;
      const clipY = g.knee.yOut + 0.2;
      const pinVol = Math.PI * (pv.dia / 2) ** 2 * pv.len;
      add1(cylinder(ctx, {
        id: `brake-pivot-pin-${tag}`, partNo: 'brake-pivot-pin', name: `Brake pivot pin ${tag} (3/8" ${stainlessName(p)} clevis pin)`, group: 'brake', mat: 'fixed', kind: 'purchased', step: STEP.brake, fab: 'buy', removable: true,
        massLb: pinVol * SS_LB_PER_IN3, material: `${f2(pv.dia)}" ${stainless(p)} clevis pin, ${f2(pv.len)}" long, one cross hole near the outboard end`, center: [g.H[0], sgn * (yInEnd + yOutEnd) / 2, g.H[1]], axis: 'y', radius: pv.dia / 2, length: pv.len, explode: [0, sgn, 0.2],
        joints: [
          { type: 'pin', to: `brake-knee-${tag}`, count: 1, diaIn: pv.dia, size: `${f2(pv.dia)}" hole through the outboard ear (${f2(pv.earOut)}") and ${f2(pv.blind)}" blind into the inboard ear` },
          { type: 'pin', to: `brake-flap-${tag}`, count: 1, diaIn: pv.dia, size: `through the flap tongue and the pivot block (${f2(g.plan.wTongue)}" across), DOUBLE SHEAR between the two knee ears` },
        ],
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} steel clevis pin or cross-drilled rod, ${f2(pv.dia)}" diameter, ${f2(pv.len)}" long; cross hole ${f2(0.15)}" from the end for the clip)`, costUsd: 3 },
        notes: `Pivot of the flap (D-65): a ${f2(pv.dia)}" stainless pin along the sled's y axis at x = ${f2(g.H[0])}", ${f2(g.H[1])}" off the ground, in through the outboard knee ear, the flap tongue and pivot block (${f2(g.plan.wTongue)}" across, with ${f2(p.brakePivotSlotClearIn)}" slot clearance each side) and ${f2(pv.blind)}" blind into the inboard ear: it is held in double shear (two shear planes between the ears and the tongue). The hitch-pin clip through the cross hole at the outboard end keeps it in. Hold it in the knee holes with a drop of grease. ${REMOVE_NOTE}`,
      }));
      add1(cylinder(ctx, {
        id: `brake-pivot-clip-${tag}`, partNo: 'brake-pivot-clip', name: `Brake pivot hitch-pin clip ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', step: STEP.brake, fab: 'buy', removable: true,
        massLb: CLIP_LB, material: `${stainless(p)} hitch-pin (R) clip for a 3/8" pin`, center: [g.H[0], sgn * clipY, g.H[1] - CLIP_LEN_IN / 2 + 0.2], axis: 'z', radius: CLIP_WIRE_R_IN, length: CLIP_LEN_IN, explode: [0, sgn, 0.8],
        joints: [{ type: 'pin', to: `brake-pivot-pin-${tag}`, count: 1, size: 'through the cross hole at the outboard end of the pin' }],
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} steel hitch pin clip / R-clip for a 3/8" pin)`, costUsd: 1 },
        notes: `Wire clip through the cross hole at the outboard end of the pivot pin. Take it off, pull the pin and the flap is free. Keep a spare in the box. ${REMOVE_NOTE}`,
      }));
    }

    // ── The oak knee (outrigger) that carries the pivot pin ahead of the tire, bolted to the rail; its arm is slotted from the rear for the flap tongue (D-65) ──
    {
      const kn = g.knee;
      const poly = sgn > 0 ? kn.poly : [...kn.poly].reverse().map((q): V2 => [-q[0], q[1]]);
      const stackBolt = inchesText(boltLength(g.bolts.stack, bd));
      const bb = bbox(kn.poly);
      const pv = g.pivot;
      const slotW = pv.ySlot[1] - pv.ySlot[0], slotL = pv.slotEndX - kn.x0;
      const zLoMid = kn.zLeg + ((kn.zArmBot - kn.zLeg) * ((pv.ySlot[0] + pv.ySlot[1]) / 2 - (Y.face + kn.legT))) / Math.max(1e-6, kn.yOut - (Y.face + kn.legT));
      const slotVol = slotW * slotL * (kn.zTop - zLoMid);
      const knee = profilePart(ctx, {
        id: `brake-knee-${tag}`, partNo: 'brake-knee', name: `Brake pivot knee ${tag} (white oak outrigger)`, group: 'brake', mat: 'oak', outline: poly as Vec2[], depth: kn.x1 - kn.x0, basis: 'yz', origin: [kn.x0, 0, 0],
        grain: 'y', stock: { t: kn.x1 - kn.x0, w: bb.z1 - bb.z0, l: Math.abs(kn.yOut - Y.face) }, step: STEP.brake, fab: 'bandsaw', explode: [0.3, sgn, 0.3],
        joints: [
          { type: 'bolt', to: `rail-${tag}`, count: g.bolts.count, diaIn: bd, size: `${g.bolts.count} x ${f2(bd)}" x ${stackBolt}" ${stainless(p)} hex bolts (${g.bolts.xs.length} columns x ${g.bolts.zs.length} rows), fender washers and nylock nuts, through this leg and the rail into the backer`, note: `the nuts and washers sit in 1/2" counterbores in the backer's inner face; the heads are in counterbores in the knee's outboard face. Epoxy the holes.` },
          { type: 'glue', to: `rail-${tag}`, count: 1, note: 'epoxy, leg against the rail and chine outer face (the bolts clamp it)' },
          { type: 'pin', to: `brake-pivot-pin-${tag}`, count: 1, diaIn: pv.dia, size: `${f2(pv.dia)}" pin hole across the ears: through the outboard ear, ${f2(pv.blind)}" blind into the inboard ear` },
          eye(`brake-chock-cord-${tag}`, 1, `1 x #10 ${stainless(p)} screw eye in the underside, for the chock cord`),
        ],
        notes: `Oak outrigger bandsawn from ${f2(kn.x1 - kn.x0)}" stock: a ${f2(kn.legT)}" leg on the hull's outer face (rail and chine, z ${f2(kn.zBot)}" to ${f2(kn.zLeg)}"), an arm ${f2(kn.armT)}" thick that reaches out ${f2(kn.yOut - Y.face)}" over the gap beside the tire, braced by the sloping underside. Its top is FLAT at z = ${f2(kn.zTop)}", flush with the top of the pivot block (D-65). The rear of the arm is SLOTTED (bandsaw, then clean up with a chisel): a ${f2(slotW)}" wide slot (the ${f2(g.plan.wTongue)}" flap tongue plus ${f2(p.brakePivotSlotClearIn)}" a side) centered on the tire (|y| ${f2(pv.ySlot[0])}" to ${f2(pv.ySlot[1])}"), from the rear face (x = ${f2(kn.x0)}") forward to x = ${f2(pv.slotEndX)}", straight through the arm. That leaves two EARS: ${f2(pv.earOut)}" outboard and ${f2(pv.earIn)}" inboard. The ${f2(pv.dia)}" pin hole runs across the ears at x = ${f2(g.H[0])}", z = ${f2(g.H[1])}" (${f2(pv.edgeEarUp)}" below the top, ${f2(pv.edgeEarDown)}" above the arm bottom), through the outboard ear and ${f2(pv.blind)}" blind into the inboard ear; the knee's rear face is ${f2(g.H[0] - kn.x0)}" behind the pin. Drill it together with the flap tongue and block clamped in the slot. It stands ahead of the tire (x ${f2(kn.x0)}" to ${f2(kn.x1)}", the tire front is ${f2(g.r)}"), its bottom on the rail bottom (${f2(kn.zBot)}" off the ground). Bolted through the rail into the backer, not the thin side panel, so the loads go into the rail and the deck. Face-laminated from stocked boards (D-70): no 12/4 is bought; glue up the blank from 4/4 layers face to face with epoxy (each wide layer edge-glued from two pieces) and mill it to size BEFORE it is bandsawn, slotted and bored (the cut list gives the layers). Strength is taken as solid oak.`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(kn.x1 - kn.x0)}" x ${f2(bb.z1 - bb.z0)}" x ${f2(Math.abs(kn.yOut - Y.face))}" blank (face-laminated from 4/4 layers, D-70: no 12/4 is bought)` },
      });
      // D-66 (viewer fix): the slot is REAL geometry now: the knee is a mesh with the slot sawn through the arm, so the tongue and pivot block sit in it with their clearance.
      const km = kneeSlottedMesh(g, sgn);
      knee.geometry = { type: 'mesh', positions: km.positions, indices: km.indices, boxes: km.boxes };
      knee.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      knee.massLb = knee.massLb * (km.volume / Math.max(1e-9, km.fullVolume)); // the slot's wood is out of the mass (exact volume)
      void slotVol;
      add1(knee);
    }

    // ── The oak backer inside the rail ──
    {
      const bk = g.backer;
      const yIn = sgn > 0 ? [bk.y0, bk.y1] : [-bk.y1, -bk.y0];
      add1(box(ctx, {
        id: `brake-backer-${tag}`, partNo: 'brake-backer', name: `Brake knee backer ${tag} (white oak)`, group: 'brake', mat: 'oak', step: STEP.frame, // with the frame glue-up (round 2): it is epoxied to the rail and the deck underside before the deck goes on grain: 'x', fab: 'table-saw',
        size: [bk.x1 - bk.x0, bk.t, bk.z1 - bk.z0], center: [(bk.x0 + bk.x1) / 2, sgn * (bk.y0 + bk.y1) / 2, (bk.z0 + bk.z1) / 2], explode: [0, -sgn * 0.3, -1],
        joints: [
          { type: 'glue', to: `rail-${tag}`, count: 1, note: 'epoxy, full face against the rail inner face' },
          { type: 'glue', to: 'deck', count: 1, note: 'epoxy along the top edge, against the deck underside' },
          // the nut and washer pockets in the inner face (local frame = box centered on its middle): one per knee bolt, on the bolt line, the washer's outside diameter plus 1/8 in
          { type: 'hole', to: `rail-${tag}`, count: g.bolts.count, diaIn: p.brakeMountWasherOdIn + 0.125,
            size: `${g.bolts.count} counterbores ${f2(p.brakeMountWasherOdIn + 0.125)}" wide × ${f2(p.brakeBackerCboreDeepIn)}" deep in the inner face, for the nut and fender washer of the knee bolts (the ${f2(bd)}" bolt hole goes through the middle)`,
            at: g.bolts.zs.flatMap((z) => g.bolts.xs.map((x): Vec3 => [x - (bk.x0 + bk.x1) / 2, -sgn * bk.t / 2, z - (bk.z0 + bk.z1) / 2])),
            cut: { kind: 'counterbore', dia: p.brakeMountWasherOdIn + 0.125, depth: p.brakeBackerCboreDeepIn, what: 'nut and washer of the knee bolts' } },
        ],
        notes: `Oak backer ${f2(bk.t)}" thick (|y| ${f2(Math.abs(yIn[0]))}" to ${f2(Math.abs(yIn[1]))}") x ${f2(bk.x1 - bk.x0)}" x ${f2(bk.z1 - bk.z0)}" on the inner face of the rail, from x = ${f2(bk.x0)}" to ${f2(bk.x1)}" (clear of the rear axle hanger), glued to the rail and the deck underside in the frame glue-up (before the deck goes on, the hull still right side up), so the knee bolts only have to be drilled through it later. A crossmember that lands on it is cut back ${f2(bk.t)}" and butts the backer face. The ${g.bolts.count} knee bolts end here, with washers and nuts in counterbores.`,
      }));
    }

    // ── The wheel chock (parked in front of the tire) and its cord ──
    if (tag === 'L' || p.brakeChockCount >= 2) {
      const ck = g.chock;
      const w = ck.width;
      const origin: Vec3 = [0, sgn * Y.wheel + w / 2, 0]; // the +y face of the wedge; the extrusion runs toward -y
      const outline = ck.poly;
      const chockPart = profilePart(ctx, {
        id: `brake-chock-${tag}`, partNo: 'brake-chock', name: `Wheel chock ${tag} (white oak wedge, shown parked)`, group: 'brake', mat: 'oak', outline: outline as Vec2[], depth: w, basis: 'xz', origin,
        grain: 'x', stock: { t: ck.height, w, l: ck.xBack - ck.xToe }, step: STEP.brake, fab: 'bandsaw', removable: true, explode: [1, sgn * 0.3, 0],
        joints: [eye(`brake-chock-cord-${tag}`, 1, `1 x #10 ${stainless(p)} screw eye in the back face, for the cord`)],
        notes: `Oak wedge ${f2(w)}" wide, ${f2(ck.height)}" tall, ${f2(ck.xBack - ck.xToe)}" long: the ramp face rises away from the tire at ${f2(ck.psi / (Math.PI / 180))} degrees and is tangent to the tire ${f2(ck.tangent[1])}" off the ground, so the rolling wheel has to climb it. Two stainless screw heads (or a sawtooth cut) left proud in the base bite the ground (μ ${f2(p.brakeChockMu)}, ${f2(p.brakeChockMuFouled)} when wet or fouled). Shown parked in front of the tire for a sled facing downhill; for a sled facing uphill it goes behind the tire, ${f2(p.brakeChockCordLenIn)}" of cord reaches. Comes off for transport. Face-laminated from stocked boards (D-70): no 12/4 is bought; glue up the blank from 4/4 layers face to face with epoxy and mill it to size before the wedge is bandsawn (the cut list gives the layers). Strength is taken as solid oak.`,
        sourcing: { vendor: `Shop-cut white oak wedge, ${f2(w)}" x ${f2(ck.height)}" x ${f2(ck.xBack - ck.xToe)}" (face-laminated from 4/4 layers, D-70: no 12/4 is bought; one bandsaw cut of the glued blank)` },
      });
      add1(chockPart);
      const a: Vec3 = [ck.kneeEye[0], yc, ck.kneeEye[1] - 0.2];
      const b: Vec3 = [ck.chockEye[0], yc, ck.chockEye[1] + 0.2];
      add1(cordPart(ctx, {
        id: `brake-chock-cord-${tag}`, partNo: 'brake-chock-cord', name: `Wheel chock cord ${tag}`, a, b, radius: 0.125, material: '1/4" braided polyester cord', removable: true, explode: [1, sgn * 0.3, 0.2],
        joints: [eye(`brake-knee-${tag}`, 1, `#10 ${stainless(p)} screw eye in the knee underside`), eye(`brake-chock-${tag}`, 1, `#10 ${stainless(p)} screw eye in the chock back face`)],
        sourcing: { vendor: `McMaster-Carr (1/4" braided polyester cord, ${f2(p.brakeChockCordLenIn)}" cut, whipped ends; shown here pulled straight between the two eyes, the rest is coiled)` },
        notes: `Ties the chock to the knee eye so it is never lost: ${f2(p.brakeChockCordLenIn)}" of 1/4" cord (${p.brakeCordBreakLbf} lbf breaking strength) reaches to the other side of the tire (the sled facing uphill) and back. The chock hangs from the cord when stowed.`,
      }));
    }
  }

  if (!movingOnly) parts.push(...buildHandle(ctx));
  return stockPass(parts);
}

/** Direction unit vectors for the exploded view. */
function stockPass(parts: Part[]): Part[] {
  for (const x of parts) if (x.explode) x.explode = unitDir(x.explode);
  return parts;
}

export function buildBrake(ctx: Ctx): Part[] {
  return buildBrakeAt(ctx, 0);
}

