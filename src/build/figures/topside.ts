/**
 * Figures for the topside steps, after the hull is turned upright: the side ribs and their knees, the grab boards, the storage box and its lid, the seat back and
 * its stop blocks, the brake flap kit and the push handle (see `kit.ts` for the style). Every position and size comes from the model's own layout functions
 * (`sideRibStations`, `storageGeometry`, `seatBackSupport`, `brakeGeometry`, `handleGeometry`, `gripFrame`) or from the parts' bounds; the shapes are drawn in the
 * model's own planes (side views in x-z, sections in y-z), so the pictures follow the design.
 */
import { computeLayout, sideTopAt, type Layout } from '../../model/layout';
import { worldAABB, type Bounds } from '../../model/bounds';
import type { Vec2 } from '../../model/types';
import { boxTieGeometry, kneeScrews, KNEE_SCREW_SEAT_IN, sideRibStations, type RibStation } from '../../model/side-ribs';
import { BOX_FILLET_IN, lidOpenAngleDeg, storageDrainSites, storageGeometry } from '../../model/storage';
import {
  GRIP_BACKING_H_IN, GRIP_BACKING_T_IN, GRIP_BOLT_COLS, GRIP_BOLT_DIA_IN, GRIP_BOLT_ROWS_IN, GRIP_CAP_HEAD_DEPTH_IN, GRIP_CAP_HEAD_DIA_IN, GRIP_CAP_T_IN,
  GRIP_WASHER_LOW_OD_IN, GRIP_WASHER_OD_IN, HINGE_R_IN, PIN_HEAD_IN, PIN_LEN_IN, PIN_R_IN, gripFrame, seatBackSupport,
} from '../../model/seat';
import { atPose, brakeGeometry, type V2 } from '../../model/brake-layout';
import { handleGeometry, SOCKET_ACCESS_HOLE_IN, SOCKET_SCREW_HEAD_IN } from '../../model/handle';
import { frac } from '../svg-util';
import { ribFillers } from '../cutlist';
import { roughFrac } from '../units';
import { transformPoint } from '../../model/bounds';
import { ACCENT, DIM, Fig, fit, INK, MAT, mat, MUTED, type FigCtx, type FigFn, type Frame, type MatName, type Style } from './kit';

const f8 = (v: number): string => frac(v, 8);
const f16 = (v: number): string => frac(v, 16);
const DEG = 180 / Math.PI;

/** Already built, or coming in a later step: gray, dashed. */
const GHOST: Style = mat('ghost', { dash: '4 3' });
/** A material drawn as the work of this step: its own fill, the accent outline. */
const acc = (m: MatName, extra: Style = {}): Style => mat(m, { stroke: ACCENT, width: 1.8, ...extra });
/** Swatches this file adds to the kit's materials (the box ply, the seat-back ply, the aluminum socket, the foam). */
const THIN_PLY = { fill: MAT.web.fill, stroke: MAT.web.stroke, label: 'thin plywood' };
const SEAT_PLY = { fill: MAT.deck.fill, stroke: MAT.deck.stroke, label: '12 mm plywood' };
const ALU = { fill: '#dfe3e8', stroke: '#6b7480', label: 'aluminum (anodized)' };
const FOAM = { fill: '#cfe3d4', stroke: '#5f8a6a', label: 'foam pad' };
/** The brake's pivot block: oak, a lighter fill than the flap so the two layers read apart. */
const BLOCK: Style = { fill: '#f7ead0', stroke: ACCENT, width: 1.4 };
type Swatch = { fill: string; stroke: string; label: string };

/** A rectangle given by two corners in a frame's model units. */
function rectIn(F: Fig, fr: Frame, x0: number, y0: number, x1: number, y1: number, s: Style): void {
  F.poly([fr.at([x0, y0]), fr.at([x1, y0]), fr.at([x1, y1]), fr.at([x0, y1])], s);
}
const polyIn = (F: Fig, fr: Frame, pts: Vec2[], s: Style, closed = true): void => { F.poly(pts.map(fr.at), s, closed); };

/** The kit legend plus this file's own swatches, in one row. */
function legend(F: Fig, items: Array<MatName | Swatch>, at: Vec2 = [16, F.h - 16]): void {
  let x = at[0];
  for (const it of items) {
    const sw = typeof it === 'string' ? MAT[it] : it;
    F.rect(x, at[1] - 10, 14, 10, { fill: sw.fill, stroke: sw.stroke, width: 1.2 });
    F.text([x + 19, at[1]], sw.label, { size: 11.5, color: MUTED });
    x += 19 + sw.label.length * 6.3 + 18;
  }
}

const box = (c: FigCtx, id: string): Bounds | null => { const q = c.by(id); return q ? worldAABB(q) : null; };

/** A zig-zag break line across a cut-off part (px). */
function breakLine(F: Fig, a: Vec2, b: Vec2): void {
  const n = 6, pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const off = i === 0 || i === n ? 0 : (i % 2 ? 3 : -3);
    pts.push([x + off * (b[1] - a[1] === 0 ? 0 : 1), y + off * (b[0] - a[0] === 0 ? 0 : 1)]);
  }
  F.poly(pts, { stroke: MUTED, width: 1 }, false);
}

const ROLE: Record<1 | 2 | 3 | 4, string> = { 1: 'box rib', 2: 'mid rib', 3: 'bow post', 4: 'rear rib' };
const ribStation = (c: FigCtx, n: 1 | 2 | 3 | 4): { L: Layout; st: RibStation } | null => {
  const L = computeLayout(c.p);
  const st = sideRibStations(c.p, L).find((s) => s.n === n);
  return st ? { L, st } : null;
};

// ─────────────────────────────── side-ribs ───────────────────────────────

/** 1. Where the ribs go: the inside face of the left side, with the four stations measured from the transom. */
const ribStations: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const stations = sideRibStations(p, L);
  if (!stations.length) return null;
  const w = p.sideRibWidthIn, hl = p.sideRibHeadLengthIn;
  const F = new Fig(760, 490);
  F.heading('Where the ribs go: the inside face of the left side (the right side is the same)');
  F.text([16, 44], 'Seen from the middle of the hull, bow to the right. Each distance is from the outside face of the transom to the middle of the rib.', { size: 12, color: MUTED });
  const tr = box(c, 'transom-rear'), bh = box(c, 'bow-bulkhead');
  const zMax = Math.max(sideTopAt(L, L.xSideStart), ...stations.map((s) => s.top)) + 1.2;
  const zMin = L.deckBot - p.crossmemberDepthIn - 0.3;
  const fr = fit({ minX: L.xRear - 0.4, minY: zMin, maxX: (bh?.max[0] ?? L.xSideEnd) + 0.4, maxY: zMax }, { x: 40, y: 70, w: 680, h: 230 }, 1, 'center');
  const xs: number[] = Array.from({ length: 61 }, (_, i) => L.xSideStart + ((L.xSideEnd - L.xSideStart) * i) / 60);
  const top = (x: number): number => sideTopAt(L, x);
  // the side: web, inner chine band, inner gunwale band
  const chineIn = box(c, 'side-L-chine-in');
  const zChineInBot = chineIn?.min[2] ?? L.deckTop;
  polyIn(F, fr, [[L.xSideStart, L.chineBot], [L.xSideEnd, L.chineBot], ...[...xs].reverse().map((x): Vec2 => [x, top(x)])], mat('web'));
  polyIn(F, fr, [...xs.map((x): Vec2 => [x, top(x)]), ...[...xs].reverse().map((x): Vec2 => [x, top(x) - L.railBand])], mat('oak'));
  rectIn(F, fr, L.xSideStart, zChineInBot, L.xSideEnd, L.web.z0, mat('oak'));
  // the deck (seen edge-on) and the members under it
  rectIn(F, fr, L.xSideStart, L.deckBot, L.xSideEnd, L.deckTop, mat('deck', { opacity: 0.8 }));
  if (tr) rectIn(F, fr, tr.min[0], tr.min[2], tr.max[0], tr.max[2], GHOST);
  if (bh) rectIn(F, fr, bh.min[0], bh.min[2], bh.max[0], bh.max[2], GHOST);
  const g = storageGeometry(p, L);
  const hasBox = stations.some((s) => s.kind === 'box');
  if (hasBox) rectIn(F, fr, g.x0, g.zBot, g.x1, g.zWallTop, { stroke: '#a9a9a9', width: 1.2, dash: '5 4' });
  const members = new Map<string, Bounds>();
  for (const s of stations) if (s.member) { const b = box(c, s.member); if (b) members.set(s.member, b); }
  for (const b of members.values()) rectIn(F, fr, b.min[0], b.min[2], b.max[0], b.max[2], GHOST);

  // the ribs (and their knees or box-tie gap)
  const hb = (x: number): number => top(x) - L.railBand;
  for (const s of stations) {
    const zFoot = s.kind === 'box' ? boxTieGeometry(p, L, s).z0 : L.deckTop;
    const x = s.x, nTop = 6;
    const outline: Vec2[] = [
      [x - w / 2, zFoot], [x + w / 2, zFoot], [x + w / 2, hb(x + w / 2)], [x + hl / 2, hb(x + hl / 2)],
      ...Array.from({ length: nTop + 1 }, (_, i): Vec2 => { const u = hl / 2 - (hl * i) / nTop; return [x + u, top(x + u)]; }),
      [x - hl / 2, hb(x - hl / 2)], [x - w / 2, hb(x - w / 2)],
    ];
    polyIn(F, fr, outline, acc('oak'));
    if (s.kind === 'knee') {
      const kh = Math.min(p.sideRibKneeHeightIn, s.h - L.railBand - 0.25);
      rectIn(F, fr, x - w / 2 - 0.12, L.deckTop, x + w / 2 + 0.12, L.deckTop + kh, acc('oak', { width: 1.4 }));
    } else {
      const tg = boxTieGeometry(p, L, s);
      rectIn(F, fr, x - p.boxTieWidthIn / 2 - 0.12, tg.z0, x + p.boxTieWidthIn / 2 + 0.12, tg.z1, { stroke: '#8f8a80', width: 1.2, dash: '3 3' });
    }
    const head = fr.at([x, top(x)]);
    F.text([head[0], head[1] - 10], ROLE[s.n], { size: 12, anchor: 'middle', weight: 'bold', color: ACCENT });
  }
  // callouts
  const box1 = stations.find((s) => s.n === 1 && s.kind === 'box'), mid = stations.find((s) => s.n === 2), bow = stations.find((s) => s.n === 3);
  const yDeck = fr.at([0, L.deckBot])[1];
  if (box1) {
    const tg = boxTieGeometry(p, L, box1);
    F.label(fr.at([box1.x + p.boxTieWidthIn / 2, (tg.z0 + tg.z1) / 2]), [236, yDeck + 20], ['box and rear ribs stop short of', 'the deck: a box tie, glued beside', 'the lower end against the storage', 'box (dotted), carries them'], { size: 12, anchor: 'start' });
  }
  if (mid && mid.member) {
    const kh = Math.min(p.sideRibKneeHeightIn, mid.h - L.railBand - 0.25);
    const kt = fr.at([mid.x + w / 2 + 0.1, L.deckTop + kh * 0.6]);
    F.label(kt, [kt[0] + 16, kt[1] - 8], 'knee, seen edge-on', { size: 11.5, anchor: 'start' });
    if (bow) {
      const khB = Math.min(p.sideRibKneeHeightIn, bow.h - L.railBand - 0.25);
      const bt = fr.at([bow.x + w / 2 + 0.1, L.deckTop + khB * 0.6]);
      F.label(bt, [bt[0] + 14, bt[1] - 6], 'knee', { size: 11.5, anchor: 'start' });
    }
    const mb = members.get(mid.member);
    if (mb) F.label(fr.at([mb.max[0], (mb.min[2] + mb.max[2]) / 2]), [fr.at([mid.x, 0])[0] + 30, yDeck + 60], 'the crossmember below', { size: 12, color: MUTED });
  }
  if (bow && bow.member) {
    const mb = members.get(bow.member);
    if (mb) F.label(fr.at([mb.max[0], (mb.min[2] + mb.max[2]) / 2]), [fr.at([mb.max[0], 0])[0] - 10, yDeck + 80], 'king beam', { size: 12, color: MUTED });
  }
  if (hasBox) F.text(fr.at([g.x0 + 0.4, L.web.z0 + 0.3]), 'storage box (built later)', { size: 11.5, color: MUTED });
  // the grab board (fitted in the next step), dashed, so the rib layout reads against it
  if (c.by('seat-grip-L')) {
    const gf = gripFrame(p, L);
    const corners: Vec2[] = [gf.W(gf.uRear(gf.nBot), gf.nBot), gf.W(gf.uFront(gf.nBot), gf.nBot), gf.W(gf.uFront(gf.nTop), gf.nTop), gf.W(gf.uRear(gf.nTop), gf.nTop)];
    polyIn(F, fr, corners, { stroke: '#8f8a80', width: 1.2, dash: '5 4' });
    const tc = fr.at([(corners[2][0] + corners[3][0]) / 2, Math.max(corners[2][1], corners[3][1])]);
    F.text([tc[0], tc[1] - 6], 'grab board (next step)', { size: 11.5, color: MUTED, anchor: 'middle' });
  }
  if (tr) F.text([fr.at([tr.min[0], 0])[0], fr.at([0, tr.max[2]])[1] - 6], 'transom', { size: 11.5, color: MUTED });
  if (bh) F.text([fr.at([bh.max[0], 0])[0] + 12, fr.at([0, bh.min[2]])[1]], 'bow bulkhead', { size: 11.5, color: MUTED, rotate: -90 });
  const gx = (L.xSideStart + L.xSideEnd) * 0.5;
  const gbx = mid ? mid.x - 2.5 : gx;
  F.label(fr.at([gbx, top(gbx) - L.railBand / 2]), [fr.at([gbx, 0])[0] + 10, 84], 'inner gunwale band', { size: 12 });
  const cx = box1 && mid ? box1.x + (mid.x - box1.x) * 0.6 : gx;
  F.label(fr.at([cx, (zChineInBot + L.web.z0) / 2]), [fr.at([cx, 0])[0] - 30, fr.at([0, L.web.z0])[1] - 10], 'inner chine band', { size: 12, anchor: 'end' });

  // stations, measured from the transom's outer face
  const yDim0 = yDeck + 100;
  const xT = fr.at([L.xRear, 0])[0];
  const order = [...stations].sort((a, b) => a.x - b.x);
  F.line([xT, fr.at([0, L.deckBot])[1]], [xT, yDim0 + 22 * (order.length - 1) + 4], { stroke: DIM, width: 0.8, dash: '2 2' });
  order.forEach((s, i) => {
    const y = yDim0 + 22 * i, xs1 = fr.at([s.x, 0])[0];
    const zFoot = s.kind === 'box' ? boxTieGeometry(p, L, s).z0 : L.deckTop;
    F.line([xs1, fr.at([0, zFoot])[1] + 2], [xs1, y + 4], { stroke: DIM, width: 0.8, dash: '2 2' });
    F.dim([xT, y], [xs1, y], '', 0);
    const t = `${f8(s.x - L.xRear)} to the ${ROLE[s.n]}`;
    if (xs1 + 8 + t.length * 6.6 < F.w - 12) F.text([xs1 + 6, y + 4], t, { size: 12, color: DIM });
    else F.text([xs1 - 8, y - 4], t, { size: 12, color: DIM, anchor: 'end' });
  });
  legend(F, ['web', 'oak', 'deck', 'ghost']);
  F.note('To scale');
  const ribs = order.map((s) => `the ${ROLE[s.n]} ${f8(s.x - L.xRear)}`).join(', ');
  return {
    id: 'rib-stations',
    title: 'Where the side ribs go',
    caption: `The inside face of the left side, seen from the middle of the hull, with the ribs this step glues on (orange): ${ribs} from the outside face of the transom, the same on the right side. Each rib's head laps the inner gunwale band, its top cut to the sheer, and the D-ring brackets bolt to the heads later. The mid rib and the bow post stand on the deck on a knee screwed down into the member under them; the two ribs beside the storage box stop short of the deck, because their base is the box tie glued in with the box in [[step:storage-box]].`,
    svg: F.svg('Where the side ribs go: the inside face of the left side with the four rib stations'),
  };
};

