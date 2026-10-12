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
import { localBounds, worldAABB } from './bounds';
import { sideSlopeAt, sideTopAt, type Layout } from './layout';
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
/** Grab handles stand this far behind the H-point (seat.ts GRIP_BEHIND_HPOINT_IN) and are this long: the lash points stay clear of them. */
const GRIP_BEHIND_IN = 5;

/** Bolt-plate screws per lash point (4-hole plate), the screw (#10 × 1-1/4 stainless), the plate thickness, and the tip/lead allowance (no thread bite). */
export const LASH_SCREWS = 4;
export const LASH_SCREW_DIA_IN = 0.19;
export const LASH_SCREW_LEN_IN = 1.25;
export const LASH_PLATE_T_IN = 0.125;
export const LASH_TIP_IN = 0.25;
/** Half the screw spacing of the 4-hole plate along (x) and across (y) it: 1.125" × 0.5" holes in the 1.5" × 0.9" plate. */
export const LASH_HOLE_DX_IN = 0.5625;
export const LASH_HOLE_DY_IN = 0.25;
/** The 3/8" epoxy fillet in every inside corner of the box (flat things stowed in it ride on it, not in the corner). */
export const BOX_FILLET_IN = 0.375;
/** Oak block under each lid latch (#8 screws need more than the 6 mm end ply or a thin transom): thickness, and width across. */
export const LATCH_BLOCK_IN = 0.375;
const LATCH_BLOCK_W_IN = 2;
/** Lid hold-open stay (friction stay): size, mass. */
const STAY_SIZE = [2, 0.3, 0.5] as const;
const STAY_MASS_LB = 0.12;
const BATTEN_X_IN = 1;
/** The lid hinge backer: oak 1" thick against the inside of the box fore end. */
const HINGE_BACKER_IN = 1;
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

/**
 * Loose gear that also rides in the box (3c-5, D-65), from the real part bounding boxes (the lamps and their clips are boxy; a wedge chock's bounding box over-covers it, which is conservative):
 * the front headlight and its printed clip and the rear tail light and its clip (they come off to lift the ends, and ride in the box in cargo mode), and the wheel chocks (2 when the design has 2;
 * both modes). `flaps` is an OPTION, not part of the default stow (D-65): the two removed brake flaps, each with its shoe block, pad, pivot block and foot tread still on (what lifts off as
 * one piece when the pin is pulled), as one bounding box each.
 */
