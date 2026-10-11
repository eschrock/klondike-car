/**
 * Rear push handle (D-9, D-39): aluminum tube sockets on the rear transom, pinned oak uprights, a round oak crossbar. The handle is the handler's station
 * (it holds the brake lever's neighbor, D-53) and comes off as one U for transport.
 */
import type { Params } from '../params';
import { STEP, box, cylinder, span, SIDES, IN3_PER_FT3, type Ctx } from './build-utils';
import type { Layout } from './layout';
import { boltLength, inchesText, localPoint } from './rear-mount';
import type { Part, Vec3 } from './types';

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
  };
}

export function buildHandle(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const h = handleGeometry(p, L);
  const parts: Part[] = [];
  const w = p.handleSocketWallIn;
  const barZ = p.rearHandleHeightIn;
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
    parts.push(box(ctx, {
      id: `handle-post-${tag}`, partNo: 'handle-post', name: `Push handle upright ${tag}`, group: 'removable', mat: 'oak', removable: true, step: STEP.brake, grain: 'z',
      ...span(h.postX, [y - p.handlePostWidthIn / 2, y + p.handlePostWidthIn / 2], [h.zFoot, h.zPostTop]),
      joints: [
        { type: 'pin', to: `handle-socket-${tag}`, count: 1, size: `${p.handlePinDiameterIn}" clevis pin, cross-bored ${f2(h.zPin - h.zBot)}" above the socket bottom` },
        { type: 'pin', to: 'handle-bar', count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod (or an oak dowel) epoxied into a stopped 3/8" hole 1-1/2" deep in the post top and 3/4" deep in the bar underside', note: 'permanent: the posts and the bar come out of the sockets as one U' },
        { type: 'glue', to: 'handle-bar', count: 1, size: 'epoxy on the post top and the pin' },
      ],
      notes: `Planed ${f2(p.handlePostThickIn)}" × ${f2(p.handlePostWidthIn)}" from 1" × 1-1/2" stock so it slides in the socket (inside ${f2(h.socketX - 2 * w)}" × ${f2(h.socketY - 2 * w)}", build review r2 S7). Lifts straight out of the socket once the clevis pin is out (D-9); the crossbar is epoxied to the two uprights, so the handle comes off as ONE U (no wing nut inside the aluminum socket).`,
    }));
    parts.push(cylinder(ctx, {
      id: `handle-pin-${tag}`, partNo: 'handle-pin', name: `Push handle retaining pin ${tag}`, group: 'removable', mat: 'fixed', kind: 'purchased', material: 'clevis pin + lynch pin', massLb: 0.05,
      fab: 'buy', removable: true, step: STEP.brake, center: [h.xBar, y, h.zPin], axis: 'y', radius: p.handlePinDiameterIn / 2, length: h.socketY + 0.3,
      sourcing: { vendor: 'McMaster-Carr (clevis pin with lynch pin)' }, explode: [-1, s, 0.3],
    }));
  }
  // A real round bar (D-44): a 1-1/4" white-oak dowel, ends rounded over by the viewer's finish (it stood in as a square block before).
  const bar = cylinder(ctx, {
    id: 'handle-bar', name: 'Push handle crossbar', group: 'removable', mat: 'oak', removable: true, step: STEP.brake, axis: 'y',
    radius: p.handleBarDiameterIn / 2, length: 2 * (L.hwC + L.side), center: [h.xBar, 0, barZ],
    notes: `Round ${p.handleBarDiameterIn}" white-oak dowel (bought, no lathe), ends eased over; pinned and epoxied to the tops of the two uprights (build review r2 S7, D-44). Drill the two blind 3/8" holes in its underside with the dowel in a V-block.`,
    sourcing: { vendor: `McMaster-Carr or Rockler (${p.handleBarDiameterIn}" white-oak dowel rod, 36" length, cut to ${f2(2 * (L.hwC + L.side))}")` },
  });
  bar.grain = 'z'; // the cylinder's own axis (it lies along Y in the model)
  bar.joints = SIDES.map(({ s: sg, tag }) => ({ type: 'pin' as const, to: `handle-post-${tag}`, count: 1, diaIn: 0.375, size: '3/8" × 2-1/4" 316 stainless rod epoxied, blind hole 3/4" deep in the bar', at: [localPoint(bar.transform, [h.xBar, sg * h.yPost, barZ - p.handleBarDiameterIn / 2 + 0.375])] }));
  parts.push(bar);
  return parts;
}

