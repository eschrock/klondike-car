/**
 * The resting-weight row (D-58, Eric 2026-10-11): an adult of restLoadLb sitting still or standing on one foot anywhere on the deck, static, full safety factors.
 * The storage lid is engraved DO NOT STEP, is not strengthened and is left out of the check.
 */
import { describe, expect, it } from 'vitest';
import { defaultParams, PARAM_DEFS, resolveParams, type Params } from '../params';
import { buildModel } from '../model';
import { totalMass } from '../model/mass';
import { makeContext } from './context';
import { runChecks } from './index';
import { restEval, restLoadCheck, restMaxLb } from './rest';
import { LIGHT_OF_ID, RIDER_INDEPENDENT } from './rider-sweep';

const mk = (q: Partial<Params> = {}) => {
  const p = resolveParams({ ...defaultParams(), ...q } as Params);
  const parts = buildModel(p, { rider: 'goal', cargo: true });
  return { p, parts, ctx: makeContext(p, parts) };
};
const { p, parts, ctx } = mk();
const row = restLoadCheck(ctx);
const det = (name: RegExp) => row.details!.find((d) => name.test(d.name))!;

describe('the parameter', () => {
  it('restLoadLb is an assumed 250 lb adult, referenced to D-58', () => {
    const d = PARAM_DEFS.restLoadLb;
    expect(d.default).toBe(250);
    expect(d.status).toBe('assumed');
    expect(d.ref).toMatch(/D-58/);
    expect(d.note).toBeTruthy();
  });
});

