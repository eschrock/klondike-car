/**
 * Body (D-54): the deck, the straight captured-ply sides on a sled profile, the curled bow, the rear transom with its lift hand-hold, the scuppers and the (provisional)
 * signs. The earlier tapering, curved hull (D-45, D-52) and its finger guards, front transom and sheer are gone with the Ackermann front end.
 *
 * The hull is straight in plan: two parallel sides a constant `bodyWidthIn` apart. Each side is a straight oak chine at deck level, a 6 mm okoume web captured in grooves,
 * and an oak gunwale whose top follows the sled profile: a straight line (plus an optional gentle sag) from `sideHeightRearIn` above the deck at the rear transom to
 * `sideHeightBowIn` where the side ends against the bow. The deck is ONE flat sheet that ends where the BOW CURL starts: a 4-ply bent lamination of 3 mm okoume, scarfed to the deck,
 * that curls up on `bowCurlRadiusIn` through `bowCurlAngleDeg`, replacing the front transom. Joint records are added in joinery.ts after all parts exist.
 */
import { bowCurl, type Params } from '../params';
import { HULL_STEP, STEP, box, cylinder, roughOf, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { handleGeometry } from './handle';
import { transformPoint } from './bounds';
import { sideSlopeAt, sideTopAt, webTopAt, type Layout } from './layout';
import { compose } from './mat4';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

/** Cosmetic sampling of the curved outlines (D-44): transom crown, rounded corners; the sloped sides and the curl. */
const CROWN_SEGMENTS = 16;
const CORNER_SEGMENTS = 6;
const SIDE_SEGMENTS = 16;
const CURL_SEGMENTS = 12;
const LIFT_SLOT_SEGMENTS = 8;
/** Assembly order and hydraulic-lock relief shared by the notes of the hull parts (build review M4, D-43; HULL_STEP in build-utils.ts has the whole sequence). */
const DECK_ASSEMBLY_NOTE = 'Assembly (M4, D-54): epoxy-seal every face and edge first; the deck is glued to the frame (rails + joists + the king beam and stop blocks) as one unit; the hull is built UPSIDE DOWN, so this unit is turned over and lowered into the inverted side assemblies (the deck edge rises into the chine rabbets, the Dominos engage vertically), and the rear transom slides onto its edge last. The bow curl is scarfed to the deck edge before the sides go on.';
const SIDE_ASSEMBLY_NOTE = 'Assembly (M4, D-54): saw the chine and gunwale straight, plow the web grooves, glue the web into its chine and gunwale on the bench (a side assembly, wipe squeeze-out from the grooves), stand the two assemblies inverted in the jig, and lower the frame + deck unit into them; the rear transom goes on after, sliding in X.';

// ── Small geometry helpers ──
export const frameMat = (ex: Vec3, ey: Vec3, ez: Vec3, o: Vec3): Mat4 => [...ex, 0, ...ey, 0, ...ez, 0, ...o, 1];

export function polyAreaPerim(o: Vec2[]): { area: number; perim: number } {
  let a = 0, per = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perim: per };
}
const signedArea = (o: Vec2[]) => o.reduce((s, q, i) => s + (q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1]), 0) / 2;
const ccw = (o: Vec2[]): Vec2[] => (signedArea(o) >= 0 ? o : [...o].reverse());
const cw = (o: Vec2[]): Vec2[] => (signedArea(o) <= 0 ? o : [...o].reverse());

/** Oak mass in lb for a volume in in³ (no finish): used for groove / dado / banding adjustments. */
const oakLb = (ctx: Ctx, vol: number) => (vol / IN3_PER_FT3) * ctx.p.oakDensityPcf;
/** Oak edge banding along `lenIn` of ply `plyIn` thick (glued strip, flush both faces). */
export const edgeBandLb = (ctx: Ctx, lenIn: number, plyIn: number) => oakLb(ctx, lenIn * ctx.p.edgeBandIn * plyIn);

/** Regular polygon (n-gon) loop in (y, z), CCW. */
function circleLoop(cy: number, cz: number, r: number, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => [cy + r * Math.cos((2 * Math.PI * i) / n), cz + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);
}

