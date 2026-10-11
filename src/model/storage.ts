/**
 * Storage box (D-19, D-41): a weatherproof ply tray (floor between mitered walls that reach the deck), a hinged, gasketed lid
 * (oak frame capturing a ply panel, two oak battens), two butt hinges on the fore edge (so the lid opens up and aft, clear of the
 * removable seat back), two over-center latches, two drains, and the lash points on the gunwales (BRIEF §4.9).
 * Built from real panels so the cut list and mass are honest (critic M3); the interior volume is set in layout.ts.
 *
 * Also holds the 10 Essentials kit list (D-19) and a simple packing check against the interior.
 */
import { STORAGE_LOCATION, type Params } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import type { Layout } from './layout';
import { gunwaleId, gunwaleY, inboardOf, seatBackSupport } from './seat';
import type { Joint, Part } from './types';

// ── Hardware and detail dimensions (estimates, D-41) ──
const HINGE_MASS_LB = 0.15;
const LATCH_MASS_LB = 0.15;
const CATCH_MASS_LB = 0.03;
const DRAIN_MASS_LB = 0.03;
const GASKET_LB_PER_IN = 0.002;
const LASH_MASS_LB = 0.1;
const LASH_SIZE = [1.5, 0.9, 0.75] as const;
const BACKER_IN = 1;
const BACKER_W_IN = 1.5;
const BATTEN_X_IN = 0.75;
const HINGE_W_IN = 2.5;
const HINGE_H_IN = 2.7;

export interface StorageGeometry {
  x0: number;
  x1: number;
  hw: number;
  zBot: number;
  zTop: number;
  /** Top of the walls (under the gasket). */
  zWallTop: number;
  pl: number;
  rimW: number;
  rimT: number;
  gasket: number;
  /** Interior floor and lid-underside heights. */
  floorZ: number;
  lidUnderZ: number;
}

export function storageGeometry(p: Params, L: Layout): StorageGeometry {
  const st = L.storage;
  const sup = seatBackSupport(p, L);
  const pl = p.panelPlyIn;
  const rimW = p.storageLidRimWidthIn;
  const rimT = p.storageLidRimThickIn;
  const gasket = p.storageGasketIn;
  const zTop = sup.boxZTop;
  return {
    x0: st.x0, x1: Math.max(st.x0 + 0.5, sup.boxX1), hw: st.hw, zBot: st.zBot, zTop,
    zWallTop: zTop - pl - rimT - gasket, pl, rimW, rimT, gasket, floorZ: st.zBot + pl, lidUnderZ: zTop - pl,
  };
}

// ── The 10 Essentials patrol kit (D-19): dimensions in inches, flat orientation first ──
export interface KitItem {
  name: string;
  qty: number;
  /** Rigid or filled items: bounding dimensions [l, w, h] of one unit. */
  dims?: [number, number, number];
  /** Soft goods (packed into the voids at the compressed volume): uncompressed volume of the whole line, in³. */
  softVolIn3?: number;
  /** Which of the 10 Essentials it serves. */
  essential: string;
}

/** Soft goods compress to this fraction of their listed volume in stuff sacks; the voids between rigid items are this usable. */
export const SOFT_COMPRESSION = 0.8;
export const VOID_USABLE = 0.9;

export const ESSENTIALS: readonly KitItem[] = [
  { name: 'First-aid kit', qty: 1, dims: [8, 6, 3], essential: 'First aid' },
  { name: '2 L water reservoir, filled', qty: 2, dims: [12, 6, 2.5], essential: 'Water' },
  { name: 'Map, compass and fire kit', qty: 1, dims: [6, 5, 2], essential: 'Navigation, fire' },
  { name: 'Flashlight / headlamp', qty: 3, dims: [6, 2, 1.7], essential: 'Illumination' },
  { name: 'Trail food', qty: 1, dims: [10, 6, 3], essential: 'Extra food' },
  { name: 'Rain shell (stuffed)', qty: 6, softVolIn3: 400, essential: 'Rain gear' },
  { name: 'Spare layers', qty: 1, softVolIn3: 600, essential: 'Extra clothing, insulation' },
];

export interface Interior {
  /** Base cuboid under the wall tops (fore-aft × across × height). */
  lx: number;
  w: number;
  h: number;
  /** Extra volume in the lid zone, inside the frame lip. */
  capIn3: number;
  totalIn3: number;
}

