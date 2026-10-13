/**
 * Phase 4 output 7: finishing schedule (right-sized for a snow sled kept in a garage, not a boat; Eric, 2026-10-12).
 *
 * Areas (ft²) come from the part geometry (box, extrusion, sweep, mesh), by material: white oak and okoume plywood. Purchased, metal, printed
 * and rubber parts are excluded. NO gross areas: each glued lamination contact (`glueJointEstimates`: the bands on the webs, the deck on the
 * rails and joists, the backers, the hangers) is taken off BOTH parts, and what is left is split into SHOW faces (sun, weather, wear) and
 * HIDDEN faces (frame, joists, backers, blocks, the deck underside, the inside of the box, the web inside the hull below the deck) by the
 * per-part table `SHOW_RULES`.
 *
 * Two weather specs (D-73, Eric 2026-10-12: garage-kept, used a few times a year, wet at most at a rainy derby; the Extreme spec is stored outside or near salt).
 *   EXTREME: ONE saturation coat of 105 / 206 (5:1) on all the plywood (show and hidden) and on the oak end grain; marine spar varnish, 3 coats on the show faces, 2 on the
 *   hidden ones, over the oak and the epoxy, bought in quarts (an open can skins over); epoxy for every glue joint.
 *   STANDARD (the default): epoxy only on the plywood edges that are not captured, the oak end grain and the deck underside (water pools there); exterior spar urethane
 *   (Minwax Helmsman class), 3 coats show, 2 hidden; Titebond III for the Dominos, dados, tenons and general glue joints, epoxy only where it earns its keep
 *   (`standardAdhesive`: the bent laminations, the deck to the frame, the deck slot gap-fill, the fillets and tape, the thickened bedding, the D-70 face laminations).
 * Stain and conditioner: show faces only, one coat. White oak plywood takes the SAME stain as the solid oak (no conditioner or gel); okoume and Baltic birch blotch and take a conditioner
 * (Standard) or a conditioner and gel stain (Extreme). ONE hardener, 206 slow, for the glue-ups, the seal coat and the two long closes (207 is a listed option).
 *
 * `glueEpoxyFlOz` estimates the epoxy the glue joints themselves use, by joint type. The schedule's `epoxy` summary adds it to the seal coat.
 */
import { localBounds, worldAABB } from '../model/bounds';
import { HULL_STEP } from '../model/build-utils';
import { boardForThickness, planLamination } from './cutlist';
import type { Geometry, Part, Vec2 } from '../model/types';
import type { Instr } from './assembly';
import { thinSheet, THIN_SHEET, WEATHER_SPEC, type Params } from '../params';

// ---- constants (process facts, not design numbers; coverage figures are published label / WEST System values) ----

/** Waste on top of the computed quantity (brush loss, pot leftovers, the test panels). */
export const FINISH_WASTE = 0.15;
/** Waste on the glue-joint epoxy (mixing and pot leftovers); the BOM applies the same 20 % (bom.ts EPOXY_WASTE). */
export const GLUE_WASTE = 0.2;
/** Epoxy soaks into end grain about twice as fast as into face grain. */
export const END_GRAIN_FACTOR = 2;
/** 105 resin : 206 slow hardener = 5 : 1 by volume. ONE hardener for everything: the glue-ups, the seal coat and the two long closes (the closes in small batches). */
export const EPOXY_RESIN_PARTS = 5;
/**
 * ft² per US quart of MIXED epoxy, ONE saturation coat on porous wood and plywood. WEST System's published coating-quantity table
 * (https://www.westsystem.com/coating-quantity/): a gallon-size kit of 105-B + 207 (about 1.3 gal mixed) covers 370-430 ft² as a saturation coat on porous surfaces,
 * and 105 with 205 / 206 (1.2 gal mixed) covers 350-405 ft². The midpoint for 206 is 377.5 ft² ÷ 4.8 qt = 78.6, used as 78 ft² per mixed quart. West's rule of
 * thumb for a sealer coat agrees: about 40 ft² per lb of mixed epoxy (a mixed quart weighs about 2.3 lb, so about 92 ft²/qt), so 78 is on the careful side.
 */
export const EPOXY_COVERAGE = 78;
/** Typical label coverage, ft² per quart, one coat. */
export const STAIN_COVERAGE = 150;
export const CONDITIONER_COVERAGE = 125;
export const GEL_STAIN_COVERAGE = 125;
/**
 * ft² per US quart of spar varnish, thin brushed coats. Epifanes is listed at 14 m²/L (https://www.flints.co.uk), which is 14 × 0.946 × 10.76 = 142 ft² per quart;
 * 140 is used. The first coat is thinned 10-15 % (it sinks into the oak and the epoxy tooth), which stretches it a little further; not counted.
 */
export const VARNISH_COVERAGE = 140;
/** Varnish coats: 3 on the faces that take sun, weather and wear, 2 on the faces nobody sees. */
export const VARNISH_COATS_SHOW = 3;
export const VARNISH_COATS_HIDDEN = 2;
/**
 * ft² per US quart of exterior spar urethane (Standard): the can's rating, about 100 ft² per quart (Minwax Helmsman, docs/price-research-standard-2026-10.md), thin brushed coats.
 * The marine varnish of the Extreme spec covers 140 (VARNISH_COVERAGE).
 */
export const URETHANE_COVERAGE = 100;
/** US fluid ounces per quart. */
const FLOZ_PER_QT = 32;
/** Letter fill: black-tinted epoxy or paint, a fraction of a pint. */
const ENGRAVE_FILL_PT = 0.5;

/** Solid white oak, okoume marine plywood, white oak plywood (D-73: NOT okoume), Baltic birch plywood. */
export type FinishMaterial = 'oak' | 'okoume' | 'oakPly' | 'birch';

/** An area split by material, ft². `plyFt2` is every plywood (okoume + white oak ply + birch). */
export interface AreaSplit {
  oakFt2: number;
  okoumeFt2: number;
  oakPlyFt2: number;
  birchFt2: number;
  plyFt2: number;
  totalFt2: number;
}

/** One part's areas, ft²: gross = every face and edge; glued = lamination contacts taken off; net = gross - glued = show + hidden. */
export interface PartFinishArea {
  material: FinishMaterial;
  grossFt2: number;
  gluedFt2: number;
  netFt2: number;
  showFt2: number;
  hiddenFt2: number;
  /** Show fraction used (0-1) and the rule that gave it. */
  showFraction: number;
  rule: string;
}

export interface FinishAreas {
  /** NET surface of the white-oak parts to be finished (gross less the glued contacts), ft². */
  oakFt2: number;
  /** NET surface of the okoume plywood parts (both faces and all edges, less the glued contacts), ft². */
  okoumeFt2: number;
  /** The same for the white oak plywood parts and for the Baltic birch parts (D-73: the thin sheet may be either), and for all plywood together. */
  oakPlyFt2: number;
  birchFt2: number;
  plyFt2: number;
  /** End-grain area of the oak parts (estimate from the grain axis), ft². Not reduced by glue. */
  oakEndGrainFt2: number;
  /** Net oak + okoume, ft². */
  totalFt2: number;
  /** Every face and edge of every wood part, glued faces included. */
  gross: AreaSplit;
  /** Glued lamination contacts, taken off BOTH mating parts. */
  glued: AreaSplit;
  /** Net faces that take sun, weather and wear (see SHOW_RULES). */
  show: AreaSplit;
  /** Net faces nobody sees (the frame, the deck underside, backers, the inside of the box). */
  hidden: AreaSplit;
  /** Per part id, GROSS ft² (wood parts only). */
  byPart: Record<string, number>;
  /** Per part id: gross, glued, net, show and hidden. */
  detail: Record<string, PartFinishArea>;
}

export interface FinishProduct {
  name: string;
  /** Surface the product goes on, ft². */
  areaFt2: number;
  coats: number;
  /** Typical coverage, ft² per quart (of mixed epoxy for the epoxy), one coat. */
  coverageFt2PerQt: number;
  /** Quarts needed, including waste. */
  qtNeeded: number;
}

export interface FinishStep {
  n: number;
  id: string;
  title: string;
  /** The instructions: short actions with sub-bullets (the same shape as the assembly steps' `items`). */
  items: Instr[];
  /** `items` flattened (sub-items as "– " lines), for readers that do not know `items` yet. */
  instructions: string[];
  products: FinishProduct[];
  coats: number;
  recoat: string;
  cure: string;
  /** Temperature notes for the winter shop. */
  winter: string;
}

export interface BuyLine {
  item: string;
  /** Container: 'gal' | 'qt' | 'pt'. */
  unit: 'gal' | 'qt' | 'pt';
  qty: number;
  /** Quarts the containers add up to. */
  qt: number;
  note: string;
}

