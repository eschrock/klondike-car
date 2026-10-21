/**
 * Storage box (D-19, D-41, D-41r2): a weatherproof ply tray (walls tape-and-folded at the corners and filleted to the deck, which is the
 * floor; the box has its own ply floor only when it is raised clear of the deck), oak coaming on the wall tops (the gasket seals on oak),
 * a hinged, gasketed lid
 * (oak frame capturing a ply panel, two oak battens), two butt hinges on the fore edge (so the lid opens up and aft, clear of the
 * removable seat back), two over-center latches, two drains. (The lash points are on the side ribs, D-76: side-ribs.ts.)
 * Built from real panels so the cut list and mass are honest (critic M3); the interior volume is set in layout.ts.
 *
 * Also holds the 10 Essentials kit list (D-19) and a simple packing check against the interior.
 */
import { KNEE_MOUNT, STORAGE_LOCATION, WEATHER_SPEC, thinSheet, type Params } from '../params';
import { localPoint, pickWoodScrew, SCREW_DIA_IN, screwText } from './rear-mount';
import { STEP, box, cylinder, frac16 as frac, span, SIDES, type Ctx, stainless } from './build-utils';
import { localBounds, worldAABB } from './bounds';
import { type Layout } from './layout';
import { seatBackSupport } from './seat';
import { profilePart } from './profile';
import type { Joint, Part, Vec3 } from './types';

// ── Hardware and detail dimensions (estimates, D-41) ──
/** D-89 (round 2): a 2-1/2" x 1-1/2" (open) butt hinge, 3/4" leaves, so the lid leaf fits the 3/4" lid frame face; lighter than the old 2-3/4" one. */
const HINGE_MASS_LB = 0.1;
const LATCH_MASS_LB = 0.15;
const CATCH_MASS_LB = 0.03;
const DRAIN_MASS_LB = 0.03;
const GASKET_LB_PER_IN = 0.002;
/** The 3/8" epoxy fillet in every inside corner of the box (flat things stowed in it ride on it, not in the corner). */
export const BOX_FILLET_IN = 0.375;
/** Oak block under each lid latch (#8 screws need more than the thin end ply or a thin transom): thickness, and width across. */
export const LATCH_BLOCK_IN = 0.375;
const LATCH_BLOCK_W_IN = 2;
/** Lid hold-open stay, size (folded) and mass. Extreme: the stainless friction stay (2 in fold). Standard (D-83): a Rockler 6 in quiet-action lid support, plated steel, the arm folds flat. */
const STAY_SIZE_EXTREME = [2, 0.6, 0.5] as const;
const STAY_MASS_EXTREME_LB = 0.12;
const STAY_SIZE_STD = [6, 0.6, 0.5] as const;
const STAY_MASS_STD_LB = 0.15;
const BATTEN_X_IN = 1;
/** The lid hinge backer: oak 1" thick against the inside of the box fore end. */
/** D-72: 1-1/4 in, so the standard #8 x 1-1/4 hinge screw (leaf + the ply + 1.0 in of bite) stays inside it. */
const HINGE_BACKER_IN = 1.25;
/** A butt hinge leaf (the model's 316 hinges). */
const LEAF_IN = 1 / 16;
const HINGE_W_IN = 2.5;
const HINGE_H_IN = 1.5;
/** Depth of the lid panel's rabbet in the frame (the joint text's "1/4 deep"): the corner mortises stay below its floor. */
const LID_RABBET_IN = 0.25;

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
  const pl = thinSheet(p).thicknessIn;
  const rimW = p.storageLidRimWidthIn;
  const rimT = p.storageLidRimThickIn;
  const gasket = p.storageGasketIn;
  const zTop = sup.boxZTop;
  const coamT = p.storageCoamingThickIn;
  const zWallTop = zTop - pl - rimT - gasket;
  // The box stands on the deck (rear and under-seat): the epoxy-sealed deck is the floor (round 2: the redundant floor panel is gone).
  const deckFloor = Math.abs(st.zBot - L.deckTop) < 0.01;
  return {
    x0: st.x0, x1: Math.max(st.x0 + 0.5, sup.boxX1), hw: st.hw, zBot: st.zBot, zTop,
    zWallTop, zPlyTop: zWallTop - coamT, coamT, coamW: p.storageCoamingWidthIn, deckFloor,
    pl, rimW, rimT, gasket, floorZ: deckFloor ? st.zBot : st.zBot + pl, lidUnderZ: zTop - pl,
  };
}

