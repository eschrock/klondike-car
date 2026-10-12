/**
 * The handler's STEP BRAKE (Phase 3c-4b, D-57 item 8): a kick-scooter fender brake on each rear tire. No welding, no custom steel; everything is shop-cut oak, a
 * purchased 316 stainless hinge, rubber sheet, stainless bolts and screws, shock cord and 1/4" cord.
 *
 *   oak FLAP over the tire ── 316 butt HINGE at its front end, on the arm of an oak KNEE ahead of the tire ── the knee is bolted through the rail into an oak BACKER
 *   glued to the inside of the rail ── under the flap an oak SHOE BLOCK carries a rubber PAD that lands on the tread when the handler steps on the flap's far end,
 *   level with the rear transom ── a shock-cord (bungee) set lifts the flap ── two oak wedge CHOCKS hang on cords from the knees for parking.
 *
 * `brake-layout.ts` is the single source for the kinematics; both the part builder here and the analysis (`analysis/brake.ts`) read it. Pose s = 0 is released
 * (the model default), s = 1 is applied (the pad on the tread). Plain TS (no three.js).
 */
import { STEP, box, cylinder, SIDES, unitDir, type Ctx } from './build-utils';
import { atPose, brakeGeometry, hull2, polyArea, rot2, type BrakeGeom, type V2 } from './brake-layout';
import { buildHandle } from './handle';
import { basisMatrix, profilePart } from './profile';
import { boltLength, inchesText } from './rear-mount';
import type { Joint, Part, Vec2, Vec3 } from './types';

export { atPose, brakeGeometry, rot2, hull2 };
export type { BrakeGeom, V2 };