// ── Scuppers (build review M7, D-43) ──
const SCUPPER_MASS_LB = 0.03;
/** Hole bottom sits this far above the deck surface (so standing water drains to it); the nipple sticks out this far past the chine. */
const SCUPPER_BELOW_SURFACE_IN = 0.05;
const SCUPPER_STICKOUT_IN = 0.25;
const SCUPPER_END_INSET_IN = 0.5;

export interface ScupperSite { x: number; zone: 'rear' | 'bow'; deckZ: number; hw: number; tagPos: string }
/** Where the drains go: the rear corners (in the backer lane when there is a rear box) and the bow corners, just behind the curl. */
export function scupperSites(ctx: Ctx): ScupperSite[] {
  const { L } = ctx;
  const rearTx = L.xRear + L.transom;
  const r = ctx.p.scupperDiaIn / 2;
  const rear: ScupperSite = { x: rearTx + Math.max(SCUPPER_END_INSET_IN, r + 0.1) * 0.75, zone: 'rear', deckZ: L.deckTop, hw: L.hwC, tagPos: 'rear' };
  const front: ScupperSite = { x: L.xFlatEnd - 1, zone: 'bow', deckZ: L.deckTop, hw: L.hwC, tagPos: 'bow' };
  return [rear, front];
}

/**
 * Top of a transom (D-44), from the right corner over the crown to the left corner: a parabolic arc that is `crown` higher at the
 * center than at the corners (height `zt` at |y| = `wTop`), with each top corner rounded by `rc`. Starts at the foot of the right
 * corner arc (so the caller continues the right side up to it) and ends at the foot of the left one.
 */
export function transomTopOutline(wTop: number, zt: number, crown: number, rc: number): Vec2[] {
  const zc = (y: number) => zt + crown * (1 - (y / wTop) ** 2);
  const r = Math.max(0, Math.min(rc, wTop / 4));
  const right: Vec2[] = [];
  if (r > 1e-6) {
    const cy = wTop - r, cz = zc(cy) - r;
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = (Math.PI / 2) * (i / CORNER_SEGMENTS);
      right.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  } else right.push([wTop, zt]);
  const yIn = right[right.length - 1][0];
  const mid: Vec2[] = [];
  for (let i = 1; i < CROWN_SEGMENTS; i++) {
    const y = yIn - (2 * yIn * i) / CROWN_SEGMENTS;
    mid.push([y, zc(y)]);
  }
  const left = [...right].reverse().map(([y, z]) => [-y, z] as Vec2);
  return [...right, ...mid, ...left];
}

// ── Generic extrusion part (transoms, decks, webs) ──
interface ExtSpec {
  id: string;
  partNo?: string;
  name: string;
  group: PartGroup;
  mat: 'oak' | 'ply' | 'printed';
  outline: Vec2[];
  holes?: Vec2[][];
  depth: number;
  transform: Mat4;
  /** Model-frame point used only to pick the default exploded-view direction. */
  center: Vec3;
  step: number;
  grain?: 'x' | 'y' | 'z';
  edges?: EdgeCondition | EdgeCondition[];
  fab?: Part['fab'];
  removable?: boolean;
  /** Extra mass (edge banding, ...) added to the computed wood mass; negative for rabbets / dados / grooves. */
  extraLb?: number;
  notes?: string;
}

