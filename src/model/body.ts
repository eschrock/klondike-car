/** Body: decks, sides, shoulder panels, transoms, prow ornament, signs, grab handles (D-22). */
import { SIDE_CONSTRUCTION } from '../params';
import { STEP, box, span, SIDES, woodMassLb, type Ctx } from './build-utils';
import { cabinSidePoint } from './layout';
import { REFLECTOR_FRACS, REFLECTOR_SIZE } from './lighting';
import { compose } from './mat4';
import type { Part, Vec2 } from './types';

// ── Block-model placeholders ──
/** Open-frame post spacing and section (spec: posts every 12"). */
const POST_SPACING_IN = 12;
const POST_X_IN = 1.5;
/** Prow ornament height and thickness (spec: 18" tall). */
const PROW_HEIGHT_IN = 18;
const PROW_REACH_IN = 9;
const PROW_THICK_IN = 1.5;
const PROW_BASE_HALF_IN = 0.75;
const PROW_TIP_HALF_IN = 0.4;
const PROW_BASE_SETBACK_IN = 1;
/** Side sign blank (spec: 20 × 6, 6 mm ply). */
const SIGN_LEN_IN = 20;
const SIGN_HEIGHT_IN = 6;
const SIGN_MIN_LEN_IN = 4;
const SIGN_TIRE_GAP_IN = 0.25;
/** Grab handle (spec: 1 × 1.5 × 8): along x, y, z. */
const GRAB_SIZE = [8, 1.5, 1] as const;
const GRAB_AHEAD_OF_SEAT_IN = 6;

/** Curved stem profile in local (x forward, y up), CCW, from a quadratic Bezier centerline. */
function prowOutline(): Vec2[] {
  const P0: Vec2 = [PROW_BASE_HALF_IN, 0];
  const P1: Vec2 = [PROW_BASE_HALF_IN, PROW_HEIGHT_IN * 0.6];
  const P2: Vec2 = [PROW_REACH_IN - PROW_TIP_HALF_IN, PROW_HEIGHT_IN - PROW_TIP_HALF_IN];
  const N = 8;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const c: Vec2 = [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]];
    const dt: Vec2 = [2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])];
    const n = Math.hypot(dt[0], dt[1]) || 1;
    const nx = dt[1] / n, ny = -dt[0] / n;
    const w = PROW_BASE_HALF_IN + (PROW_TIP_HALF_IN - PROW_BASE_HALF_IN) * t;
    right.push([c[0] + nx * w, c[1] + ny * w]);
    left.push([c[0] - nx * w, c[1] - ny * w]);
  }
  return [left[0], ...right, ...left.slice(1).reverse()];
}

function polyAreaPerim(o: Vec2[]): { area: number; perim: number } {
  let a = 0, per = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perim: per };
}

/** Top of the prow in model coordinates (for the lantern mount). */
export function prowTop(ctx: Ctx): { x: number; z: number } {
  const top = prowOutline().reduce((b, q) => (q[1] > b[1] ? q : b));
  return { x: ctx.L.xFront - PROW_BASE_SETBACK_IN + top[0], z: ctx.L.noseTop + ctx.L.sideH + top[1] };
}