/** Rubber sheet density (about 75 lb/ft³): a placeholder for a purchased item. */
const RUBBER_LB_PER_IN3 = 0.045;
/** 316 stainless density (lb/in³) for the hinge. */
const SS_LB_PER_IN3 = 0.29;
const CORD_LB_PER_IN = 0.004;
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
 * parts that stay on the cart (hinge, knees, backers, chocks and their cords, the handle).
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
  const sd = p.brakeHingeScrewDiaIn;
  const nS = Math.round(p.brakeHingeScrewsPerLeaf);
  const screw = (to: string, count: number, size: string, note?: string): Joint => ({ type: 'screw', to, count, diaIn: sd, size, ...(note ? { note } : {}) });
  const rotPts = (pts: V2[]): V2[] => pts.map(at);

  for (const { s: sgn, tag } of SIDES) {
    const yc = sgn * Y.wheel;

    // ── The oak flap: a straight board from the hinge back over the tire to the foot area ──
    {
      const b = g.board;
      const c = at(b.c);
      const flap = box(ctx, {
        id: `brake-flap-${tag}`, partNo: 'brake-flap', name: `Brake flap ${tag} (white oak)`, group: 'brake', mat: 'oak', step: STEP.brake, grain: 'x', fab: 'table-saw',
        size: [b.len, b.w, b.thick], center: [c[0], yc, c[1]], rot: { y: -(g.sigma - phi) }, explode: [-0.4, sgn * 0.5, 1],
        joints: [
          screw(`brake-hinge-${tag}`, nS, `${nS} x #10 x 1" 316 flat-head screws through the hinge's flap leaf into the flap top, ${f2(g.hinge.leaf)}" leaf, pilot-drilled, epoxy in the holes`),
          screw(`brake-shoe-${tag}`, 2, '2 x #10 x 2" 316 screws up through the shoe block into the flap, glued with epoxy', 'the screws and the glue take the pad friction'),
          screw(`brake-cord-${tag}`, 1, '1 x #10 316 stainless screw eye (3/16" ring) in the flap top at the front edge of the foot area'),
        ],
        notes: `White oak ${f2(b.thick)}" x ${f2(b.w)}" x ${f2(b.len)}" (5/4 stock planed), grain along the flap, one board. It slopes down ${f2(g.sigma / (Math.PI / 180))} degrees toward the rear so the foot end is lower than the hinge; the foot area is the last ${f2(p.brakeFootPadLengthIn)}" (x from ${f2(g.xEnd)}" to ${f2(g.xEnd + p.brakeFootPadLengthIn)}", centered ${f2(Math.abs(g.F[0] - L.xRear))}" ${g.F[0] < L.xRear ? 'behind' : 'ahead of'} the transom face, outboard of the body), grooved with the table saw (3/16" deep, 1/2" apart) or covered with a strip of rubber stair tread. Round the corners and roundover the edges. Epoxy-seal before the finish. At the foot area it stands ${f2(g.F[1])}" off the ground; stepping on it swings the pad ${f2(p.brakePadGapIn)}" onto the tread (foot stroke about ${f2(g.footDrop)}").`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(b.thick)}" x ${f2(b.w)}" x ${f2(b.len)}" (a 5/4 board planed to ${f2(b.thick)}"); the hinge, shoe and eye holes are drilled from the parts as templates` },
      });
      add1(flap);
    }

    // ── The oak shoe block: a wedge between the flap underside and the pad ──
    {
      const outline = rotPts(g.shoe.outline);
      const [qy0, qy1] = [Y.pad[0], Y.pad[1]];
      const bb = bbox(outline);
      const origin: Vec3 = [0, sgn > 0 ? qy1 : -qy0, 0];
      const shoe = profilePart(ctx, {
        id: `brake-shoe-${tag}`, partNo: 'brake-shoe', name: `Brake shoe block ${tag} (white oak wedge)`, group: 'brake', mat: 'oak', outline: outline as Vec2[], depth: qy1 - qy0, basis: 'xz', origin,
        grain: 'y', stock: { t: qy1 - qy0, w: bb.z1 - bb.z0, l: bb.x1 - bb.x0 }, step: STEP.brake, fab: 'bandsaw', explode: [0.2, sgn, 0.6],
        joints: [
          screw(`brake-flap-${tag}`, 2, '2 x #10 x 2" 316 screws up through the block into the flap, glued with epoxy'),
          { type: 'glue', to: `brake-flap-${tag}`, count: 1, note: 'epoxy, full face' },
          screw(`brake-pad-${tag}`, 2, '2 x #8 x 1" 316 flat-head screws (heads buried 1/8" in the rubber) through the pad into the block', 'plus contact cement over the full face'),
        ],
        notes: `Bandsawn from 2" white oak: the top face follows the flap underside (${f2(g.sigma / (Math.PI / 180))} degrees), the bottom face is cut to the tire radius (${f2(g.r + p.brakePadThickIn)}" from the axle, a template on a router sled or sandpaper on the tire), ${f2(p.brakeShoeBlockIn)}" thick at its thinnest. The rubber pad is glued and screwed on the curved face. Ends cut vertical.`,
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
        massLb: area * (qy1 - qy0) * RUBBER_LB_PER_IN3, fab: 'buy', step: STEP.brake, explode: [0.2, sgn, 0.4],
        joints: [screw(`brake-shoe-${tag}`, 2, '2 x #8 x 1" 316 flat-head screws, heads buried 1/8" in the rubber, plus contact cement over the full face')],
        sourcing: { vendor: `McMaster-Carr (${f2(pad.thick)}" 60-70A neoprene or SBR rubber sheet; cut ${f2(pad.length)}" x ${f2(qy1 - qy0)}", or veg-tan leather of the same size)` },
        notes: `Rubber (or leather) pad ${f2(pad.length)}" x ${f2(qy1 - qy0)}" x ${f2(pad.thick)}", centered ${f2(g.alpha / (Math.PI / 180))} degrees behind the top of the tire. Design μ ${f2(p.brakePadMu)} on a wet tread, ${f2(p.brakePadMuFouled)} mud or snow fouled (pass/fail). Hangs ${f2(p.brakePadGapIn)}" off the tread released. Wears like a shoe sole: replace when the screws get close to the surface. Test a sample on a wet tire first.`,
      };
      add1(part);
    }

    // ── The return cord set: shock cord and its stop cord, from the flap eye to an eye screw in the rear transom ──
    {
      const bg = g.bungee;
      const E = at(bg.E);
      const a: Vec3 = [E[0], sgn * Y.eye, E[1]];
      const b: Vec3 = [bg.A[0], sgn * bg.A[1], bg.A[2]];
      add1(cordPart(ctx, {
        id: `brake-cord-${tag}`, partNo: 'brake-cord', name: `Brake return bungee and stop cord ${tag}`, a, b, radius: 0.125, material: '1/4" shock cord (polyester sheath) with a 3/16" polyester stop cord',
        joints: [screw(`brake-flap-${tag}`, 1, '#10 316 stainless screw eye in the flap top'), screw('transom-rear', 1, '#10 316 stainless screw eye in the aft face of the rear transom, near its outer corner (a backer lies behind it)')],
        explode: [-0.5, sgn * 0.5, 1],
        sourcing: { vendor: `McMaster-Carr (1/4" shock cord with polyester sheath, ${f2(bg.lenRel + 2)}" cut, whipped ends tied to the eyes; 3/16" polyester braid for the stop cord, ${f2(bg.lenRel)}" between the eyes; two #10 316 stainless screw eyes)` },
        notes: `The bungee pulls the flap up with ${f2(bg.tRel)} lbf released (the stop cord, tied taut at the released length ${f2(bg.lenRel)}" between the eyes, sets the lift and holds the pad ${f2(p.brakePadGapIn)}" off the tread), stretching to ${f2(bg.tApp)} lbf when the flap is down (${f2(bg.rate)} lbf per inch). The flap eye is at the rear end of the flap, inboard edge (${f2(Math.abs(bg.E[0] - L.xRear))}" ${bg.E[0] < L.xRear ? 'behind' : 'ahead of'} the transom face); the transom eye is ${f2(p.brakeBungeeAnchorBelowTopIn)}" below the transom top and ${f2(p.brakeBungeeAnchorInsetIn)}" in from the side's outer face (clear of the handle sockets and of the sign zone on the sides, D-57). The cord is a wear item: replace it when it goes slack.`,
      }));
    }

    if (movingOnly) continue;

    // ── The hinge: a 316 stainless butt hinge on the knee top (the flap leaf lies on the flap) ──
    {
      const h = g.hinge;
      add1(box(ctx, {
        id: `brake-hinge-${tag}`, partNo: 'brake-hinge', name: `Brake hinge ${tag} (316 stainless butt hinge)`, group: 'brake', mat: 'fixed', kind: 'purchased', step: STEP.brake, fab: 'buy',
        massLb: (2 * h.leaf * h.len * (h.z1 - h.z0) + (Math.PI / 4) * 0.25 ** 2 * h.len) * SS_LB_PER_IN3, material: '316 stainless steel butt hinge', size: [h.x1 - h.x0, h.len, h.z1 - h.z0],
        center: [(h.x0 + h.x1) / 2, yc, (h.z0 + h.z1) / 2], explode: [0, sgn * 0.3, 1],
        sourcing: { vendor: `McMaster-Carr (316 stainless steel butt hinge, ${f2(h.len)}" leaf height, ${f2(2 * h.leaf)}" open width, about 12 gauge, with a ${f2(p.brakeHingePinDiaIn)}" pin; countersunk for #10 screws)` },
        joints: [
          screw(`brake-flap-${tag}`, nS, `${nS} x #10 x 1" 316 flat-head screws into the flap top`),
          screw(`brake-knee-${tag}`, nS, `${nS} x #10 x 1" 316 flat-head screws into the knee top`),
        ],
        notes: `Surface-mounted on the TOPS: one leaf (${f2(h.leaf)}") on the knee arm, the other on the flap's front end. The pin axis lies on the line where the two top faces meet, ${f2(g.xh)}" ahead of the axle (${f2(p.brakeHingeAheadIn)}" ahead of the tire's front) and ${f2(g.H[1])}" off the ground. A 1/8" gap between the flap's front face and the knee lets the flap swing (${f2(g.theta / (Math.PI / 180))} degrees released to applied). Drawn flat on the knee; the flap leaf follows the flap.`,
      }));
    }

    // ── The oak knee (outrigger) that carries the hinge ahead of the tire, bolted to the rail ──
    {
      const kn = g.knee;
      const poly = sgn > 0 ? kn.poly : [...kn.poly].reverse().map((q): V2 => [-q[0], q[1]]);
      const stackBolt = inchesText(boltLength(g.bolts.stack, bd));
      const bb = bbox(kn.poly);
      add1(profilePart(ctx, {
        id: `brake-knee-${tag}`, partNo: 'brake-knee', name: `Brake hinge knee ${tag} (white oak outrigger)`, group: 'brake', mat: 'oak', outline: poly as Vec2[], depth: kn.x1 - kn.x0, basis: 'yz', origin: [kn.x0, 0, 0],
        grain: 'y', stock: { t: kn.x1 - kn.x0, w: bb.z1 - bb.z0, l: Math.abs(kn.yOut - Y.face) }, step: STEP.brake, fab: 'bandsaw', explode: [0.3, sgn, 0.3],
        joints: [
          { type: 'bolt', to: `rail-${tag}`, count: g.bolts.count, diaIn: bd, size: `${g.bolts.count} x ${f2(bd)}" x ${stackBolt}" 316 hex bolts (${g.bolts.xs.length} columns x ${g.bolts.zs.length} rows), fender washers and nylock nuts, through this leg and the rail into the backer`, note: `the nuts and washers sit in 1/2" counterbores in the backer's inner face; the heads are in counterbores in the knee's outboard face. Epoxy the holes.` },
          { type: 'glue', to: `rail-${tag}`, count: 1, note: 'epoxy, leg against the rail and chine outer face (the bolts clamp it)' },
          screw(`brake-hinge-${tag}`, nS, `${nS} x #10 x 1" 316 screws into the knee top`),
          screw(`brake-chock-cord-${tag}`, 1, '1 x #10 316 stainless screw eye in the underside, for the chock cord'),
        ],
        notes: `Oak outrigger bandsawn from ${f2(kn.x1 - kn.x0)}" stock: a ${f2(kn.legT)}" leg on the hull's outer face (rail and chine, z ${f2(kn.zBot)}" to ${f2(kn.zLeg)}"), an arm ${f2(kn.armT)}" thick that reaches out ${f2(kn.yOut - Y.face)}" over the gap beside the tire, braced by the sloping underside, with its top flat at z = ${f2(kn.zTop)}" for the hinge. It stands ahead of the tire (x ${f2(kn.x0)}" to ${f2(kn.x1)}", the tire front is ${f2(g.r)}"), its bottom on the rail bottom (${f2(kn.zBot)}" off the ground). Bolted through the rail into the backer, not the thin side panel, so the loads go into the rail and the deck.`,
        sourcing: { vendor: `Shop-cut white oak, ${f2(kn.x1 - kn.x0)}" x ${f2(bb.z1 - bb.z0)}" x ${f2(Math.abs(kn.yOut - Y.face))}" blank (laminate two 5/4 boards if no thick stock)` },
      }));
    }

    // ── The oak backer inside the rail ──
    {
      const bk = g.backer;
      const yIn = sgn > 0 ? [bk.y0, bk.y1] : [-bk.y1, -bk.y0];
      add1(box(ctx, {
        id: `brake-backer-${tag}`, partNo: 'brake-backer', name: `Brake knee backer ${tag} (white oak)`, group: 'brake', mat: 'oak', step: STEP.brake, grain: 'x', fab: 'table-saw',
        size: [bk.x1 - bk.x0, bk.t, bk.z1 - bk.z0], center: [(bk.x0 + bk.x1) / 2, sgn * (bk.y0 + bk.y1) / 2, (bk.z0 + bk.z1) / 2], explode: [0, -sgn * 0.3, -1],
        joints: [
          { type: 'glue', to: `rail-${tag}`, count: 1, note: 'epoxy, full face against the rail inner face' },
          { type: 'glue', to: 'deck', count: 1, note: 'epoxy along the top edge, against the deck underside' },
        ],
        notes: `Oak backer ${f2(bk.t)}" thick (|y| ${f2(Math.abs(yIn[0]))}" to ${f2(Math.abs(yIn[1]))}") x ${f2(bk.x1 - bk.x0)}" x ${f2(bk.z1 - bk.z0)}" on the inner face of the rail, from x = ${f2(bk.x0)}" to ${f2(bk.x1)}" (clear of the rear axle hanger), glued to the rail and the deck underside before the bolts go in. The crossmember that meets it is cut back ${f2(bk.t)}" and butts the backer face. The ${g.bolts.count} knee bolts end here, with washers and nuts in counterbores.`,
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
        grain: 'x', stock: { t: w, w: ck.height, l: ck.xBack - ck.xToe }, step: STEP.brake, fab: 'bandsaw', removable: true, explode: [1, sgn * 0.3, 0],
        joints: [screw(`brake-chock-cord-${tag}`, 1, '1 x #10 316 stainless screw eye in the back face, for the cord')],
        notes: `Oak wedge ${f2(w)}" wide, ${f2(ck.height)}" tall, ${f2(ck.xBack - ck.xToe)}" long: the ramp face rises away from the tire at ${f2(ck.psi / (Math.PI / 180))} degrees and is tangent to the tire ${f2(ck.tangent[1])}" off the ground, so the rolling wheel has to climb it. Two stainless screw heads (or a sawtooth cut) left proud in the base bite the ground (μ ${f2(p.brakeChockMu)}, ${f2(p.brakeChockMuFouled)} when wet or fouled). Shown parked in front of the tire for a cart facing downhill; for a cart facing uphill it goes behind the tire, ${f2(p.brakeChockCordLenIn)}" of cord reaches. Comes off for transport.`,
        sourcing: { vendor: `Shop-cut white oak wedge, ${f2(w)}" x ${f2(ck.height)}" x ${f2(ck.xBack - ck.xToe)}" (a single bandsaw cut of a 2x4-class blank)` },
      });
      add1(chockPart);
      const a: Vec3 = [ck.kneeEye[0], yc, ck.kneeEye[1] - 0.2];
      const b: Vec3 = [ck.chockEye[0], yc, ck.chockEye[1] + 0.2];
      add1(cordPart(ctx, {
        id: `brake-chock-cord-${tag}`, partNo: 'brake-chock-cord', name: `Wheel chock cord ${tag}`, a, b, radius: 0.125, material: '1/4" braided polyester cord', removable: true, explode: [1, sgn * 0.3, 0.2],
        joints: [screw(`brake-knee-${tag}`, 1, '#10 316 stainless screw eye in the knee underside'), screw(`brake-chock-${tag}`, 1, '#10 316 stainless screw eye in the chock back face')],
        sourcing: { vendor: `McMaster-Carr (1/4" braided polyester cord, ${f2(p.brakeChockCordLenIn)}" cut, whipped ends; shown here pulled straight between the two eyes, the rest is coiled)` },
        notes: `Ties the chock to the knee eye so it is never lost: ${f2(p.brakeChockCordLenIn)}" of 1/4" cord (${p.brakeCordBreakLbf} lbf breaking strength) reaches to the other side of the tire (the cart facing uphill) and back. The chock hangs from the cord when stowed.`,
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