/** 2. A section across the side at the mid rib: web, bands, the filler between them, the rib, its knee, and the screws into the crossmember. */
const ribSection: FigFn = (c) => {
  const p = c.p;
  const r = ribStation(c, 2);
  if (!r || r.st.kind !== 'knee' || !r.st.member) return null;
  const { L, st } = r;
  const dep = p.sideRibDepthIn, kl = p.sideRibKneeLengthIn;
  const kh = Math.min(p.sideRibKneeHeightIn, st.h - L.railBand - 0.25);
  const band = L.sideBand, webT = L.side - 2 * band;
  const yIn = st.yIn, yOut = st.yIn + L.side, top = st.top, gb = top - L.railBand;
  const zChineInBot = box(c, 'side-L-chine-in')?.min[2] ?? L.deckTop;
  const rail = c.by('rail-L'), rb = rail ? worldAABB(rail) : null;
  const railW = rail?.stock ? rail.stock.t * (rail.plies ?? 1) : 0.75;
  const mb = box(c, st.member as string);
  const zMemBot = mb?.min[2] ?? L.deckBot - p.crossmemberDepthIn;
  const yKneeEnd = yIn - dep - kl;
  const F = new Fig(760, 556);
  F.heading('Cut across the side at the mid rib, looking forward (left side)');
  F.text([16, 46], 'Glue in this order: 1 the filler, 2 the rib, 3 the knee, then its screws.', { size: 12, color: ACCENT, weight: 'bold' });
  // h = -y: outboard to the left, inboard to the right
  const H = (y: number): number => -y;
  const zLo = zMemBot - 0.3;
  const fr = fit({ minX: H(yOut + 0.3), minY: zLo, maxX: H(yKneeEnd - 1.4), maxY: top + 0.3 }, { x: 180, y: 56, w: 260, h: 380 }, 1, 'center');
  const R = (y0: number, z0: number, y1: number, z1: number, s: Style): void => rectIn(F, fr, H(y0), z0, H(y1), z1, s);
  const at = (y: number, z: number): Vec2 => fr.at([H(y), z]);
  // context: rail, crossmember, deck
  if (rb) { R(yOut - railW, zLo, yOut, rb.max[2], GHOST); breakLine(F, at(yOut + 0.05, zLo), at(yOut - railW - 0.05, zLo)); }
  R(yOut - railW, zMemBot, yKneeEnd - 1.4, L.deckBot, GHOST);
  R(yIn + L.deckEdge, L.deckBot, yKneeEnd - 1.4, L.deckTop, mat('deck'));
  breakLine(F, at(yKneeEnd - 1.4, zMemBot), at(yKneeEnd - 1.4, L.deckTop));
  // the side sandwich
  R(yIn + band, L.chineBot, yIn + band + webT, top - L.webCap, mat('web'));
  R(yIn + band + webT, L.chineBot, yOut, L.web.z0, mat('oak'));
  R(yIn + band + webT, gb, yOut, top, mat('oak'));
  R(yIn, gb, yIn + band, top, mat('oak'));
  R(yIn, zChineInBot, yIn + band, L.web.z0, mat('oak'));
  // this step: the filler, the rib, the knee, the screws
  R(yIn, L.web.z0, yIn + band, gb, acc('oak', { width: 1.4 }));
  R(yIn - dep, L.deckTop, yIn, top, acc('oak'));
  polyIn(F, fr, [[H(yIn - dep), L.deckTop], [H(yKneeEnd), L.deckTop], [H(yIn - dep), L.deckTop + kh]], acc('oak'));
  const ks = kneeScrews(p, L);
  for (const d of ks.d) {
    const y = yIn - dep - d;
    const zFace = L.deckTop + kh * (1 - d / kl), zSeat = L.deckTop + KNEE_SCREW_SEAT_IN;
    const cb = 0.375 / 2;
    if (zFace > zSeat) R(y + cb, zSeat, y - cb, zFace, { fill: '#ffffff', stroke: MUTED, width: 0.8 });
    F.screw(at(y, zSeat), at(y, zSeat - ks.fit.lenIn), false);
  }
  // epoxy fillet at the deck
  const fil = 0.18;
  polyIn(F, fr, [[H(yKneeEnd), L.deckTop], [H(yKneeEnd - fil), L.deckTop], [H(yKneeEnd), L.deckTop + fil]], mat('epoxy'));

  // labels: outboard side on the left, inboard on the right
  const xL = 168, xR = 458;
  F.label(at(yOut - band / 2, top - 0.3), [xL, 84], 'outer gunwale band', { size: 12 });
  F.label(at(yIn + band + webT / 2, (gb + L.web.z0) / 2 + 0.6), [xL, 196], 'web', { size: 12 });
  F.label(at(yOut - band / 2, (L.chineBot + L.web.z0) / 2), [xL, 262], 'outer chine band', { size: 12 });
  F.label(at(yIn + band / 2, (zChineInBot + L.web.z0) / 2), [xL, 300], 'inner chine band', { size: 12 });
  if (rb) F.label(at(yOut - railW / 2, zLo + 0.8), [xL, 396], 'rail (under the side)', { size: 12, color: MUTED });
  F.label(at(yIn + band / 2, top - 0.15), [xR, 64], 'inner gunwale band', { size: 12 });
  F.label(at(yIn - dep / 2, gb + 0.6), [xR, 110], [`rib, ${f8(dep)} thick: epoxy full face`, 'to the bands and the filler'], { size: 12 });
  F.label(at(yIn + band / 2, (L.web.z0 + gb) / 2 - 0.4), [xR, 186], [`band-strip filler, about ${roughFrac(ribFillers(c.parts, p).find((q) => q.n === st.n)?.lengthIn ?? gb - L.web.z0)}`, 'long here, glued to the web first'], { size: 12 });
  F.label(at(yIn - dep - kl * 0.3, L.deckTop + kh * 0.45), [xR, 248], [`knee, ${f8(kl)} along the deck and ${f8(kh)} up`, 'the rib: epoxy to the rib and the deck'], { size: 12 });
  F.label(at(yKneeEnd - 0.8, L.deckTop - L.ply / 2), [xR, 318], 'deck', { size: 12, color: MUTED });
  const sy = yIn - dep - ks.d[1];
  F.label(at(sy, L.deckBot - 0.4), [xR, 364], [`${ks.d.length} stainless #${ks.fit.gauge} × ${f8(ks.fit.lenIn)} screws in`, 'counterbores, into the crossmember'], { size: 12 });
  F.label(at(yKneeEnd - 0.9, (zMemBot + L.deckBot) / 2), [xR, 420], 'crossmember under the deck', { size: 12, color: MUTED });
  // the order
  F.badge(at(yIn + band / 2, (L.web.z0 + gb) / 2 + 0.5), 1);
  F.badge(at(yIn - dep / 2, top - 1.6), 2);
  F.badge(at(yIn - dep - kl * 0.18, L.deckTop + kh * 0.18), 3);
  F.text([at(yOut, 0)[0], at(0, zLo)[1] + 18], '← outside', { size: 11.5, color: MUTED, anchor: 'end' });
  F.text([at(yKneeEnd - 1.4, 0)[0], at(0, zLo)[1] + 18], 'inside of the sled →', { size: 11.5, color: MUTED, anchor: 'end' });
  // the plan angle: drawn square to the side, which here runs off the sled's centerline; the knee's screws drift aft onto the crossmember
  const turn = Math.round(Math.atan(st.dTurn) * DEG);
  const knee = c.by(`side-rib-knee-L${st.n}`), kj = knee?.joints?.find((q) => q.type === 'screw' && q.at?.length);
  const kx = knee && kj?.at ? kj.at.reduce((a, q) => a + transformPoint(knee.transform, q)[0], 0) / kj.at.length : st.x;
  const drift = st.x - kx;
  F.text([16, 470], [
    `Drawn square to the side.${turn >= 2 ? ` Here the side runs about ${turn}° off the sled's centerline (seen from above),` : ''}`,
    Math.abs(drift) >= 1 / 16 ? `and the knee stands square to it, so its foot angles back and its screws land ${f8(Math.abs(drift))} ${drift > 0 ? 'aft' : 'forward'}` : 'Its screws land on the centerline of the member under it.',
    Math.abs(drift) >= 1 / 16 ? 'of the rib center, on the crossmember\'s centerline.' : '',
  ], { size: 12, color: MUTED });
  legend(F, ['web', 'oak', 'deck', 'epoxy', 'steel', 'ghost']);
  F.note('To scale');
  return {
    id: 'rib-section',
    title: 'The mid rib, cut across',
    caption: `The side is a sandwich: a thin plywood web with an oak band on each face at the top (gunwale) and at the bottom (chine). Between the two inner bands the web is bare, so a strip of spare band stock (the filler) is glued to it first, flush with the band faces; the rib's back then lies flat on band, filler, band and is epoxied full face. The knee is glued to the rib and the deck, and its two screws go down through the deck into the crossmember under it, which ties the top of the side to the frame. The bow post is built the same way over the king beam; the two box ribs have no knee.`,
    svg: F.svg('The mid rib cut across: web, bands, filler, rib, knee and its screws into the crossmember'),
  };
};

// ─────────────────────────────── side-holes ───────────────────────────────