export function boxGear(parts: Part[]): { lamp: KitItem[]; chocks: KitItem[]; flaps: KitItem[] } {
  const dimsOf = (x: Part): [number, number, number] => {
    const b = localBounds(x.geometry);
    return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  };
  const one = (id: string, name: string, essential: string): KitItem[] => {
    const x = parts.find((q) => q.id === id);
    return x ? [{ name, qty: 1, dims: dimsOf(x), essential }] : [];
  };
  const chock = parts.filter((q) => /^brake-chock-[LR]$/.test(q.id));
  const chocks: KitItem[] = chock.length ? [{ name: 'Wheel chock', qty: chock.length, dims: dimsOf(chock[0]), essential: 'Parking' }] : [];
  // The flap assembly laid flat: its length and width from the Shaper-cut board, its height the board plus the taller of the shoe block with its pad (under the middle) and the pivot block (on the tongue).
  const part = (id: string) => parts.find((q) => q.id === id);
  const fl = part('brake-flap-L'), sh = part('brake-shoe-L'), pd = part('brake-pad-L'), pb = part('brake-pivot-block-L');
  let flaps: KitItem[] = [];
  if (fl && sh && pd && pb) {
    const lb = localBounds(fl.geometry), bb = localBounds(pb.geometry);
    const under = worldAABB([sh, pd]);
    const h = (lb.max[2] - lb.min[2]) + Math.max(under.max[2] - under.min[2], bb.max[2] - bb.min[2]);
    flaps = [{ name: 'Brake flap with shoe block and pad', qty: parts.filter((q) => /^brake-flap-[LR]$/.test(q.id)).length, dims: [lb.max[0] - lb.min[0], lb.max[1] - lb.min[1], h], essential: 'Parking' }];
  }
  return {
    lamp: [
      ...one('front-light', 'Front LED headlight', 'Lighting'), ...one('lamp-clip', 'Lamp clip', 'Lighting'),
      ...one('rear-light', 'Rear LED tail light', 'Lighting'), ...one('rear-lamp-clip', 'Rear lamp clip', 'Lighting'),
    ],
    chocks, flaps,
  };
}

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
  const lo = L.xRear + L.transom + L.rearLane + margin + 0.6; // clear of the transom and the corner backers (D-43); the doubler is turned to the sheer's slope (up to ~20 degrees at the rear, D-57), so its corner reaches farther
  // D-54: the whole straight side is available, turned to the sled slope; the plates stop short of the end of the sides.
  // D-57, D-66: the plates stay on the straight part of the side (the hull starts to draw in at `L.taper.x0`).
  const hi = Math.min(L.xSideEnd - 2 * margin, L.taper.x0 - margin);
  const gripLen = p.grabBoardLengthIn; // the grab board (D-57)
  const gx0 = p.seatXIn - GRIP_BEHIND_IN;
  const flagClear = L.xRear + L.transom + L.rearLane + p.flagTubeOdIn + 0.75 + margin + 0.6; // the flag tube and its holding block stand in the left rear corner (D-57)
  const blocked: Array<[number, number]> = [
    [gx0 - margin - 0.5, gx0 + gripLen + margin + 0.5],
    [-Infinity, flagClear],
  ];
  // A rear box that stands above the gunwale occupies the gunwale line along its length.
  const st = storageGeometry(p, L);
  if (st.zTop > sideTopAt(L, st.x1) - L.railBand - 0.01) blocked.push([st.x0 - margin, st.x1 + margin]);
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
    parts.push(box(ctx, { ...common, id: 'storage-bottom', name: 'Storage box floor', mat: 'ply', edges: 'captured', fab: 'shaper-origin',
      ...span([x0 + pl, x1 - pl], [-yIn, yIn], [zBot, zBot + pl]),
      joints: ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'].map(fillet),
      notes: `Interior volume target ${p.storageVolumeIn3} in³ (D-19). The raised box has no deck under it, so it keeps its own floor; two ${p.storageDrainDiaIn}" drain holes at the aft corners go through it, lined with stainless nipples (D-41).` }));
  }
  const deckJoint = (): Joint[] => g.deckFloor ? [{ type: 'glue', to: deckId, count: 1, size: '3/8" epoxy fillet inside, 2" glass tape', note: 'wall bottom edge stands on the epoxy-sealed deck: fillet inside, bead outside, so no ply edge is exposed and the deck is the box floor' }] : [];
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', edges: 'captured', fab: 'shaper-origin',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [zBot, zPlyTop]),
      joints: [miter('storage-end-aft'), miter('storage-end-fore'), ...deckJoint(), { type: 'glue', to: `storage-coaming-side-${tag}`, count: 1, note: 'oak coaming caps the wall top, epoxy' }],
      notes: 'Wall top is capped by the oak coaming so no ply edge is exposed under the gasket (S4).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', edges: 'captured', fab: 'shaper-origin',
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
  parts.push(box(ctx, { ...common, id: 'storage-lid', name: 'Storage lid panel', mat: 'ply', edges: 'captured', fab: 'shaper-origin',
    ...span([x0 + rimW, x1 - rimW], [-(hw - rimW), hw - rimW], [zTop - pl, zTop]),
    stock: { t: pl, w: 2 * (hw - rimW) + 0.5, l: x1 - x0 - 2 * rimW + 0.5 },
    joints: ['storage-rim-side-L', 'storage-rim-side-R', 'storage-rim-end-aft', 'storage-rim-end-fore'].map((to): Joint => ({
      type: 'rabbet', to, count: 1, size: '1/4 deep × 1/4', note: 'panel captured in the frame (cut size includes the tongue); epoxy-sealed',
    })),
    legend: { text: 'DO NOT STEP', face: 'top', process: 'CNC V-carve or laser engrave, then fill with black epoxy or paint', letterHeightIn: 1.5, depthIn: 0.03 },
    notes: 'Ply lid panel captured in the oak frame; the frame underside seals on the gasket. The top face is engraved DO NOT STEP (D-58, Eric 2026-10-11): the lid is a seat-cushion box lid, not a step, and is NOT strengthened for a standing adult; the rest-load check leaves it out for that reason.' }));
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
  // D-53: a third batten once the lid is long enough (bays of about 3.6 in), so the lid carries a light cooler (lid-load row).
  const nBatten = inner >= 12 ? 3 : inner >= 9 ? 2 : inner >= 4 ? 1 : 0;
  for (let n = 1; n <= nBatten; n++) {
    const bx = x0 + rimW + (inner * n) / (nBatten + 1);
    parts.push(box(ctx, { ...common, id: `storage-lid-batten-${n}`, partNo: 'storage-lid-batten', name: `Storage lid batten ${n}`, mat: 'oak', grain: 'y',
      ...span([bx - BATTEN_X_IN / 2, bx + BATTEN_X_IN / 2], [-(hw - rimW), hw - rimW], [zTop - pl - rimT, zTop - pl]),
      joints: [{ type: 'glue', to: 'storage-lid', count: 1, note: 'epoxy + 4 stainless screws from the top (plugged)' }, { type: 'dado', to: 'storage-rim-side-L', count: 1, size: '1/4 deep', note: 'ends let into the frame sides' }, { type: 'dado', to: 'storage-rim-side-R', count: 1, size: '1/4 deep' }],
      notes: 'Stiffen the lid panel against sagging under a light cooler or a hand (a 25" × 13" ply panel alone would sag); the lid is engraved DO NOT STEP and is not a step (D-58); the lid-load row sizes the battens for the rated lid load (D-53).' }));
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
  const zGunTop = L.deckTop + L.sideRear;
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, { ...common, id: `storage-hinge-${tag}`, partNo: 'storage-hinge', name: `Lid hinge ${tag}`, mat: 'fixed', massLb: HINGE_MASS_LB,
      kind: 'purchased', material: '316 stainless butt hinge', fab: 'buy', step: STEP.finish, ...span([x1, x1 + 0.12], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [hz1 - HINGE_H_IN, hz1]),
      sourcing: { vendor: 'McMaster-Carr (316 stainless surface-mount butt hinge, 2½" × 2¾")', costUsd: 14 },
      joints: [{ type: 'screw', to: 'storage-rim-end-fore', count: 3, size: '#8 × 1/2 stainless' }, { type: 'screw', to: `storage-hinge-backer-${tag}`, count: 3, size: '#8 × 1 stainless, through the end panel into the 1" backer (S5)' }],
      notes: 'Barrel along the fore-top edge: the lid swings up and aft and the seat back (when fitted) stops it near 75° (D-41); the stay holds it open (S5).' }));
    parts.push(box(ctx, { ...common, id: `storage-hinge-backer-${tag}`, partNo: 'storage-hinge-backer', name: `Hinge backer ${tag}`, mat: 'oak', grain: 'y',
      ...span([x1 - pl - HINGE_BACKER_IN, x1 - pl], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [zPlyTop - 1.5, zPlyTop]),
      joints: [{ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel' }],
      notes: `Gives the hinge screws something to bite (#8 × 1" engages ${(1 - pl).toFixed(2)}" of oak past the ${Math.round(pl * 25.4)} mm ply); stops under the coaming.` }));
    // Latch block (S5): oak under each latch so the #8 screws are not in a thin ply end or a face-grain skin.
    // Latch: on the inside face of the rear transom above the lid (rear box), else on the aft end's outer face; hooks a catch on the lid frame.
    // Latches sit at 8.5" off center, clear of the rear lamp clip in the hand-hold (|y| < 2.25, D-64) on the same transom.
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

  // ── Lash points on the gunwales: stainless D-rings on bolt plates (BRIEF §4.9), turned to the slope of the sled profile (D-54) ──
  const xs = lashPositions(p, L, p.lashPointsPerSide);
  for (const { s: sg, tag } of SIDES) {
    xs.forEach((x, i) => {
      const dId = `doubler-lash-${tag}${i + 1}`;
      const yg = L.hwC + L.side / 2;
      const slope = sideSlopeAt(L, x);
      const cs = Math.cos(slope), sn = Math.sin(slope);
      const zTopAt = sideTopAt(L, x);
      const rot = Math.abs(slope) < 1e-9 ? undefined : { y: slope };
      // r3 build S8: the plate is centered on a 1" oak DOUBLER glued to the inboard face of the inner gunwale band (not on the 0.234" band alone: the plate screws need a solid block);
      // its four screws go straight down into the doubler, 1/4" either side of the plate centerline, so every screw is in solid oak 1/4" from a doubler face.
      const T = p.lashDoublerThickIn;
      const inN = L.side / 2 + T / 2; // doubler (and plate) center, inboard of the web plane
      const cy = sg * (yg - inN);
      const pat = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
      const screwAt = (z: number): Vec3[] => pat.map(([a, b]): Vec3 => [a * LASH_HOLE_DX_IN, b * LASH_HOLE_DY_IN, z]);
      parts.push(box(ctx, { id: dId, partNo: 'doubler-lash', name: `Lash point doubler ${tag}${i + 1}`, group: 'storage', mat: 'oak', grain: 'x', step: STEP.finish,
        size: [LASH_SIZE[0] + 0.5, T, L.railBand], center: [x - sn * (L.railBand / 2), cy, zTopAt - cs * (L.railBand / 2)], ...(rot ? { rot } : {}),
        joints: [{ type: 'glue', to: gunwaleId(p, tag), count: 1, size: `${(LASH_SIZE[0] + 0.5).toFixed(1)}" × ${L.railBand}" face, epoxy`, note: `Epoxy, full face, against the inboard face of the inner gunwale band (the 4 mm web and the outer band are behind it; there is no groove, and the screws never reach them). The vertical shear of a ${p.lashLoadLbf} lbf pull at ${p.lashPullAngleDeg}° on ${((LASH_SIZE[0] + 0.5) * L.railBand).toFixed(1)} in² of glue is a few tens of psi.` },
          { type: 'screw', to: `lash-${tag}${i + 1}`, count: LASH_SCREWS, size: '#10 × 1-1/4 stainless, straight down from the plate into the doubler', diaIn: LASH_SCREW_DIA_IN, at: screwAt(L.railBand / 2) }],
        notes: `${T}" oak doubler on the inboard face of the gunwale under the lash plate (D-41, D-47): ${(LASH_SIZE[0] + 0.5).toFixed(1)}" long, the full ${L.railBand}" band tall, cut square to the gunwale's ${((slope * 180) / Math.PI).toFixed(1)}° slope here (D-54). The four #10 screws sit ${LASH_HOLE_DY_IN}" either side of its centerline (${(T / 2 - LASH_HOLE_DY_IN).toFixed(2)}" from each face) and end ${(L.railBand - (LASH_SCREW_LEN_IN - LASH_PLATE_T_IN)).toFixed(2)}" above its bottom.` }));
      parts.push(box(ctx, { id: `lash-${tag}${i + 1}`, partNo: 'lash-point', name: `Lash point ${tag}${i + 1}`, group: 'hardware', mat: 'fixed', massLb: LASH_MASS_LB, kind: 'purchased',
        material: 'stainless D-ring on a bolt plate', fab: 'buy', step: STEP.finish, size: [LASH_SIZE[0], LASH_SIZE[1], LASH_SIZE[2]], center: [x + sn * (LASH_SIZE[2] / 2), cy, zTopAt + cs * (LASH_SIZE[2] / 2)], ...(rot ? { rot } : {}),
        sourcing: { vendor: 'McMaster-Carr (316 stainless 4-hole D-ring bolt plate, 300 lbf working load)', costUsd: 7 },
        joints: [{ type: 'screw', to: dId, count: LASH_SCREWS, size: '#10 × 1-1/4 stainless, straight down into the oak doubler', diaIn: LASH_SCREW_DIA_IN, at: screwAt(-LASH_SIZE[2] / 2) }],
        notes: `Rated for tie-down straps on coolers, duffels and firewood (post-race hauling, BRIEF §4.9). The plate (${LASH_SIZE[0]}" × ${LASH_SIZE[1]}", holes ${2 * LASH_HOLE_DX_IN}" × ${2 * LASH_HOLE_DY_IN}") lies on the top of the ${T}" doubler, entirely inboard of the gunwale; four screws land in the doubler; the lash-load check pulls it at ${p.lashLoadLbf} lbf and ${p.lashPullAngleDeg}° (D-41, S-9).` }));
    });
  }
  return parts;
}
