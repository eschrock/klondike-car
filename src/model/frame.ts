/**
 * Frame (D-54): two straight ladder rails flush under the chines, the crossmembers (joists) that carry the deck, and the oak axle hangers that drop from each rail to the
 * rear axle beam. The front pivot (D-56): the rails are only `railDepthF` deep ahead of `railStepX` so the swinging front axle beam passes under them; the KING BEAM is
 * a crossmember between the rails at the kingpin, and the crossmember just behind it is the anchor of the two steering check chains (D-58). (No front hangers: the front beam is not seated in the
 * rails.) Joinery records (Dominos, loose tenons, glue) are added in joinery.ts.
 *
 * Side-to-frame tie (build review M6, D-43): the ladder rails run FLUSH UNDER THE CHINES (outer face at hw + side), not inboard of them, so the
 * chine bears on the rail top and is Domino-tied and epoxied to it every `chineTieSpacingIn`.
 */
import { AXLE_BEAM_POSITION } from '../params';
import { beamSeat, HEAD_HEIGHT_D, localPoint, MIN_THREADS_PAST_NUT, railSection } from './rear-mount';
import type { Layout } from './layout';
import type { Params } from '../params';
import { IN3_PER_FT3, STEP, box, roughOf, span, SIDES, woodMassLb, type Ctx, stainless } from './build-utils';
import { customPart } from './mesh-utils';
import { planWallGeometry } from './plan-wall';
import { brakeGeometry } from './brake-layout';
import type { Part, Vec2, Vec3 } from './types';

/** The kingpin nut's slot in the king beam has its ceiling this far under the deck (the bolt tip stands this far below the king beam's top, D-56). */
export const KING_NUT_BELOW_DECK_IN = 7 / 16;

/**
 * The kingpin's nut is a THIN nylon-insert lock nut (a nylock jam nut, D-88): about this many bolt diameters tall (the 5/8-11 one is about 29/64"; check the real nut, the slot
 * keeps 1/16" above and below it). The full nylock (0.687") needed a 1"-tall slot, which left only about 5/16" of king beam bore below it for the kingpin to bear in.
 */
const NYLOCK_JAM_HEIGHT_D = 0.725;
/** Room left round a nut and washer in a slot or a relief, and over a bolt head (in). */
const SLOT_CLEAR_IN = 1 / 16;
const HEAD_CLEAR_IN = 1 / 8;
const up16 = (v: number): number => Math.ceil(v * 16 - 1e-9) / 16;
const down16 = (v: number): number => Math.floor(v * 16 + 1e-9) / 16;
const tpi = (d: number): number => (d <= 0.25 ? 20 : d <= 0.3125 ? 18 : d <= 0.375 ? 16 : d <= 0.5 ? 13 : 11);

/**
 * The kingpin nut slot in the king beam (D-88): cut in from the front face at the top, the nut's width across the flats plus 1/32" wide, so its walls hold the thin nylock (jam) nut while the
 * bolt is turned from its head (the beam swings on the shank, not the nut); no washer under the nut. Tall enough for the nut and the bolt's threads past it with 1/16" room above and
 * below (3/4" for the 5/8" kingpin), its ceiling `KING_NUT_BELOW_DECK_IN` under the deck. x0..x1 fore-aft (x1 the front face). `nutAf` is the nut's width across the flats.
 */
export function kingNutSlot(p: Pick<Params, 'kingpinDiaIn'>, L: Pick<Layout, 'king'>): { w: number; h: number; ceil: number; floor: number; x0: number; x1: number; nutH: number; nutAf: number; boreBelow: number } {
  const kd = p.kingpinDiaIn, k = L.king;
  const nutH = NYLOCK_JAM_HEIGHT_D * kd, nutAf = 1.5 * kd;
  const w = nutAf + 1 / 32;
  const h = up16(nutH + MIN_THREADS_PAST_NUT / tpi(kd) + 2 * SLOT_CLEAR_IN);
  const ceil = k.top - KING_NUT_BELOW_DECK_IN;
  // the walls hold the nut by its flats, so its corners point fore and aft: the slot runs past the bore's center by half the nut's width across the corners, plus 1/32" (D-88)
  const back = nutAf / Math.sqrt(3) + 1 / 32;
  // boreBelow: the length of king beam bore below the slot, where the kingpin bears (the bolt tip stops under the slot ceiling, so none above it)
  return { w, h, ceil, floor: ceil - h, x0: k.x - back, x1: k.x + k.len / 2, nutH, nutAf, boreBelow: ceil - h - k.bot };
}