/** 3. The grab board stack in section, and the five-step sequence (drill, seal, strip, bolt, cap). */
const grabBoardStack: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  if (!c.by('seat-grip-L')) return null;
  const gf = gripFrame(p, L);
  const bt = p.grabBoardThickIn, band = L.sideBand, webT = L.side - 2 * band;
  const yIn = L.hwC, yOut = L.hwC + L.side;
  const r0 = GRIP_BOLT_ROWS_IN[0], r1 = GRIP_BOLT_ROWS_IN[1];
  const sn0 = -(r0 + r1) / 2 - GRIP_BACKING_H_IN / 2, sn1 = sn0 + GRIP_BACKING_H_IN;
  const nBot = -L.railBand, nBreak = nBot - 0.9;
  const F = new Fig(760, 600);
  F.heading('A grab board, cut across at its screws, looking forward (left side)');
  F.sub([16, 52], 'A. The finished stack');
  const H = (y: number): number => -y;
  const fr = fit({ minX: H(yOut + GRIP_CAP_T_IN + 0.5), minY: nBreak - 0.2, maxX: H(yIn - bt - 0.55), maxY: gf.nTop + 0.2 }, { x: 130, y: 70, w: 150, h: 420 }, 1, 'center');
  const R = (y0: number, z0: number, y1: number, z1: number, s: Style): void => rectIn(F, fr, H(y0), z0, H(y1), z1, s);
  const at = (y: number, z: number): Vec2 => fr.at([H(y), z]);
  // the side (already built): the web stops under the gunwale top, filled with epoxy
  R(yIn + band, nBreak, yIn + band + webT, -L.webCap, mat('web'));
  R(yIn + band, -L.webCap, yIn + band + webT, 0, mat('epoxy'));
  R(yIn, nBot, yIn + band, 0, mat('oak'));
  R(yIn + band + webT, nBot, yOut, 0, mat('oak'));
  breakLine(F, at(yIn - 0.05, nBreak), at(yOut + 0.05, nBreak));
  // the board (cut beside its hand hole; the hole, beyond the cut, dashed)
  R(yIn - bt, nBot, yIn, gf.nTop, acc('oak'));
  R(yIn - bt, gf.foot, yIn, gf.foot + gf.hh, { stroke: MAT.oak.stroke, width: 1, dash: '4 3' });
  // strip and cap (the cap's back is recessed for the strip and pocketed over each head)
  R(yOut, nBot, yOut + GRIP_CAP_T_IN, 0, acc('oak'));
  R(yOut, sn0, yOut + GRIP_BACKING_T_IN, sn1, acc('steel'));
  const rows = [r0, r1];
  for (const rr of rows) R(yOut + GRIP_BACKING_T_IN, -rr - GRIP_CAP_HEAD_DIA_IN / 2, yOut + GRIP_BACKING_T_IN + GRIP_CAP_HEAD_DEPTH_IN, -rr + GRIP_CAP_HEAD_DIA_IN / 2, { fill: '#ffffff', stroke: MAT.oak.stroke, width: 0.8 });
  // the screws: head on the strip, nut and fender washer on the board
  const wT = 0.09;
  rows.forEach((rr, i) => {
    const od = i === 0 ? GRIP_WASHER_OD_IN : GRIP_WASHER_LOW_OD_IN;
    // the two rows are in different columns (staggered): the lower row's washer is behind the cut, dashed
    R(yIn - bt - wT, -rr - od / 2, yIn - bt, -rr + od / 2, i === 0 ? mat('steel') : { stroke: MAT.steel.stroke, width: 1, dash: '3 2' });
    F.bolt(at(yOut + GRIP_BACKING_T_IN, -rr), at(yIn - bt - wT, -rr));
  });
  // labels: outside on the left, inside on the right
  const xL = 126, xR = 292;
  F.label(at(yOut + GRIP_CAP_T_IN * 0.8, -0.12), [xL, 270], [`oak cap, ${f8(GRIP_CAP_T_IN)}:`, 'glued on last'], { size: 12 });
  F.label(at(yOut + GRIP_BACKING_T_IN + 0.06, -r0), [xL, 330], [`${f8(GRIP_BOLT_DIA_IN)} button-head`, 'screws, heads', 'on the strip'], { size: 12 });
  F.label(at(yOut + GRIP_BACKING_T_IN / 2, sn0 + 0.08), [xL, 404], ['stainless strip', `${f16(GRIP_BACKING_T_IN)} × ${f16(GRIP_BACKING_H_IN)}`], { size: 12 });
  F.label(at(yOut - band / 2, nBot + 0.12), [xL, 452], ['outer gunwale', 'band'], { size: 12 });
  F.label(at(yIn - bt / 2, gf.nTop - 0.5), [xR, 130], ['grab board,', `${f8(bt)} oak`], { size: 12 });
  F.label(at(yIn - bt / 2, gf.foot + gf.hh * 0.7), [xR, 200], ['hand hole', '(beyond the cut)'], { size: 12, color: MUTED });
  F.label(at(yIn - bt - wT - 0.16, -r0 + 0.15), [xR, 300], ['nylock nut and a fender', 'washer on each screw', '(lower one dashed)'], { size: 12 });
  F.label(at(yIn + band / 2, nBot + 0.1), [xR, 410], ['inner gunwale', 'band'], { size: 12 });
  F.label(at(yIn + band + webT / 2, nBreak + 0.3), [xR, 456], 'web', { size: 12 });
  F.text([at(yOut, 0)[0], at(0, nBreak)[1] + 62], '← outside', { size: 11.5, color: MUTED, anchor: 'end' });
  F.text([at(yIn - bt, 0)[0], at(0, nBreak)[1] + 62], 'inside →', { size: 11.5, color: MUTED });

  // B. the order
  const sx = 452;
  F.sub([410, 52], 'B. The order, one board at a time');
  const hole = frac(GRIP_BOLT_DIA_IN + 1 / 32, 64);
  const steps: Array<[string[], Parameters<typeof thumb>[3]]> = [
    [['Drill the strip alone on the drill press', `(${hole}, cobalt bit, cutting oil); deburr`, 'and wipe it clean with acetone.'], { stripOnly: true }],
    [['Drill the wood dry: clamp the board and', 'the strip in place, the strip as the', 'template, one bit through every layer.'], { board: true, strip: true, drill: true }],
    [['Seal. Take it apart. Brush epoxy into', 'the web holes, onto the board back', 'and the band face under it.'], { seal: true }],
    [['Strip. Epoxy it to the outer band, a', 'rod through each hole while it cures.'], { strip: true, hot: 'strip' }],
    [['Bolt. Set the board; screws in from', 'outside, washers and nuts inside.', 'Tighten every nut: no access later.'], { board: true, strip: true, bolts: true, hot: 'bolts' }],
    [['Cap. Epoxy the oak cap over the strip', 'and the heads; clamp it with a caul.'], { board: true, strip: true, bolts: true, cap: true, hot: 'cap' }],
  ];
  steps.forEach(([t, o], i) => {
    const y = 84 + i * 80;
    F.badge([424, y + 14], i + 1);
    thumb(F, sx, y, o);
    F.text([510, y + 12], t, { size: 12 });
  });
  legend(F, ['oak', 'web', 'steel', 'epoxy']);
  F.note('Section, to scale; both screw rows in one cut');
  return {
    id: 'grab-board-stack',
    title: 'How a grab board is fastened',
    caption: `Each grab board laps the inside of the gunwale and is through-bolted: five ${f8(GRIP_BOLT_DIA_IN)} screws (${GRIP_BOLT_COLS} in an upper row, ${GRIP_BOLT_COLS - 1} in a lower row between them) pass the board, both bands, the web and a stainless strip on the outside, with a nylock nut and a fender washer on the board (${f8(GRIP_WASHER_OD_IN)} under the upper row, ${f8(GRIP_WASHER_LOW_OD_IN)} under the lower). The thin outer band could not take a hard pull on the screw heads alone, so the strip spreads it, and the oak cap then covers the strip and the heads for good. Every nut has to be tight before the cap goes on. The D-ring holes in the rib heads are drilled in this step too, with each bracket as the template.`,
    svg: F.svg('A grab board cut across at its screws, and the five-step order: drill, seal, strip, bolt, cap'),
  };
};

/** A small schematic stack for the sequence: the gunwale bands and web, and what is on them at that stage. */
function thumb(F: Fig, x: number, y: number, o: { board?: boolean; strip?: boolean; stripOnly?: boolean; bolts?: boolean; cap?: boolean; drill?: boolean; seal?: boolean; hot?: 'strip' | 'bolts' | 'cap' }): void {
  // x grows inboard; 7 px per eighth, roughly
  const top = y, bot = y + 40;
  const cap = 0, strip = 11, oBand = 14, web = 19, iBand = 25, board = 30, end = 42;
  const X = (v: number): number => x + v;
  const st = (m: MatName, hot: boolean): Style => (hot ? acc(m, { width: 1.5 }) : mat(m, { width: 1 }));
  if (o.stripOnly) {
    // the strip on its own, on the drill press table, drilled down through
    F.rect(X(4), top + 30, 40, 4, acc('steel', { width: 1.2 }));
    F.rect(X(-2), top + 34, 52, 5, mat('bench', { width: 1 }));
    for (const xx of [14, 34]) F.arrow([X(xx), top - 6], [X(xx), top + 26], ACCENT, 1.6);
    return;
  }
  if (o.cap) F.rect(X(cap), top, oBand - cap, 26, st('oak', o.hot === 'cap'));
  if (o.strip) F.rect(X(strip), top + 4, 3, 18, st('steel', o.hot === 'strip'));
  F.rect(X(oBand), top, web - oBand, 26, mat('oak', { width: 1 }));
  F.rect(X(web), top, iBand - web, bot - top, mat('web', { width: 1 }));
  F.rect(X(iBand), top, board - iBand, 26, mat('oak', { width: 1 }));
  if (o.board) F.rect(X(board), top - 12, end - board, 38, mat('oak', { width: 1 }));
  if (o.seal) {
    // apart: the board set off to the inside, epoxy in the web holes, on the board's back and on the band face under it
    F.rect(X(board) + 10, top - 12, end - board, 38, mat('oak', { width: 1 }));
    for (const yy of [top + 6, top + 17]) F.rect(X(web), yy, iBand - web, 3, mat('epoxy', { stroke: ACCENT, width: 1 }));
    F.rect(X(board) + 7, top - 12, 3, 38, mat('epoxy', { stroke: ACCENT, width: 1 }));
    F.rect(X(board), top, 3, 26, mat('epoxy', { stroke: ACCENT, width: 1 }));
  }
  if (o.bolts) for (const yy of [top + 7, top + 18]) { F.line([X(strip) - 2, yy], [X(end) + 4, yy], { stroke: o.hot === 'bolts' ? ACCENT : MAT.steel.stroke, width: 2 }); F.rect(X(strip) - 4, yy - 3, 3, 6, mat('steel', { width: 0.8 })); F.rect(X(end), yy - 3, 4, 6, mat('steel', { width: 0.8 })); }
  if (o.drill) for (const yy of [top + 7, top + 18]) F.arrow([X(-14), yy], [X(end) + 10, yy], ACCENT, 1.6);
}

// ─────────────────────────────── storage-box ───────────────────────────────

