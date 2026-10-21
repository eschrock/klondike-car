/** Figures for the tongue step: the bridle tongue bolted to the front of the swinging front beam, with the rope sleeve across its stem. */
import { computeLayout } from '../../model/layout';
import type { Vec2 } from '../../model/types';
import { flatPattern } from '../flat';
import { frac } from '../svg-util';
import { ACCENT, Fig, fit, mat, MUTED, type FigFn } from './kit';

const f16 = (v: number): string => frac(v, 16);

/** The tongue from above, on the front beam: its T head, taper and stem, the two carriage bolts, the sleeve and the rope (later). */
const tonguePlan: FigFn = (c) => {
  const tg = c.by('bridle-tongue'), beam = c.by('beam-F');
  if (!tg?.stock || !beam?.stock) return null;
  const p = c.p, L = computeLayout(p);
  const len = tg.stock.l, headW = p.tongueHeadWidthIn, headL = p.tongueHeadLenIn, stemW = p.tongueWidthIn;
  const beamT = L.beamF.thick;
  const F = new Fig(760, 440);
  F.heading('The bridle tongue, from above, bolted to the front of the front beam');
  // Frame: x forward (to the right), y across the sled (up the page = left side of the sled). The beam's front face is x = 0.
  const yMax = headW / 2 + 3; // the beam is cut off a little past the head: it runs on to the wheels
  const fr = fit({ minX: -beamT - 1, minY: -yMax, maxX: len + 3, maxY: yMax }, { x: 30, y: 60, w: 420, h: 330 }, 1, 'center');
  const P = (q: Vec2[]): Vec2[] => q.map(fr.at);
  // the beam (built at the front-beam step) and the kingpin
  F.poly(P([[-beamT, -yMax], [0, -yMax], [0, yMax], [-beamT, yMax]]), mat('ghost'));
  for (const y of [-yMax, yMax]) { const a = fr.at([-beamT - 0.4, y]), b = fr.at([0.4, y]); F.path(`M${a[0]},${a[1]} L${(a[0] + b[0]) / 2 - 4},${a[1]} l4,-6 l4,12 l4,-6 L${b[0]},${b[1]}`, { stroke: MUTED, width: 1.2 }); }
  F.circle(fr.at([-beamT / 2, 0]), 5, { fill: '#fff', stroke: MUTED, width: 1.2 });
  // the tongue outline: head, taper, stem
  const hw = headW / 2, sw = stemW / 2;
  // The real outline (its flat pattern: u from the rear end, v across), centered on the sled's centerline; a plain T and taper if it has none.
  const fp = flatPattern(tg);
  const outline: Vec2[] = fp && Math.abs(fp.widthIn - len) < 0.01
    ? fp.outer.map(([u, v]): Vec2 => [u, v - fp.heightIn / 2])
    : [[0, -hw], [headL, -hw], [2 * headL, -sw], [len, -sw], [len, sw], [2 * headL, sw], [headL, hw], [0, hw]];
  F.poly(P(outline), mat('oak', { stroke: ACCENT, width: 2 }));
  // the carriage bolts: fore-aft through the head and the whole beam
  const boltY = boltOffsets(c) ?? [];
  for (const y of boltY) F.bolt(fr.at([headL, y]), fr.at([-beamT, y]));
  // the sleeve across the stem
  const sleeveX = sleeveFromRear(c) ?? len - 1.5;
  const dia = p.tongueHoleDiaIn;
  F.rect(fr.at([sleeveX - dia / 2, sw + 0.15])[0], fr.at([0, sw + 0.15])[1], dia * fr.kx, (stemW + 0.3) * fr.ky, mat('steel', { fill: '#d9a35b', stroke: '#8a5a1f' }));
  // the rope, later
  const ropeY = fr.at([sleeveX, 0])[1];
  F.path(`M${fr.at([sleeveX, 0])[0]},${ropeY} C${fr.at([sleeveX + 2, 0])[0]},${ropeY - 10} ${fr.at([len + 2, 0])[0]},${ropeY - 30} ${fr.at([len + 3.6, 0])[0]},${ropeY - 60}`, { stroke: MUTED, width: 2, dash: '6 4' });
  // labels
  F.label(fr.at([headL * 0.5, hw * 0.55]), [470, 96], [`T head: ${f16(headW)} wide, ${f16(headL)} long, its rear face`, 'flat on the beam; the bolt heads sit on', 'its square front shoulders'], { anchor: 'start' });
  // a point just inside the lower taper edge, halfway along it (the outline's own edge where it has one)
  const taperY = (u: number): number => { const e = outline.filter(([x, y]) => y < 0 && x > headL + 0.1 && x < 2 * headL + 0.1).sort((a, b) => a[0] - b[0]); if (e.length < 2) return -(hw + sw) / 2; const [a, b] = [e[0], e[e.length - 1]]; return a[1] + ((b[1] - a[1]) * (u - a[0])) / ((b[0] - a[0]) || 1); };
  F.label(fr.at([headL * 1.5, taperY(headL * 1.5) + 0.12]), [470, 352], [`a ${f16(headL)} taper, then the`, `${f16(stemW)} stem to the tip`], { anchor: 'start' });
  if (boltY.length) F.label(fr.at([headL - 0.4, Math.min(...boltY)]), [470, 268], ['2 carriage bolts, fore-aft through', 'the head and the whole beam;', 'nylock nuts on the beam\'s rear face'], { anchor: 'start' });
  F.label(fr.at([sleeveX, sw + 0.3]), [470, 184], [`bronze sleeve in a ${f16(dia)} hole`, 'across the stem (the rope', 'runs through it, later)'], { anchor: 'start' });
  F.label(fr.at([-beamT / 2, -yMax + 1]), [30, 404], 'front axle beam (cut short here); it swings on the kingpin (circle)', { anchor: 'start' });
  F.text([fr.at([len + 3, 0])[0], 72], 'forward, the pull →', { size: 12, color: MUTED, anchor: 'end' });
  F.legend(['oak', 'ghost', 'steel'], [16, 432]);
  F.note();
  return {
    id: 'tongue-plan',
    title: 'The tongue on the front beam',
    caption: `Seen from above. The tongue is a flat oak T, ${f16(tg.stock.t)} thick: its wide head sits against the front face of the front axle beam, and two carriage bolts run straight back through the head and the whole beam. The bridle rope goes through the bronze sleeve near the tip, so the pull steers the front beam about its kingpin. The tongue stays on for good and is finished in place.`,
    svg: F.svg('The bridle tongue from above, bolted to the front axle beam'),
  };
};

