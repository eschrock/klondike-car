/**
 * Steering: turntable, bolster, kingpin, stops, tongue, bridle (D-12, D-14); Phase 3 detail (D-31…D-34):
 *  - steering stops: steel-faced oak dogs on the beam, four oak stop blocks in the corners of the bolster opening (M1),
 *  - structured bolster fasteners the analysis reads (M7), kingpin sleeve / hub specs (M11),
 *  - bridle eye bolts at the front beam and rope legs that start at them (M6),
 *  - the removable kingpin-nut access panel in the nose deck (M10).
 */
import { DRAWBAR, steerStopPlan } from '../params';
import { IN3_PER_FT3, STEP, box, cylinder, span, SIDES, woodMassLb, type Ctx } from './build-utils';
import { compose } from './mat4';
import { circlePath, customPart, mergeMeshes, pathLength, tubeAlong } from './mesh-utils';
import type { Joint, Part, Vec3 } from './types';

// ── Block-model placeholders ──
/** Bridle rope: reach ahead of the tongue tip, section, mass (spec). */
const BRIDLE_LEN_IN = 18;
/** Rope bridle: ring this far ahead of the front axle. */
export const BRIDLE_APEX_AHEAD_IN = 24;
const BRIDLE_SECTION_IN = 0.5;
const BRIDLE_MASS_LB = 1;
/** Bolster fastener rows sit this far in from the ends of the fore and aft rails. */
const RING_BOLT_END_IN = 1;
/** Eye-bolt ring: tube radius as a fraction of the shank, ring outside diameter as a multiple of the shank diameter. */
const EYE_TUBE_FRAC = 0.9;
const EYE_OD_FACTOR = 2.7;
/** Extra bolt length past the grip for the nut and thread (in). */
const NUT_ALLOWANCE_IN = 0.75;

const VENDOR = 'McMaster-Carr or equivalent';

const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

/** 3/8 -> "3/8", 0.75 -> "3/4" (nearest 1/16). */
export function frac(x: number): string {
  const w = Math.floor(x + 1e-9);
  const sixteenths = Math.round((x - w) * 16);
  if (sixteenths === 0) return `${w}`;
  if (sixteenths === 16) return `${w + 1}`;
  let n = sixteenths, d = 16;
  while (n % 2 === 0) { n /= 2; d /= 2; }
  return `${w > 0 ? `${w}-` : ''}${n}/${d}`;
}

/** Bolt positions for `n` through-bolts on the bolster rails: half on the fore rail, half on the aft, staggered about the crossbar. */
export function ringBoltLayout(n: number, bo: { x0: number; x1: number; halfY: number; rw: number }, cb: number): Array<{ rail: 'fore' | 'aft'; x: number; y: number }> {
  const out: Array<{ rail: 'fore' | 'aft'; x: number; y: number }> = [];
  const yr = bo.halfY - RING_BOLT_END_IN;
  for (const rail of ['fore', 'aft'] as const) {
    const k = rail === 'fore' ? Math.ceil(n / 2) : Math.floor(n / 2);
    const m = Math.ceil(k / 2);
    const lo = cb + 1;
    const ys = Array.from({ length: m }, (_, j) => (m === 1 ? yr : lo + ((yr - lo) * j) / (m - 1)));
    const x = rail === 'fore' ? bo.x1 - bo.rw / 2 : bo.x0 + bo.rw / 2;
    for (let i = 0; i < k; i++) {
      const sgn = (i + (rail === 'fore' ? 0 : 1)) % 2 === 0 ? 1 : -1;
      out.push({ rail, x, y: sgn * ys[Math.floor(i / 2)] });
    }
  }
  return out;
}