/** 4. The box on the deck: plan with the ties, backers and turn-button blocks; a section at the box rib; a corner detail. */
const storageBox: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const g = storageGeometry(p, L);
  const stations = sideRibStations(p, L).filter((s) => s.kind === 'box');
  if (!c.by('storage-side-L')) return null;
  const dep = p.sideRibDepthIn, hl = p.sideRibHeadLengthIn;
  const F = new Fig(760, 710);
  F.heading('The storage box on the deck');
  // ── A. plan, from above, lid off (x right = forward, +y up = the left side)
  F.sub([16, 52], 'A. From above, lid off (bow to the right)');
  const xEnd = g.x1 + 2.5;
  const yMax = L.hwC + L.side + 0.2;
  const pl = fit({ minX: L.xRear - 0.3, minY: -yMax, maxX: xEnd, maxY: yMax }, { x: 250, y: 66, w: 260, h: 300 }, 1, 'center');
  const R = (x0: number, y0: number, x1: number, y1: number, s: Style): void => rectIn(F, pl, x0, y0, x1, y1, s);
  for (const s of [1, -1]) R(L.xSideStart, s * L.hwC, xEnd, s * (L.hwC + L.side), GHOST);
  R(L.xRear, -yMax + 0.2, L.xRear + L.transom, yMax - 0.2, GHOST);
  for (const tag of ['L', 'R']) { const b = box(c, `transom-backer-${tag}`); if (b) R(b.min[0], b.min[1], b.max[0], b.max[1], GHOST); }
  for (const st of stations) for (const s of [1, -1]) R(st.x - hl / 2, s * (st.yIn - dep), st.x + hl / 2, s * st.yIn, GHOST);
  // the floor inside the walls, then the coaming on top of the walls
  R(g.x0, -g.hw, g.x1, g.hw, { fill: '#fbf8f0', stroke: 'none' });
  const cw = g.coamW;
  R(g.x0, g.hw - cw, g.x1, g.hw, acc('oak', { width: 1.4 }));
  R(g.x0, -g.hw, g.x1, -g.hw + cw, acc('oak', { width: 1.4 }));
  R(g.x0, -g.hw + cw, g.x0 + cw, g.hw - cw, acc('oak', { width: 1.4 }));
  R(g.x1 - cw, -g.hw + cw, g.x1, g.hw - cw, acc('oak', { width: 1.4 }));
  // box ties, hinge backers, turn-button blocks (on the transom), drains
  for (const st of stations) {
    const tg = boxTieGeometry(p, L, st);
    for (const s of [1, -1]) R(st.x - p.boxTieWidthIn / 2, s * tg.yBox, st.x + p.boxTieWidthIn / 2, s * tg.yRib, acc('oak', { width: 1.4 }));
  }
  for (const tag of ['L', 'R']) {
    const lb = box(c, `storage-turn-block-${tag}`);
    if (lb) R(lb.min[0], lb.min[1], lb.max[0], lb.max[1], acc('oak', { width: 1.4 }));
  }
  const drains = storageDrainSites(p, L);
  for (const d of drains) F.circle(pl.at([d.x, d.y]), 3.5, { fill: '#ffffff', stroke: INK, width: 1.2 });
  // labels
  const lx = 238, rx = 522;
  const b1 = stations.find((s) => s.n === 1), b4 = stations.find((s) => s.n === 4);
  if (b4) F.label(pl.at([b4.x, (g.hw + b4.yIn - dep) / 2]), [lx, 92], 'box tie at the rear rib', { size: 12 });
  if (b1) F.label(pl.at([b1.x, (g.hw + b1.yIn - dep) / 2]), [rx, 92], 'box tie at the box rib', { size: 12 });
  const lbL = box(c, 'storage-turn-block-L');
  if (lbL) F.label(pl.at([(lbL.min[0] + lbL.max[0]) / 2, (lbL.min[1] + lbL.max[1]) / 2]), [lx, 150], ['turn-button blocks on the inside of', 'the transom, their tops level with', 'the lid top (the buttons go on last)'], { size: 12 });
  F.text([pl.at([L.xRear, 0])[0] - 6, pl.at([0, 0])[1] + 4], 'transom', { size: 11.5, color: MUTED, anchor: 'end' });
  if (drains[1]) {
    F.label(pl.at([drains[1].x, drains[1].y]), [lx, 300], ['drain holes: the floor falls', `about ${f8(0.125)} toward each`], { size: 12 });
    if (drains[0]) { const d0 = pl.at([drains[0].x, drains[0].y]); F.line(d0, [lx + 3, 296], { stroke: MUTED, width: 1 }); F.circle(d0, 2.4, { fill: MUTED }); }
  }
  F.label(pl.at([g.x1 - cw / 2, -g.hw * 0.85]), [rx, 250], [`oak coaming, ${f8(g.coamW)} × ${f8(g.coamT)}, on the`, 'wall tops: the lid and its gasket', 'sit on oak, never on a ply edge'], { size: 12 });
  if (b1) F.label(pl.at([b1.x + hl / 2 - 0.1, -(b1.yIn - dep / 2)]), [rx, 340], 'rib (glued in [[step:side-ribs]])', { size: 12, color: MUTED });
  F.text([pl.at([g.x1, 0])[0] + 8, pl.at([0, 0])[1] + 4], 'bow →', { size: 11.5, color: MUTED });
  F.text([pl.at([(g.x0 + g.x1) / 2, 0])[0], pl.at([0, 0])[1] - 30], ['the deck is', 'the box floor'], { size: 11.5, color: MUTED, anchor: 'middle' });
  F.text([pl.at([(g.x0 + g.x1) / 2, 0])[0], pl.at([0, 0])[1] + 12], [`outside ${frac(g.x1 - g.x0, 32)} × ${frac(2 * g.hw, 32)}`, `aft wall ${frac(g.x0 - L.xRear, 32)} ahead of`, 'the transom\'s outer face'], { size: 12, anchor: 'middle' });

  // ── B. section across the box at the box rib (left half, looking forward)
  const st = b1 ?? stations[0];
  F.sub([16, 406], 'B. Cut across at the box rib, looking forward');
  if (st) {
    const tg = boxTieGeometry(p, L, st);
    const band = L.sideBand, webT = L.side - 2 * band, zCut = Math.min(st.top, g.zTop + 0.8);
    const yIn = st.yIn, yOut = yIn + L.side;
    const Hh = (y: number): number => -y;
    const yMin = g.hw - 2.6;
    const sf = fit({ minX: Hh(yOut + 0.3), minY: L.deckBot - 0.2, maxX: Hh(yMin), maxY: zCut + 0.2 }, { x: 196, y: 422, w: 170, h: 244 }, 1, 'center');
    const S = (y0: number, z0: number, y1: number, z1: number, s: Style): void => rectIn(F, sf, Hh(y0), z0, Hh(y1), z1, s);
    const at = (y: number, z: number): Vec2 => sf.at([Hh(y), z]);
    S(yIn + L.deckEdge, L.deckBot, yMin, L.deckTop, mat('deck'));
    const zChineInBot = box(c, 'side-L-chine-in')?.min[2] ?? L.deckTop;
    S(yIn + band, L.chineBot, yIn + band + webT, zCut, mat('web'));
    S(yIn + band + webT, L.chineBot, yOut, L.web.z0, mat('oak'));
    S(yIn, zChineInBot, yIn + band, L.web.z0, mat('oak'));
    S(yIn, L.web.z0, yIn + band, zCut, GHOST);
    S(yIn - dep, tg.z0, yIn, zCut, GHOST);
    breakLine(F, at(yOut + 0.05, zCut), at(yIn - dep - 0.05, zCut));
    // gasket and lid (later)
    S(g.hw - g.pl, g.zWallTop, g.hw, g.zWallTop + g.gasket, GHOST);
    S(g.hw - g.rimW, g.lidUnderZ - g.rimT, g.hw, g.zTop, GHOST);
    S(yMin, g.zTop - g.pl, g.hw - g.rimW, g.zTop, GHOST);
    // this step: wall, fillet, bead, coaming, tie
    S(g.hw - g.pl, L.deckTop, g.hw, g.zPlyTop, { fill: THIN_PLY.fill, stroke: ACCENT, width: 1.6 });
    const fi = BOX_FILLET_IN;
    polyIn(F, sf, [[Hh(g.hw - g.pl), L.deckTop], [Hh(g.hw - g.pl - fi), L.deckTop], [Hh(g.hw - g.pl), L.deckTop + fi]], mat('epoxy', { stroke: ACCENT, width: 1 }));
    polyIn(F, sf, [[Hh(g.hw), L.deckTop], [Hh(g.hw + fi / 2), L.deckTop], [Hh(g.hw), L.deckTop + fi / 2]], mat('epoxy', { stroke: ACCENT, width: 1 }));
    S(g.hw - g.coamW, g.zPlyTop, g.hw, g.zWallTop, acc('oak'));
    S(g.hw, tg.z0, yIn - dep, tg.z1, acc('oak'));
    const xl = 186, xr = 378;
    F.label(at(yIn - dep / 2, zCut - 0.5), [xl, 440], 'rib', { size: 12, color: MUTED });
    const gap = g.zPlyTop - tg.z1;
    F.label(at(yIn - dep - 0.05, (tg.z1 + g.zPlyTop) / 2), [xl, 478], [`its top ${f8(gap)} below the`, 'top of the plywood wall'], { size: 12 });
    F.label(at((g.hw + yIn - dep) / 2, (tg.z0 + tg.z1) / 2), [xl, 540], ['box tie: thickened epoxy', 'on both faces'], { size: 12 });
    F.label(at(yIn + band + webT / 2, L.web.z0 + 0.6), [xl, 600], 'side', { size: 12, color: MUTED });
    F.label(at(yIn - 1, (L.deckBot + L.deckTop) / 2), [xl, 650], 'deck', { size: 12, color: MUTED });
    F.label(at(yMin + 0.4, g.zTop - g.pl / 2), [xr, 440], ['lid and gasket', '(next step)'], { size: 12, color: MUTED });
    F.label(at(g.hw - g.coamW / 2, g.zWallTop - 0.05), [xr, 492], 'coaming', { size: 12 });
    F.label(at(g.hw - g.pl / 2, (L.deckTop + g.zPlyTop) / 2 - 1), [xr, 560], ['box side', '(thin plywood)'], { size: 12 });
    F.label(at(g.hw - g.pl - fi / 3, L.deckTop + fi / 3), [xr, 630], [`${f8(fi)} fillet inside,`, 'bead outside'], { size: 12 });
  }

  // ── C. a corner, from above: 45° bevels, the fillet and the glass tape
  F.sub([500, 406], 'C. One corner, from above');
  {
    const t = g.pl, Lw = 1.6, fi = BOX_FILLET_IN;
    const cf = fit({ minX: -0.2, minY: -0.2, maxX: Lw + 0.2, maxY: Lw + 0.2 }, { x: 500, y: 430, w: 150, h: 150 }, 1, 'center');
    // outer corner at the origin; one wall along +x, the other along +y (y up in the frame)
    polyIn(F, cf, [[0, 0], [Lw, 0], [Lw, t], [t, t]], { fill: THIN_PLY.fill, stroke: ACCENT, width: 1.6 });
    polyIn(F, cf, [[0, 0], [t, t], [t, Lw], [0, Lw]], { fill: THIN_PLY.fill, stroke: ACCENT, width: 1.6 });
    const arc: Vec2[] = Array.from({ length: 9 }, (_, i): Vec2 => { const a = Math.PI + (Math.PI / 2) * (i / 8); return [t + fi + fi * Math.cos(a), t + fi + fi * Math.sin(a)]; });
    polyIn(F, cf, [[t, t], [t + fi, t], ...arc.reverse(), [t, t + fi]], mat('epoxy', { stroke: ACCENT, width: 1 }));
    const tape: Vec2[] = [[t + 1, t + 0.04], [t + fi, t + 0.04], ...Array.from({ length: 9 }, (_, i): Vec2 => { const a = (3 * Math.PI) / 2 - (Math.PI / 2) * (i / 8); return [t + fi + (fi - 0.04) * Math.cos(a), t + fi + (fi - 0.04) * Math.sin(a)]; }), [t + 0.04, t + fi], [t + 0.04, t + 1]];
    F.poly(tape.map(cf.at), { stroke: '#2563eb', width: 2 }, false);
    F.label(cf.at([t + fi * 0.3, t + fi * 0.3]), [660, 470], [`${f8(fi)} epoxy`, 'fillet in each', 'inside corner'], { size: 12 });
    F.label(cf.at([t + 0.9, t + 0.04]), [660, 540], ['2" glass tape', 'over it', '(no spline)'], { size: 12, color: '#2563eb' });
    F.label(cf.at([t / 2, t / 2]), [540, 624], ['walls: edges beveled 45°, taped', 'outside, epoxy in the V, folded up'], { size: 12, anchor: 'start' });
  }
  legend(F, ['oak', THIN_PLY, 'deck', 'epoxy', 'ghost']);
  F.note('Each view to its own scale');
  return {
    id: 'storage-box',
    title: 'The storage box',
    caption: `The box has no bottom of its own: its four thin plywood walls stand on the sealed deck, which is the floor, with a fillet inside and a bead outside so no plywood edge is left bare. An oak coaming caps the walls so the lid and its gasket sit on oak. The box ties fill the gap between the box side and the rear and box ribs from [[step:side-ribs]]: they make the box the base of those ribs, so a push on the gunwale there goes into the box. The two turn-button blocks go on the transom: at the final fit an oak button pivots on each and swings over the lid's aft edge to hold it shut.`,
    svg: F.svg('The storage box on the deck: plan, a section at the box rib and a corner detail'),
  };
};

// ─────────────────────────────── storage-lid ───────────────────────────────

