/**
 * Phase 4 output 6: assembly steps.
 *
 * Built from `Part.step` (STEP / HULL_STEP in model/build-utils.ts), the hull build-sequence comment above HULL_STEP, and each part's `joints`.
 * Pure function of (parts, params). Three kinds of step:
 *   - 'prep'    preparation with no parts in the model (verify, mill, Shaper parts and forms, seal);
 *   - 'build'   installs parts (partIds);
 *   - 'process' no new parts: dry fit, lowering, flipping the hull, finishing.
 *
 * Every non-reference part is installed in exactly one step. Parts a template does not name fall into the last template of their model
 * step, or into a generated step of their own, so a part added to the model can never go missing from the build order.
 */
import { HULL_STEP, STEP } from '../model/build-utils';
import type { AssemblyStep, Joint, Part } from '../model/types';
import { bowTaper, type Params } from '../params';
import { epoxyTimeFactor, finishAreas, finishingSchedule } from './finishing';
import { verifyChecklist } from './verify';

export type StepKind = 'prep' | 'build' | 'process';
export type Hardener = '205' | '206' | '209';
export type StepView = NonNullable<AssemblyStep['view']>;

/** Epoxy working times at 70 °F (WEST System 105 with the named hardener). */
export interface Cure {
  hardener: Hardener;
  /** Pot life of a mixed batch, minutes. */
  potMin: [number, number];
  /** Time under the clamps before they can come off, hours. */
  clampHours: [number, number];
  /** Time to full cure, hours. */
  fullHours: number;
}

export const HARDENERS: Record<Hardener, Cure & { label: string }> = {
  '205': { hardener: '205', label: '205 fast', potMin: [9, 12], clampHours: [5, 6], fullHours: 24 },
  '206': { hardener: '206', label: '206 slow', potMin: [20, 25], clampHours: [8, 10], fullHours: 24 },
  '209': { hardener: '209', label: '209 extra slow', potMin: [90, 120], clampHours: [20, 24], fullHours: 48 },
};

export interface BuildStep extends AssemblyStep {
  /** Stable id for the viewer / print anchors. */
  id: string;
  kind: StepKind;
  /** Lowest `Part.step` value of the parts this step installs (0 for preparation). Nondecreasing along the list. */
  modelStep: number;
  /** Parts installed in this step (cumulative view: earlier steps solid, this one highlighted). */
  partIds: string[];
  tools: string[];
  checks: string[];
  /** Epoxy used by the step (a step with several glue-ups lists the one that sets the schedule). */
  cure?: Cure;
  view: StepView;
}

export interface StepCtx {
  parts: Part[];
  p: Params;
  /** Parts installed in this step. */
  mine: Part[];
  by: (id: string) => Part | undefined;
}

interface Template {
  id: string;
  title: string;
  kind: StepKind;
  /** Model steps whose parts this template may take (first entry is the step's modelStep). */
  steps: number[];
  match?: RegExp;
  view: StepView;
  tools: string[];
  /** Cure used for the clampCure text, and the clamp description. */
  hardener?: Hardener;
  clamp?: string;
  build: (c: StepCtx) => { instructions: string[]; checks: string[] };
}

// ---- helpers ----

const f = (n: number, d = 2): string => String(+n.toFixed(d));
const inch = (n: number, d = 3): string => `${f(n, d)}"`;

const GLUE_JOINTS: ReadonlySet<string> = new Set(['glue', 'domino', 'mortise-tenon']);

/** Unique joints between the given parts and anything: a joint listed on both mating parts counts once (the larger of the two sums). */
export function jointTally(
  parts: Part[],
  ids: Set<string>,
  type: Joint['type'],
  keyOf: (j: Joint) => string = (j) => j.size ?? '',
  maxStep = Infinity,
): Map<string, number> {
  const step = new Map(parts.map((x) => [x.id, x.step]));
  const dir = new Map<string, Map<string, number>>(); // pair+key -> from -> count
  for (const x of parts) {
    for (const j of x.joints ?? []) {
      if (j.type !== type) continue;
      if (!ids.has(x.id) && !ids.has(j.to)) continue;
      if (x.step > maxStep || (step.get(j.to) ?? 0) > maxStep) continue; // the mate is not on the sled yet
      const pair = [x.id, j.to].sort().join('~');
      const key = `${pair}|${keyOf(j)}`;
      let m = dir.get(key);
      if (!m) dir.set(key, (m = new Map()));
      m.set(x.id, (m.get(x.id) ?? 0) + j.count);
    }
  }
  const out = new Map<string, number>();
  for (const [key, m] of dir) {
    const k = key.slice(key.indexOf('|') + 1);
    out.set(k, (out.get(k) ?? 0) + Math.max(...m.values()));
  }
  return out;
}

const dominoKey = (j: Joint): string => /^\s*(\d+)\s*×\s*(\d+)/.exec(j.size ?? '')?.slice(1, 3).join('×') ?? (j.size ?? '?');

