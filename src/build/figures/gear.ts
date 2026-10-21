/**
 * Figures for the running-gear steps, fitted while the hull is upside down (rear-beam, front-beam, brake-knees, gear-fit) and the brake-knee take-off on the upright sled
 * (brake-knee-off). See `kit.ts` for the style. Shapes are the model's own boxes (`worldAABB` of each part), the rear-beam seat (`beamSeat`), the brake layout (`brakeGeometry`) and
 * the rail's profile; bolts, nuts, washers, tools and hands are schematic. Sections through the upside-down hull are drawn the way up the builder sees them: model z runs DOWN the page.
 */
import { worldAABB } from '../../model/bounds';
import { brakeGeometry, type BrakeGeom } from '../../model/brake-layout';
import { kingHeadRelief, kingNutSlot } from '../../model/frame';
import { computeLayout, sideTopAt, type Layout } from '../../model/layout';
import { beamSeat, nutHeight, railSection, washerThick, type BeamSeat, type RailSection } from '../../model/rear-mount';
import type { Part, Vec2 } from '../../model/types';
import { AXLE_STYLE, KNEE_MOUNT, axleGrooveDepthIn, type Params } from '../../params';
import { frac, parseInches as parseFrac } from '../svg-util';
import { ACCENT, Fig, fit, INK, MAT, mat, MUTED, type FigCtx, type FigFn, type MatName, type Style } from './kit';

// ───────────────────────── helpers ─────────────────────────

const f16 = (v: number): string => frac(v, 16);
const f32 = (v: number): string => frac(v, 32);

/** A part's world box (in), or null when the design has no such part. */
interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
function bx(c: FigCtx, id: string): Box3 | null {
  const q = c.by(id);
  if (!q) return null;
  const b = worldAABB(q);
  return { x0: b.min[0], x1: b.max[0], y0: b.min[1], y1: b.max[1], z0: b.min[2], z1: b.max[2] };
}

/** A 2-D view: model (u, v) in inches onto a box of the figure. `down` puts +v down the page (a section through the upside-down hull: model z runs down). */
interface View { at: (u: number, v: number) => Vec2; k: number; rect: (u0: number, u1: number, v0: number, v1: number, s: Style) => void; poly: (pts: Vec2[], s: Style, closed?: boolean) => void }
function view(F: Fig, b: { u0: number; u1: number; v0: number; v1: number }, box: { x: number; y: number; w: number; h: number }, down = false): View {
  const fr = fit({ minX: b.u0, maxX: b.u1, minY: down ? -b.v1 : b.v0, maxY: down ? -b.v0 : b.v1 }, box, 1, 'center');
  const at = (u: number, v: number): Vec2 => fr.at([u, down ? -v : v]);
  return {
    at, k: fr.kx,
    rect: (u0, u1, v0, v1, s) => { F.poly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], s); },
    poly: (pts, s, closed = true) => { F.poly(pts.map(([u, v]) => at(u, v)), s, closed); },
  };
}

const ghost = (extra: Style = {}): Style => mat('ghost', { dash: '4 3', ...extra });
/** This step's part: its own material, outlined in the accent. */
const mine = (m: MatName, extra: Style = {}): Style => mat(m, { stroke: ACCENT, width: 1.8, ...extra });
/** A part this step fits on the far side of what is drawn: an accent dashed outline. */
const hidden: Style = { stroke: ACCENT, width: 1.4, dash: '5 3' };
const UHMW = { fill: '#f7f7f2', stroke: '#7a7a6e', label: 'UHMW plastic' };
/** The axle rods and the kingpin are plain (carbon) steel, not stainless. */
const PLAIN = { fill: '#aab2bb', stroke: '#39424b', label: 'plain steel' };
const plain = (extra: Style = {}): Style => ({ fill: PLAIN.fill, stroke: PLAIN.stroke, width: 1.2, ...extra });
const plainMine = (extra: Style = {}): Style => plain({ stroke: ACCENT, width: 1.8, ...extra });
const uhmw = (extra: Style = {}): Style => ({ fill: UHMW.fill, stroke: UHMW.stroke, width: 1.2, ...extra });

/** A legend that also takes materials the kit does not list (the UHMW pads and disc). */
function legend(F: Fig, items: Array<MatName | { fill: string; stroke: string; label: string }>, at: Vec2 = [16, F.h - 16]): void {
  let x = at[0];
  for (const m of items) {
    const it = typeof m === 'string' ? MAT[m] : m;
    F.rect(x, at[1] - 10, 14, 10, { fill: it.fill, stroke: it.stroke, width: 1.2 });
    F.text([x + 19, at[1]], it.label, { size: 11.5, color: MUTED });
    x += 19 + it.label.length * 6.3 + 18;
  }
}

/** A key line for the accent and the dashed outlines, beside the legend. */
function accentKey(F: Fig, at: Vec2, hiddenToo = true): void {
  F.line([at[0], at[1] - 4], [at[0] + 22, at[1] - 4], { stroke: ACCENT, width: 2 });
  F.text([at[0] + 28, at[1]], 'orange: this step', { size: 11.5, color: MUTED });
  if (hiddenToo) {
    F.line([at[0] + 150, at[1] - 4], [at[0] + 172, at[1] - 4], { stroke: ACCENT, width: 1.4, dash: '5 3' });
    F.text([at[0] + 178, at[1]], 'dashed: out of sight', { size: 11.5, color: MUTED });
  }
}

/**
 * A bolt in a section, scaled to the view: head (and its washer) on the face at `a`, shank to the face at `b` and past it, the washer and nylock nut on `b`. `axis` 'u' runs it along u
 * (at v = `c`), 'v' along v (at u = `c`). Washer outside diameters are drawn as given (0 = none).
 */
function secBolt(V: View, o: { axis: 'u' | 'v'; c: number; a: number; b: number; d: number; headWasher?: number; nutWasher?: number; style?: Style; nut?: boolean }): void {
  const s = Math.sign(o.b - o.a) || 1, d = o.d, wt = washerThick(d), hh = 0.65 * d, nh = nutHeight(d), hw = 1.5 * d;
  const st = o.style ?? mat('steel');
  const R = (a0: number, a1: number, half: number): void => {
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    if (o.axis === 'u') V.rect(lo, hi, o.c - half, o.c + half, st); else V.rect(o.c - half, o.c + half, lo, hi, st);
  };
  const hwT = o.headWasher ? wt : 0, nwT = o.nutWasher ? wt : 0;
  R(o.a - s * hwT, o.b + s * (nwT + (o.nut === false ? 0 : nh) + 0.12), d / 2);
  if (o.headWasher) R(o.a, o.a - s * wt, o.headWasher / 2);
  R(o.a - s * hwT, o.a - s * (hwT + hh), hw / 2);
  if (o.nutWasher) R(o.b, o.b + s * wt, o.nutWasher / 2);
  if (o.nut !== false) R(o.b + s * nwT, o.b + s * (nwT + nh), hw / 2);
}

/**
 * A column of callouts at x (text left of x when `anchor` is 'end'): each label goes level with its target, pushed down just enough not to overlap the one above, so the leaders stay short
 * and never cross. Lines are `size` px apart (1.25 lead).
 */
function column(F: Fig, x: number, anchor: 'start' | 'end', items: Array<{ at: Vec2; text: string | string[] }>, o: { size?: number; gap?: number; top?: number } = {}): void {
  const size = o.size ?? 12.5, lead = size * 1.25, gap = o.gap ?? 6;
  let y = o.top ?? -Infinity;
  for (const it of [...items].sort((a, b) => a.at[1] - b.at[1])) {
    const lines = Array.isArray(it.text) ? it.text : [it.text];
    const ty = Math.max(it.at[1] + size * 0.35 - ((lines.length - 1) * lead) / 2, y + size);
    F.label(it.at, [x, ty], lines, { anchor, size });
    y = ty + (lines.length - 1) * lead + gap;
  }
}

/** A rectangle cut off at its left end (u0): filled, outlined on the other three sides only, so a break line can stand at u0. */
function openLeft(V: View, u0: number, u1: number, v0: number, v1: number, st: Style): void {
  V.rect(u0, u1, v0, v1, { ...st, stroke: undefined });
  V.poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], { stroke: st.stroke, width: st.width, dash: st.dash }, false);
}

/** The lowest edge of a part's (x, z) profile at x (a rail's bottom, with its notches and its step). */
function profileBottomAt(part: Part | undefined, x: number): number | null {
  const g = part?.geometry;
  const prof = g && g.type === 'mesh' ? g.profile : undefined;
  if (!prof) return null;
  let lo = Infinity;
  for (let i = 0; i < prof.length; i++) {
    const [ax, az] = prof[i], [bx_, bz] = prof[(i + 1) % prof.length];
    if ((ax - x) * (bx_ - x) > 0 || ax === bx_) continue;
    lo = Math.min(lo, az + ((bz - az) * (x - ax)) / (bx_ - ax));
  }
  return Number.isFinite(lo) ? lo : null;
}

const axleWord = (p: Params): string => (p.axleWallIn > 0 ? 'tube' : 'rod');
const removableKnees = (p: Params): boolean => p.kneeMount === KNEE_MOUNT.removable;

/** The geometry every gear figure shares, or null when the design is not the underslung beam these figures draw. */
interface Gear { L: Layout; rs: RailSection; seat: BeamSeat; g: BrakeGeom }
function gear(c: FigCtx): Gear | null {
  const L = computeLayout(c.p);
  const seat = beamSeat(c.p, L);
  if (!seat) return null;
  return { L, rs: railSection(c.p, L), seat, g: brakeGeometry(c.p, L) };
}

// ───────────────────────── the rear end from above, hull upside down ─────────────────────────

/**
 * The rear of the upside-down hull seen from above (its underside), bow up the page and the sled's LEFT side on the RIGHT of the page (the hull is turned over). Draws the deck, the
 * transom, the crossmembers, the rails, the hangers, the knee backers, the beam with its axle, plates and angles, the knees and the wheels. `focus` picks what is this step's work.
 */
