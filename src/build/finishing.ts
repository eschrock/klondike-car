/**
 * Phase 4 output 7: finishing schedule.
 *
 * Areas (ft²) come from the part geometry (box, extrusion, sweep, mesh), by material: white oak and okoume plywood. Purchased, metal, printed
 * and rubber parts are excluded. Quantities are area × coats ÷ a typical coverage (ft² per quart, cited with each product) plus a waste
 * allowance, then rounded to what a shop buys (gallons, quarts, pints).
 *
 * Areas are GROSS: every face of every wood part, including faces that end up glued to another part. That is deliberate for the epoxy
 * (sealing happens before the glue-ups, D-62) and about 15-25 % conservative for the stain and varnish.
 */
import { localBounds } from '../model/bounds';
import type { Geometry, Part, Vec2 } from '../model/types';
import type { Params } from '../params';

// ---- constants (process facts, not design numbers; coverage figures are typical label / WEST System values) ----

/** Waste on top of the computed quantity (brush loss, pot leftovers, the test panels). */
export const FINISH_WASTE = 0.15;
/** Epoxy soaks into end grain about twice as fast as into face grain. */
export const END_GRAIN_FACTOR = 2;
/** 105 resin : 207 hardener = 5 : 1 by volume. */
export const EPOXY_RESIN_PARTS = 5;
/** ft² per quart of MIXED 105/207: 1st coat soaks into bare okoume / end grain, 2nd coat goes on a sealed surface (D-20: about 300 ft² per mixed gallon per coat on sanded hardwood). */
export const EPOXY_COVERAGE_COAT1 = 60;
export const EPOXY_COVERAGE_COAT2 = 80;
/** Typical label coverage, ft² per quart, one coat. */
export const STAIN_COVERAGE = 150;
export const CONDITIONER_COVERAGE = 125;
export const GEL_STAIN_COVERAGE = 125;
export const VARNISH_COVERAGE = 125;
export const VARNISH_COATS = 4;
/** Letter fill: black-tinted epoxy or paint, a fraction of a pint. */
const ENGRAVE_FILL_PT = 0.5;

export type FinishMaterial = 'oak' | 'okoume';

