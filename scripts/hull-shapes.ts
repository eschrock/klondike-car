// WS-B (Phase 3b): candidate hull plan shapes against the Ackermann tire sweep; numbers for docs/phase3b-wsB-notes.md and the SVG.
// node scripts/run-ts.mjs scripts/hull-shapes.ts [svg]
import { writeFileSync } from 'node:fs';
import { defaultParams, ackSpec, bowSpecOf, footZoneX, requiredCurveRadius } from '../src/params';
import { buildPlanCurve, fitBowCurve, latestCurveEnd, leftTirePolys, minGapToTires, offsetY, sidePolyline, sweepPinch, type PlanCurve } from '../src/model/hull-curve';

const p0 = defaultParams();
const side = p0.sideThicknessIn;
const yA = p0.bodyWidthIn / 2 - side / 2;
const xT = p0.wheelbaseIn + p0.frontOverhangIn - p0.transomThicknessIn;

interface Cand { name: string; curve: PlanCurve; note: string; clearance: number }
const cands: Cand[] = [];
const tiresOf = (p = p0) => { const ack = ackSpec(p); return { wheelbase: p.wheelbaseIn, kx: ack.kx, frontTrack: p.frontTrackIn, tireWidth: p.tireWidthIn, wheelDiameter: p.wheelDiameterIn, lockDeg: 0, ack }; };
const tires = tiresOf();
const polys = leftTirePolys(tires);
const pinch = sweepPinch(polys);
console.log('sweep pinch', pinch, 'rule nose', 2 * (pinch.y - 0.75), 'rounded', Math.floor(2 * (pinch.y - 0.75) * 8) / 8);

// A: the spec default: D-45 reverse curve with a parallel nose, as late an end as the sweep allows.
{
  const noseHalfC = Math.floor(2 * (pinch.y - 0.75) * 8) / 8 / 2 - side / 2;
  const spec = { ...tires, yA, yB: noseHalfC, side };
  const xe = latestCurveEnd(14.5, spec, 0.75, 3, 40);
  cands.push({ name: 'A spec default: reverse curve, parallel nose 20.625', curve: buildPlanCurve(14.5, xe, yA, noseHalfC), note: `end x ${xe.toFixed(2)}`, clearance: 0.75 });
}
const bow = (name: string, W: number, straightIn: number, x0 = 14.5, clearance = 0.75) => {
  const f = fitBowCurve({ x0, yA, xT, yT: W / 2 - side / 2, straightIn }, tires, side, clearance);
  cands.push({ name, curve: f.curve, note: `lam ${f.lambda.toFixed(3)} feasible ${f.feasible}`, clearance });
};
bow('B bow 13, straight 16 (DEFAULT)', 13, 16);
bow('C pointed bow 9.5, straight 16', 9.5, 16);
bow('D blunt bow 16, straight 16', 16, 16);
bow('E bow 13, straight 8 (spec length)', 13, 8);
bow('F bow 13, start 12.5 (grips 2 in aft)', 13, 16, 12.5);
bow('G bow 13, clearance 1.5 (no finger guard)', 13, 16, 14.5, 1.5);

const xs = [14.5, 20, 25, 30, 35, 38.4, 40, 44, 48, 51.75];
const [fx0, fx1] = footZoneX(p0);
for (const c of cands) {
  const k = c.curve;
  // curvature sign changes and total reverse turning from the polyline
  let prevH = 0, reverse = 0, signs = 0, last = 0;
  for (let i = 1; i < k.pts.length; i++) {
    const h = Math.atan2(k.pts[i - 1][1] - k.pts[i][1], k.pts[i][0] - k.pts[i - 1][0]);
    const dh = h - prevH;
    if (Math.abs(dh) > 1e-6) { const sg = Math.sign(dh); if (last && sg !== last) signs++; last = sg; if (dh < 0) reverse += -dh; }
    prevH = h;
  }
  const out = sidePolyline(k, side / 2, k.x0 - 0.5, xT);
  const gap = minGapToTires(out, polys);
  let minIn = Infinity;
  for (let x = fx0; x <= fx1; x += 0.25) minIn = Math.min(minIn, 2 * offsetY(k, -side / 2, x));
  const tail = Math.atan(-(k.endSlope ?? 0)) * 180 / Math.PI;
  const widthAt = (x: number) => (2 * offsetY(k, side / 2, x)).toFixed(2);
  console.log(`${c.name}\n   R_min ${k.minRadius.toFixed(1)}  peak heading ${(k.peakHeading * 180 / Math.PI).toFixed(1)}  tail heading ${tail.toFixed(1)}  curve x ${k.x0}..${k.x1.toFixed(2)}  reverse turn ${(reverse * 180 / Math.PI).toFixed(2)} deg  sign changes ${signs}  gap ${gap.toFixed(2)}  foot-zone inner width ${minIn.toFixed(2)} (need ${(10.88 + 1 + 0.25).toFixed(2)})  ${c.note}`);
  console.log('   outside width at x ' + xs.map((x) => `${x}:${widthAt(x)}`).join('  '));
}
console.log('required radius (lamination)', requiredCurveRadius(p0).toFixed(2));

