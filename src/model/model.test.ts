import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, RIDER_FOOT_Y_FRAC, RIDER_LEG_Y_FRAC, defaultParams, derived, resolveParams, steerStopPlan, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from './index';
import { computeLayout } from './layout';
import { obbOverlap, partOBB, worldAABB } from './bounds';
import { centerOfGravity, totalMass } from './mass';
import type { Part, PartGroup } from './types';
import { phase1Params } from '../test-baselines';

const TOL = 0.05;
const defaults = defaultParams();
const phase1 = phase1Params(); // Phase 1 configuration, for tests that need a tongue / unsleeved ½" pin / the old hand numbers

interface Allow {
  a: RegExp;
  b: RegExp;
  why: string;
}
/** Intended contacts (kept short; real clashes are fixed in the geometry instead). */
const ALLOW: Allow[] = [
  { a: /^axle-/, b: /^(wheel-|beam-)/, why: 'axle passes through the hub bore and lies in a groove in the beam (D-10, D-15)' },
  { a: /^beam-/, b: /^wheel-/, why: 'tire OBB is a conservative box; the beam ends sit inside the rim, 1/8" short of the hub face' },
  { a: /^brake-shoe-/, b: /^wheel-/, why: 'shoe presses on the tread; the tire OBB corner is not tire' },
  { a: /^brake-/, b: /^brake-/, why: 'pins, bolts, hubs and the shaft pass through bored holes in the arms, bushings, blocks and pads; the pawl sits in a tooth valley (D-38, D-39). Moving-part clearances are swept in src/analysis/brake.test.ts' },
  { a: /^(transom-rear|side-cabin-[LR]-web)$/, b: /^brake-(lever|pawl|quadrant)/, why: 'flared gunwale: the transom / web OBBs are conservative boxes over the flared outline; the lever leans out parallel to the web and stays 1/2" clear of it, and the pawl sits on the plate outside the flare (D-38, D-39)' },
  { a: /^handle-(socket|post|pin)-/, b: /^handle-(socket|post|pin)-/, why: 'the post is a slip fit in the socket tube and the clevis pin passes through both (D-9, D-39)' },
  { a: /^(rail-cabin|girder-cabin)-/, b: /^brake-(bushing|lever-pin)/, why: 'the shaft bushing and the lever pivot bolt pass through the rail band (D-38)' },
  { a: /^(rail-cabin|girder-cabin)-/, b: /^(beam-R|axle-R|brake-shaft)/, why: 'rails/girders are notched or drilled for the rear axle and brake-shaft journals (D-15); joinery is Phase 3' },
  { a: /^kingpin$/, b: /^kingpin-crossbar$/, why: 'the kingpin passes up through the crossbar bore (D-12)' },
  { a: /^kingpin-crossbar$/, b: /^bolster-(fore|aft)$/, why: 'the crossbar ends are let into notches in the bolster rails (D-12)' },
  { a: /^kingpin-sleeve-/, b: /^(kingpin|beam-F|turntable|kingpin-crossbar)$/, why: 'the steel sleeve is a tube pressed into the beam / crossbar bore around the pin (drawn solid)' },
  { a: /^kingpin$/, b: /^(beam-F|turntable)$/, why: 'kingpin passes through the solid beam and the turntable center (D-25); it leads the axle rod, so axle-F is NOT allowed' },
  { a: /^(kingpin|kingpin-sleeve-beam)$/, b: /^kp-(carrier|under|bar-plate)$/, why: 'the pin and its sleeve pass through the holes of the kingpin steel plates (D-35)' },
  { a: /^steer-stop-(arm|riser)-[LR]$/, b: /^turntable$/, why: 'the stop arm and its riser stand inside the turntable center hole (D-35); the turntable is drawn as a solid block' },
  { a: /^side-bearer-[LR]$/, b: /^beam-F$/, why: 'the bearer block is housed in a mortise in the beam top (M5); only the mortise volume overlaps' },
  { a: /^beam-F$/, b: /^bridle-[LR]$/, why: 'the rope-bridle legs are tied around the front beam ends (D-14, D-27); the drawn rope bar ends embed ≲ ¼" in the beam' },
  { a: /^bridle-L$/, b: /^bridle-R$/, why: 'the two rope legs meet at the ring ahead of the cart (D-14, D-27); the drawn bar ends overlap at the knot' },
  { a: /^stop-block-/, b: /^(bolster-(fore|aft)|kingpin-crossbar|kp-bar-plate)$/, why: 'the stop block is a wedge glued into the corner between the bolster rail and the crossbar (D-31); its OBB is the rectangle behind the stop face and over-covers the wedge' },
  { a: /^nose-access-panel$/, b: /^deck-nose$/, why: 'the access panel is the cutout of the nose deck (D-34); workstream B cuts the opening, until then both parts exist' },
  { a: /^clamp-F[LR]1$/, b: /^(beam-F|axle-F[LR]?|clamp-F[LR]2)$/, why: 'the front square U-bolt wraps the beam (legs down its faces, bridge over the axle rod) to the plate under it (D-34); its OBB is the box around the U' },
  { a: /^eyebolt-[LR]$/, b: /^(beam-F|axle-F[LR]?|bridle-[LR])$/, why: 'the eye bolt shank passes through a hole in the front beam; the rope leg is tied to its eye (D-33); the axle rod is 6 thousandths inside the shank OBB' },
  { a: /^wheel-F[LR]$/, b: /^bridle-[LR]$/, why: 'each rope leg is tied at the axle end, which is inside the wheel; the tire OBB is a conservative box, so wide tires / large wheels show a ≲ 0.08" corner clash (reported, see the Phase 2 test notes)' },
  { a: /^axle-R$/, b: /^brake-drum-/, why: 'wooden drum is bored onto the live rear axle (D-13)' },
  { a: /^(lantern-mount|flag-mount)$/, b: /^transom-front$/, why: 'printed inverted-U clip straddles the transom top; the OBB of the U profile is its full bounding box (D-41)' },
  { a: /^seat-wedge-[LR]$/, b: /^seat-(back-(stile|pad)|knob)-?[LR]?$/, why: 'oak wedge/post is a trapezoid extrusion whose sloped face is the stile\'s rear face; its OBB is the bounding box, which reaches into the stile, the knob and the pad that lie in front of that face (D-40)' },
  { a: /^deck-(cabin|nose)$/, b: /^(side-(cabin|nose)-[LR]-(chine|board)|transom-(rear|front))$/, why: 'the deck edge sits in the chine rabbets and the transom dados (D-35); hull.test.ts pins the capture depth' },
  { a: /^side-(cabin|nose)-[LR]-web$/, b: /^(side-(cabin|nose)-[LR]-(chine|gunwale)|transom-(rear|front))$/, why: 'the side panel enters the chine and gunwale grooves and the transom stopped dados (D-35); hull.test.ts pins the groove depth and the dado depth' },
  { a: /^transom-rear$/, b: /^brake-(lever|quadrant)$/, why: 'with gunwale flare the transom outline widens toward the top (it must meet the flared gunwale); its OBB is the full bounding box, which reaches the lever that stands outside the unflared lower hull (D-35, D-38)' },
  { a: /^scupper-/, b: /^side-(cabin|nose)-[LR]-(chine|board)$/, why: 'the 3/8" stainless drain nipple passes through its hole in the chine / side board at deck level (M7, D-43)' },
  { a: /^prow$/, b: /^prow-socket$/, why: 'the prow leg is a slip fit in the slot of the socket block; the sweep OBB is its full bounding box, which covers the socket (D-43)' },
  { a: /^guard-[LR]$/, b: /^side-nose-[LR]-gunwale$/, why: 'the finger guard is a joggled L whose OBB is its full bounding box; the strap lies on the gunwale face and the leg in the web recess (D-37)' },
];
const matches = (r: Allow, a: Part, b: Part) => (r.a.test(a.id) && r.b.test(b.id)) || (r.a.test(b.id) && r.b.test(a.id));

const SOLID: PartGroup[] = ['frame', 'body', 'running-gear', 'steering', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];

function overlaps(parts: Part[]) {
  const solid = parts.filter((p) => !p.payload && SOLID.includes(p.group));
  const obbs = solid.map(partOBB);
  const bad: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const o = obbOverlap(obbs[i], obbs[j]);
      if (o > TOL && !ALLOW.some((r) => matches(r, solid[i], solid[j]))) bad.push(`${solid[i].id} x ${solid[j].id}: ${o.toFixed(3)}"`);
    }
  }
  return bad;
}

