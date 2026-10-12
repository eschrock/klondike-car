/**
 * Forms and templates (Phase 4, output 5): full-scale, dimensioned SVG drawings derived from the model, plus a tiler that splits a drawing onto US Letter pages for printing. Plain TS, no three.js.
 *
 * Every drawing is in real inches (the viewBox is in inches) with a title block (name, scale 1:1, units, the params revision), key dimensions as text and dimension lines, and a 1 in check
 * square. The outline of the thing to cut is an outside cut (black) so Shaper Origin can cut it; the dimension layer is guides (blue). Nothing here is hand-entered: curves and stations come
 * from the layout, the parts' meshes and the params. The revision stamp is a hash of the params state (never the wall clock), unless the caller passes `opts.date`.
 *
 * Drawings (ids): 'side-form' (a: the cleat-line template and the S-ramp), 'rail-form' (b), 'crown-templates' (c: handlebow and bow bulkhead), 'brake-flap-template' (d).
 */
import type { Params } from '../params';
import { computeLayout, outerHalfWidth, samples, sideTopAt, type Layout } from '../model/layout';
import { bowGeometry } from '../model/handle';
import { transomTopOutline } from '../model/body';
import type { Part, Vec2 } from '../model/types';
import { flatPattern } from './flat';
import { analyzeShaperPart } from './shaper-svg';
import {
  checkSquareEls, circleD, dimensionEls, esc, fmt, guideEl, hash6, pathEl, polyD, rectLoop, svgDocument, textEl, type Xf,
} from './svg-util';

/** Process constants (shop practice, not design numbers). */
/** Thickness (in) of the hardboard / MDF the templates and ramp ribs are cut from. */
export const TEMPLATE_STOCK_IN = 0.25;
export const RIB_STOCK_IN = 0.75;
/** Spacing (in) of cleats and clamps along a bend: "every 4 to 5 in" (HULL_STEP, build-utils.ts). */
export const CLEAT_SPACING_IN = 4.5;
/** Cut this much deeper than the stock (in). */
const BREAKTHROUGH_IN = 0.02;
/** Rail form: straight lead-in ahead of the S start (in), depth of the form body behind the face (in). */
export const RAIL_FORM_LEAD_IN = 12;
export const FORM_DEPTH_IN = 4;
/** Station spacing (in) of the offset table on the rail form. */
const OFFSET_STEP_IN = 2;
/** Spring-back allowance range, as a fraction of the turn-in (noted on the drawing, not applied: confirm with a dry strip). */
export const SPRINGBACK_RANGE: [number, number] = [0.05, 0.1];
/** Template band (in) kept below a crown curve. */
const CROWN_BAND_IN = 2;

// Sheet layout (in): margins around the content for dimension lines, and the title block below it.
const MARGIN_IN = 1.3;
const TITLE_H_IN = 2;

export interface FormDim { key: string; label: string; valueIn: number }

export interface FormDrawing {
  id: string;
  title: string;
  fileName: string;
  svg: string;
  /** Size of the whole sheet (in). */
  widthIn: number;
  heightIn: number;
  dims: FormDim[];
  notes: string[];
}

interface Plan {
  id: string;
  title: string;
  /** Content size (in): the part of the drawing inside the margins. */
  w: number;
  h: number;
  /** Draw the content; `place` maps content coordinates (u right, v up, origin lower left) to the sheet (SVG user units). */
  draw: (place: Xf) => string;
  dims: FormDim[];
  notes: string[];
  subtitle: string[];
}

function finishDrawing(plan: Plan, p: Params, date?: string): FormDrawing {
  const W = plan.w + 2 * MARGIN_IN, H = plan.h + 2 * MARGIN_IN + TITLE_H_IN;
  const place: Xf = ([u, v]) => [MARGIN_IN + u, H - (MARGIN_IN + TITLE_H_IN + v)];
  const sheet: Xf = ([x, y]) => [x, H - y]; // sheet coordinates: origin lower left of the whole sheet
  const rev = `rev ${hash6(JSON.stringify(p))}${date ? `, ${date}` : ''}`;
  const tb: string[] = [];
  tb.push(guideEl(polyD(rectLoop(0.2, 0.2, W - 0.2, TITLE_H_IN - 0.2), sheet), { label: 'title block' }));
  tb.push(textEl(sheet([0.4, TITLE_H_IN - 0.55]), plan.title, 0.32, { fill: '#0068FF', bold: true }));
  const lines = [...plan.subtitle, `Scale 1:1 (full size), units: inches. Check the 1 in square before use.`, `Klondike sled, Troop 455. Params ${rev}.`];
  lines.forEach((l, i) => tb.push(textEl(sheet([0.4, TITLE_H_IN - 0.95 - i * 0.24]), l, 0.17)));
  tb.push(checkSquareEls([W - 1.6, 0.35], sheet));
  const body = plan.draw(place) + `<g id="titleblock">${tb.join('')}</g>`;
  const svg = svgDocument({ widthIn: W, heightIn: H, title: `${plan.title} (1:1)`, desc: [plan.title, ...plan.subtitle, ...plan.notes].join('\n'), body });
  return { id: plan.id, title: plan.title, fileName: `${plan.id}.svg`, svg, widthIn: W, heightIn: H, dims: plan.dims, notes: plan.notes };
}