/** D-83: where the two storage drain holes go (model frame): the aft corners, through the deck (the box floor) or the box's own floor panel. */
export function storageDrainSites(p: Params, L: Layout): { tag: string; x: number; y: number; z: number; hostId: string }[] {
  const g = storageGeometry(p, L);
  return SIDES.map(({ s, tag }) => ({ tag, x: g.x0 + g.pl + 1.5, y: s * (g.hw - g.pl - 1.2), z: g.floorZ, hostId: g.deckFloor ? 'deck' : 'storage-bottom' }));
}

/** D-83 (Standard): the box drains are drilled holes with an epoxy-lined bore; the hole joint is recorded on the deck (the box floor) or the box's own floor panel. Call after the parts are built. */
export function addStorageDrainHoles(ctx: Ctx, parts: Part[]): void {
  const { p, L } = ctx;
  if (p.weatherSpec === WEATHER_SPEC.extreme) return; // the nipples carry their own joints
  for (const site of storageDrainSites(p, L)) {
    const host = parts.find((q) => q.id === site.hostId);
    if (!host || !parts.some((q) => q.id === `storage-side-${site.tag}`)) continue; // no box (the side panel is absent): no drain
    (host.joints ??= []).push({ // a hole in this part alone, so `to` is the part itself (no mating part)
      type: 'hole', to: host.id, count: 1, diaIn: p.storageDrainDiaIn, at: [localPoint(host.transform, [site.x, site.y, site.z])],
      size: `${frac(p.storageDrainDiaIn)}" drain hole through ${site.hostId === 'deck' ? 'the deck (the box floor)' : 'the box floor panel'} at the aft ${site.tag === 'L' ? 'left' : 'right'} corner of the box; the bore is sealed with epoxy`,
      note: 'D-83: drilled up through the deck from below while the hull is inverted (before the box goes on); seal the bore with epoxy, and fair the floor to fall about 1/8" toward each drain with epoxy thickened with fumed silica or wood flour. The Extreme spec fits a stainless nipple here instead.',
    });
  }
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
 * Loose gear that also rides in the box (3c-5, D-65), from the real part bounding boxes (the lamps and their clips are boxy; a wedge chock's bounding box over-covers it, which is conservative; `tools` is the D-78 tool pouch, present only with removable knees):
 * the front headlight and its printed clip and the rear tail light and its clip (they come off to lift the ends, and ride in the box in cargo mode), and the wheel chocks (2 when the design has 2;
 * both modes). `flaps` is an OPTION, not part of the default stow (D-65): the two removed brake flaps, each with its shoe block, pad, pivot block and foot tread still on (what lifts off as
 * one piece when the pin is pulled), as one bounding box each.
 */
export function boxGear(parts: Part[], p?: Pick<Params, 'kneeMount' | 'toolPouchLengthIn' | 'toolPouchWidthIn' | 'toolPouchHeightIn'>): { lamp: KitItem[]; chocks: KitItem[]; flaps: KitItem[]; tools: KitItem[] } {
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
    chocks, flaps, tools: toolPouch(p),
  };
}

/**
 * D-78: with removable knees the box carries (in CARGO mode only; the seat-stow row packs it) the tool pouch (a 3/8" drive ratchet, a 9/16" socket and a 9/16" combination wrench) as one rigid item. It is a TOOL, not sled mass
 * (like the Essentials), so it has no part and no weight in the model. Empty with the default fixed knees.
 */
export function toolPouch(p?: Pick<Params, 'kneeMount' | 'toolPouchLengthIn' | 'toolPouchWidthIn' | 'toolPouchHeightIn'>): KitItem[] {
  if (!p || p.kneeMount !== KNEE_MOUNT.removable) return [];
  return [{ name: 'Tool pouch (ratchet, socket, wrench)', qty: 1, dims: [p.toolPouchLengthIn, p.toolPouchWidthIn, p.toolPouchHeightIn], essential: 'Tools' }];
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

export function buildStorage(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const g = storageGeometry(p, L);
  const { x0, x1, hw, pl, rimW, rimT, zBot, zTop, zWallTop, zPlyTop, coamW } = g;
  const sup = seatBackSupport(p, L);
  const common = { group: 'storage', step: STEP.seatStorage } as const;
  const parts: Part[] = [];
  const yIn = hw - pl;
  // Tape-and-fold corners (build S4): 45° bevels on the wall panels, 2" glass tape across the outside of the open seam, fold, fillet inside.
  const miter = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '45° bevel, tape-and-fold', note: 'bevels cut on the table saw, outside seam taped, folded, then a 3/8" epoxy fillet and 2" glass tape inside the corner; no spline (4 mm ply is too thin for one)' });
  const fillet = (to: string): Joint => ({ type: 'glue', to, count: 1, size: '3/8" epoxy fillet', note: 'floor captured between the walls, which reach the deck' });
  // Lid frame corner: the end piece's END GRAIN meets the inner face of the side, flush with the side's end, so a Domino cannot sit there (a 4x20 is 0.67" long in a 0.75" piece and the
  // face is only 0.71" tall). A shop-made loose tenon in a mortise in BOTH pieces: a third of the frame thickness thick, as wide as leaves `endMin` of solid wood between the mortise and the
  // side's end (and the same at the edges of the end piece), `p.tenonDepthIn` deep in each. endMin = the Domino wall minimum rounded up to 1/16 in.
  const frameT = pl + rimT;
  const endMin = Math.ceil(p.dominoMinWallIn * 16 - 1e-9) / 16;
  const tenT = Math.max(0.125, Math.round((frameT / 3) * 16) / 16), tenW = Math.floor(Math.max(0.25, rimW - 2 * endMin) * 16 + 1e-9) / 16, tenD = p.tenonDepthIn;
  const lidTenon = (to: string, pts: Vec3[], what: string): Joint => ({
    type: 'mortise-tenon', to, count: 1,
    size: `${frac(tenT)}" × ${frac(tenW)}" × ${frac(tenD)}" deep loose tenon (both parts mortised), ${frac((rimW - tenW) / 2)}" of wood left beyond the mortise ends`,
    note: `light frame (no load path through the tenon): lid frame corner; ${what}`, at: pts,
  });
  const deckId = 'deck';

  // ── Tray: the deck is the floor when the box stands on it; a raised box (forward) keeps its own ply floor ──
  if (!g.deckFloor) {
    parts.push(box(ctx, { ...common, id: 'storage-bottom', name: 'Storage box floor', mat: 'ply', thin: true, edges: 'captured', fab: 'shaper-origin',
      ...span([x0 + pl, x1 - pl], [-yIn, yIn], [zBot, zBot + pl]),
      joints: ['storage-side-L', 'storage-side-R', 'storage-end-aft', 'storage-end-fore'].map(fillet),
      notes: `Interior volume target ${p.storageVolumeIn3} in³ (D-19). The raised box has no deck under it, so it keeps its own floor; two ${p.storageDrainDiaIn}" drain holes at the aft corners go through it (D-83: bare epoxy-lined bores; the Extreme spec lines them with stainless nipples, D-41).` }));
  }
  const deckJoint = (): Joint[] => g.deckFloor ? [{ type: 'glue', to: deckId, count: 1, size: '3/8" epoxy fillet inside, 2" glass tape', note: 'wall bottom edge stands on the epoxy-sealed deck: fillet inside, bead outside, so no ply edge is exposed and the deck is the box floor' }] : [];
  for (const [tag, y] of [['L', hw - pl / 2], ['R', -(hw - pl / 2)]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', thin: true, edges: 'captured', fab: 'shaper-origin',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [zBot, zPlyTop]),
      joints: [miter('storage-end-aft'), miter('storage-end-fore'), ...deckJoint(), { type: 'glue', to: `storage-coaming-side-${tag}`, count: 1, note: 'oak coaming caps the wall top, epoxy' }],
      notes: 'Wall top is capped by the oak coaming so no ply edge is exposed under the gasket (S4).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', thin: true, edges: 'captured', fab: 'shaper-origin',
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
  parts.push(box(ctx, { ...common, id: 'storage-lid', name: 'Storage lid panel', mat: 'ply', thin: true, edges: 'captured', fab: 'shaper-origin',
    ...span([x0 + rimW, x1 - rimW], [-(hw - rimW), hw - rimW], [zTop - pl, zTop]),
    stock: { t: pl, w: 2 * (hw - rimW) + 0.5, l: x1 - x0 - 2 * rimW + 0.5 },
    joints: ['storage-rim-side-L', 'storage-rim-side-R', 'storage-rim-end-aft', 'storage-rim-end-fore'].map((to): Joint => ({
      type: 'rabbet', to, count: 1, size: '1/4 deep × 1/4', note: 'panel captured in the frame (cut size includes the tongue); epoxy-sealed',
    })),
    legend: { text: 'DO NOT STEP', face: 'top', process: 'CNC V-carve or laser engrave, then fill with black epoxy or paint', letterHeightIn: 1.5, depthIn: 0.03 },
    notes: 'Ply lid panel captured in the oak frame; the frame underside seals on the gasket. The top face is engraved DO NOT STEP (D-58, Eric 2026-10-11): the lid is a seat-cushion box lid, not a step, and is NOT strengthened for a standing adult; the rest-load check leaves it out for that reason.' }));
  const rz: [number, number] = [zTop - pl - rimT, zTop];
  // Round 2: the corner mortise is centered low enough to stay 1/16 in under the rabbet floor (centered on the frame it broke into the rabbet wall).
  const zMid = Math.min((rz[0] + rz[1]) / 2, rz[1] - LID_RABBET_IN - tenT / 2 - 1 / 16);
  const cornerPts = (xs: number, ys: number): { side: Vec3; end: Vec3 } => ({ side: [xs, ys, zMid], end: [xs, ys, zMid] });
  for (const [tag, y] of [['L', hw - rimW / 2], ['R', -(hw - rimW / 2)]] as const) {
    const sideP = box(ctx, { ...common, id: `storage-rim-side-${tag}`, partNo: 'storage-rim-side', name: `Storage lid frame side ${tag}`, mat: 'oak', grain: 'x',
      ...span([x0, x1], [y - rimW / 2, y + rimW / 2], rz) });
    const yFace = Math.sign(y) * (hw - rimW); // the side's inner face
    sideP.joints = (['aft', 'fore'] as const).map((e) => lidTenon(`storage-rim-end-${e}`, [localPoint(sideP.transform, cornerPts(e === 'aft' ? x0 + rimW / 2 : x1 - rimW / 2, yFace).side)], 'the mortise is in the inner face of this side'));
    parts.push(sideP);
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + rimW], ['fore', x1 - rimW, x1]] as const) {
    const endP = box(ctx, { ...common, id: `storage-rim-end-${tag}`, partNo: 'storage-rim-end', name: `Storage lid frame ${tag} end`, mat: 'oak', grain: 'y',
      ...span([xa, xb], [-(hw - rimW), hw - rimW], rz) });
    endP.joints = (['L', 'R'] as const).map((sd) => lidTenon(`storage-rim-side-${sd}`, [localPoint(endP.transform, cornerPts((xa + xb) / 2, (sd === 'L' ? 1 : -1) * (hw - rimW)).end)], 'the mortise is in the end grain of this piece'));
    parts.push(endP);
  }
  const inner = x1 - x0 - 2 * rimW;
  // D-53: a third batten once the lid is long enough (bays of about 3.6 in), so the lid carries a light cooler (lid-load row).
  const nBatten = inner >= 12 ? 3 : inner >= 9 ? 2 : inner >= 4 ? 1 : 0;
  for (let n = 1; n <= nBatten; n++) {
    const bx = x0 + rimW + (inner * n) / (nBatten + 1);
    parts.push(box(ctx, { ...common, id: `storage-lid-batten-${n}`, partNo: 'storage-lid-batten', name: `Storage lid batten ${n}`, mat: 'oak', grain: 'y',
      ...span([bx - BATTEN_X_IN / 2, bx + BATTEN_X_IN / 2], [-(hw - rimW), hw - rimW], [zTop - pl - rimT, zTop - pl]),
      joints: [{ type: 'glue', to: 'storage-lid', count: 1, note: 'thickened epoxy, the lid face down on a flat bench and weighted for 24 h (no screws: nothing goes through the thin panel)' }, { type: 'glue', to: 'storage-rim-side-L', count: 1, note: 'end butted to the frame side, thickened epoxy (no dado)' }, { type: 'glue', to: 'storage-rim-side-R', count: 1, note: 'end butted to the frame side, thickened epoxy (no dado)' }],
      notes: 'Stiffens the lid panel against sagging under a light cooler or a hand (the thin panel alone would sag): cut to the clear span between the frame sides, glued to the panel\'s underside (lid face down, weighted) and butted to the frame sides with thickened epoxy, the lid face down and weighted for 24 h (no screws through the thin panel). The lid is engraved DO NOT STEP and is not a step (D-58); the lid-load row sizes the battens for the rated lid load (D-53).' }));
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
  // D-89 (round 2): the knuckle sits on the joint line between the coaming (with its gasket) and the lid frame, above the crest strip's top, so the lid leaf lies on the lid frame's fore face
  // and nothing stands in front of it; the box leaf lies on the fore coaming and the wall top, its screws through the coaming into the backer behind it.
  const zKnuckle = zTop - pl - rimT;
  const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
  const zGunTop = L.deckTop + L.sideRear;
  // D-72: the hinge leaves take the standard screws: #8 x 5/8 into the lid frame end (rimW deep), #8 x 1-1/4 through the fore coaming into the backer (its top reaches the coaming top, notched under the coaming's inboard lip).
  const hingeRimFit = pickWoodScrew(8, LEAF_IN, rimW);
  const backerUnderCoaming = HINGE_BACKER_IN - (coamW - pl);
  const hingeBackFit = pickWoodScrew(8, LEAF_IN + coamW, backerUnderCoaming);
  for (const { s: sg, tag } of SIDES) {
    parts.push(box(ctx, { ...common, id: `storage-hinge-${tag}`, partNo: 'storage-hinge', name: `Lid hinge ${tag}`, mat: 'fixed', massLb: HINGE_MASS_LB,
      kind: 'purchased', material: `${stainless(p)} butt hinge`, fab: 'buy', step: STEP.seatStorage, ...span([x1, x1 + 0.12], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [zKnuckle - HINGE_H_IN / 2, zKnuckle + HINGE_H_IN / 2]),
      sourcing: { vendor: `McMaster-Carr (${stainless(p)} surface-mount butt hinge, 2½" × 1½" open, ¾" leaves)`, costUsd: 9 },
      joints: [{ type: 'screw', to: 'storage-rim-end-fore', count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeRimFit, size: `${screwText(hingeRimFit)} stainless, into the lid frame end` }, { type: 'screw', to: `storage-hinge-backer-${tag}`, count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeBackFit, size: `${screwText(hingeBackFit)} stainless, through the fore coaming into the backer (S5)` }],
      notes: 'D-89: the knuckle on the joint line between the coaming and the lid frame, the lid leaf on the lid frame\'s 3/4" fore face, the box leaf on the fore coaming and the wall top (the crest strip covers it below the knuckle; nothing may stand in front of the lid leaf). The lid swings up about its fore edge; flip the seat back forward first, because upright it stands just in front of the hinge edge. The stay holds it open (S5).' }));
    // An L in side view: against the fore wall below the ply top, and up to the coaming top behind the coaming's inboard lip (round 2: the hinge screws now go through the coaming into it).
    // It stays clear of the side coaming and of the aft coaming (a narrow or short box): its width along the fore wall is clipped to the space between the side coamings.
    const bxa = Math.max(x1 - pl - HINGE_BACKER_IN, x0 + coamW + 0.05), bxw = x1 - pl, bxc = x1 - coamW, bzb = zPlyTop - 1.5;
    const byHi = Math.min(hingeY + HINGE_W_IN / 2, hw - coamW), byLo = Math.max(hingeY - HINGE_W_IN / 2, -(hw - coamW));
    const bW = Math.max(0.5, byHi - byLo);
    parts.push(profilePart(ctx, { ...common, id: `storage-hinge-backer-${tag}`, partNo: 'storage-hinge-backer', name: `Hinge backer ${tag}`, mat: 'oak', grain: 'z', fab: 'bandsaw',
      outline: [[bxa, bzb], [bxw, bzb], [bxw, zPlyTop], [bxc, zPlyTop], [bxc, zWallTop], [bxa, zWallTop]], depth: bW, basis: 'xz', origin: [0, sg > 0 ? byHi : -byLo, 0],
      stock: { t: bxw - bxa, w: bW, l: zWallTop - bzb },
      joints: [{ type: 'glue', to: 'storage-end-fore', count: 1, note: 'epoxy to the inside of the end panel and the underside of the coaming lip' }],
      notes: `Glued to the inside of the ${Math.round(pl * 25.4)} mm ply fore wall. Gives the hinge screws something to bite: the ${screwText(hingeBackFit)} screw passes the leaf and the ${frac(coamW)}" fore coaming and engages ${(hingeBackFit.lenIn - hingeBackFit.gripIn).toFixed(2)}" of oak in the backer (D-72). Its top is flush with the coaming top; a ${frac(coamW - pl)}" × ${frac(zWallTop - zPlyTop)}" notch at its top front fits under the coaming's inboard lip.` }));
    // Latch block (S5): oak under each latch so the #8 screws are not in a thin ply end or a face-grain skin.
    // Latch: on the inside face of the rear transom above the lid (rear box), else on the aft end's outer face; hooks a catch on the lid frame.
    // Latches sit at 8.5" off center, clear of the rear lamp clip in the hand-hold (|y| < 2.25, D-64) on the same transom.
    const ly = sg * Math.min(hw - 3, 8.5);
    // D-89 (round 2): the block's top at the lid frame's underside, so the latch body sits below the lid top and its hook reaches up over the lid's aft edge to the catch on the lid top
    // (with the body above the lid, closing the latch lifted the lid).
    const blockH = Math.min(1.4, Math.max(0.5, zGunTop - zTop));
    const blockZ: [number, number] = rear ? [zKnuckle - blockH, zKnuckle] : [zPlyTop - 1.4, zPlyTop];
    // D-72: a block behind the end panel is 1-1/4 in thick so the standard #8 x 1-1/4 latch screw stays inside it; the rear block (on the transom, 0.375 in + the transom) takes the #8 x 5/8.
    const blockT = rear ? LATCH_BLOCK_IN : 1.25;
    const latchFit = rear ? pickWoodScrew(8, LEAF_IN, LATCH_BLOCK_IN + L.transom) : pickWoodScrew(8, LEAF_IN + pl, blockT);
    // Rear box: against the transom's inner face (the rear lane between the transom and the aft wall is open there), so it is clear of the lid frame's aft end.
    const xTi = L.xRear + L.transom;
    const blockX: [number, number] = rear ? [xTi, xTi + LATCH_BLOCK_IN] : [x0 + pl, x0 + pl + blockT];
    const catchFit = pickWoodScrew(8, LEAF_IN, rimW); // the catch plate on the lid frame end
    const blockId = `storage-latch-block-${tag}`;
    parts.push(box(ctx, { ...common, id: blockId, partNo: 'storage-latch-block', name: `Latch block ${tag}`, mat: 'oak', grain: 'z',
      ...span(blockX, [ly - LATCH_BLOCK_W_IN / 2, ly + LATCH_BLOCK_W_IN / 2], blockZ),
      joints: [{ type: 'glue', to: rear ? 'transom-rear' : 'storage-end-aft', count: 1, note: rear ? 'epoxy to the inside face of the rear transom' : 'epoxy to the inside of the aft end panel' },
        { type: 'screw', to: `storage-latch-${tag}`, count: 2, diaIn: SCREW_DIA_IN[8], fit: latchFit, size: rear ? `${screwText(latchFit)} stainless, into the block and the transom behind it` : `${screwText(latchFit)} stainless, through the end panel into the block` }],
      notes: rear ? `Oak block ${LATCH_BLOCK_IN}" thick on the transom's inner face: the ${screwText(latchFit)} screws bite ${(latchFit.lenIn - latchFit.gripIn).toFixed(2)}" (the block, then the transom it is glued to; end grain avoided: block grain is vertical) instead of a bare transom face. It is glued to the transom, ${frac(x0 - blockX[1])}" clear of the lid frame's aft face, its top at the lid frame's underside: the latch body on it sits below the lid top and the hook reaches up over the lid's aft edge to the catch on the lid top, so closing it pulls the lid down onto the gasket (D-89). The lid hinges on its fore edge, so its aft edge swings up and forward, away from the block (S5).` : 'Oak block behind the 6 mm aft end for the latch screws (S5).' }));
    const latchBox = rear
      ? span([blockX[1], blockX[1] + 0.35], [ly - 0.6, ly + 0.6], [blockZ[0] + 0.1, blockZ[1] - 0.05])
      : span([x0 - 0.35, x0], [ly - 0.6, ly + 0.6], [zTop - 2.5, zTop - 1.2]);
    const catchBox = rear
      ? span([x0 + 0.1, x0 + 0.55], [ly - 0.6, ly + 0.6], [zTop, zTop + 0.12])
      : span([x0 - 0.12, x0], [ly - 0.6, ly + 0.6], [zTop - 0.8, zTop - 0.1]);
    parts.push(box(ctx, { ...common, id: `storage-latch-${tag}`, partNo: 'storage-latch', name: `Lid latch ${tag}`, mat: 'fixed', massLb: LATCH_MASS_LB, kind: 'purchased',
      material: `${stainless(p)} over-center draw latch`, fab: 'buy', step: STEP.finish, ...latchBox,
      sourcing: { vendor: `McMaster-Carr (${stainless(p)} draw latch)`, costUsd: 9 },
      joints: [{ type: 'screw', to: blockId, count: 2, diaIn: SCREW_DIA_IN[8], fit: latchFit, size: `${screwText(latchFit)} stainless` }],
      notes: rear
        ? 'On the oak block on the inside face of the rear transom, its body below the lid top, its hook reaching up over the lid\'s aft edge to the catch on the lid frame top (D-89). Engagement in the block is about 1/2" (a #8 with a 3/8" pilot in white oak face grain holds about 100 lbf per screw, ~200 lbf per latch) against a gasket and slam load of about 20 lbf per latch, so about 10x margin (D-41).'
        : 'On the aft end (over the oak block inside it), hooking a catch on the lid frame.' }));
    parts.push(box(ctx, { ...common, id: `storage-catch-${tag}`, partNo: 'storage-catch', name: `Latch catch ${tag}`, mat: 'fixed', massLb: CATCH_MASS_LB, kind: 'purchased',
      material: `${stainless(p)} catch plate`, fab: 'buy', step: STEP.finish, ...catchBox,
      sourcing: { vendor: `McMaster-Carr (${stainless(p)} draw-latch catch; supplied with the latch)`, costUsd: 0 },
      joints: [{ type: 'screw', to: 'storage-rim-end-aft', count: 2, diaIn: SCREW_DIA_IN[8], fit: catchFit, size: `${screwText(catchFit)} stainless` }] }));
    // Drains: Extreme: a stainless nipple flange at the aft corner; the hole goes through the deck (and the floor panel when the box has one). Standard (D-83): the bare epoxy-lined hole, recorded as a hole joint (joinery.ts).
    if (p.weatherSpec === WEATHER_SPEC.extreme) {
      const r = p.storageDrainDiaIn / 2 + 0.125;
      parts.push(cylinder(ctx, { ...common, id: `storage-drain-${tag}`, partNo: 'storage-drain', name: `Drain nipple ${tag}`, mat: 'fixed', massLb: DRAIN_MASS_LB, kind: 'purchased',
        material: `${stainless(p)} drain nipple`, fab: 'buy', step: STEP.finish, axis: 'z', radius: r, length: 0.2,
        center: [x0 + pl + 1.5, sg * (yIn - 1.2), g.floorZ + 0.1],
        sourcing: { vendor: `McMaster-Carr (${stainless(p)} tube fitting, ⅜")`, costUsd: 5 },
        joints: [{ type: 'glue', to: g.deckFloor ? deckId : 'storage-bottom', count: 1, note: 'nipple epoxied into the hole so no cut ply edge is exposed' }],
        notes: g.deckFloor
          ? `${p.storageDrainDiaIn}" hole through the deck at the aft corner (the deck is the box floor), nipple epoxied in so no cut ply edge is exposed. Fair the sealed deck with microballoon-thickened epoxy (bought under this spec) to fall about 1/8" toward each drain so the box does not hold water.`
          : `${p.storageDrainDiaIn}" hole through the floor panel, nipple epoxied in so no cut ply edge is exposed.` }));
    }
  }
  // Lid hold-open stay (S5): the 75° stop leaves the lid free to fall closed, so a friction stay on the inboard face of the left hinge backer
  // (oak, so the screws bite) holds it at any angle.
  const extreme = p.weatherSpec === WEATHER_SPEC.extreme;
  const STAY_SIZE_FULL = extreme ? STAY_SIZE_EXTREME : STAY_SIZE_STD;
  // D-89 (round 2, fixed): the stay works in a vertical plane beside the LEFT side wall. Its base screws to a small oak block glued inside the left wall at the fore end (its inboard face
  // flush with the lid frame side's inboard face), its arm end to the inboard face of the left lid-frame side, about 4 in aft: the 3/4 in oak frame side takes the #8 x 5/8 in every thin-sheet
  // variant (a batten plus a 3 mm panel was too thin: the screw came through the lid top). The frame end is on the hinge line, so nothing mounts there.
  const STAY_ENDS_APART_IN = 4; // the folded stay's two mounts, about this far apart (verify the real stay)
  const blockT = Math.max(0.375, rimW - pl), blockL = 2.5, blockH = 1.5;
  const yWallIn = hw - pl, yFace = yWallIn - blockT; // the block's inboard face, flush with the frame side's inboard face (hw - rimW) at the defaults
  const backerYmax = Math.min(hingeY + HINGE_W_IN / 2, hw - coamW);
  const blockX1 = backerYmax < yFace - 0.05 ? x1 - pl : x1 - pl - HINGE_BACKER_IN - 0.25; // beside the left hinge backer, or aft of it when the backer reaches the side
  const blockX0 = Math.max(x0 + pl + 0.25, blockX1 - blockL);
  const blockFit = pickWoodScrew(8, LEAF_IN, blockT + pl); // the block and the box side it is glued to
  parts.push(box(ctx, { ...common, id: 'storage-stay-block', partNo: 'storage-stay-block', name: 'Lid support block', mat: 'oak', grain: 'x',
    ...span([blockX0, blockX1], [yFace, yWallIn], [zPlyTop - blockH, zPlyTop]),
    joints: [{ type: 'glue', to: 'storage-side-L', count: 1, note: 'thickened epoxy to the inside of the left box side, under the coaming lip' }],
    notes: `Oak block ${frac(blockT)}" × ${frac(blockH)}" × ${frac(blockX1 - blockX0)}" inside the left box side at the fore end, its top under the coaming: the lid support's base screws into it (D-89).` }));
  const armX = Math.max(x0 + rimW + 0.5, (blockX0 + blockX1) / 2 - STAY_ENDS_APART_IN);
  const STAY_SIZE = [Math.max(0.5, Math.min(STAY_SIZE_FULL[0], blockX1 - armX + 0.3)), STAY_SIZE_FULL[1], STAY_SIZE_FULL[2]] as const;
  const stayY1 = Math.min(hw - rimW, yFace), stayY0 = stayY1 - STAY_SIZE[1];
  const armTo = 'storage-rim-side-L';
  const stayRimFit = pickWoodScrew(8, LEAF_IN, rimW); // across the frame side, into its inboard face
  const stay = box(ctx, { ...common, id: 'storage-lid-stay', name: extreme ? 'Lid friction stay' : 'Lid support', mat: 'fixed', massLb: extreme ? STAY_MASS_EXTREME_LB : STAY_MASS_STD_LB, kind: 'purchased', material: extreme ? `${stainless(p)} friction stay` : 'plated steel lid support (Rockler 6" quiet-action)',
    fab: 'buy', step: STEP.finish, ...span([blockX1 - STAY_SIZE[0], blockX1], [stayY0, stayY1], [zPlyTop - STAY_SIZE[2], zPlyTop]),
    sourcing: extreme ? { vendor: `McMaster-Carr (${stainless(p)} friction lid stay / hold-open brace, 2" fold)`, costUsd: 18 } : { vendor: 'Rockler (quiet-action lid support, 6", plated steel; sold as a pair, #39529)', costUsd: 5 },
    joints: [{ type: 'screw', to: 'storage-stay-block', count: 2, diaIn: SCREW_DIA_IN[8], fit: blockFit, size: `${screwText(blockFit)} stainless, into the oak block on the left box side`, note: 'the stay base' }, { type: 'screw', to: armTo, count: 2, diaIn: SCREW_DIA_IN[8], fit: stayRimFit, size: `${screwText(stayRimFit)} stainless`, note: 'the stay arm end, into the inboard face of the left lid frame side' }],
    notes: extreme
      ? 'Holds the lid at any angle so a gust or a scout cannot close it on fingers (S5). Its base on the oak block inside the left box side, its arm end on the inboard face of the left lid frame side (D-89).'
      : 'D-83: a Rockler 6" quiet-action lid support (plated steel, the damped arm folds flat; the second of the pair is a spare), mounted INSIDE the box beside the left side wall: its base on the oak block glued inside the wall at the fore end, its arm end on the inboard face of the left lid frame side about 4" aft (D-89). It holds the lid open so a gust or a scout cannot close it on fingers (S5). VERIFY the real bracket holes and arm length against the packed items; plated steel is fine garage-kept, the Extreme spec keeps the stainless stay (D-83).' });
  // Each part records its own end of each joint on its own face, so every point lies in its part (D-75 geometry audit).
  {
    const baseJ = stay.joints!.find((j) => j.to === 'storage-stay-block')!;
    const blk = parts.find((q) => q.id === 'storage-stay-block')!;
    const bx = (blockX0 + blockX1) / 2, bz = zPlyTop - STAY_SIZE[2] / 2;
    const bpts = [-0.4, 0.4].map((dx): Vec3 => [bx + dx, yFace, bz]);
    baseJ.at = bpts.map((w) => localPoint(stay.transform, [w[0], stayY1, w[2]]));
    (blk.joints ??= []).push({ ...baseJ, to: 'storage-lid-stay', at: bpts.map((w) => localPoint(blk.transform, w)), note: 'the stay base, screwed into the block\'s inboard face' });
    // the arm-end screws go across the frame side into its inboard face, in a line along it, centered between its bottom face and the rabbet floor
    const zRimBot = zTop - pl - rimT, zArm = (zRimBot + (zTop - LID_RABBET_IN)) / 2;
    const apts = [-0.2, 0.2].map((dx): Vec3 => [armX + dx, hw - rimW, zArm]);
    const host = parts.find((q) => q.id === armTo)!;
    const armJoint = stay.joints!.find((j) => j.to === armTo)!;
    armJoint.at = apts.map((w) => localPoint(stay.transform, [w[0], stayY1, zPlyTop]));
    (host.joints ??= []).push({ ...armJoint, to: 'storage-lid-stay', at: apts.map((w) => localPoint(host.transform, w)), note: 'the stay arm end, screwed across into the inboard face of the frame side' });
  }
  parts.push(stay);

  // The lash points (D-rings) moved onto the heads of the side ribs (D-76, side-ribs.ts); the screwed lash doublers are gone.
  return parts;
}