/** The bolt positions across the head (y, in from the centerline), from the tongue drawing's bolt holes ("1" and 5" from the right edge"). */
function boltOffsets(c: Parameters<FigFn>[0]): number[] | null {
  const sh = c.drawings().find((d) => d.partId === 'bridle-tongue' || d.partIds?.includes('bridle-tongue'));
  const hole = sh?.features.find((q) => q.kind === 'hole' && (q.to ?? []).includes('beam-F'));
  const m = hole && /([\d\-/]+)" and ([\d\-/]+)" from the right edge/.exec(hole.positions?.[0] ?? '');
  const w = c.by('bridle-tongue')?.stock?.w;
  if (!m || !w) return null;
  return [m[1], m[2]].map((t) => w / 2 - fromFrac(t));
}

/** The sleeve hole's distance from the tongue's rear end, from the drawing ("9" from the REAR end"). */
function sleeveFromRear(c: Parameters<FigFn>[0]): number | null {
  const sh = c.drawings().find((d) => d.partId === 'bridle-tongue' || d.partIds?.includes('bridle-tongue'));
  const hole = sh?.features.find((q) => q.kind === 'hole' && (q.to ?? []).includes('bridle-sleeve'));
  const m = hole && /([\d\-/]+)" from the REAR end/i.exec(hole.text);
  return m ? fromFrac(m[1]) : null;
}

/** "1-3/4" → 1.75. */
function fromFrac(t: string): number {
  const m = /^(\d+)(?:-(\d+)\/(\d+))?$|^(\d+)\/(\d+)$/.exec(t.trim());
  if (!m) return Number(t);
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

export const TONGUE_FIGURES: Record<string, FigFn[]> = {
  tongue: [tonguePlan],
};