// ── Shared pieces ──
const outsideCut = (loop: Vec2[], place: Xf, depth: number, label: string): string => pathEl({ cutType: 'outside', d: polyD(loop, place), depthIn: depth + BREAKTHROUGH_IN, label });
const label = (place: Xf, at: Vec2, text: string, size = 0.18, anchor: 'start' | 'middle' | 'end' = 'start'): string => textEl(place(at), text, size, { anchor });
const dimTo = (place: Xf, a: Vec2, b: Vec2, text: string, off = 0.6): string => dimensionEls(a, b, text, place, off);
const inch = (v: number): string => `${fmt(Math.round(v * 1000) / 1000)} in`;

const pathLength = (pts: Vec2[]): number => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);

/** The point and unit left-normal at arc length `s` along a polyline. */
function atArc(pts: Vec2[], s: number): { p: Vec2; n: Vec2 } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= s || i === pts.length - 1) {
      const t = d ? Math.max(0, Math.min(1, (s - acc) / d)) : 0;
      const dx = (pts[i][0] - pts[i - 1][0]) / (d || 1), dy = (pts[i][1] - pts[i - 1][1]) / (d || 1);
      return { p: [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])], n: [-dy, dx] };
    }
    acc += d;
  }
  return { p: pts[0], n: [0, 1] };
}