export function extPart(ctx: Ctx, s: ExtSpec): Part {
  const { p } = ctx;
  const outer = polyAreaPerim(s.outline);
  const holes = (s.holes ?? []).map(polyAreaPerim);
  const area = outer.area - holes.reduce((a, h) => a + h.area, 0);
  const rimPerim = outer.perim + holes.reduce((a, h) => a + h.perim, 0);
  const vol = area * s.depth;
  const surf = 2 * area + rimPerim * s.depth;
  const density = s.mat === 'oak' ? p.oakDensityPcf : s.mat === 'ply' ? ctx.d.plyDensityPcf : p.printedDensityPcf;
  let mass = s.mat === 'printed' ? (vol / IN3_PER_FT3) * density : woodMassLb(p, vol, surf, density);
  mass += s.extraLb ?? 0;
  const xs = s.outline.map((q) => q[0]);
  const ys = s.outline.map((q) => q[1]);
  const dims = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), s.depth].sort((a, b) => a - b);
  const stock: Dims | undefined = s.mat === 'printed' ? undefined : { t: dims[0], w: dims[1], l: dims[2] };
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.mat === 'oak' ? 'lumber' : s.mat === 'ply' ? 'sheet' : 'printed',
    material: s.mat === 'oak' ? 'white oak' : s.mat === 'ply' ? ctx.plyName : 'ASA',
    geometry: { type: 'extrusion', outline: s.outline, ...(s.holes ? { holes: s.holes } : {}), depth: s.depth },
    transform: s.transform,
    body: 'chassis',
    massLb: mass,
    fab: s.fab ?? (s.mat === 'printed' ? 'print' : 'cnc'),
    step: s.step,
    // Reuse the subsystem's default exploded-view direction through a throwaway box at the same place.
    explode: box(ctx, { id: s.id, name: s.name, group: s.group, mat: 'oak', size: [1, 1, 1], center: s.center, step: s.step }).explode,
  };
  if (s.partNo) out.partNo = s.partNo;
  if (s.outline.length > 8) {
    // A sloped or curved outline: the area centroid (the bounding-box center is off), D-45.
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < s.outline.length; i++) {
      const [x1, y1] = s.outline[i], [x2, y2] = s.outline[(i + 1) % s.outline.length];
      const cr = x1 * y2 - x2 * y1;
      A += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
    }
    if (Math.abs(A) > 1e-9) out.cgIn = transformPoint(s.transform, [cx / (3 * A), cy / (3 * A), s.depth / 2]);
  }
  if (stock) {
    out.stock = stock;
    if (s.mat === 'oak') out.rough = roughOf(p, stock);
  }
  if (s.grain) out.grain = s.grain;
  if (s.edges) out.edges = s.edges;
  if (s.removable) out.removable = true;
  if (s.notes) out.notes = s.notes;
  return out;
}

// ── Lift hand-hold (M9, D-37): the rear transom only ──
export interface LiftSlot {
  /** Slot z range (model frame) and the transom top it forces (a low crest if the slot pushes above the gunwale line). */
  zBot: number;
  zTop: number;
  transomTop: number;
  /** Oak above the slot, and the transom thickness (section of the grip bar). */
  barIn: number;
  thickIn: number;
  lengthIn: number;
}

/**
 * Hand-hold slot of the rear transom: bottom >= `liftSlotClearIn` above the deck and clear of an abutting storage box. The transom is as tall as the rear side (the sled profile, D-54);
 * `transomTop` is the height of the transom's CORNERS; the crown (`transomCrownIn`) arcs above it at the center, so the oak above the slot only grows (D-37).
 */
export function liftSlot(ctx: Pick<Ctx, 'p' | 'L'>, _end: 'rear' = 'rear'): LiftSlot {
  void _end;
  const { p, L } = ctx;
  const deck = L.deckTop;
  let floor = deck + p.liftSlotClearIn;
  if (L.storage.x0 < L.xRear + L.transom + L.rearLane + 0.5 && L.storage.zTop > L.deckTop) floor = Math.max(floor, L.storage.zTop + 0.25);
  const zBot = floor;
  const zTop = zBot + p.liftSlotHeightIn;
  const transomTop = Math.max(deck + L.sideRear, zTop + p.liftBarMinIn);
  return { zBot, zTop, transomTop, barIn: p.liftBarMinIn, thickIn: L.transom, lengthIn: p.liftSlotLengthIn };
}

/** Stadium-shaped hand-hold outline (CW, for a hole) centered at (y0, zc), local x = model y, local y = model z. */
function slotHole(y0: number, zc: number, len: number, h: number): Vec2[] {
  const r = h / 2;
  const straight = Math.max(0, len - h) / 2;
  const pts: Vec2[] = [];
  for (let i = 0; i <= LIFT_SLOT_SEGMENTS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / LIFT_SLOT_SEGMENTS;
    pts.push([y0 + straight + r * Math.cos(a), zc + r * Math.sin(a)]);
  }
  for (let i = 0; i <= LIFT_SLOT_SEGMENTS; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / LIFT_SLOT_SEGMENTS;
    pts.push([y0 - straight + r * Math.cos(a), zc + r * Math.sin(a)]);
  }
  return cw(pts);
}