export function storageInterior(p: Params, L: Layout): Interior {
  const g = storageGeometry(p, L);
  const lx = Math.max(0.5, g.x1 - g.x0 - 2 * g.pl);
  const w = Math.max(0.5, 2 * g.hw - 2 * g.pl);
  const h = Math.max(0.5, g.zWallTop - g.floorZ);
  const lip = Math.max(0, g.rimW - g.pl);
  const capIn3 = Math.max(0, lx - 2 * lip) * Math.max(0, w - 2 * lip) * (g.rimT + g.gasket);
  return { lx, w, h, capIn3, totalIn3: lx * w * h + capIn3 };
}

export interface Placement { name: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
export interface PackResult {
  fits: boolean;
  rigidPlaced: number;
  rigidTotal: number;
  rigidIn3: number;
  softIn3: number;
  softCompressedIn3: number;
  interior: Interior;
  /** (rigid volume + soft goods compressed ÷ usable void fraction) ÷ interior volume; ≤ 1 fits. */
  fill: number;
  placements: Placement[];
  unplaced: string[];
}

/**
 * Pack the rigid items in levels (tallest first), each level shelf-packed in rows across the box, then check the soft goods against
 * the remaining void volume. Conservative: item bounding boxes, flat orientation (smallest side up), 90° turns in the plan.
 */
export function packEssentials(interior: Interior, kit: readonly KitItem[] = ESSENTIALS): PackResult {
  interface Unit { name: string; l: number; w: number; h: number }
  const units: Unit[] = [];
  let soft = 0;
  for (const it of kit) {
    if (it.dims) {
      const s = [...it.dims].sort((a, b) => a - b);
      for (let i = 0; i < it.qty; i++) units.push({ name: it.name, h: s[0], w: s[1], l: s[2] });
    } else soft += it.softVolIn3 ?? 0;
  }
  units.sort((a, b) => b.h - a.h || b.l * b.w - a.l * a.w);
  interface Row { y: number; used: number; depth: number }
  interface Level { z: number; h: number; xUsed: number; rows: Row[] }
  const levels: Level[] = [];
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  const placeIn = (lv: Level, u: Unit): Placement | null => {
    for (const [a, b] of [[u.w, u.l], [u.l, u.w]] as const) {
      // a along x (fore-aft), b along y (across)
      for (const r of lv.rows) if (a <= r.depth + 1e-9 && r.used + b <= interior.w + 1e-9) {
        const pl = { name: u.name, x: r.y, y: r.used, z: lv.z, dx: a, dy: b, dz: u.h };
        r.used += b;
        return pl;
      }
    }
    for (const [a, b] of [[u.w, u.l], [u.l, u.w]] as const) {
      if (lv.xUsed + a <= interior.lx + 1e-9 && b <= interior.w + 1e-9) {
        const r: Row = { y: lv.xUsed, used: b, depth: a };
        lv.rows.push(r);
        lv.xUsed += a;
        return { name: u.name, x: r.y, y: 0, z: lv.z, dx: a, dy: b, dz: u.h };
      }
    }
    return null;
  };
  for (const u of units) {
    let pl: Placement | null = null;
    for (const lv of levels) if (u.h <= lv.h + 1e-9 && (pl = placeIn(lv, u))) break;
    if (!pl) {
      const z = levels.reduce((m, lv) => m + lv.h, 0);
      if (z + u.h <= interior.h + 1e-9) {
        const lv: Level = { z, h: u.h, xUsed: 0, rows: [] };
        levels.push(lv);
        pl = placeIn(lv, u);
      }
    }
    if (pl) placements.push(pl); else unplaced.push(u.name);
  }
  const rigidIn3 = units.reduce((m, u) => m + u.l * u.w * u.h, 0);
  const softCompressedIn3 = soft * SOFT_COMPRESSION;
  const fill = (rigidIn3 + softCompressedIn3 / VOID_USABLE) / interior.totalIn3;
  return {
    fits: unplaced.length === 0 && fill <= 1,
    rigidPlaced: placements.length, rigidTotal: units.length, rigidIn3, softIn3: soft, softCompressedIn3, interior, fill, placements, unplaced,
  };
}

/** Lash-point x positions along one gunwale: farthest-point spread over the free stretches (clear of the grips). */
export function lashPositions(p: Params, L: Layout, n: number): number[] {
  const margin = LASH_SIZE[0] / 2 + 0.25;
  const lo = L.xRear + L.side + margin;
  const hi = L.xs - L.side - margin;
  const gripLen = p.seatGripClearLengthIn + 2;
  const gx0 = Math.min(p.seatXIn - 5, L.xs - L.side - gripLen - 0.25);
  const blocked: Array<[number, number]> = [
    [gx0 - margin, gx0 + gripLen + margin],
  ];
  // A rear box that stands above the gunwale occupies the gunwale line along its length.
  const st = storageGeometry(p, L);
  if (p.storageLocation === STORAGE_LOCATION.rearOverAxle && st.zTop > L.deckTop + L.sideH - L.railBand - 0.01) blocked.push([st.x0 - margin, st.x1 + margin]);
  const cands: number[] = [];
  for (let x = lo; x <= hi + 1e-9; x += 0.5) if (!blocked.some(([a, b]) => x > a && x < b)) cands.push(x);
  const chosen: number[] = [];
  while (chosen.length < n && cands.length) {
    let best = cands[0], bestD = -1;
    for (const c of cands) {
      const d = chosen.length ? Math.min(...chosen.map((q) => Math.abs(q - c))) : c - lo;
      if (d > bestD) { bestD = d; best = c; }
    }
    if (chosen.length && bestD < LASH_SIZE[0] + 0.5) break;
    chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
}

export function buildStorage(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const g = storageGeometry(p, L);
  const { x0, x1, hw, pl, rimW, rimT, zBot, zTop, zWallTop } = g;
  const sup = seatBackSupport(p, L);
  const common = { group: 'storage', step: STEP.seatStorage } as const;
  const parts: Part[] = [];
  const yIn = hw - pl;
  const miter = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '45° miter + 1/8" ply spline', note: 'epoxy; miters leave no exposed ply edge' });
  const fillet = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '3/8" epoxy fillet', note: 'floor captured between the walls, which reach the deck' });
  const dom = (to: string): Joint => ({ type: 'domino', to, count: 1, size: '6×40' });

  // ── Tray: floor between walls that stand on the deck ──
  parts.push(box(ctx, { ...common, id: 'storage-bottom', name: 'Storage box floor', mat: 'ply', edges: 'captured',
    ...span([x0 + pl, x1 - pl], [-yIn, yIn], [zBot, zBot + pl]),
    joints: ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'].map(fillet),
    notes: `Interior volume target ${p.storageVolumeIn3} in³ (D-19). Two ${p.storageDrainDiaIn}" drain holes at the aft corners go through the floor and the deck, lined with stainless nipples (D-41).` }));
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', edges: 'captured',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [zBot, zWallTop]),
      joints: [miter('storage-end-aft'), miter('storage-end-fore')] }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', edges: 'captured',
      ...span([xa, xb], [-yIn, yIn], [zBot, zWallTop]),
      joints: [miter('storage-side-L'), miter('storage-side-R')] }));
  }

  // ── Lid: oak frame (rim) capturing the ply panel, two battens under the panel ──
  parts.push(box(ctx, { ...common, id: 'storage-lid', name: 'Storage lid panel', mat: 'ply', edges: 'captured',
    ...span([x0 + rimW, x1 - rimW], [-(hw - rimW), hw - rimW], [zTop - pl, zTop]),
    stock: { t: pl, w: 2 * (hw - rimW) + 0.5, l: x1 - x0 - 2 * rimW + 0.5 },
    joints: ['storage-rim-side-L', 'storage-rim-side-R', 'storage-rim-end-aft', 'storage-rim-end-fore'].map((to): Joint => ({
      type: 'rabbet', to, count: 1, size: '1/4 deep × 1/4', note: 'panel captured in the frame (cut size includes the tongue); epoxy-sealed',
    })),
    notes: 'Ply lid panel captured in the oak frame; the frame underside seals on the gasket.' }));
  const rz: [number, number] = [zTop - pl - rimT, zTop];
  for (const [tag, y] of [['L', hw - rimW / 2], ['R', -(hw - rimW / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-rim-side-${tag}`, partNo: 'storage-rim-side', name: `Storage lid frame side ${tag}`, mat: 'oak', grain: 'x',
      ...span([x0, x1], [y - rimW / 2, y + rimW / 2], rz),
      joints: [dom('storage-rim-end-aft'), dom('storage-rim-end-fore')] }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + rimW], ['fore', x1 - rimW, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-rim-end-${tag}`, partNo: 'storage-rim-end', name: `Storage lid frame ${tag} end`, mat: 'oak', grain: 'y',
      ...span([xa, xb], [-(hw - rimW), hw - rimW], rz),
      joints: [dom('storage-rim-side-L'), dom('storage-rim-side-R')] }));
  }
  const inner = x1 - x0 - 2 * rimW;
  const nBatten = inner >= 9 ? 2 : inner >= 4 ? 1 : 0;
  for (let n = 1; n <= nBatten; n++) {
    const bx = x0 + rimW + (inner * n) / (nBatten + 1);
    parts.push(box(ctx, { ...common, id: `storage-lid-batten-${n}`, partNo: 'storage-lid-batten', name: `Storage lid batten ${n}`, mat: 'oak', grain: 'y',
      ...span([bx - BATTEN_X_IN / 2, bx + BATTEN_X_IN / 2], [-(hw - rimW), hw - rimW], [zTop - pl - rimT, zTop - pl]),
      joints: [{ type: 'glue', to: 'storage-lid', count: 1, note: 'epoxy + 4 stainless screws from the top (plugged)' }, { type: 'dado', to: 'storage-rim-side-L', count: 1, size: '1/4 deep', note: 'ends let into the frame sides' }, { type: 'dado', to: 'storage-rim-side-R', count: 1, size: '1/4 deep' }],
      notes: 'Stiffen the lid panel so it can take a foot or a cooler (a 25" × 13" ply panel alone would sag).' }));
  }

  // ── Gasket: closed-cell bulb strip on the wall tops, under the frame ──
  const gz: [number, number] = [zWallTop, zWallTop + g.gasket];
  const gasketSpec = { ...common, mat: 'fixed', kind: 'purchased', material: 'EPDM bulb seal', fab: 'buy', group: 'storage', step: STEP.finish,
    sourcing: { vendor: 'McMaster-Carr (EPDM bulb gasket, adhesive back)', costUsd: 12 } } as const;
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...gasketSpec, id: `storage-gasket-side-${tag}`, partNo: 'storage-gasket-side', name: `Lid gasket side ${tag}`,
      massLb: GASKET_LB_PER_IN * (x1 - x0), ...span([x0, x1], [y - pl / 2, y + pl / 2], gz), notes: 'Compresses 25% under the frame; no gap at the miters (continuous strip, spliced at a corner).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...gasketSpec, id: `storage-gasket-end-${tag}`, partNo: 'storage-gasket-end', name: `Lid gasket ${tag} end`,
      massLb: GASKET_LB_PER_IN * 2 * yIn, ...span([xa, xb], [-yIn, yIn], gz) }));
  }

  // ── Hinges (fore edge, so the lid opens up and aft; the removable back is aft-leaning over the lid) and latches ──
  // Outboard of the stiles when there is room, else between them; the stiles lean over the lid just behind the hinges.
  const outY = sup.W / 2 + 0.75 + HINGE_W_IN / 2;
  const inY = sup.W / 2 - sup.fw - 0.75 - HINGE_W_IN / 2;
  const hingeY = !sup.rear || outY <= hw - HINGE_W_IN / 2 - 0.25 ? Math.min(outY, hw - HINGE_W_IN / 2 - 0.25) : Math.max(inY, HINGE_W_IN / 2);
  const hz1 = zTop - 0.3;
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, { ...common, id: `storage-hinge-${tag}`, partNo: 'storage-hinge', name: `Lid hinge ${tag}`, mat: 'fixed', massLb: HINGE_MASS_LB,
      kind: 'purchased', material: 'stainless butt hinge', fab: 'buy', step: STEP.finish, ...span([x1, x1 + 0.12], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [hz1 - HINGE_H_IN, hz1]),
      sourcing: { vendor: 'McMaster-Carr (316 stainless surface-mount butt hinge, 2½" × 2¾")', costUsd: 14 },
      joints: [{ type: 'screw', to: 'storage-rim-end-fore', count: 3, size: '#8 × 5/8 stainless' }, { type: 'screw', to: `storage-hinge-backer-${tag}`, count: 3, size: '#8 × 5/8 stainless, through the end panel into the backer' }],
      notes: 'Barrel along the fore-top edge: the lid swings up and aft and the seat back (when fitted) stops it near 75° (D-41).' }));
    parts.push(box(ctx, { ...common, id: `storage-hinge-backer-${tag}`, partNo: 'storage-hinge-backer', name: `Hinge backer ${tag}`, mat: 'oak', grain: 'y',
      ...span([x1 - pl - 0.75, x1 - pl], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [zWallTop - 1.5, zWallTop]),
      joints: [{ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel' }],
      notes: 'Gives the hinge screws something to bite; the ply end is only 6 mm.' }));
    // Latch: on the inside face of the rear transom above the lid (rear box), else on the aft end's outer face; hooks a catch on the lid frame.
    const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
    // Latches sit at 8.5" off center, clear of the rear-light doubler (|y| 2.5 to 7.5) on the same transom face.
    const ly = sg * Math.min(hw - 3, 8.5);
    const latchBox = rear
      ? span([x0, x0 + 0.35], [ly - 0.6, ly + 0.6], [zTop + 0.4, zTop + 1.7])
      : span([x0 - 0.35, x0], [ly - 0.6, ly + 0.6], [zTop - 2.5, zTop - 1.2]);
    const catchBox = rear
      ? span([x0 + 0.5, x0 + 1.4], [ly - 0.6, ly + 0.6], [zTop, zTop + 0.12])
      : span([x0 - 0.12, x0], [ly - 0.6, ly + 0.6], [zTop - 0.8, zTop - 0.1]);
    parts.push(box(ctx, { ...common, id: `storage-latch-${tag}`, partNo: 'storage-latch', name: `Lid latch ${tag}`, mat: 'fixed', massLb: LATCH_MASS_LB, kind: 'purchased',
      material: 'stainless over-center draw latch', fab: 'buy', step: STEP.finish, ...latchBox,
      sourcing: { vendor: 'McMaster-Carr (316 stainless draw latch)', costUsd: 9 },
      joints: [{ type: 'screw', to: rear ? 'transom-rear' : 'storage-end-aft', count: 2, size: '#8 × 3/8 stainless' }],
      notes: rear
        ? 'On the inside face of the rear transom, hooking a catch on the lid frame. No doubler: the lid frame swings through the space a doubler would take. Engagement is 3/8" (a #8 " + 3/8 pilot in white oak face grain holds about 100 lbf per screw, ~200 lbf per latch) against a gasket and slam load of about 20 lbf per latch, so about 10x margin (D-41).'
        : 'On the aft end, hooking a catch on the lid frame.' }));
    parts.push(box(ctx, { ...common, id: `storage-catch-${tag}`, partNo: 'storage-catch', name: `Latch catch ${tag}`, mat: 'fixed', massLb: CATCH_MASS_LB, kind: 'purchased',
      material: 'stainless catch plate', fab: 'buy', step: STEP.finish, ...catchBox,
      joints: [{ type: 'screw', to: 'storage-rim-end-aft', count: 2, size: '#8 × 1/2 stainless' }] }));
    // Drains: stainless nipple flange on the floor at the aft corner (the hole goes through the floor and the deck).
    const r = p.storageDrainDiaIn / 2 + 0.125;
    parts.push(cylinder(ctx, { ...common, id: `storage-drain-${tag}`, partNo: 'storage-drain', name: `Drain nipple ${tag}`, mat: 'fixed', massLb: DRAIN_MASS_LB, kind: 'purchased',
      material: 'stainless drain nipple', fab: 'buy', step: STEP.finish, axis: 'z', radius: r, length: 0.2,
      center: [x0 + pl + 1.5, sg * (yIn - 1.2), g.floorZ + 0.1],
      sourcing: { vendor: 'McMaster-Carr (316 stainless tube fitting, ⅜")', costUsd: 5 },
      notes: `${p.storageDrainDiaIn}" hole through the floor and the deck, nipple epoxied in so no cut ply edge is exposed.` }));
  }

  // ── Backer cleats (box behind the seat): the inserts for the seat-back studs, inside the fore end (D-40) ──
  if (sup.rear) {
    const s = L.seat;
    const c2z = s.col2[2];
    const zS = s.Pr[2] + c2z * sup.c2B;
    // Stud axis runs along the back normal; it reaches the box end plane just below the stile rear point.
    const xr = s.Pr[0] + s.col2[0] * sup.c2B;
    const dist = Math.max(0, (xr - x1) / s.col0[0]);
    const zE = zS - s.col0[2] * dist;
    const z0 = Math.max(g.floorZ, Math.min(zE - BACKER_IN, zWallTop - 2 * BACKER_IN));
    for (const { s: sg, tag } of SIDES) {
      parts.push(box(ctx, { ...common, id: `storage-backer-${tag}`, partNo: 'storage-backer', name: `Seat-back insert backer ${tag}`, mat: 'oak', grain: 'z',
        ...span([x1 - pl - BACKER_IN, x1 - pl], [sg * sup.knobY - BACKER_W_IN / 2, sg * sup.knobY + BACKER_W_IN / 2], [z0, z0 + 2 * BACKER_IN]),
        joints: [{ type: 'threaded-insert', to: `seat-back-stile-${tag}`, count: 1, size: '3/8-16 stainless, 3/4 deep', note: 'the seat-back stud ends here (D-9)' },
          { type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel' },
          { type: 'screw', to: 'storage-end-fore', count: 2, size: '#10 × 1¼ stainless, from the wedge side' }],
        notes: 'Takes the knob stud pull-out (about 180 lbf each at the goal rider, seat-back check).' }));
    }
  }

  // ── Lash points on the cabin gunwales: stainless D-rings on bolt plates (BRIEF §4.9) ──
  const xs = lashPositions(p, L, p.lashPointsPerSide);
  const gTop = L.deckTop + L.sideH;
  const yg = gunwaleY(L);
  for (const { s: sg, tag } of SIDES) {
    xs.forEach((x, i) => {
      const dId = `doubler-lash-${tag}${i + 1}`;
      // Doubler: oak blocking on the inboard face of the ½" gunwale under the plate; the plate screws straddle the glue line (>= 3/4" engagement, no split-out of the thin rail).
      parts.push(box(ctx, { id: dId, partNo: 'doubler-lash', name: `Lash point doubler ${tag}${i + 1}`, group: 'storage', mat: 'oak', grain: 'x', step: STEP.finish,
        ...span([x - LASH_SIZE[0] / 2 - 0.25, x + LASH_SIZE[0] / 2 + 0.25], inboardOf(sg, yg - L.side / 2, p.blockingThickIn), [gTop - L.railBand, gTop]),
        joints: [{ type: 'glue', to: gunwaleId(p, tag), count: 1, note: 'epoxy, full face' }, { type: 'screw', to: `lash-${tag}${i + 1}`, count: 2, size: '#10 × 1-1/4 stainless, through the plate on the glue line' }],
        notes: 'Blocking behind the thin gunwale under the lash plate (D-41).' }));
      parts.push(box(ctx, { id: `lash-${tag}${i + 1}`, partNo: 'lash-point', name: `Lash point ${tag}${i + 1}`, group: 'hardware', mat: 'fixed', massLb: LASH_MASS_LB, kind: 'purchased',
        material: 'stainless D-ring on a bolt plate', fab: 'buy', step: STEP.finish, ...span([x - LASH_SIZE[0] / 2, x + LASH_SIZE[0] / 2], [sg * yg - LASH_SIZE[1] / 2, sg * yg + LASH_SIZE[1] / 2], [gTop, gTop + LASH_SIZE[2]]),
        sourcing: { vendor: 'McMaster-Carr (316 stainless D-ring with bolt plate, 300 lbf working load)', costUsd: 7 },
        joints: [{ type: 'screw', to: dId, count: 2, size: '#10 × 1-1/4 stainless, down on the glue line of the doubler and gunwale' }],
        notes: 'Rated for tie-down straps on coolers, duffels and firewood (post-race hauling, BRIEF §4.9). Screws land in the oak doubler under the plate (D-41).' }));
    });
  }
  return parts;
}