// ── (a) The sandwich side: cleat-line template and the S-ramp ──
function sideFormPlan(parts: Part[], p: Params, L: Layout): Plan | null {
  const web = parts.find((x) => x.id === 'side-L-web');
  const f = web && flatPattern(web);
  if (!web || !f) return null;
  const z0 = L.chineBot;
  const uOf = (x: number): number => f.toPattern([x, 0, 0])[0];
  const xs = samples(L.xSideStart, L.xSideEnd, 160);
  const line = (zOf: (x: number) => number): Vec2[] => xs.map((x) => [uOf(x), zOf(x) - z0] as Vec2);
  const sheer = line((x) => sideTopAt(L, x));
  const gunBot = line((x) => sideTopAt(L, x) - L.railBand);
  const chineTop = L.chineBot + L.chineH - z0;
  const innerChineBot = L.chineBot + L.ply + p.deckSlopIn - z0; // the inner chine band starts a deck + clearance up: the gap the deck edge rises into
  const sheerLen = pathLength(sheer);
  const nCleat = Math.ceil(sheerLen / CLEAT_SPACING_IN) + 1;
  const cleatStep = sheerLen / (nCleat - 1);
  const templateH = Math.max(...sheer.map((q) => q[1]), f.heightIn);

  // The S-ramp: height = the turn-in at each station (the web lies flat, so the plan S becomes a rise), from the S start to the bow end, then flat.
  const hasRamp = L.taper.turnIn > 0.01;
  const xR0 = L.taper.x0, xR1 = L.taper.x1, xRe = L.xSideEnd;
  const rampXs = samples(xR0, xRe, 48);
  const rampProfile: Vec2[] = rampXs.map((x) => [uOf(x), L.turnIn(x)]);
  const rampH = hasRamp ? L.turnIn(xRe) : 0;
  const webTallAtBow = Math.max(...rampXs.map((x) => sideTopAt(L, x) - L.chineBot));
  const ribs = Math.ceil(webTallAtBow / CLEAT_SPACING_IN) + 1;
  const GAP = 1.6;
  const rampBlock = hasRamp ? rampH + GAP : 0;
  const w = f.widthIn, h = templateH + rampBlock + 0.8;
  const dims: FormDim[] = [
    { key: 'web-length', label: 'Web flat length (development)', valueIn: f.widthIn },
    { key: 'web-height', label: 'Web height at the rear', valueIn: f.heightIn },
    { key: 'sheer-length', label: 'Sheer line length (cleat line)', valueIn: sheerLen },
    { key: 'cleat-spacing', label: 'Cleat spacing along the sheer', valueIn: cleatStep },
    { key: 'cleat-count', label: 'Cleats on the sheer line', valueIn: nCleat },
  ];
  if (hasRamp) dims.push(
    { key: 'ramp-rise', label: 'S-ramp rise (= the turn-in per side)', valueIn: rampH },
    { key: 'ramp-length', label: 'S-ramp length (from the S start to the bow end)', valueIn: uOf(xRe) - uOf(xR0) },
    { key: 's-length', label: 'S (taper) length', valueIn: uOf(xR1) - uOf(xR0) },
    { key: 'ramp-ribs', label: 'Ramp ribs (3/4 in MDF)', valueIn: ribs },
  );
  const notes = [
    `Lay the web FLAT on the bench with this template under or over it (the template is the web's flat development: length ${inch(f.widthIn)} along the plan curve, ${inch(f.heightIn)} tall at the rear).`,
    `CLEAT THE SHEER LINE: ${nCleat} cleats or screws into the sacrificial table, ${inch(cleatStep)} apart along the sheer, on the high side of the line (a straight 1.5 in strip edge-bent to the sheer pushes sideways about 65 lbf at mid-span per band until the epoxy cures).`,
    hasRamp
      ? `S-RAMP: the bow end of the web rides up this ramp: rise ${inch(rampH)} (the turn-in per side), S from station ${inch(uOf(xR0))} to ${inch(uOf(xR1))} along the web, level to the bow end at ${inch(uOf(xRe))}. Cut ${ribs} ribs from ${RIB_STOCK_IN} in MDF about ${CLEAT_SPACING_IN} in apart under the ${inch(webTallAtBow)} the web stands at the bow, and cap them with 1/4 in hardboard. Do the other face on the mirror ramp (flip the web).`
      : 'No bow turn-in at these params: no ramp is needed.',
    'Lines: sheer (gunwale top, the cleat line), gunwale band lower edge, web top (the cut edge, the cap below the sheer), chine band top, inner chine band bottom (the deck-edge gap), web bottom. Both outlines are outside cuts so the template and the ramp rib can be cut on the Shaper.',
  ];
  return {
    id: 'side-form', title: 'Sandwich side: cleat-line template and S-ramp', w, h, dims, notes,
    subtitle: [`Web ${inch(f.widthIn)} x ${inch(f.heightIn)}; ${nCleat} cleats ${inch(cleatStep)} apart; ${hasRamp ? `S-ramp rise ${inch(rampH)}` : 'no ramp'}.`],
    draw: (place) => {
      const v0 = rampBlock; // the template sits above the ramp drawing
      const T: Xf = ([u, v]) => place([u, v + v0]);
      const out: string[] = [];
      out.push(`<g id="template">${outsideCut(f.outer, T, TEMPLATE_STOCK_IN, 'web flat outline (template)')}</g>`);
      const g: string[] = [];
      g.push(guideEl(polyD(sheer, T, false), { label: 'sheer line (cleat line)' }), guideEl(polyD(gunBot, T, false), { dashed: true, label: 'gunwale band lower edge' }));
      g.push(guideEl(polyD([[0, chineTop], [w, chineTop]], T, false), { dashed: true, label: 'chine band top' }), guideEl(polyD([[uOf(L.xSideStart), innerChineBot], [w, innerChineBot]], T, false), { dashed: true, label: 'inner chine band bottom' }));
      g.push(label(T, [w * 0.5, sheer[Math.floor(sheer.length / 2)][1] + 0.35], 'SHEER LINE (cleat line)', 0.2, 'middle'));
      for (let i = 0; i < nCleat; i++) {
        const { p: q, n } = atArc(sheer, i * cleatStep);
        const nn: Vec2 = n[1] >= 0 ? n : [-n[0], -n[1]];
        const tip: Vec2 = [q[0] + nn[0] * 0.6, q[1] + nn[1] * 0.6];
        g.push(guideEl(polyD([q, tip], T, false)), guideEl(circleD(tip, 0.19, T)), label(T, [tip[0], tip[1] + 0.25], String(i + 1), 0.13, 'middle'));
      }
      if (hasRamp) {
        for (const [x, t] of [[xR0, 'S starts'], [xR1, 'S ends'], [xRe, 'bow end']] as const) {
          g.push(guideEl(polyD([[uOf(x), -rampBlock + GAP * 0.4], [uOf(x), templateH]], T, false), { dashed: true }), label(T, [uOf(x) + 0.1, templateH + 0.3], `${t} (${inch(uOf(x))})`, 0.15));
        }
      }
      g.push(dimTo(T, [0, 0], [w, 0], `web length ${inch(f.widthIn)}`, -0.7));
      g.push(dimTo(T, [0, 0], [0, f.heightIn], `${inch(f.heightIn)}`, 0.7));
      out.push(`<g id="guides">${g.join('')}</g>`);
      if (hasRamp) {
        const R: Xf = ([u, v]) => place([u, v]);
        const poly: Vec2[] = [[uOf(xR0), 0], ...rampProfile, [uOf(xRe), 0]];
        out.push(`<g id="ramp">${outsideCut(poly, R, RIB_STOCK_IN, 'S-ramp rib profile')}</g>`);
        out.push(`<g id="rampdims">${dimTo(R, [uOf(xRe), 0], [uOf(xRe), rampH], `rise ${inch(rampH)}`, -0.7)}${dimTo(R, [uOf(xR0), 0], [uOf(xRe), 0], `ramp length ${inch(uOf(xRe) - uOf(xR0))}`, -0.6)}${dimTo(R, [uOf(xR0), 0], [uOf(xR1), 0], `S ${inch(uOf(xR1) - uOf(xR0))}`, -1.2)}${label(R, [uOf(xR0), rampH + 0.4], `S-RAMP rib profile (cut ${ribs} from ${RIB_STOCK_IN} in MDF); rise = turn-in per side`, 0.2)}</g>`);
      }
      return out.join('');
    },
  };
}

