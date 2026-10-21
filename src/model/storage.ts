/**
 * Storage box (D-19, D-41, D-41r2): a weatherproof ply tray (walls tape-and-folded at the corners and filleted to the deck, which is the
 * floor; the box has its own ply floor only when it is raised clear of the deck), oak coaming on the wall tops (the gasket seals on oak),
 * a hinged, gasketed lid
 * (oak frame capturing a ply panel, oak battens) behind a fixed oak strip across the fore end of the box top: two butt hinges lie on top of the
 * joint between the strip and the lid (D-89), so the lid opens up and aft, past upright, and rests on the upright seat back; two oak turn-buttons
 * on the transom hold it shut; two drains. (The lash points are on the side ribs, D-76: side-ribs.ts.)
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
const DRAIN_MASS_LB = 0.03;
const GASKET_LB_PER_IN = 0.002;
/** The 3/8" epoxy fillet in every inside corner of the box (flat things stowed in it ride on it, not in the corner). */
export const BOX_FILLET_IN = 0.375;
/** D-89 (round 3): the lid turn-buttons and their blocks (the draw latches are gone): button thickness, width and reach over the lid rail, the block's width and height, and the nylon washer under the pivot screw's head. */
const TURN_BUTTON_T_IN = 0.5;
const TURN_BUTTON_W_IN = 0.75;
const TURN_BUTTON_REACH_IN = 0.5;
const TURN_BLOCK_W_IN = 1.5;
const TURN_BLOCK_H_IN = 1.5;
const NYLON_WASHER_IN = 1 / 16;
const BATTEN_X_IN = 1;
/** D-89: the fixed strip's top thickness over its underside groove (between the hinge leg and the fore leg), and the hinge pin's height above the lid top (the leaves lie flat on top). */
const STRIP_TOP_IN = 0.375;
const HINGE_PIN_ABOVE_IN = 1 / 16;
/** The lid swing check keeps this clear of the upright seat back (D-89). */
export const LID_SWING_CLEAR_IN = 0.125;
/** A butt hinge leaf (the model's 316 hinges). */
const LEAF_IN = 1 / 16;
/** D-89: a stick-on rubber bumper on the strip top, as tall as the two hinge leaves stacked when the hinge folds shut, so the lid folded right over (seat back flat) lies on it and the strip, not on the hinges. */
const BUMPER_DIA_IN = 0.5;
const BUMPER_H_IN = 2 * LEAF_IN;
const BUMPER_SET_IN = 0.5;
const BUMPER_MASS_LB = 0.002;
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
  /** D-89: the fixed strip across the fore end of the box top runs from `xh` (its aft face, the hinge side) to x1; the lid runs from x0 to `lidX1`, a gasket's width aft of it. */
  xh: number;
  lidX1: number;
}

export function storageGeometry(p: Params, L: Layout): StorageGeometry {
  const st = L.storage;
  const sup = seatBackSupport(p, L);
  const pl = thinSheet(p).thicknessIn;
  const rimW = p.storageLidRimWidthIn;
  // D-89, D-72: the lid frame is at least 11/16 in deep (panel + rim), so the #8 x 5/8 lid-hinge screw driven down through a 1/16 in leaf stops 1/16 in short of its underside (the 3 mm panel option).
  const rimT = Math.max(p.storageLidRimThickIn, 11 / 16 - pl);
  const gasket = p.storageGasketIn;
  const zTop = sup.boxZTop;
  const coamT = p.storageCoamingThickIn;
  const zWallTop = zTop - pl - rimT - gasket;
  // The box stands on the deck (rear and under-seat): the epoxy-sealed deck is the floor (round 2: the redundant floor panel is gone).
  const deckFloor = Math.abs(st.zBot - L.deckTop) < 0.01;
  const x0 = st.x0, x1 = Math.max(st.x0 + 0.5, sup.boxX1);
  // D-89: the strip is at least its hinge leg plus its fore leg wide, and leaves at least 4 in of lid.
  const strip = Math.max(rimW + p.storageCoamingWidthIn + 0.25, Math.min(p.storageLidStripIn, x1 - x0 - 4));
  const xh = x1 - strip;
  return {
    x0, x1, hw: st.hw, zBot: st.zBot, zTop,
    zWallTop, zPlyTop: zWallTop - coamT, coamT, coamW: p.storageCoamingWidthIn, deckFloor,
    pl, rimW, rimT, gasket, floorZ: deckFloor ? st.zBot : st.zBot + pl, lidUnderZ: zTop - pl,
    xh, lidX1: xh - gasket,
  };
}