function rearPlan(c: FigCtx, G: Gear, F: Fig, box: { x: number; y: number; w: number; h: number }, focus: 'beam' | 'knees', xTop: number): View {
  const { L, rs } = G;
  const wheel = bx(c, 'wheel-RL');
  const yMax = Math.max(wheel?.y1 ?? 0, bx(c, 'beam-R')?.y1 ?? 0, L.hwC + L.side) + 0.6;
  const V = view(F, { u0: -yMax, u1: yMax, v0: L.xRear - 0.6, v1: xTop }, box);
  const B = (b: Box3 | null, s: Style): void => { if (b && b.x0 < xTop) V.rect(b.y0, b.y1, Math.max(b.x0, L.xRear - 0.6), Math.min(b.x1, xTop), s); };
  // the deck, cut off at the top with a break line
  const deck = bx(c, 'deck');
  if (deck) {
    V.rect(deck.y0, deck.y1, deck.x0, xTop, { fill: '#f6f2ec', stroke: '#b9b2a6', width: 1 });
    const zz: Vec2[] = [];
    for (let i = 0; i <= 16; i++) zz.push([deck.y0 + ((deck.y1 - deck.y0) * i) / 16, xTop - (i % 2 ? 0.25 : 0)]);
    V.poly(zz, { stroke: '#b9b2a6', width: 1 }, false);
  }
  B(bx(c, 'transom-rear'), ghost());
  for (const q of c.parts.filter((x) => /^joist-\d+$/.test(x.id))) { const b = bx(c, q.id); if (b && b.x0 < xTop) B(b, ghost()); }
  for (const s of [1, -1]) {
    // the rail: straight at the rear (its plan curve starts further forward)
    const yi = s * rs.railYIn, yo = s * (rs.railYIn + rs.railT);
    V.rect(Math.min(yi, yo), Math.max(yi, yo), L.xRear + L.transom, xTop, ghost());
  }
  for (const id of ['axle-hanger-L', 'axle-hanger-R']) B(bx(c, id), ghost());
  const kneeStyle = focus === 'knees' ? mine('oak') : ghost();
  for (const t of ['L', 'R']) {
    B(bx(c, `brake-backer-${t}`), focus === 'knees' ? ghost({ dash: undefined, fill: MAT.oak.fill, stroke: MAT.oak.stroke }) : ghost());
    const pb = bx(c, `brake-backplate-${t}`);
    // drawn at least 3 px thick so the stainless shows at plan scale (it is 1/8" thick, on the backer's inside face)
    if (pb) { const tMin = 3 / V.k, mid = pb.y1 > 0 ? pb.y0 : pb.y1; B({ ...pb, y0: pb.y1 > 0 ? mid : mid - tMin, y1: pb.y1 > 0 ? mid + tMin : mid }, focus === 'knees' ? mat('steel', { width: 1 }) : ghost()); }
  }
  // the beam and what is on its far (grooved) face
  const beamStyle = focus === 'beam' ? mine('oak') : mat('oak', { opacity: 0.55 });
  const beam = bx(c, 'beam-R');
  B(beam, beamStyle);
  const farStyle = focus === 'beam' ? hidden : { stroke: MUTED, width: 1, dash: '4 3' };
  for (const id of ['clamp-RL1', 'clamp-RR1', 'beam-hold-down-L', 'beam-hold-down-R']) B(bx(c, id), farStyle);
  const rods = c.p.axleStyle === AXLE_STYLE.throughRod ? ['axle-R'] : ['axle-RL', 'axle-RR'];
  for (const id of rods) {
    const r = bx(c, id);
    if (!r || !beam) continue;
    B(r, farStyle);
    // the ends stand out past the beam ends, in plain sight
    for (const [a, b] of [[r.y0, beam.y0], [beam.y1, r.y1]] as Array<[number, number]>) if (b > a) V.rect(a, b, r.x0, r.x1, focus === 'beam' ? plainMine() : plain({ opacity: 0.6 }));
  }
  if (focus === 'knees') for (const t of ['L', 'R']) B(bx(c, `brake-knee-${t}`), kneeStyle);
  for (const id of ['wheel-RL', 'wheel-RR']) B(bx(c, id), { stroke: MUTED, width: 1.2, dash: '6 4' });
  return V;
}

/** The nuts the beam's exposed face shows: the plate bolts and the angle's flat-leg bolts (model x, y). */
function rearBeamNuts(c: FigCtx, G: Gear): Vec2[] {
  const out: Vec2[] = [];
  const leg = c.p.axleDiameterIn / 2 + c.p.clampLegGapIn;
  for (const id of ['clamp-RL1', 'clamp-RR1']) { const b = bx(c, id); if (b) for (const k of [-1, 1]) out.push([(b.x0 + b.x1) / 2 + k * leg, (b.y0 + b.y1) / 2]); }
  for (const s of [1, -1]) for (const [x, y] of G.seat.hd.beamBolts) out.push([x, s * y]);
  return out;
}

// ───────────────────────── rear-beam ─────────────────────────

/** 1. Where the rear beam goes: across the upside-down hull, in the notches of the rails and hangers. */
const rearBeamWhere: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-R'), hang = bx(c, 'axle-hanger-L'), deck = bx(c, 'deck');
  if (!G || !beam || !hang || !deck) return null;
  const L = G.L;
  const F = new Fig(760, 330);
  F.heading('Where the rear beam goes (hull upside down, seen from above)');
  const xTop = hang.x1 + 1.5;
  const V = rearPlan(c, G, F, { x: 160, y: 48, w: 450, h: 210 }, 'beam', xTop);
  const nuts = rearBeamNuts(c, G);
  for (const [x, y] of nuts) F.circle(V.at(y, x), Math.max(3, 0.35 * V.k), { fill: MAT.steel.fill, stroke: MAT.steel.stroke, width: 1 });
  const plate = bx(c, 'clamp-RL1'), hdR = bx(c, 'beam-hold-down-R'), wheel = bx(c, 'wheel-RL'), j1 = bx(c, 'joist-1');
  const rod = bx(c, c.p.axleStyle === AXLE_STYLE.throughRod ? 'axle-R' : 'axle-RL');
  const yMax = (wheel?.y1 ?? beam.y1) + 0.6;
  const right = V.at(yMax, 0)[0] + 12, left = V.at(-yMax, 0)[0] - 12;
  // the page's right is the sled's LEFT (the hull is turned over)
  column(F, right, 'start', [
    { at: V.at(nuts[1][1], nuts[1][0]), text: ['bolt heads and nuts', 'on this face'] },
    ...(rod ? [{ at: V.at((beam.y1 + rod.y1) / 2, (rod.x0 + rod.x1) / 2), text: [`axle ${axleWord(c.p)} end`, 'sticks out past', 'the beam'] }] : []),
    ...(plate ? [{ at: V.at(plate.y1 - 0.15, plate.x0 + 0.5), text: ['clamp plate', '(dashed: under', 'the beam)'] }] : []),
    ...(wheel ? [{ at: V.at(wheel.y1, wheel.x0 + 1.5), text: ['wheel (dashed:', 'on at the dry fit)'] }] : []),
  ], { top: 56 });
  column(F, left, 'end', [
    { at: V.at(-G.rs.railYIn - G.rs.railT / 2, xTop - 0.8), text: 'rail' },
    { at: V.at(-(hang.y0 + hang.y1) / 2, hang.x1 - 0.25), text: 'axle hanger' },
    ...(hdR ? [{ at: V.at(hdR.y0 + 0.12, hdR.x0 + 0.5), text: ['hold-down angle', '(dashed: under', 'the beam)'] }] : []),
    ...(j1 ? [{ at: V.at(-L.hwC + 1.5, (j1.x0 + j1.x1) / 2), text: 'crossmember' }] : []),
    { at: V.at(-L.hwC + 3, L.xRear + L.transom / 2), text: 'rear transom' },
  ], { top: 56 });
  const yBot = V.at(0, L.xRear - 0.6)[1];
  F.label(V.at(-5, beam.x1), [V.at(-5, 0)[0] + 10, V.at(0, beam.x1)[1] - 26], 'rear axle beam: across both rails, grooved face down', { anchor: 'start', size: 12.5 });
  F.label(V.at(4, (L.xRear + (j1?.x0 ?? 0)) / 2), [V.at(4, 0)[0] + 20, V.at(0, (L.xRear + (j1?.x0 ?? 0)) / 2)[1] - 2], 'deck (its underside)', { anchor: 'start', size: 12.5 });
  // which side is which
  F.text([V.at(deck.y1, 0)[0], yBot + 20], 'sled\'s LEFT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.text([V.at(deck.y0, 0)[0], yBot + 20], 'sled\'s RIGHT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.arrow([22, 300], [22, 262], MUTED, 2);
  F.text([34, 290], 'bow', { size: 12, color: MUTED });
  legend(F, ['oak', 'steel', PLAIN, 'ghost'], [16, 320]);
  accentKey(F, [470, 302]);
  F.note();
  return {
    id: 'rear-beam-where',
    title: 'Where the rear beam goes',
    caption: `The hull is still upside down, so you are looking at its underside, with the rear transom at the bottom of the picture and the sled's left side on the right. The rear axle beam lies across both rails with its grooved face down, seated in the notches of the rails and of the axle hangers you glued on in [[step:hangers]]. The axle ${axleWord(c.p)} lies in that groove, held by a clamp plate at each end, and its ends stick out past the beam for the wheels; the hold-down angles under it pin the ${axleWord(c.p)} and hold the beam in. Only the bolt heads and nuts show on this side. The beam, its ${axleWord(c.p)} and plates and the angles stay on from now on.`,
    svg: F.svg('Where the rear beam goes: across the rails of the upside-down hull'),
  };
};