// ── (b) The rail bending form ──
function railFormPlan(parts: Part[], L: Layout): Plan | null {
  const rail = parts.find((x) => x.id === 'rail-L');
  if (!rail || rail.geometry.type !== 'mesh' || !rail.geometry.profile) return null;
  const t = rail.geometry.thickness ?? 0;
  const plies = rail.plies ?? 1;
  const strip = t / plies;
  const xEnd = L.railEnd;
  const xStart = Math.max(L.xSideStart, L.taper.x0 - RAIL_FORM_LEAD_IN);
  const xsF = samples(xStart, xEnd, Math.max(8, Math.ceil((xEnd - xStart) / 1)));
  // The outer (hull-outside) face of the rail is the hull's outer plan curve: the chine, gunwale and rail outer faces are one curve (frame.ts, layout.ts).
  const yOut = (x: number): number => outerHalfWidth(L, x);
  const yMin = Math.min(...xsF.map(yOut));
  const face: Vec2[] = xsF.map((x) => [x - xStart, yOut(x) - yMin + FORM_DEPTH_IN]);
  const turn = L.taper.turnIn;
  const lengthIn = xEnd - xStart;
  const body: Vec2[] = [[0, 0], [lengthIn, 0], ...[...face].reverse()];
  const clamps = Math.ceil((xEnd - L.taper.x0) / CLEAT_SPACING_IN) + 1;
  const [sb0, sb1] = SPRINGBACK_RANGE;
  const dims: FormDim[] = [
    { key: 'form-length', label: 'Form length', valueIn: lengthIn },
    { key: 'turn-in', label: 'Turn-in per side (offset at the bow)', valueIn: turn },
    { key: 'strip', label: 'Strip thickness (2 per rail)', valueIn: strip },
    { key: 'min-radius', label: 'Tightest plan radius', valueIn: L.taper.minRadiusIn },
    { key: 'springback-low', label: 'Spring-back allowance, low end (noted, not applied)', valueIn: turn * sb0 },
    { key: 'springback-high', label: 'Spring-back allowance, high end (noted, not applied)', valueIn: turn * sb1 },
    { key: 'clamps', label: 'Clamp stations', valueIn: clamps },
  ];
  const w = lengthIn, h = face.reduce((m, q) => Math.max(m, q[1]), 0) + 1.5;
  const stations: number[] = [];
  for (let s = 0; s <= lengthIn + 1e-9; s += OFFSET_STEP_IN * 2) stations.push(s);
  const tableText = stations.filter((s) => xStart + s >= L.taper.x0 - 1e-6 && xStart + s <= L.taper.x1 + OFFSET_STEP_IN * 2).map((s) => `${fmt(s)}: ${fmt(yOut(xStart) - yOut(xStart + s))}`).join('   ');
  const notes = [
    `Form face = the rails' OUTER face (the hull's outer plan curve: the chine, gunwale and rail outer faces are one curve). One form serves both rails: bend the second one the other way up. Left rail strips are ${inch(strip)} x ${inch(rail.stock?.w ?? 0)} oak, ${plies} per rail, glued face to face on the form with every clamp station (${clamps}, ${CLEAT_SPACING_IN} in apart) loaded.`,
    `The finished curve is drawn as is. SPRING-BACK ALLOWANCE (noted, NOT applied): dry strips this thin spring back, about ${sb0 * 100}% to ${sb1 * 100}% of the turn-in (${inch(turn * sb0)} to ${inch(turn * sb1)} at the bow). Bend a dry strip on the form first and, if it opens, shim the form face out by that much before cutting the real one; once glued the lamination holds its shape.`,
    `Tightest plan radius ${inch(L.taper.minRadiusIn)} on a ${inch(strip)} strip (radius / thickness = ${fmt(Math.round(L.taper.minRadiusIn / Math.max(strip, 1e-6)))}); the S runs from ${inch(L.taper.x0)} to ${inch(L.taper.x1)}, parallel to the bulkhead after that. The rail is ${inch(xEnd - Math.min(...rail.geometry.profile.map((q) => q[0])))} long; only the last ${inch(xEnd - L.taper.x0)} is curved. Offsets from the straight line behind the S (station from the form start : offset): ${tableText}.`,
  ];
  return {
    id: 'rail-form', title: 'Rail bending form (plan, left rail)', w, h, dims, notes,
    subtitle: [`Form ${inch(lengthIn)} long; face offset ${inch(turn)} at the bow; ${plies} strips of ${inch(strip)} per rail.`],
    draw: (place) => {
      const out: string[] = [`<g id="form">${outsideCut(body, place, RIB_STOCK_IN, 'rail form body')}</g>`];
      const g: string[] = [];
      g.push(guideEl(polyD(face, place, false), { label: 'form face' }));
      const sx = (x: number) => x - xStart;
      for (const [x, tt] of [[L.taper.x0, 'S starts'], [L.taper.x1, 'S ends']] as const) g.push(guideEl(polyD([[sx(x), 0], [sx(x), h]], place, false), { dashed: true }), label(place, [sx(x) + 0.1, h - 0.2], `${tt} (station ${inch(sx(x))})`, 0.16));
      for (let i = 0; i < clamps; i++) {
        const x = Math.min(xEnd, L.taper.x0 + i * ((xEnd - L.taper.x0) / (clamps - 1)));
        const q: Vec2 = [sx(x), yOut(x) - yMin + FORM_DEPTH_IN];
        g.push(guideEl(polyD([q, [q[0], q[1] + 0.5]], place, false)), guideEl(circleD([q[0], q[1] + 0.7], 0.19, place)));
      }
      g.push(dimTo(place, [0, 0], [lengthIn, 0], `form length ${inch(lengthIn)}`, -0.6));
      g.push(dimTo(place, [lengthIn, face[face.length - 1][1]], [lengthIn, FORM_DEPTH_IN], `turn-in ${inch(turn)}`, 0.7));
      g.push(dimTo(place, [lengthIn, 0], [lengthIn, FORM_DEPTH_IN], `${inch(FORM_DEPTH_IN)}`, -1.4));
      g.push(label(place, [0, h - 0.3], 'FORM FACE (bend the strips against this curve; face = rail outer face)', 0.2));
      out.push(`<g id="guides">${g.join('')}</g>`);
      return out.join('');
    },
  };
}

