/**
 * Rear push handle (D-9, D-39, D-53): aluminum tube sockets on the rear transom, pinned oak uprights, and a sled-style HANDLEBOW: a crowned, laminated white-oak
 * bow that arches up between and over the two posts and overhangs them to the edge of the cart (reference/05). The handle is the handler's station (the basic
 * brake lever hangs under the crown, D-53) and comes off as one U for transport. The socket loads (D-39) are unchanged: the hold-back pull is taken at the
 * posts, at the grip height `rearHandleHeightIn`; the crown only adds height at the middle.
 */
import type { Params } from '../params';
import { STEP, box, cylinder, roughOf, span, woodMassLb, SIDES, IN3_PER_FT3, type Ctx } from './build-utils';
import type { Layout } from './layout';
import { boltLength, inchesText, localPoint } from './rear-mount';
import { compose } from './mat4';
import { profilePart } from './profile';
import type { Part, Vec2, Vec3 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

// ── Rear push handle: steel-tube sockets on the transom, pinned oak uprights, crossbar (D-9, D-39) ──
export interface HandleGeom {
  zTop: number;
  zBot: number;
  /** Socket outside / inside along x and y. */
  socketX: number;
  socketY: number;
  postX: [number, number];
  /** Pin height, post foot and top heights. */
  zPin: number;
  zFoot: number;
  zPostTop: number;
  /** Lever arm from the socket mouth to the grip, and from the grip to the lower contact. */
  gripArm: number;
  yPost: number;
  xBar: number;
  bow: BowGeom;
}

/**
 * The handlebow centerline (D-53): a circular arc in the y-z plane through the two post-top points (y = ±yPost, z = grip height) that rises `crown` above them at
 * the middle; beyond the posts the bow continues on the same arc to the cart edge (`yEnd`), where it hangs below the post-top level. `crown` = 0 is a straight bar.
 */
export interface BowGeom {
  crownIn: number;
  /** Arc radius (in); Infinity for a straight bar. */
  radiusIn: number;
  /** |y| of the bow ends (the cart's outer edge) and of the posts. */
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

export function handleGeometry(p: Params, L: Layout): HandleGeom {
  const w = p.handleSocketWallIn;
  const zTop = L.deckTop + L.sideH;
  const zBot = zTop - p.handleSocketDepthIn;
  const xo = L.xRear;
  const slip = p.handleSocketSlipIn;
  const postX: [number, number] = [xo - w - slip - p.handlePostThickIn, xo - w - slip];
  const barZ = p.rearHandleHeightIn;
  return {
    zTop, zBot, socketX: p.handlePostThickIn + 2 * (w + slip), socketY: p.handlePostWidthIn + 2 * (w + slip), postX,
    zPin: zBot + Math.min(1, p.handleSocketDepthIn / 4), zFoot: zBot + 0.5, zPostTop: barZ - p.handleBarDiameterIn / 2,
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
        { type: 'bolt', to: 'transom-rear', count: 2, diaIn: 0.25, size: `1/4-20 × ${inchesText(sockLen)} 316 button-head cap screws (round holes: a carriage-bolt square neck will not seat in a 1/8" aluminum wall), nylon washer under the head, fender washer + nylock nut inside the backer`,
          at: [h.zBot + 1.2, h.zTop - 1.2].map((z): Vec3 => [h.socketX / 2 - w / 2, 0, z - (h.zBot + h.zTop) / 2]), note: `grip = socket wall ${f2(w)}" + transom ${f2(L.transom)}" + backer ${f2(p.blockingThickIn)}" = ${f2(sockGrip)}"; ${f2(sockLen)}" bolt: grip + 2 washers + nut + two threads` },
        { type: 'pin', to: `handle-post-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin through both walls and the post` },
      ],
      notes: `Aluminum 6061-T6 rectangular tube ${f2(h.socketX)} × ${f2(h.socketY)} × ${f2(p.handleSocketDepthIn)} (wall ${f2(w)}), cut on the bandsaw and drilled on the drill press; the 15/16" × 1-7/16" post is a slip fit (1/32" a side) in the 1.0" × 1.5" inside. Lighter than steel (about 0.4 lb vs 1.2 lb each, plan item 5). Anodized or epoxy-coated, and bedded in epoxy / sealant against the transom: bare aluminum corrodes against wet tannin oak. Stays on the cart when the handle is removed (D-9).`,
      sourcing: { vendor: `McMaster-Carr (6061-T6 aluminum rectangular tube, ${f2(h.socketX)}" × ${f2(h.socketY)}" outside, ${f2(w)}" wall)` }, explode: [-1, 0, 0.3],
    }));
    // The post top is sawn to the bow's slope (a flat-bottom bow section sits on it): the lowest points of the bow's underside over the post, inner and outer edge (D-53).
    const yi = h.yPost - p.handlePostWidthIn / 2, yo = h.yPost + p.handlePostWidthIn / 2;
    const under = (y: number) => bowUnderZ(h.bow, y, p.handleBarDiameterIn);
    const outline: Vec2[] = s > 0
      ? [[yi, h.zFoot], [yo, h.zFoot], [yo, under(yo)], [yi, under(yi)]]
      : [[-yo, h.zFoot], [-yi, h.zFoot], [-yi, under(yi)], [-yo, under(yo)]];
    const zTopMax = Math.max(under(yi), under(yo));
    parts.push(profilePart(ctx, {
      id: `handle-post-${tag}`, name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'z',
      outline, depth: p.handlePostThickIn, basis: 'yz', origin: [h.postX[0], 0, 0], stock: { t: p.handlePostThickIn, w: p.handlePostWidthIn, l: zTopMax - h.zFoot }, explode: [-1, 0, 0.3],
      fab: 'table-saw',
      joints: [
        { type: 'pin', to: `handle-socket-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin, cross-bored ${f2(h.zPin - h.zBot)}" above the socket bottom` },
        { type: 'pin', to: 'handle-bar', count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod (or an oak dowel) epoxied into a stopped 3/8" hole 1-1/2" deep in the post top and 3/4" deep in the bow underside', note: 'permanent: the posts and the bow come out of the sockets as one U' },
        { type: 'glue', to: 'handle-bar', count: 1, size: 'epoxy on the post top and the pin' },
      ],
      notes: `Planed ${f2(p.handlePostThickIn)}" × ${f2(p.handlePostWidthIn)}" from 1" × 1-1/2" stock so it slides in the socket (inside ${f2(h.socketX - 2 * w)}" × ${f2(h.socketY - 2 * w)}", build review r2 S7). The top is sawn to the handlebow's ${h.bow.postSlopeDeg.toFixed(1)}° slope (${f2(under(yi))}" inner edge, ${f2(under(yo))}" outer edge) so the bow sits flat on it. Lifts straight out of the socket once the clevis pin is out (D-9); the bow is epoxied to the two uprights, so the handle comes off as ONE U (no wing nut inside the aluminum socket).`,
    }));
    parts.push(cylinder(ctx, {
      id: `handle-pin-${tag}`, partNo: 'handle-pin', name: `Push handle retaining pin ${tag}`, group: 'removable', mat: 'fixed', kind: 'purchased', material: 'clevis pin + lynch pin', massLb: 0.05,
      fab: 'buy', removable: true, step: STEP.brake, center: [h.xBar, y, h.zPin], axis: 'y', radius: p.handlePinDiameterIn / 2, length: h.socketY + 0.3,
      sourcing: { vendor: 'McMaster-Carr (clevis pin with lynch pin)' }, explode: [-1, s, 0.3],
    }));
  }
  // The handlebow (D-53): a laminated white-oak bow of square section, bent on a form to the arc, ends rounded over by hand (and by the viewer's finish).
  const bw = h.bow;
  const sec = p.handleBarDiameterIn;
  const plies = Math.max(2, Math.round(sec / 0.3125));
  const volIn3 = bw.lengthIn * sec * sec;
  const bowStock = { t: sec, w: sec, l: bw.lengthIn };
  const bowTransform = compose([h.xBar, 0, 0], { z: Math.PI / 2 }); // local x -> model y, local y (width) -> model -x, local z -> model z
  const bar: Part = {
    id: 'handle-bar', name: 'Push handle handlebow', group: 'removable', kind: 'bentlam', material: 'white oak',
    geometry: { type: 'sweep', path: bw.path, width: sec, thickness: sec, plies },
    transform: bowTransform, body: 'chassis', massLb: woodMassLb(p, volIn3, 4 * sec * bw.lengthIn, p.oakDensityPcf),
    fab: 'bentlam', step: STEP.brake, stock: bowStock, rough: roughOf(p, bowStock), grain: 'x', removable: true,
    explode: [-1, 0, 0.3],
    cgIn: [h.xBar, 0, (bw.zMid + bw.zEnd) / 2],
    notes: bw.crownIn > 0
      ? `Sled-style handlebow (D-53, reference/05): ${plies} plies of ${(sec / plies).toFixed(3)}" white oak bent on a form to a ${bw.radiusIn.toFixed(1)}" radius arc, ${sec}" square before the hand rounding. The arc passes through the two post tops at ${f2(bw.zPost)}" (the grip height) and crowns ${f2(bw.crownIn)}" above them at the middle (${f2(bw.zMid)}"); the ends overhang the posts to the cart edge (y = ±${f2(bw.yEnd)}") and hang ${f2(bw.zPost - bw.zEnd)}" below the post-top level. The post tops are sawn to the bow's ${bw.postSlopeDeg.toFixed(1)}° slope and each is pinned and epoxied. The basic brake lever hangs under the crown, centered, ${f2(bw.zMid - sec / 2 - (p.rearHandleHeightIn - p.brakeLeverGripBelowHandleIn + 0.5))}" of room between the top of its grip and the underside of the bow (the lever was not raised to follow the crown: its 100 lbf abuse case is at the limit already, brake-abuse). Bent lamination, white-oak springback is allowed for on the form; epoxy between plies, clamped overnight, then scraped and rounded over.`
      : `Straight handlebow (crown 0): a ${sec}" square white-oak bar, ends eased over, pinned and epoxied to the tops of the two uprights.`,
    sourcing: { vendor: `Shop-laminated: ${plies} strips of ${(sec / plies).toFixed(3)}" white oak (resawn), epoxied on a bending form`, costUsd: 15 },
  };
  bar.joints = SIDES.map(({ s: sg, tag }) => ({ type: 'pin' as const, to: `handle-post-${tag}`, count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod epoxied, blind hole 3/4" deep in the bow, drilled square to the post-top cut', at: [localPoint(bar.transform, [h.xBar, sg * h.yPost, h.bow.zPost - sec / 2 + 0.375])] }));
  parts.push(bar);
  return parts;
}