/** 2. The rear beam's left end in section: along the axle (the seat, the angle, the plate) and across the beam at the plate. */
const rearBeamSection: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-R'), plate = bx(c, 'clamp-RL1'), hang = bx(c, 'axle-hanger-L'), deck = bx(c, 'deck');
  const rodB = bx(c, c.p.axleStyle === AXLE_STYLE.throughRod ? 'axle-R' : 'axle-RL');
  if (!G || !beam || !plate || !hang || !deck || !rodB) return null;
  const { L, rs, seat } = G;
  const p = c.p, hd = seat.hd, rodR = p.axleDiameterIn / 2, top = beam.z1, proud = p.axleProudIn, gd = axleGrooveDepthIn(p), aw = axleWord(p);
  const F = new Fig(760, 630);
  F.heading('The rear beam\'s left end, cut open (hull upside down, as you see it)');

  // ── A. along the axle, through its center line ──
  F.sub([16, 52], 'A. Cut along the axle, looking forward from behind the transom');
  const yL = hd.yFree - 0.5, yR = rodB.y1 + 0.2, zT = beam.z0 - 0.15, zB = L.deckTop + 0.6;
  const V = view(F, { u0: yL, u1: yR, v0: zT, v1: zB }, { x: 205, y: 60, w: 330, h: 236 }, true);
  V.rect(yL, deck.y1, deck.z0, deck.z1, ghost());
  V.rect(L.hwC, L.hwC + L.side, L.railTop, zB, ghost());
  const railBot = profileBottomAt(c.by('rail-L'), (beam.x0 + beam.x1) / 2) ?? plate.z1 + 0.06;
  V.rect(rs.railYIn, rs.railYIn + rs.railT, railBot, L.railTop, ghost({ dash: undefined }));
  V.rect(hang.y0, hang.y1, top + proud, hang.z1, ghost({ dash: undefined }));
  V.rect(yL, beam.y1, beam.z0, top, mine('oak'));
  V.rect(yL, rodB.y1, top + proud - 2 * rodR, top + proud, plainMine());
  V.rect(yL, beam.y1, beam.z0, top, { stroke: ACCENT, width: 1.8 }); // the beam's outline over the rod: the rod lies in its groove, just proud of the face
  V.rect(plate.y0, plate.y1, plate.z0, plate.z1, mine('steel'));
  V.poly([[hd.yFree, hd.zBeam], [hd.yRail, hd.zBeam], [hd.yRail, hd.zTop], [hd.yRail - hd.t, hd.zTop], [hd.yRail - hd.t, hd.zBeam + hd.t], [hd.yFree, hd.zBeam + hd.t]], mine('steel'));
  // the flat-leg bolts sit fore and aft of the rod, behind the cut: head and washer on the beam's up face, nut on the flat leg (dashed)
  const yb = hd.beamBolts[0][1], wtb = washerThick(hd.boltD);
  V.rect(yb - hd.boltD / 2, yb + hd.boltD / 2, beam.z0 - wtb - 0.65 * hd.boltD, hd.zBeam + hd.t + nutHeight(hd.boltD) + 0.1, { stroke: ACCENT, width: 1.2, dash: '4 3' });
  V.rect(yb - 0.75 * hd.boltD, yb + 0.75 * hd.boltD, beam.z0 - wtb - 0.65 * hd.boltD, beam.z0 - wtb, { stroke: ACCENT, width: 1.2, dash: '4 3' });
  V.rect(yb - 2 * hd.boltD, yb + 2 * hd.boltD, beam.z0 - wtb, beam.z0, { stroke: ACCENT, width: 1.2, dash: '4 3' });
  V.rect(yb - 0.75 * hd.boltD, yb + 0.75 * hd.boltD, hd.zBeam + hd.t, hd.zBeam + hd.t + nutHeight(hd.boltD), { stroke: ACCENT, width: 1.2, dash: '4 3' });
  const zRb = hd.railBolts[0][1];
  secBolt(V, { axis: 'u', c: zRb, a: hd.yRail - hd.t, b: rs.railYIn + rs.railT, d: hd.boltD, nutWasher: 4 * hd.boltD, style: mine('steel', { width: 1.2 }) });
  const lx = V.at(yL, 0)[0] - 12, rx = V.at(yR, 0)[0] + 12;
  column(F, lx, 'end', [
    { at: V.at(yL + 0.6, beam.z0 + 0.5), text: 'rear axle beam' },
    { at: V.at(yb - 0.75 * hd.boltD, beam.z0 - wtb - 0.3 * hd.boltD), text: ['flat-leg bolt (dashed: behind', 'the cut): head on the beam,', 'nut on the flat leg'] },
    { at: V.at(yL + 1.0, top + proud - rodR), text: [`axle ${aw} in its groove`, `(stands ${f32(proud)} proud)`] },
    { at: V.at(hd.yFree + 0.3, hd.zBeam + hd.t / 2), text: ['hold-down angle: flat leg', `on the ${aw}, upright leg`, 'on the hanger'] },
    { at: V.at(yL + 0.5, (deck.z0 + deck.z1) / 2), text: 'deck' },
  ], { top: 80 });
  column(F, rx, 'start', [
    { at: V.at(rodB.y1 - 0.3, top + proud - rodR), text: [`${aw} end: the wheel`, 'goes on here'] },
    { at: V.at(plate.y1 - 0.4, plate.z1), text: 'clamp plate on the axle' },
    { at: V.at(rs.railYIn + rs.railT + washerThick(hd.boltD) + 0.15, zRb), text: ['bolts through the angle,', 'hanger and rail; nut on', 'a fender washer outside'] },
    { at: V.at(L.hwC + L.side * 0.7, zB - 0.25), text: 'hull side' },
  ], { top: 80 });
  F.label(V.at((hang.y0 + hang.y1) / 2, hang.z1 - 0.3), [V.at(hang.y0, 0)[0] - 16, V.at(0, zB)[1] + 22], 'axle hanger (notched)', { anchor: 'end', size: 12.5 });
  F.label(V.at(rs.railYIn + rs.railT / 2, L.railTop - 0.3), [V.at(rs.railYIn, 0)[0] + 24, V.at(0, zB)[1] + 22], 'rail (notched)', { anchor: 'start', size: 12.5 });
  F.arrow([24, 110], [24, 270], MUTED, 1.6);
  F.text([18, 190], 'toward the floor', { size: 11.5, color: MUTED, anchor: 'middle', rotate: -90 });

  // ── B. across the beam at the plate ──
  F.sub([16, 354], 'B. Cut across the beam at the clamp plate (seen from the left end)');
  const xc = (plate.x0 + plate.x1) / 2, leg = rodR + p.clampLegGapIn, bd = p.uboltRodDiameterIn;
  const W = view(F, { u0: beam.x0 - 0.2, u1: beam.x1 + 0.2, v0: beam.z0 - 0.62, v1: plate.z1 + 0.5 }, { x: 150, y: 368, w: 220, h: 200 }, true);
  W.poly([[beam.x0, beam.z0], [beam.x1, beam.z0], [beam.x1, top], [xc + rodR, top], [xc + rodR, top - gd], [xc - rodR, top - gd], [xc - rodR, top], [beam.x0, top]], mine('oak'));
  W.rect(plate.x0, plate.x1, plate.z0, plate.z1, mine('steel'));
  for (const k of [-1, 1]) secBolt(W, { axis: 'v', c: xc + k * leg, a: plate.z1, b: beam.z0, d: bd, nutWasher: 2.2 * bd, style: mine('steel', { width: 1.2 }) });
  F.circle(W.at(xc, top + proud - rodR), rodR * W.k, plainMine());
  F.text([W.at(beam.x0, 0)[0], W.at(0, plate.z1 + 0.5)[1] + 18], 'rear face', { size: 11.5, color: MUTED, anchor: 'middle' });
  F.text([W.at(beam.x1, 0)[0], W.at(0, plate.z1 + 0.5)[1] + 18], 'front face', { size: 11.5, color: MUTED, anchor: 'middle' });
  const bx0 = W.at(beam.x1 + 0.2, 0)[0] + 24;
  column(F, bx0, 'start', [
    { at: W.at(xc + leg + 0.3, beam.z0 - washerThick(bd) - 0.15), text: 'nylock nut and fender washer on this face' },
    { at: W.at(beam.x1 - 0.12, beam.z0 + 0.7), text: 'beam' },
    { at: W.at(xc + rodR * 0.5, top + proud - rodR), text: [`${aw} in a ${f16(p.axleDiameterIn)} wide × ${f32(gd)} deep groove,`, `${f32(proud)} proud of the beam face`] },
    { at: W.at(beam.x1 - 0.1, (plate.z0 + plate.z1) / 2), text: [`clamp plate: it bears on the ${aw}, not the beam`] },
    { at: W.at(xc + leg + 0.15, plate.z1 + 0.25), text: [`2 bolts, ${f16(2 * leg)} apart, either side of the ${aw};`, 'heads under the plate'] },
  ], { top: 380 });
  F.label(W.at(beam.x0 + 0.12, (plate.z0 + plate.z1) / 2), [W.at(beam.x0, 0)[0] - 22, 470], ['each plate drilled', 'loose from its layout', 'to match the beam'], { anchor: 'end', size: 12.5 });
  legend(F, ['oak', 'steel', PLAIN, 'ghost'], [16, 620]);
  accentKey(F, [500, 600], false);
  F.note('Sections, not to scale');
  return {
    id: 'rear-beam-section',
    title: 'The rear beam\'s end, cut open',
    caption: `Drawn the way up you see it, with the hull upside down: the beam is on top and the deck below. The ${aw} and its plates go on at the bench first; then each angle is bolted to its hanger, flat leg pointing in, and the beam is turned over and lowered into the notches so the ${aw} lands on both flat legs. The ${aw} stands ${f32(proud)} proud of the beam face, so the flat legs and the clamp plates bear on it and pin it; a small relief in each hanger notch clears it. The flat-leg bolts go in from the beam's face that is up, nuts on the flat legs. All of it stays on for good.`,
    svg: F.svg('The rear beam end in section: the beam in its notch, the axle in its groove, the hold-down angle and the clamp plate'),
  };
};

// ───────────────────────── front-beam ─────────────────────────

/** 3. The kingpin stack, cut fore and aft through the bolt: the beam under the thrust disc and the king beam, the nut in its slot. */
const kingpinSection: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-F'), disc = bx(c, 'king-thrust'), kb = bx(c, 'king-beam'), pin = bx(c, 'kingpin'), deck = bx(c, 'deck');
  if (!G || !beam || !disc || !kb || !pin || !deck) return null;
  const p = c.p, kd = p.kingpinDiaIn, kx = (pin.x0 + pin.x1) / 2;
  const tongue = bx(c, 'bridle-tongue');
  const F = new Fig(760, 470);
  F.heading('The kingpin, cut fore and aft through the bolt (hull upside down)');
  const u0 = kb.x0 - 0.9, u1 = kb.x1 + 1.4, v0 = pin.z0 - 0.25, v1 = deck.z1 + 0.25;
  const V = view(F, { u0, u1, v0, v1 }, { x: 230, y: 44, w: 300, h: 360 }, true);
  // deck, king beam with its nut slot and bore, the tongue (later)
  V.rect(u0, u1, deck.z0, deck.z1, ghost());
  V.rect(kb.x0, kb.x1, kb.z0, kb.z1, ghost({ dash: undefined }));
  const slot = kingNutSlot(p, G.L), ceil = slot.ceil, floor = slot.floor;
  V.rect(slot.x0, slot.x1, floor, ceil, { fill: '#ffffff', stroke: '#a9a9a9', width: 1 });
  if (tongue) V.rect(tongue.x0, u1, tongue.z0, tongue.z1, { stroke: MUTED, width: 1.2, dash: '6 4' });
  // the disc (this step) with two of its three screws, counterbored from the disc face
  V.rect(disc.x0, disc.x1, disc.z0, disc.z1, uhmw({ stroke: ACCENT, width: 1.8 }));
  const scr = c.by('king-thrust')?.joints?.find((j) => j.type === 'screw')?.at ?? [];
  const rS = scr.length ? Math.hypot(scr[0][0], scr[0][1]) : (disc.x1 - disc.x0) * 0.3; // the screws sit on a circle about the bolt (the disc's own joint)
  const cb = /(\S+)" wide × (\S+)" deep counterbore/.exec(c.by('king-thrust')?.joints?.find((j) => j.type === 'screw')?.size ?? '');
  const cbW = cb ? parseFrac(cb[1]) : 3 * kd / 5, cbD = cb ? parseFrac(cb[2]) : (disc.z1 - disc.z0) / 2;
  // the screws from the disc's own joint: the one in the cut (straight aft) drawn solid, the two beside the slot (behind the cut) dashed
  const pts = scr.length ? scr : [[-rS, 0, 0]];
  let sAft = kx - rS;
  for (const q of pts) {
    const sx = kx + q[0];
    if (Math.abs(q[1]) < 0.2) {
      sAft = sx;
      V.rect(sx - cbW / 2, sx + cbW / 2, disc.z0, disc.z0 + cbD, { fill: '#ffffff', stroke: UHMW.stroke, width: 1 });
      F.screw(V.at(sx, disc.z0 + cbD), V.at(sx, disc.z0 + cbD + 1.0), true, ACCENT);
    } // the two forward screws sit either side of the nut slot, out of this cut: the label says so
  }
  // the beam and the bolt: head and plate washer under the beam, washer and nylock nut in the slot
  V.rect(beam.x0, beam.x1, beam.z0, beam.z1, mine('oak'));
  const head = beam.z0 - pin.z0;
  V.rect(kx - kd / 2, kx + kd / 2, pin.z0, pin.z1, plainMine({ width: 1.2 }));
  V.rect(kx - 1.6 * kd, kx + 1.6 * kd, beam.z0 - head * 0.3, beam.z0, plainMine({ width: 1.2 }));
  V.rect(kx - 0.75 * kd, kx + 0.75 * kd, pin.z0, beam.z0 - head * 0.3, plainMine({ width: 1.2 }));
  const nz0 = floor + (slot.h - slot.nutH) / 3; // the nut where the backed-off bolt leaves it, a little off the slot floor
  V.rect(kx - slot.nutAf / 2, kx + slot.nutAf / 2, nz0, nz0 + slot.nutH, plainMine({ width: 1.2 }));
  V.rect(kx - kd / 2, kx + kd / 2, nz0, pin.z1, { stroke: PLAIN.stroke, width: 1, dash: '3 2' }); // the bolt runs on through the nut, its tip just under the slot ceiling
  // it swings: a turning arrow round the bolt, above the head
  const hc = V.at(kx, pin.z0 - 0.12);
  F.raw(`<path d="M${hc[0] - 34},${hc[1] - 4} A34 9 0 1 0 ${hc[0] + 30},${hc[1] - 9}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`);
  F.arrow([hc[0] + 22, hc[1] - 12], [hc[0] + 32, hc[1] - 8], ACCENT, 2);
  const lx = V.at(u0, 0)[0] - 12, rx = V.at(u1, 0)[0] + 12;
  column(F, lx, 'end', [
    { at: [hc[0] - 34, hc[1] - 4], text: [`the beam swings on the bolt,`, `${p.steerLockDeg}° each way`] },
    { at: V.at(kx - 1.2 * kd, beam.z0 - head * 0.15), text: [`kingpin: ${f16(kd)} bolt, head and SAE flat`, 'washer on the beam\'s bottom face'] },
    { at: V.at(beam.x0 + 0.3, (beam.z0 + beam.z1) / 2), text: ['front axle beam: its', `${f16(kd)} hole fits the bolt`] },
    { at: V.at(disc.x0 + 0.2, (disc.z0 + disc.z1) / 2), text: ['thrust disc (plastic):', 'the beam turns on it'] },
    { at: V.at(kb.x0 + 0.3, (kb.z0 + kb.z1) / 2), text: ['king beam (built', 'with the frame)'] },
    { at: V.at(u0 + 0.3, (deck.z0 + deck.z1) / 2), text: 'deck' },
  ], { top: 60 });
  column(F, rx, 'start', [
    ...(tongue ? [{ at: V.at(u1 - 0.3, tongue.z0 + 0.2), text: ['pulling tongue (dashed:', 'it goes on after the flip)'] }] : []),
    { at: V.at(sAft, disc.z0 + cbD + 0.75), text: ['3 flat-head screws hold the disc,', 'heads down in counterbores: one', 'straight aft (shown); two at 120°', 'from it, either side of the slot'] },
    { at: V.at(kx + slot.nutAf / 2, floor + slot.h / 2), text: ['thin nylock (jam) nut, no washer:', 'the slot\'s walls hold it. Turn the', 'bolt from its head: snug, then', 'back it off a quarter turn'] },
    { at: V.at(kb.x1 - 0.1, floor + 0.05), text: [`the slot, ${f32(slot.w)} wide × ${f16(slot.h)} tall,`, 'is open at the front face'] },
  ], { top: 60 });
  F.text([V.at(u0, 0)[0], V.at(0, v1)[1] + 20], 'rear', { size: 12, color: MUTED });
  F.text([V.at(u1, 0)[0], V.at(0, v1)[1] + 20], 'bow', { size: 12, color: MUTED, anchor: 'end' });
  legend(F, ['oak', PLAIN, UHMW, 'ghost'], [16, 460]);
  F.note('Section, not to scale');
  return {
    id: 'front-kingpin',
    title: 'The kingpin stack',
    caption: `Cut fore and aft through the kingpin bolt, the way up you see it with the hull upside down. The plastic thrust disc is screwed to the king beam (built with the frame) and stays there; the front axle beam lies on it and turns under it. The bolt goes through the beam, the disc and the king beam (down through them as the hull lies now), and its thin nylock (jam) nut sits in the slot cut into the king beam's front face, with no washer: the slot is only a little wider than the nut's flats, so it holds the nut while you turn the bolt from its head. Snug it, then back it off a quarter turn: the bolt only locates the beam, which swings on its shank through the full lock. The disc's three screws keep clear of the slot: one straight aft, two at 120° from it.`,
    svg: F.svg('The kingpin stack in section: beam, thrust disc, king beam, bolt and nut'),
  };
};

