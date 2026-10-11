/**
 * Storage box (D-19, D-41, D-41r2): a weatherproof ply tray (walls tape-and-folded at the corners and filleted to the deck, which is the
 * floor; the box has its own ply floor only when it is raised clear of the deck), oak coaming on the wall tops (the gasket seals on oak),
 * a hinged, gasketed lid
 * (oak frame capturing a ply panel, two oak battens), two butt hinges on the fore edge (so the lid opens up and aft, clear of the
 * removable seat back), two over-center latches, two drains, and the lash points on the gunwales (BRIEF §4.9).
 * Built from real panels so the cut list and mass are honest (critic M3); the interior volume is set in layout.ts.
 *
 * Also holds the 10 Essentials kit list (D-19) and a simple packing check against the interior.
 */
import { STORAGE_LOCATION, type Params } from '../params';
import { STEP, box, cylinder, span, SIDES, type Ctx } from './build-utils';
import { curveHeading } from './hull-curve';
import { sidePath, type Layout } from './layout';
import { frameJoint, gunwaleId, seatBackSupport } from './seat';
import type { Joint, Part, Vec3 } from './types';

// ── Hardware and detail dimensions (estimates, D-41) ──
const HINGE_MASS_LB = 0.15;
const LATCH_MASS_LB = 0.15;
const CATCH_MASS_LB = 0.03;
const DRAIN_MASS_LB = 0.03;
const GASKET_LB_PER_IN = 0.002;
const LASH_MASS_LB = 0.1;
const LASH_SIZE = [1.5, 0.9, 0.75] as const;
/** A lash plate (turned to the gunwale) is not set where the gunwale runs more than this far off the axis. */
const LASH_MAX_HEADING_DEG = 25;

/** Furthest x a lash plate's center may reach: the straight cabin side plus the part of the S-curve flatter than LASH_MAX_HEADING_DEG. */
export function lashReachX(L: Layout): number {
  let x = L.xc0 - L.side;
  for (let i = 1; i < L.hull.pts.length; i++) {
    const [x0, y0] = L.hull.pts[i - 1], [x1, y1] = L.hull.pts[i];
    if ((Math.abs(Math.atan2(y1 - y0, x1 - x0)) * 180) / Math.PI > LASH_MAX_HEADING_DEG) break;
    x = Math.max(x, x1);
  }
  return x;
}
/** Bolt-plate screws per lash point (4-hole plate), the screw (#10 × 1-1/4 stainless), the plate thickness, and the tip/lead allowance (no thread bite). */
export const LASH_SCREWS = 4;
export const LASH_SCREW_DIA_IN = 0.19;
export const LASH_SCREW_LEN_IN = 1.25;
export const LASH_PLATE_T_IN = 0.125;
export const LASH_TIP_IN = 0.25;
/** Half the screw spacing of the 4-hole plate along (x) and across (y) it: 1.125" × 0.5" holes in the 1.5" × 0.9" plate. */
export const LASH_HOLE_DX_IN = 0.5625;
export const LASH_HOLE_DY_IN = 0.25;
const BACKER_IN = 1;
const BACKER_W_IN = 1.5;
/** Oak block under each lid latch (#8 screws need more than the 6 mm end ply or a thin transom): thickness, and width across. */
export const LATCH_BLOCK_IN = 0.375;
const LATCH_BLOCK_W_IN = 2;
/** Lid hold-open stay (friction stay): size, mass. */
const STAY_SIZE = [2, 0.3, 0.5] as const;
const STAY_MASS_LB = 0.12;
const BATTEN_X_IN = 0.75;
const HINGE_W_IN = 2.5;
const HINGE_H_IN = 2.7;