describe('buildModel structure', () => {
  const parts = buildModel(defaults);
  it('defaults still validate clean', () => expect(validateParams(defaults)).toEqual([]));
  it('ids are unique and transforms are finite', () => {
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
    for (const p of parts) {
      expect(p.transform).toHaveLength(16);
      expect(p.transform.every(Number.isFinite), p.id).toBe(true);
      expect(p.step, p.id).toBeGreaterThan(0);
      expect(p.explode, p.id).toBeDefined();
      expect(p.fab, p.id).toBeDefined();
      if (p.kind === 'lumber' || p.kind === 'sheet') expect(p.stock, p.id).toBeDefined();
    }
  });
  it('has 4 wheels with the required rigid bodies', () => {
    const w = parts.filter((p) => p.geometry.type === 'wheel');
    expect(w.map((p) => p.body).sort()).toEqual(['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR']);
  });
  it('clamps the steer angle and rotates every steer-body part about the kingpin', () => {
    const p = { ...defaults, steerLockDeg: 20 };
    const s20 = Math.sin((20 * Math.PI) / 180);
    const big = buildModel(p, { steerDeg: 50 });
    const fl = big.find((x) => x.id === 'wheel-FL')!;
    expect(fl.transform[0]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 6);
    expect(fl.transform[1]).toBeCloseTo(s20, 6);
    // The steering-stop posts are pre-rotated by ∓lock so they land axis-aligned (flat on the bolster face) at lock.
    // The rope-bridle legs carry their own fixed yaw (they slope in to the ring), so they are checked by the CHANGE in yaw below.
    for (const part of big.filter((x) => x.body === 'steer' && !x.id.startsWith('steer-stop-') && !x.id.startsWith('bridle-'))) expect(part.transform[1], part.id).toBeCloseTo(s20, 6);
    expect(big.filter((x) => x.body === 'steer').length).toBeGreaterThan(8);
    const yaw = (x: Part) => Math.atan2(x.transform[1], x.transform[0]);
    const neutral = buildModel(p, { steerDeg: 0 });
    const legs = big.filter((x) => x.id.startsWith('bridle-'));
    expect(legs.length).toBe(2); // rope bridle at the default drawbar
    for (const leg of legs) expect(yaw(leg) - yaw(neutral.find((x) => x.id === leg.id)!), leg.id).toBeCloseTo((20 * Math.PI) / 180, 6);
    const neg = buildModel(p, { steerDeg: -50 }).find((x) => x.id === 'wheel-FL')!;
    expect(neg.transform[1]).toBeCloseTo(-s20, 6);
  });
  it('kingpin stays at (WB + lead, 0) at any steer angle and clears the front axle rod (D-25)', () => {
    const kx = defaults.wheelbaseIn + defaults.kingpinLeadIn;
    for (const deg of [0, 40, -40]) {
      const m = buildModel(defaults, { steerDeg: deg });
      const k = m.find((x) => x.id === 'kingpin')!;
      expect(k.transform[12]).toBeCloseTo(kx, 6);
      expect(k.transform[13]).toBeCloseTo(0, 6);
      const turntable = m.find((x) => x.id === 'turntable')!;
      expect(turntable.transform[12]).toBeCloseTo(kx, 6);
      expect(turntable.transform[13]).toBeCloseTo(0, 6);
      // The kingpin and the axle rod never intersect: center distance > kingpin radius + rod radius.
      const axle = m.find((x) => x.id === 'axle-F')!;
      const dist = Math.hypot(axle.transform[12] - k.transform[12], axle.transform[13] - k.transform[13]);
      expect(dist).toBeGreaterThan(defaults.kingpinDiameterIn / 2 + defaults.axleDiameterIn / 2);
      expect(obbOverlap(partOBB(k), partOBB(axle))).toBeLessThanOrEqual(0);
    }
    // At neutral the axle rod stays at x = WB.
    expect(buildModel(defaults).find((x) => x.id === 'axle-F')!.transform[12]).toBeCloseTo(defaults.wheelbaseIn, 6);
  });
  it('kingpin runs through solid beam wood (beam spans axle and kingpin)', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const k = worldAABB(m.find((x) => x.id === 'kingpin')!);
    expect(k.min[0]).toBeGreaterThanOrEqual(beam.min[0]);
    expect(k.max[0]).toBeLessThanOrEqual(beam.max[0]);
  });
  it('side bearers are real blocks: housed in the beam, UHMW-faced, 1/16" under the bolster rail (M5, D-12)', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const rod = worldAABB(m.find((x) => x.id === 'axle-F')!);
    const plate = worldAABB(m.find((x) => x.id === 'turntable')!);
    for (const tag of ['L', 'R']) {
      const blockPart = m.find((x) => x.id === `side-bearer-${tag}`)!;
      const sb = worldAABB(blockPart);
      const wear = worldAABB(m.find((x) => x.id === `side-bearer-wear-${tag}`)!);
      const end = worldAABB(m.find((x) => x.id === `bolster-end-${tag}`)!);
      expect(blockPart.body).toBe('steer');
      // Plan size: at least 1.5" square; real depth: housed into the beam, well beyond the ~3/8" stack.
      expect(sb.max[0] - sb.min[0]).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(sb.max[1] - sb.min[1]).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(beam.max[2] - sb.min[2]).toBeCloseTo(defaults.sideBearerEmbedIn, 6);
      expect(sb.max[2] - sb.min[2]).toBeGreaterThan(0.75);
      // UHMW strip on top; running clearance from the strip to the bolster rail underside (the chassis-side bearer face).
      expect(wear.min[2]).toBeCloseTo(sb.max[2], 6);
      expect(wear.max[2] - wear.min[2]).toBeCloseTo(defaults.sideBearerWearIn, 6);
      expect(end.min[2] - wear.max[2]).toBeCloseTo(defaults.sideBearerClearanceIn, 6);
      expect(m.find((x) => x.id === `side-bearer-wear-${tag}`)!.material).toMatch(/UHMW/);
      // Outside the turntable plate, under the bolster end rail, clear of the axle rod's groove.
      expect(Math.abs(sb.min[1])).toBeGreaterThanOrEqual(defaults.turntableSizeIn / 2);
      expect(sb.min[1] >= end.min[1] - 1e-9 && sb.max[1] <= end.max[1] + 1e-9).toBe(true);
      expect(sb.min[0]).toBeGreaterThan(rod.max[0] - 1e-9);
      expect(sb.max[0]).toBeLessThanOrEqual(beam.max[0] + 1e-9);
      expect(plate.max[2]).toBeCloseTo(end.min[2], 6);
    }
  });
  it('front beam keeps real wood around the rod groove and the kingpin hole (H2, D-25)', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const rod = worldAABB(m.find((x) => x.id === 'axle-F')!);
    const kp = worldAABB(m.find((x) => x.id === 'kingpin')!);
    // The wood is measured from the BORE: the steel sleeve OD when there is one (D-12), else the pin.
    const boreD = Math.max(defaults.kingpinDiameterIn, defaults.kingpinSleeveOdIn);
    const boreFront = kp.max[0] + (boreD - defaults.kingpinDiameterIn) / 2;
    expect(rod.min[0] - beam.min[0]).toBeGreaterThanOrEqual(defaults.beamLigamentMinIn - 1e-9);
    expect(beam.max[0] - boreFront).toBeGreaterThanOrEqual(defaults.beamLigamentMinIn - 1e-9);
    // The beam is centerd on the rod + kingpin pair, so the two ligaments are equal.
    expect(rod.min[0] - beam.min[0]).toBeCloseTo(beam.max[0] - boreFront, 6);
    const rear = worldAABB(m.find((x) => x.id === 'beam-R')!);
    const rodR = worldAABB(m.find((x) => x.id === 'axle-R')!);
    expect(rodR.min[0] - rear.min[0]).toBeGreaterThanOrEqual(defaults.beamLigamentMinIn - 1e-9);
    // Validator: a front beam narrower than lead + rod + kingpin radii + 2 ligaments is rejected, the minimum is accepted.
    const need = defaults.kingpinLeadIn + defaults.axleDiameterIn / 2 + boreD / 2 + 2 * defaults.beamLigamentMinIn;
    const ligErr = (t: number) => errorsOf({ ...defaults, frontAxleBeamThicknessIn: t }).some((i) => i.message.startsWith('Front axle beam is'));
    expect(ligErr(need - 0.125)).toBe(true);
    expect(ligErr(need)).toBe(false);
    // ...and the old 2.5" beam (the round-2 H2 defect) is rejected.
    expect(errorsOf({ ...defaults, frontAxleBeamThicknessIn: 2.5 }).length).toBeGreaterThan(0);
  });
  it('REAR U-bolt clamp plates straddle the rod: legs at rod x ± (rod radius + leg gap) (H2)', () => {
    const m = buildModel(defaults);
    for (const tag of ['L', 'R']) {
      const a = worldAABB(m.find((x) => x.id === `clamp-R${tag}1`)!);
      const b = worldAABB(m.find((x) => x.id === `clamp-R${tag}2`)!);
      const off = defaults.axleDiameterIn / 2 + defaults.clampLegGapIn;
      expect((a.min[0] + a.max[0]) / 2).toBeCloseTo(off, 6);
      expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(-off, 6);
    }
  });
  it('FRONT U-bolt (M8, D-34): the bridge crosses the rod on the beam top, the legs run down around the beam faces to a plate under it', () => {
    const m = buildModel(defaults);
    const beam = worldAABB(m.find((x) => x.id === 'beam-F')!);
    const rod = worldAABB(m.find((x) => x.id === 'axle-F')!);
    const rr = defaults.uboltRodDiameterIn / 2;
    for (const tag of ['L', 'R']) {
      const u = m.find((x) => x.id === `clamp-F${tag}1`)!;
      const plate = m.find((x) => x.id === `clamp-F${tag}2`)!;
      const ub = worldAABB(u), pb = worldAABB(plate);
      expect(u.geometry.type).toBe('mesh');
      expect(u.body).toBe('steer');
      // legs outside the beam faces, bridge above the rod top, plate directly under the beam
      expect(ub.min[0]).toBeCloseTo(beam.min[0] - defaults.uboltBeamClearIn - 2 * rr, 2);
      expect(ub.max[0]).toBeCloseTo(beam.max[0] + defaults.uboltBeamClearIn + 2 * rr, 2);
      expect(ub.max[2]).toBeCloseTo(rod.max[2] + 2 * rr, 2);
      expect(ub.min[2]).toBeLessThan(pb.min[2]); // the nut ends hang below the plate
      expect(pb.max[2]).toBeCloseTo(beam.min[2], 6);
      expect(pb.max[2] - pb.min[2]).toBeCloseTo(defaults.clampPlateThickIn, 6);
      expect(pb.max[0] - pb.min[0]).toBeGreaterThan(beam.max[0] - beam.min[0]); // spans the legs
      expect(pb.max[1] - pb.min[1]).toBeCloseTo(defaults.clampPlateWidthIn, 6);
      expect(u.sourcing?.vendor).toMatch(/U-bolt/);
      expect(u.joints!.some((j) => j.type === 'bolt' && j.to === 'beam-F')).toBe(true);
      expect(u.massLb).toBeGreaterThan(0.3);
      expect(u.massLb).toBeLessThan(0.8);
    }
  });
});