// ── (c) Crown templates: the handlebow and the bow bulkhead ──
function crownPlan(parts: Part[], p: Params, L: Layout): Plan | null {
  const bar = parts.find((x) => x.id === 'handle-bar');
  const barFlat = bar && flatPattern(bar);
  const bw = bowGeometry(p, L);
  const b = L.bulkhead;
  if (!barFlat) return null;
  const crown = Math.max(0, b.zCenter - b.zCorner);
  const rc = Math.min(p.transomCornerRadiusIn, (b.zCorner - b.bot) / 2);
  // Bulkhead top: right corner foot, over the crown, to the left corner foot (y, z). Template = the top chain with a band under it.
  const chain = transomTopOutline(b.halfW, b.zCorner, crown, rc);
  const zLow = Math.min(...chain.map((q) => q[1])) - CROWN_BAND_IN;
  const bulk: Vec2[] = [...chain.map(([y, z]) => [b.halfW - y, z - zLow] as Vec2)].sort((a, c) => a[0] - c[0]);
  const bulkPoly: Vec2[] = [[0, 0], [2 * b.halfW, 0], ...[...bulk].reverse()];
  const bulkH = Math.max(...bulk.map((q) => q[1]));
  // Handlebow: the bow's own outline (the bandsawn board, both arcs), already in `flatPattern` coordinates.
  const barW = barFlat.widthIn, barH = barFlat.heightIn;
  const postU = bw.yEnd - bw.yPost, postU2 = bw.yEnd + bw.yPost;
  const GAP = 2.2;
  const w = Math.max(barW, 2 * b.halfW), h = barH + GAP + bulkH + 1.2;
  const sec = p.handleBarDiameterIn;
  const dims: FormDim[] = [
    { key: 'bow-length', label: 'Handlebow overall length', valueIn: barW },
    { key: 'bow-height', label: 'Handlebow template height (its lowest end to its crown)', valueIn: barH },
    { key: 'bow-chord', label: 'Handlebow chord between the posts', valueIn: 2 * bw.yPost },
    { key: 'bow-crown', label: 'Handlebow crown above the post tops', valueIn: bw.crownIn },
    { key: 'bow-radius', label: 'Handlebow arc radius', valueIn: bw.radiusIn },
    { key: 'bow-slope', label: 'Handlebow slope over the posts (degrees)', valueIn: bw.postSlopeDeg },
    { key: 'bulk-span', label: 'Bulkhead width at the top', valueIn: 2 * b.halfW },
    { key: 'bulk-crown', label: 'Bulkhead crown (center above the corners)', valueIn: crown },
    { key: 'bulk-corner-radius', label: 'Bulkhead corner radius', valueIn: rc },
  ];
  const notes = [
    `Both crowns are the same height, params handleBowCrownIn = ${inch(p.handleBowCrownIn)}: the handlebow is a circular arc (radius ${inch(bw.radiusIn)}) through the two post tops that rises ${inch(bw.crownIn)} at the middle and runs on to the sled edge; the bulkhead top is the shallow parabolic crown ${inch(crown)} above its corners (${inch(rc)} corner radius), the same curve as the transom top.`,
    `Handlebow template: the whole bow outline, ${inch(barW)} long, ${inch(sec)} section (the underside is the parallel arc). Use it on the 5/4 board: lay the arc on the grain so the grain follows it, bandsaw outside the line, then flush-trim with a pattern bit. The post stations are marked at y = ±${inch(bw.yPost)} (the post tops are sawn to the ${fmt(Math.round(bw.postSlopeDeg * 10) / 10)} degree slope).`,
    `Bulkhead crown template: the top edge of the bow bulkhead, ${inch(2 * b.halfW)} wide, ${inch(CROWN_BAND_IN)} of template band under the curve. Set it on the oak blank flush to the bottom corners' height line, trace, and bandsaw (the Shaper cuts the bulkhead itself; this is the check and the fallback).`,
  ];
  return {
    id: 'crown-templates', title: 'Crown templates: handlebow and bow bulkhead', w, h, dims, notes,
    subtitle: [`Handlebow crown ${inch(bw.crownIn)}, radius ${inch(bw.radiusIn)}; bulkhead crown ${inch(crown)}, ${inch(2 * b.halfW)} wide.`],
    draw: (place) => {
      const B: Xf = ([u, v]) => place([u, v]);
      const H: Xf = ([u, v]) => place([u, v + bulkH + GAP]);
      const out: string[] = [];
      out.push(`<g id="bulkhead">${outsideCut(bulkPoly, B, TEMPLATE_STOCK_IN, 'bulkhead crown template')}</g>`);
      out.push(`<g id="handlebow">${outsideCut(barFlat.outer, H, TEMPLATE_STOCK_IN, 'handlebow template')}</g>`);
      const g: string[] = [];
      // Bow: post stations and the post-top height line.
      for (const u of [postU, postU2]) g.push(guideEl(polyD([[u, 0], [u, barH]], H, false), { dashed: true }), label(H, [u + 0.1, barH + 0.25], `post y = ${u < barW / 2 ? '-' : '+'}${fmt(bw.yPost)}`, 0.15));
      g.push(guideEl(polyD([[0, barH], [barW, barH]], H, false), { dashed: true, label: 'crown height' }), guideEl(polyD([[0, barH - bw.crownIn], [barW, barH - bw.crownIn]], H, false), { dashed: true, label: 'post-top height (centerline)' }));
      g.push(dimTo(H, [0, 0], [barW, 0], `overall ${inch(barW)}`, -0.6), dimTo(H, [postU, barH + 0.0], [postU2, barH + 0.0], `post chord ${inch(2 * bw.yPost)}`, 0.5));
      g.push(dimTo(H, [barW + 0.2, barH - bw.crownIn], [barW + 0.2, barH], `crown ${inch(bw.crownIn)}`, -0.6));
      g.push(label(H, [0, barH + 1.05], `HANDLEBOW template: radius ${inch(bw.radiusIn)}, ${inch(sec)} section`, 0.2));
      // Bulkhead.
      g.push(guideEl(polyD([[0, bulkH - crown], [2 * b.halfW, bulkH - crown]], B, false), { dashed: true, label: 'corner height' }));
      g.push(dimTo(B, [0, 0], [2 * b.halfW, 0], `width ${inch(2 * b.halfW)}`, -0.6), dimTo(B, [2 * b.halfW + 0.2, bulkH - crown], [2 * b.halfW + 0.2, bulkH], `crown ${inch(crown)}`, -0.6));
      g.push(label(B, [0, bulkH + 0.35], 'BOW BULKHEAD crown template (top edge)', 0.2));
      out.push(`<g id="guides">${g.join('')}</g>`);
      return out.join('');
    },
  };
}