/** 5. The lid: the frame round the panel, the battens let into the frame sides; plan and a section at a batten. */
const storageLid: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const g = storageGeometry(p, L);
  const lid = c.by('storage-lid');
  const battens = c.parts.filter((q) => /^storage-lid-batten-\d+$/.test(q.id));
  if (!lid) return null;
  const rw = g.rimW, hw = g.hw, x0 = g.x0, x1 = g.x1, lx1 = g.lidX1, xh = g.xh;
  const rab = lid.stock ? Math.max(0, (lid.stock.w - 2 * (hw - rw)) / 2) : 0.25;
  const strip = box(c, 'storage-strip'), stripEnd = box(c, 'storage-strip-end-L');
  const F = new Fig(760, 990);
  F.heading('The lid: an oak frame round a thin panel, hinged on a fixed strip at the front of the box');
  // ── A. plan
  F.sub([16, 52], 'A. From above (the battens and the strip\'s groove are underneath, dashed)');
  const pf = fit({ minX: x0 - 0.3, minY: -hw - 0.3, maxX: x1 + 0.3, maxY: hw + 0.3 }, { x: 40, y: 70, w: 270, h: 300 }, 1, 'center');
  const R = (a: number, b: number, c2: number, d: number, s: Style): void => rectIn(F, pf, a, b, c2, d, s);
  R(x0 + rw, -hw + rw, lx1 - rw, hw - rw, { fill: THIN_PLY.fill, stroke: ACCENT, width: 1.4 });
  R(x0, hw - rw, lx1, hw, acc('oak'));
  R(x0, -hw, lx1, -hw + rw, acc('oak'));
  R(x0, -hw + rw, x0 + rw, hw - rw, acc('oak'));
  R(lx1 - rw, -hw + rw, lx1, hw - rw, acc('oak'));
  for (const b of battens) {
    const bb = worldAABB(b);
    R(bb.min[0], bb.min[1], bb.max[0], bb.max[1], { stroke: ACCENT, width: 1.4, dash: '5 3' });
  }
  for (const xc of [x0 + rw / 2, lx1 - rw / 2]) for (const s of [1, -1]) R(xc - 3 / 16, s * (hw - rw) - 3 / 8, xc + 3 / 16, s * (hw - rw) + 3 / 8, { stroke: INK, width: 1, dash: '2 2' });
  // the panel's edge in its rabbet
  R(x0 + rw - rab, -hw + rw - rab, lx1 - rw + rab, hw - rw + rab, { stroke: MUTED, width: 0.8, dash: '1 3' });
  // the fixed strip (glued on the box), its groove underneath and the end blocks in it; the gasket gap; the two hinges flat on top across the joint
  if (strip) {
    R(xh, -hw, x1, hw, mat('oak'));
    if (stripEnd) R(stripEnd.min[0], -(hw - g.coamW), stripEnd.max[0], hw - g.coamW, { stroke: MAT.oak.stroke, width: 1, dash: '4 3' });
  }
  R(lx1, -hw, xh, hw, mat('rubber'));
  const hinges = ['L', 'R'].map((t) => box(c, `storage-hinge-${t}`)).filter((b): b is NonNullable<typeof b> => !!b);
  for (const hb of hinges) R(hb.min[0], hb.min[1], hb.max[0], hb.max[1], mat('steel'));
  const lx = 330;
  F.label(pf.at([(x0 + lx1) / 2 + 1.5, hw - rw / 2]), [lx, 96], `frame sides: ${f8(rw)} oak, the full length of the lid`, { size: 12 });
  F.label(pf.at([lx1 - rw / 2, hw - rw]), [lx, 128], ['a small loose tenon at each corner (dotted),', 'in mortises in both pieces'], { size: 12 });
  F.label(pf.at([lx1 - rw / 2, -hw * 0.75]), [lx, 168], 'frame ends, between the sides', { size: 12 });
  F.label(pf.at([(x0 + lx1) / 2 - 2.5, hw * 0.1]), [lx, 198], 'panel, its edge in a rabbet all round', { size: 12 });
  if (battens.length) { const bb = worldAABB(battens[battens.length - 1]); F.label(pf.at([(bb.min[0] + bb.max[0]) / 2, -hw * 0.45]), [lx, 228], [`${battens.length} battens under the panel, glued to it,`, 'their ends butted to the frame sides'], { size: 12 }); }
  if (hinges[0]) F.label(pf.at([(hinges[0].min[0] + hinges[0].max[0]) / 2, (hinges[0].min[1] + hinges[0].max[1]) / 2]), [lx, 270], ['2 butt hinges flat on top, across the joint', `between the lid and the strip (${f8(xh - lx1)} gap, the gasket)`], { size: 12 });
  if (strip) F.label(pf.at([(xh + x1) / 2 + 0.6, -hw * 0.2]), [lx, 312], [`fixed oak strip, ${frac(x1 - xh, 16)} wide, glued on the box's`, 'coaming; grooved underneath (dashed), end blocks', 'in the groove where it sits on the side coamings'], { size: 12 });
  F.text([pf.at([x0, 0])[0], pf.at([0, -hw])[1] + 18], 'aft end', { size: 11.5, color: MUTED });
  F.text([pf.at([x1, 0])[0], pf.at([0, -hw])[1] + 18], 'fore end of the box', { size: 11.5, color: MUTED, anchor: 'end' });
  F.text([lx, 376], ['Order: 1 make and glue on the strip, 2 cut the', 'joints, 3 seal the panel, 4 glue the frame round', 'it, 5 glue the battens, lid face down, weighted.'], { size: 12, color: ACCENT, weight: 'bold' });

  // ── B. section at a batten, the left frame side
  F.sub([16, 440], 'B. Cut across at a batten, at the left edge, looking forward');
  const yA = hw - rw - 1.9, yB = hw + 0.25;
  const zA = g.zPlyTop - 0.45, zB = g.zTop + 0.2;
  const H = (y: number): number => -y;
  const sf = fit({ minX: H(yB), minY: zA, maxX: H(yA), maxY: zB }, { x: 240, y: 456, w: 300, h: 150 }, 1, 'center');
  const S = (a: number, b: number, c2: number, d: number, s: Style): void => rectIn(F, sf, H(a), b, H(c2), d, s);
  const at = (y: number, z: number): Vec2 => sf.at([H(y), z]);
  S(hw - g.pl, zA, hw, g.zPlyTop, GHOST);
  S(hw - g.coamW, g.zPlyTop, hw, g.zWallTop, GHOST);
  S(hw - g.pl, g.zWallTop, hw, g.zWallTop + g.gasket, mat('rubber'));
  const zLidBot = g.zTop - g.pl - g.rimT, zBatTop = g.zTop - g.pl;
  // frame side: full section with the rabbet notch at its top inside edge; the batten butts its inside face
  polyIn(F, sf, [[H(hw), zLidBot], [H(hw - rw), zLidBot], [H(hw - rw), g.zTop - rab], [H(hw - rw + rab), g.zTop - rab], [H(hw - rw + rab), g.zTop], [H(hw), g.zTop]], acc('oak'));
  S(yA, g.zTop - g.pl, hw - rw + rab, g.zTop, { fill: THIN_PLY.fill, stroke: ACCENT, width: 1.6 });
  S(yA, zLidBot, hw - rw, zBatTop, acc('oak'));
  breakLine(F, at(yA, zLidBot - 0.05), at(yA, g.zTop + 0.05));
  const xl = 236, xr = 552;
  F.label(at(hw - rw / 2 + 0.1, g.zTop - 0.15), [xl, 466], 'frame side', { size: 12 });
  F.label(at(hw - rw + rab / 2, g.zTop - g.pl / 2), [xl, 500], ['panel edge in the rabbet', `(${f8(rab)} × ${f8(rab)}), glued`], { size: 12 });
  F.label(at(hw - rw - 0.05, (zLidBot + zBatTop) / 2), [xl, 552], ['batten end butted to the', 'frame side, thickened epoxy'], { size: 12 });
  F.label(at(hw - g.pl / 2, g.zWallTop + g.gasket / 2), [xl, 600], 'gasket on the coaming', { size: 12, color: MUTED });
  F.label(at(yA + 0.45, g.zTop - g.pl / 2), [xr, 512], 'panel (thin plywood)', { size: 12 });
  F.label(at(yA + 0.45, (zLidBot + zBatTop) / 2), [xr, 556], 'batten, glued to the panel', { size: 12 });

  // ── C. side view: the lid swings up about the hinge pins, past upright, onto the upright seat back
  const openDeg = lidOpenAngleDeg(p, L);
  const sb = seatBackSupport(p, L);
  F.sub([16, 640], `C. From the left side: the lid opens past upright (about ${Math.round(openDeg)}°) and leans on the seat back`);
  if (sb.rear) {
    const s = L.seat;
    const pt = (a: number, b: number): Vec2 => [s.Pr[0] + s.col0[0] * a + s.col2[0] * b, s.Pr[2] + s.col0[2] * a + s.col2[2] * b];
    const zMax = Math.max(pt(0, sb.H)[1], g.zTop + (lx1 - x0)) + 0.5;
    const cf = fit({ minX: L.xRear - 0.5, minY: L.deckTop - 0.6, maxX: Math.max(x1, pt(sb.t, 0)[0]) + 1.2, maxY: zMax }, { x: 250, y: 660, w: 300, h: 290 }, 1, 'center');
    const C = (a: number, b: number, c2: number, d: number, st: Style): void => rectIn(F, cf, a, b, c2, d, st);
    C(L.xRear - 0.5, L.deckTop - 0.47, Math.max(x1, pt(sb.t, 0)[0]) + 1.2, L.deckTop, mat('deck', { opacity: 0.8 }));
    C(x0, L.deckTop, x1, g.zWallTop, GHOST);
    if (strip) polyIn(F, cf, [[xh, g.zWallTop], [x1, g.zWallTop], [x1, g.zTop], [xh, g.zTop]], acc('oak'));
    polyIn(F, cf, [pt(0, 0), pt(sb.t, 0), pt(sb.t, sb.H), pt(0, sb.H)], { ...GHOST, dash: '5 3' });
    const pin: Vec2 = [(lx1 + xh) / 2, g.zTop + 1 / 16];
    const lidPoly: Vec2[] = [[x0, zLidBot], [lx1, zLidBot], [lx1, g.zTop], [x0, g.zTop]];
    polyIn(F, cf, lidPoly, { stroke: MUTED, width: 1, dash: '3 3' });
    const th = (openDeg * Math.PI) / 180, co = Math.cos(th), sn = Math.sin(th);
    const rot = lidPoly.map(([x, z]): Vec2 => { const dx = x - pin[0], dz = z - pin[1]; return [pin[0] + dx * co + dz * sn, pin[1] - dx * sn + dz * co]; });
    polyIn(F, cf, rot, acc('oak'));
    F.circle(cf.at(pin), 3.5, mat('steel'));
    const xl3 = 238, xr3 = 566;
    F.label(cf.at([(rot[2][0] + rot[3][0]) / 2, (rot[2][1] + rot[3][1]) / 2 - 1]), [xl3, 690], ['the lid, open: it leans past upright', 'onto the seat back and stays there'], { size: 12 });
    F.label(cf.at(pt(sb.t / 2, sb.H * 0.75)), [xr3, 720], ['seat back, upright', '(flip it forward and the lid', 'would fold right over: open', 'it with a hand on it then)'], { size: 12, color: MUTED });
    F.label(cf.at(pin), [xr3, 840], ['hinge pins, on top across the', 'joint between strip and lid'], { size: 12 });
    if (strip) F.label(cf.at([(xh + x1) / 2, (g.zWallTop + g.zTop) / 2]), [xr3, 888], 'fixed strip', { size: 12 });
    F.label(cf.at([(x0 + lx1) / 2, g.zTop]), [xl3, 880], 'the lid, shut (dashed)', { size: 12, color: MUTED });
    F.label(cf.at([x0 + 1, (L.deckTop + g.zWallTop) / 2]), [xl3, 920], 'box (already built)', { size: 12, color: MUTED });
  }
  legend(F, ['oak', THIN_PLY, 'rubber', 'steel', 'ghost']);
  F.note('Each view to its own scale');
  return {
    id: 'storage-lid',
    title: 'The storage lid',
    caption: `A fixed oak strip is glued across the front of the box top first; the lid is hinged on its aft edge, so the lid is shorter than the box and swings up and back past upright, to rest on the upright seat back (about ${Math.round(openDeg)}°): no lid stay. The lid is a thin plywood panel held in an oak frame: the panel's edge sits in a rabbet along the top inside edge of all four frame pieces, and the corners are joined with small loose tenons. ${battens.length} oak battens under the panel stop it sagging under a cushion or a light load; they are glued under the panel with thickened epoxy, the lid face down and weighted, and butted to the frame sides; no screws go through the thin panel. The frame's underside seals on the gasket on the coaming of the box from [[step:storage-box]], and its front face on the gasket on the strip's aft face. The two hinges lie flat on top across the joint.`,
    svg: F.svg('The storage lid from above, cut across at a batten, and from the side opening onto the seat back'),
  };
};

// ─────────────────────────────── seat-blocks ───────────────────────────────