export function buildBody(ctx: Ctx): Part[] {
  const { p, L } = ctx;
  const parts: Part[] = [];
  const pl = p.panelPlyIn;
  const H = L.sideH;
  const flare = L.flare;

  // ── Decks ──
  parts.push(box(ctx, {
    id: 'deck-cabin', name: 'Cabin deck', group: 'body', mat: 'ply', edges: 'captured', step: STEP.body,
    ...span([L.xRear + L.side, L.xs], [-L.hwC, L.hwC], [L.deckBot, L.deckTop]),
  }));
  parts.push(box(ctx, {
    id: 'deck-nose', name: 'Nose deck', group: 'body', mat: 'ply', edges: 'captured', step: STEP.body,
    ...span([L.xs, L.xFront - L.side], [-L.hwN, L.hwN], [L.noseBot, L.noseTop]),
  }));

  // ── Sides ──
  const runs = [
    { zone: 'cabin', x0: L.xRear, x1: L.xs, hw: L.hwC, bot: L.deckBot, top: L.deckTop },
    { zone: 'nose', x0: L.xs, x1: L.xFront, hw: L.hwN, bot: L.noseBot, top: L.noseTop },
  ] as const;
  for (const run of runs) {
    const zTop = run.top + H;
    const runFlare = run.zone === 'cabin' ? flare : 0;
    for (const { s, tag } of SIDES) {
      const yc = s * (run.hw + L.side / 2);
      const id = `side-${run.zone}-${tag}`;
      const nm = `${run.zone === 'cabin' ? 'Cabin' : 'Nose'} ${tag === 'L' ? 'left' : 'right'}`;
      const yr = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
      if (p.sideConstruction === SIDE_CONSTRUCTION.solidOak) {
        parts.push(box(ctx, { id: `${id}-board`, partNo: `side-${run.zone}-board`, name: `${nm} side board`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, zTop]) }));
      } else if (p.sideConstruction === SIDE_CONSTRUCTION.capturedPly) {
        parts.push(box(ctx, { id: `${id}-chine`, partNo: `side-${run.zone}-chine`, name: `${nm} chine`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, run.bot + L.railBand]) }));
        parts.push(box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc + s * runFlare - L.side / 2, yc + s * runFlare + L.side / 2), [zTop - L.railBand, zTop]) }));
        const z0 = run.bot + L.railBand;
        const z1 = zTop - L.railBand;
        const hW = Math.max(0.1, z1 - z0);
        const phi = Math.atan2(runFlare, hW);
        parts.push(box(ctx, {
          id: `${id}-web`, partNo: `side-${run.zone}-web`, name: `${nm} side panel`, group: 'body', mat: 'ply', edges: 'captured', step: STEP.body,
          size: [Math.max(0.01, run.x1 - run.x0), pl, Math.hypot(hW, runFlare)],
          center: [(run.x0 + run.x1) / 2, yc + (s * runFlare) / 2, (z0 + z1) / 2], rot: { x: -s * phi },
          grain: 'x', notes: 'Captured in chine and gunwale grooves (D-22); groove depth is Phase 3.',
        }));
      } else {
        // Open frame: gunwale on posts every 12".
        parts.push(box(ctx, { id: `${id}-gunwale`, partNo: `side-${run.zone}-gunwale`, name: `${nm} gunwale`, group: 'body', mat: 'oak', step: STEP.body,
          ...span([run.x0, run.x1], yr(yc - L.side / 2, yc + L.side / 2), [zTop - L.railBand, zTop]) }));
        const n = Math.max(2, Math.ceil((run.x1 - run.x0) / POST_SPACING_IN) + 1);
        for (let i = 0; i < n; i++) {
          const x = run.x0 + POST_X_IN / 2 + ((run.x1 - run.x0 - POST_X_IN) * i) / (n - 1);
          parts.push(box(ctx, { id: `${id}-post-${i + 1}`, partNo: `side-${run.zone}-post`, name: `${nm} post ${i + 1}`, group: 'body', mat: 'oak', step: STEP.body,
            ...span([x - POST_X_IN / 2, x + POST_X_IN / 2], yr(yc - L.side / 2, yc + L.side / 2), [run.bot, zTop - L.railBand]), grain: 'z' }));
        }
      }
    }
  }

  // ── Shoulder panels closing the step from body width to nose width ──
  if (L.hwC > L.hwN + L.side + 0.01) {
    for (const { s, tag } of SIDES) {
      const ya = s * (L.hwN + L.side), yb = s * L.hwC;
      parts.push(box(ctx, {
        id: `shoulder-${tag}`, partNo: 'shoulder', name: `Shoulder panel ${tag}`, group: 'body', mat: 'ply', edges: 'captured', step: STEP.body,
        ...span([L.xs - pl, L.xs], [Math.min(ya, yb), Math.max(ya, yb)], [L.deckTop, L.deckTop + H]), grain: 'y',
      }));
    }
  }

  // ── Transoms (between the sides) ──
  const jD = p.crossmemberDepthIn;
  parts.push(box(ctx, {
    id: 'transom-rear', name: 'Rear transom', group: 'body', mat: 'oak', step: STEP.body, grain: 'y',
    ...span([L.xRear, L.xRear + L.side], [-L.hwC, L.hwC], [L.deckTop - jD, L.deckTop + H]),
  }));
  parts.push(box(ctx, {
    id: 'transom-front', name: 'Front transom', group: 'body', mat: 'oak', step: STEP.body, grain: 'y',
    ...span([L.xFront - L.side, L.xFront], [-L.hwN, L.hwN], [L.noseTop - jD, L.noseTop + H]),
  }));

  // ── Prow ornament ──
  const outline = prowOutline();
  const { area, perim } = polyAreaPerim(outline);
  const prowVol = area * PROW_THICK_IN;
  const prowTopZ = L.noseTop + H;
  parts.push({
    id: 'prow', name: 'Prow ornament', group: 'body', kind: 'bentlam', material: 'white oak',
    geometry: { type: 'extrusion', outline, depth: PROW_THICK_IN },
    transform: compose([L.xFront - PROW_BASE_SETBACK_IN, PROW_THICK_IN / 2, prowTopZ], { x: Math.PI / 2 }),
    body: 'chassis', massLb: woodMassLb(p, prowVol, 2 * area + perim * PROW_THICK_IN, p.oakDensityPcf),
    fab: 'bentlam', step: STEP.body, removable: true, explode: [0.3 / Math.hypot(0.3, 1), 0, 1 / Math.hypot(0.3, 1)],
    stock: { t: PROW_THICK_IN, w: PROW_REACH_IN, l: PROW_HEIGHT_IN }, grain: 'z',
    notes: 'TODO bentlam: simple curved stem for Phase 1; real laminated profile in Phase 3.',
  });

  // ── Signs (leaning with the flared panel) ──
  // The sign sits between the rear tire's front edge and the forward reflector, so a flared side never pushes it into the tire.
  const signX0 = L.r + SIGN_TIRE_GAP_IN;
  const signX1 = L.xRear + (L.xs - L.xRear) * REFLECTOR_FRACS[1] - REFLECTOR_SIZE[0] / 2 - SIGN_TIRE_GAP_IN;
  const signLen = Math.max(SIGN_MIN_LEN_IN, Math.min(SIGN_LEN_IN, signX1 - signX0));
  // Never taller than the side (a short side would push the sign above the gunwale and into the grab handles).
  const signH = Math.max(1, Math.min(SIGN_HEIGHT_IN, H - 0.25));
  const signX = signX0 + signLen / 2;
  const signPt = cabinSidePoint(L, L.deckTop + H / 2, L.side / 2 + pl / 2, signH / 2);
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `sign-${tag}`, partNo: 'sign', name: `Side sign ${tag}`, group: 'removable', mat: 'ply', removable: true, edges: 'exposed', step: STEP.finish,
      size: [signLen, pl, signH], center: [signX, s * signPt.y, signPt.z], rot: { x: -s * signPt.phi },
      notes: 'Edge treatment to be decided in Phase 3.',
    }));
  }

  // ── Grab handles on the gunwales ──
  const gx = p.seatXIn + GRAB_AHEAD_OF_SEAT_IN;
  const nose = gx >= L.xs;
  const gw = nose ? L.hwN : L.hwC;
  const gTop = (nose ? L.noseTop : L.deckTop) + H;
  for (const { s, tag } of SIDES) {
    parts.push(box(ctx, {
      id: `grab-${tag}`, partNo: 'grab-handle', name: `Grab handle ${tag}`, group: 'body', mat: 'oak', step: STEP.finish,
      size: [...GRAB_SIZE], center: [gx, s * (gw + L.side / 2 + (nose ? 0 : flare)), gTop + GRAB_SIZE[2] / 2],
    }));
  }
  return parts;
}