// ── (d) The brake-flap router template ──
function flapPlan(parts: Part[], p: Params): Plan | null {
  const flap = parts.find((x) => x.id === 'brake-flap-L') ?? parts.find((x) => x.partNo === 'brake-flap');
  const d = flap && analyzeShaperPart(flap, parts, p);
  if (!flap || !d) return null;
  const f = d.f;
  const marks = d.items.filter((i) => i.k === 'drill');
  const cuts = d.items.filter((i) => i.k === 'cutHole' || i.k === 'cutLoop');
  const crossLines = d.items.filter((i): i is Extract<typeof i, { k: 'line' }> => i.k === 'line' && i.label === 'cross hole');
  const w = f.widthIn, h = f.heightIn + 0.6;
  const dims: FormDim[] = [
    { key: 'flap-length', label: 'Flap length', valueIn: f.widthIn },
    { key: 'flap-width', label: 'Flap full width', valueIn: f.heightIn },
    { key: 'flap-thickness', label: 'Flap thickness (stock)', valueIn: f.thicknessIn },
    { key: 'pilot-marks', label: 'Drill guide holes', valueIn: marks.length },
  ];
  const notes = [
    `Router template for a pattern bit: the outline is the finished flap at offset 0 (the bit's bearing rides the template edge; ${inch(TEMPLATE_STOCK_IN)} hardboard or MDF, flat on top of the ${inch(f.thicknessIn)} oak blank). Rough the blank out on the bandsaw about 1/16 in proud, then flush-trim.`,
    `Drill guide: the ${marks.length} marks are the pilot holes (pivot-block screws, shoe-block screws) drilled through the template with the oak blank under it; the ${crossLines.length} dashed line marks the pivot pin cross hole (drill it in place with the knee clamped on). The shoe screws come in from the underside.`,
    `Left flap shown; the right flap is the mirror image (the screw eye on the end face is inboard). Roundover all edges after trimming.`,
  ];
  return {
    id: 'brake-flap-template', title: 'Brake flap router template (left flap)', w, h, dims, notes,
    subtitle: [`Outline offset 0; ${inch(f.widthIn)} x ${inch(f.heightIn)}; ${marks.length} drill guide holes.`],
    draw: (place) => {
      const T: Xf = ([u, v]) => place([u, v + 0.3]);
      const out: string[] = [`<g id="outline">${outsideCut(f.outer, T, TEMPLATE_STOCK_IN, 'brake flap outline (template, offset 0)')}</g>`];
      const inside = cuts.map((i) => (i.k === 'cutHole' ? pathEl({ cutType: 'inside', d: circleD(i.c, i.dia, T), depthIn: TEMPLATE_STOCK_IN + BREAKTHROUGH_IN }) : i.k === 'cutLoop' ? pathEl({ cutType: 'inside', d: polyD(i.loop, T), depthIn: TEMPLATE_STOCK_IN + BREAKTHROUGH_IN }) : '')).join('');
      out.push(`<g id="holes">${inside}</g>`);
      const g: string[] = [];
      for (const m of marks) if (m.k === 'drill') g.push(guideEl(circleD(m.c, Math.max(m.dia, 0.19), T)), guideEl(polyD([[m.c[0] - 0.2, m.c[1]], [m.c[0] + 0.2, m.c[1]]], T, false)), guideEl(polyD([[m.c[0], m.c[1] - 0.2], [m.c[0], m.c[1] + 0.2]], T, false)));
      for (const l of crossLines) g.push(guideEl(polyD(l.pts, T, false), { dashed: true }), label(T, [l.pts[0][0] - 0.1, f.heightIn + 0.15], 'pivot pin cross hole', 0.14, 'end'));
      g.push(dimTo(T, [0, 0], [f.widthIn, 0], `length ${inch(f.widthIn)}`, -0.5), dimTo(T, [f.widthIn * 0.55, 0], [f.widthIn * 0.55, f.heightIn], `width ${inch(f.heightIn)}`, 0.0 + 0.5));
      out.push(`<g id="guides">${g.join('')}</g>`);
      return out.join('');
    },
  };
}