/** Shortest distance between two closed polygons in the side view (0 when they cross). */
function polyGap(a: Array<[number, number]>, b: Array<[number, number]>): number {
  const segD = (p: [number, number], q: [number, number], r: [number, number]): number => {
    const dx = r[0] - q[0], dz = r[1] - q[1], l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dz) / l2)) : 0;
    return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dz);
  };
  const inside = (p: [number, number], poly: Array<[number, number]>): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  if (a.some((q) => inside(q, b)) || b.some((q) => inside(q, a))) return 0;
  let m = Infinity;
  for (const [P, Q] of [[a, b], [b, a]] as const) for (const q of P) for (let i = 0; i < Q.length; i++) m = Math.min(m, segD(q, Q[i], Q[(i + 1) % Q.length]));
  return m;
}

/**
 * D-89: how far the lid opens (degrees from shut) about its hinge pin before it comes within `LID_SWING_CLEAR_IN` of the upright seat back (side view, the panel's
 * section). 180 when no seat back stands over the box (an under-seat box). Past 90 the lid leans on the back.
 */
export function lidOpenAngleDeg(p: Params, L: Layout): number {
  const g = storageGeometry(p, L);
  const sup = seatBackSupport(p, L);
  if (!sup.rear) return 180;
  const s = L.seat;
  const at = (a: number, b: number): [number, number] => [s.Pr[0] + s.col0[0] * a + s.col2[0] * b, s.Pr[2] + s.col0[2] * a + s.col2[2] * b];
  const panel = [at(0, 0), at(sup.t, 0), at(sup.t, sup.H), at(0, sup.H)];
  const pin: [number, number] = [(g.lidX1 + g.xh) / 2, g.zTop + HINGE_PIN_ABOVE_IN];
  const zLidBot = g.zTop - g.pl - g.rimT;
  const lid: Array<[number, number]> = [[g.x0, zLidBot], [g.lidX1, zLidBot], [g.lidX1, g.zTop], [g.x0, g.zTop]];
  for (let d = 0; d <= 180; d += 0.25) {
    const th = (d * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const rot = lid.map(([x, z]): [number, number] => { const dx = x - pin[0], dz = z - pin[1]; return [pin[0] + dx * c + dz * sn, pin[1] - dx * sn + dz * c]; });
    if (polyGap(rot, panel) < LID_SWING_CLEAR_IN) return Math.max(0, d - 0.25);
  }
  return 180;
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
    + Math.max(0, g.lidX1 - g.x0 - 2 * g.rimW) * Math.max(0, w - 2 * lip) * (g.rimT + g.gasket); // D-89: the lid zone stops at the lid's fore frame (the fixed strip's groove is not counted)
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
  const { x0, x1, hw, pl, rimW, rimT, zBot, zTop, zWallTop, zPlyTop, coamW, xh, lidX1 } = g;
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
    parts.push(box(ctx, { ...common, id: `storage-side-${tag}`, partNo: 'storage-side', name: `Storage box side ${tag}`, mat: 'ply', thin: true, edges: 'captured', fab: 'table-saw',
      ...span([x0, x1], [y - pl / 2, y + pl / 2], [zBot, zPlyTop]),
      joints: [miter('storage-end-aft'), miter('storage-end-fore'), ...deckJoint(), { type: 'glue', to: `storage-coaming-side-${tag}`, count: 1, note: 'oak coaming caps the wall top, epoxy' }],
      notes: 'Wall top is capped by the oak coaming so no ply edge is exposed under the gasket (S4).' }));
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + pl], ['fore', x1 - pl, x1]] as const) {
    parts.push(box(ctx, { ...common, id: `storage-end-${tag}`, partNo: 'storage-end', name: `Storage box ${tag} end`, mat: 'ply', thin: true, edges: 'captured', fab: 'table-saw',
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
  parts.push(box(ctx, { ...common, id: 'storage-lid', name: 'Storage lid panel', mat: 'ply', thin: true, edges: 'captured', fab: 'table-saw',
    ...span([x0 + rimW, lidX1 - rimW], [-(hw - rimW), hw - rimW], [zTop - pl, zTop]),
    stock: { t: pl, w: 2 * (hw - rimW) + 0.5, l: lidX1 - x0 - 2 * rimW + 0.5 },
    joints: ['storage-rim-side-L', 'storage-rim-side-R', 'storage-rim-end-aft', 'storage-rim-end-fore'].map((to): Joint => ({
      type: 'rabbet', to, count: 1, size: '1/4 deep × 1/4', note: 'panel captured in the frame (cut size includes the tongue); epoxy-sealed',
    })),
    // D-89: the letters shrink to fit a shorter lid (11 letters at 3/4 of their height each, 1/2 in margin), never over 1-1/2 in
    legend: { text: 'DO NOT STEP', face: 'top', process: 'CNC V-carve or laser engrave, then fill with black epoxy or paint', letterHeightIn: Math.max(0.5, Math.min(1.5, Math.floor(((lidX1 - x0 - 2 * rimW - 0.5) / (11 * 0.75)) * 8) / 8)), depthIn: 0.03 },
    notes: 'Ply lid panel captured in the oak frame; the frame underside seals on the gasket. The top face is engraved DO NOT STEP (D-58, Eric 2026-10-11): the lid is a seat-cushion box lid, not a step, and is NOT strengthened for a standing adult; the rest-load check leaves it out for that reason.' }));
  const rz: [number, number] = [zTop - pl - rimT, zTop];
  // Round 2: the corner mortise is centered low enough to stay 1/16 in under the rabbet floor (centered on the frame it broke into the rabbet wall).
  const zMid = Math.min((rz[0] + rz[1]) / 2, rz[1] - LID_RABBET_IN - tenT / 2 - 1 / 16);
  const cornerPts = (xs: number, ys: number): { side: Vec3; end: Vec3 } => ({ side: [xs, ys, zMid], end: [xs, ys, zMid] });
  for (const [tag, y] of [['L', hw - rimW / 2], ['R', -(hw - rimW / 2)]] as const) {
    const sideP = box(ctx, { ...common, id: `storage-rim-side-${tag}`, partNo: 'storage-rim-side', name: `Storage lid frame side ${tag}`, mat: 'oak', grain: 'x',
      ...span([x0, lidX1], [y - rimW / 2, y + rimW / 2], rz) });
    const yFace = Math.sign(y) * (hw - rimW); // the side's inner face
    sideP.joints = (['aft', 'fore'] as const).map((e) => lidTenon(`storage-rim-end-${e}`, [localPoint(sideP.transform, cornerPts(e === 'aft' ? x0 + rimW / 2 : lidX1 - rimW / 2, yFace).side)], 'the mortise is in the inner face of this side'));
    parts.push(sideP);
  }
  for (const [tag, xa, xb] of [['aft', x0, x0 + rimW], ['fore', lidX1 - rimW, lidX1]] as const) {
    const endP = box(ctx, { ...common, id: `storage-rim-end-${tag}`, partNo: 'storage-rim-end', name: `Storage lid frame ${tag} end`, mat: 'oak', grain: 'y',
      ...span([xa, xb], [-(hw - rimW), hw - rimW], rz) });
    endP.joints = (['L', 'R'] as const).map((sd) => lidTenon(`storage-rim-side-${sd}`, [localPoint(endP.transform, cornerPts((xa + xb) / 2, (sd === 'L' ? 1 : -1) * (hw - rimW)).end)], 'the mortise is in the end grain of this piece'));
    parts.push(endP);
  }
  const inner = lidX1 - x0 - 2 * rimW;
  // D-53: three battens once the lid is long enough, so three sit under the rated item's footprint and the lid carries a light cooler (lid-load row).
  // D-89: the shorter lid behind the fixed strip keeps all three (two would each take half the item and fail the lid-load row).
  const nBatten = inner >= 9 ? 3 : inner >= 6 ? 2 : inner >= 4 ? 1 : 0;
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
      massLb: GASKET_LB_PER_IN * (lidX1 - x0), ...span([x0, lidX1], [y - pl / 2, y + pl / 2], gz), notes: 'Compresses 25% under the frame; no gap at the miters (continuous strip, spliced at a corner).' }));
  }
  parts.push(box(ctx, { ...gasketSpec, id: 'storage-gasket-end-aft', partNo: 'storage-gasket-end', name: 'Lid gasket aft end',
    massLb: GASKET_LB_PER_IN * 2 * yIn, ...span([x0, x0 + pl], [-yIn, yIn], gz) }));
  // D-89: across the front the gasket stands on the fixed strip's aft face, between it and the lid frame's fore face (the lid closes onto it about the hinge pin above).
  parts.push(box(ctx, { ...gasketSpec, id: 'storage-gasket-end-fore', partNo: 'storage-gasket-end', name: 'Lid gasket fore end (on the strip)',
    massLb: GASKET_LB_PER_IN * 2 * hw, ...span([lidX1, xh], [-hw, hw], [gz[1], zTop - 0.125]),
    notes: 'On the aft face of the fixed strip, its top 1/8" below the lid top (the hinge knuckles sit over the joint): the lid frame\'s fore face closes onto it.' }));

  // ── D-89: the fixed strip across the fore end of the box top. One oak board as deep as the lid stands over the coaming, its underside grooved between a hinge leg
  // (aft, the lid frame's width, under the hinge leaves) and a fore leg (on the fore coaming), so it is a stiff U across the box at about two-thirds of the solid board's mass.
  // Two oak end blocks fill the groove where the board sits on the side coamings, so the box stays closed at its sides. Glued (thickened epoxy) to all three coamings. ──
  {
    const zg = zTop - STRIP_TOP_IN;
    const outline: Array<[number, number]> = [[xh, zWallTop], [xh + rimW, zWallTop], [xh + rimW, zg], [x1 - coamW, zg], [x1 - coamW, zWallTop], [x1, zWallTop], [x1, zTop], [xh, zTop]];
    parts.push(profilePart(ctx, { ...common, id: 'storage-strip', partNo: 'storage-strip', name: 'Storage box fixed strip', mat: 'oak', grain: 'z', fab: 'table-saw',
      outline, depth: 2 * hw, basis: 'xz', origin: [0, hw, 0], stock: { t: zTop - zWallTop, w: x1 - xh, l: 2 * hw },
      joints: [
        { type: 'glue', to: 'storage-coaming-end-fore', count: 1, note: 'thickened epoxy, its fore leg on the fore coaming' },
        { type: 'glue', to: 'storage-coaming-side-L', count: 1, note: 'thickened epoxy, its ends on the side coamings' },
        { type: 'glue', to: 'storage-coaming-side-R', count: 1, note: 'thickened epoxy, its ends on the side coamings' },
      ],
      notes: `D-89: oak ${frac(zTop - zWallTop)}" thick, ${frac(x1 - xh)}" wide (fore-aft) and the full ${frac(2 * hw)}" width of the box, its top flush with the lid top. Its underside is grooved ${frac(zg - zWallTop)}" deep between a ${frac(rimW)}" hinge leg (aft: the hinges' fixed leaves screw into it) and a ${frac(coamW)}" fore leg on the fore coaming, end to end (table saw, several passes); the end blocks fill the groove over the side coamings. The lid is hinged on its aft edge, so the lid is shorter and opens past upright onto the seat back.` }));
    for (const { s: sg, tag } of SIDES) {
      parts.push(box(ctx, { ...common, id: `storage-strip-end-${tag}`, partNo: 'storage-strip-end', name: `Strip end block ${tag}`, mat: 'oak', grain: 'x',
        ...span([xh + rimW, x1 - coamW], sg > 0 ? [hw - coamW, hw] : [-hw, -(hw - coamW)], [zWallTop, zg]),
        joints: [{ type: 'glue', to: 'storage-strip', count: 1, note: 'thickened epoxy into the end of the groove' }, { type: 'glue', to: `storage-coaming-side-${tag}`, count: 1, note: 'thickened epoxy on the side coaming' }],
        notes: `Oak filler ${frac(x1 - coamW - xh - rimW)}" × ${frac(coamW)}" × ${frac(zg - zWallTop)}" at the end of the strip's groove, over the side coaming, so the box is closed at its side (D-89).` }));
    }
  }

  // ── Hinges (fore edge, so the lid opens up and aft; the removable back is aft-leaning over the lid) and latches ──
  // Outboard of the stiles when there is room, else between them; the stiles lean over the lid just behind the hinges.
  const outY = sup.W / 2 + 0.75 + HINGE_W_IN / 2;
  const inY = sup.W / 2 - sup.fw - 0.75 - HINGE_W_IN / 2;
  const hingeY = !sup.rear || outY <= hw - HINGE_W_IN / 2 - 0.25 ? Math.min(outY, hw - HINGE_W_IN / 2 - 0.25) : Math.max(inY, HINGE_W_IN / 2);
  // D-89: the hinges lie flat on top of the joint between the fixed strip and the lid, the pin over the gasket gap, so the lid swings up and aft about it and its fore face
  // moves away from the strip. #8 x 5/8 (D-72) into the lid frame's fore end and into the strip's hinge leg, both oak.
  const rear = p.storageLocation === STORAGE_LOCATION.rearOverAxle;
  const hingeRimFit = pickWoodScrew(8, LEAF_IN, pl + rimT);
  const hingeStripFit = pickWoodScrew(8, LEAF_IN, zTop - zWallTop);
  const hingeMid = (lidX1 + xh) / 2;
  for (const { s: sg, tag } of SIDES) {
    // An under-seat box has the seat cushion on its lid: no hinges there (the cushion holds the lid; it lifts off, a known gap, D-89).
    if (rear) parts.push(box(ctx, { ...common, id: `storage-hinge-${tag}`, partNo: 'storage-hinge', name: `Lid hinge ${tag}`, mat: 'fixed', massLb: HINGE_MASS_LB,
      kind: 'purchased', material: `${stainless(p)} butt hinge`, fab: 'buy', step: STEP.seatStorage, ...span([hingeMid - HINGE_H_IN / 2, hingeMid + HINGE_H_IN / 2], [sg * hingeY - HINGE_W_IN / 2, sg * hingeY + HINGE_W_IN / 2], [zTop, zTop + 2 * HINGE_PIN_ABOVE_IN]),
      sourcing: { vendor: `McMaster-Carr (${stainless(p)} surface-mount butt hinge, 2½" × 1½" open, ¾" leaves)`, costUsd: 9 },
      joints: [{ type: 'screw', to: 'storage-rim-end-fore', count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeRimFit, size: `${screwText(hingeRimFit)} stainless, down into the top of the lid frame's fore end` }, { type: 'screw', to: 'storage-strip', count: 3, diaIn: SCREW_DIA_IN[8], fit: hingeStripFit, size: `${screwText(hingeStripFit)} stainless, down into the top of the strip's hinge leg` }],
      notes: 'D-89: lies flat on top of the joint between the fixed strip and the lid, the knuckle over the gasket gap (ease both top edges at the joint so it beds down). The lid swings up and aft about it, past upright, and rests on the upright seat back; with the back flipped flat it folds right over and lies open on the strip\'s bumpers.' }));
    // D-89: with the back flipped flat the lid folds right over; folded shut the two leaves hold it a leaf stack above the strip, so a bumper that tall near the strip's fore
    // edge, under each lid frame side, takes the lid's weight on the strip instead of prying on the 3/4" leaves.
    if (rear) parts.push(cylinder(ctx, { ...common, id: `storage-bumper-${tag}`, partNo: 'storage-bumper', name: `Lid rest bumper ${tag}`, mat: 'fixed', massLb: BUMPER_MASS_LB,
      kind: 'purchased', material: 'self-stick rubber bumper', fab: 'buy', step: STEP.finish, axis: 'z', radius: BUMPER_DIA_IN / 2, length: BUMPER_H_IN,
      center: [x1 - BUMPER_SET_IN, sg * (hw - rimW / 2), zTop + BUMPER_H_IN / 2],
      sourcing: { vendor: `Clear self-stick rubber bumper, ${frac(BUMPER_DIA_IN)}" round × ${frac(BUMPER_H_IN)}" tall (a hardware-store pack of them, about $4; two used)`, costUsd: 2 },
      notes: `Stuck on the strip top, its center ${frac(BUMPER_SET_IN)}" in from the strip's front edge and over the lid frame side. With the seat back flipped flat the lid folds right over and lies open on the two bumpers: as tall as the two hinge leaves folded together, so the strip carries the lid, not the hinges (D-89).` }));
    // D-89 (round 3): an oak TURN-BUTTON per side instead of a draw latch (the latch had 1/32 in for its lever in a closed 3/4 in well under the transom). Each button pivots on one
    // #8 screw (a nylon washer under the head) driven down into the top of an oak block whose top is level with the lid top: on a rear box the block fills the rear lane between
    // the transom and the aft wall, glued to the transom's inner face. Turned along the sled, the button reaches over the lid
    // frame's aft rail; a slight cam on its underside pulls the lid down onto the gasket. Turned across, it clears the lid. (Rear box only.)
    // Buttons sit at 8.5" off center, clear of the rear lamp clip in the hand-hold (|y| < 2.25, D-64) on the same transom.
    if (rear) { // an under-seat box has the seat cushion and back on and around its lid: no turn-buttons there (the cushion holds the lid; a known gap, D-89)
    const ly = sg * Math.min(hw - 3, 8.5);
    const xTi = L.xRear + L.transom;
    const blockX: [number, number] = [xTi, x0];
    const blockZ: [number, number] = [zTop - TURN_BLOCK_H_IN, zTop];
    const buttonFit = pickWoodScrew(8, TURN_BUTTON_T_IN + NYLON_WASHER_IN, blockZ[1] - blockZ[0]);
    const blockId = `storage-turn-block-${tag}`;
    const xc = (blockX[0] + blockX[1]) / 2;
    parts.push(box(ctx, { ...common, id: blockId, partNo: 'storage-turn-block', name: `Turn-button block ${tag}`, mat: 'oak', grain: 'y',
      ...span(blockX, [ly - TURN_BLOCK_W_IN / 2, ly + TURN_BLOCK_W_IN / 2], blockZ),
      joints: [{ type: 'glue', to: 'transom-rear', count: 1, note: 'thickened epoxy to the inside face of the rear transom (it fills the lane behind the box)' }],
      notes: `Oak block ${frac(blockX[1] - blockX[0])}" × ${frac(TURN_BLOCK_W_IN)}" × ${frac(TURN_BLOCK_H_IN)}" (grain across the sled, so the pivot screw bites side grain), its top level with the lid top: the turn-button's pivot screw goes down into it (D-89).` }));
    parts.push(box(ctx, { ...common, id: `storage-turn-button-${tag}`, partNo: 'storage-turn-button', name: `Lid turn-button ${tag}`, mat: 'oak', grain: 'x', step: STEP.finish, fab: 'bandsaw',
      ...span([blockX[0], x0 + TURN_BUTTON_REACH_IN], [ly - TURN_BUTTON_W_IN / 2, ly + TURN_BUTTON_W_IN / 2], [zTop, zTop + TURN_BUTTON_T_IN]),
      joints: [{ type: 'screw', to: blockId, count: 1, diaIn: SCREW_DIA_IN[8], fit: buttonFit, at: [[xc - (blockX[0] + x0 + TURN_BUTTON_REACH_IN) / 2, 0, -TURN_BUTTON_T_IN / 2]], // on the button's underside, the block top
        size: `${screwText(buttonFit)} stainless, the pivot: down through the button and a nylon washer into the block (snug, so the button turns stiffly)` }],
      notes: `Oak turn-button ${frac(TURN_BUTTON_T_IN)}" × ${frac(TURN_BUTTON_W_IN)}" × ${frac(x0 + TURN_BUTTON_REACH_IN - blockX[0])}", from an offcut, pivoting on one #8 screw over the block. Turned along the sled it reaches ${frac(TURN_BUTTON_REACH_IN)}" over the lid frame's aft rail; plane a slight cam (about 1/32") on its underside so turning it pulls the lid down onto the gasket. Turned across the sled it clears the lid (D-89).` }));
    }
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
  // D-89: no lid stay: the lid opens past upright and rests on the upright seat back (lidOpenAngleDeg).
  // The lash points (D-rings) moved onto the heads of the side ribs (D-76, side-ribs.ts); the screwed lash doublers are gone.
  return parts;
}