/** 6. A stop block on the deck against the box end: its sloped face, the tilted latch hole, the screws from below, and the crest strip over the taped hinge leaves. */
const seatBlocks: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const sb = seatBackSupport(p, L);
  const g = storageGeometry(p, L);
  if (!sb.rear || !c.by('seat-wedge-L')) return null;
  const s = L.seat;
  const col0: Vec2 = [s.col0[0], s.col0[2]], col2: Vec2 = [s.col2[0], s.col2[2]], Pr: Vec2 = [s.Pr[0], s.Pr[2]];
  const F = new Fig(760, 470);
  F.heading('A seat-back stop block on the box end, seen from the side (bow to the right)');
  F.text([16, 46], 'Order: 1 shape the block, mark its latch hole, 2 glue it on, screws from below, 3 bed the crest strip.', { size: 12, color: ACCENT, weight: 'bold' });
  const xMin = g.x1 - 1.6, xMax = s.P[0] + 1.4;
  const fr = fit({ minX: xMin, minY: L.deckBot - 1.4, maxX: xMax, maxY: g.zTop + 0.5 }, { x: 230, y: 50, w: 300, h: 380 }, 1, 'center');
  const R = (a: number, b: number, c2: number, d: number, st: Style): void => rectIn(F, fr, a, b, c2, d, st);
  // context
  R(xMin, L.deckBot, xMax, L.deckTop, mat('deck', { opacity: 0.8 }));
  R(g.x1 - g.pl, L.deckTop, g.x1, g.zPlyTop, GHOST);
  R(g.x1 - g.coamW, g.zPlyTop, g.x1, g.zWallTop, GHOST);
  // the fixed strip across the front of the box top (D-89: the lid is hinged on its aft edge, out of this view); its fore leg on the fore coaming
  R(Math.max(xMin, g.xh), g.zWallTop, g.x1, g.zTop, GHOST);
  // the seat back that will lean here (next step), dashed
  const H = sb.H, t = sb.t;
  const corner = (a: number, b: number): Vec2 => [Pr[0] + col0[0] * a + col2[0] * b, Pr[1] + col0[1] * a + col2[1] * b];
  const topC = Math.min(H, (g.zTop + 0.4 - Pr[1]) / col2[1]);
  polyIn(F, fr, [corner(0, 0), corner(t, 0), corner(t, topC), corner(0, topC)], { stroke: '#a9a9a9', width: 1.2, dash: '5 4' });
  // the block (this step) and the crest strip (between the blocks); the hinge leaf is behind the block here, dashed
  polyIn(F, fr, sb.wedge, acc('oak'));
  const cs = box(c, 'seat-crest-strip');
  const [, , qa, qd] = sb.wedge;
  const faceX = (z: number): number => sb.wedge[1][0] + ((qa[0] - sb.wedge[1][0]) * (z - sb.wedge[1][1])) / (qa[1] - sb.wedge[1][1]);
  if (cs) {
    const z0 = cs.min[2];
    R(g.x1, z0, cs.min[0], qa[1], mat('epoxy', { opacity: 0.9 }));
    polyIn(F, fr, [[cs.min[0], z0], [faceX(z0), z0], [qa[0], qa[1]], [cs.min[0], qd[1]]], { stroke: ACCENT, width: 1.6, dash: '5 3' });
  }
  // the latch hole: square to the sloped face, at the pin station up the back
  const mouth: Vec2 = [Pr[0] + col2[0] * sb.c2L, Pr[1] + col2[1] * sb.c2L];
  const depth = PIN_LEN_IN - t;
  const into: Vec2 = [-col0[0], -col0[1]];
  const pin = (a: number, b: number): Vec2 => [mouth[0] + into[0] * a + col2[0] * b, mouth[1] + into[1] * a + col2[1] * b];
  polyIn(F, fr, [pin(0, -PIN_R_IN), pin(depth, -PIN_R_IN), pin(depth, PIN_R_IN), pin(0, PIN_R_IN)], { stroke: INK, width: 1.2, dash: '3 2' });
  // screws up from under the deck
  const wx0 = sb.wedge[0][0], wx1 = sb.wedge[1][0];
  for (const f of [0.25, 0.75]) { const x = wx0 + (wx1 - wx0) * f; F.screw(fr.at([x, L.deckBot]), fr.at([x, L.deckBot + 1.25]), true); }
  // labels
  const xl = 220, xr = 545;
  const ang = Math.round(90 - sb.a * DEG);
  F.label(fr.at([(sb.wedge[0][0] + faceX(L.deckTop + 2)) / 2, L.deckTop + 1]), [xr, fr.at([0, L.deckTop + 1.6])[1]], ['stop block: glued to the deck', 'and the box end'], { size: 12 });
  F.label(fr.at([faceX(L.deckTop + 4), L.deckTop + 4]), [xr, fr.at([0, L.deckTop + 4.6])[1]], `sloped face ${ang}° from level`, { size: 12 });
  F.label(fr.at(pin(depth * 0.5, PIN_R_IN)), [xr, fr.at([0, mouth[1] + 1])[1]], [`${f8(2 * PIN_R_IN)} latch hole (dashed): mark it now,`, 'drill it later through the seat back\'s', `pin hole, square to the face (${Math.round(sb.a * DEG)}° tilt)`], { size: 12 });
  if (cs) F.label(fr.at([(cs.min[0] + qa[0]) / 2, (cs.min[2] + qa[1]) / 2]), [xr, fr.at([0, qa[1]])[1] - 14], ['crest strip, ripped to a wedge in line', 'with the block faces; between the two', 'blocks (dashed: behind this one)'], { size: 12 });
  if (cs) F.label(fr.at([(g.x1 + cs.min[0]) / 2, cs.min[2] + 0.3]), [xl, fr.at([0, cs.min[2] - 0.2])[1] + 4], 'thickened epoxy on the box end', { size: 12 });
  F.label(fr.at([g.x1 - g.pl / 2, L.deckTop + 1.2]), [xl, fr.at([0, L.deckTop + 1.6])[1]], 'box fore end', { size: 12, color: MUTED });
  F.label(fr.at([xMin + 0.5, (g.zWallTop + g.zTop) / 2]), [xl, fr.at([0, g.zTop])[1] - 6], 'fixed strip at the front of the box top', { size: 12, color: MUTED });
  F.label(fr.at([g.x1 - g.coamW / 2, (g.zPlyTop + g.zWallTop) / 2]), [xl, fr.at([0, (g.zPlyTop + g.zWallTop) / 2])[1] + 6], 'oak coaming on the box wall', { size: 12, color: MUTED });
  F.label(fr.at([(wx0 + wx1) / 2 + 0.2, L.deckBot + 0.3]), [xl, fr.at([0, L.deckBot])[1] + 40], ['2 screws up from UNDER the deck,', 'countersunk (none from above)'], { size: 12 });
  F.label(fr.at(corner(t / 2, topC * 0.75)), [xr, fr.at([0, g.zTop])[1] - 8], 'the seat back leans here (next step)', { size: 12, color: MUTED });
  F.text([fr.at([xMax, 0])[0] - 4, fr.at([0, L.deckBot])[1] + 16], 'deck', { size: 11.5, color: MUTED, anchor: 'end' });
  F.badge([fr.at([wx0, 0])[0] + 14, fr.at([0, L.deckTop])[1] - 14], 1);
  F.badge([fr.at([wx0, 0])[0] + 14, fr.at([0, L.deckBot])[1] + 26], 2);
  if (cs) F.badge(fr.at([cs.min[0] + 0.2, qa[1] + 0.35]), 3);
  legend(F, ['oak', 'deck', 'epoxy', 'steel', 'ghost']);
  F.note('To scale');
  return {
    id: 'seat-stop-block',
    title: 'A seat-back stop block',
    caption: `The seat back does not stand up by itself: it leans back onto two oak stop blocks glued to the deck against the box end, one each side, and onto the crest strip between them. Each block's front face is cut to the lean of the back (${ang}° from level), and its latch hole is only marked now: it is drilled in [[step:seat-back]] through the seat back's own pin hole, so the two line up. The blocks are clamped by two screws driven up from under the deck (nothing shows on top). The crest strip is bedded on the box end in thickened epoxy, under the fixed strip at the front of the box top from [[step:storage-lid]].`,
    svg: F.svg('A seat-back stop block on the box end, seen from the side, with its latch hole and the crest strip'),
  };
};

// ─────────────────────────────── seat-back ───────────────────────────────

/** 7. The seat back in its two positions: upright on the stop blocks (pinned into the block), and flipped forward flat on the deck (pinned through the deck into the backer). */
const seatBackPositions: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const sb = seatBackSupport(p, L);
  const g = storageGeometry(p, L);
  if (!c.by('seat-back-panel')) return null;
  const s = L.seat;
  const col0: Vec2 = [s.col0[0], s.col0[2]], col2: Vec2 = [s.col2[0], s.col2[2]], Pr: Vec2 = [s.Pr[0], s.Pr[2]], P: Vec2 = [s.P[0], s.P[2]];
  const H = sb.H, t = sb.t;
  const phi = Math.PI / 2 + sb.a;
  const lower = L.deckTop - P[1];
  const flip = (q: Vec2): Vec2 => {
    const dx = q[0] - P[0], dz = q[1] - P[1], c0 = Math.cos(-phi), s0 = Math.sin(-phi);
    return [P[0] + dx * c0 - dz * s0, P[1] + dx * s0 + dz * c0 + lower];
  };
  const onBack = (a: number, b: number): Vec2 => [Pr[0] + col0[0] * a + col2[0] * b, Pr[1] + col0[1] * a + col2[1] * b];
  const panel: Vec2[] = [onBack(0, 0), onBack(t, 0), onBack(t, H), onBack(0, H)];
  const backer = box(c, 'seat-hinge-backer-L');
  const cushion = box(c, 'seat-cushion');
  const pad = c.by('seat-back-pad');
  const padThick = pad?.stock?.t ?? 1.5;
  const F = new Fig(760, 440);
  F.heading('The seat back: upright for a rider, or flipped forward flat for cargo');
  const k = 13;
  // A. upright
  F.sub([16, 52], 'A. Upright: pinned to the stop block');
  const xA0 = g.x1 - 1.8, xA1 = P[0] + 4.5, zA0 = L.deckBot - 1.4, zA1 = Pr[1] + col2[1] * H + 0.6;
  const fa = fit({ minX: xA0, minY: zA0, maxX: xA1, maxY: zA1 }, { x: 170, y: 76, w: k * (xA1 - xA0), h: k * (zA1 - zA0) }, 1, 'bottom');
  // B. flat
  const flat = panel.map(flip);
  const xB0 = g.x1 - 1.8, xB1 = Math.max(...flat.map((q) => q[0])) + 1.2, zB1 = L.deckTop + 6.5;
  F.sub([470, 52], 'B. Flipped flat, front face down (lower right)');
  const fb = fit({ minX: xB0, minY: zA0, maxX: xB1, maxY: zB1 }, { x: 446, y: 214, w: k * (xB1 - xB0), h: k * (zB1 - zA0) }, 1, 'bottom');
  const ctx = (fr: Frame, x0: number, x1: number): void => {
    rectIn(F, fr, x0, L.deckBot, x1, L.deckTop, mat('deck', { opacity: 0.8 }));
    if (backer) rectIn(F, fr, backer.min[0], backer.min[2], backer.max[0], backer.max[2], GHOST);
    rectIn(F, fr, g.x1 - g.pl, L.deckTop, g.x1, g.zPlyTop, GHOST);
    rectIn(F, fr, x0, g.lidUnderZ - g.rimT, g.x1, g.zTop, GHOST);
    polyIn(F, fr, sb.wedge, GHOST);
  };
  const hinge = (fr: Frame, leafA: Vec2, leafB: Vec2): void => {
    const c0 = fr.at([P[0], L.deckTop + HINGE_R_IN]);
    F.line(c0, fr.at(leafA), { stroke: MAT.steel.stroke, width: 2.4 });
    F.line(c0, fr.at(leafB), { stroke: MAT.steel.stroke, width: 2.4 });
    F.circle(c0, HINGE_R_IN * fr.kx + 1.5, mat('steel'));
  };
  // panel A
  ctx(fa, xA0, xA1);
  if (cushion) {
    rectIn(F, fa, cushion.min[0], cushion.min[2], xA1, cushion.max[2], { fill: FOAM.fill, stroke: FOAM.stroke, width: 1, dash: '4 3' });
    const cc = fa.at([(Math.max(cushion.min[0], P[0] + 1.6) + xA1) / 2, (cushion.min[2] + cushion.max[2]) / 2]);
    F.text([cc[0], cc[1] + 4], 'cushion', { size: 11.5, color: '#3f6b4a', anchor: 'middle' });
  }
  if (pad) polyIn(F, fa, [onBack(t, 2.2), onBack(t + padThick, 2.2), onBack(t + padThick, H - 0.4), onBack(t, H - 0.4)], { fill: FOAM.fill, stroke: FOAM.stroke, width: 1, dash: '4 3' });
  polyIn(F, fa, panel, { fill: SEAT_PLY.fill, stroke: ACCENT, width: 1.8 });
  hinge(fa, onBack(t, 1.1), [P[0] + 1.1, L.deckTop]);
  const pinA = (a: number, b: number): Vec2 => onBack(t - a, sb.c2L + b);
  polyIn(F, fa, [pinA(-PIN_HEAD_IN, -0.32), pinA(0, -0.32), pinA(0, 0.32), pinA(-PIN_HEAD_IN, 0.32)], acc('steel', { width: 1.2 }));
  polyIn(F, fa, [pinA(0, -PIN_R_IN), pinA(PIN_LEN_IN, -PIN_R_IN), pinA(PIN_LEN_IN, PIN_R_IN), pinA(0, PIN_R_IN)], acc('steel', { width: 1.2 }));
  const xl = 160, xr = 300;
  F.label(fa.at(onBack(t / 2, H * 0.62)), [xl, fa.at(onBack(0, H * 0.62))[1]], ['seat back', '(12 mm plywood)'], { size: 12 });
  F.label(fa.at([(sb.wedge[0][0] + sb.wedge[1][0]) / 2, L.deckTop + 2.5]), [xl, fa.at([0, L.deckTop + 3])[1]], ['stop block', '(last step)'], { size: 12, color: MUTED });
  if (pad) F.label(fa.at(onBack(t + padThick / 2, H * 0.55)), [xr, fa.at([0, Pr[1] + col2[1] * H * 0.55])[1]], ['foam pad on hook-', 'and-loop (off for', 'cargo)'], { size: 12, color: MUTED });
  F.label(fa.at(pinA(-PIN_HEAD_IN / 2, 0.3)), [xr, fa.at([0, L.deckTop + 4.2])[1]], ['spring-detent pin', 'through the panel', 'into the block'], { size: 12 });
  F.label(fa.at([P[0], L.deckTop + HINGE_R_IN]), [xr, fa.at([0, L.deckTop])[1] + 6], ['butt hinge: one leaf', 'on the front face,', 'one on the deck'], { size: 12 });
  if (backer) F.label(fa.at([(backer.min[0] + backer.max[0]) / 2, backer.min[2] + 0.2]), [xl, fa.at([0, backer.min[2]])[1] + 14], 'backer pad under the deck', { size: 12, color: MUTED });
  // the flip arrow, from A's top to B's panel
  const tipA = fa.at(onBack(t / 2, H));
  const flatEnd = fb.at(flip(onBack(0, H * 0.8)));
  F.arrow([tipA[0] + 10, tipA[1] - 4], [flatEnd[0], flatEnd[1] - 14], ACCENT, 2.4, -50);
  F.text([470, 100], [`flips forward ${Math.round(phi * DEG)}°`, 'about the hinge'], { size: 12, color: ACCENT, weight: 'bold' });
  // panel B
  ctx(fb, xB0, xB1);
  polyIn(F, fb, flat, { fill: SEAT_PLY.fill, stroke: ACCENT, width: 1.8 });
  hinge(fb, flip(onBack(t, 1.1)), [P[0] + 1.1, L.deckTop]);
  const hc: Vec2 = flip(onBack(t / 2, sb.c2L));
  const zTopFlat = Math.max(...flat.map((q) => q[1]));
  rectIn(F, fb, hc[0] - 0.32, zTopFlat, hc[0] + 0.32, zTopFlat + PIN_HEAD_IN, acc('steel', { width: 1.2 }));
  rectIn(F, fb, hc[0] - PIN_R_IN, zTopFlat - PIN_LEN_IN, hc[0] + PIN_R_IN, zTopFlat, acc('steel', { width: 1.2 }));
  F.label(fb.at([hc[0] + 0.25, zTopFlat + PIN_HEAD_IN]), [fb.at([hc[0], 0])[0] + 40, fb.at([0, zA0])[1] + 4], ['the same pin, through the panel', 'and the deck into the backer pad'], { size: 12 });
  F.text([fb.at([xB0, 0])[0], fb.at([0, zA0])[1] + 56], ['The back lies front face down. The seat cushion', 'and the back pad go in the storage box.'], { size: 12, color: MUTED });
  legend(F, [SEAT_PLY, 'steel', FOAM, 'ghost']);
  F.note('Side views, to scale');
  return {
    id: 'seat-back-positions',
    title: 'The seat back, upright and flat',
    caption: `The seat back hangs on two butt hinges at its front bottom edge: one leaf on the panel's front face (screwed into inserts), the other on the deck, screwed through into an oak backer pad underneath. Upright, it leans on the stop blocks and the crest strip from [[step:seat-blocks]], and a spring-detent pin each side goes through the panel into the block's latch hole. For cargo the cushion and pad come off, the back flips forward ${Math.round(phi * DEG)}° onto the deck, and the same pins go through the same holes and the deck into the backer pads. This step makes the panel and fits everything dry; the hardware goes on for good after the finish.`,
    svg: F.svg('The seat back upright on its stop blocks and flipped flat on the deck, with its hinges and pins'),
  };
};

