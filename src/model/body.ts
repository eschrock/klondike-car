/**
 * Body (D-54, D-57): the deck, the captured-ply sides on the sheer (a concave sweep from the low bow up to the tall rear) with a gentle plan turn-in toward the bow, the shaped
 * oak bow bulkhead (the rider's foot brace and the lift hand-hold, which replaced the D-54 bow curl), the rear transom with its lift hand-hold, the scuppers and the signs.
 *
 * Each side is an oak chine at deck level, a 4 mm okoume web (D-60; was 6 mm) captured in grooves, and an oak gunwale whose top follows the sheer. Chine, gunwale and web are plan-curved walls
 * (`plan-wall.ts`): constant thickness, centerline at the hull's plan curve (`Layout.turnIn`). The deck is ONE flat sheet that ends in a dado in the bow bulkhead. Joint
 * records are added in joinery.ts after all parts exist.
 */
import { HULL_STEP, STEP, box, cylinder, roughOf, span, SIDES, IN3_PER_FT3, woodMassLb, type Ctx } from './build-utils';
import { handleGeometry } from './handle';
import { transformPoint } from './bounds';
import { innerHalfWidth, sideSlopeAt, sideTopAt, webTopAt, type Layout } from './layout';
import { planWallGeometry } from './plan-wall';
import { brakeGeometry } from './brake-layout';
import { compose } from './mat4';
import type { Dims, EdgeCondition, Mat4, Part, PartGroup, Vec2, Vec3 } from './types';