/**
 * The reliefs under the king beam for the inner front clamp-plate bolt heads (round 1 fix): the heads stand on the plates and sweep an arc about the kingpin as the axle swings,
 * so each end of the king beam's underside is relieved across its full fore-aft length, over the band of |y| the heads sweep under it, `HEAD_CLEAR_IN` clear of them.
 * `yIn`..`yOut` is that band (|y|), `depth` the relief. Null when the heads clear the king beam already.
 */
export function kingHeadRelief(p: Params, L: Layout): { yIn: number; yOut: number; depth: number } | null {
  const b = L.beamF, k = L.king, bd = p.uboltRodDiameterIn;
  const yst = b.len / 2 - p.frontStubLenIn + 0.25 + p.clampPlateWidthIn / 2; // the inner plate's center (pivot.ts)
  const leg = p.axleDiameterIn / 2 + p.clampLegGapIn;
  const headTop = b.top + p.axleProudIn + p.clampPlateThickIn + HEAD_HEIGHT_D * bd;
  const depth = up16(headTop + HEAD_CLEAR_IN - k.bot);
  if (depth <= 0) return null;
  const r = Math.hypot(leg, yst), rc = (1.5 * bd) / Math.sqrt(3); // the bolt's distance from the kingpin, the head's half-width across the corners
  const half = k.len / 2;
  const yIn = down16(Math.sqrt(Math.max(0, (r - rc) ** 2 - half ** 2)) - SLOT_CLEAR_IN), yOut = up16(r + rc + SLOT_CLEAR_IN);
  return { yIn, yOut, depth };
}

/** Part id of the joist at index i of `L.joistX` (the king beam is the one at the kingpin). */
export const joistId = (L: { joistX: number[]; king: { x: number } }, i: number): string => (L.joistX[i] === L.king.x ? 'king-beam' : `joist-${i + 1}`);

/** |y| range of a ladder rail: flush under the chine, outer face at the hull's outer face (D-43). */
export const ladderRailY = (hw: number, side: number, railT: number): [number, number] => [hw + side - railT, hw + side];

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/** The clearance hole for a brake-knee bolt (D-75, D-78): the bolt diameter plus 1/32 in, so 13/32 for the 3/8 in bolts. One number for the rail, the backer, the backing plate and the knee leg, and kinder to repeated dry refits of the removable knee than a tighter 25/64. */
export const kneeBoltHoleIn = (boltDiaIn: number): number => boltDiaIn + 1 / 32;
/** Nearest 1/32 in as a fraction string (a bolt clearance hole, e.g. 13/32). */
const frac32 = (x: number): string => { const n = Math.round(x * 32); let num = n % 32, den = 32; const whole = Math.floor(n / 32); while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; } return num === 0 ? `${whole}` : whole > 0 ? `${whole}-${num}/${den}` : `${num}/${den}`; };