/** "4×20 ×18, 5×30 ×8" */
function dominoText(c: StepCtx, maxStep = Infinity): string {
  const t = jointTally(c.parts, new Set(c.mine.map((x) => x.id)), 'domino', dominoKey, maxStep);
  return [...t.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
}

/** Total of one joint type touching the step's parts, with the mating part listed on one side only counted once. */
function count(c: StepCtx, type: Joint['type']): number {
  return [...jointTally(c.parts, new Set(c.mine.map((x) => x.id)), type, () => '').values()].reduce((s, n) => s + n, 0);
}

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

const roughSize = (x: Part | undefined): string => (x?.rough ? `${inch(x.rough.t)} × ${inch(x.rough.w)} × ${inch(x.rough.l, 2)}` : sizeOf(x));
const sizeOf = (x: Part | undefined): string => (x?.stock ? `${inch(x.stock.t)} × ${inch(x.stock.w)} × ${inch(x.stock.l, 2)}` : '');

/** Epoxy cure text at 70 °F and at 60 °F (winter shop). */
export function cureText(h: Hardener, clamp: string): string {
  const c = HARDENERS[h];
  const k = epoxyTimeFactor(60);
  const r = (lo: number, hi: number): string => `${f(lo * k, 0)}-${f(hi * k, 0)}`;
  return (
    `${clamp} West 105/${c.label}: pot life ${c.potMin[0]}-${c.potMin[1]} min at 70 °F (mix in small batches, pour thin in a tray), clamp ${c.clampHours[0]}-${c.clampHours[1]} h, ` +
    `full cure ${c.fullHours} h+. Winter shop at 60 °F: pot ${r(...c.potMin)} min, clamp ${r(...c.clampHours)} h; below 55 °F it will not cure.`
  );
}

// ---- step templates (in build order) ----

const TEMPLATES: Template[] = [
  // ---------------- preparation (no parts in the model) ----------------
  {
    id: 'verify',
    title: 'Verify before ordering',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['calipers', 'ruler', 'scale', 'luggage scale'],
    build: (c) => {
      const list = verifyChecklist(c.parts, c.p);
      const before = list.filter((v) => v.when === 'before ordering');
      const cutting = list.filter((v) => v.when === 'before cutting');
      return {
        instructions: [
          `Work through the checklist (verify.ts): ${plural(before.length, 'item')} before ordering, ${plural(cutting.length, 'item')} before cutting.`,
          `Before ordering: ${before.map((v) => v.title).join('; ')}.`,
          `Before cutting: ${cutting.map((v) => v.title).join('; ')}.`,
          'Buy ONE of the wheel and the tube first; order the lot only when the squash, bore, hub and rating pass. Enter any measured value in its param and re-run the checks.',
        ],
        checks: before.map((v) => `${v.id}: ${v.pass}`),
      };
    },
  },
  {
    id: 'mill',
    title: 'Mill the oak and resaw the strips',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['jointer', 'planer', 'table saw', 'bandsaw', 'planer sled or drum sander', 'moisture meter'],
    build: (c) => {
      const bands = c.parts.filter((x) => x.kind === 'bentlam' && !x.plies);
      const rails = c.parts.filter((x) => x.plies && x.plies > 1);
      const band = bands[0];
      const rail = rails[0];
      const spare = (n: number): number => Math.ceil(n * 1.25);
      const nRailStrips = rails.reduce((s, x) => s + (x.plies ?? 0), 0);
      const allow = c.p.millingAllowanceIn;
      return {
        instructions: [
          `Mill every oak part to rough size: finished + ${inch(allow)} thickness and width, + ${inch(4 * allow)} length (millingAllowanceIn); quantities by board thickness are in the cut list.`,
          band
            ? `Band strips: ${bands.length} (${spare(bands.length)} with 25 % spares), rough ${roughSize(band)} (finished ${sizeOf(band)}), resawn from 4/4 (kerf ${inch(c.p.resawKerfIn)}), planed or drum-sanded to ${inch(band.stock!.t)}. A 5 ft board does NOT make them: buy 6 ft or longer (D-62).`
            : 'Band strips: none in this model.',
          rail
            ? `Rail strips: ${plural(nRailStrips, 'strip')} (${spare(nRailStrips)} with spares), rough ${roughSize(rail)} (finished ${sizeOf(rail)}), two per rail, from 4/4; thin and 3" wide, so use a planer sled or drum sander.`
            : 'Rail strips: none in this model.',
          'Bandsaw blanks from thick stock: brake knees (2.5"), brake shoes (3"), chocks (3.5"), handlebow (1.25" × 4.4"), tongue (1.75" × 6").',
          'Mill strips and bandsaw blanks the day they are glued or bent; thin strips cup overnight. Sticker the rest and keep it at 6-9 % moisture.',
        ],
        checks: ['Moisture 6-9 % on every board', 'Strip thickness uniform within 0.005" (feel for ridges)', 'Strips straight-grained with no knots in the bend'],
      };
    },
  },
  {
    id: 'shaper',
    title: 'Cut the Shaper parts and make the forms',
    kind: 'prep',
    steps: [0],
    view: 'top',
    tools: ['Shaper Origin', 'ShaperTape', 'bandsaw', 'drill press', '3/4" MDF'],
    build: (c) => {
      const shaper = c.parts.filter((x) => x.fab === 'shaper-origin');
      const web = c.parts.find((x) => /^side-L-web$/.test(x.id));
      const t = bowTaper(c.p);
      const thin = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t < 0.3);
      const thick = shaper.filter((x) => x.kind === 'sheet' && x.stock && x.stock.t >= 0.3);
      const oak = shaper.filter((x) => x.kind !== 'sheet');
      return {
        instructions: [
          `Shaper files (shaper-svg): ${shaper.length} parts. 4 mm okoume: ${thin.map((x) => x.id).join(', ')}. 12 mm okoume: ${thick.map((x) => x.id).join(', ')}. Oak: ${oak.map((x) => x.id).join(', ')}.`,
          web
            ? `Each side web is ONE piece from the full 4' × 8' sheet, cut to the flat development (${inch(web.stock!.l, 2)} long, not the plan length; D-68). Nest per the nesting drawing; the seat back comes from the deck offcut.`
            : 'Side webs: one piece each from the full 4\' × 8\' sheet.',
          `S-form: two 3/4" MDF cauls for the plan turn-in, ${inch(t.turnIn, 2)} each side from x = ${f(t.x0)}" to x = ${f(t.x1)}" (tightest radius ${t.minRadiusIn > 1e6 ? 'n/a' : inch(t.minRadiusIn, 0)}, D-66); the rails bend on the same form. Mirror S-ramps about 1.25" high × 14" long for the bow end.`,
          'Templates: handlebow arc, bulkhead crown, brake flap and knee (forms.ts). Check the 1" square on each printout before cutting.',
          'Cut the dados (web-end dados open through the top edge, deck dado run into them at each corner as one pocket; see the Shaper files), hand-holds and the Domino / tenon mortises as each assembly step calls for them.',
          'Bend-test a dry oak strip on the form (cut 25 % spare strips). If it cracks, plane thinner or add a minute of damp heat.',
        ],
        checks: ['Verify items marked "before cutting" are done', 'Web blank measures the flat-development length; fits the sheet', 'A dry strip takes the S without cracking'],
      };
    },
  },
  {
    id: 'seal',
    title: 'Seal the sheet parts and dados',
    kind: 'prep',
    steps: [0],
    view: 'iso',
    tools: ['foam roller', 'brush', 'epoxy pumps', 'scotch-brite'],
    hardener: '206',
    clamp: 'Let the coat go off before handling.',
    build: (c) => ({
      instructions: [
        'Epoxy-seal every dado (transom, bulkhead), the deck faces and edges, and all ply faces and edges (webs, signs, storage panels, seat back, lid). This is coat 1 of the finishing schedule.',
        `The deck dado and the deck gap under the inner chine band are deck + ${inch(c.p.deckSlopIn)} tall, so the sealed deck still enters; check with a feeler.`,
        'Wash or sand the amine blush off any face that will be glued again (warm water + Scotch-Brite, dry; 120 grit).',
        'Use 105/207 (the finishing-schedule epoxy; its times are within 10 % of the 206 figures below). Keep glue faces on the oak bands and rails bare.',
      ],
      checks: ['Sealed deck enters its dado with a feeler (deckSlopIn clearance)', 'No bare ply edge left on any sheet part'],
    }),
  },

  // ---------------- 3: frame ----------------
  {
    id: 'rails',
    title: 'Bend-laminate the rails',
    kind: 'build',
    steps: [STEP.frame],
    match: /^rail-[LR]$/,
    view: 'top',
    tools: ['S-form', 'clamps', 'epoxy pumps', 'planer', 'router', 'Domino'],
    hardener: '206',
    clamp: 'Two strips per rail, glued face to face on the plan form, clamped every 4" and left in the form.',
    build: (c) => {
      const rail = c.mine[0];
      const dom = jointTally(c.parts, new Set(c.mine.map((x) => x.id)), 'domino', dominoKey);
      const chine = [...dom.entries()].filter(([k]) => k === '4×20').reduce((s, [, n]) => s + n, 0);
      return {
        instructions: [
          `Glue ${plural(rail?.plies ?? 2, 'strip')} per rail (${sizeOf(rail)} each), epoxy lightly thickened (406), on the S-form with wax paper; ${c.mine.length} rails, one cure each unless there are two forms.`,
          'Clamp every 4" (about 15 clamps per rail); only the last 29" is curved.',
          'After cure: plane the edges flush, leave the rail 1/2" LONG at both ends (trimmed at the dry fit, S1), cut the 45° step and the beam / hanger notches.',
          `Mortise the rail tops: Dominos ${dominoText(c) || '4×20 / 5×30'}${chine ? ` (the ${chine} 4×20 are the chine ties, every 6")` : ''}; loose-tenon mortises in the rail ends for the transom and bulkhead.`,
        ],
        checks: ['Rails match the plan form within 1/16"', 'No gaps in the glue lines; rails flat and not twisted'],
      };
    },
  },
  {
    id: 'hangers',
    title: 'Rear axle hangers on the rails',
    kind: 'build',
    steps: [STEP.frame],
    match: /^axle-hanger-[LR]$/,
    view: 'top',
    tools: ['drill', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    clamp: 'Clamp the hanger to the rail inner face while the epoxy goes off; bolts after the clamp comes off.',
    build: (c) => {
      const h = c.mine[0];
      return {
        instructions: [
          `Before the frame glue-up, rails flat on the bench: epoxy each hanger (${sizeOf(h)}) side-grain to the rail inner face (5" × 3" glue area), then 2 × 1/4" 316 bolts through hanger and rail, nylock nuts and fender washers on the outside face, above the beam notch.`,
          'Hanger bottom is notched 2.38" × 1.35" to straddle the beam and bear on its top (bandsaw + chisel, 1/4" corner radius).',
          `Cut the 5×30 Domino mortises for joist-1 in the hanger edges now (${dominoText(c) || 'per joint list'}); joist-1's ends engage them in the frame glue-up.`,
        ],
        checks: ['Hangers mirror each other: same distance from the transom', 'Notches in line (string or straightedge across)'],
      };
    },
  },
  {
    id: 'frame',
    title: 'Frame and deck as one unit',
    kind: 'build',
    steps: [STEP.frame, HULL_STEP.deck],
    view: 'top',
    tools: ['Domino', 'drill press', 'clamps', 'sandbags or vacuum bag', 'epoxy pumps', 'square'],
    hardener: '206',
    clamp: 'Right side up on a flat bench: deck on top of the frame, weighted (sandbags or vacuum bag).',
    build: (c) => {
      const deck = c.by('deck');
      const dom = dominoText(c, HULL_STEP.deck);
      return {
        instructions: [
          `Day before: epoxy the seat-hinge backers (1" oak pads) to the deck underside; butt each to the joist-3 face so the flat-latch pin lands in solid oak.`,
          `King beam: bore the 5/8" kingpin hole square on the drill press and cut the nut slot from the front (about 1" × 0.75" at the top) before the deck goes on.`,
          `Dry-fit rails (1/2" long both ends), joists and king beam: Dominos ${dom || '5×30'}, epoxy; joist-1 is cut back 0.88" at each end for the axle hangers.`,
          `Glue-up: Domino the crossmembers to the rails, thickened epoxy (406) on every top face (rails, joists, king beam), set the sealed deck${deck ? ` (${sizeOf(deck)})` : ''} on top, weight it.`,
          'Deck bonds full length to the rail tops and joist tops; the rails stay long, the deck edge follows the web plan.',
        ],
        checks: ['Frame square: diagonals equal within 1/16"', 'Deck flat on a straightedge (no twist or rocking)', 'Squeeze-out cleaned from the deck edge before it goes into the dado gap'],
      };
    },
  },

  // ---------------- 4.2: sides ----------------
  {
    id: 'sides-inner',
    title: 'Side sandwiches, cure 1: web, inner bands and sign backers',
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(web|chine-in|gunwale-in)|sign-backer-[LR]\d)$/,
    view: 'side',
    tools: ['S-form + S-ramp', 'cleats and screws', 'C-clamps / spring clamps', 'epoxy pumps', 'drill'],
    hardener: '206',
    clamp: 'One face per cure: lay the web FLAT on the S-ramp under the bow end, cleat the sheer line every 4-5", clamp across the bands every 4-5" (about 14 per band pair).',
    build: (c) => {
      const web = c.by('side-L-web');
      const inn = c.by('side-L-chine-in');
      const gun = c.by('side-L-gunwale-in');
      const backer = c.by('sign-backer-L1');
      return {
        instructions: [
          `Per side: glue the inner chine band (${sizeOf(inn)}) and inner gunwale band (${sizeOf(gun)}) full-face to the inside of the ${inch(web?.stock?.t ?? 0.157)} web with thickened epoxy, and bend web + bands together on the S-form. No grooves.`,
          'The inner chine band stops 0.512" short of the web bottom (deck + clearance): that gap is the deck rabbet, nothing is routed. Use a spacer stick.',
          'Cleat the sheer line (screws into a sacrificial table every 4-5", the whole length): an edge-bent strip pushes about 65 lbf sideways at mid-span per band until the epoxy cures.',
          `Sign backers: ${c.mine.filter((x) => /^sign-backer/.test(x.id)).length} oak strips (${sizeOf(backer)}, grain vertical) epoxied inside the web, 0.15" under the inner gunwale band, with two #10-32 × 3/8 inserts each, 1.6" apart. Keep the signs clear of the flag blocks (x ≥ -8.2").`,
          'Left and right in turn on the same form: two cures per side, four in all (a second set of cauls halves the time).',
        ],
        checks: ['Sheer line follows the web pattern', 'Bands fully bonded, no lift at the bow bend (tap test)', 'Bend-test strip behaved on the form'],
      };
    },
  },
  {
    id: 'sides-outer',
    title: 'Side sandwiches, cure 2: outer bands and scuppers',
    kind: 'build',
    steps: [HULL_STEP.sides],
    match: /^(side-[LR]-(chine|gunwale)|scupper-.*)$/,
    view: 'side',
    tools: ['S-form + mirror S-ramp', 'cleats and screws', 'clamps', 'epoxy pumps', 'drill'],
    hardener: '206',
    clamp: 'Flip the web onto the mirror ramp; same cleats and clamp spacing as cure 1.',
    build: (c) => {
      const out = c.by('side-L-chine');
      const gun = c.by('side-L-gunwale');
      const scup = c.mine.filter((x) => /^scupper/.test(x.id));
      return {
        instructions: [
          `Per side: glue the outer chine band (${sizeOf(out)}) and outer gunwale band (${sizeOf(gun)}) to the outside face; the chine band bottom is flush with the deck-underside level (it rests on the rail).`,
          'The gunwale band is bent on edge to the concave sheer and across its thickness to the S together; the web stops 0.125" under the band top, fill that gap with thickened epoxy and trim the top flush.',
          'Joints in the bands (if you scarf two pieces, 8:1): middle third only, never in the first 4" behind the transom, under the grab boards, lash doublers or sign stations; stagger 12" from the mate on the same face.',
          `Scuppers: drill ${plural(scup.length, 'hole')} (3/8", rear and bow, lower edge just above the deck level) through inner band, web and outer band, line with epoxy, bed the 316 nipples.`,
          'Leave all bands and webs long: they are cut to the measured length at the dry fit.',
        ],
        checks: ['Four bands per side bonded; free web 1.0" at the bow and 11.0" at the rear', 'Both sides are mirror images within 1/16"'],
      };
    },
  },
  {
    id: 'dry-fit',
    title: 'Dry-fit, measure and trim to length',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'top',
    tools: ['tape', 'story stick', 'table saw or bandsaw', 'hand plane'],
    build: (c) => ({
      instructions: [
        'Stand both side assemblies inverted in the jig. Turn the frame + deck unit over and drop it in DRY: the Dominos (all vertical) engage and the deck edge rises into the gap under the inner chine band.',
        `Check the deck slot: ${inch(c.p.deckSideClearIn, 4)} a side to each web (D-63). Pare the deck edge if it binds; thickened epoxy fills the slot later.`,
        'Measure from the rear transom dado to the bow bulkhead dado; cut bands and webs to that length less 1/32" and trim the frame rails (left 1/2" long) to match (S1).',
        'Rehearse the whole close (transom first, bulkhead on a second batch) with clamps and cauls in place.',
      ],
      checks: ['Length measured on both sides within 1/32"', 'Unit drops in without forcing', 'Rails, bands and webs end at the same station'],
    }),
  },
  {
    id: 'lower',
    title: 'Lower the frame + deck unit into the inverted sides',
    kind: 'process',
    steps: [HULL_STEP.sides],
    view: 'iso',
    tools: ['epoxy pumps', 'clamps', 'drill', 'screwdriver'],
    hardener: '206',
    clamp: 'Clamp the chine bands to the rails at every other Domino; screws up through the rails.',
    build: (c) => {
      const all = new Set(c.parts.map((x) => x.id));
      const dom = jointTally(c.parts, all, 'domino', (j) => (/^4×20/.test(j.size ?? '') ? '4×20' : '')) .get('4×20') ?? 18;
      return {
        instructions: [
          `Bed the 3/8" bearing face of each rail in epoxy; fit the ${dom} Dominos (4×20, every 6", ${f(dom / 2, 0)} per side) in the rail-top mortises, then lower the unit vertically (two people).`,
          'Fill the deck slot at each web with thickened epoxy; the deck edge rises 0.17" under the inner chine band.',
          'Screws up through the rails into the chine band at every other Domino; wipe squeeze-out inside the dados before it kicks.',
          'One batch per side so the mix never outlives its pot life.',
        ],
        checks: ['Both webs seat fully in the rails with no daylight at the chine', 'Hull diagonals equal within 1/8"'],
      };
    },
  },

  // ---------------- 4.4: close the ends ----------------
  {
    id: 'transom',
    title: 'Close the rear: transom with its backers',
    kind: 'build',
    steps: [HULL_STEP.transom],
    match: /^transom-/,
    view: 'iso',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps', 'router', 'drill'],
    hardener: '209',
    clamp: 'Two pipe clamps along the length; clamp backers with a caul the evening before.',
    build: (c) => {
      const transom = c.by('transom-rear');
      const bands = count(c, 'glue');
      return {
        instructions: [
          `Bench, the day before: drill the push-handle socket holes, epoxy the ${plural(c.mine.filter((x) => /backer/.test(x.id)).length, 'backer')} (0.75" oak) to the inside of the transom (${sizeOf(transom)}), full face.`,
          'Close ONE end first (S1). The transom slides in X onto the deck edge, both web ends (their dados, open at the top), the rail tenons and the four band ends per side (epoxy fillet butts, no Dominos): about a dozen joints in one glue-up.',
          'Use the 120-minute slow epoxy (209) and rehearse twice. The 1/8" vent holes in the dados let air and epoxy escape; bung them after.',
          `Joint count at the transom: ${plural(bands, 'epoxy joint')}, mortise-and-tenon ×${count(c, 'mortise-tenon')}.`,
        ],
        checks: ['Transom square to the deck and plumb', 'Vent holes show a bead of epoxy (dados filled)', 'Hull length unchanged from the dry-fit measure'],
      };
    },
  },
  {
    id: 'bulkhead',
    title: 'Close the bow: bulkhead',
    kind: 'build',
    steps: [HULL_STEP.transom],
    match: /^bow-bulkhead$/,
    view: 'iso',
    tools: ['pipe clamps (2)', 'cauls', 'epoxy pumps'],
    hardener: '209',
    clamp: 'Second batch, after the transom epoxy has kicked (3-6 h); two pipe clamps along the length.',
    build: (c) => {
      const b = c.by('bow-bulkhead');
      return {
        instructions: [
          `Bulkhead ${sizeOf(b)} (rear face is the rider's foot brace): dados open at the top take the web ends, a deck dado run into them takes the deck edge, Dominos into the rails (D-69), four band ends per side butt with an epoxy fillet.`,
          'Second, fresh batch of 209 so the close never runs against the first pot life. Fillet the inside corners with thickened epoxy.',
          'The lift hand-hold is already cut; keep epoxy out of it and out of the lamp-clip fit.',
        ],
        checks: ['Bulkhead square and at the right station (x of the dry-fit mark)', 'Web and deck seated in their dados, no gaps'],
      };
    },
  },

  // ---------------- 4.5-4.6: running gear (hull still inverted) ----------------
  {
    id: 'rear-beam',
    title: 'Rear beam, axle and hold-downs',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-R|axle-R|clamp-R[LR]\d|beam-hold-down-[LR])$/,
    view: 'under',
    tools: ['drill press', 'router (groove)', 'wrenches', 'torque wrench'],
    build: (c) => {
      const bolts = count(c, 'bolt');
      return {
        instructions: [
          `Cut the axle groove ${inch(c.p.axleDiameterIn - c.p.axleProudIn, 2)} deep so the ${inch(c.p.axleDiameterIn, 2)} tube stands ${inch(c.p.axleProudIn, 2)} proud and the clamp plate bears on the tube.`,
          `Lay the ${inch(c.p.axleDiameterIn, 2)} × ${inch(c.p.axleWallIn, 3)} DOM tube in the groove (oil the bore, cap the ends; cotter cross holes ${inch(c.p.axleCrossHoleDiaIn, 3)} near each end).`,
          '316 clamp plates (2.25" × 1.5" × 0.25"): two 0.38" × 3-1/4" bolts each, 1.5" apart, nylock nuts and fender washers under the beam. Shim the plate ends with tape on the first tightening; snug plus a quarter turn; recheck the nuts before each event (oak creeps).',
          'Beam passes under the rail and bears on the notch ceiling; hold-down angles: two 1/4" bolts through the upright leg and the hanger, two 1/4" × 3 down through the flat leg and the beam, either side of the tube.',
          `${plural(bolts, 'bolt')} in this step, all 316.`,
        ],
        checks: ['Tube centered: equal length out each side', 'Plate does not rock after tightening', 'Beam square to the rails (diagonals from the transom corners)'],
      };
    },
  },
  {
    id: 'front-beam',
    title: 'Front axle: beam, kingpin, stub axles, roll pads',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^(beam-F|axle-F[LR]|clamp-F[LR]\d|king-thrust|kingpin|roll-pad-[LR]|steer-(eye|anchor)-[LR])$/,
    view: 'under',
    tools: ['drill press', 'wrenches', 'router (grooves)', 'tape / shims'],
    build: (c) => ({
      instructions: [
        'UHMW thrust disc to the king beam: three #8 flat-head screws, counterbored from the disc side.',
        `Kingpin: ${inch(c.p.kingpinDiaIn, 3)} grade 8 bolt, head and plate washer under the axle beam, up through beam, disc and king beam; nylock nut and washer in the slot at the top of the king beam: snug, then back off a quarter turn so the axle swings freely.`,
        'Stub axles in their grooves (0.05" proud); two clamp plates per end, same bolts as the rear (grip 2.5"). Cut the groove 0.70" deep.',
        'Roll pads (2" × 3" × 1/4" UHMW) screwed beside the stub grooves; shim 0.05" off the beam; set the running gap under the rail to about 0.1" (0.03"-1/8") with tape.',
        'Eye bolts (3/8" forged shoulder) fore-aft through the beam 8" from the kingpin and the anchors through the chain joist 7.8" off the center line: nylock nuts, 2" washers.',
      ],
      checks: ['Axle swings freely through the full lock (±' + f(c.p.steerLockDeg, 0) + '°) with no drag', 'Roll-pad gap 0.03"-1/8"', 'Clamp plates clear the king beam by 1/8"'],
    }),
  },
  {
    id: 'wheels',
    title: 'Wheels',
    kind: 'build',
    steps: [STEP.steering, STEP.gear],
    match: /^wheel-/,
    view: 'under',
    tools: ['wrench', 'cotter-pin pliers', 'tire gauge'],
    build: (c) => ({
      instructions: [
        `${plural(c.mine.length, 'wheel')} on the axles: ${inch(c.p.wheelBoreIn, 2)} bore on the ${inch(c.p.axleDiameterIn, 2)} tube, sealed bearings; collar and cotter pin 1" beyond the hub.`,
        `Inflate to the squash-test pressure (verify item 1); check track: ${f(c.p.frontTrackIn, 1)}" front, ${f(c.p.rearTrackIn, 1)}" rear.`,
        'Spin each wheel: no rub on the beam end, clamp plate or brake knee; no end float beyond 1/16".',
      ],
      checks: ['All four wheels spin freely and run true', 'Axles square: front and rear wheelbase measured on both sides within 1/8"'],
    }),
  },
  {
    id: 'flip',
    title: 'Turn the hull upright',
    kind: 'process',
    steps: [STEP.gear],
    view: 'iso',
    tools: ['padded horses', '4 people'],
    build: (c) => {
      const present = c.parts.filter((x) => x.step <= STEP.gear && !x.payload && x.group !== 'reference');
      const mass = present.reduce((s, x) => s + x.massLb, 0);
      return {
        instructions: [
          `The hull with axles and wheels weighs about ${f(mass, 0)} lb (plus fasteners): four people, padded horses.`,
          'Before the lift: every axle bolt and nut snug, wheels chocked or taped, nothing loose in the hull. Lift at the rails and the bulkhead, never by the axles or the sides.',
          'Roll it onto its wheels; the rest is fitted upright. Check the clearances under the rails with the hull on its wheels (tongue next).',
        ],
        checks: ['Hull sits level on four wheels (no rocking)'],
      };
    },
  },

  // ---------------- 4.7-4.9: steering linkage, tongue, bridle ----------------
  {
    id: 'tongue',
    title: 'Tongue, bridle and check chains',
    kind: 'build',
    steps: [STEP.linkage, STEP.spindles],
    view: 'front',
    tools: ['wrenches', 'drill press', 'rope', 'files'],
    hardener: '206',
    clamp: 'Epoxy the bronze sleeve in its hole and let it go off before the rope is run.',
    build: (c) => {
      const tongue = c.by('bridle-tongue');
      return {
        instructions: [
          `Tongue (${sizeOf(tongue)}, on edge, 1.25" × 1.75" at the stem): two 0.38" × 6-1/4" carriage bolts fore-aft through the T head and the whole axle beam, nylock nuts and fender washers on the rear face.`,
          `${inch(c.p.tongueSleeveBoreIn, 3)} bore bronze sleeve (1" OD) epoxied in the hole across the stem, 1.5" from the tip; ease both bore ends so the rope bears on a round edge.`,
          `Bridle: ${inch(c.p.bridleRopeDiaIn, 3)} nylon through the sleeve, once round the tongue tip, bowline round the standing part, whip the end. The rope is the weak link; replace it when glazed or stiff.`,
          'Check chains: quick links to the beam eye and the anchor eye, 8.89" between rings; with the axle straight it hangs 2.68" slack and takes up at the lock.',
        ],
        checks: ['Chain goes taut at full lock before the tire touches anything', 'Tongue square to the beam; bridle pulls the axle freely both ways', 'Chain clears the king beam and the clamp plates'],
      };
    },
  },

  // ---------------- 5: seat and storage ----------------
  {
    id: 'storage-box',
    title: 'Storage box: walls, coaming, hinge backers, latch blocks',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^(storage-(side|end|coaming|hinge-backer|latch-block)-|storage-(side|end)-)/,
    view: 'iso',
    tools: ['table saw (45° bevels)', 'tape', 'glass tape', 'epoxy pumps', 'router'],
    hardener: '206',
    clamp: 'Tape-and-fold: outside seams taped, then fillets; clamp the coaming with cauls.',
    build: () => ({
      instructions: [
        'Bevel the 4 mm wall edges at 45° on the table saw, tape the outside seams, fold, then a 3/8" epoxy fillet and 2" glass tape inside each corner (no spline).',
        'Wall bottoms stand on the sealed deck (the deck is the floor): fillet inside, bead outside, so no ply edge is exposed.',
        'Oak coaming (3/8" × 1/2") epoxied to the wall tops with butt corners; round the inboard top edge 1/8". The gasket and lid sit on oak, never on a ply edge.',
        '1" hinge backers epoxied inside the fore end; 3/8" latch blocks (grain vertical) epoxied to the inside of the transom.',
        'Fair the sealed deck with microballoon epoxy to fall about 1/8" toward each aft drain; the drain nipples are fitted at final fit.',
      ],
      checks: ['Box square, fillets continuous', 'Coaming flat across all four walls (gasket seat)', 'Drain falls toward the corners'],
    }),
  },
  {
    id: 'storage-lid',
    title: 'Storage lid: frame, panel and battens',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^storage-(lid|rim)/,
    view: 'iso',
    tools: ['router (mortises, rabbet)', 'epoxy pumps', 'clamps', 'drill'],
    hardener: '206',
    clamp: 'Panel captured in the frame rabbet; frame clamped square while the corners set.',
    build: (c) => ({
      instructions: [
        'Oak lid frame: 3/8" × 3/4" × 1/2" deep blind loose tenons at the four corners; the 4 mm panel sits in a 1/4" × 1/4" rabbet (epoxy-sealed).',
        `${plural(c.mine.filter((x) => /batten/.test(x.id)).length, 'batten')} let 1/4" into the frame sides, epoxy plus 4 plugged stainless screws each from the top, to keep the panel from sagging.`,
        'The lid is engraved DO NOT STEP in the finishing schedule (step 5), before the varnish. It is a seat-cushion lid, not a step (D-58).',
        'Fit the lid to the box with the gasket in place later (final fit); the lid frame underside seals on the gasket.',
      ],
      checks: ['Lid flat and square; sits on the coaming with no rocking', 'Panel flush with the frame'],
    }),
  },
  {
    id: 'seat-blocks',
    title: 'Seat stop blocks and crest strip',
    kind: 'build',
    steps: [STEP.seatStorage],
    match: /^seat-(wedge|crest)/,
    view: 'side',
    tools: ['bandsaw', 'plane', 'clamps', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Wedges screwed from below while the epoxy sets; crest strip clamped with a caul from the front.',
    build: () => ({
      instructions: [
        'Shape the stop blocks to the back angle (bandsaw + plane); epoxy them to the deck and to the box end, and screw from below.',
        'Screw the lid-hinge leaves to the box end first (hinges are listed in final fit; fit the leaves now). Then bed the crest strip (1.5" × 13.5" oak) in a 0.13" layer of thickened epoxy over the box end and the leaves, end to end with each block.',
        'Drill the upright latch hole in the block face: 3/8" blind, 1.0625" deep with a drill stop, 1/16" groove 0.73" from the mouth, 2.00" up from the hinge axis.',
      ],
      checks: ['Crest strip straight along the 13.5" span', 'Blocks mirror each other; hole 0.4" of oak behind the pin'],
    }),
  },
  {
    id: 'seat-back',
    title: 'Seat back, hinges, pins and cushions',
    kind: 'build',
    steps: [STEP.seatStorage],
    view: 'side',
    tools: ['drill press with stop', 'hex key', 'iron (veneer edge)', 'router'],
    hardener: '206',
    clamp: 'Epoxy the inserts in their holes and leave them for the full cure before the first load.',
    build: (c) => {
      const panel = c.by('seat-back-panel');
      return {
        instructions: [
          `Back panel ${sizeOf(panel)} okoume: 2.5" radius top corners, 1/16" oak veneer banding round the edge (flush trim), epoxy-sealed. No ply edge shows.`,
          `Inserts: 3 × #10-32 × 5/16 stainless, hex-drive, epoxied in blind holes 0.344" deep from the front face (drill stop), 1/2" or more from every edge, per hinge. Pull-test one on a scrap first (verify: seat-back).`,
          'Pin holes: 13/32" clearance, bored square at stations ±7.38", 2.00" up from the hinge axis, epoxy-lined.',
          '2" 316 butt hinges: #10-32 × 3/8 screws to the inserts on the back; #8 × 1-1/4 through the deck into the 1" backer pads. The flat-latch pin hole is 3/8" blind, 0.625" deep in the pad, 1/16" groove 0.256" below the deck.',
          'Spring-detent pins on lanyards; cushions on Dual Lock, the seat cushion set back 3/8" from the back so the hinge knuckles clear.',
        ],
        checks: ['Back flips 105° and lies flat; both latches engage in both positions', 'Pin head clears the cushion', 'Seat back does not rock against the crest strip'],
      };
    },
  },

  // ---------------- 6: brake and handle ----------------
  {
    id: 'brake-knees',
    title: 'Brake knees and backers',
    kind: 'build',
    steps: [STEP.brake],
    match: /^brake-(backer|knee)-[LR]$/,
    view: 'side',
    tools: ['bandsaw', 'chisel', 'drill press', 'wrenches', 'epoxy pumps', 'clamps'],
    hardener: '206',
    clamp: 'Backers clamped to the rail and deck underside before the bolts go in; knees clamped to the rail while the bolts go through.',
    build: (c) => {
      const knee = c.by('brake-knee-L');
      return {
        instructions: [
          `Backers (0.75" oak, ${sizeOf(c.by('brake-backer-L'))}) epoxied to the rail inner face and the deck underside, clear of the axle hanger.`,
          `Knee (${sizeOf(knee)}, bandsawn from 2.5" stock): the arm is slotted from the rear, 1.38" wide (tongue + 0.06" a side), leaving two ears. Cut ONE knee first and test it with the real pin and flap (verify: brake).`,
          '4 × 0.38" × 4" 316 bolts per knee (2 columns × 2 rows) through the knee leg and the rail into the backer; heads in counterbores in the knee, fender washers and nylock nuts in 1/2" counterbores in the backer; epoxy the holes and the leg against the rail and chine outer face.',
          'The 0.38" pivot hole is drilled later, with the flap tongue and block clamped in the slot.',
        ],
        checks: ['Knee tops level with each other', 'Knee clears the tire front by the designed margin', 'Bolts are tight after the epoxy has cured'],
      };
    },
  },
  {
    id: 'brake-flaps',
    title: 'Brake flaps, pads, cords and chocks',
    kind: 'build',
    steps: [STEP.brake],
    match: /^brake-/,
    view: 'side',
    tools: ['Shaper Origin', 'bandsaw', 'drill press', 'router (1/4" roundover)', 'contact cement'],
    hardener: '206',
    clamp: 'Shoe and pivot block clamped to the flap while the epoxy sets; contact cement per the can.',
    build: () => ({
      instructions: [
        'Flap (7/8" oak, Shaper-cut from the file): 1/4" roundover on all edges; epoxy-seal before the finish.',
        'Pivot block (2.01" × 1.25" × 0.63") on the tongue: epoxy and 3 × #10 × 1-1/4" flat-head screws. Then drill the 0.38" pin hole across block and tongue together with the knee clamped on; fit the clevis pin in double shear and the hitch-pin clip.',
        'Shoe (bandsawn from 3" stock; top follows the 6° flap underside, bottom cut to the 5.38" tire radius): epoxy and 2 × #10 × 2" screws up into the flap. Pad (3" × 3" × 0.38" rubber): contact cement and 2 × #8 × 1" flat-head screws buried 1/8". Foot tread 4" × 2.5" ribbed rubber, contact cement.',
        'Return cord: 1/4" shock cord with the 3/16" stop cord tied taut at the released length (8.99" between the eyes), snap hook to the transom eye (backer behind it); #10 screw eye in the flap rear end face.',
        'Chocks: oak wedge, ramp 28° tangent to the tire, two stainless screw heads left proud in the base; 30" cord to the eye screw in the knee underside.',
        'Removable (D-65): pull the pin (clip off first), unhook the cord, lift the flap off: about 15 s a side.',
      ],
      checks: ['Pad hangs 0.38" off the tread released and swings onto it when the flap is pressed', 'Flap clears the tire and the transom corner; foot end at the transom face', 'Flap returns by itself when released'],
    }),
  },
  {
    id: 'handle',
    title: 'Push handle: sockets, posts and handlebow',
    kind: 'build',
    steps: [STEP.brake],
    match: /^handle-/,
    view: 'side',
    tools: ['drill press', 'bandsaw', 'router table', 'hex keys', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Bow clamped to both posts (post tops sawn to the 10.7° slope) until the epoxy sets.',
    build: () => ({
      instructions: [
        `Aluminum sockets (6061, 1 × 1.5 × 14, wall 0.13) bedded in epoxy or sealant against the transom; 2 × 1/4-20 × 2 button-head cap screws each, nylon washer under the head, fender washer and nylock nut inside the backer. Push the screws in through the 5/8" access holes in the rear wall, then plug the holes.`,
        'Seal the bare aluminum edges of the access holes with epoxy or touch-up; anodized or epoxy-coated aluminum only (bare aluminum corrodes against wet oak).',
        'Posts (0.69" × 1.19" from 3/4" × 1-1/4" stock): slip fit in the sockets, 0.5" × 0.1875" relief groove down the transom-side face; tops sawn to the bow slope.',
        'Handlebow: one 1.25" × 4.4" × 24" board, edge bandsawn to a 51" radius arc, planed and rounded to a 1.25" grip. Pin each post top with a 3/8" × 2-1/4" 316 rod (1-1/2" deep in the post, 3/4" in the bow) and epoxy: the handle comes off as ONE U.',
        'Clevis pin (5/16") through both socket walls and the post; the parked pin hole is 13.5" up.',
      ],
      checks: ['Posts slide in and out without binding on the screw heads', 'Bow is level and the U is square', 'Handle clears the brake flaps and the tail light'],
    }),
  },

  // ---------------- 7: finish ----------------
  {
    id: 'wood-fitout',
    title: 'Lash doublers and flag blocks (glue before finishing)',
    kind: 'build',
    steps: [STEP.finish],
    match: /^(doubler-lash-|flag-block-)/,
    view: 'iso',
    tools: ['table saw', 'spring clamps', 'epoxy pumps'],
    hardener: '206',
    clamp: 'Spring clamps or tape; no screws into the 4 mm web.',
    build: (c) => ({
      instructions: [
        `${plural(c.mine.filter((x) => /^doubler/.test(x.id)).length, 'doubler')} (1" oak, 2" × 1.5", cut square to the gunwale slope at each station) epoxied to the inboard face of the inner gunwale band; the lash plates screw into them later.`,
        `${plural(c.mine.filter((x) => /^flag-block/.test(x.id)).length, 'flag block')} (0.75" × 1.4" × 1.5", half-round relief) epoxied to the inner gunwale and chine bands in the left rear corner; the tube is held between them and the transom backer.`,
        'Sand the glue faces first (120) and keep epoxy off the faces that get varnish.',
      ],
      checks: ['Doublers sit on the inner band, not over a vent or scupper', 'Flag blocks line up with the tube against the transom backer'],
    }),
  },
  {
    id: 'finish',
    title: 'Finish: stain, epoxy seal, engrave, varnish',
    kind: 'process',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['random-orbit sander', 'rollers and brushes', 'epoxy pumps', 'Shaper Origin (engraving)'],
    build: (c) => {
      const a = finishAreas(c.parts);
      const s = finishingSchedule(c.parts, c.p);
      return {
        instructions: [
          `Follow the finishing schedule (finishing.ts): ${s.steps.map((x) => `${x.n}. ${x.title}`).join('; ')}.`,
          `Wood surface: ${f(a.oakFt2, 0)} ft² oak + ${f(a.okoumeFt2, 0)} ft² okoume; epoxy and varnish quantities are in the schedule.`,
          'Take off the removable pieces (brake flaps, handle, signs, tongue) and finish them on the bench; plug or mask the pivot bores and bolt seats. Hang everything after the varnish has cured.',
        ],
        checks: ['Offcut test panel approved before anything on the sled is stained', 'Every okoume face and edge and all oak end grain are epoxy-sealed', 'Varnish fully hard before hardware goes on'],
      };
    },
  },
  {
    id: 'final-fit',
    title: 'Final fit: grab boards, signs, hardware, lights, reflectors',
    kind: 'build',
    steps: [STEP.finish],
    view: 'iso',
    tools: ['drill', 'hex keys', 'wrenches', 'screwdrivers', 'heat-set insert tip', 'sealant gun'],
    hardener: '206',
    clamp: 'Bedding for the standoff discs, drain nipples and backing strips: epoxy or polysulfide; do not load the grab boards until it has cured.',
    build: (c) => {
      const rest = c.mine.filter((x) => x.id !== 'hardware');
      const kinds = (re: RegExp): number => rest.filter((x) => re.test(x.id)).length;
      return {
        instructions: [
          `Grab boards (${plural(kinds(/^seat-grip-[LR]$/), 'board')}, 0.625" oak): 6 × 1/4" button-head cap screws each through board, inner band, web, outer band and the 1/16" 316 backing strip (bedded on the outside); clamp the board on and drill all layers with one bit. Nut and 1-1/4" fender washer inside. Bolted, never glued.`,
          `Signs (${plural(kinds(/^sign-[LR]$/), 'sign')}): 4 thumb-knob screws (#10-32 × 7/8") through the 3/16" holes, the 0.296" standoff discs (epoxied to the sign back) and the web into the inserts.`,
          'Storage: gaskets (continuous EPDM bulb, spliced at one corner), lid hinge (#8 × 1/2 into the rim, #8 × 1 into the backers), lid stay, draw latches on the transom blocks, catch plates, aft drain nipples epoxied in.',
          `Lash plates (${plural(kinds(/^lash-/), 'plate')}): 4 × #10 × 1-1/4" stainless into each doubler. Flag tube between the blocks, 3/16" drain hole just above the deck.`,
          'Lamp clips snap into the bulkhead and transom hand-holds; heat-set M4 / M3 inserts; reflectors on the gunwale outer face (wipe clean, press 60 s).',
          'Pooled fasteners (hardware): count against the BOM; every fastener 316 stainless.',
        ],
        checks: ['Load test: 300 lbf pull at 45° on one lash plate; hang the sled by the bowline', 'Grab boards solid; signs stay on and do not rattle', 'Lid closes on the gasket with no gap; stay holds'],
      };
    },
  },
];

// ---- builder ----

function generic(step: number, mine: Part[]): Template {
  const groups = [...new Set(mine.map((x) => x.group))].join(', ');
  return {
    id: `step-${String(step).replace('.', '-')}`,
    title: `Model step ${step}: ${groups}`,
    kind: 'build',
    steps: [step],
    view: 'iso',
    tools: [],
    build: () => ({
      instructions: [`Install: ${mine.map((x) => x.id).join(', ')}.`, 'No template for this model step: follow each part\'s joints and notes.'],
      checks: ['Parts fit and fasteners are tight'],
    }),
  };
}

export function assemblySteps(parts: Part[], p: Params): BuildStep[] {
  const real = parts.filter((x) => x.group !== 'reference' && x.kind !== 'reference' && !x.payload);
  const by = (id: string): Part | undefined => parts.find((x) => x.id === id);

  // 1. Hand each part to the first template that names it for its model step.
  const taken = new Map<string, string[]>();
  const assigned = new Set<string>();
  for (const t of TEMPLATES) {
    if (!t.match) continue;
    const mine: string[] = [];
    for (const x of real) {
      if (assigned.has(x.id)) continue;
      if (t.steps.includes(x.step) && t.match.test(x.id)) {
        mine.push(x.id);
        assigned.add(x.id);
      }
    }
    taken.set(t.id, mine);
  }

  // 2. Templates without a `match` that take parts: the seat step takes the remaining step-5 seat parts; the final-fit step takes the rest of step 7.
  const catchAll: Record<string, (x: Part) => boolean> = {
    'seat-back': (x) => x.step === STEP.seatStorage && x.group === 'seat',
    'final-fit': (x) => x.step === STEP.finish,
    tongue: (x) => x.step === STEP.linkage || x.step === STEP.spindles,
    'storage-box': (x) => x.step === STEP.seatStorage && x.group === 'storage',
    frame: (x) => x.step === STEP.frame || x.step === HULL_STEP.deck,
  };
  for (const [tid, test] of Object.entries(catchAll)) {
    const list = taken.get(tid) ?? [];
    for (const x of real) {
      if (assigned.has(x.id) || !test(x)) continue;
      list.push(x.id);
      assigned.add(x.id);
    }
    taken.set(tid, list);
  }

  // 3. Anything still unassigned goes to the last template of its model step, or a generated step.
  const orphans = real.filter((x) => !assigned.has(x.id));
  const extraByStep = new Map<number, Part[]>();
  for (const x of orphans) {
    const host = [...TEMPLATES].reverse().find((t) => t.kind === 'build' && t.steps.includes(x.step));
    if (host) {
      taken.get(host.id)!.push(x.id);
      assigned.add(x.id);
    } else {
      const arr = extraByStep.get(x.step) ?? [];
      arr.push(x);
      extraByStep.set(x.step, arr);
    }
  }

  // 4. Assemble the ordered template list, inserting generated steps by model step.
  const ordered: { t: Template; ids: string[] }[] = [];
  const pending = [...extraByStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, xs]) => ({ t: generic(step, xs), ids: xs.map((x) => x.id) }));
  const keyOf = (t: Template): number => t.steps[0];
  for (const t of TEMPLATES) {
    while (pending.length && keyOf(pending[0].t) < keyOf(t) && t.kind !== 'prep') ordered.push(pending.shift()!);
    const ids = taken.get(t.id) ?? [];
    if (t.kind === 'build' && ids.length === 0) continue; // nothing to install in this model
    ordered.push({ t, ids });
  }
  ordered.push(...pending);

  const byId = new Map(parts.map((x) => [x.id, x]));
  const steps: BuildStep[] = ordered.map(({ t, ids }, n) => {
    const mine = ids.map((i) => byId.get(i)!).filter(Boolean);
    const ctx: StepCtx = { parts, p, mine, by };
    const built = t.build(ctx);
    const modelStep = mine.length ? Math.min(...mine.map((x) => x.step)) : t.steps[0];
    const instructions = built.instructions;
    // Anything this template did not describe individually is still listed, so a reader sees every part id.
    const cure = t.hardener ? HARDENERS[t.hardener] : undefined;
    const clampCure = cure ? cureText(t.hardener!, t.clamp ?? 'Clamp until set.') : undefined;
    const step: BuildStep = {
      n,
      id: t.id,
      kind: t.kind,
      title: t.title,
      modelStep: t.kind === 'prep' ? 0 : modelStep,
      partIds: ids,
      instructions,
      checks: built.checks,
      tools: t.tools,
      view: t.view,
      ...(cure ? { cure: { hardener: cure.hardener, potMin: cure.potMin, clampHours: cure.clampHours, fullHours: cure.fullHours } } : {}),
      ...(clampCure ? { clampCure } : {}),
    };
    return step;
  });

  // Process steps inherit their position's model step (they sit between two build steps), so the list stays nondecreasing.
  let run = 0;
  for (const s of steps) {
    if (s.kind === 'build' && s.partIds.length) run = Math.max(run, s.modelStep);
    else if (s.kind === 'process') s.modelStep = Math.max(run, s.modelStep);
    else if (s.kind === 'prep') s.modelStep = 0;
  }
  // A build step with parts must not fall behind an earlier one.
  let hi = 0;
  for (const s of steps) {
    if (s.modelStep < hi) s.modelStep = hi;
    hi = s.modelStep;
  }
  return steps;
}

/** Part ids present after step `n` (steps with index <= n). Earlier steps solid, step `n` highlighted, later hidden. */
export function cumulativeParts(steps: Pick<BuildStep, 'n' | 'partIds'>[], n: number): string[] {
  const out: string[] = [];
  for (const s of steps) if (s.n <= n) out.push(...s.partIds);
  return out;
}

/** Ids installed by step `n` alone (the highlighted set). */
export function stepParts(steps: Pick<BuildStep, 'n' | 'partIds'>[], n: number): string[] {
  return steps.find((s) => s.n === n)?.partIds ?? [];
}

/** True when a part's joints include a glue-type joint (epoxy): used by tests to demand a clampCure. */
export function hasGlueJoint(x: Part): boolean {
  return (x.joints ?? []).some((j) => GLUE_JOINTS.has(j.type));
}