export interface StorageGeometry {
  x0: number;
  x1: number;
  hw: number;
  zBot: number;
  zTop: number;
  /** Top of the walls = top of the oak coaming (under the gasket). */
  zWallTop: number;
  /** Top of the ply walls (the coaming sits on it). */
  zPlyTop: number;
  coamT: number;
  coamW: number;
  /** True when the box stands on the deck and the deck is its floor (no separate floor panel). */
  deckFloor: boolean;
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
  const coamT = p.storageCoamingThickIn;
  const zWallTop = zTop - pl - rimT - gasket;
  // The box stands on the deck (rear and under-seat): the epoxy-sealed deck is the floor (round 2: the redundant 6 mm floor panel is gone).
  const deckFloor = Math.abs(st.zBot - L.deckTop) < 0.01;
  return {
    x0: st.x0, x1: Math.max(st.x0 + 0.5, sup.boxX1), hw: st.hw, zBot: st.zBot, zTop,
    zWallTop, zPlyTop: zWallTop - coamT, coamT, coamW: p.storageCoamingWidthIn, deckFloor,
    pl, rimW, rimT, gasket, floorZ: deckFloor ? st.zBot : st.zBot + pl, lidUnderZ: zTop - pl,
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
  /** Extra volume in the lid zone, inside the frame lip (and in the coaming zone, inside the coaming ledge). */
  capIn3: number;
  totalIn3: number;
}

/** Interior of a box from its geometry (pure, so the tests can hand-calculate it from literal dimensions). */
export function interiorOf(g: StorageGeometry): Interior {
  const lx = Math.max(0.5, g.x1 - g.x0 - 2 * g.pl);
  const w = Math.max(0.5, 2 * g.hw - 2 * g.pl);
  // Base cuboid up to the underside of the coaming; the coaming zone is narrowed by its ledge past the ply wall; the lid zone by the frame lip.
  const h = Math.max(0.5, g.zPlyTop - g.floorZ);
  const ledge = Math.max(0, g.coamW - g.pl);
  const lip = Math.max(0, g.rimW - g.pl);
  const capIn3 = Math.max(0, lx - 2 * ledge) * Math.max(0, w - 2 * ledge) * g.coamT
    + Math.max(0, lx - 2 * lip) * Math.max(0, w - 2 * lip) * (g.rimT + g.gasket);
  return { lx, w, h, capIn3, totalIn3: lx * w * h + capIn3 };
}

export function storageInterior(p: Params, L: Layout): Interior {
  return interiorOf(storageGeometry(p, L));
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
  const lo = L.xRear + L.transom + L.rearLane + margin; // clear of the transom and the corner backers (D-43)
  // D-45: plates may stand on the first part of the S-curve, turned to follow the gunwale, where it still runs within LASH_MAX_HEADING_DEG of the axis.
  const hi = lashReachX(L) - margin;
  const gripLen = p.seatGripClearLengthIn + 2;
  const gx0 = Math.min(p.seatXIn - 5, L.xc0 - L.side - gripLen - 0.25);
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
  const { x0, x1, hw, pl, rimW, rimT, zBot, zTop, zWallTop, zPlyTop, coamW } = g;
  const sup = seatBackSupport(p, L);
  const common = { group: 'storage', step: STEP.seatStorage } as const;
  const parts: Part[] = [];
  const yIn = hw - pl;
  // Tape-and-fold corners (build S4): 45° bevels on the wall panels, 2" glass tape across the outside of the open seam, fold, fillet inside.
  const miter = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '45° bevel, tape-and-fold', note: 'bevels cut on the table saw, outside seam taped, folded, then a 3/8" epoxy fillet and 2" glass tape inside the corner; no spline (6 mm ply is too thin for one)' });
  const fillet = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '3/8" epoxy fillet', note: 'floor captured between the walls, which reach the deck' });
  const dom = (to: string): Joint => frameJoint(p, to, { stockIn: rimT, hostIn: rimW, widthIn: rimW }, { note: 'light frame (no load path through the Domino): lid frame corner' });
  const deckId = 'deck';

  // ── Tray: the deck is the floor when the box stands on it; a raised box (forward) keeps its own ply floor ──
  if (!g.deckFloor) {
    parts.push(box(ctx, { ...common, id: 'storage-bottom', name: 'Storage box floor', mat: 'ply', edges: 'captured',
      ...span([x0 + pl, x1 - pl], [-yIn, yIn], [zBot, zBot + pl]),
      joints: ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'].map(fillet),
      notes: `Interior volume target ${p.storageVolumeIn3} in³ (D-19). The raised box has no deck under it, so it keeps its own floor; two ${p.storageDrainDiaIn}" drain holes at the aft corners go through it, lined with stainless nipples (D-41).` }));
  }
  const deckJoint = (): Joint[] => g.deckFloor ? [{ type: 'glue', to: deckId, count: 1, size: '3/8" epoxy fillet inside, 2" glass tape', note: 'wall bottom edge stands on the epoxy-sealed deck: fillet inside, bead outside, so no ply edge is exposed and the deck is the box floor' }] : [];
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', edges: 'captured',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [zBot, zPlyTop]),
      joints: [miter('storage-end-aft'), miter('storage-end-fore'), ...deckJoint(), { type: 'glue', to: `storage-coaming-side-${tag}`, count: 1, note: 'oak coaming caps the wall top, epoxy' }],
      notes: 'Wall top is capped by the oak coaming so no ply edge is exposed under the gasket (S4).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', edges: 'captured',
      ...span([xa, xb], [-yIn, yIn], [zBot, zPlyTop]),
      joints: [miter('storage-side-L'), miter('storage-side-R'), ...deckJoint(), { type: 'glue', to: `storage-coaming-end-${tag}`, count: 1, note: 'oak coaming caps the wall top, epoxy' }] }));
  }

  // ── Coaming: oak strip on the wall tops. Flush with the outside, ledge inboard; the gasket sits on it ──
  const cz: [number, number] = [zPlyTop, zWallTop];
  for (const [tag, y] of [['L', hw - coamW / 2], ['R', -(hw - coamW / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-coaming-side-${tag}`, partNo: 'storage-coaming-side', name: `Storage coaming side ${tag}`, mat: 'oak', grain: 'x',
      ...span([x0, x1], [y - coamW / 2, y + coamW / 2], cz),
      joints: [{ type: 'glue', to: `storage-side-${tag}`, count: 1, note: 'epoxy to the wall top (and the corner bevels)' }, { type: 'glue', to: 'storage-coaming-end-aft', count: 1, note: 'butt, epoxy' }, { type: 'glue', to: 'storage-coaming-end-fore', count: 1, note: 'butt, epoxy' }],
      notes: 'Round-over the inboard top edge 1/8". The gasket and the lid frame sit on oak, never on a ply edge (S4).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + coamW], ['fore', x1 - coamW, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-coaming-end-${tag}`, partNo: 'storage-coaming-end', name: `Storage coaming ${tag} end`, mat: 'oak', grain: 'y',
      ...span([xa, xb], [-(hw - coamW), hw - coamW], cz),
      joints: [{ type: 'glue', to: `storage-end-${tag}`, count: 1, note: 'epoxy to the wall top' }, { type: 'glue', to: 'storage-coaming-side-L', count: 1, note: 'butt, epoxy' }, { type: 'glue', to: 'storage-coaming-side-R', count: 1, note: 'butt, epoxy' }] }));
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
  const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
  const zGunTop = L.deckTop + L.sideH;
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, { ...common, id: `storage-hinge-${tag}`, partNo: 'storage-hinge', name: `Lid hinge ${tag}`, mat: 'fixed', massLb: HINGE_MASS_LB,
      kind: 'purchased', material: '316 stainless butt hinge', fab: 'buy', step: STEP.finish, ...span([x1, x1 + 0.12], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [hz1 - HINGE_H_IN, hz1]),
      sourcing: { vendor: 'McMaster-Carr (316 stainless surface-mount butt hinge, 2½" × 2¾")', costUsd: 14 },
      joints: [{ type: 'screw', to: 'storage-rim-end-fore', count: 3, size: '#8 × 1/2 stainless' }, { type: 'screw', to: `storage-hinge-backer-${tag}`, count: 3, size: '#8 × 1 stainless, through the end panel into the 1" backer (S5)' }],
      notes: 'Barrel along the fore-top edge: the lid swings up and aft and the seat back (when fitted) stops it near 75° (D-41); the stay holds it open (S5).' }));
    parts.push(box(ctx, { ...common, id: `storage-hinge-backer-${tag}`, partNo: 'storage-hinge-backer', name: `Hinge backer ${tag}`, mat: 'oak', grain: 'y',
      ...span([x1 - pl - BACKER_IN, x1 - pl], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [zPlyTop - 1.5, zPlyTop]),
      joints: [{ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel' }],
      notes: 'Gives the hinge screws something to bite (#8 × 1" engages 3/4" of oak past the 6 mm ply); stops under the coaming.' }));
    // Latch block (S5): oak under each latch so the #8 screws are not in a thin ply end or a face-grain skin.
    // Latch: on the inside face of the rear transom above the lid (rear box), else on the aft end's outer face; hooks a catch on the lid frame.
    // Latches sit at 8.5" off center, clear of the rear-light doubler (|y| 2.5 to 7.5) on the same transom face.
    const ly = sg * Math.min(hw - 3, 8.5);
    const blockZ: [number, number] = rear ? [zTop + 0.3, Math.max(zTop + 0.8, Math.min(zTop + 1.7, zGunTop))] : [zPlyTop - 1.4, zPlyTop];
    const blockX: [number, number] = rear ? [x0, x0 + LATCH_BLOCK_IN] : [x0 + pl, x0 + pl + 0.75];
    const blockId = `storage-latch-block-${tag}`;
    parts.push(box(ctx, { ...common, id: blockId, partNo: 'storage-latch-block', name: `Latch block ${tag}`, mat: 'oak', grain: 'z',
      ...span(blockX, [ly - LATCH_BLOCK_W_IN / 2, ly + LATCH_BLOCK_W_IN / 2], blockZ),
      joints: [{ type: 'glue', to: rear ? 'transom-rear' : 'storage-end-aft', count: 1, note: rear ? 'epoxy to the inside face of the rear transom' : 'epoxy to the inside of the aft end panel' },
        { type: 'screw', to: `storage-latch-${tag}`, count: 2, size: rear ? '#8 × 5/8 stainless, into the block' : '#8 × 7/8 stainless, through the end panel into the block' }],
      notes: rear ? `Oak block ${LATCH_BLOCK_IN}" thick on the transom's inner face: the #8 screws bite ${(5 / 8 - 0.06).toFixed(2)}" of block (end grain avoided: block grain is vertical) instead of a bare transom face. The lid's aft edge swings up and away from the transom, so the block is never in its path (S5).` : 'Oak block behind the 6 mm aft end for the latch screws (S5).' }));
    const latchBox = rear
      ? span([x0 + LATCH_BLOCK_IN, x0 + LATCH_BLOCK_IN + 0.35], [ly - 0.6, ly + 0.6], [blockZ[0] + 0.1, blockZ[1] - 0.05])
      : span([x0 - 0.35, x0], [ly - 0.6, ly + 0.6], [zTop - 2.5, zTop - 1.2]);
    const catchBox = rear
      ? span([x0 + 0.5, x0 + 0.95], [ly - 0.6, ly + 0.6], [zTop, zTop + 0.12])
      : span([x0 - 0.12, x0], [ly - 0.6, ly + 0.6], [zTop - 0.8, zTop - 0.1]);
    parts.push(box(ctx, { ...common, id: `storage-latch-${tag}`, partNo: 'storage-latch', name: `Lid latch ${tag}`, mat: 'fixed', massLb: LATCH_MASS_LB, kind: 'purchased',
      material: '316 stainless over-center draw latch', fab: 'buy', step: STEP.finish, ...latchBox,
      sourcing: { vendor: 'McMaster-Carr (316 stainless draw latch)', costUsd: 9 },
      joints: [{ type: 'screw', to: blockId, count: 2, size: rear ? '#8 × 5/8 stainless' : '#8 × 7/8 stainless' }],
      notes: rear
        ? 'On the oak block on the inside face of the rear transom, hooking a catch on the lid frame. Engagement in the block is about 1/2" (a #8 with a 3/8" pilot in white oak face grain holds about 100 lbf per screw, ~200 lbf per latch) against a gasket and slam load of about 20 lbf per latch, so about 10x margin (D-41).'
        : 'On the aft end (over the oak block inside it), hooking a catch on the lid frame.' }));
    parts.push(box(ctx, { ...common, id: `storage-catch-${tag}`, partNo: 'storage-catch', name: `Latch catch ${tag}`, mat: 'fixed', massLb: CATCH_MASS_LB, kind: 'purchased',
      material: '316 stainless catch plate', fab: 'buy', step: STEP.finish, ...catchBox,
      sourcing: { vendor: 'McMaster-Carr (316 stainless draw-latch catch; supplied with the latch)', costUsd: 0 },
      joints: [{ type: 'screw', to: 'storage-rim-end-aft', count: 2, size: '#8 × 3/8 stainless' }] }));
    // Drains: stainless nipple flange at the aft corner; the hole goes through the deck (and the floor panel when the box has one).
    const r = p.storageDrainDiaIn / 2 + 0.125;
    parts.push(cylinder(ctx, { ...common, id: `storage-drain-${tag}`, partNo: 'storage-drain', name: `Drain nipple ${tag}`, mat: 'fixed', massLb: DRAIN_MASS_LB, kind: 'purchased',
      material: '316 stainless drain nipple', fab: 'buy', step: STEP.finish, axis: 'z', radius: r, length: 0.2,
      center: [x0 + pl + 1.5, sg * (yIn - 1.2), g.floorZ + 0.1],
      sourcing: { vendor: 'McMaster-Carr (316 stainless tube fitting, ⅜")', costUsd: 5 },
      joints: [{ type: 'glue', to: g.deckFloor ? deckId : 'storage-bottom', count: 1, note: 'nipple epoxied into the hole so no cut ply edge is exposed' }],
      notes: g.deckFloor
        ? `${p.storageDrainDiaIn}" hole through the deck at the aft corner (the deck is the box floor), nipple epoxied in so no cut ply edge is exposed. Fair the sealed deck with microballoon-thickened epoxy to fall about 1/8" toward each drain so the box does not hold water.`
        : `${p.storageDrainDiaIn}" hole through the floor panel, nipple epoxied in so no cut ply edge is exposed.` }));
  }
  // Lid hold-open stay (S5): the 75° stop leaves the lid free to fall closed, so a friction stay on the inboard face of the left hinge backer
  // (oak, so the screws bite) holds it at any angle.
  const stayY0 = hingeY - HINGE_W_IN / 2 - STAY_SIZE[1];
  parts.push(box(ctx, { ...common, id: 'storage-lid-stay', name: 'Lid friction stay', mat: 'fixed', massLb: STAY_MASS_LB, kind: 'purchased', material: '316 stainless friction stay',
    fab: 'buy', step: STEP.finish, ...span([x1 - pl - STAY_SIZE[0], x1 - pl], [stayY0, stayY0 + STAY_SIZE[1]], [zPlyTop - STAY_SIZE[2], zPlyTop]),
    sourcing: { vendor: 'McMaster-Carr (316 stainless friction lid stay / hold-open brace, 2" fold)', costUsd: 18 },
    joints: [{ type: 'screw', to: 'storage-hinge-backer-L', count: 2, size: '#6 × 3/8 stainless, into the side grain of the 1" backer', note: 'the stay pivot' }, { type: 'screw', to: 'storage-rim-end-fore', count: 2, size: '#6 × 3/8 stainless', note: 'the stay arm end, on the lid frame' }],
    notes: 'Holds the lid at any angle so a gust or a scout cannot close it on fingers (S5). Folds flat against the backer when the lid is shut.' }));

  // ── Backer cleats (box behind the seat): the inserts for the seat-back studs, inside the fore end (D-40) ──
  if (sup.rear) {
    const s = L.seat;
    const c2z = s.col2[2];
    const zS = s.Pr[2] + c2z * sup.c2B;
    // Stud axis runs along the back normal; it reaches the box end plane just below the stile rear point.
    const xr = s.Pr[0] + s.col2[0] * sup.c2B;
    const dist = Math.max(0, (xr - x1) / s.col0[0]);
    const zE = zS - s.col0[2] * dist;
    const z0 = Math.max(g.floorZ, Math.min(zE - BACKER_IN, zPlyTop - 2 * BACKER_IN));
    const z1 = Math.max(z0 + 0.5, Math.min(z0 + 2 * BACKER_IN, zPlyTop)); // stops under the coaming
    for (const { s: sg, tag } of SIDES) {
      parts.push(box(ctx, { ...common, id: `storage-backer-${tag}`, partNo: 'storage-backer', name: `Seat-back insert backer ${tag}`, mat: 'oak', grain: 'z',
        ...span([x1 - pl - BACKER_IN, x1 - pl], [sg * sup.knobY - BACKER_W_IN / 2, sg * sup.knobY + BACKER_W_IN / 2], [z0, z1]),
        joints: [{ type: 'threaded-insert', to: `seat-back-stile-${tag}`, count: 1, size: '3/8-16 stainless, 3/4 deep', note: 'the seat-back stud ends here (D-9)' },
          { type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel' },
          { type: 'screw', to: 'storage-end-fore', count: 2, size: '#10 × 1¼ stainless, from the wedge side' }],
        notes: 'Takes the knob stud pull-out (about 180 lbf each at the goal rider, seat-back check).' }));
    }
  }

  // ── Lash points on the cabin gunwales: stainless D-rings on bolt plates (BRIEF §4.9) ──
  const xs = lashPositions(p, L, p.lashPointsPerSide);
  const gTop = L.deckTop + L.sideH;
  for (const { s: sg, tag } of SIDES) {
    xs.forEach((x, i) => {
      const dId = `doubler-lash-${tag}${i + 1}`;
      // On the S-curve the plate and its doubler turn with the gunwale (heading h of the web plane at x); on the straight side h = 0.
      const yg = sidePath(L, 0, x, x + 1e-6)[0][1];
      const h = curveHeading(L.hull, x);
      const rot = h === 0 ? undefined : { z: sg * h };
      // r3 build S8: the plate is centered on a 1" oak DOUBLER glued to the inboard face of the gunwale (not on the 5/8" gunwale, which has the web groove under it);
      // its four screws go straight down into the doubler, 1/4" either side of the plate centerline, so every screw is in solid oak 1/4" from a doubler face.
      const T = p.lashDoublerThickIn;
      const inN = L.side / 2 + T / 2; // doubler (and plate) center, inboard of the web plane
      const cx = x + inN * Math.sin(h), cy = sg * (yg - inN * Math.cos(h));
      const pat = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
      const screwAt = (z: number): Vec3[] => pat.map(([a, b]): Vec3 => [a * LASH_HOLE_DX_IN, b * LASH_HOLE_DY_IN, z]);
      parts.push(box(ctx, { id: dId, partNo: 'doubler-lash', name: `Lash point doubler ${tag}${i + 1}`, group: 'storage', mat: 'oak', grain: 'x', step: STEP.finish,
        size: [LASH_SIZE[0] + 0.5, T, L.railBand], center: [cx, cy, gTop - L.railBand / 2], ...(rot ? { rot } : {}),
        joints: [{ type: 'glue', to: gunwaleId(p, tag), count: 1, size: `${(LASH_SIZE[0] + 0.5).toFixed(1)}" × ${L.railBand}" face, epoxy`, note: `Epoxy, full face, against the gunwale's inner face (the web groove is behind it, the screws never reach it). The vertical shear of a ${p.lashLoadLbf} lbf pull at ${p.lashPullAngleDeg}° on ${((LASH_SIZE[0] + 0.5) * L.railBand).toFixed(1)} in² of glue is a few tens of psi.` },
          { type: 'screw', to: `lash-${tag}${i + 1}`, count: LASH_SCREWS, size: '#10 × 1-1/4 stainless, straight down from the plate into the doubler', diaIn: LASH_SCREW_DIA_IN, at: screwAt(L.railBand / 2) }],
        notes: `${T}" oak doubler on the inboard face of the gunwale under the lash plate (D-41, D-47): ${(LASH_SIZE[0] + 0.5).toFixed(1)}" long, the full ${L.railBand}" band tall. The four #10 screws sit ${LASH_HOLE_DY_IN}" either side of its centerline (${(T / 2 - LASH_HOLE_DY_IN).toFixed(2)}" from each face) and end ${(L.railBand - (LASH_SCREW_LEN_IN - LASH_PLATE_T_IN)).toFixed(2)}" above its bottom.${h !== 0 ? ' On the S-curve: plane its back to the gunwale curve (the 2" chord leaves up to 0.12" of gap or overlap).' : ''}` }));
      parts.push(box(ctx, { id: `lash-${tag}${i + 1}`, partNo: 'lash-point', name: `Lash point ${tag}${i + 1}`, group: 'hardware', mat: 'fixed', massLb: LASH_MASS_LB, kind: 'purchased',
        material: 'stainless D-ring on a bolt plate', fab: 'buy', step: STEP.finish, size: [LASH_SIZE[0], LASH_SIZE[1], LASH_SIZE[2]], center: [cx, cy, gTop + LASH_SIZE[2] / 2], ...(rot ? { rot } : {}),
        sourcing: { vendor: 'McMaster-Carr (316 stainless 4-hole D-ring bolt plate, 300 lbf working load)', costUsd: 7 },
        joints: [{ type: 'screw', to: dId, count: LASH_SCREWS, size: '#10 × 1-1/4 stainless, straight down into the oak doubler', diaIn: LASH_SCREW_DIA_IN, at: screwAt(-LASH_SIZE[2] / 2) }],
        notes: `Rated for tie-down straps on coolers, duffels and firewood (post-race hauling, BRIEF §4.9). The plate (${LASH_SIZE[0]}" × ${LASH_SIZE[1]}", holes ${2 * LASH_HOLE_DX_IN}" × ${2 * LASH_HOLE_DY_IN}") lies on the top of the ${T}" doubler, entirely inboard of the gunwale; four screws land in the doubler; the lash-load check pulls it at ${p.lashLoadLbf} lbf and ${p.lashPullAngleDeg}° (D-41, S-9).${h !== 0 ? ` This plate stands on the S-curve and is turned ${((Math.abs(h) * 180) / Math.PI).toFixed(0)}° to follow the gunwale.` : ''}` }));
    });
  }
  return parts;
}