export interface FinishAreas {
  /** Gross surface of all white-oak parts, ft². */
  oakFt2: number;
  /** Gross surface of all okoume plywood parts (both faces and all edges), ft². */
  okoumeFt2: number;
  /** End-grain area of the oak parts (estimate from the grain axis), ft². */
  oakEndGrainFt2: number;
  /** oak + okoume, ft². */
  totalFt2: number;
  /** Per part id, ft² (wood parts only). */
  byPart: Record<string, number>;
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

export interface FinishSchedule {
  areas: FinishAreas;
  steps: FinishStep[];
  buy: BuyLine[];
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
export function finishMaterial(part: Part): FinishMaterial | undefined {
  if (part.group === 'reference' || part.kind === 'reference' || part.payload) return undefined;
  if (part.kind === 'purchased' || part.kind === 'metal' || part.kind === 'printed') return undefined;
  const m = part.material.toLowerCase();
  if (/okoume|plywood|baltic/.test(m)) return 'okoume';
  if (/\boak\b/.test(m)) return 'oak';
  return undefined;
}

const FT2 = 144;

export function finishAreas(parts: Part[]): FinishAreas {
  let oak = 0;
  let okoume = 0;
  let end = 0;
  const byPart: Record<string, number> = {};
  for (const part of parts) {
    const m = finishMaterial(part);
    if (!m) continue;
    const a = surfaceAreaIn2(part.geometry) / FT2;
    byPart[part.id] = a;
    if (m === 'oak') {
      oak += a;
      end += endGrainAreaIn2(part) / FT2;
    } else okoume += a;
  }
  return { oakFt2: oak, okoumeFt2: okoume, oakEndGrainFt2: end, totalFt2: oak + okoume, byPart };
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

export function finishingSchedule(parts: Part[], p: Params): FinishSchedule {
  const areas = finishAreas(parts);
  const lid = parts.find((x) => x.id === 'storage-lid');
  const legend = lid?.legend;
  const round = p.roundoverIn;
  const f60 = round1(epoxyTimeFactor(60) * 10) / 10;

  // ---- 1. offcut tests
  const s1: FinishStep = {
    n: 1,
    id: 'offcut-tests',
    title: 'Test on offcuts',
    instructions: [
      'Cut two 12" × 12" test panels from the real offcuts: white oak and okoume (4 mm). Sand both to the final grit (step 2).',
      'Oak: water-based dye or stain (preferred under epoxy), two strengths. Okoume: pre-stain conditioner then gel stain, vs. the same stain with no conditioner. Okoume blotches: pick the sample that is even.',
      'Run one panel of each through the whole schedule: stain, 2 coats of epoxy, engraving with the fill (okoume lid offcut), varnish. Check the epoxy cures hard over the stain (no tack after the stated cure) and that the varnish does not craze or lift.',
      legend
        ? `Engrave the legend (${legend.letterHeightIn}" letters, ${legend.depthIn}" deep) on the okoume lid offcut: the depth must stay inside the face veneer of the 4 mm ply (about 0.03-0.04"); if the veneer shows through, go to 0.02".`
        : 'Engrave a test legend on the lid offcut.',
      'Pick products and sheen from the panels, write them on the panel back and keep it by the finishing bench.',
    ],
    products: [],
    coats: 0,
    recoat: 'Follow the product labels; a full-schedule panel takes about a week.',
    cure: 'Epoxy test coat: 24 h at 70 °F before judging.',
    winter: 'Test panels in the same shop and at the same temperature the real parts will be in.',
  };

  // ---- 2. sand
  const s2: FinishStep = {
    n: 2,
    id: 'sand',
    title: 'Sand: 120 then 150',
    instructions: [
      `Ease every exposed oak edge to the ${f(round)}" roundover (router, then hand-sand), including hand-holes and the grab-board edges; break all sharp ply edges that are not banded by hand.`,
      'Sand with the grain: 120 grit, then 150 grit, random-orbit or sanding block. Do not go below 120 and do not sand through the face veneer of the 4 mm okoume (hand-sand it at 150).',
      'Remove any amine blush from epoxy already on the parts (warm water + Scotch-Brite, dry) and scuff glue-up squeeze-out; vacuum and wipe with a tack cloth or denatured alcohol.',
    ],
    products: [],
    coats: 0,
    recoat: '-',
    cure: '-',
    winter: 'Sanding dust holds moisture in a cold shop: wipe, let the wood sit at shop temperature a day before staining.',
  };

  // ---- 3. stain
  const stainOak = product('Water-based wood stain or dye (oak)', areas.oakFt2, 1, STAIN_COVERAGE);
  const cond = product('Water-based pre-stain conditioner (okoume)', areas.okoumeFt2, 1, CONDITIONER_COVERAGE);
  const gel = product('Gel stain (okoume)', areas.okoumeFt2, 1, GEL_STAIN_COVERAGE);
  const s3: FinishStep = {
    n: 3,
    id: 'stain',
    title: 'Stain',
    instructions: [
      'Oak: wipe the water-based stain or dye on, wipe off; raise the grain with a damp rag first and re-sand at 150 so it does not raise again under the epoxy.',
      'Okoume: pre-stain conditioner first, stain within the time on the label (about 15 min), then gel stain wiped on in thin coats. Match the oak by sample, not by the can.',
      'End grain takes stain darker: seal it with a wipe of conditioner or dilute the stain on the ends.',
      'Let it dry completely before the epoxy: water-based stain 24 h; oil-based stain needs a FULL cure (days) or the epoxy stays tacky over it, so use oil-based only if the test panel passed.',
    ],
    products: [stainOak, cond, gel],
    coats: 1,
    recoat: 'Second coat for depth after 2-4 h (water-based) if the panel calls for it.',
    cure: '24 h at 70 °F before epoxy (water-based); several days for oil-based stain.',
    winter: 'Keep the shop and the wood at 60 °F or warmer; water-based stain dries slowly and can freeze or blush when cold. Double the dry time at 50-55 °F.',
  };

  // ---- 4. epoxy seal
  const epoxyArea = areas.okoumeFt2 + areas.oakEndGrainFt2 * END_GRAIN_FACTOR;
  const c1 = product('West System 105 resin + 207 hardener, coat 1 (mixed volume)', epoxyArea, 1, EPOXY_COVERAGE_COAT1);
  const c2 = product('West System 105 resin + 207 hardener, coat 2 (mixed volume)', epoxyArea, 1, EPOXY_COVERAGE_COAT2);
  const mixedQt = c1.qtNeeded + c2.qtNeeded;
  const s4: FinishStep = {
    n: 4,
    id: 'epoxy',
    title: 'Epoxy seal: okoume (all faces and edges) and oak end grain',
    instructions: [
      `Seal ALL faces and edges of the okoume (${f(areas.okoumeFt2, 0)} ft²) and the end grain of the oak (${f(areas.oakEndGrainFt2, 0)} ft², counted double for the extra soak-in) with 2 coats of West System 105 resin / 207 hardener (5:1 by volume, pumps).`,
      'Coat 1 on bare, sanded wood: roll and tip, then re-wet end grain and edges as it soaks in. Coat 2 within the recoat window (tacky, 6-12 h at 70 °F) so it bonds chemically; after that wash and sand.',
      'The dados, deck faces and hidden faces were already sealed during assembly (D-62): that coat counts as coat 1 for those faces; sand off the blush and add coat 2 here.',
      'Wash the cured epoxy with warm water and Scotch-Brite (dry), sand with 220, vacuum. Epoxy over oil-based stain needs the stain fully cured; prefer a water-based dye or stain under the epoxy.',
      'Use a roller with a short phenolic core and a foam brush; apply while the shop temperature is falling (afternoon) to limit outgassing bubbles in the okoume.',
      `Pot life of 207 is about 20-25 min at 70 °F in a mass; spread it as soon as it is mixed, pour leftovers thin into a tray. Mix no more than a pint at a time for rolling.`,
    ],
    products: [c1, c2],
    coats: 2,
    recoat: 'Recoat when the first coat is tacky (about 6-12 h at 70 °F; up to 24 h) for a chemical bond; past that, wash and sand with 220.',
    cure: 'Hard to sand in 24 h at 70 °F; full cure about 7 days. Do not varnish for at least 48 h after the last coat.',
    winter: `Epoxy works from about 55 °F: below that it will not cure. At 60 °F multiply pot life and cure times by about ${f60}; keep resin and hardener at 65-70 °F before mixing. Surface and air must stay above 55 °F until it kicks; use a space heater at a distance, not a flame heater (fumes).`,
  };

  // ---- 5. engrave
  const s5: FinishStep = {
    n: 5,
    id: 'engrave',
    title: `Engrave ${legend ? `"${legend.text}"` : 'DO NOT STEP'} on the storage lid (before the varnish)`,
    instructions: [
      legend
        ? `Part storage-lid, ${legend.face} face: "${legend.text}", letter height ${legend.letterHeightIn}", depth ${legend.depthIn}". Process in the model: ${legend.process}.`
        : 'Part storage-lid, top face.',
      'Shaper Origin with a V-bit: the legend is an SVG on the lid file (shaper-svg). Cut after the epoxy seal has cured and been sanded, so the V-groove is cut through sealed ply and clean edges, and before any varnish.',
      'Fill the grooves with black-tinted epoxy (pigment in the leftover 105/207) or enamel paint with a fine brush; scrape / sand flush at 220 when hard. The epoxy fill seals the bare groove walls.',
      'Letters 1.5" high read from a standing position; the lid is a seat-cushion lid, not a step (D-58).',
    ],
    products: [
      { name: 'Black pigment epoxy (from the epoxy stock) or enamel paint', areaFt2: 0.1, coats: 1, coverageFt2PerQt: 0, qtNeeded: ENGRAVE_FILL_PT / 2 },
    ],
    coats: 1,
    recoat: '-',
    cure: 'Epoxy fill: 24 h at 70 °F before sanding flush; enamel: 24 h.',
    winter: 'Fill and sand the grooves in a warm area; epoxy fill below 55 °F stays soft and clogs the sandpaper.',
  };

  // ---- 6. varnish
  const allWood = areas.totalFt2;
  const varnish = product(`Spar varnish with UV absorbers, ${VARNISH_COATS} coats`, allWood, VARNISH_COATS, VARNISH_COVERAGE);
  const s6: FinishStep = {
    n: 6,
    id: 'varnish',
    title: `Spar varnish: ${VARNISH_COATS} coats (3 minimum), 320 between coats`,
    instructions: [
      `Spar varnish with UV absorbers (marine, high solids) on ALL wood, ${f(allWood, 0)} ft²: it is the UV protection for the epoxy, which yellows and chalks in sunlight.`,
      'Coat 1 thinned 10-15 % with the recommended thinner (it sinks into the oak). Coats 2-4 at full strength, brushed with the grain in thin coats; tip off with a dry brush.',
      'Sand every coat with 320 (a light scuff to dull) and wipe with a tack cloth or mineral spirits before the next coat.',
      'Sand-through is touched up with the same varnish; build the edges (roundovers, hand-holes) the most since they wear first.',
      'Hang the reflectors and fit the hardware only after the last coat has cured, or mask the screw holes (the final-fit step).',
    ],
    products: [varnish],
    coats: VARNISH_COATS,
    recoat: 'Recoat in 12-24 h at 70 °F (when it sands to a powder, not gum); after 72 h, scuff with 320 before recoating.',
    cure: 'Dry to touch in 6-8 h; ready for handling in 3 days; full cure about 30 days. Do not load or strap the finish for 7 days.',
    winter: 'Apply at 60 °F or warmer and under about 80 % humidity; at 50-55 °F double the recoat time and thin less. Keep the sled in the warm room until the last coat is hard; a cold garage leaves it tacky for weeks.',
  };

  const steps = [s1, s2, s3, s4, s5, s6];

  // ---- buy list, in the units a store sells
  const hardenerQt = mixedQt / (EPOXY_RESIN_PARTS + 1);
  const resinQt = mixedQt - hardenerQt;
  const buy: BuyLine[] = [
    ...buyLines('West System 105 epoxy resin', resinQt, `${f(resinQt, 1)} qt resin for ${f(mixedQt, 1)} qt mixed (two coats of ${f(epoxyArea, 0)} ft² at ${EPOXY_COVERAGE_COAT1} / ${EPOXY_COVERAGE_COAT2} ft²/qt mixed)`),
    ...buyLines('West System 207 special clear hardener', hardenerQt, `${f(hardenerQt, 2)} qt hardener (5:1); pumps for the cans; one qt is enough for most of this`, false),
    ...buyLines('Water-based pre-stain conditioner (okoume)', cond.qtNeeded, `${f(areas.okoumeFt2, 0)} ft² at ${CONDITIONER_COVERAGE} ft²/qt`, false),
    ...buyLines('Gel stain (okoume)', gel.qtNeeded, `${f(areas.okoumeFt2, 0)} ft² at ${GEL_STAIN_COVERAGE} ft²/qt`, false),
    ...buyLines('Water-based wood stain or dye (oak)', stainOak.qtNeeded, `${f(areas.oakFt2, 0)} ft² at ${STAIN_COVERAGE} ft²/qt`, false),
    ...buyLines(`Marine spar varnish, UV absorbers (${VARNISH_COATS} coats)`, varnish.qtNeeded, `${f(allWood, 0)} ft² × ${VARNISH_COATS} coats at ${VARNISH_COVERAGE} ft²/qt, +${f(FINISH_WASTE * 100, 0)} % waste`),
    { item: 'Black enamel (or black epoxy pigment) for the lid legend', unit: 'pt', qty: 1, qt: 0.5, note: 'engraving fill' },
    { item: 'Thinner for the varnish (mineral spirits or the maker\'s thinner)', unit: 'pt', qty: 1, qt: 0.5, note: 'coat 1 thinning and brush cleaning' },
  ];

  return {
    areas,
    steps,
    buy,
    assumptions: [
      'Areas are gross (every face of every wood part, glued faces included), which is about 15-25 % conservative for stain and varnish.',
      `Typical coverages in ft² per quart, one coat: epoxy ${EPOXY_COVERAGE_COAT1} / ${EPOXY_COVERAGE_COAT2} (mixed volume, coat 1 / 2), stain ${STAIN_COVERAGE}, conditioner ${CONDITIONER_COVERAGE}, gel stain ${GEL_STAIN_COVERAGE}, varnish ${VARNISH_COVERAGE}.`,
      `${f(FINISH_WASTE * 100, 0)} % waste on every quantity; oak end grain counted ${END_GRAIN_FACTOR}× for epoxy.`,
    ],
  };
}

function f(n: number, d = 2): string {
  return String(+n.toFixed(d));
}