/** Grip-bar bending stress above the slot for a lift of `loadLbf` through one slot (simply supported over the slot: conservative). */
export function liftBarStressPsi(s: LiftSlot, loadLbf: number): number {
  const M = (loadLbf * s.lengthIn) / 4;
  const S = (s.thickIn * s.barIn * s.barIn) / 6;
  return M / S;
}

/** Centerline of the bow curl in the x-z plane (the sweep path), from the tangent point to the tip. */
export function curlPath(p: Params, L: Layout): Vec2[] {
  const c = bowCurl(p);
  const zc = L.deckTop - c.thick / 2;
  return Array.from({ length: CURL_SEGMENTS + 1 }, (_, i) => {
    const a = (c.angleRad * i) / CURL_SEGMENTS;
    return [c.xFlatEnd + c.radius * Math.sin(a), zc + c.radius * (1 - Math.cos(a))] as Vec2;
  });
}

/** Sampled outline (x, z) of a sloped side member between z offsets `dz0` (bottom) and the gunwale top: `fn(x)` gives the bottom z. */
function slopedOutline(L: Layout, x0: number, x1: number, bottom: (x: number) => number, top: (x: number) => number): Vec2[] {
  const xs = Array.from({ length: SIDE_SEGMENTS + 1 }, (_, i) => x0 + ((x1 - x0) * i) / SIDE_SEGMENTS);
  void L;
  return [...xs.map((x): Vec2 => [x, bottom(x)]), ...[...xs].reverse().map((x): Vec2 => [x, top(x)])];
}