/** Every form and template drawing for the current model. `opts.date` is shown beside the params revision (the caller's choice; the wall clock is never read here). */
export function formDrawings(parts: Part[], p: Params, opts: { date?: string } = {}): FormDrawing[] {
  const L = computeLayout(p);
  const plans = [sideFormPlan(parts, p, L), railFormPlan(parts, L), crownPlan(parts, p, L), flapPlan(parts, p)];
  return plans.filter((x): x is Plan => x !== null).map((x) => finishDrawing(x, p, opts.date));
}

// ── Letter tiling ──

export const LETTER_W_IN = 8.5;
export const LETTER_H_IN = 11;
export const TILE_MARGIN_IN = 0.5;
/** Overlap (in) between neighbouring pages: the strip printed on both, to line them up. */
export const TILE_OVERLAP_IN = 0.5;

export interface TileWindow { page: string; row: number; col: number; x: number; y: number; w: number; h: number }

/** The page windows (in drawing inches, from the drawing's top left) that cover a `widthIn` x `heightIn` drawing on Letter pages with `TILE_MARGIN_IN` margins and `TILE_OVERLAP_IN` overlap. Labels run A1, A2, ... along a row, then B1, ... */
export function tilePlan(widthIn: number, heightIn: number): { cols: number; rows: number; windows: TileWindow[] } {
  const pw = LETTER_W_IN - 2 * TILE_MARGIN_IN, ph = LETTER_H_IN - 2 * TILE_MARGIN_IN;
  const su = pw - TILE_OVERLAP_IN, sv = ph - TILE_OVERLAP_IN;
  const cols = Math.max(1, Math.ceil((widthIn - TILE_OVERLAP_IN) / su - 1e-9));
  const rows = Math.max(1, Math.ceil((heightIn - TILE_OVERLAP_IN) / sv - 1e-9));
  const windows: TileWindow[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) windows.push({ page: `${String.fromCharCode(65 + (r % 26))}${c + 1}`, row: r, col: c, x: c * su, y: r * sv, w: pw, h: ph });
  return { cols, rows, windows };
}