/** The front of the upside-down hull from above: the beam, its stub axles, plates and pads, the eye bolts and the check chains to the chain crossmember. */
const frontPlan: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-F'), deck = bx(c, 'deck'), cm = bx(c, 'joist-6'), kb = bx(c, 'king-beam');
  if (!G || !beam || !deck || !cm || !kb) return null;
  const { L, rs } = G;
  const p = c.p;
  const wheel = bx(c, 'wheel-FL');
  const yMax = Math.max(wheel?.y1 ?? 0, bx(c, 'axle-FL')?.y1 ?? 0) + 0.6;
  const x0 = cm.x0 - 1.4, x1 = (bx(c, 'bow-bulkhead')?.x1 ?? deck.x1) + 0.4;
  const F = new Fig(760, 380);
  F.heading('The front beam from above (hull upside down)');
  const V = view(F, { u0: -yMax, u1: yMax, v0: x0, v1: x1 }, { x: 165, y: 46, w: 430, h: 240 });
  const B = (b: Box3 | null, s: Style): void => { if (b && b.x1 > x0 && b.x0 < x1) V.rect(b.y0, b.y1, Math.max(b.x0, x0), Math.min(b.x1, x1), s); };
  // the deck follows the hull's plan: it narrows toward the bow; cut off at the rear with a break line
  const dxs: number[] = [];
  for (let i = 0; i <= 24; i++) dxs.push(x0 + ((Math.min(deck.x1, x1) - x0) * i) / 24);
  const dHalf = (x: number): number => L.hwC - L.turnIn(x) + L.deckEdge;
  V.poly([...dxs.map((x): Vec2 => [dHalf(x), x]), ...[...dxs].reverse().map((x): Vec2 => [-dHalf(x), x])], { fill: '#f6f2ec', stroke: '#b9b2a6', width: 1 });
  const zz: Vec2[] = [];
  for (let i = 0; i <= 16; i++) zz.push([-dHalf(x0) + (2 * dHalf(x0) * i) / 16, x0 + (i % 2 ? 0.25 : 0)]);
  V.poly(zz, { stroke: '#b9b2a6', width: 1 }, false);
  B(bx(c, 'bow-bulkhead'), ghost());
  for (const q of c.parts.filter((x) => /^joist-\d+$/.test(x.id))) B(bx(c, q.id), ghost());
  B(kb, ghost());
  // the rails ease in toward the bow
  const xs: number[] = [];
  for (let i = 0; i <= 24; i++) xs.push(x0 + ((Math.min(L.railEnd, x1) - x0) * i) / 24);
  for (const s of [1, -1]) {
    const inner = xs.map((x): Vec2 => [s * (rs.railYIn - L.turnIn(x)), x]), outer = xs.map((x): Vec2 => [s * (rs.railYIn + rs.railT - L.turnIn(x)), x]);
    V.poly([...inner, ...[...outer].reverse()], ghost());
  }
  // the beam and what is on its far face
  B(beam, mine('oak'));
  for (const id of ['clamp-FL1', 'clamp-FL2', 'clamp-FR1', 'clamp-FR2']) B(bx(c, id), hidden);
  for (const id of ['roll-pad-L', 'roll-pad-R']) B(bx(c, id), { ...hidden, stroke: UHMW.stroke });
  for (const id of ['axle-FL', 'axle-FR']) {
    const r = bx(c, id);
    if (!r) continue;
    B(r, hidden);
    const [a, b] = r.y1 > 0 ? [beam.y1, r.y1] : [r.y0, beam.y0];
    if (b > a) V.rect(a, b, r.x0, r.x1, plainMine());
  }
  // the kingpin head and its plate washer
  const kc = V.at(0, (beam.x0 + beam.x1) / 2);
  F.circle(kc, 0.8 * p.kingpinDiaIn * V.k, mat('steel', { stroke: ACCENT }));
  F.circle(kc, 0.5 * p.kingpinDiaIn * V.k, plain());
  // eye bolts through the beam (eye behind it), the anchors and chains (hung at the last steps)
  const eyes: Vec2[] = [];
  for (const t of ['L', 'R']) {
    const e = bx(c, `steer-eye-${t}`), a = bx(c, `steer-anchor-${t}`);
    if (!e || !a) continue;
    const ye = (e.y0 + e.y1) / 2, ya = (a.y0 + a.y1) / 2;
    const eyeAt: Vec2 = [ye, beam.x0 - 0.45], anchorAt: Vec2 = [ya, cm.x1 + 0.45];
    V.rect(ye - 0.1, ye + 0.1, beam.x0, beam.x1, hidden);
    V.rect(ye - 0.1, ye + 0.1, beam.x0 - 0.2, beam.x0, mine('steel', { width: 1.2 }));
    V.rect(ye - 0.2, ye + 0.2, beam.x1, beam.x1 + 0.35, mine('steel', { width: 1.2 }));
    F.circle(V.at(...eyeAt), 0.3 * V.k, { stroke: ACCENT, width: 2.2 });
    V.rect(ya - 0.1, ya + 0.1, cm.x0 - 0.35, cm.x1 + 0.2, { fill: MAT.steel.fill, stroke: MUTED, width: 1, dash: '3 2' });
    F.circle(V.at(...anchorAt), 0.3 * V.k, { stroke: MUTED, width: 1.6, dash: '3 2' });
    V.poly([[ye, beam.x0 - 0.75], [(ye + ya) / 2 + Math.sign(ye) * 0.35, (beam.x0 + cm.x1) / 2], [ya, cm.x1 + 0.75]], { stroke: MUTED, width: 1.6, dash: '2 3' }, false);
    eyes.push(eyeAt);
  }
  for (const id of ['wheel-FL', 'wheel-FR']) B(bx(c, id), { stroke: MUTED, width: 1.2, dash: '6 4' });
  const right = V.at(yMax, 0)[0] + 12, left = V.at(-yMax, 0)[0] - 12;
  const sFL = bx(c, 'axle-FL'), pFL1 = bx(c, 'clamp-FL1'), pad = bx(c, 'roll-pad-L'), bh = bx(c, 'bow-bulkhead'), aR = bx(c, 'steer-anchor-R');
  column(F, right, 'start', [
    ...(pFL1 ? [{ at: V.at((pFL1.y0 + pFL1.y1) / 2, pFL1.x1), text: ['two clamp plates', 'each end (dashed)'] }] : []),
    ...(sFL ? [{ at: V.at((beam.y1 + sFL.y1) / 2, (sFL.x0 + sFL.x1) / 2), text: ['stub axle (dashed', 'where it lies in its', 'groove under the beam)'] }] : []),
    ...(pad ? [{ at: V.at((pad.y0 + pad.y1) / 2, pad.x0), text: ['roll pad (dashed,', 'plastic) across the', 'groove, on the stub'] }] : []),
    ...(wheel ? [{ at: V.at(wheel.y1, wheel.x0 + 1.5), text: ['wheel (dashed: on', 'at the dry fit)'] }] : []),
  ], { top: 56 });
  column(F, left, 'end', [
    ...(bh ? [{ at: V.at(-4, (bh.x0 + bh.x1) / 2), text: 'bow bulkhead' }] : []),
    { at: V.at(-3, (kb.x1 + beam.x1) / 2), text: 'king beam' },
    { at: V.at(-3, (cm.x0 + cm.x1) / 2), text: ['chain crossmember:', 'drill its anchor holes', 'now, fore and aft'] },
    { at: V.at(-(rs.railYIn + rs.railT / 2 - L.turnIn(x0 + 0.6)), x0 + 0.6), text: 'rail' },
  ], { top: 56 });
  if (eyes.length > 1) {
    const ym = (beam.x0 + cm.x1) / 2;
    F.label(V.at(eyes[1][0] + 0.25, eyes[1][1]), [V.at(-5.5, 0)[0], V.at(0, beam.x0)[1] + 20], ['eye bolt fore and aft through', 'the beam, its eye to the rear'], { anchor: 'start', size: 12 });
    if (aR) F.label(V.at((eyes[1][0] + (aR.y0 + aR.y1) / 2) / 2 - 0.1, ym - 0.6), [V.at(-5.5, 0)[0], V.at(0, ym)[1] + 26], ['check chain and anchor', '(dashed: on at the end)'], { anchor: 'start', size: 12 });
  }
  const yb = V.at(0, x0)[1];
  const j8 = c.parts.filter((x) => /^joist-\d+$/.test(x.id)).map((x) => bx(c, x.id)!).find((b) => b.x0 > beam.x1);
  F.label(kc, [V.at(1.5, 0)[0], V.at(0, (kb.x1 + (j8?.x0 ?? kb.x1 + 3)) / 2)[1] + 4], 'kingpin bolt head', { anchor: 'start', size: 12.5 });
  F.label(V.at(-10, beam.x1), [V.at(-8, 0)[0], V.at(0, (kb.x1 + (j8?.x0 ?? kb.x1 + 3)) / 2)[1] + 4], 'front axle beam', { anchor: 'start', size: 12.5 });
  F.text([V.at(deck.y1, 0)[0], yb + 48], 'sled\'s LEFT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.text([V.at(deck.y0, 0)[0], yb + 48], 'sled\'s RIGHT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.arrow([30, 110], [30, 64], MUTED, 2);
  F.text([30, 126], 'bow', { size: 12, color: MUTED, anchor: 'middle' });
  legend(F, ['oak', 'steel', PLAIN, UHMW, 'ghost'], [16, 370]);
  accentKey(F, [430, 346]);
  F.note();
  return {
    id: 'front-beam-plan',
    title: 'The front beam from above',
    caption: `The bow end of the upside-down hull, looking at its underside, with the sled's left side on the right. The front axle beam hangs on the kingpin under the king beam. A stub axle lies in a groove at each end of its hidden face, held by two clamp plates, with a plastic roll pad across the groove between them, bearing on the stub, that slides under the rail. The eye bolts go fore and aft through the beam, eyes to the rear; the check chains run from them to the anchors on the chain crossmember, whose holes you drill now. The chains and anchors go on in [[step:hang]].`,
    svg: F.svg('The front beam from above: stub axles, clamp plates, roll pads, eye bolts and check chains'),
  };
};