// ── Body ──
export function buildBody(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const pl = p.panelPlyIn;
  const g = p.grooveDepthIn;
  const dd = p.deckCaptureDepthIn;
  const slop = p.grooveSlopIn;
  const rearTx = L.xRear + L.transom; // inner face of the rear transom
  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds; // deck + clearance (build review MUST-2)
  const curl = L.curl;

  // ── Deck: ONE flat sheet, captured in the chine rabbet all the way along and in a dado in the rear transom; scarfed to the bow curl at its front edge ──
  {
    const x0 = rearTx - dd, x1 = L.xFlatEnd;
    const hw = L.hwC + dd;
    parts.push(extPart(ctx, {
      id: 'deck', name: 'Deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline: [[x0, -hw], [x1, -hw], [x1, hw], [x0, hw]], depth: L.ply, transform: compose([0, 0, L.deckBot]),
      edges: ['captured', 'captured', 'captured', 'captured'],
      notes: `One sheet, ${(x1 - x0).toFixed(1)}" long (fits a 4 x 8 sheet), flat: ${dd}" into a ${dd}" × ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" rabbet in the underside of each chine (deck + ${ds}" clearance, thickened epoxy fills it; the rail top is flush with the deck underside) and into a dado in the rear transom. Its front edge is scarfed (8:1, ${(8 * L.ply).toFixed(1)}") to the bow curl at x = ${x1.toFixed(1)}" over the last joist: no exposed ply edge. ${DECK_ASSEMBLY_NOTE}`,
    }));
  }

  // ── The bow curl (D-54): a bent lamination that continues the deck and curls up, replacing the front transom ──
  {
    const path = curlPath(p, L);
    let arc = 0;
    for (let i = 1; i < path.length; i++) arc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const width = 2 * L.hwC;
    const vol = arc * width * curl.thick;
    const surf = 2 * arc * width + 2 * (arc + width) * curl.thick;
    // Edge banding: the front (top) edge, and the two side edges beyond the end of the sides, where they are exposed (the rest is glued against the side members).
    const beyond = Math.max(0, arc * (1 - (L.xSideEnd - L.xFlatEnd) / Math.max(1e-6, curl.run)));
    const bandLen = width + 2 * beyond;
    const mass = woodMassLb(p, vol, surf, ctx.d.plyDensityPcf) + edgeBandLb(ctx, bandLen, curl.thick);
    const cx = path.reduce((a, q) => a + q[0], 0) / path.length;
    const cz = path.reduce((a, q) => a + q[1], 0) / path.length;
    const stock: Dims = { t: curl.thick, w: width, l: arc };
    const ply = curl.thick / p.bowCurlPlies;
    parts.push({
      id: 'bow-curl', partNo: 'bow-curl', name: 'Bow curl (bent lamination)', group: 'body', kind: 'bentlam', material: ctx.plyName,
      geometry: { type: 'sweep', path, width, thickness: curl.thick, plies: p.bowCurlPlies },
      transform: compose([0, 0, 0]), body: 'chassis', massLb: mass, fab: 'bentlam', step: HULL_STEP.sides, stock, edges: 'edged', grain: 'x',
      cgIn: [cx, 0, cz], explode: [1, 0, 0.6],
      notes: `${p.bowCurlPlies} plies of ${ply.toFixed(3)}" okoume bending ply (${(curl.thick).toFixed(3)}" thick, the deck's thickness) laid up with epoxy on a one-piece form: it runs flat from the deck's front edge at x = ${L.xFlatEnd.toFixed(1)}" (scarfed 8:1 to the deck over the last joist) and curls up on a ${curl.radius}" centerline radius through ${p.bowCurlAngleDeg}° to the tip at x = ${L.xFront.toFixed(1)}", ${curl.rise.toFixed(1)}" above the deck. Inside radius ${curl.rIn.toFixed(1)}" against a cold-bend limit of ${(p.hullLamMinRadiusFactor * ply).toFixed(1)}" (${p.hullLamMinRadiusFactor} x one ply). ${width.toFixed(1)}" wide (the inside width of the hull): the side members end against it where its inside face has risen to the bow side height (x = ${L.xSideEnd.toFixed(1)}"). The front edge and the exposed side edges are banded in ${p.edgeBandIn}" oak; the bridle does NOT tie to it: the steel tongue plate reaches under the bow to the tie hole (D-56). Structural: it carries the bow and the end joist under its scarf.`,
      sourcing: { vendor: `Shop-laminated: ${p.bowCurlPlies} sheets of 3 mm okoume bending ply (Hydrotek / Aquatek 3 mm or similar), epoxied on a bending form`, costUsd: 30 },
    } as Part);
  }

  // ── Sides (D-54): straight in plan; the gunwale and web follow the sled profile ──
  const x0s = L.xSideStart, x1s = L.xSideEnd;
  const zChine0 = L.chineBot;
  const sideLen = x1s - x0s;
  for (const { s, tag } of SIDES) {
    const yc = s * (L.hwC + L.side / 2); // member centerline (the web plane)
    const frameAt = (thick: number): Mat4 => frameMat([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, yc + thick / 2, 0]);
    const id = `side-${tag}`;
    const nm = s > 0 ? 'Left' : 'Right';
    // Chine: a straight oak bar at deck level.
    {
      const grooveLb = oakLb(ctx, sideLen * (pl + slop) * g);
      const rabbetLb = oakLb(ctx, sideLen * dd * rabbetH(L.deckTop, L.deckBot));
      const chine = box(ctx, {
        id: `${id}-chine`, partNo: 'side-chine', name: `${nm} chine`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x',
        size: [sideLen, L.side, L.chineH], center: [(x0s + x1s) / 2, yc, zChine0 + L.chineH / 2],
      });
      chine.massLb -= grooveLb + rabbetLb;
      chine.notes = `Straight oak bar ${sideLen.toFixed(1)}" long (D-54: no curve), bottom at the deck underside level (${L.chineBot.toFixed(2)}", one deck level). Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web; an underside rabbet ${dd}" × ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" (deck + ${ds}" clearance) holds the deck edge; it rests on the rail and is Domino-tied to it (vertical Dominos, D-43). Its forward end, beyond the end of the flat deck, lies alongside the rising bow curl. ${SIDE_ASSEMBLY_NOTE}`;
      parts.push(chine);
    }
    // Gunwale: sawn from a wide board to the sled line (a straight sloped bar, optionally with a gentle sag).
    {
      const top = (x: number) => sideTopAt(L, x);
      const outline = slopedOutline(L, x0s, x1s, (x) => top(x) - L.railBand, top);
      const grooveLb = oakLb(ctx, sideLen * (pl + slop) * g);
      const slope = (sideSlopeAt(L, x0s) * 180) / Math.PI;
      parts.push(extPart(ctx, {
        id: `${id}-gunwale`, partNo: 'side-gunwale', name: `${nm} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bandsaw',
        center: [(x0s + x1s) / 2, yc, (top(x0s) + top(x1s)) / 2], outline, depth: L.side, transform: frameAt(L.side), extraLb: -grooveLb,
        notes: `The sled-profile gunwale (D-54): a ${L.railBand}" band whose top is a ${p.sideProfileSagIn === 0 ? 'straight line' : `line with a ${p.sideProfileSagIn}" mid-length sag`} from ${p.sideHeightRearIn}" above the deck at the rear transom to ${L.sideH.toFixed(2)}" at x = ${x1s.toFixed(1)}", where it ends against the bow curl (${slope.toFixed(1)}° at the rear). Sawn from a ${(Math.abs(top(x0s) - top(x1s)) + L.railBand + 0.5).toFixed(1)}" wide board with the grain running the length (it follows the slope: sawn, not laminated; the line is gentle). Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35, D-43). ${SIDE_ASSEMBLY_NOTE}`,
      }));
    }
    // Web: the okoume side panel, captured in the chine and gunwale grooves and the rear transom's stopped dado; its top follows the sled line.
    {
      const z0 = L.web.z0 - g;
      const xw0 = rearTx - dd;
      const top = (x: number) => webTopAt(L, x) + g;
      const outline = slopedOutline(L, xw0, x1s, () => z0, top);
      parts.push(extPart(ctx, {
        id: `${id}-web`, partNo: 'side-web', name: `${nm} side panel`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x', center: [(xw0 + x1s) / 2, yc, (L.web.z0 + webTopAt(L, rearTx)) / 2],
        outline, depth: pl, transform: frameAt(pl), edges: 'captured',
        notes: `Flat 6 mm okoume panel (D-54: no curve, so one sheet and no lamination), a trapezoid whose top edge follows the sled line; captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the rear transom; its front end butts the bow curl at x = ${x1s.toFixed(1)}". ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
      }));
    }
  }

  // ── Rear transom (full width, wrapping the side ends) with its lift hand-hold (M9, D-37) ──
  const tT = L.transom;
  const ventR = p.ventHoleIn / 2;
  const vent = (y: number, z: number): Vec2[] => cw(circleLoop(y, z, ventR, 8));
  {
    const rs = liftSlot(ctx);
    const w0 = L.hwC + L.side;
    const zb = L.deckTop - p.crossmemberDepthIn, zt = rs.transomTop;
    const topR = transomTopOutline(w0, zt, p.transomCrownIn, Math.min(p.transomCornerRadiusIn, (zt - zb) / 2));
    const outline = ccw([[w0, zb], ...topR, [-w0, zb]]);
    const dadoLb = oakLb(ctx, 2 * (L.hwC + dd) * (L.ply + ds) * dd) + 2 * oakLb(ctx, (pl + slop) * (webTopAt(L, rearTx) - L.web.z0 + 2 * g) * dd);
    const webY = L.hwC + L.side / 2, webZ = (L.web.z0 + webTopAt(L, rearTx)) / 2, deckVentY = L.hwC + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.deckBot + L.ply / 2), vent(-deckVentY, L.deckBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xRear, 0, (zb + zt) / 2],
      outline, holes: [slotHole(0, (rs.zBot + rs.zTop) / 2, rs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xRear, 0, 0]), extraLb: -dadoLb,
      notes: `${tT}" oak, glued up from two boards (no board is ${(w0 * 2).toFixed(0)}" wide; keep the glue line clear of the slot), as tall as the rear side of the sled profile (${p.sideHeightRearIn}" above the deck, D-54). Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 3/8" roundovers both faces. The top edge is a ${p.transomCrownIn}" crown (arc) with ${p.transomCornerRadiusIn}" rounded corners (D-44). Deck dado ${dd}" deep × ${(L.ply + ds).toFixed(3)}" (deck + ${ds}" clearance) on the front face; stopped dados for the side panels (D-35, D-37); the closed dado ends are vented with ${p.ventHoleIn}" holes through the transom (4 holes: bung or epoxy-fill them after the glue-up). `
        + `THE TRANSOM GOES ON LAST (M4): it slides in X onto the deck edge, both web ends, the chine and gunwale tenons and the rail tenons in one glue-up (about 14 joints: use 120-minute slow epoxy, rehearse twice); the corner backers and the handle-socket holes are done on the bench first.`,
    }));
    // Backers behind the handle sockets (build review S13, D-43): the bolts pull on them from the outside.
    const hg = handleGeometry(p, L);
    const bkT = p.blockingThickIn;
    for (const { s, tag } of SIDES) {
      const yHi = L.hwC, yLo = Math.max(0.5, hg.yPost - hg.socketY / 2 - 0.5);
      const bz0 = Math.max(L.deckTop + 0.5, hg.zBot - 0.5), bz1 = hg.zTop;
      parts.push(box(ctx, {
        id: `transom-backer-${tag}`, partNo: 'transom-backer', name: `Rear transom backer ${tag}`, group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'z',
        ...span([rearTx, rearTx + bkT], [s * yLo, s * yHi].sort((x, y) => x - y) as [number, number], [bz0, bz1]),
        notes: `${bkT}" oak backer glued (epoxy, full face) to the INSIDE of the rear transom behind the push-handle socket: the socket bolts (1/4" carriage bolts, nuts and fender washers recessed in it) pull on ${tT + bkT}" of oak instead of ${tT}". Glue it on the bench before the transom goes on; a rear storage box starts ${bkT}" farther forward (Layout.rearLane).`,
      }));
    }
  }

  // ── Scuppers: 3/8" epoxy-lined holes THROUGH THE CHINE at deck level, with stainless nipples (build review M7, D-43) ──
  for (const { x, zone, deckZ, hw, tagPos } of scupperSites(ctx)) {
    for (const { s, tag } of SIDES) {
      parts.push(cylinder(ctx, {
        id: `scupper-${tagPos}-${tag}`, partNo: 'scupper', name: `Deck scupper ${tagPos} ${tag}`, group: 'body', mat: 'fixed', kind: 'purchased', material: '316 stainless drain nipple', massLb: SCUPPER_MASS_LB,
        fab: 'buy', step: HULL_STEP.sides, center: [x, s * (hw + (L.side + SCUPPER_STICKOUT_IN) / 2), deckZ + SCUPPER_BELOW_SURFACE_IN + p.scupperDiaIn / 2], axis: 'y', radius: p.scupperDiaIn / 2, length: L.side + SCUPPER_STICKOUT_IN,
        explode: [0, s, 0], sourcing: { vendor: 'McMaster-Carr (316 stainless barbed / threaded drain nipple, 3/8" tube)' },
        notes: `${p.scupperDiaIn}" hole through the ${zone} chine at deck level (its lower edge just above the deck surface, epoxy-lined so no cut oak end is bare), a 316 nipple bedded in epoxy.`,
      }));
    }
  }

  // ── Signs: PROVISIONAL (Eric, D-54: design the shape first, then decide where a sign fits). Off by default; nothing in the body is sized to them. ──
  if (p.showSideSigns) {
    const xm = (x0s + x1s) / 2;
    const signLen = Math.min(p.signLengthIn, 0.5 * sideLen);
    const hAvail = webTopAt(L, xm) - L.web.z0 - 0.25;
    const signH = Math.max(1, Math.min(p.signHeightIn, hAvail));
    const slope = sideSlopeAt(L, xm);
    const zc = (L.web.z0 + webTopAt(L, xm)) / 2;
    for (const { s, tag } of SIDES) {
      const sg = box(ctx, {
        id: `sign-${tag}`, partNo: 'sign', name: `Side sign ${tag} (provisional)`, group: 'removable', mat: 'ply', removable: true, edges: 'edged', step: STEP.finish,
        size: [signLen, pl, signH], center: [xm, s * (L.hwC + L.side + pl / 2), zc], rot: { y: slope },
      });
      sg.massLb += edgeBandLb(ctx, 2 * (signLen + signH), pl);
      sg.notes = 'PROVISIONAL placement (D-54, Eric: shape first). 6 mm ply blank, all four edges banded with oak, hung on thumb-knob screws into tee-nuts in the side; the real sign position and shape are decided after the new shape exists.';
      parts.push(sg);
    }
  }

  // Grab handles: the real ones are `seat-grip-*` (seat.ts, D-40).
  return parts;
}

export { slotHole as _slotHole };