/** A counted item (pumps) that is not sold by the pint, quart or gallon. */
export interface SupplyLine {
  item: string;
  qty: number;
  unit: 'ea';
  note: string;
}

/** All the epoxy of the build in one place, 105 resin + 206 slow hardener at 5:1 by volume, fl oz. The BOM chooses its kits from `resinFlOz`. */
export interface EpoxySummary {
  /** The one saturation coat (okoume + oak end grain), 15 % waste included. */
  coatingFlOz: number;
  /** The glue joints (`glueEpoxyFlOz`), 20 % waste included. */
  glueFlOz: number;
  /** Of the glue joints, the transom and bulkhead closes (no waste; informational, already inside glueFlOz). */
  closeGlueFlOz: number;
  /** coating + glue: the mixed epoxy to make. */
  totalMixedFlOz: number;
  /** Resin and hardener of the total, at EPOXY_RESIN_PARTS : 1. */
  resinFlOz: number;
  hardenerFlOz: number;
}

/** The glue side of the weather spec: the Titebond III the Standard spec uses, the Standard epoxy coat's areas, and the rule in words. */
export interface GlueSummary {
  /** Titebond III to buy for, fl oz, +20 % waste (0 under the Extreme spec). */
  titebondFlOz: number;
  /** Glue joints that are Titebond (count, with the repeats). */
  titebondJoints: number;
  /** Plywood edge area left exposed in the model (ft²) and the deck underside (ft²): the Standard epoxy coat's plywood areas. */
  epoxyEdgeFt2: number;
  deckUnderFt2: number;
  adhesiveRule: string;
}

export interface FinishSchedule {
  /** The weather spec this schedule was made for (D-73). */
  spec: 'standard' | 'extreme';
  /** Glue and coat summary of the weather spec. */
  glue: GlueSummary;
  areas: FinishAreas;
  steps: FinishStep[];
  buy: BuyLine[];
  /** Counted supplies for the epoxy. Empty now: no 303 pumps (one 5:1 hardener); the 301 pumps of the 105/206 kit are added by the BOM. */
  supplies: SupplyLine[];
  /** Kept for the BOM's field: 0, because the closes use 206 like every glue-up and their epoxy is inside `glueEpoxyFlOz` (see `epoxy.closeGlueFlOz`). */
  closeEpoxyFlOz: number;
  epoxy: EpoxySummary;
  assumptions: string[];
}

// ---- geometry ----

function polyArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polyPerimeter(pts: Vec2[]): number {
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    l += Math.hypot(x2 - x1, y2 - y1);
  }
  return l;
}