describe('the row', () => {
  it('is registered in the Structure group with the D-58 reference, static (rider independent), and in the strength light', () => {
    const r = runChecks(p, { includeTruck: false }).find((c) => c.id === 'rest-load')!;
    expect(r).toBeDefined();
    expect(r.group).toBe('Structure');
    expect(r.refs).toContain('D-58');
    expect(RIDER_INDEPENDENT.has('rest-load')).toBe(true);
    expect(LIGHT_OF_ID['rest-load']).toBe('strength');
  });
  it('covers the deck ply (seated, standing), joists, rails, both axle beams, the stubs, the wheels and the front pivot', () => {
    const names = row.details!.map((d) => d.name).join('\n');
    for (const re of [/seated: deck ply bending/, /standing on one foot: deck ply bending/, /deck ply deflection/, /joist bending/, /joist shear/, /rails bending/, /front axle beam bending/, /rear axle beam bending/, /front stub axle/, /rear stub axle/, /wheel: static load/, /thrust disc pressure/, /oak under the disc/, /king beam bending/])
      expect(names, String(re)).toMatch(re);
  });
  it('is static: the load is linear in the adult\'s weight (the sled\'s own weight is a constant part), so the utilization of a pure-adult detail doubles with the weight', () => {
    const a = restEval(ctx, 100).details.find((d) => /standing on one foot: deck ply bending/.test(d.name))!;
    const b = restEval(ctx, 200).details.find((d) => /standing on one foot: deck ply bending/.test(d.name))!;
    expect(b.util / a.util).toBeGreaterThan(1.9); // bending is linear in W up to the (tiny) effect of the strip modulus; no bump factor
    expect(b.util / a.util).toBeLessThan(2.1);
  });
  it('the heavier wheel holds more than a quarter and less than 60% of (sled + adult) (the adult sits to one side over the axle): hand bound on the wheel row', () => {
    const m = totalMass(parts);
    const w = det(/wheel: static load/).value;
    expect(w).toBeGreaterThan((m + p.restLoadLb) / 4);
    expect(w).toBeLessThan((m + p.restLoadLb) * 0.6);
    expect(det(/wheel: static load/).limit).toBe(p.wheelRatingLb);
  });
  it('the maximum resting weight is where the worst detail reaches its limit (bisection), and the row reports it', () => {
    const max = restMaxLb(ctx);
    expect(restEval(ctx, max * 0.999).maxUtil).toBeLessThanOrEqual(1);
    expect(restEval(ctx, max * 1.01).maxUtil).toBeGreaterThan(1);
    expect(det(/^the resting weight the sled holds/).limit).toBeCloseTo(max, 6);
    expect(row.how).toMatch(new RegExp(`holds up to ${Math.round(max)} lb`));
  });
  it('at the defaults (D-58, 3c-5) the sled holds about 335 lb at rest: the extra joist (8.5 in spacing) and span/240 for a standing adult (Eric: a tad looser than the general span/300) clear the 223 lb finding of 3c-4a', () => {
    expect(restMaxLb(ctx)).toBeGreaterThan(310);
    expect(restMaxLb(ctx)).toBeLessThan(360);
    expect(row.status).toBe('pass');
    expect(row.details!.filter((d) => d.util > 1).map((d) => d.name)).toEqual([]);
    expect(det(/deck ply deflection/).util).toBeLessThan(0.8);
    expect(PARAM_DEFS.standDeflectionRatio.default).toBe(240);
    expect(PARAM_DEFS.standDeflectionRatio.status).toBe('assumed');
    expect(PARAM_DEFS.standDeflectionRatio.ref).toMatch(/D-58/);
    expect(PARAM_DEFS.standDeflectionRatio.note).toMatch(/tad looser/);
  });
  it('the 3c-4a finding is reproduced with the old values (10 in joist spacing, span/300): 223 lb, the deck ply deflection is the one failing detail', () => {
    const o = mk({ crossmemberSpacingIn: 10, standDeflectionRatio: 300 });
    expect(restMaxLb(o.ctx)).toBeGreaterThan(215);
    expect(restMaxLb(o.ctx)).toBeLessThan(230);
    const r = restLoadCheck(o.ctx);
    expect(r.status).toBe('fail');
    const worst = r.details!.filter((d) => d.util > 1 && !/^the resting weight the sled holds/.test(d.name)).map((d) => d.name);
    expect(worst).toHaveLength(1);
    expect(worst[0]).toMatch(/deck ply deflection/);
  });
  it('each of the two changes alone helps: the extra joist with the old limit holds 289 lb for under 1 lb more mass; the looser limit alone holds more than the 223 lb finding', () => {
    const a = mk({ crossmemberSpacingIn: 8.5, standDeflectionRatio: 300 });
    expect(restLoadCheck(a.ctx).status).toBe('pass');
    expect(restMaxLb(a.ctx)).toBeGreaterThan(280);
    expect(totalMass(a.parts) - totalMass(mk({ crossmemberSpacingIn: 10 }).parts)).toBeLessThan(1);
    expect(restMaxLb(mk({ crossmemberSpacingIn: 10, standDeflectionRatio: 160 }).ctx)).toBeGreaterThan(250);
    const b = mk({ crossmemberSpacingIn: 10, standDeflectionRatio: 300, deckPlyIn: 0.5 });
    expect(restMaxLb(b.ctx)).toBeGreaterThan(250);
  });
  it('the lid is left out and says so; the row text names DO NOT STEP', () => {
    expect(row.how).toMatch(/STORAGE LID is not checked/);
    expect(row.how).toMatch(/DO NOT STEP/);
    expect(row.details!.some((d) => /lid/i.test(d.name))).toBe(false);
  });
});

describe('the storage lid (DO NOT STEP, D-58)', () => {
  const lid = parts.find((x) => x.id === 'storage-lid')!;
  it('carries the engraving legend on its top face and a note that it is not strengthened', () => {
    expect(lid.legend).toBeDefined();
    expect(lid.legend!.text).toBe('DO NOT STEP');
    expect(lid.legend!.face).toBe('top');
    expect(lid.legend!.process).toMatch(/CNC|engrave/i);
    expect(lid.legend!.letterHeightIn).toBeGreaterThan(1);
    expect(lid.notes).toMatch(/DO NOT STEP/);
    expect(lid.notes).toMatch(/NOT strengthened/);
  });
  it('the legend fits the lid panel (11 letters at 0.75 x the letter height each, plus spaces)', () => {
    const [x] = lid.geometry.type === 'box' ? lid.geometry.size : [0];
    expect(x).toBeGreaterThan(11 * lid.legend!.letterHeightIn * 0.75);
  });
});