{
  const S = 12, ox = 20, oy = 300;
  const X = (x: number) => ox + (x + 12) * S, Y = (y: number) => oy - y * S;
  const colors = ['#c0392b', '#1a5fb4', '#26a269', '#9141ac', '#e5a50a', '#865e3c', '#5e5c64'];
  const pts = (a: [number, number][]) => a.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  const W = X(57), H = oy + 115;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif" font-size="10">\n<rect width="100%" height="100%" fill="#fff"/>\n`;
  svg += `<text x="12" y="16" font-size="12" font-weight="bold">Phase 3b hull plan: candidate shapes against the Ackermann tire sweep (left half; outer face of the chine; inches, +X forward; grid 5 in)</text>\n`;
  for (let x = -10; x <= 55; x += 5) svg += `<line x1="${X(x)}" y1="${Y(0)}" x2="${X(x)}" y2="${Y(24)}" stroke="#e5e5e5" stroke-width="0.6"/><text x="${X(x) - 6}" y="${Y(0) + 12}" fill="#777">${x}</text>\n`;
  for (let y = 0; y <= 20; y += 5) svg += `<line x1="${X(-10)}" y1="${Y(y)}" x2="${X(55)}" y2="${Y(y)}" stroke="#e5e5e5" stroke-width="0.6"/><text x="4" y="${Y(y) + 3}" fill="#777">${y}</text>\n`;
  // the default hull, mirrored, as a faint fill
  const dflt = cands[1].curve;
  const half = sidePolyline(dflt, side / 2, -9.6, xT + 0.75);
  const full = [...half, ...[...half].reverse().map(([x, y]) => [x, -y] as [number, number])];
  svg += `<polygon fill="rgba(26,95,180,0.07)" stroke="none" points="${pts(full.map(([x, y]) => [x, y] as [number, number]))}"/>\n`;
  // the left tire sweep (every 3rd rectangle) and the pinch point
  polys.forEach((q, i) => { if (i % 3 === 0) svg += `<polygon fill="rgba(60,60,60,0.05)" stroke="#aaa" stroke-width="0.4" points="${pts(q as [number, number][])}"/>\n`; });
  svg += `<circle cx="${X(pinch.x)}" cy="${Y(pinch.y)}" r="3" fill="#000"/><text x="${X(pinch.x) + 6}" y="${Y(pinch.y) + 3}">tire pinch (${pinch.x.toFixed(1)}, ${pinch.y.toFixed(2)})</text>\n`;
  // grab-handle front and foot zone
  svg += `<line x1="${X(14.4)}" y1="${Y(0)}" x2="${X(14.4)}" y2="${Y(16)}" stroke="#555" stroke-dasharray="2 3"/><text x="${X(14.4) + 3}" y="${Y(16) - 2}" fill="#555">grab handles end 14.4</text>\n`;
  svg += `<rect x="${X(fx0)}" y="${Y(7)}" width="${(fx1 - fx0) * S}" height="${14}" fill="rgba(0,0,0,0.08)"/><text x="${X(fx0)}" y="${Y(7) - 3}" fill="#555">rider feet x ${fx0.toFixed(0)}-${fx1.toFixed(0)}</text>\n`;
  cands.forEach((c, i) => {
    const o = sidePolyline(c.curve, side / 2, -9.6, xT + 0.75);
    svg += `<polyline fill="none" stroke="${colors[i]}" stroke-width="${i === 1 ? 2.8 : 1.4}" ${i === 1 ? '' : 'stroke-dasharray="5 3"'} points="${pts(o as [number, number][])}"/>\n`;
  });
  cands.forEach((c, i) => { svg += `<rect x="${X(-10)}" y="${Y(-3) + i * 14 - 6}" width="14" height="4" fill="${colors[i]}"/><text x="${X(-10) + 20}" y="${Y(-3) + i * 14}">${c.name}   R_min ${c.curve.minRadius.toFixed(0)} in, peak heading ${(c.curve.peakHeading * 180 / Math.PI).toFixed(0)} deg</text>\n`; });
  svg += '</svg>\n';
  writeFileSync('docs/phase3b-wsB-shapes.svg', svg);
}