/** Split a full-scale drawing onto US Letter pages (8.5 x 11, 0.5 in margins): one SVG per page with its label, overlap alignment marks and a 1 in check square. */
export function tileForLetter(svg: string, widthIn: number, heightIn: number): string[] {
  const root = /<svg\b[^>]*>/.exec(svg);
  const vb = root && /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(root[0]);
  const minX = vb ? Number(vb[1]) : 0, minY = vb ? Number(vb[2]) : 0;
  const inner = root ? svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>')) : svg;
  const titleM = /<title>([^<]*)<\/title>/.exec(svg);
  const name = titleM ? titleM[1] : 'drawing';
  const { cols, rows, windows } = tilePlan(widthIn, heightIn);
  const pages: string[] = [];
  const cross = (x: number, y: number): string => `<path d="M${fmt(x - 0.15)},${fmt(y)}h0.3M${fmt(x)},${fmt(y - 0.15)}v0.3" stroke="#000" stroke-width="0.01" fill="none"/><circle cx="${fmt(x)}" cy="${fmt(y)}" r="0.06" fill="none" stroke="#000" stroke-width="0.01"/>`;
  for (const win of windows) {
    const total = windows.length;
    const idx = win.row * cols + win.col + 1;
    const x0 = TILE_MARGIN_IN, y0 = TILE_MARGIN_IN, x1 = x0 + win.w, y1 = y0 + win.h;
    const marks: string[] = [];
    // Registration crosses at the four corners of the printable area, and the overlap strips drawn as dashed lines where a neighbor takes over.
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) marks.push(cross(x, y));
    const dash = 'stroke="#000" stroke-width="0.01" stroke-dasharray="0.08 0.06" fill="none"';
    const navs: string[] = [];
    if (win.col + 1 < cols) { const nx = x1 - TILE_OVERLAP_IN; marks.push(`<path d="M${fmt(nx)},${y0}V${y1}" ${dash}/>`); navs.push(`->${windows[win.row * cols + win.col + 1].page}`); }
    if (win.col > 0) { const nx = x0 + TILE_OVERLAP_IN; marks.push(`<path d="M${fmt(nx)},${y0}V${y1}" ${dash}/>`); navs.push(`<-${windows[win.row * cols + win.col - 1].page}`); }
    if (win.row + 1 < rows) { const ny = y1 - TILE_OVERLAP_IN; marks.push(`<path d="M${x0},${fmt(ny)}H${x1}" ${dash}/>`); navs.push(`v${windows[(win.row + 1) * cols + win.col].page}`); }
    if (win.row > 0) { const ny = y0 + TILE_OVERLAP_IN; marks.push(`<path d="M${x0},${fmt(ny)}H${x1}" ${dash}/>`); navs.push(`^${windows[(win.row - 1) * cols + win.col].page}`); }
    // 1 in check square at the lower left of the printable area, on top of the drawing.
    const sq = `<rect x="${fmt(x0 + 0.1)}" y="${fmt(y1 - 1.1)}" width="1" height="1" fill="#fff" fill-opacity="0.85" stroke="#000" stroke-width="0.015"/><text x="${fmt(x0 + 0.6)}" y="${fmt(y1 - 0.55)}" font-family="Helvetica, Arial, sans-serif" font-size="0.16" text-anchor="middle">1 in</text>`;
    const label = `<text x="${fmt(x0)}" y="${fmt(y1 + 0.32)}" font-family="Helvetica, Arial, sans-serif" font-size="0.18" font-weight="bold">${win.page}</text><text x="${fmt(x0 + 0.6)}" y="${fmt(y1 + 0.32)}" font-family="Helvetica, Arial, sans-serif" font-size="0.14">page ${idx} of ${total}   ${esc(name)}   (${fmt(win.x)}, ${fmt(win.y)}) in   neighbors: ${esc(navs.join(' ') || 'none')}   print at 100%, no scaling</text>`;
    const big = `<text x="${fmt(x1 - 0.1)}" y="${fmt(y0 + 0.5)}" font-family="Helvetica, Arial, sans-serif" font-size="0.5" text-anchor="end" fill="#999" fill-opacity="0.6">${win.page}</text>`;
    pages.push(
      `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="${LETTER_W_IN}in" height="${LETTER_H_IN}in" viewBox="0 0 ${LETTER_W_IN} ${LETTER_H_IN}">\n` +
      `<title>${esc(name)} page ${win.page}</title>\n` +
      `<svg id="window" x="${x0}" y="${y0}" width="${fmt(win.w)}" height="${fmt(win.h)}" viewBox="${fmt(minX + win.x)} ${fmt(minY + win.y)} ${fmt(win.w)} ${fmt(win.h)}" overflow="hidden">\n${inner}\n</svg>\n` +
      `<g id="marks">${marks.join('')}${big}${sq}${label}</g>\n</svg>\n`,
    );
  }
  return pages;
}
