/**
 * Body (D-54, D-57): the deck, the captured-ply sides on the sheer (a concave sweep from the low bow up to the tall rear) with a gentle plan turn-in toward the bow, the shaped
 * oak bow bulkhead (the rider's foot brace and the lift hand-hold, which replaced the D-54 bow curl), the rear transom with its lift hand-hold, the scuppers and the signs.
 *
 * Each side is a SANDWICH (D-61, D-62): a full-height 4 mm okoume web (D-60; was 6 mm) with an oak band glued on each face at the chine (deck level) and at the gunwale (its top follows the sheer); no grooves. Chine, gunwale and web are plan-curved walls
 * (`plan-wall.ts`): constant thickness, centerline at the hull's plan curve (`Layout.turnIn`). The deck is ONE flat sheet that ends in a dado in the bow bulkhead. Joint
 * records are added in joinery.ts after all parts exist.
 */
import { GRIP_BACKING_T_IN, HULL_STEP, STEP, box, cylinder, roughOf, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { handleGeometry } from './handle';
import { transformPoint } from './bounds';
import { innerHalfWidth, samples, sideSlopeAt, sideTopAt, type Layout } from './layout';
import { planWallGeometry } from './plan-wall';
import { SIGN_X_MAX_IN, brakeGeometry } from './brake-layout';
import { compose } from './mat4';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

/** Cosmetic sampling of the curved outlines (D-44): transom crown, rounded corners; the sloped sides and the curl. */
const CROWN_SEGMENTS = 16;
const CORNER_SEGMENTS = 6;
const SIDE_SEGMENTS = 16;
const LIFT_SLOT_SEGMENTS = 8;
/** Assembly order and hydraulic-lock relief shared by the notes of the hull parts (build review M4, D-43; HULL_STEP in build-utils.ts has the whole sequence). */
const DECK_ASSEMBLY_NOTE = 'Assembly (D-62, build 3c S1): epoxy-seal every face and edge first; the deck is glued to the frame (rails + joists + the king beam and stop blocks) as one unit; the hull is built UPSIDE DOWN, so this unit is turned over and lowered into the inverted side assemblies (the deck edge rises into the gap under each inner chine band, the Dominos engage vertically). Before any glue, dry-fit the frame + deck unit and both side assemblies, MEASURE from the rear transom dado to the bow bulkhead dado and cut the bands and webs to that length less 1/32", and trim the rails of the frame unit (left 1/2" long at both ends when the frame was glued) to the same length, then rehearse. Close ONE end first: glue and clamp the rear transom, let it kick, then bring in the bow bulkhead with a second batch of slow epoxy (mix in two batches, two pipe clamps along the length).';
const SIDE_ASSEMBLY_NOTE = 'Assembly (D-61, D-62): each side is a SANDWICH, a full-height 4 mm okoume web with an oak band glued on EACH face at the chine (bottom) and at the gunwale (top), no grooves. Cut the web to the flat development of the sheer; coat the glue faces with epoxy (wash or sand the amine blush off sealed faces), lay the four bands on the web and bend web and bands together cold on the plan form (one S-form of two 3/4" MDF cauls), clamped along the length; bend-test a dry strip on the form first and cut 25% spare strips. GLUE-UP POSTURE (3c-8; a web with four bands is a two-direction bend, the sheer in the plane of the web and the S across it): lay the web FLAT on the bench with the S-ramp form (about 2.75" high and 22" long, D-66) under the bow end, where the long gentle S-bend of the bow taper runs and the web there is 5 to 7" tall; CLEAT THE SHEER LINE (screws or cleats into a sacrificial table every 4 to 5", the whole length), because a straight 1.5" strip edge-bent to the sheer pushes sideways about 65 lbf at mid-span until the epoxy cures; glue and clamp ONE FACE per cure (its chine and gunwale bands, C-clamps or spring clamps across the band every 4 to 5", about 14 per band pair; brads or a vacuum bag if short of clamps), let it cure, flip the web onto the mirror ramp and do the other face: TWO CURES PER SIDE. The inner chine band is shorter, so the deck edge rises into the gap (a rabbet with no routing). Stand the two side assemblies inverted in the jig, lower the frame + deck unit into them, then close the transom end and the bow end one after the other (S1).';

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
/** The rough hardwood stock (quarters of an inch: 4/4, 5/4, 6/4, 8/4, 12/4) that planes down to `thickIn` with a quarter inch to spare (1.5 -> 8/4, 1.75 -> 8/4, 1.0 -> 5/4). */
const stockQuarters = (thickIn: number) => [4, 5, 6, 8, 12, 16].find((q) => q >= Math.ceil((thickIn + 0.25) * 4 - 1e-9)) ?? 16;
/** A ply thickness in whole millimeters, for the shop notes (0.157 -> 4, 0.236 -> 6). */
const mmOf = (plyIn: number) => Math.round(plyIn * 25.4);
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
/** Where the drains go: the rear corners (in the backer lane when there is a rear box) and the bow corners, just behind the bow bulkhead. */
export function scupperSites(ctx: Ctx): ScupperSite[] {
  const { L } = ctx;
  const rearTx = L.xRear + L.transom;
  const r = ctx.p.scupperDiaIn / 2;
  const rear: ScupperSite = { x: rearTx + Math.max(SCUPPER_END_INSET_IN, r + 0.1) * 0.75, zone: 'rear', deckZ: L.deckTop, hw: L.hwC, tagPos: 'rear' };
  const front: ScupperSite = { x: L.xFlatEnd - 1, zone: 'bow', deckZ: L.deckTop, hw: innerHalfWidth(L, L.xFlatEnd - 1), tagPos: 'bow' };
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
  /** A plan-curved vertical wall (D-57): `outline` is then in (x, z) with thickness `depth`, centered at y = planYc(x) in the model frame (the transform must be the identity). */
  planYc?: (x: number) => number;
  /** Cosmetic: the grain follows the top edge (the sheer band is edge-bent to the sheer, so its grain follows it). */
  grainFollowsTop?: boolean;
  /** Cut-list size when the outline's bounding box is not the stock (a strip bent to a curve: D-62, build 3c S2), and the member's kind. */
  stock?: Dims;
  kind?: Part['kind'];
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
  const stock: Dims | undefined = s.mat === 'printed' ? undefined : s.stock ?? { t: dims[0], w: dims[1], l: dims[2] };
  const out: Part = {
    id: s.id,
    name: s.name,
    group: s.group,
    kind: s.kind ?? (s.mat === 'oak' ? 'lumber' : s.mat === 'ply' ? 'sheet' : 'printed'),
    material: s.mat === 'oak' ? 'white oak' : s.mat === 'ply' ? ctx.plyName : 'ASA',
    geometry: s.planYc ? planWallGeometry(s.outline, s.depth, s.planYc, 1.5, s.grainFollowsTop) : { type: 'extrusion', outline: s.outline, ...(s.holes ? { holes: s.holes } : {}), depth: s.depth },
    transform: s.transform,
    body: 'chassis',
    massLb: mass,
    fab: s.fab ?? (s.mat === 'printed' ? 'print' : 'shaper-origin'), // D-61: the shop CNC is a Shaper Origin; every flat extruded part goes to it
    step: s.step,
    // Reuse the subsystem's default exploded-view direction through a throwaway box at the same place.
    explode: box(ctx, { id: s.id, name: s.name, group: s.group, mat: 'oak', size: [1, 1, 1], center: s.center, step: s.step }).explode,
  };
  if (s.partNo) out.partNo = s.partNo;
  if (s.planYc) {
    let A = 0, cx = 0, cz = 0;
    for (let i = 0; i < s.outline.length; i++) {
      const [x1, z1] = s.outline[i], [x2, z2] = s.outline[(i + 1) % s.outline.length];
      const cr = x1 * z2 - x2 * z1;
      A += cr; cx += (x1 + x2) * cr; cz += (z1 + z2) * cr;
    }
    if (Math.abs(A) > 1e-9) { const gx = cx / (3 * A); out.cgIn = [gx, s.planYc(gx), cz / (3 * A)]; }
  } else if (s.outline.length > 8) {
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

/** Sampled outline (x, z) of a sloped side member: bottom edge left to right, then the top edge right to left. Sampled finely enough for the sheer curve (D-57). */
function slopedOutline(L: Layout, x0: number, x1: number, bottom: (x: number) => number, top: (x: number) => number): Vec2[] {
  const n = Math.max(SIDE_SEGMENTS, Math.ceil((x1 - x0) / 1));
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
  void L;
  return [...xs.map((x): Vec2 => [x, bottom(x)]), ...[...xs].reverse().map((x): Vec2 => [x, top(x)])];
}

/** The lift hand-hold through the bow bulkhead (D-57), in the shape `liftBarStressPsi` takes: the nose is lifted by the body, not the tongue. */
export function bowHold(ctx: Pick<Ctx, 'p' | 'L'>): LiftSlot {
  const { p, L } = ctx;
  const b = L.bulkhead;
  const crownTop = b.zCenter;
  return { zBot: L.hold.zBot, zTop: L.hold.zTop, transomTop: crownTop, barIn: crownTop - L.hold.zTop, thickIn: b.thick, lengthIn: p.liftSlotLengthIn };
}

/** Top outline of the bulkhead, right to left, and the half width at its rear face. */
export function bulkheadOutline(ctx: Pick<Ctx, 'p' | 'L'>): { outline: Vec2[]; halfW: number } {
  const { p, L } = ctx;
  const b = L.bulkhead;
  const crown = Math.max(0, b.zCenter - b.zCorner);
  const topR = transomTopOutline(b.halfW, b.zCorner, crown, Math.min(p.transomCornerRadiusIn, (b.zCorner - b.bot) / 2));
  return { outline: ccw([[b.halfW, b.bot], ...topR, [-b.halfW, b.bot]]), halfW: b.halfW };
}

// ── Body ──
export function buildBody(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const pl = p.panelPlyIn;
  const dd = p.deckCaptureDepthIn;
  const ddS = L.deckEdge; // depth of the deck edge under the inner chine band: the band's thickness at most, less deckSideClearIn (D-62, D-63)
  const bandT = L.sideBand;
  const slop = p.grooveSlopIn;
  const rearTx = L.xRear + L.transom; // inner face of the rear transom
  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds; // deck + clearance (build review MUST-2)
  const xB = L.bulkhead.x0; // the bow bulkhead's rear face = the end of the flat deck and of the sides
  const turn = L.turnIn;

  // ── Deck: ONE flat sheet, captured in the chine rabbet all the way along, in a dado in the rear transom and in a dado in the bow bulkhead; its plan edge follows the bow turn-in (D-57) ──
  {
    const x0 = rearTx - dd, x1 = xB + dd;
    const nS = Math.max(4, Math.ceil((x1 - x0) / 1));
    const xs = Array.from({ length: nS + 1 }, (_, i) => x0 + ((x1 - x0) * i) / nS);
    const hwAt = (x: number) => L.hwC + ddS - turn(Math.min(x, xB));
    const outline: Vec2[] = [...xs.map((x): Vec2 => [x, -hwAt(x)]), ...[...xs].reverse().map((x): Vec2 => [x, hwAt(x)])];
    parts.push(extPart(ctx, {
      id: 'deck', name: 'Deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline, depth: L.ply, transform: compose([0, 0, L.deckBot]),
      edges: 'captured',
      notes: `One sheet, ${(x1 - x0).toFixed(1)}" long (fits a 4 x 8 sheet), flat: its edge rises ${ddS.toFixed(3)}" into the ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" gap under each inner chine band (deck + ${ds}" clearance, thickened epoxy fills it; the rail top is flush with the deck underside). It is cut ${p.deckSideClearIn}" NARROWER on each side than the gap between the two webs (${(2 * (L.hwC + ddS)).toFixed(3)}" at the rear against ${(2 * (L.hwC + L.sideBand)).toFixed(3)}" between the web faces, D-63), so a rigid sheet drops between two bent webs that are never within 0.03" of nominal; the ${p.deckSideClearIn}" slot is filled with thickened epoxy (the deck still tucks ${ddS.toFixed(3)}" under the band), and the plan is cut to the web plan, not to the nominal width, into a ${dd}" dado in the rear transom and into a dado in the bow bulkhead. Its plan edges follow the bow taper (${L.taper.turnIn.toFixed(2)}" each side between x = ${L.taper.x0.toFixed(1)}" and ${L.taper.x1.toFixed(1)}", D-66): cut the outline on the Shaper Origin (D-61) to the form. No exposed ply edge. ${DECK_ASSEMBLY_NOTE}`,
    }));
  }

  // ── The bow bulkhead (D-57): a shaped oak plank, the rider's foot brace and the structural front of the hull, with the lift hand-hold ──
  {
    const b = L.bulkhead;
    const { outline, halfW } = bulkheadOutline(ctx);
    const hs = bowHold(ctx);
    const dadoLb = oakLb(ctx, 2 * halfW * (L.ply + ds) * dd);
    parts.push(extPart(ctx, {
      id: 'bow-bulkhead', name: 'Bow bulkhead (foot brace, lift hand-hold)', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'y', center: [(b.x0 + b.x1) / 2, 0, (b.bot + b.zCenter) / 2],
      outline, holes: [slotHole(0, L.hold.zMid, hs.lengthIn, p.liftSlotHeightIn)], depth: b.thick,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [b.x0, 0, 0]), extraLb: -dadoLb,
      notes: `Shaped oak bulkhead (D-57; it replaces the D-54 bow curl and the separate foot-stop bar): ${b.thick}" thick (one piece of ${stockQuarters(b.thick)}/4 oak planed to ${b.thick}", or two boards glued face to face; grain across the width), ${(2 * halfW).toFixed(1)}" wide at the narrowed bow, ${(b.zCorner - b.bot).toFixed(1)}" tall at the corners (the side height at the bow) rising in a curve to ${(b.zCenter - L.deckTop).toFixed(1)}" above the deck at the center, with ${p.transomCornerRadiusIn}" rounded corners (Shaper Origin, or bandsaw and rasp). Its REAR face is the rider's foot brace (x = ${b.x0.toFixed(1)}", the rider's heels press it directly; D-60 dropped the foot block, so a shorter rider moves the seat forward or pads the face). The deck edge enters a ${dd}" × ${(L.ply + ds).toFixed(3)}" dado in the rear face; the rails take Dominos and epoxy (D-69: its bottom is level with the bottom of the stepped front rail, the visible bottom of the side, and its corners are the side tops at the bow), the web ends sit in stopped dados and the four band ends of each side butt against it with an epoxy fillet, so the foot load (pushing it forward) goes into the rail joints, the web dados and the deck dado (foot-stop row); the gunwale and chine band ends carry no load by design (a 0.234" band takes no Domino). The lift hand-hold ${hs.lengthIn}" × ${p.liftSlotHeightIn}" is routed through the center, ${p.liftSlotClearIn}" above the deck and ${hs.barIn.toFixed(2)}" of oak above it (lift row): the nose is lifted by the body, not by the tongue. 3/8" roundovers, hand-hold edges eased.`,
    }));
  }

  // ── Sides (D-54, D-57, D-61, D-62): a SANDWICH. A full-height 4 mm okoume web with an oak band glued on EACH face at the chine and at the gunwale (two bands of (side - ply) / 2 plus the web
  //    = the same 5/8 in as the grooved side), cold-bent together on one plan form. No grooves. The outer bands keep the ids `side-X-chine` / `side-X-gunwale` (their outer face is the hull's outer
  //    face); the inner ones are `-in`. The inner chine band is shorter by the deck rabbet height, which makes the rabbet without routing it. ──
  const x0s = L.xSideStart, x1s = L.xSideEnd;
  const zChine0 = L.chineBot;
  const sideLen = x1s - x0s;
  const turned = L.taper.turnIn > 1e-9;
  const bendNote = turned
    ? `Bent in plan: ${L.taper.turnIn.toFixed(2)}" turn-in each side from x = ${L.taper.x0.toFixed(1)}" to ${L.taper.x1.toFixed(1)}" (one long smooth S, straight and curvature-continuous at both ends, D-66; the tightest radius is ${L.taper.minRadiusIn.toFixed(0)}"). `
    : '';
  const rabbetZ = rabbetH(L.deckTop, L.deckBot); // the gap under the inner chine band: deck + clearance
  const finishCredit = (areaIn2: number) => -(areaIn2 / 144) * p.finishLbPerFt2; // a glued face is not finished
  const topEdge = (x: number) => sideTopAt(L, x);
  const gunOutline = slopedOutline(L, x0s, x1s, (x) => topEdge(x) - L.railBand, topEdge);
  // Length of the sheer band along its own top edge (it is a strip edge-bent to the sheer): the cut-list length.
  let sheerLen = 0;
  for (let i = 1; i <= SIDE_SEGMENTS * 4; i++) { const xa = x0s + ((x1s - x0s) * (i - 1)) / (SIDE_SEGMENTS * 4), xb = x0s + ((x1s - x0s) * i) / (SIDE_SEGMENTS * 4); sheerLen += Math.hypot(xb - xa, topEdge(xb) - topEdge(xa)); }
  const slope0 = (sideSlopeAt(L, x0s + 0.1) * 180) / Math.PI; // (sideSlopeAt clamps at the end, which halves the slope exactly at the transom)
  const slopeMid = (sideSlopeAt(L, (x0s + x1s) / 2) * 180) / Math.PI;
  const webTopAtX = (x: number) => topEdge(x) - L.webCap;
  for (const { s, tag } of SIDES) {
    const ycOf = (x: number) => s * (L.hwC + L.side / 2 - turn(x)); // the web plane (the sandwich centerline)
    const ycOut = (x: number) => s * (L.hwC + L.side - bandT / 2 - turn(x));
    const ycIn = (x: number) => s * (L.hwC + bandT / 2 - turn(x));
    const id = `side-${tag}`;
    const nm = s > 0 ? 'Left' : 'Right';
    const cxy = (yc: (x: number) => number, z: number): Vec3 => [(x0s + x1s) / 2, yc((x0s + x1s) / 2), z];
    const chineRect = (z0: number, z1: number): Vec2[] => [[x0s, z0], [x1s, z0], [x1s, z1], [x0s, z1]];
    const rectArea = (o: Vec2[]) => polyAreaPerim(o).area;
    // Chine bands: constant-section oak strips at deck level, bent with the web.
    const chineSpec = (outer: boolean) => {
      const z0 = zChine0 + (outer ? 0 : rabbetZ), z1 = zChine0 + L.chineH;
      const outline = chineRect(z0, z1);
      const stock: Dims = { t: bandT, w: z1 - z0, l: sideLen };
      return {
        id: outer ? `${id}-chine` : `${id}-chine-in`, partNo: outer ? 'side-chine-out' : 'side-chine-in', name: `${nm} chine band (${outer ? 'outer' : 'inner'})`, group: 'body' as const, mat: 'oak' as const, step: HULL_STEP.sides, grain: 'x' as const, fab: 'bentlam' as const, kind: 'bentlam' as const,
        center: cxy(outer ? ycOut : ycIn, (z0 + z1) / 2), outline, depth: bandT, transform: compose([0, 0, 0]), planYc: outer ? ycOut : ycIn, stock, extraLb: finishCredit(rectArea(outline)),
        notes: `${outer ? 'OUTER' : 'INNER'} chine band of the sandwich side (D-61, D-62): a ${bandT.toFixed(3)}" × ${(z1 - z0).toFixed(2)}" × ${sideLen.toFixed(1)}" oak strip (cut the strips from 4/4, resawn and planed to ${bandT.toFixed(3)}" - a 5/16 ply is too thick to bend and too thin to resaw twice; a drum sander or a planer sled takes it to size), glued full-face to the ${outer ? 'outside' : 'inside'} of the ${mmOf(pl)} mm web at the bottom. ${outer ? `Its bottom is at deck-underside level (${L.chineBot.toFixed(2)}") and rests on the rail; the web's bottom edge sits beside it. ` : `It stops ${rabbetZ.toFixed(3)}" above the bottom (deck + ${ds}" clearance, thickened epoxy fills the gap) and the deck edge rises ${ddS.toFixed(3)}" into the gap, against the web: the rabbet comes from making the strip short, nothing is routed. `}${bendNote}Bend it cold with the web on the form (no steam); the strip is ${(sideLen + 4 * p.millingAllowanceIn).toFixed(1)}" rough, so a 5 ft board does NOT make it: buy 6 ft (or longer) white oak, or join two pieces with an 8:1 scarf, or butt them only in the middle third of the length, never in the first 4" behind the transom, nor under the grab boards, the lash-point doublers or the sign knob stations, and stagger the joints at least 12" from the matching joint in the other band of the same face. Left long and cut to the measured length (S1). ${SIDE_ASSEMBLY_NOTE}`,
      };
    };
    parts.push(extPart(ctx, chineSpec(true)));
    parts.push(extPart(ctx, chineSpec(false)));
    // Gunwale (sheer) bands: strips edge-bent to the sheer (concave sweep up to the rear, D-57) and plan-bent with the web. Radius of the sheer ~170 in: 0.45% strain on a 1.5 in strip.
    const gunSpec = (outer: boolean) => {
      const stock: Dims = { t: bandT, w: L.railBand, l: sheerLen };
      const area = rectArea(gunOutline);
      return {
        id: outer ? `${id}-gunwale` : `${id}-gunwale-in`, partNo: outer ? 'side-gunwale-out' : 'side-gunwale-in', name: `${nm} gunwale band (${outer ? 'outer' : 'inner'})`, group: 'body' as const, mat: 'oak' as const, step: HULL_STEP.sides, grain: 'x' as const, fab: 'bentlam' as const, kind: 'bentlam' as const,
        center: cxy(outer ? ycOut : ycIn, (topEdge(x0s) + topEdge(x1s)) / 2), outline: gunOutline, depth: bandT, transform: compose([0, 0, 0]), planYc: outer ? ycOut : ycIn, grainFollowsTop: true, stock, extraLb: finishCredit(area),
        notes: `${outer ? 'OUTER' : 'INNER'} gunwale band of the sandwich side (D-61, D-62): a ${bandT.toFixed(3)}" × ${L.railBand}" × ${sheerLen.toFixed(1)}" oak STRIP (not a 12 in wide bandsawn blank: that wasted 87% of the board and put the grain 19 degrees across the sheer), glued full-face to the ${outer ? 'outside' : 'inside'} of the ${mmOf(pl)} mm web along the top. Its top is a ${p.sheerCurveIn === 0 ? 'straight line' : `concave sweep (a ${p.sheerCurveIn}" sag below the straight line at mid-length)`} from ${p.sideHeightRearIn}" above the deck at the rear transom to ${L.sideH.toFixed(2)}" at x = ${x1s.toFixed(1)}", where it ends at the bow bulkhead; the slope is ${slope0.toFixed(1)}° at the rear transom (${slopeMid.toFixed(1)}° at mid-length). The strip is bent ON EDGE to that sweep (a radius of about 170", under 0.5% strain) and across its thickness to the plan S together with the web, so the grain FOLLOWS the sheer; the top is trimmed flush with the web cap (the web stops ${L.webCap}" under the top and the gap is filled with thickened epoxy). The strip is ${(sheerLen + 4 * p.millingAllowanceIn).toFixed(1)}" ROUGH (${sheerLen.toFixed(1)}" along the sheer + the milling allowance), so a 5 ft board does NOT make it: buy 6 ft (or longer) white oak, or scarf (8:1) two pieces, or butt them only in the middle third of the length (never in the first 4" behind the transom, under the grab boards, the lash-point doublers or the sign knob stations), staggered at least 12" from the joint in the other band of the same face. ${bendNote}Left long and cut to the measured length (S1). ${SIDE_ASSEMBLY_NOTE}`,
      };
    };
    parts.push(extPart(ctx, gunSpec(true)));
    parts.push(extPart(ctx, gunSpec(false)));
    // Web: the full-height 4 mm okoume panel in the middle of the sandwich, ONE piece from a full 4 x 8 sheet (D-62, D-68). Its top follows the sheer less the cap; bent in plan with the
    // turn-in; its rear end enters a stopped dado in the transom, its front end one in the bulkhead.
    {
      const z0 = L.chineBot;
      const xw0 = rearTx - dd;
      const bandAreas = rectArea(chineRect(zChine0, zChine0 + L.chineH)) + rectArea(chineRect(zChine0 + rabbetZ, zChine0 + L.chineH)) + 2 * rectArea(gunOutline);
      {
        const xa = xw0, xb = x1s;
        const outline = slopedOutline(L, xa, xb, () => z0, webTopAtX);
        const zs = outline.map((o) => o[1]);
        const arcLen = samples(xa, xb, 200).reduce((acc, x, i, xs) => i ? acc + Math.hypot(x - xs[i - 1], ycOf(x) - ycOf(xs[i - 1])) : 0, 0); // the flat development along the plan curve (Phase 4: the Shaper pattern is this long)
        const blank: Dims = { t: pl, w: Math.max(...zs) - Math.min(...zs), l: arcLen + 0.1 }; // + 0.1 trim
        parts.push(extPart(ctx, {
          id: `${id}-web`, partNo: 'side-web', name: `${nm} side panel (web)`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x', center: [(xa + xb) / 2, ycOf((xa + xb) / 2), (L.chineBot + topEdge((xa + xb) / 2)) / 2],
          outline, depth: pl, transform: compose([0, 0, 0]), planYc: ycOf, edges: 'captured', extraLb: finishCredit(bandAreas), stock: blank,
          notes: `${mmOf(pl)} mm okoume panel, FULL HEIGHT, ONE piece from a full 4 x 8 sheet (D-61, D-62, D-68): ${(xb - xa).toFixed(1)}" long in plan (${blank.l.toFixed(1)}" blank, the flat development along the plan curve), ${blank.w.toFixed(1)}" tall, from the chine bottom to ${L.webCap}" under the gunwale top. It is the middle layer of the sandwich: oak bands on both faces at the bottom (${L.chineH}") and at the top (${L.railBand}"); the free web between them is ${(L.sideH - L.chineH - L.railBand).toFixed(1)}" tall at the bow and ${(L.sideRear - L.chineH - L.railBand).toFixed(1)}" at the rear. It bends easily across its thickness (${turned ? `${L.taper.turnIn.toFixed(2)}" of plan turn-in per side over ${(L.taper.x1 - L.taper.x0).toFixed(0)}" is a flat bend of the sheet, no lamination` : 'it stays flat'}). Cut to the sheer on the Shaper Origin (the flat development is the pattern, D-61) before bending; its rear end enters a stopped dado in the rear transom and its front end a stopped dado in the bow bulkhead at x = ${x1s.toFixed(1)}". Do NOT drive screws into it: signs and the flag blocks have oak backing (the sign backing strips) or are epoxied to the inner bands (build 3c M4). ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
        }));
      }
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
    const dadoLb = oakLb(ctx, 2 * (L.hwC + dd) * (L.ply + ds) * dd) + 2 * oakLb(ctx, (pl + slop) * (sideTopAt(L, rearTx) - L.webCap - L.chineBot) * dd);
    const webY = L.hwC + L.side / 2, webZ = (L.chineBot + sideTopAt(L, rearTx) - L.webCap) / 2, deckVentY = L.hwC + dd - 0.15;
    const ventHoles = [vent(webY, webZ), vent(-webY, webZ), vent(deckVentY, L.deckBot + L.ply / 2), vent(-deckVentY, L.deckBot + L.ply / 2)];
    parts.push(extPart(ctx, {
      id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: HULL_STEP.transom, grain: 'x', center: [L.xRear, 0, (zb + zt) / 2],
      outline, holes: [slotHole(0, (rs.zBot + rs.zTop) / 2, rs.lengthIn, p.liftSlotHeightIn), ...ventHoles], depth: tT,
      transform: frameMat([0, 1, 0], [0, 0, 1], [1, 0, 0], [L.xRear, 0, 0]), extraLb: -dadoLb,
      notes: `${tT}" oak, glued up from two boards (no board is ${(w0 * 2).toFixed(0)}" wide; keep the glue line clear of the slot), as tall as the rear side of the sheer (${p.sideHeightRearIn}" above the deck, D-54, D-57). Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 3/8" roundovers both faces. The top edge is a ${p.transomCrownIn}" crown (arc) with ${p.transomCornerRadiusIn}" rounded corners (D-44). Deck dado ${dd}" deep × ${(L.ply + ds).toFixed(3)}" (deck + ${ds}" clearance) on the front face; stopped dados for the side panels (D-35, D-37); the closed dado ends are vented with ${p.ventHoleIn}" holes through the transom (4 holes: bung or epoxy-fill them after the glue-up). `
        + `THE TRANSOM IS CLOSED FIRST (M4, 3c S1; the bulkhead follows with a second batch): it slides in X onto the deck edge, both web ends (stopped dados) and the rail tenons, and the chine and gunwale band ends butt against it with an epoxy fillet (a 0.234" band takes no Domino) in one glue-up of about a dozen joints (use 120-minute slow epoxy, rehearse twice); the corner backers and the handle-socket holes are done on the bench first.`,
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

  // ── Signs (D-57): the Troop 455 sign on the outside of the tall rear part of each side, following the sheer ──
  if (p.showSideSigns) {
    const sg = signPlacement(ctx);
    for (const { s, tag } of SIDES) {
      const sign = box(ctx, {
        id: `sign-${tag}`, partNo: 'sign', name: `Side sign ${tag}`, group: 'body', mat: 'ply', edges: 'edged', step: STEP.finish, fab: 'shaper-origin',
        size: [sg.length, pl, sg.height], center: [sg.xc, s * (L.hwC + L.side + GRIP_BACKING_T_IN + pl / 2), sg.zc], // 1/16 in proud of the band faces: clear of the grab-board backing strip (D-63)
      });
      sign.massLb += edgeBandLb(ctx, 2 * (sg.length + sg.height), pl);
      sign.notes = `D-57: the sign is back, on the outside of the tall rear part of the side (${sg.length.toFixed(1)}" × ${sg.height.toFixed(1)}", level, not tilted to follow the sheer (3c-5), its top edge ${sg.topMargin}" under the gunwale line at its forward end). ${mmOf(pl)} mm ply blank, all four edges banded with oak, drawn as a rounded-oval plank with the Troop 455 artwork (signTexture); hung on four thumb-knob screws (#10-32 x ${signKnobPlan(ctx).lenIn} in) that go through four ${signKnobPlan(ctx).standoffIn.toFixed(3)}" standoff discs epoxied to its back (oak, or 5/16 in nylon spacers) and the 4 mm web into threaded inserts in two oak backing strips glued inside it (nothing is screwed into the ply alone, D-62), so it CAN come off for repairs, but it STAYS ON for transport (D-65, Eric: taking the signs off "seems excessive"; it is not a removable part). Cut the blank on the Shaper Origin (D-61). It stays clear of the rear wheel and of the brake knees.`;
      parts.push(sign);
      // Two oak backing strips glued inside the web, one per knob pair (build 3c M4): the sign screws through the 4 mm web into threaded inserts in them.
      const bk = signBackerPlan(ctx);
      const kn = signKnobPlan(ctx);
      bk.xs.forEach((bx, i) => {
        const yInnerFace = L.hwC + L.sideBand; // the web's inboard face, |y|
        parts.push(box(ctx, {
          id: `sign-backer-${tag}${i + 1}`, partNo: 'sign-backer', name: `Sign backing strip ${tag}${i + 1}`, group: 'body', mat: 'oak', grain: 'z', step: HULL_STEP.sides,
          ...span([bx - bk.w / 2, bx + bk.w / 2], s > 0 ? [yInnerFace - bk.t, yInnerFace] : [-yInnerFace, -yInnerFace + bk.t], [bk.zc - bk.h / 2, bk.zc + bk.h / 2]),
          notes: `Oak backing strip for the sign (D-62, build 3c M4): ${bk.t}" × ${bk.w}" × ${bk.h.toFixed(1)}", grain vertical, epoxied to the INSIDE of the 4 mm web in the free panel between the chine and gunwale bands (its top is ${bk.clearTop.toFixed(2)}" under the inner gunwale band). Two #10-32 × 3/8 stainless threaded inserts, epoxied ${(2 * bk.dz).toFixed(1)}" apart, take the sign's thumb-knob screws (${kn.lenIn} in long: ${kn.stackIn.toFixed(2)}" through the sign, the ${kn.standoffIn.toFixed(3)}" standoff disc and the web, ${kn.engagedIn.toFixed(2)}" into the insert, the tip ${kn.tipShortIn.toFixed(2)}" short of the back of the strip, D-63). Glue it on the bench with the side assembly. Keep the sign at x ≥ ${(sg.xc - sg.length / 2).toFixed(1)}", clear of the flag tube blocks.`,
        }));
      });
    }
  }

  // Grab handles: the real ones are `seat-grip-*` (seat.ts, D-57).
  return parts;
}

/**
 * Where the side sign goes (D-57, 3c-5): LEVEL (not tilted to follow the sheer; Eric), on the outside of the tall rear part of the side, starting just ahead of the rear transom. Its
 * top edge is `topMargin` under the gunwale line at its FORWARD end (where the sheer is lowest, so the whole board stays inside the side), and its bottom edge clears the rear
 * wheel's brake flap, which stands out beside the side there and would hide the lower third of the board from a side view. The forward end is chosen (never ahead of `SIGN_X_MAX_IN`,
 * the brake knee) to give the biggest board that is at least `SIGN_MIN_ASPECT` long for its height, so the artwork keeps its two lines instead of stacking.
 */
export function signPlacement(ctx: Pick<Ctx, 'p' | 'L'>) {
  const { p, L } = ctx;
  const x0 = L.xSideStart + 1.3; // the turned corner of the board stays ahead of the rear end of the side
  const topMargin = 0.75;
  const bg = brakeGeometry(p, L);
  const flapSlope = bg.u[0] !== 0 ? bg.u[1] / bg.u[0] : 0; // z per x along the flap's top surface (positive: it rises toward the pivot)
  const flapTop = (x: number) => bg.P[1] + (Math.min(x, bg.P[0]) - bg.P[0]) * flapSlope + SIGN_FLAP_CLEAR_IN;
  let best = { length: 4, height: 2, x1: x0 + 4, zTop: 0, zBot: 0, area: -1 };
  for (let x1 = Math.min(SIGN_X_MAX_IN, x0 + p.signLengthIn); x1 >= x0 + 4 - 1e-9; x1 -= 0.25) {
    const length = x1 - x0;
    const zTop = sideTopAt(L, x1) - topMargin;
    const zBot = Math.max(L.deckTop + 0.5, flapTop(x1));
    const height = Math.min(p.signHeightIn, zTop - zBot, length / SIGN_MIN_ASPECT);
    if (height < 2) continue;
    if (length * height > best.area + 1e-9) best = { length, height, x1, zTop, zBot, area: length * height };
  }
  if (best.area < 0) { // no room above the flap: fall back to the old board over the chine
    const length = Math.max(4, Math.min(p.signLengthIn, SIGN_X_MAX_IN - x0));
    const zTop = sideTopAt(L, x0 + length) - topMargin;
    const height = Math.max(2, Math.min(p.signHeightIn, zTop - (L.deckTop + 0.5)));
    best = { length, height, x1: x0 + length, zTop, zBot: zTop - height, area: length * height };
  }
  // Center the board in the band between the flap and the gunwale line when the height is limited by the aspect rather than the room.
  const zc = best.zTop - best.height / 2 - Math.max(0, (best.zTop - best.zBot - best.height) / 2);
  return { length: best.length, height: best.height, xc: x0 + best.length / 2, zc, slope: 0, topMargin };
}
/**
 * Where the sign's four knobs and the two oak backing strips behind them go (D-62, build 3c M4). The knob rows sit `dz` above and below the sign center; the upper row is kept low enough that its
 * strip (a little taller than the knob rows) stays in the free web under the inner gunwale band, whatever the sheer does along the sign.
 */
export function signBackerPlan(ctx: Pick<Ctx, 'p' | 'L'>) {
  const { p, L } = ctx;
  const sg = signPlacement(ctx);
  const dx = Math.max(0.5, sg.length / 2 - 2);
  const topFree = Math.min(sideTopAt(L, sg.xc - dx - 2), sideTopAt(L, sg.xc + dx + 2)) - L.railBand - 0.15; // the strips (1.5 in wide) stay under the gunwale band along their whole width (and the 1.25 in slab boxes the overlap test lays along it)
  const dz = Math.max(0.3, Math.min(1.5, sg.height / 2 - 1.2, topFree - SIGN_BACKER_PAD_IN - sg.zc));
  const zLo = sg.zc - dz - SIGN_BACKER_PAD_IN, zHi = Math.min(sg.zc + dz + SIGN_BACKER_PAD_IN, topFree); // never into the inner gunwale band
  return { xs: [sg.xc - dx, sg.xc + dx], dx, dz, zc: (zLo + zHi) / 2, zLo, zHi, w: 1.5, t: p.signBackerThickIn, h: zHi - zLo, clearTop: topFree + 0.15 - zHi };
}
/** The strip extends this far past each knob row. */
const SIGN_BACKER_PAD_IN = 0.6;
/** Threaded insert (#10-32 x 3/8) in the backing strip; the knob screw should engage at least 6 threads (about 0.2 in) of it and leave 1/8 in of wood behind its tip. */
export const SIGN_INSERT_LEN_IN = 0.375;
const SIGN_SCREW_BEHIND_IN = 0.125;

/**
 * The sign's knob screws against its standoff and the backing strip (D-63, build 3c-8 S4). The sign hangs level with the OUTER faces of the bands plus the 1/16 in grab-board backing strip
 * (so it clears the strip wherever the seat puts the board); the bands stand 0.234 in proud of the 4 mm web, so the gap behind the sign (`standoffIn`, 0.297 in) is crossed by each screw before it
 * reaches the strip: sign + standoff + web. The standoff is filled by four oak discs (about 0.30 in thick, 1/2 in across) epoxied to the sign back around the screw holes, or 5/16 in nylon spacers,
 * so the sign cannot flex or be levered across an air gap. The screw is the longest 1/8 in length that leaves 1/8 in of wood behind its tip in the strip: 7/8 in at the defaults, 0.26 in engaged
 * in the 3/8 in insert (the old 1 in screw assumed no standoff and would come within 0.05 in of the back of the strip; 3/4 in engages only 0.14 in).
 */
export function signKnobPlan(ctx: Pick<Ctx, 'p' | 'L'>) {
  const { p, L } = ctx;
  const pl = p.panelPlyIn;
  const standoffIn = Math.max(0, L.side - L.sideBand - pl + GRIP_BACKING_T_IN); // the gap between the sign's inner face (1/16 in proud of the band faces, clear of the grab-board backing strip) and the web's outer face
  const stackIn = pl + standoffIn + pl; // sign + standoff + web
  const stripT = p.signBackerThickIn;
  const lenIn = Math.max(0.5, Math.floor((stackIn + stripT - SIGN_SCREW_BEHIND_IN) * 8 + 1e-9) / 8);
  const engagedIn = lenIn - stackIn;
  return { standoffIn, stackIn, lenIn, engagedIn, tipShortIn: stripT - engagedIn, stripT, insertLenIn: SIGN_INSERT_LEN_IN };
}

/** Least length / height of the sign (signTexture stacks the words below 2.2:1), and the clearance over the brake flap's top surface. */
export const SIGN_MIN_ASPECT = 2.2;
const SIGN_FLAP_CLEAR_IN = 0.3;
/** The sign never reaches past this x (in): the rear wheel's hub, and the brake mount ahead of the tire, are beyond it (D-57). Defined with the brake layout, which keeps the knee ahead of it. */
export { SIGN_X_MAX_IN };

export { slotHole as _slotHole };
