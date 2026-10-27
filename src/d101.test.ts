/**
 * D-101 (Eric's bend test, 2026-10-25): a dry 3/8 in strip took the bow radius but felt stiff, so the rail is three 1/4 in strips. Each block pins one consequence: the rail part, the shared
 * 4/4 resaw pool (a 1/4 in strip is 3/8 in rough, the band strips' rough), the spares for a full test rail, the per-board lane layout, and the build text that follows the ply count.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams } from './params';
import { buildModel } from './model';
import { totalMass } from './model/mass';
import { cutList, resawSparesNeeded } from './build/cutlist';
import { assemblySteps } from './build/assembly';
import { formDrawings } from './build/forms';
import { verifyChecklist } from './build/verify';
import { bom } from './build/bom';
import { glueJointEstimates } from './build/finishing';
import { PRE_D101 } from './test-fixtures';

const p = defaultParams();
const parts = buildModel(p);
const cl = cutList(parts, p);
const steps = assemblySteps(parts, p);
const text = (id: string): string => steps.find((s) => s.id === id)!.instructions.join(' ');

describe('D-101: the rail is three 1/4 in strips', () => {
  it('builds the rail from railPlies strips of railThicknessIn / railPlies', () => {
    expect(p.railPlies).toBe(3);
    for (const tag of ['L', 'R']) {
      const r = parts.find((x) => x.id === `rail-${tag}`)!;
      expect(r.plies).toBe(3);
      expect(r.stock!.t).toBeCloseTo(0.25, 9);
      expect(r.notes).toMatch(/cold-bent flat in 3 plies/);
      expect(r.notes).toMatch(/strips, 3 per rail/);
    }
  });

  it('keeps the rail itself and the empty mass: the same 3/4 in bar, only one more glue line', () => {
    const old = buildModel({ ...p, ...PRE_D101 });
    expect(totalMass(parts)).toBeCloseTo(totalMass(old), 6);
  });

  it('resaws the rail and band strips from one 4/4 pool, which leaves a full test rail and a band test strip', () => {
    const railRow = cl.strips.find((r) => r.partNo === 'rail')!;
    expect(railRow.rough.t).toBeCloseTo(0.375, 9);
    expect(cl.resaw).toHaveLength(1);
    const pool = cl.resaw[0];
    expect(pool.board).toBe('4/4');
    expect(pool.strips).toBe(6 + 8);
    expect(pool.sparesNeeded).toBe(p.railPlies + 1);
    expect(pool.spares).toBeGreaterThanOrEqual(pool.sparesNeeded);
    expect(railRow.resawFrom).toBe('4/4');
  });

  it('asks a two-ply pool for two spares and a band pool for one (the plans as before D-101)', () => {
    const q = { ...p, ...PRE_D101 };
    const qcl = cutList(buildModel(q), q);
    expect(qcl.resaw).toHaveLength(2);
    expect(qcl.resaw.map((r) => r.sparesNeeded).sort()).toEqual([1, 2]);
    expect(resawSparesNeeded([])).toBe(1);
  });

  it('lays the lanes out board by board from the real packing: every board holds its lanes, and the lanes add up to the lanes to rip', () => {
    const pool = cl.resaw[0];
    expect(pool.boardLaneWidthsIn).toHaveLength(pool.boards);
    expect(pool.boardLaneWidthsIn.flat()).toHaveLength(pool.ripLanes);
    for (const ws of pool.boardLaneWidthsIn) expect(ws.reduce((a, w) => a + w, 0) + (ws.length - 1) * p.resawKerfIn).toBeLessThanOrEqual(pool.boardWidthIn + 1e-9);
    for (const ws of pool.boardLaneWidthsIn) expect(ws.reduce((a, w) => a + w, 0) + (ws.length - 1) * p.resawKerfIn + p.resawEdgeAllowanceIn).toBeLessThanOrEqual(pool.boardWidthIn + 1e-9); // room to joint an edge
    expect(pool.boardNeedIn).toBeLessThanOrEqual(pool.boardWidthIn + 1e-9);
    const mill = text('mill');
    expect(mill).toContain(`Each board must be at least`);
    expect(pool.boardLanes.flat().sort((a, b) => a - b)).toEqual([...Array(pool.ripLanes)].map((_, i) => i)); // every lane on exactly one board
    expect(mill).toMatch(/Lay the lanes out by board: board 1, lanes \d/);
    expect(mill).not.toMatch(/must still be (1[0-9]|9)-/); // never wider than the 9 in board it names
  });

  it('writes one resaw for the shared pool, not a band resaw and a rail resaw that repeat it', () => {
    const mill = text('mill');
    expect(mill).toMatch(/Resaw the bending strips: 6 for .* and 8 for the chine and gunwale bands, all from the same boards/);
    expect(mill).not.toMatch(/Resaw the rail strips/);
    expect(mill).not.toMatch(/Resaw the band strips/);
    expect(mill).toContain(`${cl.resaw[0].stripSlots} strips for the 14 needed`);
  });

  it('glues the spring-back test rail from all three plies, and the dry test strip comes from the shared spares', () => {
    const form = formDrawings(parts, p).find((d) => d.id === 'rail-form')!;
    const build = form.build.map((s) => [s.step, ...(s.sub ?? [])].join(' ')).join(' ');
    expect(build).toContain('Glue 3 spare rail strips on the form as a test rail, a full rail\'s worth');
    expect(build).not.toMatch(/With only \d plies/);
    expect(build).toMatch(/every mating face of the 3 strips \(1\/4" × 3-3\/8", both faces of the middle one\)/);
    expect(form.materials.join(' ')).toContain('3 spare rail strips');
    const rf = text('rail-form');
    expect(rf).toContain(`${cl.resaw[0].spares} spare strips at the rail width`);
    expect(rf).toMatch(/Three of them, this strip included, go into the test rail next/);
    expect(rf).toMatch(/4 thinner plies instead of 3/);
    expect(rf).not.toMatch(/8\/4 offcut/);
  });

  it('names the ply count in the bend test and the glue step', () => {
    const bend = verifyChecklist(parts, p).find((v) => v.id === 'strip-bend')!;
    expect(bend.title).toMatch(/in 3 plies$/);
    expect(bend.whatToDo).toMatch(/rail and band strips, from the same boards: 4\/4/);
    expect(bend.whatToDo).toMatch(/The rail is 3 plies of 1\/4"/);
    expect(text('rail-glue')).toMatch(/Glue 3 strips per rail on the rail form/);
  });

  it('counts the deck-to-rail glue contact over the whole rail top, all its plies (not one strip)', () => {
    const c = glueJointEstimates(parts).find((g) => g.a === 'deck' && g.b === 'rail-L')!;
    const r = parts.find((x) => x.id === 'rail-L')!;
    expect(c.contactIn2).toBeGreaterThan(r.stock!.t * r.stock!.l * 1.01); // more than one strip's edge
    const q = { ...p, ...PRE_D101 };
    expect(glueJointEstimates(buildModel(q)).find((g) => g.a === 'deck' && g.b === 'rail-L')!.contactIn2).toBeCloseTo(c.contactIn2, 6); // the same rail, the same contact
  });

  it('drops the 8/4 rail board: the lumber costs less than the two-ply plan', () => {
    const q = { ...p, ...PRE_D101 };
    const lumber = (b: ReturnType<typeof bom>): number => b.sections.find((x) => x.id === 'lumber')!.subtotalUsd;
    expect(lumber(bom(parts, p))).toBeLessThan(lumber(bom(buildModel(q), q)));
  });
});