/** Surface area of a geometry, in². Box: 2(ab+bc+ca). Extrusion: 2 × outline area (less the holes) + perimeter × depth. Mesh: sum of triangle areas. */
export function surfaceAreaIn2(g: Geometry): number {
  switch (g.type) {
    case 'box': {
      const [a, b, c] = g.size;
      return 2 * (a * b + b * c + c * a);
    }
    case 'cylinder': {
      const r = g.radius;
      if (g.wall && g.wall > 0) {
        const ri = Math.max(0, r - g.wall);
        return 2 * Math.PI * (r + ri) * g.length + 2 * Math.PI * (r * r - ri * ri);
      }
      return 2 * Math.PI * r * g.length + 2 * Math.PI * r * r;
    }
    case 'extrusion': {
      const holes = g.holes ?? [];
      const area = polyArea(g.outline) - holes.reduce((s, h) => s + polyArea(h), 0);
      const perim = polyPerimeter(g.outline) + holes.reduce((s, h) => s + polyPerimeter(h), 0);
      return 2 * area + perim * g.depth;
    }
    case 'sweep': {
      let len = 0;
      for (let i = 1; i < g.path.length; i++) len += Math.hypot(g.path[i][0] - g.path[i - 1][0], g.path[i][1] - g.path[i - 1][1]);
      return 2 * len * (g.width + g.thickness) + 2 * g.width * g.thickness;
    }
    case 'mesh': {
      const P = g.positions;
      const idx = g.indices;
      const n = idx ? idx.length : P.length / 3;
      let area = 0;
      for (let t = 0; t + 2 < n; t += 3) {
        const ia = (idx ? idx[t] : t) * 3;
        const ib = (idx ? idx[t + 1] : t + 1) * 3;
        const ic = (idx ? idx[t + 2] : t + 2) * 3;
        const ux = P[ib] - P[ia], uy = P[ib + 1] - P[ia + 1], uz = P[ib + 2] - P[ia + 2];
        const vx = P[ic] - P[ia], vy = P[ic + 1] - P[ia + 1], vz = P[ic + 2] - P[ia + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        area += 0.5 * Math.hypot(cx, cy, cz);
      }
      return area;
    }
    case 'wheel': {
      const r = g.diameter / 2;
      return 2 * Math.PI * r * g.width + 2 * Math.PI * r * r;
    }
  }
}

/** Estimated end-grain area (both ends) of a wood part, in²: the cross-section normal to the grain axis, ×2. */
export function endGrainAreaIn2(part: Part): number {
  const g = part.geometry;
  if (g.type === 'sweep') return 2 * g.width * g.thickness;
  const b = localBounds(g);
  const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  let axis = part.grain === 'x' ? 0 : part.grain === 'y' ? 1 : part.grain === 'z' ? 2 : ext.indexOf(Math.max(...ext));
  if (g.type === 'extrusion' && axis === 2) {
    // Grain through the thickness: the "ends" are the two faces.
    return 2 * polyArea(g.outline);
  }
  const others = [0, 1, 2].filter((i) => i !== axis);
  let cross = ext[others[0]] * ext[others[1]];
  if (g.type === 'mesh' || g.type === 'extrusion') cross *= 0.8; // bounding box of a shaped part overstates its section
  return 2 * cross;
}

/** Wood a finish goes on: oak lumber, bent laminations, and okoume plywood. Not purchased, metal, printed or rubber parts, and not the reference mannequins. */
export function finishMaterial(part: Part, p?: Params): FinishMaterial | undefined {
  if (part.group === 'reference' || part.kind === 'reference' || part.payload) return undefined;
  if (part.kind === 'purchased' || part.kind === 'metal' || part.kind === 'printed') return undefined;
  const m = part.material.toLowerCase();
  // D-73: a part made of the thin sheet in effect is classed by thinSheet(p) (white oak plywood is NOT okoume, and it takes the stain of the solid oak); the 12 mm deck and
  // seat back are classed by their own material text.
  if (p && part.material === thinSheet(p).material) {
    const k = thinSheet(p).key;
    return k === THIN_SHEET.whiteOakPly ? 'oakPly' : k === THIN_SHEET.balticBirch3mm ? 'birch' : 'okoume';
  }
  if (/plywood|\bply\b|okoume|baltic/.test(m)) return /white oak/.test(m) ? 'oakPly' : /baltic|birch/.test(m) ? 'birch' : 'okoume';
  if (/\boak\b/.test(m)) return 'oak';
  return undefined;
}

const FT2 = 144;

// ---- show and hidden faces ----

/**
 * Show fraction of a part's remaining (net) area, by part id; the first rule that matches wins. SHOW = sun, weather, wear: stained, sealed and varnished 3 coats.
 * HIDDEN = nobody sees it: the frame, the joists, backers and blocks, the deck underside, the inside of the box, the web inside the hull below the deck:
 * sealed and varnished 2 coats, no stain. A part that is half and half gets 0.5. 'web' = computed from the geometry (see `webShowFraction`).
 * Glued contacts come off pro rata. A part with no rule counts as all show (the careful side) and the test names it.
 */
export const SHOW_RULES: ReadonlyArray<{ re: RegExp; show: number | 'web'; why: string }> = [
  { re: /^deck$/, show: 0.5, why: 'top is the wear surface, underside is hidden' },
  { re: /^side-[LR]-web$/, show: 'web', why: 'outer face shows; the inner face is hidden below the deck level, shows above it' },
  { re: /^side-[LR]-chine-in$/, show: 0, why: 'inner chine band, under the deck inside the hull' },
  { re: /^side-[LR]-(chine|gunwale|gunwale-in)$/, show: 1, why: 'outer chine band and the gunwale bands' },
  { re: /^bow-bulkhead$/, show: 1, why: 'bow end and the rider\'s foot brace' },
  { re: /^transom-rear$/, show: 0.5, why: 'outside shows, the inside faces the hull and the box' },
  { re: /^(transom-backer|sign-backer|seat-hinge-backer|storage-hinge-backer|storage-latch-block|flag-block|brake-backer|brake-pivot-block|brake-knee)/, show: 0, why: 'backer or block behind something else' },
  { re: /^side-rib-/, show: 1, why: 'side ribs and their knees stand inside the hull above the deck: the rider and the cargo see the inner face and edges (the glued back is credited off)' },
  { re: /^box-tie-/, show: 0, why: 'oak spacer between a rib and the storage box side: out of sight' },
  { re: /^sign-[LR]$/, show: 0.5, why: 'plate on the web: front shows, back is hidden' },
  { re: /^(rail|joist|axle-hanger)-/, show: 0, why: 'frame under the deck' },
  { re: /^(king-beam|beam-F|beam-R)$/, show: 0, why: 'beams under the hull' },
  { re: /^bridle-tongue$/, show: 1, why: 'exposed and handled' },
  { re: /^seat-back-panel$/, show: 0.5, why: 'the padded face is covered' },
  { re: /^seat-(wedge|crest-strip|grip)/, show: 1, why: 'seat parts in view' },
  { re: /^storage-(side|end)-/, show: 0.5, why: 'box panel: outside shows, inside is hidden' },
  { re: /^storage-lid$/, show: 0.5, why: 'top shows, underside is hidden' },
  { re: /^storage-lid-batten/, show: 0, why: 'under the lid' },
  { re: /^storage-coaming/, show: 0.5, why: 'trim on the box rim' },
  { re: /^storage-rim/, show: 0, why: 'rim under the lid' },
  { re: /^brake-(flap|shoe|chock)/, show: 1, why: 'exposed and worn' },
  { re: /^handle-(post|bar)/, show: 1, why: 'handled' },
];

/** The show fraction of a part, and the rule it came from ('default' when no rule matches). */
export function showRuleOf(part: Part): { rule: string; show: number | 'web' } {
  const r = SHOW_RULES.find((x) => x.re.test(part.id));
  return r ? { rule: r.re.source, show: r.show } : { rule: 'default', show: 1 };
}

/** A side web: its outer face shows; its inner face is hidden below the deck top and shows above it. Half the area is the inner face, so show = 1 - 0.5 × (share of the web height below the deck top). */
function webShowFraction(web: Part, deck: Part | undefined): number {
  if (!deck) return 0.75;
  const w = worldAABB(web);
  const top = worldAABB(deck).max[2];
  const h = w.max[2] - w.min[2];
  const below = h > 0 ? Math.min(1, Math.max(0, (top - w.min[2]) / h)) : 0;
  return 1 - 0.5 * below;
}

type Tally = { oak: number; okoume: number; oakPly: number; birch: number };
const splitOf = (t: Tally): AreaSplit => {
  const ply = t.okoume + t.oakPly + t.birch;
  return { oakFt2: t.oak, okoumeFt2: t.okoume, oakPlyFt2: t.oakPly, birchFt2: t.birch, plyFt2: ply, totalFt2: t.oak + ply };
};
const tally = (): Tally => ({ oak: 0, okoume: 0, oakPly: 0, birch: 0 });

export function finishAreas(parts: Part[], p?: Params): FinishAreas {
  const deck = parts.find((x) => x.id === 'deck');
  // Glued lamination contacts, in², off BOTH mating parts.
  const glue = new Map<string, number>();
  for (const g of glueJointEstimates(parts)) {
    if (!g.contactIn2) continue;
    for (const id of [g.a, g.b]) glue.set(id, (glue.get(id) ?? 0) + g.contactIn2);
  }
  const gross = tally(), glued = tally(), show = tally(), hidden = tally();
  let end = 0;
  const byPart: Record<string, number> = {};
  const detail: Record<string, PartFinishArea> = {};
  for (const part of parts) {
    const m = finishMaterial(part, p);
    if (!m) continue;
    const g = surfaceAreaIn2(part.geometry) / FT2;
    const gl = Math.min(g, (glue.get(part.id) ?? 0) / FT2);
    const net = g - gl;
    const r = showRuleOf(part);
    const frac = r.show === 'web' ? webShowFraction(part, deck) : r.show;
    byPart[part.id] = g;
    detail[part.id] = { material: m, grossFt2: g, gluedFt2: gl, netFt2: net, showFt2: net * frac, hiddenFt2: net * (1 - frac), showFraction: frac, rule: r.rule };
    gross[m] += g; glued[m] += gl; show[m] += net * frac; hidden[m] += net * (1 - frac);
    if (m === 'oak') end += endGrainAreaIn2(part) / FT2;
  }
  const netT = tally();
  for (const k of Object.keys(netT) as Array<keyof Tally>) netT[k] = gross[k] - glued[k];
  const netSplit = splitOf(netT);
  return {
    oakFt2: netSplit.oakFt2, okoumeFt2: netSplit.okoumeFt2, oakPlyFt2: netSplit.oakPlyFt2, birchFt2: netSplit.birchFt2, plyFt2: netSplit.plyFt2, oakEndGrainFt2: end, totalFt2: netSplit.totalFt2,
    gross: splitOf(gross), glued: splitOf(glued), show: splitOf(show), hidden: splitOf(hidden),
    byPart, detail,
  };
}

// ---- glue epoxy (the joints themselves) ----

/**
 * Mixed epoxy per ft² of thickened full-face glue line, squeeze-out included. WEST System's guidance for a glue joint is roughly 0.5-0.75 fl oz/ft², wet-out of both
 * faces included. The old 1.0 was above the top of that range for a thin face-glue line (the 1.5" bands on the webs, the 0.75" backers), so it is 0.6 now: mid-range, with the
 * 20 % waste and the 0.25 fl oz minimum a joint (a batch is never less) on top. The 0.25 floor, not the rate, sets the small joints.
 */
export const GLUE_FLOZ_PER_FT2 = 0.6;
/** Mixed epoxy per Domino (both mortises and the tenon), fl oz, by size: about 0.1-0.2 for the common sizes. */
export const DOMINO_FLOZ: Readonly<Record<string, number>> = { '4×20': 0.1, '5×30': 0.15, '6×40': 0.2, '8×50': 0.25 };
export const DOMINO_FLOZ_DEFAULT = 0.15;
/** A loose tenon in two mortises. */
export const LOOSE_TENON_FLOZ = 0.12;
/** An epoxy-and-fillet butt (the band ends against the transom and the bulkhead): a thickened fillet runs the whole height of the joint. */
export const FILLET_JOINT_FLOZ = 0.5;
/** A dado (web end or deck edge) filled with thickened epoxy. */
export const DADO_JOINT_FLOZ = 0.6;
/** Smallest glue joint (a bedded nipple, a small block): the batch for it is never less. */
export const GLUE_JOINT_MIN_FLOZ = 0.25;

export type GlueKind = 'domino' | 'tenon' | 'lamination' | 'fillet' | 'dado' | 'small';
/** What a glue joint is glued with. The Extreme spec uses epoxy for every joint; the Standard spec uses it only where `standardAdhesive` says so. */
export type Adhesive = 'epoxy' | 'titebond';

const isBandId = (id: string): boolean => /^side-[LR]-(chine|gunwale)(-in)?$/.test(id);
const isWebId = (id: string): boolean => /^side-[LR]-web$/.test(id);

/**
 * The adhesive of a glue joint under the Standard weather spec (Eric, 2026-10-12): Titebond III for the Dominos, dados, tenons and the general glue joints; EPOXY only for the bent
 * laminations (the rails' own plies and the sandwich bands on the webs), the D-70 face laminations (their own lines, `d70`), the deck to the frame, the deck slot gap-fill (the deck dados
 * into the transom and the bulkhead), the tie-down ribs, knees and box ties (D-76), the fillets and tape (the box and the band ends against the transom and bulkhead) and the thickened bedding (a nipple bedded in epoxy, a
 * thickened-epoxy bed or block). A `text` that says "thickened" is bedding.
 */
export function standardAdhesive(kind: GlueKind, a: string, b: string, text: string): Adhesive {
  if (a === b) return 'epoxy'; // the glue lines inside a laminated (bent) part
  if (kind === 'fillet') return 'epoxy';
  if (/^(side-rib|box-tie)/.test(a) || /^(side-rib|box-tie)/.test(b)) return 'epoxy'; // the tie-down bases (D-76: ribs, knees, box ties) carry 300 lbf strap loads: epoxy under both specs
  if (kind === 'lamination' && ((isBandId(a) && isWebId(b)) || (isBandId(b) && isWebId(a)))) return 'epoxy'; // the sandwich bands
  if ((a === 'deck' || b === 'deck') && (kind === 'lamination' || kind === 'dado')) return 'epoxy'; // deck to the frame; the deck slot gap-fill
  if ((kind === 'small' || kind === 'lamination') && /thickened|bedded|nipple|tape/i.test(text)) return 'epoxy'; // thickened bedding
  return 'titebond';
}

export interface GlueJointEstimate {
  a: string;
  b: string;
  kind: GlueKind;
  /** The adhesive under the Standard spec (the Extreme spec uses epoxy for all). */
  standard: Adhesive;
  count: number;
  /** Mixed epoxy, fl oz, no waste. */
  flOz: number;
  /** Lamination only: the glued contact area on EACH of the two mating parts, in² (count included); finishAreas takes it off both. Zero for the other kinds and for the internal glue lines of a laminated part. */
  contactIn2: number;
}

const dominoSizeKey = (size = ''): string => /^\s*(\d+)\s*[×x]\s*(\d+)/.exec(size)?.slice(1, 3).join('×') ?? '';

/** Faces of a stock piece, in²: the largest face and the narrow one (smallest dimension by length). */
function faces(x: Part): { large: number; narrow: number } | null {
  const s = x.stock;
  if (!s) return null;
  const d = [s.t, s.w, s.l].sort((u, v) => u - v);
  return { large: d[1] * d[2], narrow: d[0] * d[2] };
}

/**
 * One estimate per glued joint, a joint listed on both mating parts counted once. Types: Domino and loose tenon (per piece), dado, an epoxy-and-fillet butt, a full-face or full-length
 * lamination (by contact area: the smaller of the two parts' faces, the narrow one when the note says top, edge or length), anything else the smallest batch.
 * `only` limits the list to the joints that touch a part it accepts (the transom and bulkhead closes).
 */
export function glueJointEstimates(parts: Part[], only?: (x: Part) => boolean, p?: Params): GlueJointEstimate[] {
  const byId = new Map(parts.map((x) => [x.id, x]));
  const seen = new Map<string, { a: string; b: string; type: string; dir: Map<string, { count: number; size: string; text: string }> }>();
  for (const x of parts) {
    if (x.group === 'reference' || x.kind === 'reference' || x.payload) continue;
    for (const j of x.joints ?? []) {
      if (j.type !== 'glue' && j.type !== 'domino' && j.type !== 'mortise-tenon' && j.type !== 'dado') continue;
      const mate = byId.get(j.to);
      if (!mate || mate.group === 'reference' || mate.payload) continue;
      if (only && !only(x) && !only(mate)) continue;
      const [a, b] = [x.id, j.to].sort();
      const key = `${a}~${b}|${j.type}`;
      let e = seen.get(key);
      if (!e) seen.set(key, (e = { a, b, type: j.type, dir: new Map() }));
      const d = e.dir.get(x.id) ?? { count: 0, size: j.size ?? '', text: '' };
      d.count += j.count;
      d.text = `${d.text} ${j.size ?? ''} ${j.note ?? ''}`;
      e.dir.set(x.id, d);
    }
  }
  const out: GlueJointEstimate[] = [];
  for (const e of seen.values()) {
    const dirs = [...e.dir.values()];
    const count = Math.max(...dirs.map((d) => d.count));
    const rep = dirs.find((d) => d.count === count) ?? dirs[0];
    const text = rep.text;
    let kind: GlueKind;
    let each: number;
    let contactIn2 = 0;
    if (e.type === 'domino') {
      kind = 'domino';
      each = DOMINO_FLOZ[dominoSizeKey(rep.size)] ?? DOMINO_FLOZ_DEFAULT;
    } else if (e.type === 'mortise-tenon') {
      kind = 'tenon';
      each = LOOSE_TENON_FLOZ;
    } else if (e.type === 'dado') {
      kind = 'dado';
      each = DADO_JOINT_FLOZ;
    } else if (/fillet/i.test(text)) {
      kind = 'fillet';
      each = FILLET_JOINT_FLOZ;
    } else if (/full[- ]face|full[- ]length|lamination|side-grain/i.test(text) && !/nipple|bedded/i.test(text)) {
      kind = 'lamination';
      const fa = faces(byId.get(e.a)!);
      const fb = faces(byId.get(e.b)!);
      const narrow = /\btop\b|edge|full[- ]length/i.test(text);
      const pick = (f: { large: number; narrow: number } | null): number => (f ? (narrow ? f.narrow : f.large) : Infinity);
      const area = Math.min(pick(fa), pick(fb));
      each = Number.isFinite(area) ? Math.max(GLUE_JOINT_MIN_FLOZ, (area / FT2) * GLUE_FLOZ_PER_FT2) : GLUE_JOINT_MIN_FLOZ;
      contactIn2 = Number.isFinite(area) ? area * count : 0;
    } else {
      kind = 'small';
      each = GLUE_JOINT_MIN_FLOZ;
    }
    out.push({ a: e.a, b: e.b, kind, standard: standardAdhesive(kind, e.a, e.b, text), count, flOz: each * count, contactIn2 });
  }
  // The glue lines INSIDE a laminated part (Part.plies, such as the two-strip rail): (plies - 1) lines, each the strip's large face. The faces are inside the part, so no area comes off.
  for (const x of parts) {
    if (x.group === 'reference' || x.kind === 'reference' || x.payload || !x.plies || x.plies < 2 || !finishMaterial(x)) continue;
    if (only && !only(x)) continue;
    const fc = faces(x);
    if (!fc) continue;
    const lines = x.plies - 1;
    out.push({ a: x.id, b: x.id, kind: 'lamination', standard: 'epoxy', count: lines, flOz: Math.max(GLUE_JOINT_MIN_FLOZ, (fc.large / FT2) * GLUE_FLOZ_PER_FT2) * lines, contactIn2: 0 });
  }
  // D-70: a solid part no stocked board is thick enough for (the axle beams, the brake knees and chocks) is face-laminated from layers of stocked boards: (layers - 1) full-face glue lines, EPOXY in both specs.
  // Needs the milling allowance (the params), so only when `p` is given.
  if (p) {
    for (const x of parts) {
      if (x.group === 'reference' || x.kind === 'reference' || x.payload || x.kind !== 'lumber' || x.plies !== undefined || !x.stock || !/\boak\b/i.test(x.material) || /plywood/i.test(x.material)) continue;
      if (only && !only(x)) continue;
      const rough = x.rough ?? { t: x.stock.t + p.millingAllowanceIn, w: x.stock.w + p.millingAllowanceIn, l: x.stock.l + 4 * p.millingAllowanceIn };
      const d = [rough.t, rough.w, rough.l].sort((u, v) => u - v);
      const minFinal = Math.min(x.stock.t, x.stock.w, x.stock.l);
      if (boardForThickness(minFinal, p)) continue; // Eric 2026-10-13: the board is chosen on the FINAL thickness
      const lam = planLamination(minFinal, d[0], p);
      const fc = faces(x);
      if (!lam || !fc) continue;
      const lines = lam.layers.length - 1;
      out.push({ a: x.id, b: x.id, kind: 'lamination', standard: 'epoxy', count: lines, flOz: Math.max(GLUE_JOINT_MIN_FLOZ, (fc.large / FT2) * GLUE_FLOZ_PER_FT2) * lines, contactIn2: 0 });
    }
  }
  return out;
}

/**
 * Mixed epoxy (fl oz, before waste) that the glue joints of these parts use. The BOM adds it to the finishing coats. With `p` the weather spec decides: Extreme glues everything with epoxy
 * (as before), Standard only the joints `standardAdhesive` names (plus the D-70 laminations); without `p` every joint counts (the old behavior).
 */
export function glueEpoxyFlOz(parts: Part[], only?: (x: Part) => boolean, p?: Params): number {
  const std = !!p && p.weatherSpec !== WEATHER_SPEC.extreme;
  return glueJointEstimates(parts, only, p).filter((g) => !std || g.standard === 'epoxy').reduce((s, g) => s + g.flOz, 0);
}

/**
 * Titebond III per joint as a share of the epoxy estimate for the same joint: the epoxy figures (GLUE_FLOZ_PER_FT2, DOMINO_FLOZ...) include wetting out BOTH faces, thickening, squeeze-out and fillets;
 * Titebond is one thin bead or coat on one face, with no filler. About 0.4 of the epoxy volume (a Domino joint takes a few drops: 0.06 fl oz against 0.15 of mixed epoxy).
 */
export const TITEBOND_VS_EPOXY = 0.4;

/** The glue the Standard spec gives to Titebond III (Dominos, dados, tenons, general glue joints): fl oz of glue before waste, and the number of joints. Zero under the Extreme spec. */
export function glueTitebond(parts: Part[], p: Params): { flOz: number; joints: number } {
  if (p.weatherSpec === WEATHER_SPEC.extreme) return { flOz: 0, joints: 0 };
  const js = glueJointEstimates(parts, undefined, p).filter((g) => g.standard === 'titebond');
  return { flOz: js.reduce((s, g) => s + g.flOz, 0) * TITEBOND_VS_EPOXY, joints: js.reduce((s, g) => s + g.count, 0) };
}

// ---- quantities ----

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Round a quart quantity up to containers: gallons (4 qt), quarts, pints. */
export function containers(qt: number, allowGal = true): { unit: 'gal' | 'qt' | 'pt'; qty: number; qt: number }[] {
  const out: { unit: 'gal' | 'qt' | 'pt'; qty: number; qt: number }[] = [];
  let need = Math.ceil(qt * 2) / 2; // pints
  if (allowGal && need >= 3.5) {
    const gal = need >= 4 ? Math.floor(need / 4) + (need % 4 > 3 ? 1 : 0) : 1;
    out.push({ unit: 'gal', qty: gal, qt: gal * 4 });
    need = Math.max(0, need - gal * 4);
  }
  const quarts = Math.floor(need);
  if (quarts > 0) {
    out.push({ unit: 'qt', qty: quarts, qt: quarts });
    need -= quarts;
  }
  if (need > 1e-9) out.push({ unit: 'pt', qty: 1, qt: 0.5 });
  return out;
}

function product(name: string, areaFt2: number, coats: number, coverage: number): FinishProduct {
  return { name, areaFt2: round1(areaFt2), coats, coverageFt2PerQt: coverage, qtNeeded: Math.round(((areaFt2 * coats) / coverage) * (1 + FINISH_WASTE) * 100) / 100 };
}

function buyLines(item: string, qt: number, note: string, allowGal = true): BuyLine[] {
  return containers(qt, allowGal).map((c) => ({ item, unit: c.unit, qty: c.qty, qt: c.qt, note }));
}

/** Epoxy time at a temperature: pot life and cure roughly double for each 18 °F (10 °C) below 70 °F (WEST System guidance). */
export function epoxyTimeFactor(tempF: number): number {
  return Math.pow(2, (70 - tempF) / 18);
}

/** Edge area (ft²) of the plywood parts whose edges are left `exposed` in the model (a captured edge sits in a dado or a rabbet, a banded one is covered with oak): the Standard seal coat covers these. */
export function exposedPlyEdgeFt2(parts: Part[], p: Params): number {
  let in2 = 0;
  for (const x of parts) {
    const m = finishMaterial(x, p);
    if (!m || m === 'oak' || !x.stock) continue;
    const e = x.edges;
    const share = Array.isArray(e) ? (e.length ? e.filter((c) => c === 'exposed').length / e.length : 0) : e === 'exposed' ? 1 : 0;
    if (!share) continue;
    const d = [x.stock.t, x.stock.w, x.stock.l].sort((u, v) => u - v);
    in2 += share * 2 * d[0] * (d[1] + d[2]);
  }
  return in2 / FT2;
}

/** Containers of exterior spar urethane (Standard): quarts, and a gallon once three quarts are needed (the gallon is cheaper than three quarts, docs/price-research-standard-2026-10.md). */
export function urethaneContainers(qt: number): Array<{ unit: 'gal' | 'qt'; qty: number; qt: number }> {
  const n = Math.max(1, Math.ceil(qt - 1e-9));
  let gal = Math.floor(n / 4);
  let rest = n - 4 * gal;
  if (rest >= 3) { gal += 1; rest = 0; }
  return [...(gal ? [{ unit: 'gal' as const, qty: gal, qt: gal * 4 }] : []), ...(rest ? [{ unit: 'qt' as const, qty: rest, qt: rest }] : [])];
}

/** Face veneer depth the engraving must stay inside, by thin sheet (the legend depth is a model number; this is the sheet's own limit). */
const VENEER_TEXT: Record<string, string> = {
  okoume: 'the face veneer of the 4 mm ply (about 1/32")',
  oakPly: 'the face veneer of the 1/4" white oak plywood (hardwood-veneer faces are thin, 1/64" to 1/32")',
  birch: 'the face veneer of the 3 mm Baltic birch (about 1/64")',
};

/** An instruction with plain sub-items (falsy ones dropped). */
function it(text: string, sub: Array<string | false | undefined | null> = []): Instr {
  const s = sub.filter((x): x is string => !!x).map((t) => ({ text: t }));
  return { text, ...(s.length ? { sub: s } : {}) };
}
/** A finishing step from its items: `instructions` is the flat text (sub-items as "– " lines). Falsy items are dropped. */
function step(s: Omit<FinishStep, 'items' | 'instructions'> & { items: Array<Instr | false | undefined | null> }): FinishStep {
  const items = s.items.filter((x): x is Instr => !!x);
  return { ...s, items, instructions: items.flatMap((i) => [i.text, ...(i.sub ?? []).map((q) => `– ${q.text}`)]) };
}
/** A multiplier in words and fractions to the nearest 1/4: 1.47 is "1-1/2 times". */
const timesText = (q: number): string => {
  const n = Math.round(q * 4);
  const w = Math.floor(n / 4), r = n % 4;
  const fr = r === 0 ? '' : r === 2 ? '1/2' : `${r}/4`;
  return `${w ? w : ''}${w && fr ? '-' : ''}${fr || (w ? '' : '0')} times`;
};
/** A small dimension as a shop fraction to 1/64 ("1/32""): an engraving depth. */
const frac64 = (v: number): string => {
  let num = Math.round(v * 64), den = 64;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  return den === 1 ? `${num}"` : `${num}/${den}"`;
};
/** A dimension as a shop fraction to 1/32 ("1-1/2""). */
const frac32 = (v: number): string => {
  const n = Math.round(v * 32);
  const whole = Math.floor(n / 32);
  let num = n % 32, den = 32;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  return `${num ? (whole ? `${whole}-${num}/${den}` : `${num}/${den}`) : whole}"`;
};

export function finishingSchedule(parts: Part[], p: Params): FinishSchedule {
  const extreme = p.weatherSpec === WEATHER_SPEC.extreme;
  const thin = thinSheet(p);
  const thinClass: FinishMaterial = thin.key === THIN_SHEET.whiteOakPly ? 'oakPly' : thin.key === THIN_SHEET.balticBirch3mm ? 'birch' : 'okoume';
  const areas = finishAreas(parts, p);
  const lid = parts.find((x) => x.id === 'storage-lid');
  const legend = lid?.legend;
  const round = p.roundoverIn;
  const f60Text = timesText(epoxyTimeFactor(60));
  /** Plywood that blotches under a water-based dye (okoume, Baltic birch): it takes a conditioner. White oak plywood takes the stain of the solid oak. */
  const blotchShowFt2 = areas.show.okoumeFt2 + areas.show.birchFt2;
  const blotchNames = [areas.okoumeFt2 > 0 ? 'okoume' : '', areas.birchFt2 > 0 ? 'Baltic birch' : ''].filter(Boolean).join(' and ');
  const oakStainFt2 = areas.show.oakFt2 + areas.show.oakPlyFt2;
  const plyNames = ['white oak', ...(areas.okoumeFt2 > 0 ? ['okoume (the 12 mm deck offcut)'] : []), ...(areas.oakPlyFt2 > 0 ? ['white oak plywood'] : []), ...(areas.birchFt2 > 0 ? ['Baltic birch'] : [])];

  // ---- 1. offcut tests
  const Blotch = blotchNames.replace(/^./, (c) => c.toUpperCase());
  const topcoat = extreme ? 'varnish' : 'urethane';
  const s1: FinishStep = step({
    n: 1,
    id: 'offcut-tests',
    title: 'Test on offcuts',
    items: [
      it('Do this BEFORE any show face is sealed or coated (assembly step "Seal the dados, edges and hidden faces").', [
        `Cut two 12" × 12" test panels from the real offcuts: ${plyNames.join(', ')}.`,
        'Sand them to the final grit (step 2).',
      ]),
      it('Try the stain on each wood, two strengths.', [
        'Oak: water-based dye or stain (the safe choice under epoxy or urethane).',
        areas.oakPlyFt2 > 0 && 'White oak plywood: the SAME stain as the solid oak, no conditioner or gel. Check the thin face veneer takes it evenly and does not sand through.',
        blotchShowFt2 > 0 && (extreme
          ? `${Blotch}: pre-stain conditioner then gel stain, against the same stain with no conditioner. It blotches: pick the even sample.`
          : `${Blotch}: pre-stain conditioner then the same water-based dye, against the dye alone (a gel stain is the alternative). It blotches: pick the even sample.`),
      ]),
      extreme
        ? it('Run one panel of each through the whole schedule.', [
          'Stain, the one epoxy seal coat (206), engraving with its fill (lid offcut), varnish (3 coats).',
          'Check the epoxy cures hard over the stain (no tack after the stated cure) and the varnish does not craze or lift.',
          'Stain and seal the show faces only after a panel passes; if none does, leave them unstained under clear epoxy.',
        ])
        : it('Run one panel of each through the whole schedule.', [
          'Stain, the epoxy edge coat (206) on a cut edge, engraving with its fill (lid offcut), exterior spar urethane (3 coats).',
          'Check the urethane dries hard over the stain (no tack after the stated cure), does not craze or lift, and the edge coat does not show through.',
          'Stain and coat the show faces only after a panel passes; if none does, leave them unstained under clear urethane.',
        ]),
      legend
        ? it(`Engrave the legend on the ${thin.name} lid offcut.`, [
          `${frac32(legend.letterHeightIn)} letters, ${frac64(legend.depthIn)} deep: the depth must stay inside ${VENEER_TEXT[thinClass]}.`,
          'If the veneer shows through, go to 1/64".',
        ])
        : it('Engrave a test legend on the lid offcut.'),
      it('Pick the products and sheen from the panels; write them on the panel back and keep it by the finishing bench.'),
    ],
    products: [],
    coats: 0,
    recoat: 'Follow the product labels; a full-schedule panel takes about a week.',
    cure: 'Epoxy test coat: 24 h at 70 °F before judging (blush washed off, then sanded).',
    winter: 'Test the panels in the same shop, at the same temperature, as the real parts.',
  });

  // ---- 2. sand
  const s2: FinishStep = step({
    n: 2,
    id: 'sand',
    title: 'Sand: 120 then 150',
    items: [
      it('Steps 2-6 run in two sessions, with the same products and coats.', [
        'The underside while the hull is still inverted, before the flip.',
        'Everything else after the box, seat, brake and handle are built.',
        'All hardware, hinges and running gear OFF: they go on after the topcoat cures (assembly step "Hang the running gear and hardware").',
      ]),
      it(`Ease every exposed oak edge to the ${frac32(round)} roundover.`, ['Router, then hand-sand; include the hand-holes and the grab-board edges.', 'Break by hand any sharp ply edge that is not banded.']),
      it('Sand with the grain: 120 grit, then 150.', ['Random-orbit sander or a sanding block; never coarser than 120.', `Hand-sand the ${thin.name} at 150: do not go through its face veneer.`]),
      it('Clean up before any finish goes on.', [
        'Wash off any amine blush on epoxy already on the parts (warm water and Scotch-Brite, dry).',
        extreme
          ? 'Scuff the epoxy squeeze-out.'
          : 'Scrape off Titebond squeeze-out (dried glue seals the wood and shows as a pale patch under stain); scuff the epoxy squeeze-out.',
        'Vacuum, then a tack cloth or denatured alcohol.',
      ]),
    ],
    products: [],
    coats: 0,
    recoat: '-',
    cure: '-',
    winter: 'Sanding dust holds moisture in a cold shop: wipe, and let the wood sit at shop temperature a day before staining.',
  });

  // ---- 3. stain (SHOW faces only, one coat). White oak plywood takes the oak's stain; okoume and Baltic birch take a conditioner (and, in the Extreme spec, a gel stain).
  const stainOak = product(`Water-based wood stain or dye (oak${areas.oakPlyFt2 > 0 ? ' and white oak plywood' : ''}, show faces)`, oakStainFt2, 1, STAIN_COVERAGE);
  const condName = `Water-based pre-stain conditioner (${blotchNames || 'okoume'}, show faces)`;
  const cond = product(condName, blotchShowFt2, 1, CONDITIONER_COVERAGE);
  const gel = product(`Gel stain (${blotchNames || 'okoume'}, show faces)`, blotchShowFt2, 1, GEL_STAIN_COVERAGE);
  const s3: FinishStep = step({
    n: 3,
    id: 'stain',
    title: 'Stain the show faces',
    items: [
      it('Stain the SHOW faces only, one coat.', [
        'Show faces: the oak bands, bulkhead, tongue and seat parts, the webs, deck top, box, lid and seat back.',
        `Hidden faces get no stain, ${extreme ? 'epoxy and varnish' : 'urethane'} only: frame, crossmembers, backers, blocks, the deck underside, the inside of the box and of the hull below the deck.`,
        'Glue faces stay bare or scuffed.',
      ]),
      extreme
        ? it('Stain first, THEN seal.', ['Water-based dye under epoxy is the safe route: it dries clear of oils and the epoxy bonds to it.', 'The epoxy goes over a dry, sanded, offcut-tested surface, never over a stain that has not cured.'])
        : it('Stain first, THEN coat.', [
          'Water-based dye under the urethane is the safe route: it dries clear of oils and the urethane bonds to it.',
          'The urethane goes over a dry, sanded, offcut-tested surface, never over a stain that has not cured.',
          'The epoxy edge coat and the deck underside are done separately (step 4); keep dye off the glue faces.',
        ]),
      it(`Oak${areas.oakPlyFt2 > 0 ? ' and white oak plywood' : ''}: raise the grain, then stain.`, [
        `Damp rag, dry, re-sand at 150, so the grain does not rise again under the ${extreme ? 'epoxy' : 'urethane'}.`,
        `Wipe the stain on, wipe it off${areas.oakPlyFt2 > 0 ? '; the white oak plywood takes the same stain, one wipe' : ''}.`,
      ]),
      blotchShowFt2 > 0 && (extreme
        ? it(`${Blotch}: conditioner first.`, ['Stain within the time on the label (about 15 min), then gel stain wiped on in thin coats.', 'Match the oak by sample, not by the can.'])
        : it(`${Blotch}: conditioner first.`, ['The same water-based dye within the time on the label (about 15 min), thin and wiped.', 'If the sample is still blotchy, a gel stain is the alternative (fully cured before the urethane).', 'Match the oak by sample, not by the can.'])),
      it('End grain takes stain darker.', ['Wipe it with conditioner first, or dilute the stain on the ends.']),
      it(`Let it dry completely before the ${extreme ? 'epoxy' : 'urethane'}.`, ['Water-based: 24 h.', `Oil-based stain or gel: a FULL cure (days), or the ${extreme ? 'epoxy' : 'urethane'} stays tacky over it. Use it only if the test panel passed.`]),
    ],
    products: extreme ? [stainOak, ...(blotchShowFt2 > 0 ? [cond, gel] : [])] : [stainOak, ...(blotchShowFt2 > 0 ? [cond] : [])],
    coats: 1,
    recoat: 'Second coat for depth after 2-4 h (water-based) if the panel calls for it.',
    cure: extreme ? '24 h at 70 °F before epoxy (water-based); several days for oil-based stain.' : '24 h at 70 °F before the urethane (water-based); several days for oil-based stain.',
    winter: 'Keep the shop and the wood at 60 °F or warmer; water-based stain dries slowly and can freeze or blush when cold. Double the dry time at 50-55 °F.',
  });

  // ---- 4. epoxy. EXTREME: ONE saturation coat on all the plywood and the oak end grain. STANDARD: the plywood edges that are not captured, the oak end grain and the deck underside only.
  const deckUnderFt2 = areas.detail['deck']?.hiddenFt2 ?? 0;
  const plyEdgeFt2 = exposedPlyEdgeFt2(parts, p);
  const endGrainEq = areas.oakEndGrainFt2 * END_GRAIN_FACTOR;
  const epoxyArea = extreme ? areas.plyFt2 + endGrainEq : plyEdgeFt2 + deckUnderFt2 + endGrainEq;
  const coat = product(
    extreme ? 'West System 105 resin + 206 slow hardener, one saturation coat (mixed volume)' : 'Epoxy 105 resin + 206 slow hardener, edge, end-grain and deck-underside coat (mixed volume)',
    epoxyArea, 1, EPOXY_COVERAGE);
  const coatFlOz = coat.qtNeeded * FLOZ_PER_QT;
  const deckTopFt2 = areas.detail['deck']?.showFt2 ?? 0;
  const secondCoatFlOz = ((deckTopFt2 / EPOXY_COVERAGE) * FLOZ_PER_QT);
  const epoxyWinter = `Epoxy works from about 55 °F: below that it will not cure. At 60 °F pot life and cure times run about ${f60Text} as long; keep resin and hardener at 65-70 °F before mixing. Surface and air must stay above 55 °F until it kicks; use a space heater at a distance, not a flame heater (fumes).`;
  const s4: FinishStep = extreme ? step({
    n: 4,
    id: 'epoxy',
    title: `Epoxy seal: one saturation coat on the ${areas.oakPlyFt2 + areas.birchFt2 > 0 ? 'plywood' : 'okoume'} and the oak end grain`,
    items: [
      it('After the stain has dried: ONE saturation coat of 105 resin / 206 slow hardener (5:1 by volume, the 301 pumps).', [
        `All the plywood, show and hidden faces and every edge that is not glued (${f(areas.plyFt2, 0)} ft²).`,
        `The oak end grain (${f(areas.oakEndGrainFt2, 0)} ft²; it soaks up about twice as much).`,
        'One coat is enough for a sled kept dry in a garage; the varnish carries the UV and the wear.',
      ]),
      it('The dados, edges and hidden faces were already coated during assembly: that IS this coat for them.', ['The show faces get theirs here, after the stain.']),
      it('Roll and tip.', [
        'Short phenolic-core roller and a foam brush; re-wet the end grain and edges as they soak in.',
        'Coat while the shop is cooling (afternoon) to limit outgassing bubbles in the okoume.',
        'Pot life is 20-25 min at 70 °F: spread each batch as soon as it is mixed, a pint at most, and pour leftovers thin into a tray.',
      ]),
      it('After the 206 seal coat cures, wash the amine blush off with water and a Scotch-Brite pad before sanding and varnishing.', [
        'Then sand with 220 and vacuum.',
        'Epoxy over oil-based stain needs the stain fully cured; water-based dye under the epoxy is the safe route.',
      ]),
      it('Two options, not in the quantities.', [
        `OPTION, not in the quantities: a second coat on the deck top, the wear surface (about ${f(deckTopFt2, 0)} ft², ${f(secondCoatFlOz, 0)} fl oz mixed), while the first is tacky or after a wash and 220.`,
        'OPTION, not in the quantities: 207 special clear hardener for the clearest finish under varnish, in place of 206 for the seal coat only (105/207 is 3:1 and needs its own 303 pumps).',
      ]),
    ],
    products: [coat],
    coats: 1,
    recoat: 'One coat. If you add the deck-top second coat, put it on while the first is tacky (about 6-12 h at 70 °F; up to 24 h) for a chemical bond; past that, wash and sand with 220.',
    cure: 'Hard to sand in 24 h at 70 °F; full cure about 7 days. Do not varnish for at least 48 h after the coat.',
    winter: epoxyWinter,
  }) : step({
    n: 4,
    id: 'epoxy',
    title: 'Epoxy edges and end grain, and the deck underside (one coat)',
    items: [
      it('ONE coat of 105 resin / 206 slow hardener (5:1 by volume), only where water gets in.', [
        'The oak end grain.',
        'Every plywood edge not captured in a dado or banded with oak.',
        'The deck underside: water pools there, so it is sealed fully.',
        'Every other plywood face is stained and goes straight to urethane.',
      ]),
      it('Where an assembly step already coated a face, that IS this coat.', ['The end grain and the deck underside are done here (the underside before the hull is flipped).']),
      it('Roll and tip the deck underside; brush the end grain and re-wet it as it soaks in.', ['A pint at most per batch; pour leftovers thin into a tray.']),
      it('After the 206 coat cures, wash off the amine blush (water and a Scotch-Brite pad) before sanding.', ['Sand with 220 and vacuum: the urethane goes over sanded, blush-free epoxy.']),
      it('The Extreme spec (stored outside or near salt) saturates ALL the plywood with epoxy and uses marine varnish: the weather setting in the parameters panel switches the schedule.'),
    ],
    products: [coat],
    coats: 1,
    recoat: 'One coat. Put anything else on while it is tacky (about 6-12 h at 70 °F; up to 24 h) or wash and sand with 220.',
    cure: 'Hard to sand in 24 h at 70 °F; full cure about 7 days. Do not apply the urethane for at least 48 h after the coat.',
    winter: epoxyWinter,
  });

  // ---- 5. engrave
  const s5: FinishStep = step({
    n: 5,
    id: 'engrave',
    title: `Engrave ${legend ? `"${legend.text}"` : 'DO NOT STEP'} on the storage lid (before the ${topcoat})`,
    items: [
      legend
        ? it(`Engrave "${legend.text}" on the storage lid, ${legend.face} face.`, [`${frac32(legend.letterHeightIn)} letters, ${frac64(legend.depthIn)} deep.`, 'Shaper Origin with a V-bit: the legend is on the lid\'s Shaper file.'])
        : it('Engrave the legend on the storage lid, top face.', ['Shaper Origin with a V-bit: the legend is on the lid\'s Shaper file.']),
      extreme
        ? it('Cut it after the epoxy seal has cured and been sanded, and before any varnish.', ['The V-groove then cuts through sealed ply and leaves clean edges.'])
        : it('Cut it after the stain has dried and been sanded lightly, and before any urethane.', [`The lid top is not epoxy-coated in the Standard spec; the ${thin.name} face veneer is thin, so check the depth on the offcut first.`]),
      it('Fill the grooves.', ['Black-tinted epoxy (pigment in leftover 105/206) or enamel paint, with a fine brush.', 'Scrape or sand flush at 220 when hard. The epoxy fill seals the bare groove walls.']),
      it('The letters read from a standing position; the lid is for a cushion to sit on, not a step.'),
    ],
    products: [
      { name: 'Black pigment epoxy (from the epoxy stock) or enamel paint', areaFt2: 0.1, coats: 1, coverageFt2PerQt: 0, qtNeeded: ENGRAVE_FILL_PT / 2 },
    ],
    coats: 1,
    recoat: '-',
    cure: 'Epoxy fill: 24 h at 70 °F before sanding flush; enamel: 24 h.',
    winter: 'Fill and sand the grooves in a warm area; epoxy fill below 55 °F stays soft and clogs the sandpaper.',
  });

  // ---- 6. topcoat: 3 coats on the show faces, 2 on the hidden ones. EXTREME: marine spar varnish. STANDARD: exterior spar urethane (Minwax Helmsman class, about 100 ft² a quart).
  const topCoverage = extreme ? VARNISH_COVERAGE : URETHANE_COVERAGE;
  const topName = extreme ? 'Spar varnish with UV absorbers' : 'Exterior spar urethane (oil-based)';
  const vShow = product(`${topName}, show faces, ${VARNISH_COATS_SHOW} coats`, areas.show.totalFt2, VARNISH_COATS_SHOW, topCoverage);
  const vHidden = product(`${topName}, hidden faces, ${VARNISH_COATS_HIDDEN} coats`, areas.hidden.totalFt2, VARNISH_COATS_HIDDEN, topCoverage);
  const varnishQt = vShow.qtNeeded + vHidden.qtNeeded;
  const s6: FinishStep = step({
    n: 6,
    id: 'varnish',
    title: `${extreme ? 'Spar varnish' : 'Exterior spar urethane'}: ${VARNISH_COATS_SHOW} coats on the show faces, ${VARNISH_COATS_HIDDEN} on the hidden faces, 320 between coats`,
    items: [
      extreme
        ? it('Spar varnish with UV absorbers (marine, high solids), over the oak and the epoxy.', [
          `${VARNISH_COATS_SHOW} coats on the show faces, ${VARNISH_COATS_HIDDEN} on the hidden faces.`,
          'It is the UV protection for the epoxy, which yellows and chalks in sunlight.',
        ])
        : it('Exterior spar urethane (oil-based, Minwax Helmsman class), over the stained wood and the epoxy-coated end grain and deck underside.', [
          `${VARNISH_COATS_SHOW} coats on the show faces, ${VARNISH_COATS_HIDDEN} on the hidden faces.`,
          'It flexes with the wood and carries UV absorbers.',
          'On the plywood it is the only coating: do not skip a coat on the deck top, the box or the lid.',
        ]),
      it(`Coat 1 thinned 10-15 % with the recommended thinner (it sinks into the ${extreme ? 'oak' : 'wood'}); the later coats at full strength.`, ['Brush with the grain in thin coats; tip off with a dry brush.', 'The hidden faces stop after coat 2.']),
      it('Between coats: scuff with 320 to a dull surface, then wipe with a tack cloth or mineral spirits.'),
      it('Build the edges most (roundovers, hand-holds): they wear first.', ['Touch up any sand-through with the same product.']),
      it('Keep the can closed: an open can skins over.', [extreme ? 'Use QUARTS, not a gallon, and pour each session\'s varnish into a cup.' : 'Pour each session\'s urethane into a cup; decant a gallon into quart jars.']),
      it('Hardware, hinges and the running gear stay off until the last coat has cured (assembly step "Hang the running gear and hardware").', ['Mask the bolt seats and pivot bores.']),
    ],
    products: [vShow, vHidden],
    coats: VARNISH_COATS_SHOW,
    recoat: extreme ? 'Recoat in 12-24 h at 70 °F (when it sands to a powder, not gum); after 72 h, scuff with 320 before recoating.' : 'Recoat in 24 h at 70 °F (the can says 4-6 h to touch-dry; wait until it sands to a powder, not gum); after 72 h, scuff with 320 before recoating.',
    cure: 'Dry to touch in 6-8 h; ready for handling in 3 days; full cure about 30 days. Do not load or strap the finish for 7 days.',
    winter: 'Apply at 60 °F or warmer and under about 80 % humidity; at 50-55 °F double the recoat time and thin less. Keep the sled in the warm room until the last coat is hard; a cold garage leaves it tacky for weeks.',
  });

  const steps = [s1, s2, s3, s4, s5, s6];

  // ---- epoxy: the coat (15 % waste) + the glue joints that use epoxy (20 % waste), all 105 resin + 206 slow at 5:1. Under the Standard spec the other glue joints are Titebond III (`glue`).
  // The transom and bulkhead closes are glue joints like the rest: 206 too, in SMALL batches in a wide shallow container (more surface, longer pot), a second person mixing. Their epoxy is inside glueFlOz.
  const closeParts = new Set(parts.filter((x) => x.step === HULL_STEP.transom).map((x) => x.id));
  const closeGlueFlOz = round1(glueEpoxyFlOz(parts, (x) => closeParts.has(x.id), p) * 10) / 10;
  const glueFlOz = glueEpoxyFlOz(parts, undefined, p) * (1 + GLUE_WASTE);
  const tb = glueTitebond(parts, p);
  const titebondFlOz = tb.flOz * (1 + GLUE_WASTE);
  const totalMixedFlOz = coatFlOz + glueFlOz;
  const hardenerFlOz = totalMixedFlOz / (EPOXY_RESIN_PARTS + 1);
  const resinFlOz = totalMixedFlOz - hardenerFlOz;
  const epoxy: EpoxySummary = { coatingFlOz: coatFlOz, glueFlOz, closeGlueFlOz, totalMixedFlOz, resinFlOz, hardenerFlOz };

  // ---- buy list, in the units a store sells
  const topContainers = extreme
    ? [{ unit: 'qt' as const, qty: Math.max(1, Math.ceil(varnishQt - 1e-9)), qt: Math.max(1, Math.ceil(varnishQt - 1e-9)) }]
    : urethaneContainers(varnishQt);
  const buy: BuyLine[] = [
    ...buyLines('West System 105 epoxy resin', resinFlOz / FLOZ_PER_QT, `${f(resinFlOz, 0)} fl oz resin + ${f(hardenerFlOz, 0)} fl oz 206 slow hardener (5:1) = ${f(totalMixedFlOz, 0)} fl oz mixed: ${extreme ? `the one seal coat ${f(coatFlOz, 0)} fl oz (${f(epoxyArea, 0)} ft² at ${EPOXY_COVERAGE} ft² per mixed quart, +${f(FINISH_WASTE * 100, 0)} % waste)` : `the edge, end-grain and deck-underside coat ${f(coatFlOz, 0)} fl oz (${f(epoxyArea, 1)} ft² at ${EPOXY_COVERAGE} ft² per mixed quart, +${f(FINISH_WASTE * 100, 0)} % waste)`} plus the glue joints that use epoxy ${f(glueFlOz, 0)} fl oz (+${f(GLUE_WASTE * 100, 0)} % waste). NOT a separate purchase: the BOM's 5:1 epoxy kit covers the glue-ups, the coat and the closes together; one hardener, so no 207 or 209 to buy`),
    ...(blotchShowFt2 > 0 ? buyLines(`Water-based pre-stain conditioner (${blotchNames})`, cond.qtNeeded, `${f(blotchShowFt2, 0)} ft² of show faces, 1 coat, at ${CONDITIONER_COVERAGE} ft²/qt`, false) : []),
    ...(extreme && blotchShowFt2 > 0 ? buyLines(`Gel stain (${blotchNames})`, gel.qtNeeded, `${f(blotchShowFt2, 0)} ft² of show faces, 1 coat, at ${GEL_STAIN_COVERAGE} ft²/qt`, false) : []),
    ...buyLines('Water-based wood stain or dye (oak)', stainOak.qtNeeded, `${f(oakStainFt2, 0)} ft² of show faces, 1 coat, at ${STAIN_COVERAGE} ft²/qt`, false),
    // Quarts, rounded up. Extreme: never a gallon (an open can skins over). Standard: a gallon once three quarts are needed.
    ...topContainers.map((c) => ({
      item: extreme ? `Marine spar varnish, UV absorbers (${VARNISH_COATS_SHOW} coats show, ${VARNISH_COATS_HIDDEN} hidden)` : `Exterior spar urethane, oil-based (${VARNISH_COATS_SHOW} coats show, ${VARNISH_COATS_HIDDEN} hidden)`,
      unit: c.unit, qty: c.qty, qt: c.qt,
      note: `${f(areas.show.totalFt2, 0)} ft² × ${VARNISH_COATS_SHOW} + ${f(areas.hidden.totalFt2, 0)} ft² × ${VARNISH_COATS_HIDDEN} coats at ${topCoverage} ft²/qt, +${f(FINISH_WASTE * 100, 0)} % waste = ${f(varnishQt, 1)} qt; ${extreme ? 'quart cans, not a gallon (an open can skins over)' : 'quarts, or a gallon once three quarts are needed (decant it into jars)'}`,
    })),
    { item: 'Black enamel (or black epoxy pigment) for the lid legend', unit: 'pt', qty: 1, qt: 0.5, note: 'engraving fill' },
    { item: extreme ? 'Thinner for the varnish (mineral spirits or the maker\'s thinner)' : 'Thinner for the urethane (mineral spirits)', unit: 'pt', qty: 1, qt: 0.5, note: 'coat 1 thinning and brush cleaning' },
  ];

  return {
    spec: extreme ? 'extreme' : 'standard',
    areas,
    steps,
    buy,
    supplies: [],
    closeEpoxyFlOz: 0,
    epoxy,
    glue: { titebondFlOz, titebondJoints: tb.joints, epoxyEdgeFt2: plyEdgeFt2, deckUnderFt2, adhesiveRule: extreme ? 'Epoxy for every glue joint (Extreme weather spec).' : 'Titebond III for the Dominos, dados, tenons and general glue joints; epoxy for the bent laminations, the glued-up thick parts, the deck to the frame, the deck slot gap-fill, the fillets and tape and the thickened bedding (Standard weather spec).' },
    assumptions: [
      `Weather spec: ${extreme ? 'EXTREME (stored outside, near salt or exposed regularly): epoxy for every glue joint, a saturation coat on all the plywood, marine spar varnish.' : 'STANDARD (garage-kept, used a few times a year, wet at most at a rainy derby): Titebond III for the general joints, epoxy only where it earns its keep, an epoxy coat on edges, end grain and the deck underside only, exterior spar urethane.'} Thin sheet: ${thin.name}.`,
      `Areas are net of the glued faces (each lamination contact comes off both parts): ${f(areas.gross.totalFt2, 0)} ft² gross - ${f(areas.glued.totalFt2, 1)} ft² glued = ${f(areas.totalFt2, 0)} ft²; ${f(areas.show.totalFt2, 0)} ft² show and ${f(areas.hidden.totalFt2, 0)} ft² hidden, by part.`,
      `Typical coverages in ft² per quart, one coat: epoxy ${EPOXY_COVERAGE} (mixed volume, one saturation coat; WEST System coating-quantity table, 105/206 midpoint 378 ft² per 4.8 qt), stain ${STAIN_COVERAGE}, conditioner ${CONDITIONER_COVERAGE}, gel stain ${GEL_STAIN_COVERAGE}, ${extreme ? `marine varnish ${VARNISH_COVERAGE}` : `exterior spar urethane ${URETHANE_COVERAGE} (the can's rating)`} (thin brushed coats).`,
      `${f(FINISH_WASTE * 100, 0)} % waste on every finish quantity (${f(GLUE_WASTE * 100, 0)} % on the glue joints); oak end grain counted ${END_GRAIN_FACTOR}× for epoxy.`,
      'ONE hardener: 105 resin with 206 slow, 5:1 by volume, for the glue-ups, the coat and the two long closes (the closes in small batches in a wide shallow container, a second person mixing). The glue joints that use epoxy are in the epoxy total.',
      ...(extreme ? [] : [`Titebond III: ${tb.joints} glue joints, ${f(tb.flOz, 1)} fl oz before the ${f(GLUE_WASTE * 100, 0)} % waste (${f(TITEBOND_VS_EPOXY * 100, 0)} % of the epoxy estimate for the same joints: one thin coat, no filler or fillet).`]),
      'Options not in the quantities: a second epoxy coat on the deck top; 207 special clear hardener for the clearest finish under varnish.',
    ],
  };
}

function f(n: number, d = 2): string {
  return String(+n.toFixed(d));
}