/** The front beam cut along the axle line (left half): the stub in its groove, the two plates, the roll pad under the rail, the eye-bolt hole. */
const frontSection: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-F'), disc = bx(c, 'king-thrust'), kb = bx(c, 'king-beam'), pin = bx(c, 'kingpin'), deck = bx(c, 'deck');
  const stub = bx(c, 'axle-FL'), p1 = bx(c, 'clamp-FL1'), p2 = bx(c, 'clamp-FL2'), pad = bx(c, 'roll-pad-L'), eye = bx(c, 'steer-eye-L'), wheel = bx(c, 'wheel-FL');
  if (!G || !beam || !disc || !kb || !pin || !deck || !stub || !p1 || !p2 || !pad) return null;
  const { L, rs } = G;
  const p = c.p, x = (beam.x0 + beam.x1) / 2, rodR = p.axleDiameterIn / 2, top = beam.z1;
  const F = new Fig(760, 420);
  F.heading('The front beam\'s left end, cut along the axle (hull upside down)');
  const u0 = Math.min(p2.y0, stub.y0) - 1.6, u1 = stub.y1 + 0.4, v0 = beam.z0 - 0.3, v1 = deck.z1 + 0.6;
  const V = view(F, { u0, u1, v0, v1 }, { x: 190, y: 70, w: 390, h: 220 }, true);
  const ti = L.turnIn(x);
  const railY0 = rs.railYIn - ti, railY1 = railY0 + rs.railT, railBot = profileBottomAt(c.by('rail-L'), x) ?? pad.z1 + 0.1;
  const deckEdge = L.hwC - ti + L.deckEdge;
  openLeft(V, u0, deckEdge, deck.z0, deck.z1, ghost());
  V.rect(L.hwC - ti, L.hwC - ti + L.side, L.railTop, v1, ghost());
  V.rect(railY0, railY1, railBot, L.railTop, ghost({ dash: undefined }));
  openLeft(V, u0, kb.y1, kb.z0, kb.z1, ghost({ dash: undefined }));
  const hr = kingHeadRelief(p, L);
  if (hr) V.rect(hr.yIn, Math.min(hr.yOut, kb.y1), kb.z0 - 0.01, kb.z0 + hr.depth, { fill: '#ffffff', stroke: '#a9a9a9', width: 1 });
  // the beam, the stub in its groove, the plates and the pad on the stub
  openLeft(V, u0, beam.y1, beam.z0, top, mine('oak'));
  V.rect(stub.y0, stub.y1, top + p.axleProudIn - 2 * rodR, top + p.axleProudIn, plainMine());
  V.rect(stub.y0, beam.y1, beam.z0, top, { stroke: ACCENT, width: 1.8 });
  const bd = p.uboltRodDiameterIn;
  for (const q of [p1, p2]) {
    V.rect(q.y0, q.y1, q.z0, q.z1, mine('steel'));
    const yc = (q.y0 + q.y1) / 2; // both bolts of a plate lie on this line (fore and aft of the stub)
    V.rect(yc - 0.75 * bd, yc + 0.75 * bd, q.z1, q.z1 + 0.65 * bd, mine('steel', { width: 1.2 }));
  }
  V.rect(pad.y0, pad.y1, pad.z0, pad.z1, uhmw({ stroke: ACCENT, width: 1.8 }));
  // the eye-bolt hole runs front to back: cut across here
  if (eye) F.circle(V.at((eye.y0 + eye.y1) / 2, (eye.z0 + eye.z1) / 2), Math.max(3, ((eye.y1 - eye.y0) / 2) * V.k), { fill: '#ffffff', stroke: ACCENT, width: 1.6 });
  const wg = c.by('wheel-FL')?.geometry;
  if (wheel && wg && wg.type === 'wheel') {
    const wc = (wheel.y0 + wheel.y1) / 2, wr = (wheel.z0 + wheel.z1) / 2, rim = wg.hubDiameter / 2;
    V.rect(wc - wg.hubLength / 2, wc + wg.hubLength / 2, Math.max(v0, wr - rim), Math.min(v1, wr + rim), { stroke: MUTED, width: 1.2, dash: '6 4' });
    if (wr + rim < v1) V.rect(wheel.y0, wheel.y1, wr + rim, v1, { stroke: MUTED, width: 1.2, dash: '6 4' });
    if (wr - rim > v0) V.rect(wheel.y0, wheel.y1, v0, wr - rim, { stroke: MUTED, width: 1.2, dash: '6 4' });
  }
  // a break line at the cut-off end (the kingpin is in the figure before)
  const br: Vec2[] = [];
  for (let i = 0; i <= 10; i++) br.push([u0 + (i % 2 ? 0.12 : 0), v0 + ((v1 - v0) * i) / 10]);
  V.poly(br, { stroke: MUTED, width: 1 }, false);
  const rx = V.at(u1, 0)[0] + 12, lx = V.at(u0, 0)[0] - 12;
  column(F, rx, 'start', [
    { at: V.at(stub.y1 - 0.4, top + p.axleProudIn - rodR), text: ['stub axle in its groove', `(stands ${f32(p.axleProudIn)} proud)`] },
    { at: V.at(p1.y1 - 0.3, p1.z1), text: 'outer clamp plate' },
    ...(wheel ? [{ at: V.at(wheel.y1, v1 - 0.4), text: ['wheel (dashed:', 'at the dry fit)'] }] : []),
  ], { top: 66 });
  column(F, lx, 'end', [
    ...(eye ? [{ at: V.at((eye.y0 + eye.y1) / 2 - 0.15, (eye.z0 + eye.z1) / 2), text: ['eye-bolt hole,', 'fore and aft'] }] : []),
    { at: V.at(u0 + 0.5, beam.z0 + 1.3), text: ['front axle', 'beam'] },
    ...(hr ? [{ at: V.at((hr.yIn + Math.min(hr.yOut, kb.y1)) / 2, kb.z0 + hr.depth / 2), text: ['relief in the king beam,', `${f16(hr.depth)} deep: the heads`, 'swing under it'] }] : []),
    { at: V.at(u0 + 0.5, (kb.z0 + kb.z1) / 2 + 0.3), text: ['king beam and', 'deck (built)'] },
  ], { top: 66, gap: 10 });
  const bl = V.at(0, v1)[1] + 22;
  F.label(V.at(p2.y1 - 0.15, p2.z1 - 0.05), [V.at(p2.y1, 0)[0] + 2, bl + 44], ['inner clamp plate', 'and its bolt heads'], { anchor: 'start', size: 12.5 });
  F.label(V.at((railY0 + railY1) / 2, (railBot + L.railTop) / 2), [V.at(railY1, 0)[0] + 12, bl], 'rail', { anchor: 'start', size: 12.5 });
  F.label(V.at((pad.y0 + pad.y1) / 2 + 0.6, pad.z1), [V.at(pad.y1, 0)[0] + 30, bl + 22], ['roll pad (plastic) on the stub; tape', 'shims between it and the stub only', 'if its gap to the rail is too big'], { anchor: 'start', size: 12.5 });
  legend(F, ['oak', 'steel', PLAIN, UHMW, 'ghost'], [16, 410]);
  F.note('Section, not to scale');
  return {
    id: 'front-beam-section',
    title: 'The front beam end, cut along the axle',
    caption: `The left end of the front beam, cut along the axle line, the way up you see it (the kingpin end is in the figure before). Each stub axle lies in a groove in the beam's hidden face and stands ${f32(p.axleProudIn)} proud, so its two clamp plates bear on it, as at the rear. The plastic roll pad lies across the groove between the plates, bearing on the stub, just clear of the rail: it slides under the rail as the beam swings and catches the beam when one wheel rides up. ${hr ? 'The inner plate sits under the king beam, so the king beam\'s underside is relieved over its bolt heads. ' : ''}The stubs, plates and pads go on at the bench before the beam is hung, and come off after the wheel dry fit, for the finish.`,
    svg: F.svg('The front beam cut along the axle: stub axle, clamp plates, roll pad, kingpin and king beam'),
  };
};

// ───────────────────────── brake-knees ─────────────────────────

/** The knee's (y, z) profile for the left side with the flap pocket cut out (the section through a bolt column passes through the pocket). */
function kneeSectionPoly(g: BrakeGeom): Vec2[] {
  const kn = g.knee, pv = g.pivot;
  const out: Vec2[] = [];
  for (const q of kn.poly) {
    // the outboard edge runs up at kn.yOut: break it at the pocket (open at the outboard face)
    if (q[0] >= kn.yOut - 1e-6 && out.length && out[out.length - 1][0] >= kn.yOut - 1e-6 && out[out.length - 1][1] < pv.zPocketBot && q[1] > pv.zPocketTop) {
      out.push([kn.yOut, pv.zPocketBot], [pv.ySlot[0], pv.zPocketBot], [pv.ySlot[0], pv.zPocketTop], [kn.yOut, pv.zPocketTop]);
    }
    out.push(q);
  }
  return out;
}