export function buildFrame(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const jD = p.crossmemberDepthIn;
  const railT = p.railThicknessIn;
  const railD = p.railDepthIn;
  const rearTx = L.xRear + L.transom;
  const fxOf = (v: number) => v;
  void IN3_PER_FT3;
  const [rY0, rY1] = ladderRailY(L.hwC, L.side, railT);
  const seat = beamSeat(p, L);

  // ── Rails: straight oak bars from the rear transom to the end of the flat deck, shallower ahead of the front-axle swath (D-56) ──
  for (const { s, tag } of SIDES) {
    const zb = L.railTop - railD, zbF = L.railTop - L.railDepthF;
    const x0 = rearTx, x1 = L.railEnd, xs = L.railStepX;
    // Relief notch (D-56: the deck is only 8 in up, so the 3 in rail reaches below the rear axle beam top): cut up from the rail bottom where the beam passes under the rail,
    // 1/16 in clear of the beam. (The D-57 step brake needs no notch: its knee bolts to the rail bottom band.)
    const notches: { x0: number; x1: number; z: number }[] = [];
    const notchZ = L.beamR.top + 0.0625 + (p.axleBeamPosition === AXLE_BEAM_POSITION.underslung ? p.axleProudIn + p.clampPlateThickIn : 0);
    if (notchZ > zb) notches.push({ x0: L.beamR.x - L.beamR.thick / 2 - 0.0625, x1: L.beamR.x + L.beamR.thick / 2 + 0.0625, z: notchZ }); // D-66: high enough to clear the rear clamp plate (it stands on the tube, which is proud of the beam), whose inner part runs under the rail
    notches.sort((a, b) => a.x0 - b.x0);
    for (const n of notches) n.x0 = Math.max(n.x0, x0); // a notch cannot start behind the rail's rear end
    for (let i = notches.length - 1; i >= 0; i--) if (notches[i].x1 <= notches[i].x0 + 1e-6) notches.splice(i, 1);
    const bottomEdge: Vec2[] = [[x0, zb], ...notches.flatMap((n): Vec2[] => [[n.x0, zb], [n.x0, n.z], [n.x1, n.z], [n.x1, zb]])];
    const outline: Vec2[] = L.railDepthF < railD - 1e-6
      ? [...bottomEdge, [xs - p.railStepRunIn, zb], [xs, zbF], [x1, zbF], [x1, L.railTop], [x0, L.railTop]]
      : [...bottomEdge, [x1, zb], [x1, L.railTop], [x0, L.railTop]];
    let a2 = 0, per = 0;
    for (let i = 0; i < outline.length; i++) { const [px, pz] = outline[i], [qx, qz] = outline[(i + 1) % outline.length]; a2 += px * qz - qx * pz; per += Math.hypot(qx - px, qz - pz); }
    const area = Math.abs(a2) / 2;
    const mass = woodMassLb(p, area * railT, 2 * area + per * railT, p.oakDensityPcf);
    // Build 3c S2: the rail is TWO strips of railT/2 glued face to face and bent on the plan form, so the cut list shows the strip (the part carries plies: 2).
    // The strip is bent on the plan form, so it is cut as long as the DEVELOPED centerline (the arc along the plan curve), not the x extent of the finished rail.
    let developed = 0;
    for (let i = 0, n = Math.max(1, Math.ceil((x1 - x0) / 0.25)); i < n; i++) { const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n; developed += Math.hypot(xb - xa, L.turnIn(xb) - L.turnIn(xa)); }
    const stock = { t: railT / 2, w: railD, l: developed };
    const rail = customPart(ctx, {
      id: `rail-${tag}`, partNo: 'rail', name: `Rail ${tag}`, group: 'frame', kind: 'lumber', material: 'white oak',
      geometry: planWallGeometry(outline, railT, (x) => s * ((rY0 + rY1) / 2 - L.turnIn(x))), transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      massLb: mass, fab: 'bentlam', step: STEP.frame, grain: 'x', stock, rough: roughOf(p, stock, true), explode: [fxOf(0.6), s * 0.3, -0.6],
    });
    rail.notes = `${f2(railT)}" × ${f2(railD)}" oak bar, straight behind the bow turn-in and ${L.taper.turnIn > 0 ? `eased in with the hull from x = ${f2(L.taper.x0)}" to x = ${f2(L.taper.x1)}" (${f2(L.taper.turnIn)}" each side at the bow, D-66; cold-bent flat in 2 plies on the same plan form as the chine, the step and notches cut after bending)` : 'straight'}, ${f2(L.railEnd - rearTx)}" long from the rear transom's inner face to the end of the flat deck, outer face flush under the chine so the chine sits on it all the way (D-43). ${L.railDepthF < railD - 1e-6 ? `Ahead of x = ${f2(L.railStepX)}" it steps (a ${f2(p.railStepRunIn)}" run for ${f2(railD - L.railDepthF)}" of rise, a ${Math.round((Math.atan2(railD - L.railDepthF, p.railStepRunIn) * 180) / Math.PI)} degree slope) down to ${f2(L.railDepthF)}" deep so the front axle beam, swinging ±${p.steerLockDeg}° about the kingpin, passes under it with 0.4" to spare (D-56). ` : ''}Its top is flush with the chine bottom AND the deck underside (one deck level, D-52): the deck bonds to the rail top and its edge rises into the gap under the inner chine band (D-62; no rabbet is routed). The chine sits on the top of the rail's outer ${L.side}" and is Domino-tied (vertical Dominos) and epoxied to it every ${p.chineTieSpacingIn}". Frame + deck are one glued unit, turned over and lowered into the inverted side assemblies. Glue the frame with the rails 1/2" LONG at both ends: they are trimmed with the bands and webs to the measured transom-to-bulkhead length less 1/32" at the dry fit (S1). The rear axle hangers are bolted and glued to its inner face (${seat ? 'axle-hanger-' + tag : 'no hanger'}).`;
    // D-75 (readability review MUST-15e): the four brake-knee bolt holes get an ABSOLUTE layout on the rail (from its finished rear end and its top edge), so they are drilled with the frame
    // through the rail and the glued backer (the backer's counterbores are from the same points), without the knee as a template; the knee is then drilled to match from the same numbers.
    {
      const bgk = brakeGeometry(p, L);
      const kb = bgk.bolts;
      const pts: Vec3[] = kb.zs.flatMap((z) => kb.xs.map((x): Vec3 => [x, s * bgk.y.face, z]));
      const fromRear = kb.xs.map((x) => frac32(x - x0)).join('" and ');
      const belowTop = kb.zs.map((z) => L.railTop - z).sort((a, b) => a - b).map(frac32).join('" and ');
      (rail.joints ??= []).push({
        type: 'hole', to: `brake-knee-${tag}`, count: pts.length, diaIn: kb.dia, at: pts,
        size: `${pts.length} × ${frac32(kneeBoltHoleIn(kb.dia))}" holes for the ${frac32(kb.dia)}" brake-knee bolts, square through the rail and the glued backer: ${fromRear}" from the rail's finished rear end (the rear transom's inner face), ${belowTop}" below its top edge`,
        note: 'D-75: laid out from these numbers at the frame step and drilled from the outer face through the rail and the backer (no knee needed as a template); the knee leg is later drilled from the same positions (its rear face and the rail bottom)',
      });
    }
    rail.plies = 2;
    rail.notes += ` CUT LIST (build 3c S2): ${f2(railT / 2)}" × ${f2(railD + p.laminateWidthAllowanceIn)}" × ${f2(developed + p.laminateLengthAllowanceIn)}" strips, TWO per rail, resawn from the board the cut list's resaw plan names (it buys the spare strips too) and planed (strips this thin and ${f2(railD)}" wide need a planer sled or a drum sander); only the last ${f2(L.railEnd - L.taper.x0)}" is curved.`;
    parts.push(rail);
  }

  // ── Rear axle hangers (D-54): the rails stand above the axle beam, so an oak hanger on the inside of each rail carries the beam's seat (the D-48 notch and hold-down angle).
  //    (The front axle is NOT seated in the rails: it pivots under the king beam, D-56.) ──
  const axles = [{ beam: L.beamR, pre: 'axle-hanger', label: 'Rear', beamId: 'beam-R' }] as const;
  const hangerAt = (x: number) => axles.some((a) => Math.abs(x - a.beam.x) < p.axleHangerWidthIn / 2 + L.joistT / 2);
  for (const a of axles) {
    const sa = beamSeat(p, L, a.beam);
    if (!sa) continue;
    const rsa = railSection(p, L, a.beam);
    const hx0 = a.beam.x - p.axleHangerWidthIn / 2, hx1 = a.beam.x + p.axleHangerWidthIn / 2;
    const notchLb = ((sa.x1 - sa.x0) * sa.depth * rsa.t / 1728) * p.oakDensityPcf;
    for (const { s, tag } of SIDES) {
      const yOut = rsa.yOut, yIn = rsa.yIn; // |y| of the hanger's outer face (= the rail's inner face) and its inner face
      const hg = box(ctx, {
        id: `${a.pre}-${tag}`, partNo: a.pre, name: `${a.label} axle hanger ${tag}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'z', // step: with the frame (Phase 4), because joist-1's end Dominos go into the hanger
        ...span([hx0, hx1], s > 0 ? [yIn, yOut] : [-yOut, -yIn], [rsa.zBot, rsa.zSolidTop]),
      });
      hg.massLb -= notchLb;
      // The axle rod stands axleProudIn above the beam top, under the notch ceiling: a shallow relief in the ceiling clears it, so the ceiling bears on the beam either side (round 1 fix).
      const rw = up16(p.axleDiameterIn + SLOT_CLEAR_IN), rd = up16(p.axleProudIn + 1 / 32);
      hg.joints = [
        { type: 'dado', to: a.beamId, count: 1, size: `${f2(sa.x1 - sa.x0)}" wide × ${f2(sa.depth)}" deep notch up from the hanger bottom (beam ${f2(a.beam.thick)}" + ${f2(p.beamNotchClearIn)}" each side), ceiling bears on the beam top`, at: [localPoint(hg.transform, [a.beam.x, (yOut + yIn) / 2 * s, sa.zBot + sa.depth / 2])], note: 'the beam passes under the rail and the hanger sits on it; bandsaw + chisel, corners relieved with a 1/4" radius' },
        {
          type: 'hole', to: 'axle-R', count: 1, size: `relief ${f2(rw)}" wide × ${f2(rd)}" deep in the notch ceiling, centered on the notch, through the thickness`,
          cut: { kind: 'slot', lo: localPoint(hg.transform, [a.beam.x - rw / 2, s > 0 ? yIn : -yOut, sa.zTop]), hi: localPoint(hg.transform, [a.beam.x + rw / 2, s > 0 ? yOut : -yIn, sa.zTop + rd]), what: 'clears the axle rod, which stands proud of the beam top' },
        },
      ];
      hg.notes = `${a.label} axle hanger (D-54): ${f2(p.axleHangerWidthIn)}" × ${f2(rsa.t)}" oak, vertical grain, from the rail top (${f2(rsa.zSolidTop)}") down to ${f2(rsa.zBot)}", glued and bolted to the INSIDE face of the rail. The bottom is notched ${f2(sa.x1 - sa.x0)}" × ${f2(sa.depth)}" so it straddles the axle beam and bears on its top (D-48 seat); ${f2(sa.remain)}" of oak is left above the notch. The ${stainless(p)} hold-down angle lies against its inner face.`;
      parts.push(hg);
    }
  }

  // ── Joists: between the rails, under the deck. A joist that meets a hanger is cut back to the hanger's inner face. The one at the kingpin is the KING BEAM (D-56). ──
  L.joistX.forEach((x, i) => {
    const isKing = x === L.king.x;
    const meetsHanger = hangerAt(x);
    const bkr = brakeGeometry(p, L).backer; // the step brake's oak backers on the rail inner faces (D-57): a joist that meets one is cut back to its inner face
    const meetsBacker = x + L.joistT / 2 > bkr.x0 && x - L.joistT / 2 < bkr.x1;
    const halfT = x === L.king.x ? L.king.len : x === L.chain.joistX ? L.chain.joistT : L.joistT; // the chain joist is thicker than the others (D-58)
    const cutBack = (meetsHanger ? p.axleHangerThickIn : 0) + (meetsBacker && !meetsHanger ? bkr.t : 0);
    // `halfT` is the member's fore-aft thickness. In the bow taper the rail's inner face comes in toward the bow, so a square-ended box reaches the rail at its FRONT face (the short point)
    // and the model box stops there; the REAR face is the long point, and the end is scribed to the rail between the two. The cut list (stock.l) is the long point.
    const half = rY0 - L.turnIn(x + halfT / 2) - cutBack;
    const halfLong = rY0 - L.turnIn(x - halfT / 2) - cutBack;
    const scribed = halfLong - half > 1e-4;
    const scribeNote = scribed ? `In the bow taper its ends are scribed to the bent rails: ${frac32(2 * halfLong)}" long at the rear face (the long point, the cut-list length), ${frac32(2 * half)}" at the front face. ` : '';
    if (isKing) {
      const k = L.king;
      const kb = box(ctx, {
        id: 'king-beam', partNo: 'king-beam', name: 'King beam (kingpin crossmember)', group: 'front-end', mat: 'oak', step: STEP.frame, grain: 'y',
        ...span([k.x - k.len / 2, k.x + k.len / 2], [-half, half], [k.bot, k.top]),
        ...(scribed ? { stock: { t: k.top - k.bot, w: k.len, l: 2 * halfLong } } : {}),
      });
      // The nut slot (cut from the front face, D-88): its walls hold the nylock nut (no washer), its ceiling KING_NUT_BELOW_DECK_IN under the deck.
      const ks = kingNutSlot(p, L);
      const slotW = ks.w, slotCeil = ks.ceil, slotH = ks.h, slotFloor = ks.floor;
      const slotX0 = ks.x0, slotX1 = ks.x1;
      kb.joints = [{
        type: 'hole', to: 'kingpin', count: 1,
        size: `slot ${f2(slotW)}" wide (across) × ${f2(slotH)}" tall × ${f2(slotX1 - slotX0)}" deep (fore-aft), cut in from the front face and centered on the kingpin bore; its ceiling leaves ${f2(KING_NUT_BELOW_DECK_IN)}" of oak under the deck`,
        at: [localPoint(kb.transform, [slotX1, 0, (slotFloor + slotCeil) / 2])],
        cut: { kind: 'slot', lo: localPoint(kb.transform, [slotX0, -slotW / 2, slotFloor]), hi: localPoint(kb.transform, [slotX1, slotW / 2, slotCeil]), what: 'to hold the kingpin\'s thin nylock (jam) nut (its walls stop it turning)' },
      }];
      kb.massLb -= (slotW * slotH * (slotX1 - slotX0) / IN3_PER_FT3) * p.oakDensityPcf;
      const hr = kingHeadRelief(p, L);
      if (hr) {
        for (const { s: sg } of SIDES) {
          kb.joints.push({
            // Recorded against the kingpin, the pivot the heads swing about (the plates carry no joint to the king beam, and a hole joint on them would draw a hole).
            type: 'hole', to: 'kingpin', count: 1,
            size: `relief ${f2(hr.yOut - hr.yIn)}" wide × ${f2(hr.depth)}" deep across the underside, the full ${f2(k.len)}" fore-aft, ${f2(hr.yIn)}" to ${f2(hr.yOut)}" from the center line`,
            cut: { kind: 'relief', lo: localPoint(kb.transform, [k.x - k.len / 2, sg > 0 ? hr.yIn : -hr.yOut, k.bot]), hi: localPoint(kb.transform, [k.x + k.len / 2, sg > 0 ? hr.yOut : -hr.yIn, k.bot + hr.depth]), what: 'clears the inner clamp-plate bolt heads as the axle swings' },
          });
        }
        kb.massLb -= (2 * (hr.yOut - hr.yIn) * hr.depth * k.len / IN3_PER_FT3) * p.oakDensityPcf;
      }
      kb.notes = `The front load path (D-56): an oak crossmember ${f2(k.len)}" fore-aft × ${f2(k.depth)}" deep between the rails at the kingpin, bonded to the deck underside and Domino-tied and epoxied to the rails. The ${f2(p.kingpinDiaIn)}" kingpin bolt is bored through its center; a slot cut from the front face (${f2(slotW)}" wide × ${f2(slotH)}" tall, at the TOP of the king beam: its ceiling is ${f2(KING_NUT_BELOW_DECK_IN)}" under the deck; build 3c S5 made the two descriptions agree) holds the thin nylock (jam) nut by its flats (no washer), so the bolt is turned from its head; the axle beam swings on the shank (D-88). The UHMW thrust disc is screwed to its underside and the top of the axle beam turns under it (D-58); the clamp plates on the beam top pass under the king beam with 1/8 in to spare.${scribed ? ` ${scribeNote.trim()}` : ''}`;
      parts.push(kb);
      return;
    }
    const isChain = x === L.chain.joistX && x !== L.king.x;
    const jt = isChain ? L.chain.joistT : L.joistT;
    parts.push(box(ctx, {
      id: joistId(L, i), partNo: isChain ? 'chain-joist' : 'joist', name: `Crossmember ${i + 1}`, group: 'frame', mat: 'oak', step: STEP.frame, grain: 'y',
      ...span([x - jt / 2, x + jt / 2], [-half, half], [L.deckBot - jD, L.deckBot]),
      ...(scribed ? { stock: ((d) => ({ t: d[0], w: d[1], l: 2 * halfLong }))([jt, jD].sort((a, b) => a - b)) } : {}),
      ...(x === L.joistX[L.joistX.length - 1] ? { notes: 'The last crossmember, under the scarf of the deck to the bow bulkhead (D-54, D-57).' } : {}),
      ...(isChain ? { notes: `The chain crossmember (D-58): ${f2(jt)}" thick (the others are ${f2(L.joistT)}") because the two steering check chains are anchored to it, ${f2(Math.abs(L.chain.anchor[1]))}" either side of the center line, by forged eye bolts through it (the eyes stand out of the front face, the 2" washers and nuts are on the rear face). The chain pull is plan bending toward the rails. ${scribeNote}` } : scribed ? { notes: scribeNote.trim() } : {}),
      ...(meetsHanger || meetsBacker ? { notes: `${meetsHanger ? `Cut back ${f2(p.axleHangerThickIn)}" at each end to clear an axle hanger. ` : ''}${meetsBacker && !meetsHanger ? `Cut back ${f2(bkr.t)}" at each end to clear the brake knee backers (D-57). ` : ''}${scribeNote}` } : {}),
    }));
  });

  return parts;
}