export function buildSteering(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const ts = p.turntableSizeIn;
  const kx = L.kx;
  const bo = L.bolster;
  const cb = L.crossbar;
  const ringDepth = bo.z1 - bo.z0;
  const nBolt = Math.max(1, Math.round(p.bolsterFastenerCount));
  const boltDia = p.bolsterFastenerDiameterIn;
  const bolts = ringBoltLayout(nBolt, bo, cb ? cb.hw : 0);

  // ── Turntable ──
  parts.push(box(ctx, {
    id: 'turntable', name: 'Turntable (lazy susan)', group: 'steering', steer: true, mat: 'fixed', massLb: p.turntableMassLb,
    kind: 'purchased', material: 'steel turntable bearing', fab: 'buy', step: STEP.steering,
    ...span([kx - ts / 2, kx + ts / 2], [-ts / 2, ts / 2], [L.turntable.z0, L.turntable.z1]),
    sourcing: { vendor: `${VENDOR}: ${ts}" square lazy-susan turntable bearing, rated ${p.turntableRatingLb} lb (D-28; catalog estimate, verify the part bought)` },
    joints: [
      { type: 'screw', to: 'beam-F', count: 4, size: `${frac(5 / 16)}" × 2-1/2" lag screws through the bottom-plate holes into the beam top`, diaIn: 5 / 16, note: 'Bottom plate on the front beam; the top plate carries the bolster ring.' },
    ],
    notes: `Centerd on the kingpin (D-25). Estimate mass; ${p.turntableRatingLb} lb rated (D-12), thrust only: the roll moment goes through the side-bearers and the pitch moment through the sleeved kingpin couple and the bolster rails (D-32). Its top plate carries the bolster rails; the kingpin passes through its center hole with radial clearance and touches neither plate.`,
  }));

  // ── Bolster ring: two oak rails fore and aft of the kingpin plus two end rails, bearing on the turntable top plate ──
  const depthNote = bo.z1 - bo.z0 <= p.bolsterMinDepthIn + 1e-9 ? 'Depth raised to the minimum; see the validator.' : undefined;
  const ringBolt = (rail: 'fore' | 'aft', cx: number): Joint => {
    const mine = bolts.filter((b) => b.rail === rail);
    return {
      type: 'bolt', to: 'deck-nose', count: mine.length, diaIn: boltDia,
      size: `${frac(boltDia)}" carriage bolt, through the nose deck, the rail and the turntable top plate; nut + washer under the plate`,
      at: mine.map((b): Vec3 => [b.x - cx, b.y, 0]),
      note: 'The structural fasteners that tie the bolster ring to the hull: roll-bolster-attach reads their count and diameter (M7).',
    };
  };
  for (const [tag, name, x0, x1] of [['fore', 'Front', bo.x1 - bo.rw, bo.x1], ['aft', 'Rear', bo.x0, bo.x0 + bo.rw]] as const) {
    const cx = (x0 + x1) / 2;
    parts.push(box(ctx, {
      id: `bolster-${tag}`, name: `${name} bolster rail`, group: 'steering', mat: 'oak', grain: 'y', step: STEP.steering,
      ...span([x0, x1], [-bo.halfY, bo.halfY], [bo.z0, bo.z1]), notes: depthNote,
      joints: [
        ringBolt(tag, cx),
        { type: 'glue', to: `bolster-end-L`, count: 1, note: 'End rail butts the rail face; glued, with two screws.' },
        { type: 'glue', to: `bolster-end-R`, count: 1, note: 'End rail butts the rail face; glued, with two screws.' },
        ...(cb ? [{ type: 'dado' as const, to: 'kingpin-crossbar', count: 1, size: `${p.kingpinCrossbarLetInIn}" deep × ${(2 * cb.hw).toFixed(2)}" wide notch for the crossbar end` }] : []),
        { type: 'glue', to: `stop-block-${tag === 'aft' ? 'A' : 'F'}L`, count: 1, note: 'Stop block glued and screwed to the rail face.' },
        { type: 'glue', to: `stop-block-${tag === 'aft' ? 'A' : 'F'}R`, count: 1, note: 'Stop block glued and screwed to the rail face.' },
      ],
    }));
  }
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `bolster-end-${tag}`, partNo: 'bolster-end', name: `Bolster end rail ${tag}`, group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([bo.x0 + bo.rw, bo.x1 - bo.rw], [Math.min(s * (bo.halfY - bo.rw), s * bo.halfY), Math.max(s * (bo.halfY - bo.rw), s * bo.halfY)], [bo.z0, bo.z1]),
      notes: 'Rides over the side-bearer rub block (D-12).',
      joints: [
        { type: 'glue', to: 'bolster-fore', count: 1 }, { type: 'glue', to: 'bolster-aft', count: 1 },
        { type: 'screw', to: 'bolster-fore', count: 2, size: '#10 × 2-1/2" countersunk, through the fore rail into the end grain', diaIn: 0.19 },
        { type: 'screw', to: 'bolster-aft', count: 2, size: '#10 × 2-1/2" countersunk, through the aft rail into the end grain', diaIn: 0.19 },
      ],
    }));
  }

  // ── Side bearers (D-12, critic r2 M5): oak blocks housed in the beam top beside the turntable plate, each with a UHMW wear strip ──
  const sb = L.sideBearer;
  for (const { s, tag } of SIDES) {
    const yr: [number, number] = [Math.min(s * sb.y0, s * sb.y1), Math.max(s * sb.y0, s * sb.y1)];
    parts.push(box(ctx, {
      id: `side-bearer-${tag}`, partNo: 'side-bearer', name: `Side-bearer block ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'z', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z0, sb.z1]),
      joints: [
        { type: 'glue', to: 'beam-F', count: 1, size: `${p.sideBearerEmbedIn}" deep mortise in the beam top`, note: 'Epoxy bed in the mortise.' },
        { type: 'screw', to: 'beam-F', count: 2, size: '#10 × 2" countersunk, down through the block into the beam', diaIn: 0.19 },
      ],
      notes: `Housed ${p.sideBearerEmbedIn}" into a mortise in the beam top (glued + screwed); carries roll moment under the bolster rail (D-12).`,
    }));
    const wearVol = (sb.x1 - sb.x0) * (sb.y1 - sb.y0) * p.sideBearerWearIn;
    parts.push(box(ctx, {
      id: `side-bearer-wear-${tag}`, partNo: 'side-bearer-wear', name: `Side-bearer UHMW wear strip ${tag}`, group: 'steering', steer: true, mat: 'fixed',
      massLb: (wearVol / 1728) * p.uhmwDensityPcf, kind: 'purchased', material: 'UHMW-PE strip', fab: 'buy', step: STEP.steering,
      ...span([sb.x0, sb.x1], yr, [sb.z1, sb.zw]),
      sourcing: { vendor: `${VENDOR}: ${frac(p.sideBearerWearIn)}" UHMW-PE sheet, cut to size` },
      joints: [{ type: 'screw', to: `side-bearer-${tag}`, count: 2, size: '#6 countersunk flat-head, counterbored below the surface', diaIn: 0.14 }],
      notes: `${p.sideBearerClearanceIn}" running clearance to the bolster rail underside (the chassis-side bearer face); screwed to the block.`,
    }));
  }

  // ── Kingpin: ahead of the axle (D-25), through the solid beam and the turntable center and, with kingpinThroughBolster (D-12), on up through the oak crossbar ──
  const stack = L.kingpin.z1 - L.kingpin.z0;
  const kpLen = Math.ceil((stack + 0.25 * p.kingpinDiameterIn + 0.85 * p.kingpinDiameterIn + NUT_ALLOWANCE_IN / 3) * 4) / 4;
  parts.push(cylinder(ctx, {
    id: 'kingpin', name: 'Kingpin (grade-8 bolt)', group: 'steering', mat: 'steel', kind: 'purchased', fab: 'buy', step: STEP.steering,
    center: [kx, 0, (L.kingpin.z0 + L.kingpin.z1) / 2], axis: 'z', radius: p.kingpinDiameterIn / 2,
    length: L.kingpin.z1 - L.kingpin.z0,
    sourcing: { vendor: `${VENDOR}: SAE grade 8 hex bolt ${frac(p.kingpinDiameterIn)}" × ${kpLen}" (grip ≥ ${stack.toFixed(2)}"), hardened washers, lock nut` },
    joints: cb ? [
      { type: 'bolt', to: 'kingpin-crossbar', count: 1, diaIn: p.kingpinDiameterIn, size: `${frac(p.kingpinDiameterIn)}" grade 8; head + washer under the beam, lock nut + washer on the crossbar top (counterbored flush)`, note: 'Pin is a tight fit in the sleeves, not in the turntable center hole.' },
    ] : [
      { type: 'bolt', to: 'turntable', count: 1, diaIn: p.kingpinDiameterIn, size: `${frac(p.kingpinDiameterIn)}" grade 8; head let into the turntable plate` },
    ],
    notes: cb
      ? 'Mass is the steel shank only; nut and washers are in the hardware allowance. Washer under the beam, nut + washer on the crossbar top (counterbored flush); reached through the access panel in the nose deck (M10).'
      : 'Mass is the steel shank only; nut and washers are in the hardware allowance. Head is let into the turntable plate.',
  }));

  // ── Chassis-side kingpin crossbar (D-12): fore-aft oak bar across the bolster opening, ends let into the bolster rails, top flush with them ──
  if (cb) {
    const ap = L.accessPanel;
    const insertAt = ap ? ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(([sx, sy]): Vec3 => [sx * (ap.x1 - ap.x0) * 0.39, sy * ap.hw * 0.7, (cb.z1 - cb.z0) / 2]) : []; // local frame: the top face is +half the bar height
    const crossbarJoints: Joint[] = [
      { type: 'dado', to: 'bolster-aft', count: 1, size: `${p.kingpinCrossbarLetInIn}" let-in, end grain bears on the notch face` },
      { type: 'dado', to: 'bolster-fore', count: 1, size: `${p.kingpinCrossbarLetInIn}" let-in, end grain bears on the notch face` },
      { type: 'screw', to: 'turntable', count: 2, size: '#10 × 2-1/2" pan-head, through the crossbar into the top plate', diaIn: 0.19 },
    ];
    if (ap) crossbarJoints.push({ type: 'threaded-insert', to: 'nose-access-panel', count: 4, size: '#10-24 stainless knurled brass insert × 1/2", epoxied 3/4" into the crossbar top', diaIn: 0.19, at: insertAt });
    parts.push(box(ctx, {
      id: 'kingpin-crossbar', name: 'Kingpin crossbar', group: 'steering', mat: 'oak', grain: 'x', step: STEP.steering,
      ...span([cb.x0, cb.x1], [-cb.hw, cb.hw], [cb.z0, cb.z1]),
      joints: crossbarJoints,
      notes: `Ties the kingpin to the chassis (real wagon practice). Ends let ${p.kingpinCrossbarLetInIn}" into the fore and aft bolster rails, top flush; bolted down to the turntable top plate. The four stop blocks bear on its sides (M1). Clear of the steering stops over the full ±${p.steerLockDeg}° sweep.`,
    }));
  }

  // ── Steel sleeves (kingpinSleeveOdIn > 0): tube with ID = pin, pressed into the beam bore and the crossbar bore ──
  if (p.kingpinSleeveOdIn > 0) {
    const od = p.kingpinSleeveOdIn, id = p.kingpinDiameterIn;
    const wall = (od - id) / 2;
    const tube = (len: number) => (Math.PI / 4) * (od * od - id * id) * len;
    const ends: Array<[string, string, number, number, boolean]> = [['beam', 'beam', L.beamF.bot, L.beamF.top, true]];
    if (cb) ends.push(['bar', 'crossbar', cb.z0, cb.z1, false]);
    for (const [tag, where, z0, z1, steer] of ends) {
      parts.push(cylinder(ctx, {
        id: `kingpin-sleeve-${tag}`, partNo: 'kingpin-sleeve', name: `Kingpin sleeve (${where} bore)`, group: 'steering', steer, mat: 'fixed',
        massLb: (tube(z1 - z0) / IN3_PER_FT3) * p.steelDensityPcf, kind: 'purchased', material: `${frac(od)}" OD × ${frac(wall)}" wall DOM steel tube (A36 / 1020)`, fab: 'buy', step: STEP.steering,
        center: [kx, 0, (z0 + z1) / 2], axis: 'z', radius: od / 2, length: z1 - z0,
        sourcing: { vendor: `${VENDOR}: ${frac(od)}" OD × ${frac(wall)}" wall DOM (drawn-over-mandrel) steel tube, ID ${id.toFixed(3)}" (the ¾" pin slides through; hone to +0.003" if needed), cut ${(z1 - z0).toFixed(2)}" long` },
        joints: [
          { type: 'glue', to: where === 'beam' ? 'beam-F' : 'kingpin-crossbar', count: 1, size: `${od.toFixed(3)}" OD, press fit in a ${od.toFixed(3)}" reamed bore + epoxy`, note: 'The oak bears on the sleeve OD; the pin bears on its bore (M2 peak-bearing check).' },
        ],
        notes: `${od}" OD × ${wall}" wall DOM tube, ${(z1 - z0).toFixed(2)}" long, pressed and epoxied into the ${where} bore; the oak bears on the OD and the pin on the bore. Drawn solid.`,
      }));
    }
  }

  // ── Steering stops (M1, D-31): steel-faced oak dogs on the beam, four oak stop blocks in the corners of the bolster opening ──
  const plan = steerStopPlan(p);
  const dogH = Math.max(0.25, Math.min(p.steerStopHeightIn, ringDepth - p.sideBearerClearanceIn));
  if (plan.ok) {
    const len = plan.rb - plan.ra, midY = (plan.ra + plan.rb) / 2;
    const nb = Math.max(2, Math.round(p.steerStopBoltCount));
    const boltAt = (): Vec3[] => Array.from({ length: nb }, (_, i): Vec3 => [0, -len / 2 + (len * (i + 0.5)) / nb, 0]);
    for (const { s, tag } of SIDES) {
      parts.push(box(ctx, {
        id: `steer-stop-${tag}`, partNo: 'steer-stop', name: `Steering stop dog ${tag}`, group: 'steering', steer: true, mat: 'oak', grain: 'y', step: STEP.steering,
        size: [plan.t, len, dogH], center: [kx, s * midY, bo.z0 + dogH / 2],
        joints: [
          { type: 'bolt', to: 'beam-F', count: nb, diaIn: p.steerStopBoltDiameterIn, size: `${frac(p.steerStopBoltDiameterIn)}" hex bolt, through the dog, the turntable plate and the beam; nut + ${frac(p.steerStopWasherDiameterIn)}" OD fender washer under the beam`, at: boltAt(), note: 'Hold-down bolts: the analysis reads their count and diameter (steer-stops).' },
          { type: 'screw', to: `steer-stop-face-${tag}1`, count: 3, size: '#8 countersunk flat-head, counterbored into the steel plate', diaIn: 0.164 },
          { type: 'screw', to: `steer-stop-face-${tag}2`, count: 3, size: '#8 countersunk flat-head, counterbored into the steel plate', diaIn: 0.164 },
        ],
        notes: `Radial oak dog (${plan.t}" thick, ${len.toFixed(2)}" long, ${dogH.toFixed(2)}" tall, stop face s = ${plan.ra.toFixed(2)}…${plan.rb.toFixed(2)}" from the kingpin) standing on the ${s > 0 ? '+y' : '−y'} axis. Its steel-faced sides land flat on the stop blocks at exactly ±${p.steerLockDeg}° of lock. Bolted down through the lazy-susan bottom plate into the beam (D-31).`,
      }));
      for (const [n, sx] of [[1, -1], [2, 1]] as const) {
        parts.push(box(ctx, {
          id: `steer-stop-face-${tag}${n}`, partNo: 'steer-stop-face', name: `Steering stop steel face plate ${tag}${n}`, group: 'steering', steer: true, mat: 'steel', step: STEP.steering,
          size: [plan.tf, len, dogH], center: [kx + sx * (plan.t / 2 + plan.tf / 2), s * midY, bo.z0 + dogH / 2],
          material: 'A36 steel plate', kind: 'metal', fab: 'cnc',
          joints: [{ type: 'screw', to: `steer-stop-${tag}`, count: 3, size: '#8 countersunk flat-head, counterbored into the steel plate', diaIn: 0.164 }],
          notes: `${plan.tf}" A36 plate screwed to the ${sx < 0 ? 'aft' : 'fore'} side of the dog (${s > 0 ? 'left' : 'right'}): the steel face spreads the stop contact over the stop block and takes the wear.`,
        }));
      }
    }
    const wood = (vol: number, area: number) => woodMassLb(p, vol, area, p.oakDensityPcf);
    for (const th of plan.teeth) {
      const area = Math.abs(th.local.reduce((sum, q, i) => { const r = th.local[(i + 1) % th.local.length]; return sum + q.x * r.y - r.x * q.y; }, 0)) / 2;
      const per = th.local.reduce((sum, q, i) => { const r = th.local[(i + 1) % th.local.length]; return sum + Math.hypot(r.x - q.x, r.y - q.y); }, 0);
      const rail = th.id.startsWith('A') ? 'bolster-aft' : 'bolster-fore';
      const dims = [ringDepth, th.uMax - th.uMin, th.vMax].sort((a, b) => a - b);
      parts.push(customPart(ctx, {
        id: `stop-block-${th.id}`, partNo: 'stop-block', name: `Steering stop block ${th.id}`, group: 'steering', kind: 'lumber', material: 'white oak', fab: 'bandsaw', step: STEP.steering,
        geometry: { type: 'extrusion', outline: th.local.map((q): [number, number] => [q.x, q.y]), depth: ringDepth },
        transform: compose([kx + th.foot.x, th.foot.y, bo.z0], { z: th.theta }),
        massLb: wood(area * ringDepth, 2 * area + per * ringDepth),
        grain: 'y', stock: { t: dims[0], w: dims[1], l: dims[2] },
        rough: { t: dims[0] + p.millingAllowanceIn, w: dims[1] + p.millingAllowanceIn, l: dims[2] + p.millingAllowanceIn },
        explode: unit([0.3, th.side * 0.3, 1]),
        joints: [
          { type: 'glue', to: rail, count: 1, size: 'face of the bolster rail', note: `Contact length ${th.railLen.toFixed(2)}"; the stop force presses it into the rail.` },
          { type: 'screw', to: rail, count: 2, size: '#10 × 2-1/2" countersunk, through the rail into the block', diaIn: 0.19 },
          ...(cb ? [{ type: 'glue' as const, to: 'kingpin-crossbar', count: 1, size: 'side face of the crossbar', note: `Contact length ${th.barLen.toFixed(2)}".` }] : []),
        ],
        notes: `Wedge cut to the corner between the ${th.id.startsWith('A') ? 'aft' : 'fore'} bolster rail and the crossbar, trimmed where thinner than ${p.stopBlockMinIn}". Its face is the plane the dog's ${th.lockSign > 0 ? 'aft' : 'fore'}-side steel plate reaches at exactly ${th.lockSign > 0 ? '+' : '−'}${p.steerLockDeg}° of lock (flat contact). Grain runs along the stop force (end-grain face); the analysis conservatively uses the across-grain bearing allowable. The OBB drawn is the bounding rectangle behind the face.`,
      }));
    }
  }

  // ── Removable access panel over the kingpin nut (M10, D-34) ──
  if (L.accessPanel) {
    const ap = L.accessPanel;
    const t = ap.z1 - ap.z0;
    const insertAt = ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(([sx, sy]): Vec3 => [sx * (ap.x1 - ap.x0) * 0.39, sy * ap.hw * 0.7, t / 2]);
    const panelMassLb = woodMassLb(p, (ap.x1 - ap.x0) * 2 * ap.hw * t, 2 * ((ap.x1 - ap.x0) * 2 * ap.hw + ((ap.x1 - ap.x0) + 2 * ap.hw) * t), ctx.d.plyDensityPcf);
    parts.push(box(ctx, {
      id: 'nose-access-panel', name: 'Kingpin nut access panel', group: 'steering', mat: 'ply', kind: 'sheet', grain: 'x', step: STEP.steering, explode: [0, 0, 1],
      size: [ap.x1 - ap.x0, 2 * ap.hw, t], center: [(ap.x0 + ap.x1) / 2, 0, (ap.z0 + ap.z1) / 2], edges: 'edged',
      joints: [
        { type: 'threaded-insert', to: 'kingpin-crossbar', count: 4, size: '#10-24 machine screws × 1", stainless, with finish washers', diaIn: 0.19, at: insertAt, note: 'Four screws into the inserts in the crossbar top; taking it off exposes the kingpin nut and washer.' },
      ],
      notes: `Removable for service (kept on in transport): a ${(ap.x1 - ap.x0).toFixed(2)}" × ${(2 * ap.hw).toFixed(2)}" panel of the nose-deck ply, ${t.toFixed(2)}" thick, flush with the deck over the kingpin nut. Workstream B cuts this opening in the nose deck (Layout.accessPanel); until then its mass (≈ ${panelMassLb.toFixed(2)} lb) is also in the deck. Edges sealed with epoxy.`,
    }));
  }

  // Tongue runs forward from the beam, inside the beam's own height so it never reaches the turntable.
  const tongueDepth = Math.min(p.tongueDepthIn, L.beamF.depth);
  const tongueCz = L.beamF.top - tongueDepth / 2;
  const tongueX0 = L.beamF.x + L.beamF.thick / 2;
  let tipX = tongueX0;
  if (p.drawbar === DRAWBAR.woodTongue) {
    tipX = L.WB + p.tongueLengthIn;
    parts.push(box(ctx, {
      id: 'tongue', name: 'Tongue', group: 'steering', steer: true, mat: 'oak', removable: true, step: STEP.steering, grain: 'x',
      ...span([tongueX0, Math.max(tongueX0 + 1, tipX)], [-p.tongueThickIn / 2, p.tongueThickIn / 2], [tongueCz - tongueDepth / 2, tongueCz + tongueDepth / 2]),
      notes: 'Pins off for transport (D-9). Length is measured from the front axle (overall length, D-23).',
    }));
    parts.push(box(ctx, {
      id: 'bridle', name: 'Bridle rope', group: 'steering', steer: true, mat: 'fixed', massLb: BRIDLE_MASS_LB, kind: 'purchased',
      material: 'rope', fab: 'buy', removable: true, step: STEP.steering,
      ...span([tipX, tipX + BRIDLE_LEN_IN], [-BRIDLE_SECTION_IN / 2, BRIDLE_SECTION_IN / 2], [tongueCz - BRIDLE_SECTION_IN / 2, tongueCz + BRIDLE_SECTION_IN / 2]),
      notes: 'Estimate mass; drawn as a short straight lead from the tongue tip.',
    }));
  } else {
    // Rope bridle (D-14, D-27, D-33): a forged eye bolt through the front face of the beam on each side, just inboard of the U-bolt plate;
    // a rope leg tied to each eye, meeting at a ring ahead of the cart. Only the legs and ring are drawn; the 8 ft pull tails
    // (bridleRopeRunIn) continue to the pullers' hands.
    const beamLen = L.beamF.len;
    const clampInner = Math.min(beamLen / 2 - 0.25, p.frontTrackIn / 2 - p.tireWidthIn / 2) - p.clampPlateWidthIn;
    const tieY = clampInner - p.bridleTieOffsetIn;
    const frontFace = L.beamF.x + L.beamF.thick / 2;
    const tieX = frontFace + p.eyeBoltEyeOffsetIn;
    const d = p.eyeBoltDiameterIn;
    const shankLen = L.beamF.thick + 0.9; // through the beam and the nut / washer stack on the aft face
    const eyeR = (d * EYE_OD_FACTOR) / 2 - (d * EYE_TUBE_FRAC) / 2;
    for (const { s: side, tag } of SIDES) {
      // Local frame: origin at the eye center, +x forward. The shank runs aft from the eye ring to the beam's aft face and beyond.
      const shank: Vec3[] = [[-p.eyeBoltEyeOffsetIn - L.beamF.thick - 0.55, 0, 0], [-eyeR - (d * EYE_TUBE_FRAC) / 2, 0, 0]];
      const ring = circlePath([0, 0, 0], [0, 1, 0], eyeR, 20);
      const mesh = mergeMeshes(tubeAlong(shank, d / 2, 10), tubeAlong(ring, (d * EYE_TUBE_FRAC) / 2, 8, true));
      const volIn3 = Math.PI * (d / 2) ** 2 * pathLength(shank) + Math.PI * ((d * EYE_TUBE_FRAC) / 2) ** 2 * pathLength(ring, true);
      parts.push(customPart(ctx, {
        id: `eyebolt-${tag}`, partNo: 'bridle-eyebolt', name: `Bridle eye bolt ${tag}`, group: 'steering', kind: 'purchased', material: 'forged steel shoulder eye bolt', fab: 'buy', step: STEP.steering,
        geometry: { type: 'mesh', positions: mesh.positions, indices: mesh.indices },
        transform: compose([tieX, side * tieY, tongueCz]),
        steer: true, massLb: (volIn3 / IN3_PER_FT3) * p.steelDensityPcf + 0.04, explode: unit([1, side * 0.2, -0.1]),
        sourcing: { vendor: `${VENDOR}: forged shoulder eye bolt ${frac(d)}" (nut-style, ${shankLen.toFixed(1)}" shank); confirm the working-load limit exceeds the rope-tie pull in the analysis (bridle-tie)` },
        joints: [{ type: 'bolt', to: 'beam-F', count: 1, diaIn: d, size: `${frac(d)}" shoulder eye bolt through the beam front face, axis fore-aft, nut + ${frac(p.eyeBoltWasherDiameterIn)}" OD washer on the aft face`, at: [[-p.eyeBoltEyeOffsetIn - L.beamF.thick / 2, 0, 0]], note: 'Tie point for the rope bridle (M6): inboard of the U-bolt plate, so the pull goes into the beam and not the axle rod.' }],
        notes: `Eye ${p.eyeBoltEyeOffsetIn}" ahead of the beam front face at ${tieY.toFixed(2)}" off center and mid-depth of the beam; the rope leg is tied to it with a bowline or a soft shackle. The beam carries its own ${(L.beamF.thick).toFixed(2)}" through-hole.`,
      }));
    }
    const ring: Vec3 = [L.WB + BRIDLE_APEX_AHEAD_IN, 0, tongueCz];
    for (const { s: side, tag } of SIDES) {
      const a: Vec3 = [tieX, side * tieY, tongueCz];
      const dx = ring[0] - a[0], dy = ring[1] - a[1];
      parts.push(box(ctx, {
        id: `bridle-${tag}`, partNo: 'bridle-leg', name: `Bridle rope leg ${tag}`, group: 'steering', steer: true, mat: 'fixed',
        massLb: BRIDLE_MASS_LB / 2, kind: 'purchased', material: '1/2" braided polyester rope (low stretch)', fab: 'buy', removable: true, step: STEP.steering,
        sourcing: { vendor: `${VENDOR}: 1/2" braided polyester rope (low stretch), ${Math.round(p.bridleRopeRunIn / 12)} ft pull tails + legs; requirement: tails ≥ ${Math.round(p.bridleRopeRunIn / 12)} ft, tied low (Phase 2 critic r2 R2)` },
        size: [Math.hypot(dx, dy), BRIDLE_SECTION_IN, BRIDLE_SECTION_IN], center: [(a[0] + ring[0]) / 2, (a[1] + ring[1]) / 2, tongueCz],
        rot: { z: Math.atan2(dy, dx) },
        joints: [{ type: 'bolt', to: `eyebolt-${tag}`, count: 1, size: 'bowline or soft shackle to the eye bolt' }],
        notes: `½" rope tied low to the eye bolt; legs meet at a ring ${BRIDLE_APEX_AHEAD_IN}" ahead of the front axle. Pull tails ${p.bridleRopeRunIn}" (D-27). The leg starts at the eye center (${tieX.toFixed(2)}", ±${tieY.toFixed(2)}").`,
      }));
    }
  }
  return parts;
}