/** 5. Where the knees go: on the outside of each rail just ahead of the rear wheel (upright side view), and from above on the upside-down hull. */
const kneesWhere: FigFn = (c) => {
  const G = gear(c);
  const knee = bx(c, 'brake-knee-L'), wheel = bx(c, 'wheel-RL'), flap = bx(c, 'brake-flap-L'), tr = bx(c, 'transom-rear'), j3 = bx(c, 'joist-3');
  if (!G || !knee || !wheel || !tr) return null;
  const { L, g } = G;
  const p = c.p;
  const F = new Fig(760, 690);
  F.heading('Where the brake knees go');
  // ── A. the finished sled, left side ──
  F.sub([16, 50], 'A. What a knee is for: the left side of the finished sled, seen from outside');
  const x0 = tr.x0 - 0.8, x1 = knee.x1 + 7, zTop = sideTopAt(L, tr.x1) + 0.6;
  const V = view(F, { u0: -x1, u1: -x0, v0: -0.4, v1: zTop }, { x: 150, y: 62, w: 440, h: 230 });
  const X = (x: number): number => -x;
  F.line(V.at(X(x1), 0), V.at(X(x0), 0), { stroke: MUTED, width: 1.2 });
  // the side (outer face) from the rail top to the sheer, the transom, the rail, the deck line
  const xs: number[] = [];
  for (let i = 0; i <= 20; i++) xs.push(tr.x1 + ((x1 - tr.x1) * i) / 20);
  V.poly([...xs.map((x): Vec2 => [X(x), sideTopAt(L, x)]), [X(x1), L.railTop], [X(tr.x1), L.railTop]], ghost());
  V.rect(X(tr.x1), X(tr.x0), tr.z0, tr.z1, ghost());
  V.rect(X(x1), X(tr.x1), g.rail.zb, g.rail.zt, ghost({ dash: undefined }));
  // the wheel, the knee (this step), the flap (later)
  F.circle(V.at(X((wheel.x0 + wheel.x1) / 2), (wheel.z0 + wheel.z1) / 2), ((wheel.x1 - wheel.x0) / 2) * V.k, mat('rubber', { opacity: 0.35 }));
  V.rect(X(knee.x1), X(knee.x0), knee.z0, knee.z1, mine('oak'));
  if (flap) {
    const t = p.brakeFlapThickIn, drop = (flap.x1 - flap.x0) * Math.tan((p.brakeFlapSlopeDeg * Math.PI) / 180);
    V.poly([[X(flap.x1), flap.z1], [X(flap.x0), flap.z1 - drop], [X(flap.x0), flap.z1 - drop - t], [X(flap.x1), flap.z1 - t]], ghost());
  }
  column(F, V.at(X(x0), 0)[0] + 14, 'start', [
    { at: V.at(X(tr.x1 + 0.1), (tr.z0 + tr.z1) / 2 + 3), text: 'rear transom' },
    ...(flap ? [{ at: V.at(X(flap.x0 + 3), flap.z1 - p.brakeFlapThickIn / 2 - (flap.x1 - flap.x0 - 3) * Math.tan((p.brakeFlapSlopeDeg * Math.PI) / 180)), text: ['brake flap (made later):', 'it pivots in the knee', 'and presses on the tire'] }] : []),
    { at: V.at(X(wheel.x0 + 1), 3), text: 'rear wheel' },
  ], { top: 70 });
  column(F, V.at(X(x1), 0)[0] - 14, 'end', [
    { at: V.at(X(knee.x1 - 0.3), knee.z1 - 1.5), text: ['brake knee (this step):', 'bolted to the outside', 'of the rail, just ahead', 'of the rear wheel'] },
    { at: V.at(X(x1 - 1.5), (sideTopAt(L, x1) + L.railTop) / 2), text: 'hull side' },
    { at: V.at(X(x1 - 1.5), (g.rail.zb + g.rail.zt) / 2), text: 'rail' },
  ], { top: 70 });
  F.text([V.at(X(x1), 0)[0], V.at(0, 0)[1] + 18], 'bow this way', { size: 12, color: MUTED });
  F.text([V.at(X(x0), 0)[0], V.at(0, 0)[1] + 18], 'rear', { size: 12, color: MUTED, anchor: 'end' });

  // ── B. from above, the hull upside down ──
  F.sub([16, 352], 'B. Where you fit them now: the rear end, hull upside down, seen from above');
  const xTop = (j3?.x1 ?? knee.x1 + 4) + 0.8;
  const W = rearPlan(c, G, F, { x: 160, y: 364, w: 440, h: 260 }, 'knees', xTop);
  const kL = bx(c, 'brake-knee-L')!, bk = bx(c, 'brake-backer-L'), pl = bx(c, 'brake-backplate-L'), j2 = bx(c, 'joist-2'), beam = bx(c, 'beam-R');
  const yMax = (wheel.y1) + 0.6;
  column(F, W.at(yMax, 0)[0] + 12, 'start', [
    { at: W.at((kL.y0 + kL.y1) / 2, kL.x1), text: ['brake knee: outside', 'the rail, ahead of', 'the rear wheel'] },
    { at: W.at(wheel.y1, wheel.x0 + 1), text: ['wheel (dashed:', 'next step)'] },
  ], { top: 380 });
  column(F, W.at(-yMax, 0)[0] - 12, 'end', [
    ...(j2 ? [{ at: W.at(-(G.rs.railYIn - 0.6), (j2.x0 + j2.x1) / 2), text: 'crossmember' }] : []),
    ...(beam ? [{ at: W.at(-5, beam.x0), text: 'rear beam (fitted)' }] : []),
  ], { top: 380 });
  const backed = (at: Vec2, t: string): void => { F.rect(at[0] - 3, at[1] - 13, t.length * 6.7 + 6, 17, { fill: '#ffffff', opacity: 0.9 }); };
  if (bk) backed([W.at(-7, 0)[0], W.at(0, bk.x1 + 3.4)[1]], 'oak backer inside the rail');
  if (pl) backed([W.at(-7, 0)[0], W.at(0, (bk?.x1 ?? 0) + 1.7)[1]], 'stainless backing plate: the nuts go on it');
  if (bk) F.label(W.at(-bk.y0 - 0.1, bk.x1 - 0.2), [W.at(-7, 0)[0], W.at(0, bk.x1 + 3.4)[1]], 'oak backer inside the rail', { anchor: 'start', size: 12.5 });
  if (pl && bk) F.label(W.at(-pl.y0, (pl.x0 + pl.x1) / 2), [W.at(-7, 0)[0], W.at(0, bk.x1 + 1.7)[1]], 'stainless backing plate: the nuts go on it', { anchor: 'start', size: 12.5 });
  const yb = W.at(0, L.xRear - 0.6)[1];
  F.text([W.at(L.hwC + L.side, 0)[0], yb + 18], 'sled\'s LEFT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.text([W.at(-(L.hwC + L.side), 0)[0], yb + 18], 'sled\'s RIGHT side', { size: 12.5, weight: 'bold', color: MUTED, anchor: 'middle' });
  F.arrow([30, 470], [30, 420], MUTED, 2);
  F.text([30, 488], 'bow', { size: 12, color: MUTED, anchor: 'middle' });
  legend(F, ['oak', 'steel', PLAIN, 'ghost'], [16, 680]);
  F.note('Side view and plan, each to its own scale');
  return {
    id: 'brake-knees-where',
    title: 'Where the brake knees go',
    caption: `Each brake knee is an oak bracket bolted to the outside of a rail just ahead of the rear wheel; the brake flap (made later) pivots in the pocket at its top and presses down on the tire. Fit the knees now, while the hull is upside down: the four bolts go through the knee, the rail and the oak backer inside the rail, and their nuts sit on the steel backing plate on that backer, under the deck, where you can reach them from above today.${removableKnees(p) ? ' The knees go on dry and come off again after the wheel dry fit.' : ''}`,
    svg: F.svg('Where the brake knees go: beside the rear wheels, outside the rails'),
  };
};

/** 6. A knee bolted on: section through a bolt column (hull upside down). */
const kneeSection: FigFn = (c) => {
  const G = gear(c);
  const deck = bx(c, 'deck'), bk = bx(c, 'brake-backer-L'), pl = bx(c, 'brake-backplate-L');
  if (!G || !deck || !bk || !pl) return null;
  const { L, g } = G;
  const p = c.p, kn = g.knee, bd = g.bolts.dia, rm = removableKnees(p);
  const F = new Fig(760, 560);
  F.heading(`The knee bolted on${rm ? ', dry' : ''}: cut across through one column of bolts (hull upside down)`);
  const u0 = bk.y0 - 0.9, u1 = kn.yOut + 0.5, v0 = kn.zBot - 0.5, v1 = kn.zTop + 0.35;
  const V = view(F, { u0, u1, v0, v1 }, { x: 240, y: 52, w: 280, h: 440 }, true);
  // deck, side sandwich, rail, backer and plate (all built)
  V.rect(u0, deck.y1, deck.z0, deck.z1, ghost());
  const web0 = L.hwC + L.sideBand, web1 = L.hwC + L.side - L.sideBand;
  V.rect(web0, web1, L.railTop, v1, ghost({ dash: undefined }));
  const chIn = bx(c, 'side-L-chine-in'), chOut = bx(c, 'side-L-chine');
  if (chIn) V.rect(L.hwC, web0, chIn.z0, chIn.z1, ghost({ dash: undefined }));
  if (chOut) V.rect(web1, L.hwC + L.side, chOut.z0, chOut.z1, ghost({ dash: undefined }));
  V.rect(g.backer.y1, g.backer.y1 + g.rail.t, g.rail.zb, g.rail.zt, ghost({ dash: undefined }));
  V.rect(bk.y0, bk.y1, bk.z0, bk.z1, ghost({ dash: undefined }));
  V.rect(pl.y0, pl.y1, pl.z0, pl.z1, mat('steel'));
  // the knee (this step) and its bolts
  V.poly(kneeSectionPoly(g), mine('oak'));
  const yHead = Y_face(g) + kn.legT;
  for (const z of g.bolts.zs) secBolt(V, { axis: 'u', c: z, a: yHead, b: pl.y0, d: bd, headWasher: p.brakeMountWasherOdIn, style: mine('steel', { width: 1.2 }) });
  // the reach: from above, into the open bay
  const nutY = pl.y0 - washerThick(bd) - nutHeight(bd);
  F.arrow(V.at(nutY - 0.55, v0 - 0.2), V.at(nutY - 0.25, g.bolts.zs[0] - 0.35), ACCENT, 2.2);
  const lx = V.at(u0, 0)[0] - 12, rx = V.at(u1, 0)[0] + 12;
  column(F, lx, 'end', [
    { at: V.at(nutY - 0.4, v0 - 0.1), text: ['reach down into the', 'bay between the cross-', 'members: the nuts face in'] },
    { at: V.at(pl.y0 - nutHeight(bd) / 2, g.bolts.zs[0] - 0.1), text: 'nylock nut' },
    { at: V.at((pl.y0 + pl.y1) / 2, (g.bolts.zs[0] + g.bolts.zs[1]) / 2), text: ['steel backing plate,', 'let into the backer'] },
    { at: V.at(bk.y0 + 0.35, bk.z1 - 0.3), text: ['oak backer, glued to', 'the rail at the frame step'] },
    { at: V.at(u0 + 0.3, (deck.z0 + deck.z1) / 2), text: 'deck' },
    { at: V.at((web0 + web1) / 2, v1 - 1.5), text: ['hull side (its bottom', 'band rests on the rail)'] },
    ...(chOut ? [{ at: V.at((web1 + L.hwC + L.side) / 2, (chOut.z0 + chOut.z1) / 2), text: ['outer bottom band: the knee', 'bears on it and the rail only'] }] : []),
  ], { top: 66 });
  column(F, rx, 'start', [
    { at: V.at(yHead + 0.2, g.bolts.zs[0]), text: [`${g.bolts.count} bolts, ${f16(bd)}, with a washer`, 'under each head on the', 'knee\'s outer face'] },
    { at: V.at(Y_face(g) + kn.legT * 0.6, kn.zLeg - 0.8), text: [`brake knee (this step)${rm ? ': no glue' : ''}`] },
    { at: V.at(g.pivot.ySlot[0] + 0.3, (g.pivot.zPocketBot + g.pivot.zPocketTop) / 2), text: ['pocket for the flap', '(fitted later)'] },
  ], { top: 66 });
  F.label(V.at(g.backer.y1 + g.rail.t / 2, g.rail.zb + 0.4), [V.at(g.backer.y1, 0)[0] - 4, V.at(0, v0)[1] - 4], 'rail', { anchor: 'end', size: 12.5 });
  // the knee's end is flush with the rail's edge
  F.line(V.at(g.backer.y1 - 0.2, kn.zBot), V.at(u1, kn.zBot), { stroke: ACCENT, width: 1, dash: '3 3' });
  F.label(V.at(u1 - 0.15, kn.zBot), [V.at(u1, 0)[0] + 12, V.at(0, kn.zBot)[1] - 14], 'knee end flush with the rail edge', { anchor: 'start', size: 12.5 });
  F.text([V.at(u0, 0)[0], V.at(0, v1)[1] + 22], 'inside the hull', { size: 12, color: MUTED });
  F.text([V.at(u1, 0)[0], V.at(0, v1)[1] + 22], 'outside', { size: 12, color: MUTED, anchor: 'end' });
  legend(F, ['oak', 'steel', 'ghost'], [16, 550]);
  F.note('Section, not to scale');
  return {
    id: 'brake-knee-section',
    title: `The knee bolted on${rm ? ', dry' : ''}`,
    caption: `Drawn the way up you see it with the hull upside down, cut across the left rail through one column of knee bolts. Each bolt goes through the knee's leg, the rail and the oak backer, and its nylock nut tightens on the stainless backing plate let into the backer's inside face. That face is in the bay between two crossmembers, which is open and faces up while the hull is upside down, so the nuts are easy to hold with a wrench now.${rm ? ' No glue anywhere: the knee is held only by its four bolts, so it can come off again.' : ''}`,
    svg: F.svg('A brake knee bolted on: section through the knee, rail, backer and backing plate'),
  };
};