/** Cosmetic sampling of the curved outlines (D-44): transom crown, rounded corners; the sloped sides and the curl. */
const CROWN_SEGMENTS = 16;
const CORNER_SEGMENTS = 6;
const SIDE_SEGMENTS = 16;
const LIFT_SLOT_SEGMENTS = 8;
/** Assembly order and hydraulic-lock relief shared by the notes of the hull parts (build review M4, D-43; HULL_STEP in build-utils.ts has the whole sequence). */
const DECK_ASSEMBLY_NOTE = 'Assembly (M4, D-54): epoxy-seal every face and edge first; the deck is glued to the frame (rails + joists + the king beam and stop blocks) as one unit; the hull is built UPSIDE DOWN, so this unit is turned over and lowered into the inverted side assemblies (the deck edge rises into the chine rabbets, the Dominos engage vertically), and the rear transom slides onto its edge last. The bow bulkhead goes on with the rear transom, last.';
const SIDE_ASSEMBLY_NOTE = 'Assembly (M4, D-54): bend the chine and gunwale plies on the plan form, plow the web grooves, glue the web into its chine and gunwale on the bench (a side assembly, wipe squeeze-out from the grooves), stand the two assemblies inverted in the jig, and lower the frame + deck unit into them; the rear transom goes on after, sliding in X.';

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
  /** Cosmetic: the grain follows the top edge (the bandsawn sheer gunwale). */
  grainFollowsTop?: boolean;
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
    geometry: s.planYc ? planWallGeometry(s.outline, s.depth, s.planYc, 1.5, s.grainFollowsTop) : { type: 'extrusion', outline: s.outline, ...(s.holes ? { holes: s.holes } : {}), depth: s.depth },
    transform: s.transform,
    body: 'chassis',
    massLb: mass,
    fab: s.fab ?? (s.mat === 'printed' ? 'print' : 'cnc'),
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
  const g = p.grooveDepthIn;
  const dd = p.deckCaptureDepthIn;
  const slop = p.grooveSlopIn;
  const rearTx = L.xRear + L.transom; // inner face of the rear transom
  const ds = p.deckSlopIn;
  const rabbetH = (top: number, bot: number) => top - bot + ds; // deck + clearance (build review MUST-2)
  const xB = L.bulkhead.x0; // the bow bulkhead's rear face = the end of the flat deck and of the sides
  const turn = L.turnIn;

  // ── Deck: ONE flat sheet, captured in the chine rabbet all the way along, in a dado in the rear transom and in a dado in the bow bulkhead; its plan edge follows the bow turn-in (D-57) ──
  {
    const x0 = rearTx - dd, x1 = xB + dd;
    const nS = Math.max(4, Math.ceil((x1 - x0) / 2));
    const xs = Array.from({ length: nS + 1 }, (_, i) => x0 + ((x1 - x0) * i) / nS);
    const hwAt = (x: number) => L.hwC + dd - turn(Math.min(x, xB));
    const outline: Vec2[] = [...xs.map((x): Vec2 => [x, -hwAt(x)]), ...[...xs].reverse().map((x): Vec2 => [x, hwAt(x)])];
    parts.push(extPart(ctx, {
      id: 'deck', name: 'Deck', group: 'body', mat: 'ply', step: HULL_STEP.deck, grain: 'x', center: [(x0 + x1) / 2, 0, L.deckTop],
      outline, depth: L.ply, transform: compose([0, 0, L.deckBot]),
      edges: 'captured',
      notes: `One sheet, ${(x1 - x0).toFixed(1)}" long (fits a 4 x 8 sheet), flat: ${dd}" into a ${dd}" × ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" rabbet in the underside of each chine (deck + ${ds}" clearance, thickened epoxy fills it; the rail top is flush with the deck underside), into a dado in the rear transom and into a dado in the bow bulkhead. Its plan edges follow the bow turn-in (${p.bowTurnInIn}" each side over the last ${p.bowTurnLenIn}", D-57): cut the outline on the CNC or bandsaw to the form. No exposed ply edge. ${DECK_ASSEMBLY_NOTE}`,
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
      notes: `Shaped oak bulkhead (D-57; it replaces the D-54 bow curl and the separate foot-stop bar): ${b.thick}" thick (one piece of ${stockQuarters(b.thick)}/4 oak planed to ${b.thick}", or two boards glued face to face; grain across the width), ${(2 * halfW).toFixed(1)}" wide at the narrowed bow, ${(b.zCorner - b.bot).toFixed(1)}" tall at the corners (the side height at the bow) rising in a curve to ${(b.zCenter - L.deckTop).toFixed(1)}" above the deck at the center, with ${p.transomCornerRadiusIn}" rounded corners (CNC or bandsaw and rasp). Its REAR face is the rider's foot brace (x = ${b.x0.toFixed(1)}", the rider's heels press it directly; D-60 dropped the foot block, so a shorter rider moves the seat forward or pads the face). The deck edge enters a ${dd}" × ${(L.ply + ds).toFixed(3)}" dado in the rear face; the rails, chine and gunwale end on it with Dominos and epoxy, so the foot load (pushing it forward) goes into those joints and the deck dado (foot-stop row). The lift hand-hold ${hs.lengthIn}" × ${p.liftSlotHeightIn}" is routed through the center, ${p.liftSlotClearIn}" above the deck and ${hs.barIn.toFixed(2)}" of oak above it (lift row): the nose is lifted by the body, not by the tongue. 3/8" roundovers, hand-hold edges eased.`,
    }));
  }

  // ── Sides (D-54, D-57): the chine and gunwale are cold-bent flat in plan (2 plies) on one form, the gunwale then bandsawn to the sheer; the web is a single bent okoume sheet ──
  const x0s = L.xSideStart, x1s = L.xSideEnd;
  const zChine0 = L.chineBot;
  const sideLen = x1s - x0s;
  const turned = p.bowTurnInIn > 1e-9;
  const bendNote = turned
    ? `Bent in plan: ${p.bowTurnInIn}" turn-in over the last ${p.bowTurnLenIn}" (a smooth S, straight at both ends; the tightest radius is ${((p.bowTurnLenIn * p.bowTurnLenIn) / (6 * p.bowTurnInIn)).toFixed(0)}"). `
    : '';
  for (const { s, tag } of SIDES) {
    const ycOf = (x: number) => s * (L.hwC + L.side / 2 - turn(x)); // member centerline (the web plane)
    const id = `side-${tag}`;
    const nm = s > 0 ? 'Left' : 'Right';
    // Chine: a constant-section oak bar at deck level, laminated (2 plies) flat on the plan form.
    {
      const grooveLb = oakLb(ctx, sideLen * (pl + slop) * g);
      const rabbetLb = oakLb(ctx, sideLen * dd * rabbetH(L.deckTop, L.deckBot));
      parts.push(extPart(ctx, {
        id: `${id}-chine`, partNo: 'side-chine', name: `${nm} chine`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bentlam',
        center: [(x0s + x1s) / 2, ycOf((x0s + x1s) / 2), zChine0 + L.chineH / 2],
        outline: [[x0s, zChine0], [x1s, zChine0], [x1s, zChine0 + L.chineH], [x0s, zChine0 + L.chineH]], depth: L.side, transform: compose([0, 0, 0]), planYc: ycOf, extraLb: -(grooveLb + rabbetLb),
        notes: `Oak bar ${sideLen.toFixed(1)}" long, ${L.side}" × ${L.chineH}", bottom at the deck underside level (${L.chineBot.toFixed(2)}", one deck level). ${bendNote}Laminated from 2 plies of ${(L.side / 2).toFixed(3)}" white oak (the plan bend is across the thin dimension: cold-bends on a form, epoxied, no steam) and left long. Top groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web; an underside rabbet ${dd}" × ${rabbetH(L.deckTop, L.deckBot).toFixed(3)}" (deck + ${ds}" clearance) holds the deck edge; it rests on the rail (which is bent the same way) and is Domino-tied to it (vertical Dominos, D-43). Its forward end meets the bow bulkhead's rear face. ${SIDE_ASSEMBLY_NOTE}`,
      }));
    }
    // Gunwale: the sheer (concave sweep up to the rear, D-57). BENT-LAM: two plies bent flat on the plan form from a board as wide as the sheer needs, then BANDSAWN to the sheer line.
    {
      const top = (x: number) => sideTopAt(L, x);
      const outline = slopedOutline(L, x0s, x1s, (x) => top(x) - L.railBand, top);
      const grooveLb = oakLb(ctx, sideLen * (pl + slop) * g);
      const slope = (sideSlopeAt(L, x0s) * 180) / Math.PI;
      const blank = Math.abs(top(x0s) - top(x1s)) + L.railBand + 0.5;
      parts.push(extPart(ctx, {
        id: `${id}-gunwale`, partNo: 'side-gunwale', name: `${nm} gunwale`, group: 'body', mat: 'oak', step: HULL_STEP.sides, grain: 'x', fab: 'bandsaw',
        center: [(x0s + x1s) / 2, ycOf((x0s + x1s) / 2), (top(x0s) + top(x1s)) / 2], outline, depth: L.side, transform: compose([0, 0, 0]), planYc: ycOf, grainFollowsTop: true, extraLb: -grooveLb,
        notes: `The sheer gunwale (D-57): a ${L.railBand}" band whose top is a ${p.sheerCurveIn === 0 ? 'straight line' : `concave curve (a ${p.sheerCurveIn}" sag below the straight line at mid-length)`} from ${p.sideHeightRearIn}" above the deck at the rear transom to ${L.sideH.toFixed(2)}" at x = ${x1s.toFixed(1)}", where it ends at the bow bulkhead (${slope.toFixed(1)}° at the rear). BENT-LAMINATED AND BANDSAWN: 2 plies of ${(L.side / 2).toFixed(3)}" white oak, ${blank.toFixed(1)}" wide (the full sheer drop plus the band), bent flat on the plan form together with the chine${turned ? ` (${bendNote.trim()})` : ''} and epoxied, then the sheer line is bandsawn and planed (the grain follows the sheer; the top edge is relief-cut where it meets the transom crown). Underside groove ${(pl + slop).toFixed(3)}" × ${g}" holds the web (D-35, D-43), plowed before the sheer is sawn. ${SIDE_ASSEMBLY_NOTE}`,
      }));
    }
    // Web: the okoume side panel, captured in the chine and gunwale grooves and the rear transom's stopped dado; its top follows the sheer; bent in plan with the turn-in.
    {
      const z0 = L.web.z0 - g;
      const xw0 = rearTx - dd;
      const top = (x: number) => webTopAt(L, x) + g;
      const outline = slopedOutline(L, xw0, x1s, () => z0, top);
      parts.push(extPart(ctx, {
        id: `${id}-web`, partNo: 'side-web', name: `${nm} side panel`, group: 'body', mat: 'ply', step: HULL_STEP.sides, grain: 'x', center: [(xw0 + x1s) / 2, ycOf((xw0 + x1s) / 2), (L.web.z0 + webTopAt(L, rearTx)) / 2],
        outline, depth: pl, transform: compose([0, 0, 0]), planYc: ycOf, edges: 'captured',
        notes: `${mmOf(pl)} mm okoume panel, one sheet (it bends easily across its thickness: ${turned ? `${p.bowTurnInIn}" of plan turn-in over the last ${p.bowTurnLenIn}" is a flat bend of the sheet, no lamination` : 'it stays flat'}), cut to the sheer on the CNC or bandsaw before bending (the top edge follows the sheer, the pattern is the flat development); captured in the chine and gunwale grooves (${g}" deep) and in a stopped dado in the rear transom; its front end butts the bow bulkhead's rear face at x = ${x1s.toFixed(1)}". ${SIDE_ASSEMBLY_NOTE} The closed dado is vented: a ${p.ventHoleIn}" relief hole through the transom at its end lets air and epoxy escape as the transom slides on (hydraulic lock).`,
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
      notes: `${tT}" oak, glued up from two boards (no board is ${(w0 * 2).toFixed(0)}" wide; keep the glue line clear of the slot), as tall as the rear side of the sheer (${p.sideHeightRearIn}" above the deck, D-54, D-57). Lift hand-hold ${rs.lengthIn}" × ${p.liftSlotHeightIn}" (gloved hand), ${rs.barIn}" of oak above it; routed 3/8" roundovers both faces. The top edge is a ${p.transomCrownIn}" crown (arc) with ${p.transomCornerRadiusIn}" rounded corners (D-44). Deck dado ${dd}" deep × ${(L.ply + ds).toFixed(3)}" (deck + ${ds}" clearance) on the front face; stopped dados for the side panels (D-35, D-37); the closed dado ends are vented with ${p.ventHoleIn}" holes through the transom (4 holes: bung or epoxy-fill them after the glue-up). `
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

  // ── Signs (D-57): the Troop 455 sign on the outside of the tall rear part of each side, following the sheer ──
  if (p.showSideSigns) {
    const sg = signPlacement(ctx);
    for (const { s, tag } of SIDES) {
      const sign = box(ctx, {
        id: `sign-${tag}`, partNo: 'sign', name: `Side sign ${tag}`, group: 'removable', mat: 'ply', removable: true, edges: 'edged', step: STEP.finish,
        size: [sg.length, pl, sg.height], center: [sg.xc, s * (L.hwC + L.side + pl / 2), sg.zc],
      });
      sign.massLb += edgeBandLb(ctx, 2 * (sg.length + sg.height), pl);
      sign.notes = `D-57: the sign is back, on the outside of the tall rear part of the side (${sg.length.toFixed(1)}" × ${sg.height.toFixed(1)}", level, not tilted to follow the sheer (3c-5), its top edge ${sg.topMargin}" under the gunwale line at its forward end). ${mmOf(pl)} mm ply blank, all four edges banded with oak, drawn as a rounded-oval plank with the Troop 455 artwork (signTexture); hung on thumb-knob screws into tee-nuts in the side so it comes off for transport. It stays clear of the rear wheel and of the brake hinge mounts.`;
      parts.push(sign);
    }
  }

  // Grab handles: the real ones are `seat-grip-*` (seat.ts, D-57).
  return parts;
}

/**
 * Where the side sign goes (D-57, 3c-5): LEVEL (not tilted to follow the sheer; Eric), on the outside of the tall rear part of the side, starting just ahead of the rear transom. Its
 * top edge is `topMargin` under the gunwale line at its FORWARD end (where the sheer is lowest, so the whole board stays inside the side), and its bottom edge clears the rear
 * wheel's brake flap, which stands out beside the side there and would hide the lower third of the board from a side view. The forward end is chosen (never ahead of `SIGN_X_MAX_IN`,
 * the brake hinge and knee) to give the biggest board that is at least `SIGN_MIN_ASPECT` long for its height, so the artwork keeps its two lines instead of stacking.
 */
export function signPlacement(ctx: Pick<Ctx, 'p' | 'L'>) {
  const { p, L } = ctx;
  const x0 = L.xSideStart + 1.3; // the turned corner of the board stays ahead of the rear end of the side
  const topMargin = 0.75;
  const bg = brakeGeometry(p, L);
  const flapSlope = bg.u[0] !== 0 ? bg.u[1] / bg.u[0] : 0; // z per x along the flap's top surface (positive: it rises toward the hinge)
  const flapTop = (x: number) => bg.H[1] + (Math.min(x, bg.H[0]) - bg.H[0]) * flapSlope + SIGN_FLAP_CLEAR_IN;
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
/** Least length / height of the sign (signTexture stacks the words below 2.2:1), and the clearance over the brake flap's top surface. */
export const SIGN_MIN_ASPECT = 2.2;
const SIGN_FLAP_CLEAR_IN = 0.3;
/** The sign never reaches past this x (in): the rear wheel's hub, and the brake mount ahead of the tire, are beyond it (D-57). */
export const SIGN_X_MAX_IN = 6;

export { slotHole as _slotHole };