describe('overlaps', () => {
  const lock = defaults.steerLockDeg;
  it.each([0, lock, -lock])('no unintended overlaps at steer %d', (deg) => {
    expect(overlaps(buildModel(defaults, { steerDeg: deg }))).toEqual([]);
  });
  it('also clean in the removed (transport) configuration', () => {
    expect(overlaps(buildModel(defaults, { removed: true }))).toEqual([]);
  });
  it('front tires clear the nose and cabin body at full lock', () => {
    for (const deg of [lock, -lock]) {
      const parts = buildModel(defaults, { steerDeg: deg });
      const tires = parts.filter((p) => p.id === 'wheel-FL' || p.id === 'wheel-FR');
      const body = parts.filter((p) => !p.payload && /^(side-|shoulder|deck-|transom|rail-|joist-|bolster|foot-stop|storage|seat-|sign|reflector)/.test(p.id));
      expect(body.length).toBeGreaterThan(10);
      for (const t of tires) for (const b of body) {
        expect(obbOverlap(partOBB(t), partOBB(b)), `${t.id} vs ${b.id} @${deg}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

/** Documented empty masses at defaults (heavy design, D-21), lb. Printed by the breakdown test below. */
// Phase 2 defaults (D-27): 126.9 lb = the Phase 1 123.9 lb (122.1 + the kingpin crossbar, D-12) + 3.0 lb net. Part-by-part from the
// Phase 1 → Phase 2 change (each checked against a scaling hand calc, e.g. beam-F 7.93 × 4/3.5 = 9.06 lb ≈ 9.05 with the bore removed;
// pin 0.27 lb × (0.75/0.5)² = 0.60 ≈ 0.58 with its shorter length):
//   front beam 3.5" → 4" thick +1.1; ¾" pin +0.3; two steel sleeves (1.25" OD tube around the ¾" pin, ≈ 2.5" and 1.6" long) +0.95;
//   12 mm deck ply (+33%) on a shorter cabin +2.2, one more cabin joist and a nose joist at 8" spacing +1.4;
//   oak tongue + straight bridle −2.6, two rope legs +1.0; shorter 44" cabin: rails, chines, gunwales, signs −1.0 in all.
// Phase 3 workstream D (D-40, D-41): seat 5.9 → 8.2 lb (+2.3: vinyl covers on the cushion and back pad +0.8, two side grab handles +1.1,
//   two oak wedges + two knobs +0.4); storage 8.1 → 9.9 lb (+1.8: lid frame wide enough to capture the ply panel, two lid battens,
//   gaskets, hinges, latches, drains, backer cleats); six lash points (hardware) +0.6; lighting 0.7 → 1.2 lb (headlight, flag clip, plates).
// Phase 3 workstream B (D-35…D-37): body 29.7 → 30.2 lb (+0.5) and frame unchanged, removable 4.7 → 4.8 lb (+0.1). Decks +0.5 (edges run 1/4"
//   into the chine rabbets and transom dados, plus oak banding on the step edges), side webs +0.5 (taller by the groove depth each end, banded
//   shoulder end), chines/gunwales −1.1 (grooves, rabbets, 1/2" shorter between the full-width transoms), shoulder panels +0.1 (banding),
//   transoms +0.05, prow −0.25 (1/8" laminate sweep replaces the extruded block), two printed finger guards +0.7, signs +0.1 (banding).
// Phase 3 workstream A (D-31…D-34): steering 11.6 → 13.8 lb (+2.3: two steel-faced oak stop dogs 0.41 + four steel face plates 0.67 + four oak
//   stop blocks 0.70 replace two 0.07 lb oak posts (+1.8 net), two forged eye bolts +0.5, the access panel +0.13 (also still in the deck until B
//   cuts the opening)); running gear 49.7 → 51.0 lb (+1.3: the front U-bolt wraps the beam to a steel plate under it: 2 × (0.47 + 0.90) lb replace
//   4 × 0.35 lb). Total +3.6 lb.
// Phase 3 workstream C (D-38, D-39): brake 3.5 → 12.2 lb (+8.7) and removable −0.2 (shorter uprights, +pins). The old brake was a ½" shaft, a
//   lever and two shoe blocks; now: ¾" ground cross shaft 39.5" long 4.9 (was 2.0), four shoe arms + four keyed hubs 1.1, two oak pads 0.6,
//   two pad pins 0.4, oak lever + pivot block + bearing pad 1.2, thick keyed crank 0.6, link rod and two clevises 0.2, two bronze bushings and a
//   sleeve 0.25, return spring 0.1, ratchet quadrant + bracket + pawl + spring 0.45, two steel-tube handle sockets 2.3 (new, stay on the cart).
// Phase 3 round 2, brake & metal (F3): brake 12.3 → 11.0 lb (−1.3): aluminum 6061 handle sockets −1.5 (0.40 lb each, was 1.17 steel), pads 2.5" wide
//   instead of 3" (shorter arm overhang, shorter shaft 38.1" vs 39.1": −0.35), purchased shaft collars instead of solid hubs −0.1, lining +0.1,
//   shaft caps and acorn nuts +0.05, crank boss widened to 1.5" +0.5.
// Phase 3 integration (all four workstreams landed): 144.7 → 147.8 lb (+3.1), group by group:
//   body 30.2 → 29.7 (-0.5): the two 8" x 1.5" x 1" `grab-L/R` oak blocks (about 0.27 lb each) are gone (-0.75 with the storage-volume change below), because D's real `seat-grip-*` handles replace them
//     (the blocks sat on the gunwale and could not be gripped);
//   seat 8.2 → 8.7 (+0.5): oak doublers behind the 1/2" gunwale under the two grip pads (2 x 0.22 lb of 3/4" x 1.5" x 6.5" oak) so every pad screw has
//     >= 3/4" engagement (D-41);
//   storage 9.9 → 10.5 (+0.6): six lash-plate doublers (6 x 0.07 = 0.4 lb) plus 0.2 lb for the larger box (2,000 in³);
//   body: +0.2 lb from the larger box (the deck and transom crest follow it);
//   lighting 1.2 → 1.3 (+0.1): the rear-light doubler (0.16 lb of oak);
//   hardware 3.1 → 5.4 (+2.3): the flat 2.5 lb fastener lump became a computed remainder (lighting.ts `fastenerBreakdown`): about 114 wood and machine
//     screws x 0.008 lb, 38 bolt sets x 0.04-0.09 lb, 16 nuts-and-washer legs, 20 inserts, 16 knobs, 22 Dominos and 56 epoxy joints = 4.8 lb, plus the six
//     lash plates 0.6 lb. The old lump had been sized before the joint list existed and was too small for the real fastener count.
// Phase 3 round 2, front end (F1, D-35): steering 13.8 → 22.7 lb (+8.9): turntable preset 2 (1,500 lb) 3.5 → 5.5 (+2.0); steel kingpin plates: 3/8" carrier
//   strip on the beam 3.17, 3/16" plate under the beam 1.59, 3/16" plate under the crossbar 0.64 (+5.4); the two stop arms 0.58 each, channel dogs 0.81 each and
//   their pads replace two oak dogs and four steel faces (+1.3 net, with the risers); the crossbar sleeve and the loose oak bearing are gone (−0.4: the beam sleeve
//   is now 0.68 lb, plate to plate, vs 0.56 + 0.40); the crossbar is 3/16" shallower (−0.1). The plate bolts, cross-bolts and screws are in the computed hardware.
//   hardware 5.4 → 6.8 (F1 share ≈ +1.0: 10 plate bolts, 10 stainless cross-bolts, 8 stop screws, 12 washers and nuts, 2 tapped-hole screws).
// Group totals are therefore within a few percent of the sums above; the test band is ±15% per group and ±10% overall.
const EXPECTED_EMPTY_LB = 150.6;
const EXPECTED_GROUP_LB: Record<string, number> = {
  'running-gear': 51.0, steering: 22.7, frame: 10.1, body: 35.1, seat: 8.7, storage: 8.7, brake: 11.0, removable: 4.7, hardware: 6.8, lighting: 1.3,
};

describe('masses', () => {
  const parts = buildModel(defaults);
  it('every part has finite mass; every non-payload part is positive', () => {
    for (const p of parts) {
      expect(Number.isFinite(p.massLb), p.id).toBe(true);
      if (!p.payload) expect(p.massLb, p.id).toBeGreaterThan(0);
    }
  });
  it('prints the empty-mass breakdown and CGs', () => {
    const rows: Record<string, { parts: number; massLb: number }> = {};
    for (const p of parts.filter((x) => !x.payload)) {
      rows[p.group] ??= { parts: 0, massLb: 0 };
      rows[p.group].parts++;
      rows[p.group].massLb = +(rows[p.group].massLb + p.massLb).toFixed(2);
    }
    const empty = totalMass(parts);
    console.table(rows);
    const f = (v: number[]) => v.map((x) => x.toFixed(2)).join(', ');
    const op = buildModel(defaults, { rider: 'operating' });
    const goal = buildModel(defaults, { rider: 'goal' });
    console.log(`Empty mass ${empty.toFixed(1)} lb (${parts.filter((x) => !x.payload).length} parts, ${parts.length} incl payload); CG [${f(centerOfGravity(parts))}]`);
    console.log(`+ operating rider + cargo: ${totalMass(op, { includePayload: true }).toFixed(1)} lb; CG [${f(centerOfGravity(op, { includePayload: true }))}]`);
    console.log(`+ goal rider + cargo: ${totalMass(goal, { includePayload: true }).toFixed(1)} lb; CG [${f(centerOfGravity(goal, { includePayload: true }))}]`);
    // Regression band: ±10% of the documented block-model empty mass at defaults (critic H2). Update EXPECTED_EMPTY_LB
    // (and the group table below) deliberately when the design changes. W-1 'default' is ~121 lb; spec says ~100-125.
    expect(empty).toBeGreaterThan(EXPECTED_EMPTY_LB * 0.9);
    expect(empty).toBeLessThan(EXPECTED_EMPTY_LB * 1.1);
    for (const [g, lb] of Object.entries(EXPECTED_GROUP_LB)) {
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeGreaterThan(lb * 0.85);
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeLessThan(lb * 1.15);
    }
  });
  it('the block-model artefacts stay gone: seat, bolster and storage lid are real members, not slabs', () => {
    expect(parts.some((x) => x.id === 'seat-base')).toBe(false);
    expect(parts.some((x) => x.id === 'bolster')).toBe(false);
    const seatBack = parts.filter((x) => x.id.startsWith('seat-back-') && x.id !== 'seat-back-pad');
    expect(seatBack.map((x) => x.id).sort()).toEqual(['seat-back-panel', 'seat-back-rail-bottom', 'seat-back-rail-top', 'seat-back-stile-L', 'seat-back-stile-R']);
    expect(seatBack.reduce((m, x) => m + x.massLb, 0)).toBeLessThan(4);
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    expect(lid.kind).toBe('sheet');
    expect((lid.geometry as { size: number[] }).size[2]).toBeCloseTo(defaults.panelPlyIn, 6);
    expect(parts.filter((x) => x.group === 'steering' && /^bolster/.test(x.id)).reduce((m, x) => m + x.massLb, 0)).toBeLessThan(5);
  });
  it('rider CG follows D-3 and mass follows the view', () => {
    const p = defaults;
    expect(buildModel(p, { rider: 'none' }).some((x) => x.body === 'rider')).toBe(false);
    for (const [rider, mass] of [['operating', p.riderMassLb], ['goal', p.riderGoalMassLb]] as const) {
      const m = buildModel(p, { rider });
      const torso = m.find((x) => x.id === 'rider-torso')!;
      expect(torso.massLb).toBe(mass);
      expect(m.filter((x) => x.body === 'rider' && x !== torso).every((x) => x.massLb === 0)).toBe(true);
      expect(torso.payload).toBe(true);
      const cushion = m.find((x) => x.id === 'seat-cushion')!;
      const seatTop = cushion.transform[14] + (cushion.geometry as { size: number[] }).size[2] / 2;
      expect(torso.cgIn![0]).toBeCloseTo(p.seatXIn + p.riderCgAheadOfHpointIn, 9);
      expect(torso.cgIn![1]).toBe(0);
      expect(torso.cgIn![2]).toBeCloseTo(seatTop + p.riderSeatedCgAboveSeatIn, 9);
    }
    const op = buildModel(p);
    expect(op.find((x) => x.id === 'cargo')!.massLb).toBe(p.cargoMassLb);
    expect(buildModel(p, { cargo: false }).some((x) => x.id === 'cargo')).toBe(false);
    // Payload is excluded from the empty mass and CG.
    expect(totalMass(op)).toBeCloseTo(totalMass(buildModel(p, { rider: 'none', cargo: false })), 9);
    expect(totalMass(op, { includePayload: true })).toBeCloseTo(totalMass(op) + p.riderMassLb + p.cargoMassLb, 6);
  });
});

describe('removed', () => {
  it('drops exactly the removable parts', () => {
    // Default drawbar is the rope bridle (no tongue): the removable set has the rope legs; the oak-tongue config has the tongue.
    const full = buildModel(defaults);
    const removed = buildModel(defaults, { removed: true });
    expect(removed.map((p) => p.id)).toEqual(full.filter((p) => !p.removable).map((p) => p.id));
    const gone = full.filter((p) => p.removable).map((p) => p.id);
    const common = ['prow', 'seat-back-panel', 'seat-back-stile-L', 'sign-L', 'sign-R', 'handle-bar', 'handle-post-L', 'handle-post-R'];
    expect(gone).toEqual(expect.arrayContaining([...common, 'bridle-L', 'bridle-R']));
    expect(gone).not.toContain('tongue');
    const fullT = buildModel(phase1);
    const goneT = fullT.filter((p) => p.removable).map((p) => p.id);
    expect(buildModel(phase1, { removed: true }).map((p) => p.id)).toEqual(fullT.filter((p) => !p.removable).map((p) => p.id));
    expect(goneT).toEqual(expect.arrayContaining([...common, 'tongue', 'bridle']));
  });
});

describe('param sweeps', () => {
  const all = Object.keys(PARAM_DEFS) as ParamKey[];
  const primary = all.filter((k) => PARAM_DEFS[k].primary);
  const check = (p: Params, label: string) => {
    for (const v of [{}, { steerDeg: 40, rider: 'goal' as const }, { removed: true }]) {
      let parts: Part[] = [];
      expect(() => (parts = buildModel(p, v)), label).not.toThrow();
      for (const part of parts) {
        expect(Number.isFinite(part.massLb), `${label} ${part.id} mass`).toBe(true);
        expect(part.transform.every(Number.isFinite), `${label} ${part.id} transform`).toBe(true);
      }
      expect(Number.isFinite(totalMass(parts, { includePayload: true })), label).toBe(true);
      expect(centerOfGravity(parts, { includePayload: true }).every(Number.isFinite), label).toBe(true);
    }
  };
  it.each(primary)('primary param %s at min and max', (k) => {
    for (const v of [PARAM_DEFS[k].min, PARAM_DEFS[k].max]) check({ ...defaults, [k]: v }, `${k}=${v}`);
  });
  it('every param (and every option) at min/max does not throw', () => {
    for (const k of all) {
      const d = PARAM_DEFS[k];
      const values = d.options ? d.options.map((o) => o.value) : [d.min, d.max];
      for (const v of values) check({ ...defaults, [k]: v }, `${k}=${v}`);
    }
  });
  it('whole-design extremes do not throw', () => {
    const lo = { ...defaults }, hi = { ...defaults };
    for (const k of all) { lo[k] = PARAM_DEFS[k].min; hi[k] = PARAM_DEFS[k].max; }
    check(lo, 'all-min');
    check(hi, 'all-max');
  });
  it('alternate structure, brake, storage and axle options build', () => {
    for (const patch of [
      { frameStyle: 1 }, { sideConstruction: 0 }, { sideConstruction: 2 }, { axleStyle: 1 }, { brakeType: 1 },
      { storageLocation: 1 }, { storageLocation: 2 }, { axleBeamPosition: 1 }, { drawbar: 0 }, { plySpecies: 1 }, { tireType: 1 },
    ]) check({ ...defaults, ...patch }, JSON.stringify(patch));
  });
});

// ── Robustness (critic H3) ──────────────────────────────────────────────────────────────────────────────────────
const errorsOf = (p: Params) => validateParams(p).filter((i) => i.severity === 'error');
/** Scan a param for the lowest / highest value validateParams accepts. */
function validExtreme(key: ParamKey, from: number, to: number, step: number): number {
  const dir = Math.sign(to - from);
  for (let v = from; dir * (to - v) >= 0; v += dir * step) if (!errorsOf({ ...defaults, [key]: v }).length) return v;
  return NaN;
}
const seatMin = validExtreme('seatXIn', PARAM_DEFS.seatXIn.min, PARAM_DEFS.seatXIn.max, 0.5);
const seatMax = validExtreme('seatXIn', PARAM_DEFS.seatXIn.max, PARAM_DEFS.seatXIn.min, 0.5);

/**
 * Variants for the overlap, rider and ground tests. Variants whose params validateParams rejects are skipped
 * (a rule says why); the "…+fix" entries are the feasible companions of the raw extremes.
 */
const VARIANTS: Record<string, Partial<Params>> = {
  overslungBeam: { axleBeamPosition: 1 },
  'overslungBeam+deck': { axleBeamPosition: 1, deckHeightIn: 11.5 },
  seatXMin: { seatXIn: seatMin },
  seatXMax: { seatXIn: seatMax },
  gunwaleFlare2: { gunwaleFlareIn: 2 },
  wheel10: { wheelDiameterIn: 10 },
  wheel11_5: { wheelDiameterIn: 11.5 },
  drumBrake: { brakeType: 1 },
  stubAxles: { axleStyle: 1 },
  hullBeamFrame: { frameStyle: 1 },
  sidesSolidOak: { sideConstruction: 0 },
  sidesCapturedPly: { sideConstruction: 1 },
  sidesOpenFrame: { sideConstruction: 2 },
  storageRear: { storageLocation: 0 },
  storageForwardRaised: { storageLocation: 1 },
  storageUnderSeat: { storageLocation: 2 },
  track30: { rearTrackIn: 30, frontTrackIn: 30 },
  // The 1" gap between a 24" hull and the 30"-track tires is too narrow for the brake crank and clevis (D-38): the shaft moves back behind the tire.
  'track30+fix': { rearTrackIn: 30, frontTrackIn: 30, bodyWidthIn: 23, steerLockDeg: 25, brakeShaftBehindTireIn: 3, rearOverhangIn: 11 }, // 23": the rear U-bolt plates start at 11.5" (D-43)
  // At the Phase 2 44" wheelbase the auto shoulder sits 0.2" further back, so the seat needs to move back 0.5" at a 44" track.
  track44: { rearTrackIn: 44, frontTrackIn: 44, seatXIn: 11.5 },
  'track44+fix': { rearTrackIn: 44, frontTrackIn: 44, seatXIn: 11.5, noseTaperStartIn: 23 },
  wheelbase40: { wheelbaseIn: 40 },
  'wheelbase40+fix': { wheelbaseIn: 40, seatXIn: 8 },
  wheelbase60: { wheelbaseIn: 60 },
  lock30: { steerLockDeg: 30 },
  lock45: { steerLockDeg: 45 },
  kingpinLead0_875: { kingpinLeadIn: 0.875 },
  kingpinLead2_5: { kingpinLeadIn: 2.5, frontOverhangIn: 10 },
  'underSeat+riser': { storageLocation: 2, seatRiserIn: 1.5 },
  riser: { seatRiserIn: 1.5 },
  ropeBridleOnly: { drawbar: 0 },
  flatFree: { tireType: 1 },
  'stubAxles+10in': { axleStyle: 1, wheelDiameterIn: 10, axleBeamDepthIn: 3 },
};
const variantCases = Object.entries(VARIANTS).map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }));
const valid = variantCases.filter((v) => !errorsOf(v.p).length);
const skipped = variantCases.filter((v) => errorsOf(v.p).length);

describe('variants', () => {
  it('the extremes of the validated seat range are real (seat min/max found)', () => {
    expect(Number.isFinite(seatMin) && Number.isFinite(seatMax)).toBe(true);
    expect(seatMin).toBeLessThan(defaults.seatXIn);
    expect(seatMax).toBeGreaterThan(defaults.seatXIn);
    // One step beyond the extremes is rejected: the validator is what stops the impossible seat positions.
    expect(errorsOf({ ...defaults, seatXIn: seatMin - 0.5 }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...defaults, seatXIn: seatMax + 0.5 }).length).toBeGreaterThan(0);
  });
  it('most variants are valid; raw extremes that are impossible are skipped with a reason', () => {
    expect(valid.length).toBeGreaterThanOrEqual(variantCases.length - 7); // D-43: the 5/8" chines cost the nose 1/4" of inside width, so kingpinLead2_5 joins the impossible extremes
    for (const v of skipped) expect(errorsOf(v.p)[0].message.length, v.name).toBeGreaterThan(20);
    // The feasible companions must really be feasible.
    for (const n of ['overslungBeam+deck', 'track30+fix', 'track44+fix', 'wheelbase40+fix', 'seatXMin', 'seatXMax', 'gunwaleFlare2', 'wheel10', 'drumBrake', 'stubAxles', 'hullBeamFrame', 'lock30'])
      expect(valid.some((v) => v.name === n), n).toBe(true);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('no unintended overlaps: %s (neutral and both full locks, transport config)', (_n, p) => {
    for (const view of [{ steerDeg: 0 }, { steerDeg: p.steerLockDeg }, { steerDeg: -p.steerLockDeg }, { removed: true }])
      expect(overlaps(buildModel(p, view)), JSON.stringify(view)).toEqual([]);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('rider fits without cutting through the structure: %s', (_n, p) => {
    expect(riderClashes(buildModel(p))).toEqual([]);
  });
  it('rider-vs-structure test has teeth: an oversized seat cuts the rider and is caught', () => {
    const m = buildModel({ ...defaults, seatBackAngleDeg: 0, riderStatureIn: 76 });
    // Not asserting a clash here (validator-dependent); assert the function does detect a forced overlap.
    const torso = m.find((x) => x.id === 'rider-torso')!;
    const stile = m.find((x) => x.id === 'seat-back-stile-L')!;
    const moved = { ...torso, transform: [...torso.transform.slice(0, 12), stile.transform[12], stile.transform[13], stile.transform[14], 1] };
    expect(riderClashes([...m.filter((x) => x !== torso), moved]).length).toBeGreaterThan(0);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('ground contact: %s', (_n, p) => {
    const parts = buildModel(p);
    const wheels = parts.filter((x) => x.geometry.type === 'wheel');
    expect(wheels).toHaveLength(4);
    for (const w of wheels) expect(worldAABB(w).min[2], w.id).toBeCloseTo(0, 6);
    // Nothing else hangs below the minimum ground clearance (the validator warns about a too-deep beam instead of erroring).
    const warned = validateParams(p).some((i) => i.keys.includes('minGroundClearanceIn'));
    if (!warned)
      for (const x of parts.filter((q) => !q.payload && q.geometry.type !== 'wheel'))
        expect(worldAABB(x).min[2], x.id).toBeGreaterThanOrEqual(p.minGroundClearanceIn - 1e-6);
  });
  it('ground contact at defaults: 4 tire bottoms at z = 0 and 4.3" or more under the lowest structure', () => {
    const parts = buildModel(defaults);
    const low = Math.min(...parts.filter((q) => !q.payload && q.geometry.type !== 'wheel').map((q) => worldAABB(q).min[2]));
    expect(low).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
  });
});

/** Rider segments vs every non-payload part; the mannequin is rough, so a 0.1" tolerance. */
function riderClashes(parts: Part[], tol = 0.1): string[] {
  const riders = parts.filter((x) => x.body === 'rider');
  const structure = parts.filter((x) => !x.payload);
  const bad: string[] = [];
  for (const r of riders) for (const q of structure) {
    const o = obbOverlap(partOBB(r), partOBB(q));
    if (o > tol) bad.push(`${r.id} x ${q.id}: ${o.toFixed(2)}"`);
  }
  return bad;
}

describe('rider and tire clearance consistency', () => {
  it('rider fits at the default, at min and max stature, and for both rider loads', () => {
    for (const stature of [PARAM_DEFS.riderStatureIn.min, defaults.riderStatureIn, PARAM_DEFS.riderStatureIn.max]) {
      const p = { ...defaults, riderStatureIn: stature, riderLegReachIn: Math.round(stature * 0.53 * 2) / 2 };
      if (errorsOf(p).length) continue;
      for (const rider of ['operating', 'goal'] as const) expect(riderClashes(buildModel(p, { rider })), `${stature} ${rider}`).toEqual([]);
    }
  });
  it('feet land on the foot stop', () => {
    const m = buildModel(defaults);
    const stop = worldAABB(m.find((x) => x.id === 'foot-stop')!);
    for (const tag of ['L', 'R']) {
      const foot = worldAABB(m.find((x) => x.id === `rider-foot-${tag}`)!);
      expect(Math.abs(foot.max[0] - stop.min[0])).toBeLessThan(0.1);
    }
  });
  it('validateParams (A-4 with the D-25 lead) and the model agree: no rejected-free design lets a front tire touch the body', () => {
    const tireBody = (p: Params, deg: number) => {
      const parts = buildModel(p, { steerDeg: deg });
      const tires = parts.filter((x) => x.id === 'wheel-FL' || x.id === 'wheel-FR');
      const body = parts.filter((x) => !x.payload && /^(side-|shoulder|deck-|transom|rail-|joist-|bolster|foot-stop|storage|seat-|sign|reflector)/.test(x.id));
      let worst = -Infinity;
      for (const t of tires) for (const b of body) worst = Math.max(worst, obbOverlap(partOBB(t), partOBB(b)));
      return worst;
    };
    for (const patch of [{}, { kingpinLeadIn: 0.875 }, { kingpinLeadIn: 2 }, { steerLockDeg: 30 }, { steerLockDeg: 25, noseWidthIn: 14 }, { frontTrackIn: 40, rearTrackIn: 40, noseTaperStartIn: 22, noseWidthIn: 12.5 }]) {
      const p = { ...defaults, ...patch };
      if (errorsOf(p).length) continue;
      for (const deg of [p.steerLockDeg, -p.steerLockDeg]) expect(tireBody(p, deg), JSON.stringify(patch)).toBeLessThanOrEqual(0);
    }
    // Rule is tight, not slack: a nose 1" wider than the limit really is hit.
    // (Rule: nose ≤ 2 × (swing − clearance). The tire itself touches at 2 × swing.)
    const limit = 2 * (derivedSwing() - defaults.steeringClearanceIn);
    const tight = { ...defaults, autoNoseGeometry: 0, noseWidthIn: limit + 0.5 };
    expect(errorsOf(tight).some((i) => i.keys.includes('noseWidthIn'))).toBe(true);
    expect(tireBody(tight, defaults.steerLockDeg)).toBeLessThan(0);
    const wide = { ...defaults, autoNoseGeometry: 0, noseWidthIn: 2 * derivedSwing() + 0.5 };
    expect(errorsOf(wide).some((i) => i.keys.includes('noseWidthIn'))).toBe(true);
    expect(tireBody(wide, defaults.steerLockDeg)).toBeGreaterThan(0);
    expect(tireBody({ ...defaults, autoNoseGeometry: 0, noseWidthIn: limit }, defaults.steerLockDeg)).toBeCloseTo(-defaults.steeringClearanceIn, 6);
  });
});
function derivedSwing(): number {
  const lk = (defaults.steerLockDeg * Math.PI) / 180;
  return (defaults.frontTrackIn / 2 - defaults.tireWidthIn / 2) * Math.cos(lk) - (defaults.kingpinLeadIn + defaults.wheelDiameterIn / 2) * Math.sin(lk);
}

describe('explode directions (M7)', () => {
  const parts = buildModel(defaults);
  const dir = (id: string) => parts.find((x) => x.id === id)!.explode!;
  it('every part has a unit direction, payload has none', () => {
    for (const x of parts) {
      const n = Math.hypot(...x.explode!);
      if (x.payload) expect(x.explode, x.id).toEqual([0, 0, 0]);
      else expect(n, x.id).toBeCloseTo(1, 6);
    }
  });
  it('subsystems separate by their own rule', () => {
    expect(dir('wheel-FL')[1]).toBeGreaterThan(0.8);
    expect(dir('wheel-FR')[1]).toBeLessThan(-0.8);
    expect(dir('beam-R')[2]).toBeLessThan(-0.9);
    expect(buildModel(phase1).find((x) => x.id === 'tongue')!.explode![0]).toBeGreaterThan(0.9);
    expect(dir('bridle-L')[0]).toBeGreaterThan(0.5); // rope bridle legs (default drawbar) separate forward
    expect(dir('kingpin')[2]).toBeLessThan(-0.9);
    expect(dir('side-cabin-L-web')[1]).toBeGreaterThan(0.9);
    expect(dir('side-cabin-R-web')[1]).toBeLessThan(-0.9);
    expect(dir('seat-cushion')[2]).toBeGreaterThan(0.9);
    expect(dir('seat-back-panel')[0]).toBeLessThan(-0.4);
    expect(dir('storage-lid')[2]).toBeGreaterThan(0.9);
    expect(dir('handle-bar')[0]).toBeLessThan(-0.8);
    expect(dir('rail-cabin-L')[2]).toBeLessThan(-0.5);
    expect(dir('deck-cabin')[2]).toBeGreaterThan(0.9);
    // Not all one direction: the exploded view separates the assembly.
    const distinct = new Set(parts.filter((x) => !x.payload).map((x) => x.explode!.map((v) => v.toFixed(1)).join(',')));
    expect(distinct.size).toBeGreaterThan(15);
  });
});

// ── Steering stops and sweep (critic r2 H1) ─────────────────────────────────────────────────────────────────────
describe('steering sweep', () => {
  const steerish = (x: Part) => x.body === 'steer' || x.id === 'wheel-FL' || x.id === 'wheel-FR';
  const sweepAngles = (lock: number) => {
    const out: number[] = [];
    for (let d = -lock; d <= lock + 1e-9; d += 0.5) out.push(Math.min(lock, Math.round(d * 2) / 2));
    return [...new Set([-lock, ...out, lock])].sort((a, b) => a - b);
  };
  const sweep = (p: Params, label: string) => {
    const lock = p.steerLockDeg;
    for (const deg of sweepAngles(lock)) {
      const parts = buildModel(p, { steerDeg: deg });
      const moving = parts.filter((x) => !x.payload && steerish(x));
      const fixed = parts.filter((x) => !x.payload && x.body === 'chassis' && SOLID.includes(x.group));
      for (const a of moving) {
        const oa = partOBB(a);
        for (const b of fixed) {
          const o = obbOverlap(oa, partOBB(b));
          const isStop = a.id.startsWith('steer-stop-');
          // Every steer-body part (tongue, beam, bearers, clamps, wheels, ...) stays clear of the chassis all the way round.
          // The stop dogs and their steel faces must be strictly clear of everything, including the stop blocks, until the last half
          // degree; the only contact allowed is face on face with a stop block at ±lock (D-31).
          if (isStop) {
            const nearLock = Math.abs(deg) > lock - 0.5 - 1e-9;
            if (b.id.startsWith('stop-block-') && nearLock) expect(o, `${label} ${a.id} x ${b.id} @${deg}`).toBeLessThanOrEqual(1e-6);
            else expect(o, `${label} ${a.id} x ${b.id} @${deg}`).toBeLessThanOrEqual(0);
          } else if (!ALLOW.some((r) => matches(r, a, b))) expect(o, `${label} ${a.id} x ${b.id} @${deg}`).toBeLessThanOrEqual(TOL);
        }
      }
    }
  };
  it('the stops first touch the chassis exactly at lock, and nothing else on the steer body hits the chassis anywhere in the sweep', () => {
    sweep(defaults, 'defaults');
    for (const patch of [{ steerLockDeg: 30 }, { steerLockDeg: 36 }, { turntableSizeIn: 14 }, { steerStopSizeIn: 2 }, { bolsterRailWidthIn: 2 }, { storageLocation: 1 }, { kingpinCrossbarWidthIn: 4.5 }, { kingpinSleeveOdIn: 1.25, kingpinDiameterIn: 0.625, kingpinLeadIn: 1.5, frontAxleBeamThicknessIn: 4, frontTrackIn: 36.5 }]) {
      const p = { ...defaults, ...patch };
      if (!errorsOf(p).length) sweep(p, JSON.stringify(patch));
    }
  }, 60000); // ~10 s sweep on CI runners
  // Each dog has a steel-faced side for each lock: at +lock the left dog's aft face closes on block AL and the right dog's fore face on block FR
  // (a 180° couple); at −lock the left dog's fore face closes on FL and the right dog's aft face on AR (D-31).
  const CONTACTS: Array<[string, number, string, string]> = [
    ['L', 1, 'steer-stop-face-L1', 'stop-block-AL'], ['L', -1, 'steer-stop-face-L2', 'stop-block-FL'],
    ['R', 1, 'steer-stop-face-R2', 'stop-block-FR'], ['R', -1, 'steer-stop-face-R1', 'stop-block-AR'],
  ];
  it.each(CONTACTS)('dog %s at lock sign %i: %s closes flat on %s exactly at lock and is strictly clear before it', (tag, sign, faceId, blockId) => {
    const lock = defaults.steerLockDeg;
    const touch = (deg: number) => {
      const m = buildModel(defaults, { steerDeg: deg });
      return obbOverlap(partOBB(m.find((x) => x.id === faceId)!), partOBB(m.find((x) => x.id === blockId)!));
    };
    for (let k = 0; k * 0.5 <= lock - 0.5 + 1e-9; k++) expect(touch(sign * k * 0.5), `δ=${sign * k * 0.5}`).toBeLessThan(0);
    expect(Math.abs(touch(sign * lock))).toBeLessThan(1e-6);
    // Flat: the face is parallel to the block's face at lock (their normals line up).
    const m = buildModel(defaults, { steerDeg: sign * lock });
    const face = partOBB(m.find((x) => x.id === faceId)!);
    const block = partOBB(m.find((x) => x.id === blockId)!);
    expect(Math.abs(face.axes[0][0] * block.axes[1][0] + face.axes[0][1] * block.axes[1][1])).toBeCloseTo(1, 9);
    // The dog, both faces and the other three blocks touch nothing else at lock; the dog block itself never reaches a stop block.
    const dog = partOBB(m.find((x) => x.id === `steer-stop-${tag}`)!);
    for (const b of m.filter((x) => !x.payload && x.body === 'chassis' && SOLID.includes(x.group))) expect(obbOverlap(dog, partOBB(b)), b.id).toBeLessThan(0);
  });
  it('two stops close at once at either lock (a couple): at +lock dogs L and R, at −lock dogs L and R, with no net force on the kingpin from equal shares', () => {
    const lock = defaults.steerLockDeg;
    for (const sign of [1, -1]) {
      const m = buildModel(defaults, { steerDeg: sign * lock });
      const engaged = CONTACTS.filter((c) => c[1] === sign).map(([, , faceId, blockId]) => obbOverlap(partOBB(m.find((x) => x.id === faceId)!), partOBB(m.find((x) => x.id === blockId)!)));
      expect(engaged.length).toBe(2);
      for (const o of engaged) expect(Math.abs(o)).toBeLessThan(1e-6);
    }
    // The pair is the 180° rotation about the kingpin: the right block polygons are the left ones turned by 180°.
    const plan = steerStopPlan(resolveParams(defaults));
    const byId = (id: string) => plan.teeth.find((t) => t.id === id)!;
    const sx = (t: { poly: Array<{ x: number; y: number }> }) => t.poly.reduce((m, q) => m + q.x, 0), sy = (t: { poly: Array<{ x: number; y: number }> }) => t.poly.reduce((m, q) => m + q.y, 0);
    expect(sx(byId('FR'))).toBeCloseTo(-sx(byId('AL')), 9);
    expect(sy(byId('FR'))).toBeCloseTo(-sy(byId('AL')), 9);
    expect(sx(byId('AR'))).toBeCloseTo(-sx(byId('FL')), 9);
  });
});

// ── Validator rules added in round 2 ──────────────────────────────────────────────────────────────────────────
describe('round-2 validator rules', () => {
  it('shoulder rule uses the axle-referenced swing (M2): exact at the limit, tight against the OBB tire check', () => {
    const d = derived(defaults);
    const need = d.swingRearBehindAxleIn + defaults.steeringClearanceIn;
    expect(need).toBeCloseTo(d.swingRearXIn - defaults.kingpinLeadIn + defaults.steeringClearanceIn, 9);
    expect(defaults.noseTaperStartIn).toBeGreaterThanOrEqual(need);
    expect(defaults.noseTaperStartIn - need).toBeLessThan(0.5);
    const shoulderErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('Front tires hit the cabin shoulder'));
    expect(shoulderErr({ ...defaults, autoNoseGeometry: 0, noseTaperStartIn: need + 0.001 })).toBe(false);
    expect(shoulderErr({ ...defaults, autoNoseGeometry: 0, noseTaperStartIn: need - 0.01 })).toBe(true);
    // The lead moves the rule the right way: more lead = tire corner further forward of the kingpin pivot but the pivot is further forward of the axle.
    const tireGap = (p: Params, deg: number) => {
      const m = buildModel(p, { steerDeg: deg });
      const tires = m.filter((x) => x.id === 'wheel-FL' || x.id === 'wheel-FR');
      const body = m.filter((x) => !x.payload && /^(side-|shoulder|deck-|transom|rail-|joist-|bolster|foot-stop|storage|seat-|sign|reflector)/.test(x.id));
      let worst = -Infinity;
      for (const t of tires) for (const b of body) worst = Math.max(worst, obbOverlap(partOBB(t), partOBB(b)));
      return worst;
    };
    // At exactly `need` the tire is `steeringClearanceIn` clear of the shoulder (x-separation), and 0.25" less taper reaches into it.
    const atNeed = { ...defaults, autoNoseGeometry: 0, noseTaperStartIn: need };
    expect(tireGap(atNeed, defaults.steerLockDeg)).toBeCloseTo(-defaults.steeringClearanceIn, 6);
    expect(tireGap({ ...defaults, autoNoseGeometry: 0, noseTaperStartIn: need - defaults.steeringClearanceIn - 0.25 }, defaults.steerLockDeg)).toBeGreaterThan(0);
    // Several leads: whenever the rule passes, the tires clear the body at both locks.
    for (const kingpinLeadIn of [1.125, 1.25, 1.5]) {
      const p = { ...defaults, autoNoseGeometry: 0, kingpinLeadIn, noseTaperStartIn: derived({ ...defaults, kingpinLeadIn }).swingRearBehindAxleIn + defaults.steeringClearanceIn };
      if (errorsOf(p).length) continue;
      for (const deg of [p.steerLockDeg, -p.steerLockDeg]) expect(tireGap(p, deg), `lead ${kingpinLeadIn}`).toBeLessThanOrEqual(0);
    }
  });
  it('boot allowance is part of the nose foot-span rule (M4)', () => {
    const noseInner = defaults.noseWidthIn - 2 * defaults.sideThicknessIn;
    const foot = (2 * RIDER_LEG_Y_FRAC + RIDER_FOOT_Y_FRAC) * defaults.riderStatureIn;
    expect(noseInner).toBeGreaterThanOrEqual(foot + 2 * defaults.bootAllowanceIn + 0.25);
    const noseErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The nose is'));
    expect(noseErr({ ...defaults, bootAllowanceIn: 1.5 })).toBe(true);
    expect(noseErr({ ...defaults, bootAllowanceIn: 0 })).toBe(false);
    expect(noseErr({ ...defaults, autoNoseGeometry: 0, noseWidthIn: 2 * defaults.sideThicknessIn + foot + 2 * defaults.bootAllowanceIn + 0.25 - 0.01 })).toBe(true);
  });
  it('front transom may not hang into the turntable or tongue (M3)', () => {
    const deckErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The front transom hangs'));
    expect(deckErr(defaults)).toBe(false);
    for (const deckHeightIn of [7.5, 8, 8.1]) expect(deckErr({ ...defaults, deckHeightIn }), `deck ${deckHeightIn}`).toBe(true);
    // Whatever deck height passes the rules builds without a transom/turntable/tongue clash.
    for (let deckHeightIn = 6; deckHeightIn <= 16; deckHeightIn += 0.25) {
      const p = { ...defaults, deckHeightIn };
      if (errorsOf(p).length) continue;
      for (const deg of [0, p.steerLockDeg, -p.steerLockDeg]) expect(overlaps(buildModel(p, { steerDeg: deg })), `deck ${deckHeightIn}`).toEqual([]);
    }
  });
  it('rear U-bolt plates stay clear of the cabin rails (M3)', () => {
    const railErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The cabin rails/sides reach'));
    expect(railErr({ ...defaults, bodyWidthIn: 30, rearTrackIn: 35.5 })).toBe(true);
    for (const bodyWidthIn of [26, 28, 29, 29.5, 30]) {
      const p = { ...defaults, bodyWidthIn };
      if (!errorsOf(p).length) expect(overlaps(buildModel(p)), `body ${bodyWidthIn}`).toEqual([]);
    }
  });
  it('steering stops must fit the bolster opening', () => {
    expect(errorsOf({ ...defaults, steerStopSizeIn: 3, steerStopFacePlateIn: 0.25 }).some((i) => i.message.startsWith('Steering stops do not fit'))).toBe(true);
    // The turntable preset (D-28) overrides the size param, so a custom 6" plate needs turntableType = 0 (Custom).
    expect(errorsOf({ ...defaults, turntableType: 0, turntableSizeIn: 6 }).some((i) => i.message.startsWith('Steering stops do not fit'))).toBe(true);
  });
});

// ── Seeded fuzz (critic r2 M3): every validator-clean design has zero unintended overlaps ──────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fuzz: validator-clean designs have no unintended overlaps', () => {
  const FUZZ_KEYS: ParamKey[] = [
    'wheelbaseIn', 'rearTrackIn', 'frontTrackIn', 'deckHeightIn', 'frontDeckRaiseIn', 'bodyWidthIn', 'noseWidthIn', 'noseTaperStartIn',
    'seatXIn', 'wheelDiameterIn', 'steerLockDeg', 'kingpinLeadIn', 'rearOverhangIn', 'frontOverhangIn', 'sideHeightIn', 'tireWidthIn',
    'axleBeamThicknessIn', 'frontAxleBeamThicknessIn', 'axleBeamDepthIn', 'railDepthIn', 'crossmemberDepthIn', 'turntableSizeIn',
    'steerStopSizeIn', 'sideBearerWidthIn', 'gunwaleFlareIn', 'seatDepthIn', 'hubLengthIn', 'tongueLengthIn',
    'riderStatureIn', 'seatBackAngleDeg', 'storageVolumeIn3', 'footStopThickIn', 'panelPlyIn', 'riderLegReachIn',
  ];
  const OPTION_KEYS: ParamKey[] = ['frameStyle', 'sideConstruction', 'storageLocation', 'axleBeamPosition', 'axleStyle', 'drawbar', 'tireType'];
  const N = 300; // raise (and change the seed) to hunt; 24,000 designs over 8 seeds were clean when this was written
  const samples = (() => {
    const rnd = mulberry32(455);
    const out: Params[] = [];
    for (let i = 0; i < N; i++) {
      const p = { ...defaults, autoNoseGeometry: 0 }; // this sample set repairs nose width / shoulder by hand (see below)
      // Jitter a random subset of keys around the defaults (±20% of each range), then with probability 0.75 "repair" the
      // swing-zone rules (nose width, shoulder position) the way a designer would, so many samples pass validation.
      for (const k of FUZZ_KEYS) {
        if (rnd() > 0.3) continue;
        const d = PARAM_DEFS[k];
        const v = d.default + (rnd() * 2 - 1) * 0.2 * (d.max - d.min);
        p[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      if (rnd() < 0.75) {
        const dv = derived(p);
        p.noseTaperStartIn = Math.min(PARAM_DEFS.noseTaperStartIn.max, Math.ceil((dv.swingRearBehindAxleIn + p.steeringClearanceIn) * 2) / 2 + (rnd() < 0.5 ? 0 : 0.5));
        p.noseWidthIn = Math.min(p.bodyWidthIn, Math.max(PARAM_DEFS.noseWidthIn.min, Math.floor((2 * (dv.swingInnerYIn - p.steeringClearanceIn)) * 4) / 4));
        p.frontAxleBeamThicknessIn = Math.max(p.frontAxleBeamThicknessIn, Math.ceil((p.kingpinLeadIn + (p.axleDiameterIn + p.kingpinDiameterIn) / 2 + 2 * p.beamLigamentMinIn + p.sideBearerLengthIn - 1.5) * 8) / 8);
      }
      for (const k of OPTION_KEYS) if (rnd() < 0.35) p[k] = PARAM_DEFS[k].options![Math.floor(rnd() * PARAM_DEFS[k].options!.length)].value;
      out.push(p);
    }
    return out;
  })();
  it(`${N} seeded designs: no errors => no unintended overlaps (neutral, both locks, transport)`, () => {
    const t0 = Date.now();
    let clean = 0;
    const failures: string[] = [];
    for (const p of samples) {
      if (errorsOf(p).length) continue;
      clean++;
      for (const view of [{ steerDeg: 0 }, { steerDeg: p.steerLockDeg }, { steerDeg: -p.steerLockDeg }, { removed: true }]) {
        const bad = overlaps(buildModel(p, view));
        if (bad.length) failures.push(`${bad.slice(0, 3).join('; ')} @${JSON.stringify(view)} :: ${JSON.stringify(Object.fromEntries([...FUZZ_KEYS, ...OPTION_KEYS].filter((k) => p[k] !== defaults[k]).map((k) => [k, p[k]])))}`);
      }
    }
    console.log(`fuzz: ${clean}/${N} validator-clean designs checked in ${Date.now() - t0} ms; ${failures.length} failures`);
    expect(failures.slice(0, 5)).toEqual([]);
    expect(clean).toBeGreaterThanOrEqual(40);
    expect(Date.now() - t0).toBeLessThan(10000);
  });
});

// ── Auto nose geometry (A-4, D-26): front track / lock / lead jitter with the nose derived, transport config included ──
describe('autoNoseGeometry and resolveParams', () => {
  it('Phase 1 configuration: auto reproduces (or widens) the Phase 1 nose and shoulder and stays validator-clean', () => {
    expect(phase1.autoNoseGeometry).toBe(1);
    const r = resolveParams(phase1);
    expect(r.noseWidthIn).toBeGreaterThanOrEqual(13.5);
    expect(r.noseWidthIn * 8 % 1).toBe(0);
    expect(r.noseTaperStartIn).toBe(18);
    expect(validateParams(phase1)).toEqual([]);
    expect(validateParams({ ...phase1, autoNoseGeometry: 0 })).toEqual([]);
  });
  it('Phase 2 defaults (44" wheelbase, 37° lock, 1.5" lead): auto nose and shoulder match an independent trig derivation, and stay validator-clean', () => {
    expect(defaults.autoNoseGeometry).toBe(1);
    const r = resolveParams(defaults);
    // Independent re-derivation of the A-4 swing rule: inner tire corner |y| and rear-most tire corner behind the axle at full lock.
    const lk = (defaults.steerLockDeg * Math.PI) / 180;
    const half = defaults.frontTrackIn / 2, w = defaults.tireWidthIn, rr = defaults.wheelDiameterIn / 2, lead = defaults.kingpinLeadIn;
    const innerY = (half - w / 2) * Math.cos(lk) - (lead + rr) * Math.sin(lk); // 7.76"
    const rearBehindAxle = (half + w / 2) * Math.sin(lk) + (lead + rr) * Math.cos(lk) - lead; // 16.77"
    expect(r.noseWidthIn).toBe(Math.floor((2 * (innerY - defaults.steeringClearanceIn)) / 0.125) * 0.125); // 14.0"
    expect(r.noseTaperStartIn).toBe(Math.ceil((rearBehindAxle + defaults.steeringClearanceIn + 0.0625) / 0.125) * 0.125); // 17.625"
    expect(r.noseTaperStartIn).toBe(17.625);
    expect(r.noseWidthIn).toBeGreaterThanOrEqual(13.5);
    expect(validateParams(defaults)).toEqual([]);
    expect(validateParams({ ...defaults, autoNoseGeometry: 0 })).toEqual([]);
  });
  it('is idempotent, pure, and a no-op when off', () => {
    const p = { ...defaults, frontTrackIn: 44, steerLockDeg: 33 };
    const once = resolveParams(p);
    expect(resolveParams(once)).toEqual(once);
    expect(p.noseWidthIn).toBe(defaults.noseWidthIn);
    const off = { ...p, autoNoseGeometry: 0, noseWidthIn: 14, noseTaperStartIn: 20 };
    expect(resolveParams(off)).toBe(off);
    expect(resolveParams(off).noseWidthIn).toBe(14);
  });
  it('nose is the widest 1/8" step under the swing limit, capped at the cabin; shoulder the smallest above it', () => {
    for (const frontTrackIn of [32, 35.5, 40, 48]) {
      const p = { ...defaults, frontTrackIn };
      const r = resolveParams(p);
      const d = derived(p);
      const limit = 2 * (d.swingInnerYIn - p.steeringClearanceIn);
      expect(r.noseWidthIn).toBeLessThanOrEqual(Math.min(limit, p.bodyWidthIn) + 1e-9);
      expect(r.noseWidthIn).toBeGreaterThan(Math.min(limit, p.bodyWidthIn) - 0.125 - 1e-9);
      const need = d.swingRearBehindAxleIn + p.steeringClearanceIn;
      expect(r.noseTaperStartIn).toBeGreaterThanOrEqual(need);
      expect(r.noseTaperStartIn).toBeLessThan(need + 0.0625 + 0.125 + 1e-9);
    }
  });
  it('buildModel / computeLayout / validateParams all see the resolved nose', () => {
    const p = { ...defaults, frontTrackIn: 40, noseWidthIn: 12, noseTaperStartIn: 14 };
    const r = resolveParams(p);
    const L = computeLayout(p);
    expect(L.hwN).toBeCloseTo(r.noseWidthIn / 2 - p.sideThicknessIn, 9);
    expect(L.xs).toBeCloseTo(p.wheelbaseIn - r.noseTaperStartIn, 9);
    expect(validateParams(p)).toEqual(validateParams(r));
    const deckNose = buildModel(p).find((x) => x.id === 'deck-nose')!;
    expect(worldAABB(deckNose).max[1] - worldAABB(deckNose).min[1]).toBeCloseTo(2 * L.hwN + 2 * p.deckCaptureDepthIn, 6); // the deck edges sit in the chine rabbets (D-35)
  });
  it('an auto nose too narrow for the rider reports the boot error (honest outcome)', () => {
    const errs = errorsOf({ ...defaults, steerLockDeg: 45 });
    expect(errs.some((i) => i.message.startsWith('The nose is'))).toBe(true);
  });
  it('front track and lock sliders are now mostly valid with auto on', () => {
    for (const k of ['frontTrackIn', 'steerLockDeg'] as const) {
      const d = PARAM_DEFS[k];
      let ok = 0, n = 0;
      for (let v = d.min; v <= d.max + 1e-9; v += d.step) { n++; if (!errorsOf({ ...defaults, [k]: v }).length) ok++; }
      expect(ok / n, k).toBeGreaterThanOrEqual(0.29); // 0.3 before the 5/8" chines (D-43) took 1/4" of the nose's inside width
    }
  });

  const N = 400;
  const J = ['frontTrackIn', 'steerLockDeg', 'kingpinLeadIn'] as const;
  const OTHERS: ParamKey[] = ['wheelbaseIn', 'rearTrackIn', 'deckHeightIn', 'bodyWidthIn', 'seatXIn', 'wheelDiameterIn', 'frontOverhangIn', 'rearOverhangIn', 'riderStatureIn', 'seatBackAngleDeg', 'storageVolumeIn3', 'sideHeightIn', 'gunwaleFlareIn'];
  const samples = (() => {
    const rnd = mulberry32(2026);
    const out: Params[] = [];
    for (let i = 0; i < N; i++) {
      // Base = the Phase 2 defaults with the Phase 1 UNSLEEVED ½" pin: this sweep is about the auto nose vs the manual nose, and the
      // default 1¼" sleeve only admits kingpinLeadIn = 1.5" (web rule), which would collapse the lead jitter to nothing.
      const p = { ...defaults, kingpinSleeveOdIn: 0, kingpinDiameterIn: 0.5 };
      for (const k of J) { const d = PARAM_DEFS[k]; p[k] = Math.min(d.max, Math.max(d.min, Math.round((d.min + rnd() * (d.max - d.min)) / d.step) * d.step)); }
      for (const k of OTHERS) {
        if (rnd() > 0.15) continue;
        const d = PARAM_DEFS[k];
        const v = d.default + (rnd() * 2 - 1) * 0.2 * (d.max - d.min);
        p[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      p.frontAxleBeamThicknessIn = Math.max(p.frontAxleBeamThicknessIn, Math.ceil((p.kingpinLeadIn + (p.axleDiameterIn + p.kingpinDiameterIn) / 2 + 2 * p.beamLigamentMinIn + p.sideBearerLengthIn - 1.5) * 8) / 8);
      out.push(p);
    }
    return out;
  })();
  it('jittering track, lock and lead: auto makes far more of the sweep valid, and every valid design is overlap-free (incl. transport)', () => {
    const t0 = Date.now();
    const validOff = samples.filter((p) => !errorsOf({ ...p, autoNoseGeometry: 0 }).length).length;
    const clean = samples.filter((p) => !errorsOf(p).length);
    console.log(`auto-nose fuzz: valid ${validOff}/${N} with auto off -> ${clean.length}/${N} with auto on`);
    const failures: string[] = [];
    for (const p of clean)
      for (const view of [{ steerDeg: 0 }, { steerDeg: p.steerLockDeg }, { steerDeg: -p.steerLockDeg }, { removed: true }]) {
        const bad = overlaps(buildModel(p, view));
        if (bad.length) failures.push(`${bad.slice(0, 3).join('; ')} @${JSON.stringify(view)} :: ${JSON.stringify(Object.fromEntries(([...J, ...OTHERS] as ParamKey[]).filter((k) => p[k] !== defaults[k]).map((k) => [k, p[k]])))}`);
      }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(clean.length).toBeGreaterThan(validOff * 2);
    expect(clean.length).toBeGreaterThanOrEqual(0.2 * N);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});

describe('round-3 carry-over validator rules', () => {
  it('rod-to-kingpin web >= rodKingpinWebMinIn', () => {
    const webErr = (p: Params) => errorsOf(p).some((i) => i.keys.includes('rodKingpinWebMinIn'));
    expect(webErr(defaults)).toBe(false);
    // Phase 1 hand numbers (½" bare pin): web = lead − rod radius − pin radius
    expect(webErr({ ...phase1, kingpinLeadIn: 1 })).toBe(true); // 1 - 0.375 - 0.25 = 0.375" < 0.5"
    expect(webErr({ ...phase1, kingpinLeadIn: 1, rodKingpinWebMinIn: 0.375 })).toBe(false);
    // Phase 2 default (1¼" OD sleeve): the web runs to the sleeve OD, so lead 1.5 − 0.375 − 0.625 = 0.5" just meets the 0.5" rule
    expect(webErr({ ...defaults, kingpinLeadIn: 1.375 })).toBe(true); // 0.375" < 0.5"
    expect(webErr({ ...defaults, kingpinLeadIn: 1.375, rodKingpinWebMinIn: 0.375 })).toBe(false);
  });
  it('foot stop must end inside the front transom inner face', () => {
    const stopErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The foot stop reaches'));
    expect(stopErr(defaults)).toBe(false);
    expect(stopErr({ ...defaults, wheelbaseIn: 40.5, rearOverhangIn: 14 })).toBe(true);
    // At the limit the model really has no foot-stop / front-transom overlap.
    const p = { ...defaults, frontOverhangIn: defaults.seatXIn + defaults.riderLegReachIn + defaults.footStopThickIn / 2 + defaults.sideThicknessIn - defaults.wheelbaseIn };
    if (!errorsOf(p).length) expect(overlaps(buildModel(p))).toEqual([]);
    expect(stopErr({ ...p, frontOverhangIn: p.frontOverhangIn - 0.01 })).toBe(true);
  });
  it('flared captured-ply sides may not bite into the chine/gunwale', () => {
    const flareErr = (p: Params) => errorsOf(p).some((i) => i.keys.includes('gunwaleFlareIn') && i.message.includes('tilts'));
    const bad = { ...defaults, bodyWidthIn: 25, sideHeightIn: 4.5, gunwaleFlareIn: 1 };
    expect(flareErr(bad)).toBe(true);
    expect(flareErr({ ...defaults, gunwaleFlareIn: 0 })).toBe(false);
    expect(flareErr({ ...defaults, gunwaleFlareIn: 1 })).toBe(false);
    expect(flareErr({ ...bad, sideConstruction: 0 })).toBe(false);
    for (const gunwaleFlareIn of [0.5, 1, 2, 3, 4]) for (const sideHeightIn of [3, 4.5, 7, 12]) {
      const p = { ...defaults, gunwaleFlareIn, sideHeightIn };
      if (!errorsOf(p).length) expect(overlaps(buildModel(p)), `flare ${gunwaleFlareIn} side ${sideHeightIn}`).toEqual([]);
    }
  });
});

describe('slider ranges (L1)', () => {
  it.each(['seatXIn', 'steerLockDeg', 'kingpinLeadIn', 'noseTaperStartIn'] as const)('%s: most of its range is valid at the other defaults', (k) => {
    const d = PARAM_DEFS[k];
    // kingpinLeadIn is judged at the Phase 1 configuration (bare ½" pin): at the Phase 2 defaults the 1¼" steel sleeve needs the full
    // 1.5" lead, so only the slider's top step is valid there (documented by the next test) and the "most of its range" property can't hold.
    const base = k === 'kingpinLeadIn' ? phase1 : defaults;
    let ok = 0, n = 0;
    for (let v = d.min; v <= d.max + 1e-9; v += d.step) {
      n++;
      if (!errorsOf({ ...base, [k]: v }).length) ok++;
    }
    expect(ok / n, `${k} valid fraction`).toBeGreaterThanOrEqual(0.25);
    expect(['seatXIn', 'steerLockDeg'].includes(k) ? ok / n : 1, k).toBeGreaterThanOrEqual(0.7);
    expect(errorsOf({ ...defaults, [k]: defaults[k] })).toEqual([]);
  });
  it('kingpinLeadIn at the Phase 2 defaults (1¼" sleeve, 4" beam): only the slider maximum 1.5" is valid (the default sits on the end stop)', () => {
    const d = PARAM_DEFS.kingpinLeadIn;
    const valid: number[] = [];
    for (let v = d.min; v <= d.max + 1e-9; v += d.step) if (!errorsOf({ ...defaults, kingpinLeadIn: v }).length) valid.push(v);
    expect(valid).toEqual([1.5]);
    expect(defaults.kingpinLeadIn).toBe(d.max);
  });
});

describe('kingpin through the bolster (D-12)', () => {
  const m = buildModel(defaults);
  const L = computeLayout(defaults);
  it('is on by default: an oak crossbar spans the bolster opening flush with the rails and the kingpin ends at its top', () => {
    expect(defaults.kingpinThroughBolster).toBe(1);
    const cb = m.find((x) => x.id === 'kingpin-crossbar')!;
    expect(cb).toBeDefined();
    const bb = worldAABB(cb);
    expect(bb.max[2]).toBeCloseTo(L.bolster.z1, 6);
    // D-35: the crossbar plate (3/16") lies on the turntable top plate, so the oak starts one plate thickness above the bolster rails' underside.
    expect(bb.min[2]).toBeCloseTo(L.bolster.z0 + defaults.kingpinPlateThickIn, 6);
    expect(L.kpPlates!.bar.z0).toBeCloseTo(L.bolster.z0, 6);
    expect(L.kingpin.z1).toBeCloseTo(L.bolster.z1, 6);
    const kp = worldAABB(m.find((x) => x.id === 'kingpin')!);
    expect(kp.max[2]).toBeCloseTo(bb.max[2], 6);
    // centerd on the kingpin, ends let into the fore/aft rails by kingpinCrossbarLetInIn
    expect((bb.min[0] + bb.max[0]) / 2).toBeCloseTo(L.kx, 6);
    expect(bb.max[0] - L.kx).toBeCloseTo(L.bolster.x1 - L.kx - L.bolster.rw + defaults.kingpinCrossbarLetInIn, 6);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(defaults.kingpinCrossbarWidthIn, 6);
  });
  it('off: no crossbar, the kingpin stops at the turntable top as before', () => {
    const p = { ...defaults, kingpinThroughBolster: 0 };
    const parts = buildModel(p);
    expect(parts.some((x) => x.id === 'kingpin-crossbar')).toBe(false);
    expect(computeLayout(p).kingpin.z1).toBeCloseTo(computeLayout(p).turntable.z1, 6);
    expect(validateParams(p)).toEqual([]);
  });
  it('the steering stops clear the crossbar over the whole sweep; a crossbar wide enough to be hit is rejected', () => {
    expect(errorsOf(defaults)).toEqual([]);
    const fat = { ...defaults, bolsterRailWidthIn: 2.5, kingpinCrossbarWidthIn: 4 };
    expect(errorsOf(fat).some((i) => i.message.includes('crossbar'))).toBe(true);
  });
  it('sleeve: steel tube mass in the beam bore (plate to plate with the kingpin plates, D-35) and the crossbar bore (Phase 1 pin); validator rules use the bore', () => {
    const p = { ...defaults, kingpinDiameterIn: 0.75, kingpinSleeveOdIn: 1.25, kingpinLeadIn: 1.5, frontAxleBeamThicknessIn: 4 };
    const parts = buildModel(p);
    const sb = parts.find((x) => x.id === 'kingpin-sleeve-beam')!;
    const Lp = computeLayout(p);
    const tube = (len: number) => ((Math.PI / 4) * (1.25 ** 2 - 0.75 ** 2) * len * p.steelDensityPcf) / 1728;
    // With the plates the one sleeve runs from the bottom of the beam plate to the top of the carrier (flush with both outer faces).
    expect(sb.massLb).toBeCloseTo(tube(Lp.kpPlates!.carrier.z1 - Lp.kpPlates!.under.z0), 6);
    expect(sb.body).toBe('steer');
    expect(parts.some((x) => x.id === 'kingpin-sleeve-bar')).toBe(false); // the crossbar needs no sleeve: the pin bears on the crossbar plate
    // Without the crossbar (Phase 1 pin) the Phase 2 pair of pressed tubes is unchanged.
    const legacy = buildModel({ ...p, kingpinThroughBolster: 0 });
    const Ll = computeLayout({ ...p, kingpinThroughBolster: 0 });
    expect(legacy.find((x) => x.id === 'kingpin-sleeve-beam')!.massLb).toBeCloseTo(tube(Ll.beamF.depth), 6);
    expect(legacy.some((x) => x.id === 'kingpin-sleeve-bar')).toBe(false); // no crossbar, no crossbar sleeve
    expect(buildModel({ ...p, kingpinSleeveOdIn: 0 }).some((x) => x.id.startsWith('kingpin-sleeve'))).toBe(false);
    // sleeve OD must exceed the pin
    expect(errorsOf({ ...defaults, kingpinSleeveOdIn: 0.5 }).some((i) => i.keys.includes('kingpinSleeveOdIn'))).toBe(true);
    // web rule uses the sleeve OD: lead 1.25 is enough for a ¾" pin alone but not for its 1¼" sleeve
    expect(errorsOf({ ...defaults, kingpinSleeveOdIn: 0, kingpinDiameterIn: 0.75, kingpinLeadIn: 1.25 })).toEqual([]);
    expect(errorsOf({ ...defaults, kingpinDiameterIn: 0.75, kingpinSleeveOdIn: 1.25, kingpinLeadIn: 1.25 }).some((i) => i.keys.includes('kingpinLeadIn'))).toBe(true);
    // crossbar must leave the ligament around the bore
    expect(errorsOf({ ...p, kingpinCrossbarWidthIn: 2 }).some((i) => i.keys.includes('kingpinCrossbarWidthIn'))).toBe(true);
  });
  it('auto nose: the swinging beam end never reaches the nose rail end (the tilted face needs clearance / cos(lock))', () => {
    for (const frontTrackIn of [34.5, 36.5, 38.5]) for (const frontAxleBeamThicknessIn of [3.5, 4]) {
      const p = { ...defaults, frontTrackIn, frontAxleBeamThicknessIn };
      if (errorsOf(p).length) continue;
      const lk = (p.steerLockDeg * Math.PI) / 180;
      const Lp = computeLayout(p);
      const beamAft = Math.abs(Lp.beamF.x - Lp.beamF.thick / 2 - Lp.kx);
      // perpendicular distance from the rail's outer end corner to the tilted aft face at lock
      const reach = beamAft / Math.cos(lk) + Lp.hwN * Math.tan(lk);
      expect((Lp.kx - Lp.noseRailEnd - reach) * Math.cos(lk)).toBeGreaterThanOrEqual(p.steeringClearanceIn - 1e-6);
    }
  });
});