/** The hull's outer face (the rail's outer face), |y|. */
const Y_face = (g: BrakeGeom): number => g.knee.poly[0][0];

// ───────────────────────── gear-fit ─────────────────────────

const HUB = { fill: '#8f98a3', stroke: '#3f4750', label: 'wheel hub' };

/** 7. A wheel on its axle end (section along the axle, hull upside down), and what comes off after the dry fit. */
const wheelOnAxle: FigFn = (c) => {
  const G = gear(c);
  const beam = bx(c, 'beam-R'), plate = bx(c, 'clamp-RL1'), wheel = bx(c, 'wheel-RL');
  const rod = bx(c, c.p.axleStyle === AXLE_STYLE.throughRod ? 'axle-R' : 'axle-RL');
  const wp = c.by('wheel-RL')?.geometry;
  if (!G || !beam || !plate || !wheel || !rod || !wp || wp.type !== 'wheel') return null;
  const p = c.p, L = G.L, rodR = p.axleDiameterIn / 2, top = beam.z1, aw = axleWord(p), r = L.r, rm = removableKnees(p);
  const F = new Fig(760, 470);
  F.heading('A wheel on its axle end (hull upside down), and what comes off after');
  F.sub([16, 50], `A. Cut along the ${aw} at the left rear wheel (the same at all four)`);
  const yc = (wheel.y0 + wheel.y1) / 2, hub0 = yc - wp.hubLength / 2, hub1 = yc + wp.hubLength / 2, rimR = wp.hubDiameter / 2;
  const pinY = rod.y1 - p.axleCrossHoleFromEndIn, pinR = p.axleCrossHoleDiaIn / 2, wt = washerThick(p.axleDiameterIn);
  const u0 = beam.y1 - 1.6, u1 = rod.y1 + 0.55, v0 = r - rimR - 0.7, v1 = r + rimR + 0.7;
  const V = view(F, { u0, u1, v0, v1 }, { x: 150, y: 64, w: 250, h: 330 }, true);
  // the beam end, the plate and the rod (fitted in the beam step)
  V.rect(u0, beam.y1, beam.z0, top, mat('oak'));
  V.rect(Math.max(u0, plate.y0), plate.y1, plate.z0, plate.z1, mat('steel'));
  V.rect(u0, rod.y1, r - rodR, r + rodR, plain());
  // the wheel (this step): the tire beyond the rim, the rim and the hub on the rod
  for (const [a, b] of [[v0, r - rimR], [r + rimR, v1]] as Array<[number, number]>) V.rect(wheel.y0, wheel.y1, a, b, mine('rubber'));
  V.rect(hub0, hub1, r - rimR, r + rimR, plain());
  V.rect(hub0, hub1, r - rodR - 0.4, r + rodR + 0.4, { fill: HUB.fill, stroke: ACCENT, width: 1.6 });
  V.rect(u0, rod.y1, r - rodR, r + rodR, plain());
  // washer, collar, cotter pin
  V.rect(hub1, hub1 + wt, r - 2 * rodR, r + 2 * rodR, mine('steel', { width: 1.2 }));
  const col0 = hub1 + wt, col1 = pinY - pinR - 0.04;
  V.rect(col0, col1, r - 1.8 * rodR, r + 1.8 * rodR, mine('steel', { width: 1.2 }));
  V.rect(pinY - pinR, pinY + pinR, r - rodR - 0.35, r + rodR + 0.12, mine('steel', { width: 1.2 }));
  F.circle(V.at(pinY, r - rodR - 0.45), Math.max(4, 0.12 * V.k), { stroke: ACCENT, width: 2 });
  V.poly([[pinY - pinR, r + rodR + 0.12], [pinY - pinR - 0.12, r + rodR + 0.3]], { stroke: ACCENT, width: 2.4 }, false);
  V.poly([[pinY + pinR, r + rodR + 0.12], [pinY + pinR + 0.18, r + rodR + 0.3]], { stroke: ACCENT, width: 2.4 }, false);
  F.dim(V.at(pinY, r - rodR - 1.05), V.at(rod.y1, r - rodR - 1.05), f16(p.axleCrossHoleFromEndIn), 0, { size: 12 });
  F.line(V.at(rod.y1, r - rodR), V.at(rod.y1, r - rodR - 1.15), { stroke: '#2b6cb0', width: 0.8, dash: '2 2' });
  F.line(V.at(pinY, r - rodR - 0.6), V.at(pinY, r - rodR - 1.15), { stroke: '#2b6cb0', width: 0.8, dash: '2 2' });
  column(F, V.at(u0, 0)[0] - 12, 'end', [
    { at: V.at(u0 + 0.4, beam.z0 + 0.6), text: ['rear beam', '(fitted)'] },
    { at: V.at(u0 + 0.3, r), text: `axle ${aw}` },
    { at: V.at(u0 + 0.4, (plate.z0 + plate.z1) / 2), text: 'clamp plate' },
    { at: V.at(hub0 + 0.3, r + rodR + 0.3), text: ['hub, sealed', `bearings, ${f16(p.wheelBoreIn)} bore`] },
    { at: V.at(hub0 + 0.3, r + rimR - 0.4), text: 'rim' },
    { at: V.at(wheel.y0 + 0.2, v1 - 0.3), text: 'tire' },
  ], { top: 70 });
  column(F, V.at(u1, 0)[0] + 12, 'start', [
    { at: V.at(pinY, r - rodR - 0.45), text: ['cotter pin in', 'the cross hole'] },
    { at: V.at((col0 + col1) / 2, r - 1.5 * rodR), text: 'collar' },
    { at: V.at(hub1 + wt / 2, r - 1.8 * rodR), text: ['washer against', 'the hub'] },
  ], { top: 150 });

  // ── B. what comes off afterwards ──
  const bx0 = 515;
  F.sub([bx0 - 10, 50], 'B. Then take it all off again');
  const list = (y: number, title: string, items: Array<[MatName | { fill: string; stroke: string; label: string }, string]>, color: string): number => {
    F.text([bx0, y], title, { size: 13, weight: 'bold', color });
    let yy = y + 22;
    for (const [m, t] of items) {
      const it = typeof m === 'string' ? MAT[m] : m;
      F.rect(bx0, yy - 10, 14, 10, { fill: it.fill, stroke: it.stroke, width: 1.2 });
      F.text([bx0 + 22, yy], t, { size: 12.5 });
      yy += 19;
    }
    return yy;
  };
  const has = (re: RegExp): boolean => c.parts.some((x) => re.test(x.id));
  const off: Array<[MatName | { fill: string; stroke: string; label: string }, string]> = [
    ['rubber', 'the 4 wheels, washers, collars, pins'],
    [PLAIN, 'the front stub axles'],
    ['steel', 'the 4 front clamp plates and bolts'],
    ...(has(/^roll-pad/) ? [[UHMW, 'the roll pads'] as [typeof UHMW, string]] : []),
    ...(has(/^steer-eye/) ? [[PLAIN, 'the eye bolts'] as [typeof PLAIN, string]] : []),
    ...(rm ? [['oak', 'the brake knees, with their bolts'] as [MatName, string]] : []),
  ];
  const stay: Array<[MatName | { fill: string; stroke: string; label: string }, string]> = [
    ['oak', 'the rear and front axle beams'],
    [PLAIN, `the rear ${aw} and its 2 clamp plates`],
    ['steel', 'the hold-down angles'],
    [PLAIN, 'the kingpin bolt and thrust disc'],
    ...(has(/^brake-backer/) ? [['oak', 'the knee backers'] as [MatName, string], ['steel', 'the backing plates'] as [MatName, string]] : []),
  ];
  const y2 = list(84, 'Off, tagged L or R, bagged:', off, ACCENT);
  list(y2 + 16, 'Stays on for the finish:', stay, MUTED);
  F.text([bx0, 390], ['The underside is finished next', 'with these parts off; they go', 'back on at the end.'], { size: 12, color: MUTED, italic: true });
  legend(F, ['oak', 'steel', PLAIN, 'rubber', HUB], [16, 460]);
  F.note('Section, not to scale');
  return {
    id: 'gear-fit-wheel',
    title: 'A wheel on its axle end',
    caption: `Each wheel slides onto its axle end, just clear of the beam end; then a washer and a collar go on against the hub, and a cotter pin through the cross hole ${f16(p.axleCrossHoleFromEndIn)} from the end keeps them there. This dry fit proves the track, the spin and the clearances while the hull is still upside down. Then the wheels and the front gear come off and are bagged by side, because the underside is finished next, in [[step:finish-under]]; the beams, the rear ${aw} and its plates, the hold-down angles, the kingpin${has(/^brake-backer/) ? ', the knee backers and their plates' : ''} stay on (mask the metal).`,
    svg: F.svg('A wheel on its axle end: washer, collar and cotter pin, and the list of what comes off after the dry fit'),
  };
};

// ───────────────────────── brake-knee-off ─────────────────────────