// ─────────────────────────────── brake-flaps ───────────────────────────────

/** 8. The flap kit: a side view of the lever over the tire, and a section across the knee at the pivot pin. */
const brakeKit: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const g = brakeGeometry(p, L);
  if (!g.ok || !c.by('brake-flap-R')) return null;
  const rel = (q: V2): Vec2 => atPose(g, 0, q) as Vec2;
  const F = new Fig(760, 680);
  F.heading('The brake flap kit (right side)');
  // ── A. side view, released
  F.sub([16, 52], 'A. From outside the right side, bow to the right, released');
  const zTopA = g.bungee.A[2] + 0.8;
  const fa = fit({ minX: g.xEnd - 1.6, minY: -0.2, maxX: g.knee.x1 + 0.8, maxY: zTopA }, { x: 30, y: 66, w: 440, h: 330 }, 1, 'center');
  // context: the hull side and rail, the transom, the tire
  const tr = box(c, 'transom-rear');
  const xs0 = L.xSideStart, xs1 = g.knee.x1 + 0.8;
  rectIn(F, fa, xs0, g.rail.zb, xs1, g.rail.zt, GHOST);
  const sheer: Vec2[] = Array.from({ length: 21 }, (_, i): Vec2 => { const x = xs0 + ((xs1 - xs0) * i) / 20; return [x, Math.min(zTopA, sideTopAt(L, x))]; });
  F.poly(sheer.map(fa.at), { stroke: '#a9a9a9', width: 1.2, dash: '4 3' }, false);
  if (tr) rectIn(F, fa, tr.min[0], tr.min[2], tr.max[0], Math.min(tr.max[2], zTopA), GHOST);
  F.circle(fa.at(g.O), g.r * fa.kx, { fill: '#e4e4e4', stroke: '#a9a9a9', width: 1.2, dash: '4 3' });
  // the knee and its strap
  rectIn(F, fa, g.knee.x0, g.knee.zBot, g.knee.x1, g.knee.zTop, mat('oak'));
  rectIn(F, fa, g.strap.x0, g.strap.z0, g.strap.x1, g.strap.z1, acc('steel'));
  for (const x of g.strap.xs) for (const z of g.strap.zs) F.circle(fa.at([x, z]), 2.6, { fill: MAT.steel.stroke });
  // the flap: its underside is the plane p·v = c in the applied pose
  const off = g.c - (g.H[0] * g.v[0] + g.H[1] * g.v[1]);
  const under = (sA: number): V2 => [g.H[0] + g.u[0] * sA + g.v[0] * off, g.H[1] + g.u[1] * sA + g.v[1] * off];
  const over = (sA: number, extra = 0): V2 => { const q = under(sA); return [q[0] + g.v[0] * (g.board.thick + extra), q[1] + g.v[1] * (g.board.thick + extra)]; };
  F.poly([under(g.board.s0), under(g.board.s1), over(g.board.s1), over(g.board.s0)].map(rel).map(fa.at), acc('oak'));
  const b0 = g.board.s0, b1 = g.board.s0 + g.plan.blockLen;
  F.poly([over(b0), over(b1), over(b1, g.plan.blockT), over(b0, g.plan.blockT)].map(rel).map(fa.at), BLOCK);
  F.poly(g.shoe.outline.map(rel).map(fa.at), acc('oak', { width: 1.4 }));
  F.poly([...g.pad.top, ...[...g.pad.bot].reverse()].map(rel).map(fa.at), mat('rubber'));
  const tread = box(c, 'brake-foot-tread-R');
  if (tread) rectIn(F, fa, tread.min[0], tread.min[2], tread.max[0], tread.max[2], mat('rubber'));
  F.circle(fa.at(g.H), 4, { fill: '#ffffff', stroke: INK, width: 1.4 });
  // the return cord from the flap's end eye to the transom eye
  const E = g.bungee.Erel, A: Vec2 = [g.bungee.A[0], g.bungee.A[2]];
  F.line(fa.at(E), fa.at(A), { stroke: '#7c3aed', width: 2.2 });
  const Sx: Vec2 = [g.stop.S[0], g.stop.S[2]];
  F.line(fa.at(E), fa.at(Sx), { stroke: '#0f766e', width: 2 });
  F.circle(fa.at(Sx), 3, { fill: '#0f766e' });
  F.circle(fa.at(A), 3, { fill: '#7c3aed' });
  // the chock, parked on its cord
  F.poly(g.chock.poly.map((q) => fa.at(q as Vec2)), mat('oak', { width: 1 }));
  F.line(fa.at(g.chock.chockEye as Vec2), fa.at(g.chock.kneeEye as Vec2), { stroke: MUTED, width: 1.2, dash: '3 2' });
  // the press
  const foot = fa.at(rel([g.F[0], g.F[1]]));
  F.arrow([foot[0], foot[1] - 50], [foot[0], foot[1] - 10], ACCENT, 2.6);
  F.text([foot[0] + 8, foot[1] - 40], 'step here', { size: 12, color: ACCENT, weight: 'bold' });
  // labels A
  const xr = 486;
  const yOf = (z: number): number => fa.at([0, z])[1];
  F.label(fa.at([g.strap.x1 - 0.2, g.strap.z1 - 0.3]), [xr, yOf(g.strap.z1) - 6], 'stainless strap, 4 screws', { size: 12 });
  F.label(fa.at(g.H), [xr, yOf(g.H[1]) + 10], 'pivot pin', { size: 12 });
  F.label(fa.at([(g.knee.x0 + g.knee.x1) / 2, g.knee.zBot + 2]), [xr, yOf(g.knee.zBot + 2)], ['knee (made in [[step:brake-knees]];', 'on the bench now)'], { size: 12, color: MUTED });
  F.label(fa.at([g.chock.xBack - 0.6, 0.5]), [xr, yOf(0.5) + 4], 'wheel chock on its cord', { size: 12, color: MUTED });
  const flapMid = rel(over(g.board.s1 * 0.45));
  F.label(fa.at(flapMid), [fa.at(flapMid)[0] + 20, yOf(g.knee.zTop + 3.4)], `flap, ${f8(g.board.thick)} oak`, { size: 12, anchor: 'start' });
  const shoeTop = rel(g.shoe.outline[2] as V2);
  F.label(fa.at([shoeTop[0] - 0.3, shoeTop[1] - 0.2]), [fa.at(shoeTop)[0] + 40, yOf(g.knee.zTop + 1.6)], 'shoe block, cut to the tire', { size: 12 });
  const padPt = rel(g.pad.bot[1]);
  F.label(fa.at(padPt), [fa.at(padPt)[0] - 50, yOf(g.O[1] + 1.4)], [`rubber pad, ${f8(p.brakePadGapIn)} off`, 'the tire when released'], { size: 12, anchor: 'end' });
  F.label(fa.at([(E[0] + A[0]) / 2, (E[1] + A[1]) / 2 + 2]), [fa.at([A[0], 0])[0] + 40, 80], 'shock cord to a high eye on the transom: it lifts the flap', { size: 12 });
  F.text([fa.at(g.O)[0], fa.at(g.O)[1] + 4], 'rear tire', { size: 11.5, anchor: 'middle', color: MUTED });
  if (tr) F.label(fa.at([tr.min[0] + 0.2, g.rail.zb + 1.5]), [fa.at([tr.min[0], 0])[0] - 8, yOf(g.rail.zb) + 18], 'transom', { size: 12, color: MUTED });
  if (tr) F.label(fa.at([(E[0] + g.stop.S[0]) / 2, (E[1] + g.stop.S[2]) / 2]), [fa.at([tr.max[0], 0])[0] + 14, 128], ['stop cord to a low eye,', 'slack when you step'], { size: 12, anchor: 'start' });
  F.label(fa.at([xs1 - 0.3, (g.rail.zb + g.rail.zt) / 2]), [xr, yOf(g.rail.zb) + 18], 'hull rail', { size: 12, color: MUTED });
  const shx = xs1 - 0.5, shz = Math.min(zTopA, sideTopAt(L, shx));
  F.label(fa.at([shx, shz]), [fa.at([xs1, 0])[0] + 12, yOf(shz) + 4], 'top edge of the hull side (dashed)', { size: 12, color: MUTED });

  // ── B. section across the knee at the pin, looking forward (right side: outboard to the right)
  F.sub([16, 438], 'B. Cut across the knee at the pin, looking forward');
  F.text([16, 456], 'The pin is held on both sides of the flap: in the knee and in the strap (double shear).', { size: 12, color: ACCENT });
  const pv = g.pivot, kn = g.knee, sp = g.strap;
  const pinIn = pv.ySlot[0] - pv.blind, pinOut = pinIn + pv.len;
  const yFace = kn.poly[0][0];
  const zLo = pv.zPocketBot - 0.9, zHi = kn.zTop + 0.3;
  const fb = fit({ minX: yFace - L.side - 0.2, minY: zLo, maxX: pinOut + 0.4, maxY: zHi }, { x: 250, y: 476, w: 240, h: 170 }, 1, 'center');
  const S = (y0: number, z0: number, y1: number, z1: number, st: Style): void => rectIn(F, fb, y0, z0, y1, z1, st);
  S(yFace - L.side, zLo, yFace, zHi, GHOST);
  const clipped: Vec2[] = kn.poly.map((q) => [q[0], Math.max(zLo, q[1])] as Vec2);
  F.poly(clipped.map(fb.at), mat('oak'));
  breakLine(F, fb.at([yFace - L.side - 0.05, zLo]), fb.at([kn.yOut + 0.05, zLo]));
  S(pv.ySlot[0], pv.zPocketBot, kn.yOut, pv.zPocketTop, { fill: '#ffffff', stroke: MAT.oak.stroke, width: 1 });
  // the tongue and the pivot block
  S(pv.yTongue[0], pv.zTongueBot, pv.yTongue[1], pv.zTongueBot + g.board.thick, acc('oak'));
  S(pv.yTongue[0], pv.zTongueBot + g.board.thick, pv.yTongue[1], pv.zTongueTop, BLOCK);
  { const a = fb.at([pv.yTongue[0], pv.zTongueTop]), b = fb.at([pv.yTongue[1], pv.zTongueBot + g.board.thick]); F.hatch(a[0], a[1], b[0] - a[0], b[1] - a[1], MAT.oak.stroke, 5); }
  S(sp.y0, sp.z0, sp.y1, sp.z1, acc('steel'));
  // the pin: blind in the inboard wall, through the tongue stack and the strap, the clip outboard
  S(pinIn, g.H[1] - pv.dia / 2, pinOut, g.H[1] + pv.dia / 2, acc('steel', { width: 1.2 }));
  const clipY = sp.y1 + (pinOut - sp.y1) * 0.6;
  F.line(fb.at([clipY, g.H[1] + 0.45]), fb.at([clipY, g.H[1] - 0.45]), { stroke: ACCENT, width: 2.2 });
  const yb = (z: number): number => fb.at([0, z])[1];
  F.label(fb.at([pinIn + 0.3, g.H[1] + pv.dia / 2]), [240, 494], [`the pin goes ${f8(pv.blind)} into the`, 'pocket\'s inside wall (blind)'], { size: 12 });
  F.label(fb.at([(pv.yTongue[0] + pv.yTongue[1]) / 2 - 0.3, pv.zTongueBot + 0.2]), [240, yb(pv.zTongueBot) + 8], 'flap tongue in the pocket', { size: 12 });
  F.label(fb.at([yFace - L.side / 2, zLo + 0.6]), [240, yb(zLo) - 4], 'hull side', { size: 12, color: MUTED });
  F.label(fb.at([pv.yTongue[1] - 0.15, pv.zTongueTop - 0.12]), [500, 494], 'pivot block, glued and screwed on', { size: 12 });
  F.label(fb.at([sp.y1, sp.z1 - 0.2]), [500, 526], 'strap across the open side', { size: 12 });
  F.label(fb.at([clipY, g.H[1] - 0.4]), [500, yb(g.H[1]) + 26], 'hitch-pin clip outside the strap', { size: 12 });
  F.label(fb.at([(kn.poly[0][0] + pv.ySlot[0]) / 2, zLo + 0.4]), [500, yb(zLo) - 4], 'knee', { size: 12, color: MUTED });
  legend(F, ['oak', 'steel', 'rubber', 'ghost']);
  F.note('A and B each to scale');
  return {
    id: 'brake-kit',
    title: 'The brake flap kit',
    caption: `Each brake is a lever over a rear tire: an oak flap pivots on a pin in the knee ahead of the tire and reaches back to a foot tread at the transom. Stepping on the tread swings the shoe and its rubber pad down onto the tire; the shock cord to a high eye on the transom lifts it off again, and a stop cord down to a low eye holds it there, ${f8(p.brakePadGapIn)} clear of the tire; the stop cord goes slack when you step. The flap's tongue sits in a pocket in the knee, open at the back and at the outside; a stainless strap screwed across the open side carries the outer end of the pin, and the inner end sits in a blind hole, so the pin is held on both sides of the flap. Pull the clip and the pin and the flap lifts off in seconds.`,
    svg: F.svg('The brake flap kit: side view over the tire, and a section across the knee at the pivot pin'),
  };
};

