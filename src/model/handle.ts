/**
 * Rear push handle (D-9, D-39, D-53, D-57): aluminum tube sockets on the rear transom, pinned oak uprights, and a sled-style HANDLEBOW: a gently crowned white-oak bow
 * BANDSAWN from one board (D-57; it was a laminated, 3 in crown) that arches up between and over the two posts and overhangs them to the edge of the sled (reference/05). The
 * handle is the handler's station; for transport it is PARKED (D-65), not removed (it can still come off as one U). The socket loads (D-39) are unchanged: the hold-back pull is taken at the posts, at the grip height
 * `rearHandleHeightIn`; the crown only adds height at the middle.
 *
 * Two pin positions (D-57): RIDING (the model default) and PARKED (`view.handle = 'parked'`): the sockets are `handleSocketDepthIn` deep, the posts have a second cross hole
 * `parkDropIn` higher up, and with the pin through that hole the posts sink that far deeper so the bow rests just above the top of the rear transom.
 */
import type { Params } from '../params';
import { STEP, box, cylinder, span, SIDES, IN3_PER_FT3, type Ctx } from './build-utils';
import type { Layout } from './layout';
import { boltLength, inchesText, localPoint } from './rear-mount';
import { multiply, translation } from './mat4';
import { transformPoint } from './bounds';
import { profilePart } from './profile';
import type { Part, Vec2, Vec3 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/**
 * Access hole in the rear wall of the socket for the screws and the hex key, and the relief groove down the transom side of the post that clears the screw heads (build 3c M5).
 * D-63 (build 3c-8, R2-M2): 5/8 in. The 1/4-20 button head is 0.44 in across and its nylon washer 0.5 in, so a 3/8 in hole (3c-7) would not pass them; a 5/8 in hole does, with 0.0625 in to spare on
 * the washer, and leaves (1.5 - 0.625) / 2 = 0.44 in of wall each side on the 1.5 in face. It is one plain 5/8 in Forstner or step-bit hole through a 1/8 in wall; plug it with a 5/8 in black
 * button plug after assembly (water, grit). The alternative (feeding the screws down the open end of the 14 in bore) was rejected as the harder one: the screw would have to be placed 1.2 in from the mouth or the bottom blind, with a long
 * magnetic driver, and the key still needs a hole to reach the head. The row checks the tube net of this hole (handle-sockets).
 */
const ACCESS_HOLE_IN = 0.625;
/** Button head and nylon washer of the 1/4-20 socket screw (McMaster button-head cap screw: 0.44 in head; 1/4 in nylon washer: 0.5 in OD). */
export const SOCKET_SCREW_HEAD_IN = 0.44;
export const SOCKET_SCREW_WASHER_IN = 0.5;
export const SOCKET_ACCESS_HOLE_IN = ACCESS_HOLE_IN;
export const POST_RELIEF = { widthIn: 0.5, depthIn: 0.1875 } as const;

// ── Rear push handle: steel-tube sockets on the transom, pinned oak uprights, crossbar (D-9, D-39) ──
export interface HandleGeom {
  zTop: number;
  zBot: number;
  /** Socket outside / inside along x and y. */
  socketX: number;
  socketY: number;
  postX: [number, number];
  /** Pin height, post foot (RIDING position) and top heights. */
  zPin: number;
  zFoot: number;
  zPostTop: number;
  /** How far the posts and the bow sink in the parked position (the second pin hole is this much higher on the post), and the parked grip height at the posts. */
  parkDropIn: number;
  parkGripZ: number;
  /** Lever arm from the socket mouth to the grip, and from the grip to the lower contact. */
  gripArm: number;
  yPost: number;
  xBar: number;
  bow: BowGeom;
}

/**
 * The handlebow centerline (D-53): a circular arc in the y-z plane through the two post-top points (y = ±yPost, z = grip height) that rises `crown` above them at
 * the middle; beyond the posts the bow continues on the same arc to the sled edge (`yEnd`), where it hangs below the post-top level. `crown` = 0 is a straight bar.
 */
export interface BowGeom {
  crownIn: number;
  /** Arc radius (in); Infinity for a straight bar. */
  radiusIn: number;
  /** |y| of the bow ends (the sled's outer edge) and of the posts. */
  yEnd: number;
  yPost: number;
  /** Centerline height at the posts (= the grip height) and at the middle. */
  zPost: number;
  zMid: number;
  zEnd: number;
  /** Slope of the centerline over the posts, degrees from horizontal (the post tops are cut to it). */
  postSlopeDeg: number;
  /** Centerline in the local x-z plane (x = y of the model, z = z), left to right. */
  path: Vec2[];
  lengthIn: number;
}

const BOW_SEGMENTS = 20;

/** Height of the bow's underside (vertical offset of the section's lower face) at |y|: the centerline minus half the section over the cosine of the slope. */
export function bowUnderZ(b: BowGeom, y: number, sec: number): number {
  const ya = Math.abs(y);
  const R = b.radiusIn;
  const z = Number.isFinite(R) ? b.zPost + b.crownIn - (R - Math.sqrt(Math.max(0, R * R - ya * ya))) : b.zPost;
  const cosT = Number.isFinite(R) ? Math.sqrt(Math.max(1e-6, 1 - (ya / R) ** 2)) : 1;
  return z - sec / (2 * cosT);
}

export function bowGeometry(p: Params, L: Layout): BowGeom {
  const yPost = L.hwC - p.handleUprightInsetIn;
  const yEnd = L.hwC + L.side;
  const barZ = p.rearHandleHeightIn;
  const c = Math.max(0, p.handleBowCrownIn);
  const R = c > 1e-6 ? (yPost * yPost + c * c) / (2 * c) : Infinity;
  const zAt = (y: number) => (Number.isFinite(R) ? barZ + c - (R - Math.sqrt(Math.max(0, R * R - y * y))) : barZ);
  const path: Vec2[] = [];
  for (let i = 0; i <= BOW_SEGMENTS; i++) {
    const y = -yEnd + (2 * yEnd * i) / BOW_SEGMENTS;
    path.push([y, zAt(y)]);
  }
  let lengthIn = 0;
  for (let i = 1; i < path.length; i++) lengthIn += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const slope = Number.isFinite(R) ? Math.asin(yPost / R) : 0;
  return { crownIn: c, radiusIn: R, yEnd, yPost, zPost: barZ, zMid: zAt(0), zEnd: zAt(yEnd), postSlopeDeg: (slope * 180) / Math.PI, path, lengthIn };
}

/** The parked position (D-57): how far the posts sink so the bow rests `handleParkClearIn` above the top of the rear transom (its corners at the side ends, its crown at the middle). */
export function parkDrop(p: Params, L: Layout): { dropIn: number; gripZ: number } {
  const sec = p.handleBarDiameterIn;
  const bow = bowGeometry(p, L);
  const zCornerTop = L.deckTop + L.sideRear;
  const zCenterTop = zCornerTop + p.transomCrownIn;
  // bow centerline height at the posts when parked: the underside at the sled edge clears the transom corner, the underside at the middle clears the crown
  const needEnd = zCornerTop + p.handleParkClearIn + sec / 2 + (bow.zPost - bow.zEnd);
  const needMid = zCenterTop + p.handleParkClearIn + sec / 2 - bow.crownIn;
  const gripZ = Math.max(needEnd, needMid);
  return { dropIn: Math.max(0, p.rearHandleHeightIn - gripZ), gripZ };
}

export function handleGeometry(p: Params, L: Layout): HandleGeom {
  const w = p.handleSocketWallIn;
  const zTop = L.deckTop + L.sideRear; // the rear transom's top corners (D-54: the tall rear section)
  const zBot = zTop - p.handleSocketDepthIn;
  const xo = L.xRear;
  const slip = p.handleSocketSlipIn;
  const postX: [number, number] = [xo - w - slip - p.handlePostThickIn, xo - w - slip];
  const barZ = p.rearHandleHeightIn;
  const park = parkDrop(p, L);
  return {
    zTop, zBot, socketX: p.handlePostThickIn + 2 * (w + slip), socketY: p.handlePostWidthIn + 2 * (w + slip), postX,
    zPin: zTop - Math.min(1.5, p.handleSocketDepthIn / 4), zFoot: zBot + 0.5 + park.dropIn, zPostTop: barZ - p.handleBarDiameterIn / 2, parkDropIn: park.dropIn, parkGripZ: park.gripZ,
    gripArm: barZ - zTop, yPost: L.hwC - p.handleUprightInsetIn, xBar: (postX[0] + postX[1]) / 2,
    bow: bowGeometry(p, L),
  };
}

export function buildHandle(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const h = handleGeometry(p, L);
  const parts: Part[] = [];
  const w = p.handleSocketWallIn;
  // Hollow 6061 aluminum tube (plan item 5, −1.5 lb vs steel): wall area × length × density.
  const tubeLb = ((h.socketX * h.socketY - (h.socketX - 2 * w) * (h.socketY - 2 * w)) * p.handleSocketDepthIn / IN3_PER_FT3) * p.aluminumDensityPcf;
  const sockGrip = w + L.transom + p.blockingThickIn;
  const sockLen = boltLength(sockGrip, 0.25, 2);
  for (const { s, tag } of SIDES) {
    const y = s * h.yPost;
    parts.push(box(ctx, {
      id: `handle-socket-${tag}`, partNo: 'handle-socket', name: `Push handle socket ${tag}`, group: 'brake', mat: 'fixed', kind: 'metal', massLb: tubeLb, step: STEP.brake, fab: 'drill-tap',
      stock: { t: h.socketX, w: h.socketY, l: p.handleSocketDepthIn },
      ...span([L.xRear - h.socketX, L.xRear], [y - h.socketY / 2, y + h.socketY / 2], [h.zBot, h.zTop]),
      material: '6061-T6 aluminum rectangular tube, anodized',
      joints: [
        { type: 'bolt', to: 'transom-rear', count: 2, diaIn: 0.25, size: `1/4-20 × ${inchesText(sockLen)} 316 button-head cap screws (round holes: a carriage-bolt square neck will not seat in a 1/8" aluminum wall), nylon washer under the head, fender washer + nylock nut inside the backer; the heads sit INSIDE the bore on the wall against the transom, so push them in through a ${ACCESS_HOLE_IN}" (5/8 in) ACCESS HOLE in the opposite (rear) wall, directly opposite each screw (the ${SOCKET_SCREW_HEAD_IN}" button head and its ${SOCKET_SCREW_WASHER_IN}" nylon washer pass it with ${f2((ACCESS_HOLE_IN - SOCKET_SCREW_WASHER_IN) / 2)}" a side; the head seats on the inside of the near wall and the hex key goes through the same hole); plug the holes with 5/8 in button plugs after assembly (D-63)`,
          at: [h.zBot + 1.2, h.zTop - 1.2].map((z): Vec3 => [h.socketX / 2 - w / 2, 0, z - (h.zBot + h.zTop) / 2]), note: `grip = socket wall ${f2(w)}" + transom ${f2(L.transom)}" + backer ${f2(p.blockingThickIn)}" = ${f2(sockGrip)}"; ${f2(sockLen)}" bolt: grip + 2 washers + nut + two threads` },
        { type: 'pin', to: `handle-post-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin through both walls and the post` },
      ],
      notes: `Aluminum 6061-T6 rectangular tube ${f2(h.socketX)} × ${f2(h.socketY)} × ${f2(p.handleSocketDepthIn)} (wall ${f2(w)}), cut on the bandsaw and drilled on the drill press; the ${f2(p.handlePostThickIn)}" × ${f2(p.handlePostWidthIn)}" post is a slip fit (${f2(p.handleSocketSlipIn)}" a side) in the ${f2(h.socketX - 2 * w)}" × ${f2(h.socketY - 2 * w)}" inside. The two screw heads are inside the bore (${f2(0.14 + 0.06)}" proud of the wall with the nylon washer), so drill a ${ACCESS_HOLE_IN}" (5/8 in) ACCESS HOLE in the rear wall opposite each screw (build 3c M5, enlarged from 3/8 in at D-63: the head is ${SOCKET_SCREW_HEAD_IN}" and the washer ${SOCKET_SCREW_WASHER_IN}", neither passes a 3/8 in hole) and give the post the relief groove on its transom face. Leaves ${f2((h.socketY - ACCESS_HOLE_IN) / 2)}" of wall each side of the hole on the ${f2(h.socketY)}" face; seal the bare aluminum edge of each hole with epoxy or anodize touch-up, and press a 5/8 in black button plug in each after assembly (water, grit). Lighter than steel (about 0.4 lb vs 1.2 lb each, plan item 5). Anodized or epoxy-coated, and bedded in epoxy / sealant against the transom: bare aluminum corrodes against wet tannin oak. Stays on the sled when the handle is removed (D-9).`,
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum rectangular tube, ${f2(h.socketX)}" × ${f2(h.socketY)}" outside, ${f2(w)}" wall; plus two 5/8 in black nylon button plugs for the access holes)` }, explode: [-1, 0, 0.3],
    }));
    // The post top is sawn to the bow's slope (a flat-bottom bow section sits on it): the lowest points of the bow's underside over the post, inner and outer edge (D-53).
    const yi = h.yPost - p.handlePostWidthIn / 2, yo = h.yPost + p.handlePostWidthIn / 2;
    const under = (y: number) => bowUnderZ(h.bow, y, p.handleBarDiameterIn);
    const outline: Vec2[] = s > 0
      ? [[yi, h.zFoot], [yo, h.zFoot], [yo, under(yo)], [yi, under(yi)]]
      : [[-yo, h.zFoot], [-yi, h.zFoot], [-yi, under(yi)], [-yo, under(yo)]];
    const zTopMax = Math.max(under(yi), under(yo));
    const postPart = profilePart(ctx, {
      id: `handle-post-${tag}`, name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', step: STEP.brake, grain: 'z',
      outline, depth: p.handlePostThickIn, basis: 'yz', origin: [h.postX[0], 0, 0], stock: { t: p.handlePostThickIn, w: p.handlePostWidthIn, l: zTopMax - h.zFoot }, explode: [-1, 0, 0.3],
      fab: 'table-saw',
      joints: [
        { type: 'pin', to: `handle-socket-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin, cross-bored ${f2(h.zPin - h.zBot)}" above the socket bottom` },
        { type: 'pin', to: 'handle-bar', count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod (or an oak dowel) epoxied into a stopped 3/8" hole 1-1/2" deep in the post top and 3/4" deep in the bow underside', note: 'permanent: the posts and the bow come out of the sockets as one U' },
        { type: 'glue', to: 'handle-bar', count: 1, size: 'epoxy on the post top and the pin' },
      ],
      notes: `Planed ${f2(p.handlePostThickIn)}" × ${f2(p.handlePostWidthIn)}" from 3/4" × 1-1/4" stock (D-60; a 5/4 board makes both uprights and the bow) so it slides in the socket (inside ${f2(h.socketX - 2 * w)}" × ${f2(h.socketY - 2 * w)}", build review r2 S7). The top is sawn to the handlebow's ${h.bow.postSlopeDeg.toFixed(1)}° slope (${f2(under(yi))}" inner edge, ${f2(under(yo))}" outer edge) so the bow sits flat on it. Lifts straight out of the socket once the clevis pin is out (D-9); the bow is epoxied to the two uprights, so the handle comes off as ONE U (no wing nut inside the aluminum socket). RELIEF GROOVE (build 3c M5): the two socket screw heads stand ${f2(0.14 + 0.06)}" proud of the bore wall on the transom side, so cut a ${POST_RELIEF.widthIn}" wide × ${POST_RELIEF.depthIn}" deep groove down the middle of the post's FRONT (transom-side) face from the foot up past the parked pin hole (${f2(p.handleSocketDepthIn - 0.5)}" of it enters the socket when parked) on the table saw or router table; without it the heads bind the post. The groove is on the tension face of the hold-back bend: the handle-sockets row uses the notched section.`,
    });
    const groovedIn = Math.max(0, p.handleSocketDepthIn - 0.5);
    postPart.massLb -= ((POST_RELIEF.widthIn * POST_RELIEF.depthIn * groovedIn) / IN3_PER_FT3) * p.oakDensityPcf;
    parts.push(postPart);
    parts.push(cylinder(ctx, {
      id: `handle-pin-${tag}`, partNo: 'handle-pin', name: `Push handle retaining pin ${tag}`, group: 'removable', mat: 'fixed', kind: 'purchased', material: 'clevis pin + lynch pin', massLb: 0.05,
      fab: 'buy', step: STEP.brake, center: [h.xBar, y, h.zPin], axis: 'y', radius: p.handlePinDiameterIn / 2, length: h.socketY + 0.3,
      sourcing: { vendor: 'McMaster-Carr (clevis pin with lynch pin)' }, explode: [-1, s, 0.3],
    }));
  }
  // The handlebow (D-57): one white-oak board, bandsawn to the arc (grain along the bow, so the long grain runs out at most ~12° at the overhanging ends, where the load is small),
  // ends rounded over by hand (and by the viewer's finish). The outline is in (y, z); the board is `sec` thick along x.
  const bw = h.bow;
  const sec = p.handleBarDiameterIn;
  const under = (y: number) => bowUnderZ(bw, y, sec);
  const over = (y: number) => 2 * (Number.isFinite(bw.radiusIn) ? bw.zPost + bw.crownIn - (bw.radiusIn - Math.sqrt(Math.max(0, bw.radiusIn ** 2 - y * y))) : bw.zPost) - under(y);
  const ys = Array.from({ length: BOW_SEGMENTS + 1 }, (_, i) => -bw.yEnd + (2 * bw.yEnd * i) / BOW_SEGMENTS);
  const barOutline: Vec2[] = [...ys.map((y): Vec2 => [y, under(y)]), ...[...ys].reverse().map((y): Vec2 => [y, over(y)])];
  const zLo = Math.min(...barOutline.map((q) => q[1])), zHi = Math.max(...barOutline.map((q) => q[1]));
  const bar = profilePart(ctx, {
    id: 'handle-bar', name: 'Push handle handlebow', group: 'removable', mat: 'oak', step: STEP.brake, grain: 'y', fab: 'bandsaw',
    outline: barOutline, depth: sec, basis: 'yz', origin: [h.xBar - sec / 2, 0, 0], stock: { t: sec, w: zHi - zLo + 0.25 + (bw.crownIn + (bw.zPost - bw.zEnd)), l: 2 * bw.yEnd }, explode: [-1, 0, 0.3],
    notes: bw.crownIn > 0
      ? `Sled-style handlebow (D-53, reference/05; D-57: gentler and bandsawn): ONE white-oak board ${sec}" thick, ${(zHi - zLo + 0.25 + bw.crownIn + (bw.zPost - bw.zEnd)).toFixed(2)}" wide (the bow's own height ${(zHi - zLo).toFixed(2)}" plus its ${(bw.crownIn + (bw.zPost - bw.zEnd)).toFixed(2)}" of sweep, so the arc can be laid on the board with the grain following it to within about 5 degrees instead of running out 11 to 14 at the ends: build 3c S7) and ${(2 * bw.yEnd).toFixed(1)}" long, the long edge bandsawn to a ${bw.radiusIn.toFixed(0)}" radius arc and the other edge to a parallel arc (no lamination, no bending form), then planed and rounded over to a ${sec}" grip. Pick straight-grained stock with the grain along the board: the cut grain runs out ${bw.postSlopeDeg.toFixed(0)}° at the posts and about ${((Math.asin(Math.min(1, bw.yEnd / bw.radiusIn)) * 180) / Math.PI).toFixed(0)}° at the ends (the hold-back pull is taken between the posts, where the grain is level). The arc passes through the two post tops at ${f2(bw.zPost)}" (the grip height) and crowns ${f2(bw.crownIn)}" above them at the middle (${f2(bw.zMid)}"); the ends overhang the posts to the sled edge (y = ±${f2(bw.yEnd)}") and hang ${f2(bw.zPost - bw.zEnd)}" below the post-top level. The post tops are sawn to the bow's ${bw.postSlopeDeg.toFixed(1)}° slope and each is pinned and epoxied.`
      : `Straight handlebow (crown 0): a ${sec}" thick white-oak bar bandsawn from one board, ends eased over, pinned and epoxied to the tops of the two uprights.`,
    sourcing: { vendor: `One 5/4 white-oak board at least ${(zHi - zLo + 0.25 + bw.crownIn + (bw.zPost - bw.zEnd)).toFixed(1)}" wide (a 5/4 × 6 board, 5-1/4" actual, not a 3" or 4" board: the crowned bow is ${(zHi - zLo).toFixed(1)}" from its lowest end to its highest edge and needs its sweep on top of that to follow the grain), about ${Math.ceil((2 * bw.yEnd + 2) / 12)} ft long, straight-grained`, costUsd: 14 },
  });
  bar.joints = SIDES.map(({ s: sg, tag }) => ({ type: 'pin' as const, to: `handle-post-${tag}`, count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod epoxied, blind hole 3/4" deep in the bow, drilled square to the post-top cut', at: [localPoint(bar.transform, [h.xBar, sg * h.yPost, bw.zPost - sec / 2 + 0.375])] }));
  parts.push(bar);
  // The parked position (D-57): the posts and the bow sink `parkDropIn` deeper into the sockets (the second pin hole); the sockets and pins stay.
  if (ctx.view.handle === 'parked' && h.parkDropIn > 1e-6) {
    const down = translation(0, 0, -h.parkDropIn);
    for (const part of parts) if (/^handle-(post|bar)/.test(part.id)) { part.transform = multiply(down, part.transform); if (part.cgIn) part.cgIn = transformPoint(down, part.cgIn); }
  }
  return parts;
}