/** 8. Taking a knee off the upright sled: where to reach (side view) and the two tools on a bolt (section). */
const kneeOffReach: FigFn = (c) => {
  const G = gear(c);
  if (!G || !removableKnees(c.p)) return null;
  const knee = bx(c, 'brake-knee-L'), wheel = bx(c, 'wheel-RL'), bk = bx(c, 'brake-backer-L'), pl = bx(c, 'brake-backplate-L'), deck = bx(c, 'deck');
  const j2 = bx(c, 'joist-2'), j3 = bx(c, 'joist-3'), flap = bx(c, 'brake-flap-L');
  if (!knee || !wheel || !bk || !pl || !deck || !j2 || !j3) return null;
  const { L, g } = G;
  const p = c.p, kn = g.knee, bd = g.bolts.dia;
  const F = new Fig(760, 800);
  F.heading('Taking a knee off: where to reach (sled upright)');

  // ── A. side view from outside the left side: bow to the LEFT ──
  F.sub([16, 50], 'A. The left side from outside, as you lie beside the sled');
  const x0 = wheel.x0 - 1.2, x1 = j3.x1 + 2.5, zTop = kn.zTop + 1.2;
  const V = view(F, { u0: -x1, u1: -x0, v0: -0.4, v1: zTop }, { x: 170, y: 62, w: 400, h: 250 });
  const X = (x: number): number => -x;
  F.line(V.at(X(x1), 0), V.at(X(x0), 0), { stroke: MUTED, width: 1.2 });
  F.text([V.at(X(x1), 0)[0], V.at(0, 0)[1] + 16], 'floor', { size: 11.5, color: MUTED });
  // the side panel above the rail, the rail; the crossmembers, backer and plate behind the rail (dashed)
  V.rect(X(x1), X(x0), L.railTop, zTop, ghost());
  V.rect(X(x1), X(x0), g.rail.zb, g.rail.zt, ghost({ dash: undefined }));
  for (const j of [j2, j3]) V.rect(X(j.x1), X(j.x0), j.z0, j.z1, { stroke: ACCENT, width: 1.4, dash: '5 3' });
  V.rect(X(bk.x1), X(bk.x0), bk.z0, bk.z1, { stroke: MUTED, width: 1.2, dash: '4 3' });
  V.rect(X(pl.x1), X(pl.x0), pl.z0, pl.z1, { stroke: MUTED, width: 1.2, dash: '2 2' });
  // the wheel, the knee with its flap (they come off together)
  F.circle(V.at(X((wheel.x0 + wheel.x1) / 2), (wheel.z0 + wheel.z1) / 2), ((wheel.x1 - wheel.x0) / 2) * V.k, mat('rubber', { opacity: 0.35 }));
  if (flap) {
    const t = p.brakeFlapThickIn, drop = (flap.x1 - flap.x0) * Math.tan((p.brakeFlapSlopeDeg * Math.PI) / 180), xr = Math.max(flap.x0, x0);
    const dr = (flap.x1 - xr) * Math.tan((p.brakeFlapSlopeDeg * Math.PI) / 180);
    V.poly([[X(flap.x1), flap.z1], [X(xr), flap.z1 - dr], [X(xr), flap.z1 - dr - t], [X(flap.x1), flap.z1 - t]], mat('oak', { stroke: ACCENT, width: 1.4 }));
    void drop;
  }
  V.rect(X(knee.x1), X(knee.x0), knee.z0, knee.z1, mine('oak'));
  V.rect(X(pl.x1), X(pl.x0), pl.z0, pl.z1, { stroke: INK, width: 1.2, dash: '3 3' });
  for (const x of g.bolts.xs) for (const z of g.bolts.zs) F.circle(V.at(X(x), z), Math.max(3, 0.25 * V.k), mat('steel'));
  // the reach: in under the rail, up behind it into the bay
  const bay = (j2.x1 + j3.x0) / 2;
  F.path(`M${V.at(X(bay + 1.5), -0.1).join(',')} Q${V.at(X(bay + 0.8), g.rail.zb - 1.2).join(',')} ${V.at(X(pl.x1 + 0.6), (pl.z0 + pl.z1) / 2).join(',')}`, { stroke: ACCENT, width: 2.4, dash: '7 4' });
  F.arrow(V.at(X(pl.x1 + 1.0), (pl.z0 + pl.z1) / 2 - 0.6), V.at(X(pl.x1 + 0.55), (pl.z0 + pl.z1) / 2), ACCENT, 2.4);
  column(F, V.at(X(x1), 0)[0] - 12, 'end', [
    { at: V.at(X(j3.x0 + 0.2), j3.z1 - 0.3), text: ['crossmember', '(behind the rail)'] },
    { at: V.at(X(x1 - 1), (g.rail.zb + g.rail.zt) / 2), text: 'rail' },
    { at: V.at(X(bay + 1.1), 1.4), text: ['reach in under the rail', 'here, then up behind it'] },
  ], { top: 70 });
  column(F, V.at(X(x0), 0)[0] + 12, 'start', [
    { at: V.at(X(knee.x0 + 0.1), knee.z1 - 0.6), text: ['knee and flap come', 'off as one piece'] },
    { at: V.at(X(pl.x0) - 0.02, (pl.z0 + pl.z1) / 2), text: ['nuts on the backing', 'plate, behind the rail', 'under the deck (dashed)'] },
    { at: V.at(X(g.bolts.xs[0]), g.bolts.zs[0]), text: ['4 bolt heads on the', 'knee\'s outer face'] },
    { at: V.at(X(j2.x0 + 0.1), j2.z0 + 0.2), text: ['crossmember just ahead', 'of the wheel (dashed)'] },
    { at: V.at(X(wheel.x0 + 1.5), 2), text: 'rear wheel' },
  ], { top: 70 });
  F.text([V.at(X(x0), 0)[0], V.at(0, 0)[1] + 16], 'rear', { size: 11.5, color: MUTED, anchor: 'end' });
  F.arrow([V.at(X(x1), 0)[0] - 20, 76], [V.at(X(x1), 0)[0] - 64, 76], MUTED, 2);
  F.text([V.at(X(x1), 0)[0] - 42, 96], 'bow', { size: 12, color: MUTED, anchor: 'middle' });

  // ── B. section across at a bolt: the socket outside, the wrench inside ──
  F.sub([16, 380], 'B. Cut across the left rail at the bolts, looking back at the rear wheel');
  const u0 = bk.y0 - 3.4, u1 = kn.yOut + 3.4, v0 = -0.4, v1 = kn.zTop + 0.6;
  const W = view(F, { u0, u1, v0, v1 }, { x: 170, y: 394, w: 400, h: 340 });
  F.line(W.at(u0, 0), W.at(u1, 0), { stroke: MUTED, width: 1.2 });
  if (wheel) W.rect(wheel.y0, wheel.y1, wheel.z0, wheel.z1, { stroke: MUTED, width: 1.1, dash: '6 4' });
  W.rect(u0, deck.y1, deck.z0, deck.z1, ghost());
  const web0 = L.hwC + L.sideBand, web1 = L.hwC + L.side - L.sideBand;
  W.rect(web0, web1, L.railTop, v1, ghost({ dash: undefined }));
  const chIn = bx(c, 'side-L-chine-in'), chOut = bx(c, 'side-L-chine');
  if (chIn) W.rect(L.hwC, web0, chIn.z0, chIn.z1, ghost({ dash: undefined }));
  if (chOut) W.rect(web1, L.hwC + L.side, chOut.z0, chOut.z1, ghost({ dash: undefined }));
  W.rect(g.backer.y1, g.backer.y1 + g.rail.t, g.rail.zb, g.rail.zt, ghost({ dash: undefined }));
  W.rect(bk.y0, bk.y1, bk.z0, bk.z1, ghost({ dash: undefined }));
  W.rect(pl.y0, pl.y1, pl.z0, pl.z1, mat('steel'));
  W.poly(kneeSectionPoly(g), mine('oak'));
  const yHead = Y_face(g) + kn.legT;
  for (const z of g.bolts.zs) secBolt(W, { axis: 'u', c: z, a: yHead, b: pl.y0, d: bd, headWasher: p.brakeMountWasherOdIn });
  // the socket and ratchet on the lower head, outside; the wrench on its nut, inside, handle down and inboard
  const zb = g.bolts.zs[0], hh = 0.65 * bd, wtk = washerThick(bd);
  const sock0 = yHead + wtk, sock1 = sock0 + hh + 0.9;
  W.rect(sock0 - 0.05, sock1, zb - 0.45, zb + 0.45, { fill: '#e3e7ea', stroke: ACCENT, width: 1.8 });
  W.poly([[sock1, zb], [sock1 + 0.5, zb], [sock1 + 1.6, zb - 2.6]], { stroke: ACCENT, width: 5 }, false);
  const nut = pl.y0 - nutHeight(bd) / 2;
  W.poly([[nut, zb], [nut - 0.5, zb - 1.0], [nut - 1.8, zb - 3.4]], { stroke: ACCENT, width: 5 }, false);
  F.circle(W.at(nut, zb), 0.42 * W.k, { stroke: ACCENT, width: 2.2 });
  // your arm: in from outside, under the rail, up to the wrench
  F.path(`M${W.at(u1 - 0.3, 1.0).join(',')} Q${W.at(g.backer.y1 + 1.2, 0.9).join(',')} ${W.at(nut - 2.0, zb - 3.6).join(',')}`, { stroke: ACCENT, width: 2, dash: '7 4' });
  F.text(W.at(g.backer.y1 + 0.6, 0.35), 'your arm', { size: 12, color: ACCENT, anchor: 'middle' });
  column(F, W.at(u1, 0)[0] + 12, 'start', [
    { at: W.at(kn.yOut - 0.3, kn.zLeg + 2), text: 'knee (comes off)' },
    { at: W.at(sock1 + 1.6, zb - 2.6), text: ['ratchet and socket', 'on the bolt head,', 'from outside'] },
    ...(wheel ? [{ at: W.at(wheel.y1, 1.2), text: ['rear wheel', '(behind)'] }] : []),
  ], { top: 404 });
  column(F, W.at(u0, 0)[0] - 12, 'end', [
    { at: W.at(u0 + 0.4, (deck.z0 + deck.z1) / 2), text: 'deck' },
    { at: W.at(bk.y0 + 0.2, bk.z1 - 0.3), text: ['backer and backing', 'plate stay on'] },
    { at: W.at(nut - 0.3, zb + 0.3), text: ['wrench on the', 'nylock nut'] },
    { at: W.at(nut - 1.8, zb - 3.4), text: ['handle angled', 'down and inboard'] },
    { at: W.at(g.backer.y1 + g.rail.t / 2, g.rail.zb + 0.25), text: 'rail' },
  ], { top: 404 });
  F.text([W.at(u1, 0)[0], W.at(0, 0)[1] + 22], 'outside', { size: 12, color: MUTED, anchor: 'end' });
  legend(F, ['oak', 'steel', 'rubber', 'ghost'], [16, 790]);
  F.note('Side view and section, not to scale');
  return {
    id: 'brake-knee-off-reach',
    title: 'Where to reach to take a knee off',
    caption: 'The nuts are out of sight: on the steel backing plate inside the rail, under the deck, in the bay between the two crossmembers just ahead of the rear wheel. Lie beside the sled, reach in under the rail and up behind it, and hold each nut with the wrench, its handle angled down and inboard. Turn the bolt from outside with the ratchet and socket on its head. The knee comes off with its flap as one piece; the backer and the plate stay on the sled.',
    svg: F.svg('Taking a brake knee off: the reach under the rail and the two tools on one bolt'),
  };
};

export const GEAR_FIGURES: Record<string, FigFn[]> = {
  'rear-beam': [rearBeamWhere, rearBeamSection],
  'front-beam': [kingpinSection, frontPlan, frontSection],
  'brake-knees': [kneesWhere, kneeSection],
  'gear-fit': [wheelOnAxle],
  'brake-knee-off': [kneeOffReach],
};