// ─────────────────────────────── handle ───────────────────────────────

/** 9. The push handle: the U in its sockets on the transom, riding and parked; a section at a socket screw (the T-nut in the backer). */
const handleFig: FigFn = (c) => {
  const p = c.p;
  const L = computeLayout(p);
  const h = handleGeometry(p, L);
  const tr = box(c, 'transom-rear'), bk = box(c, 'transom-backer-L'), bar = box(c, 'handle-bar');
  if (!tr || !c.by('handle-post-L')) return null;
  const w = p.handleSocketWallIn;
  const sx0 = L.xRear - h.socketX, sx1 = L.xRear;
  const bx1 = bk?.max[0] ?? L.xRear + L.transom + p.blockingThickIn;
  const F = new Fig(760, 580);
  F.heading('The push handle on the transom, seen from the side (bow to the right)');
  // ── A. the whole handle
  F.sub([16, 52], 'A. In use (solid); parked (dashed)');
  const zTopA = (bar?.max[2] ?? h.zPostTop + 1) + 0.6;
  const fa = fit({ minX: sx0 - 2.4, minY: tr.min[2] - 0.6, maxX: bx1 + 2.6, maxY: zTopA }, { x: 120, y: 70, w: 110, h: 470 }, 1, 'center');
  const R = (a: number, b: number, c2: number, d: number, s: Style): void => rectIn(F, fa, a, b, c2, d, s);
  R(tr.min[0], tr.min[2], tr.max[0], tr.max[2], GHOST);
  if (bk) R(bk.min[0], bk.min[2], bk.max[0], bk.max[2], GHOST);
  R(tr.max[0], L.deckBot, bx1 + 2.6, L.deckTop, mat('deck', { opacity: 0.7 }));
  // parked: the bow sinks parkDrop and rests just over the transom top
  const d = h.parkDropIn;
  const postTop = h.zPostTop, bar0 = bar?.min[2] ?? postTop, bar1 = bar?.max[2] ?? postTop + 1;
  R(h.postX[0] - 0.3, bar0 - d, h.postX[1] + 0.3, bar1 - d, { stroke: '#8f8a80', width: 1.2, dash: '4 3' });
  // riding: socket (fitted, then off), post and bow (this step)
  R(sx0, h.zBot, sx1, h.zTop, { fill: ALU.fill, stroke: ACCENT, width: 1.6 });
  R(sx0 + w, h.zBot + w, sx1 - w, h.zTop + 0.01, { fill: '#ffffff', stroke: ALU.stroke, width: 0.8 });
  R(h.postX[0], h.zFoot, h.postX[1], postTop, acc('oak'));
  R(h.postX[0] - 0.3, bar0, h.postX[1] + 0.3, bar1, acc('oak'));
  F.circle(fa.at([h.xBar, h.zPin]), Math.max(3, (p.handlePinDiameterIn / 2) * fa.kx), acc('steel', { width: 1.2 }));
  F.circle(fa.at([h.xBar, h.zPin + d]), 2.5, { fill: '#ffffff', stroke: INK, width: 1 });
  const screwsZ = [h.zBot + 1.2, h.zTop - 1.2];
  for (const z of screwsZ) F.line(fa.at([sx1 - w, z]), fa.at([bx1 - 0.05, z]), { stroke: MAT.steel.stroke, width: 2.4 });
  // dims: the socket's bottom above the transom's bottom edge, the pin above the socket bottom
  const xd1 = fa.at([sx0 - 0.6, 0])[0], xd2 = fa.at([sx0 - 1.8, 0])[0];
  const yOf = (z: number): number => fa.at([0, z])[1];
  F.line([xd1, yOf(tr.min[2])], [xd1, yOf(h.zBot)], { stroke: DIM, width: 1 });
  F.line([xd2, yOf(h.zBot)], [xd2, yOf(h.zPin)], { stroke: DIM, width: 1 });
  for (const [x, z] of [[xd1, tr.min[2]], [xd1, h.zBot], [xd2, h.zBot], [xd2, h.zPin]] as Array<[number, number]>) F.line([x - 5, yOf(z)], [x + 5, yOf(z)], { stroke: DIM, width: 1.2 });
  F.text([xd1 - 6, (yOf(tr.min[2]) + yOf(h.zBot)) / 2 + 4], f8(h.zBot - tr.min[2]), { size: 12, anchor: 'end', color: DIM });
  F.text([xd2 - 6, (yOf(h.zBot) + yOf(h.zPin)) / 2 + 4], f8(h.zPin - h.zBot), { size: 12, anchor: 'end', color: DIM });
  F.text([xd2 - 6, (yOf(h.zBot) + yOf(h.zPin)) / 2 + 20], ['socket bottom', 'to the pin'], { size: 11.5, anchor: 'end', color: DIM });
  // labels A
  const xr = 250;
  F.label(fa.at([h.xBar + 0.3, bar1 - 0.3]), [xr, yOf(bar1)], ['handlebow, pinned and glued to', 'both posts: the handle is one U'], { size: 12 });
  F.label(fa.at([h.xBar, h.zPin + d]), [xr, yOf(h.zPin + d) - 4], [`upper hole, ${f16(h.zPin + d - h.zFoot)} up the post: to park,`, `the U sinks ${f16(d)} with the pin in it`], { size: 12 });
  F.label(fa.at([h.postX[1], (h.zTop + postTop) / 2 + 1]), [xr, yOf((h.zTop + postTop) / 2 + 1) + 14], 'post (oak), a slip fit in the socket', { size: 12 });
  F.label(fa.at([h.postX[1] - 0.3, bar0 - d]), [xr, yOf(bar0 - d) + 18], 'parked bow, just over the transom', { size: 12, color: MUTED });
  F.label(fa.at([h.xBar, h.zPin]), [xr, yOf(h.zPin) + 22], [`${f16(p.handlePinDiameterIn)} clevis pin through both socket`, `walls and the post's lower hole,`, `${f16(h.zPin - h.zFoot)} up the post: to ride`], { size: 12 });
  F.label(fa.at([sx0 + 0.2, (h.zBot + h.zPin) / 2 - 3]), [xr, yOf((h.zBot + h.zPin) / 2) + 20], ['aluminum socket on the outside', 'of the transom (fitted, then off)'], { size: 12 });
  if (bk) F.label(fa.at([(bk.min[0] + bk.max[0]) / 2, bk.min[2] + 2.2]), [xr, yOf(bk.min[2] + 2.2) + 2], 'oak backer inside the transom', { size: 12, color: MUTED });
  F.label(fa.at([(sx1 + bx1) / 2, screwsZ[0]]), [xr, yOf(screwsZ[0]) + 52], ['2 screws a socket into', 'T-nuts in the backer (detail B)'], { size: 12 });

  // ── B. section at the lower socket screw
  F.sub([500, 52], 'B. A socket screw, the post out');
  const z0 = screwsZ[0];
  const fb = fit({ minX: sx0 - 0.15, minY: z0 - 1.1, maxX: bx1 + 0.3, maxY: z0 + 1.1 }, { x: 510, y: 80, w: 230, h: 170 }, 1, 'center');
  const S = (a: number, b: number, c2: number, dd: number, s: Style): void => rectIn(F, fb, a, b, c2, dd, s);
  S(L.xRear, z0 - 1.1, L.xRear + L.transom, z0 + 1.1, mat('oak', { opacity: 0.6 }));
  S(L.xRear + L.transom, z0 - 1.1, bx1, z0 + 1.1, mat('oak', { opacity: 0.6 }));
  S(sx1 - w, z0 - 1.1, sx1, z0 + 1.1, { fill: ALU.fill, stroke: ACCENT, width: 1.4 });
  S(sx0, z0 - 1.1, sx0 + w, z0 + 1.1, { fill: ALU.fill, stroke: ACCENT, width: 1.4 });
  S(sx0, z0 - SOCKET_ACCESS_HOLE_IN / 2, sx0 + w, z0 + SOCKET_ACCESS_HOLE_IN / 2, { fill: '#ffffff', stroke: ALU.stroke, width: 1 });
  // the post is out of the socket while the screws go in (its relief groove clears the heads when it slides back in)
  // T-nut: barrel in the backer, flange flush with its inside face
  S(bx1 - 0.06, z0 - 0.4, bx1, z0 + 0.4, acc('steel', { width: 1 }));
  S(bx1 - 0.45, z0 - 0.17, bx1 - 0.06, z0 + 0.17, acc('steel', { width: 1 }));
  // the screw: button head inside the bore on the near wall, a nylon washer under it, into the T-nut
  const headX = sx1 - w, washT = 0.05, headH = 0.14;
  S(headX - washT, z0 - 0.25, headX, z0 + 0.25, { fill: '#f5f5f0', stroke: MUTED, width: 0.8 });
  S(headX - washT - headH, z0 - SOCKET_SCREW_HEAD_IN / 2, headX - washT, z0 + SOCKET_SCREW_HEAD_IN / 2, acc('steel', { width: 1 }));
  S(headX, z0 - 0.125, bx1 - 0.1, z0 + 0.125, acc('steel', { width: 1 }));
  F.arrow(fb.at([sx0 - 0.14, z0]), fb.at([headX - washT - headH - 0.04, z0]), ACCENT, 1.8);
  // lettered callouts under the detail, keyed in a list below it
  const yB = fb.at([0, z0 - 1.1])[1] + 22;
  const keys: Array<[Vec2, string, string[]]> = [
    [fb.at([sx0 + w / 2, z0 - SOCKET_ACCESS_HOLE_IN / 2 + 0.05]), 'a', [`${f8(SOCKET_ACCESS_HOLE_IN)} access hole in the socket's`, 'rear wall: the screw and the hex', 'key go in through it']],
    [fb.at([headX - washT - headH / 2, z0 - SOCKET_SCREW_HEAD_IN / 2 + 0.03]), 'b', ['button head inside the bore, a', 'nylon washer under it (the post\'s', 'relief groove clears it)']],
    [fb.at([bx1 - 0.03, z0 - 0.38]), 'c', ['T-nut set in the backer, its', 'flange flush with the backer\'s', 'inside face']],
  ];
  keys.forEach(([tgt, k, t], i) => {
    F.line(tgt, [tgt[0], yB - 11], { stroke: MUTED, width: 1 });
    F.circle(tgt, 2.4, { fill: MUTED });
    F.badge([tgt[0], yB], k, INK);
    F.badge([512, yB + 44 + i * 62], k, INK);
    F.text([530, yB + 40 + i * 62], t, { size: 12 });
  });
  F.text([fb.at([L.xRear + L.transom / 2, 0])[0], fb.at([0, z0 + 1.1])[1] - 6], 'transom', { size: 11.5, color: MUTED, anchor: 'middle' });
  F.text([fb.at([(L.xRear + L.transom + bx1) / 2, 0])[0], fb.at([0, z0 + 1.1])[1] - 6], 'backer', { size: 11.5, color: MUTED, anchor: 'middle' });
  legend(F, ['oak', ALU, 'steel', 'deck', 'ghost']);
  F.note('A and B each to scale');
  return {
    id: 'handle-u',
    title: 'The push handle and its sockets',
    caption: `The handle is one removable U: two oak posts with the handlebow pinned and glued across their tops. Each post slides into an aluminum socket on the outside of the transom and is held by a clevis pin through both socket walls and the post; a second hole higher up the post lets the U sink ${f16(d)} to park the bow low over the transom. Each socket is held by two screws from inside its bore into T-nuts set in the oak backer behind the transom, so no wrench has to reach behind the storage box; an access hole in the socket's rear wall passes the screw and the hex key. This step fits and drills the sockets and makes the U; the sockets go on for good at the hang step.`,
    svg: F.svg('The push handle on the transom, riding and parked, with a detail of a socket screw and its T-nut'),
  };
};

export const TOPSIDE_FIGURES: Record<string, FigFn[]> = {
  'side-ribs': [ribStations, ribSection],
  'side-holes': [grabBoardStack],
  'storage-box': [storageBox],
  'storage-lid': [storageLid],
  'seat-blocks': [seatBlocks],
  'seat-back': [seatBackPositions],
  'brake-flaps': [brakeKit],
  handle: [handleFig],
};


