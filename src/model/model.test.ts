import { describe, expect, it } from 'vitest';
import { PARAM_DEFS, defaultParams, resolveParams, sanitizeParams, validateParams, type ParamKey, type Params } from '../params';
import { buildModel } from './index';
import { decodeHash } from '../state';
import { computeLayout } from './layout';
import { partsOverlap, worldAABB } from './bounds';
import { centerOfGravity, totalMass } from './mass';
import type { Part, PartGroup } from './types';

const TOL = 0.05;
const defaults = defaultParams();

interface Allow {
  a: RegExp;
  b: RegExp;
  why: string;
}
/** Intended contacts (kept short and justified; real clashes are fixed in the geometry instead). */
const ALLOW: Allow[] = [
  // ---- rear running gear
  { a: /^axle-/, b: /^(wheel-|beam-)/, why: 'axle passes through the hub bore and lies in a groove in the beam (D-10, D-15)' },
  { a: /^beam-/, b: /^wheel-/, why: 'tire OBB is a conservative box; the beam ends sit inside the rim, 1/8" short of the hub face' },
  { a: /^(axle-R[LR]?|beam-R)$/, b: /^axle-hanger-[LR]$/, why: 'the hanger is notched up from its bottom to straddle the beam and bear on its top (D-48 seat, moved to the hanger at D-54); the sweep has no notch geometry' },
  // ---- brake and handle
  { a: /^brake-shoe-/, b: /^wheel-R[LR]$/, why: 'the lined shoe presses on the tread; the tire OBB corner is not tire' },
  { a: /^brake-/, b: /^brake-/, why: 'pins and bolts pass through bored holes in the arms, tongues, beam and guard; the bar and the beam pass through slots in the swing arms; the shoe sits on the beam face; the arm rests 1/16" off the tongue (D-55). Moving-part clearances are swept in src/analysis/brake.test.ts' },
  { a: /^rail-[LR]$/, b: /^brake-pivot-bolt-[LR]$/, why: 'the brake arm\'s pivot bolt head is recessed 0.3" into the rail\'s outer face (a counterbore; boltIn in brake-layout.ts); the bolt is a box' },
  { a: /^beam-hold-down-[LR]$/, b: /^joist-1$/, why: 'the first joist butts the rear hanger\'s inner face where the hold-down angle\'s 3/16" upright leg also lies; the joist end is relieved 3/16" for the leg (fabrication detail the box model does not have). Real at the 8 in deck (D-56) only because joist-1 falls on the axle' },
  { a: /^handle-post-[LR]$/, b: /^handle-bar$/, why: 'the post top is sawn to the handlebow slope and the bow sits on it; the post OBB is its full rectangle, which pokes into the bow boxes above the sloped top (D-53)' },
  { a: /^handle-(socket|post|pin)-/, b: /^handle-(socket|post|pin)-/, why: 'the post is a slip fit in the socket tube and the clevis pin passes through both (D-9, D-39)' },
  { a: /^transom-rear$/, b: /^brake-latch-bolt$/, why: 'the parking-latch shoulder bolt passes through the lower edge of the transom (D-55)' },
  // ---- front pivot and the bridle (D-56). Decided per pair in pivot.test.ts as well; every entry is a contact, not a clash.
  { a: /^axle-F[LR]$/, b: /^(beam-F|wheel-F[LR])$/, why: 'the stub axle lies in a groove in the top of the beam end and passes through the hub bore (D-56; as at the rear)' },
  { a: /^beam-F$/, b: /^wheel-F[LR]$/, why: 'tire OBB is a conservative box; the beam ends sit inside the rim, 1/8" short of the hub face' },
  { a: /^kingpin$/, b: /^(beam-F|bridle-tongue|king-thrust|king-beam)$/, why: 'the kingpin bolt passes through bored holes in the axle beam, the tongue plate, the thrust washer bore and the king beam (the parts are boxes without the hole)' },
  { a: /^bridle-eye$/, b: /^(bridle-tongue|bridle)$/, why: 'the shackle pin passes through the tie hole in the tongue tip and the rope is tied round the shackle bow; the shackle mesh is a ring whose OBB over-covers the loop (D-56)' },
  { a: /^bridle$/, b: /^bridle-eye$/, why: 'the rope is tied to the shackle (D-56)' },
  { a: /^(lantern-mount|flag-mount)$/, b: /^bow-curl$/, why: 'printed inverted-U clip straddles the curl\'s top edge; the OBB of the U profile is its full bounding box (D-41, D-54)' },
  // ---- body: captured joints and sloped members
  { a: /^deck$/, b: /^(side-[LR]-chine|transom-rear)$/, why: 'the deck edge sits in the chine rabbets and the transom dado (D-35, D-45)' },
  { a: /^side-[LR]-web$/, b: /^(side-[LR]-(chine|gunwale)|transom-rear)$/, why: 'the side panel enters the chine and gunwale grooves and the transom stopped dados (D-35)' },
  { a: /^scupper-/, b: /^side-[LR]-chine$/, why: 'the 3/8" stainless drain nipple passes through its hole in the chine at deck level (M7, D-43)' },
  { a: /^seat-grip-pad-[LR]$/, b: /^side-[LR]-gunwale$/, why: 'the grip pad is a flat slab on the sloped gunwale: its OBB is a box, the gunwale is the tight sloped slab list, and the slab approximation leaves a 0.3" corner overlap' },
  { a: /^seat-wedge-[LR]$/, b: /^seat-(back-(stile|pad)|knob)-?[LR]?$/, why: 'oak wedge/post is a trapezoid extrusion whose sloped face is the stile\'s rear face; its OBB is the bounding box' },
];
const matches = (r: Allow, a: Part, b: Part) => (r.a.test(a.id) && r.b.test(b.id)) || (r.a.test(b.id) && r.b.test(a.id));

const SOLID: PartGroup[] = ['frame', 'body', 'front-end', 'running-gear', 'seat', 'storage', 'brake', 'removable', 'lighting', 'hardware'];

/**
 * Clashes that exist only OFF the defaults, found when the variants and the fuzz were swept. They are real geometry problems at the extremes, not contact allowances, so
 * they are listed apart from ALLOW: the defaults are tested strictly (no entries), the variant and fuzz sweeps tolerate ONLY these pairs, and any other new clash
 * still fails. Delete an entry when its geometry is fixed. (Phase 3c-3a: the entries below are the clashes the new variant sweep found in the storage, handle and lighting builders.)
 */
const KNOWN_OFF_DEFAULT: RegExp[] = [
  // Found when the Phase 3c-3a variants were swept (src/model/storage.ts, handle.ts, lighting.ts are other agents' files; reported, not patched):
  /^storage-end-aft x storage-lid-stay:/, // seatXMin: the shortest rear box the validator allows is too short for its lid stay and rims
  /^storage-lid x storage-rim-end-(aft|fore):/,
  /^storage-rim-end-aft x storage-rim-end-fore:/,
  /^handle-(socket|pin)-[LR] x handle-bar:/, // deck 17+ in / rear side 22 in: the handlebow sits at a fixed height above the rear transom's fittings
  /^handle-bar x rear-light(-mount)?:/,
  /^(handle-socket|handle-post)-R x rear-light-mount:/, // a 20 in body: the rear light mount meets the right handle socket
  /^transom-backer-[LR] x doubler-rear-light:/, // bodies 22 in and narrower: the right handle backer meets the rear-light doubler
  /^transom-backer-[LR] x doubler-lash-[LR]1:/, // sag 3: a lash doubler runs into the transom backer by 0.1 in
  /^bow-curl x doubler-lash-[LR]3:/, // a 50 deg curl: the front lash doubler lies 0.06 in into the curl
  // Pivoting front axle (D-56), found when the variants were swept; validateParams does not yet catch them:
  /^bridle-tongue x steer-stop-[LR]:/, // lock >= ~25 deg (or a wide body): the tongue plate (2.5 in bar) swings into the inboard stop blocks, which move inward as the lock grows
  /^steer-stop-L x steer-stop-R:/, // lock 35 deg: the stop contact point comes within the block width of the center line
  /^clamp-F[LR][34] x king-beam:/, // tongue + thrust washer thinner than the 3/8 in clamp plates (tongueThickIn + kingThrustThickIn < clampPlateThickIn): the king beam bottom is below the plate tops
  /^joist-[17] x (bridle-tongue|beam-F|axle-F[LR]|clamp-F[LR]\d|axle-R|beam-R):/, // a deep crossmember (crossmemberDepthIn >= ~2 at the 8 in deck) hangs below the tops of the beams / the tongue plate: no validator rule yet
  /^(axle-R|beam-R) x joist-1:/,
  /^beam-hold-down-[LR] x deck:/, // overslung rear beam at a low deck (D-56): validateParams only asks deck >= beam top + ply
  /^wheel-F[LR] x clamp-F[LR]\d:/, // a tire wider than the hub: the tire OBB over-covers the stub clamp plate next to the hub (the same OBB conservatism as beam x wheel in ALLOW, seen only with tireWidthIn > hubLengthIn + ~1)
  /^clamp-F[LR]\d x joist-[67]:/, // front beam at a joist (wheelbase / king beam length combos): the clamp plates on the beam top reach the joist underside
  /^(beam-F|clamp-F[LR]\d|axle-F[LR]) x rail-[LR]:/, // lock >= 30 deg: the beam's trailing corner passes the rail step within 0.2 in, and the 1.46 in slab cover of the 45 degree ramp over-reports (the exact swept check is in pivot.test.ts)
  /^steer-rope-[LR] x /, // steerRopesOn: the optional rope is a straight schematic line from the axle end back 96 in, through the rear wheel, brake and rail; hidden in the viewer
  /^(axle-F[LR]|beam-F|wheel-F[LR]) x steer-rope-[LR]:/,
  /^(axle-R|beam-R) x steer-rope-[LR]:/,
];
const KNOWN_FUZZ_ONLY: RegExp[] = [
  /^seat-cushion x (doubler-grip|doubler-lash|lash)-[LR]\d?:/, // under-seat storage with an 18 in deep seat or a body of 21 in or less: the cushion runs into the grip / lash doublers
  /^doubler-grip-[LR] x storage-rim-side-[LR]:/, // a narrow body: the grip doubler meets the storage box rim
  /^storage-(side|rim-side|coaming-side|gasket-side)-[LR] x doubler-lash-[LR]2:/, // a narrow body: the middle lash doubler meets the storage box side
];
let fuzzMode = false;
const isKnown = (b: string) => KNOWN_OFF_DEFAULT.some((r) => r.test(b)) || (fuzzMode && KNOWN_FUZZ_ONLY.some((r) => r.test(b)));

function overlaps(parts: Part[], tolerateKnown = false) {
  const solid = parts.filter((p) => !p.payload && SOLID.includes(p.group));
  const bad: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const o = partsOverlap(solid[i], solid[j]); // tight boxes: a bent member's bounding box would clash with half the hull (D-45)
      if (o > TOL && !ALLOW.some((r) => matches(r, solid[i], solid[j]))) {
        const msg = `${solid[i].id} x ${solid[j].id}: ${o.toFixed(3)}"`;
        const rev = `${solid[j].id} x ${solid[i].id}: ${o.toFixed(3)}"`;
        if (!(tolerateKnown && (isKnown(msg) || isKnown(rev)))) bad.push(msg);
      }
    }
  }
  return bad;
}

describe('buildModel structure', () => {
  const parts = buildModel(defaults);
  it('defaults validate clean (errors and warnings; the info messages are notes)', () => expect(validateParams(defaults).filter((i) => i.severity !== 'info')).toEqual([]));
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
  it('steering angle: every part of the front axle body and both front wheels turn about the kingpin (detail in pivot.test.ts); the chassis and the rear stay', () => {
    const L = computeLayout(defaults);
    const yaw = (m: Part[], id: string) => { const t = m.find((x) => x.id === id)!.transform; return Math.atan2(t[1], t[0]); };
    const neutral = buildModel(defaults);
    const at = buildModel(defaults, { steerDeg: 15 });
    expect(yaw(at, 'wheel-FL')).toBeCloseTo((15 * Math.PI) / 180, 9);
    expect(yaw(at, 'wheel-FR')).toBeCloseTo((15 * Math.PI) / 180, 9); // parallel wheels: no Ackermann
    const turning = (x: Part) => x.body === 'front-axle' || x.body === 'wheel-FL' || x.body === 'wheel-FR';
    expect(neutral.filter(turning).map((x) => x.id)).toEqual(expect.arrayContaining(['beam-F', 'axle-FL', 'axle-FR', 'kingpin', 'bridle-tongue', 'bridle-eye', 'bridle', 'wheel-FL', 'wheel-FR', 'clamp-FL1', 'clamp-FR4']));
    for (const a of at) {
      const b = neutral.find((x) => x.id === a.id)!;
      const moved = a.transform.some((v, k) => Math.abs(v - b.transform[k]) > 1e-6);
      if (turning(a)) {
        // the part turned about the vertical axis through the kingpin (L.king.x, 0): a point on the kingpin axis would stay put
        expect(moved || (Math.abs(a.transform[12] - L.king.x) < 1e-9 && Math.abs(a.transform[13]) < 1e-9), a.id).toBe(true);
      } else expect(moved, a.id).toBe(false);
    }
    for (const id of ['king-beam', 'king-thrust', 'steer-stop-L', 'deck', 'rail-L', 'wheel-RL', 'beam-R']) expect(at.find((x) => x.id === id)!.transform, id).toEqual(neutral.find((x) => x.id === id)!.transform);
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
  it('the rear axle hangers straddle the rear beam: oak on the inside of each rail, bottom below the beam top by the seat notch, top at the deck underside', () => {
    const L = computeLayout(defaults);
    for (const [tag, s] of [['L', 1], ['R', -1]] as const) {
      const h = parts.find((x) => x.id === `axle-hanger-${tag}`)!;
      const b = worldAABB(h), r = worldAABB(parts.find((x) => x.id === `rail-${tag}`)!);
      expect(h.material).toBe('white oak');
      expect(b.max[2]).toBeCloseTo(L.deckBot, 9);
      expect(b.min[2]).toBeCloseTo(L.beamR.top - defaults.axleSeatNotchIn, 9);
      expect(b.max[0] - b.min[0]).toBeCloseTo(defaults.axleHangerWidthIn, 9);
      expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(L.beamR.x, 9);
      // on the inner face of the rail, 3/4" thick
      expect(s > 0 ? b.max[1] : -b.min[1]).toBeCloseTo(s > 0 ? r.min[1] : -r.max[1], 9);
      expect(b.max[1] - b.min[1]).toBeCloseTo(defaults.axleHangerThickIn, 9);
      expect(h.joints!.some((j) => j.type === 'dado' && j.to === 'beam-R')).toBe(true);
    }
  });
});

describe('overlaps', () => {
  const lock = defaults.steerLockDeg;
  it.each([0, 10, -10, lock, -lock])('no unintended overlaps at steer %d deg', (deg) => {
    expect(overlaps(buildModel(defaults, { steerDeg: deg }))).toEqual([]);
  });
  it('also clean in the removed (transport) configuration (the stowed seat is swept in seat-stow.test.ts)', () => {
    expect(overlaps(buildModel(defaults, { removed: true }))).toEqual([]);
  });
  it('ALLOW is minimal: every entry (apart from the brake and handle ones) is used by some part pair at the defaults or a steered pose (a dead entry is a contact that no longer exists)', () => {
    const seen = new Set<string>();
    const pairs: [Part, Part][] = [];
    for (const deg of [0, lock, -lock]) {
      const set = buildModel(defaults, { steerDeg: deg }).filter((p) => !p.payload && SOLID.includes(p.group));
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
        if (partsOverlap(set[i], set[j]) <= TOL) continue;
        const k = `${set[i].id}|${set[j].id}`;
        if (!seen.has(k)) { seen.add(k); pairs.push([set[i], set[j]]); }
      }
    }
    // The handle and brake entries cover geometry that is swept elsewhere: not checked for use.
    const dead = ALLOW.filter((r) => !/brake|handle/.test(`${r.a.source}${r.b.source}`) && !pairs.some(([x, y]) => matches(r, x, y)));
    expect(dead.map((r) => r.why.slice(0, 60))).toEqual([]);
  });
});

/** Documented empty masses at defaults (D-56, the pivoting front axle), lb. Printed by the breakdown test below.
 * D-56: the two purchased 8 lb casters (23.1 lb) are replaced by the soapbox axle (the front-end group, about 17 lb: beam-F 5.1, two stubs 3.0, eight clamp plates 1.0, tongue plate 2.8,
 * king beam 3.3, kingpin 0.4, bridle 0.9, stops 0.1) and the deck drops from 14.75 to 8 in; the running gear (four 10 in wheels at 5 lb, two axles, the rear beam) is about 27 lb. Empty total about 134 lb
 * with the foot brake in (135 at Phase 3c-3a with the casters, 145 at Phase 3c-1, 174 at the Phase 3b flip).
 * The band is +/-10% overall, +/-25% per group (the front-end group is new and its parts move with the params). The brake group is wide and so is the hardware remainder,
 * which counts the joints of the parts actually present. */
const EXPECTED_EMPTY_LB = 134;
const EXPECTED_GROUP_LB: Record<string, number> = {
  'running-gear': 27.4, 'front-end': 16.7, frame: 12.9, body: 39.0, seat: 10.0, storage: 9.8, removable: 2.5, lighting: 1.4,
};
/** Groups with a wide band [low, high] (lb): the brake and the fastener remainder. */
const WIDE_GROUP_LB: Record<string, [number, number]> = { brake: [4, 14], hardware: [2.5, 6.5] };
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
    // (and the group table above) deliberately when the design changes. The Phase 3c goal is about 100-120 lb.
    expect(empty).toBeGreaterThan(EXPECTED_EMPTY_LB * 0.9);
    expect(empty).toBeLessThan(EXPECTED_EMPTY_LB * 1.1);
    for (const [g, lb] of Object.entries(EXPECTED_GROUP_LB)) {
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeGreaterThan(lb * 0.75);
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeLessThan(lb * 1.25);
    }
    for (const [g, [lo, hi]] of Object.entries(WIDE_GROUP_LB)) {
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeGreaterThan(lo);
      expect(rows[g]?.massLb ?? 0, `group ${g}`).toBeLessThan(hi);
    }
    expect(rows.steering).toBeUndefined();
    expect(rows.casters).toBeUndefined(); // the casters are gone (D-56); the front axle is the 'front-end' group
  });
  it('the front-end group (D-56) is the axle beam, its two stubs and eight clamp plates, the kingpin, thrust washer, king beam, tongue plate, shackle, rope and the two stops; 10-25 lb', () => {
    const c = parts.filter((x) => x.group === 'front-end');
    const m = c.reduce((a, x) => a + x.massLb, 0);
    const ids = ['beam-F', 'axle-FL', 'axle-FR', ...['L', 'R'].flatMap((t) => [1, 2, 3, 4].map((k) => `clamp-F${t}${k}`)), 'kingpin', 'king-thrust', 'king-beam', 'bridle-tongue', 'bridle-eye', 'bridle', 'steer-stop-L', 'steer-stop-R'];
    expect(c.map((x) => x.id).sort()).toEqual([...ids].sort());
    expect(m).toBeGreaterThan(10);
    expect(m).toBeLessThan(25);
    // the front wheels are in the running gear with the rear ones
    expect(parts.filter((x) => x.group === 'running-gear' && x.geometry.type === 'wheel').map((x) => x.id).sort()).toEqual(['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR']);
  });
  it('the block-model artefacts stay gone: seat and storage lid are real members, not slabs, and the Ackermann front end, the casters and the old hull are not back', () => {
    expect(parts.some((x) => x.id === 'seat-base')).toBe(false);
    expect(parts.some((x) => /^(bolster|turntable|kp-|spindle|side-bearer|tie-rod|tongue|ack|caster-|bow-block|tip-swivel|front-hanger-)/.test(x.id))).toBe(false);
    const seatBack = parts.filter((x) => x.id.startsWith('seat-back-') && x.id !== 'seat-back-pad');
    expect(seatBack.map((x) => x.id).sort()).toEqual(['seat-back-panel', 'seat-back-rail-bottom', 'seat-back-rail-top', 'seat-back-stile-L', 'seat-back-stile-R']);
    expect(seatBack.reduce((m, x) => m + x.massLb, 0)).toBeLessThan(4);
    const lid = parts.find((x) => x.id === 'storage-lid')!;
    expect(lid.kind).toBe('sheet');
    expect((lid.geometry as { size: number[] }).size[2]).toBeCloseTo(defaults.panelPlyIn, 6);
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
  it('drops exactly the removable parts: the bridle (tongue plate, shackle, rope), the handle, the seat back and the signs come off for the truck; the front axle, king beam, stops and wheels stay', () => {
    const full = buildModel(defaults);
    const removed = buildModel(defaults, { removed: true });
    expect(removed.map((p) => p.id)).toEqual(full.filter((p) => !p.removable).map((p) => p.id));
    const gone = full.filter((p) => p.removable).map((p) => p.id);
    expect(gone).toEqual(expect.arrayContaining(['seat-back-panel', 'seat-back-stile-L', 'handle-bar', 'handle-post-L', 'handle-post-R', 'bridle', 'bridle-eye', 'bridle-tongue']));
    for (const id of ['beam-F', 'kingpin', 'king-beam', 'king-thrust', 'steer-stop-L', 'steer-stop-R', 'axle-FL', 'wheel-FL', 'wheel-FR', 'bow-curl', 'deck', 'transom-rear']) expect(removed.some((p) => p.id === id), id).toBe(true);
    expect(gone.some((id) => /^sign/.test(id))).toBe(false); // the signs are off by default
    // taking the tongue off shortens the cart to the bow tip (the tongue reaches tongueTieAheadIn past it)
    const reach = (ps: Part[]) => Math.max(...ps.filter((x) => !x.payload).map((x) => worldAABB(x).max[0]));
    expect(reach(removed)).toBeGreaterThanOrEqual(computeLayout(defaults).xFront - 1e-6);
    expect(reach(removed)).toBeLessThan(computeLayout(defaults).xFront + 0.5); // the bow tip plus the edge banding
    expect(reach(full.filter((x) => x.id !== 'bridle'))).toBeGreaterThan(computeLayout(defaults).xFront + defaults.tongueTieAheadIn - 0.01);
  });
});

describe('param sweeps', () => {
  const all = Object.keys(PARAM_DEFS) as ParamKey[];
  const primary = all.filter((k) => PARAM_DEFS[k].primary);
  const check = (p: Params, label: string) => {
    for (const v of [{}, { steerDeg: 20, rider: 'goal' as const }, { steerDeg: -90 }, { removed: true }]) {
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
  }, 60000); // heavy sweep; shared CI runners are 2-3x slower
  it('whole-design extremes do not throw', () => {
    const lo = { ...defaults }, hi = { ...defaults };
    for (const k of all) { lo[k] = PARAM_DEFS[k].min; hi[k] = PARAM_DEFS[k].max; }
    check(lo, 'all-min');
    check(hi, 'all-max');
  });
  it('alternate axle, storage, ply, tire and sign options build', () => {
    for (const patch of [
      { axleStyle: 1 }, { storageLocation: 2 }, { axleBeamPosition: 1, deckHeightIn: 12 }, { plySpecies: 1 }, { tireType: 1 }, { showSideSigns: 1 },
    ]) check({ ...defaults, ...patch }, JSON.stringify(patch));
  });
  it('the removed options are gone from PARAM_DEFS (frame style, side construction, casters, bow block) so no URL can select them', () => {
    for (const k of ['frameStyle', 'sideConstruction', 'casterSpacingIn', 'bowBlockThickIn', 'bridleEyeHeightIn', 'noseWidthIn', 'hullCurveStartIn', 'tongueLengthIn', 'kingpinLeadIn', 'sideHeightIn', 'sheerRiseIn', 'autoNoseGeometry'])
      expect(all, k).not.toContain(k);
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
  overslungBeam: { axleBeamPosition: 1, deckHeightIn: 12 }, // the REAR beam over the rod; at the 8 in deck it runs into joist-1 and the hold-downs (validateParams only asks deck >= beam top + ply). The front beam is always underslung
  seatXMin: { seatXIn: seatMin },
  seatXMax: { seatXIn: seatMax },
  deckSlop0: { deckSlopIn: 0 },
  deck6: { deckHeightIn: 6 },
  deck10: { deckHeightIn: 10 },
  deck14: { deckHeightIn: 14 },
  deck18: { deckHeightIn: 18 },
  wheel8: { wheelDiameterIn: 8 },
  wheel11_5: { wheelDiameterIn: 11.5 },
  stubAxles: { axleStyle: 1 },
  'stubAxles+deep': { axleStyle: 1, axleBeamDepthIn: 3 },
  storageRear: { storageLocation: 0 },
  storageUnderSeat: { storageLocation: 2 },
  'underSeat+riser': { storageLocation: 2, seatRiserIn: 1.5 },
  riser: { seatRiserIn: 1.5 },
  flatFree: { tireType: 1 },
  birch: { plySpecies: 1 },
  body20: { bodyWidthIn: 20 },
  body22: { bodyWidthIn: 22 },
  body26: { bodyWidthIn: 26, frontTrackIn: 38 }, // a wider body needs a wider front track for the lock (D-56)
  body28: { bodyWidthIn: 28, frontTrackIn: 40 },
  'body30+track': { bodyWidthIn: 30, rearTrackIn: 40, frontTrackIn: 44 },
  'track30+body': { rearTrackIn: 30, bodyWidthIn: 22 },
  track44: { rearTrackIn: 44 },
  'wheelbase40+seat': { wheelbaseIn: 40, seatXIn: 12 },
  wheelbase52: { wheelbaseIn: 52 },
  'wheelbase56+front': { wheelbaseIn: 56, frontOverhangIn: 14, rearOverhangIn: 6 },
  rearOverhang14: { rearOverhangIn: 14 },
  frontOverhang16: { frontOverhangIn: 16 },
  sideRear10: { sideHeightRearIn: 10 },
  sideRear22: { sideHeightRearIn: 22 },
  sideRear8: { sideHeightRearIn: 8 },
  sideBow5: { sideHeightBowIn: 5 },
  sag2: { sideProfileSagIn: 2 },
  sagUp1: { sideProfileSagIn: -1 },
  sag3: { sideProfileSagIn: 3 },
  curlR5: { bowCurlRadiusIn: 5, bowCurlAngleDeg: 90 },
  curlR10: { bowCurlRadiusIn: 10, frontOverhangIn: 16 },
  curl60: { bowCurlAngleDeg: 60, bowCurlRadiusIn: 12, frontOverhangIn: 18 },
  curl90: { bowCurlAngleDeg: 90 },
  curl50: { bowCurlAngleDeg: 50, bowCurlRadiusIn: 14, frontOverhangIn: 18 },
  curl6plies: { bowCurlPlies: 6 },
  // the pivoting front axle (D-56)
  lock10: { steerLockDeg: 10, frontOverhangIn: 12 },
  lock30: { steerLockDeg: 30, frontTrackIn: 42 },
  lock35: { steerLockDeg: 35, frontTrackIn: 46 },
  track30: { frontTrackIn: 30 },
  frontTrack44: { frontTrackIn: 44 },
  track52: { frontTrackIn: 52, rearTrackIn: 52, bodyWidthIn: 30 },
  'body26+track': { bodyWidthIn: 26, frontTrackIn: 39 },
  kingBeam2: { kingBeamLengthIn: 2 },
  kingBeam5: { kingBeamLengthIn: 5 },
  thrust3: { kingThrustOdIn: 3.5, kingThrustThickIn: 0.5, tongueHeadWidthIn: 6 },
  thrust15: { kingThrustOdIn: 1.5, kingThrustThickIn: 0.125 },
  tongueShort: { tongueTieAheadIn: 2 },
  tongueLong: { tongueTieAheadIn: 12 },
  tongueThick: { tongueThickIn: 0.375, tongueWidthIn: 4, tongueHeadWidthIn: 5 },
  stubShort: { frontStubLenIn: 4 },
  stubLong: { frontStubLenIn: 14 },
  kingpin3_4: { kingpinDiaIn: 0.75, tongueBoltDiaIn: 0.5, steerStopBoltDiaIn: 0.5 },
  kingpin1_2: { kingpinDiaIn: 0.5, tongueBoltDiaIn: 0.25, steerStopBoltDiaIn: 0.25 },
  ropesOn: { steerRopesOn: 1 },
  ropesLong: { steerRopesOn: 1, steerRopeRunIn: 144 },
  signsOn: { showSideSigns: 1 },
  signsOnTall: { showSideSigns: 1, sideHeightRearIn: 18 },
  hangerWide: { axleHangerWidthIn: 7, axleHangerThickIn: 1 },
};
const variantCases = Object.entries(VARIANTS).map(([name, patch]) => ({ name, p: { ...defaults, ...patch } as Params }));
const valid = variantCases.filter((v) => !errorsOf(v.p).length);
const skipped = variantCases.filter((v) => errorsOf(v.p).length);

describe('variants', () => {
  it('the extremes of the validated seat range are real (seat min/max found)', () => {
    expect(Number.isFinite(seatMin) && Number.isFinite(seatMax)).toBe(true);
    expect(seatMin).toBeLessThan(defaults.seatXIn);
    // The default seat is at the forward limit of the flat deck, so the range only reaches back (D-54: the seat cushion must stand on the flat deck).
    expect(seatMax).toBeGreaterThanOrEqual(defaults.seatXIn);
    // One step beyond the extremes is rejected: the validator is what stops the impossible seat positions.
    expect(errorsOf({ ...defaults, seatXIn: seatMin - 0.5 }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...defaults, seatXIn: seatMax + 0.5 }).length).toBeGreaterThan(0);
  });
  it('most variants are valid; raw extremes that are impossible are skipped with a reason', () => {
    expect(valid.length).toBeGreaterThanOrEqual(variantCases.length - 20);
    for (const v of skipped) expect(errorsOf(v.p)[0].message.length, v.name).toBeGreaterThan(20);
    // The feasible ones must really be feasible.
    for (const n of ['overslungBeam', 'seatXMin', 'seatXMax', 'wheel8', 'stubAxles', 'body22', 'body26', 'sag2', 'lock30', 'frontTrack44', 'kingBeam5', 'deck10', 'signsOn', 'storageUnderSeat', 'sideBow5', 'wheelbase52'])
      expect(valid.some((v) => v.name === n), n).toBe(true);
  });
  it.each(valid.map((v) => [v.name, v.p] as const))('no unintended overlaps: %s (neutral, full lock each way, the transport configuration)', (_n, p) => {
    for (const view of [{ steerDeg: 0 }, { steerDeg: 99 }, { steerDeg: -99 }, { removed: true }]) // steerDeg is clamped to the variant's lock
      expect(overlaps(buildModel(p, view), true), JSON.stringify(view)).toEqual([]);
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
    // Nothing else hangs below the minimum ground clearance (the validator warns about a too-deep beam instead of erroring). The kingpin head and its plate washer hang 0.45 in
    // below the front beam (see the ground-clearance test below), so they get a looser bound.
    const warned = validateParams(p).some((i) => i.keys.includes('minGroundClearanceIn'));
    if (!warned)
      for (const x of parts.filter((q) => !q.payload && q.geometry.type !== 'wheel' && q.id !== 'kingpin'))
        expect(worldAABB(x).min[2], x.id).toBeGreaterThanOrEqual(p.minGroundClearanceIn - 1e-6);
  });
  it('ground contact at defaults: 4 tire bottoms at z = 0 and the lowest structure at or above the minimum ground clearance; the kingpin head and plate washer are the one low point', () => {
    const parts = buildModel(defaults);
    const low = Math.min(...parts.filter((q) => !q.payload && q.geometry.type !== 'wheel' && q.id !== 'kingpin').map((q) => worldAABB(q).min[2]));
    expect(low).toBeGreaterThanOrEqual(defaults.minGroundClearanceIn);
    // FINDING (reported to the coordinator): the kingpin bolt head + plate washer hang 0.45 in below the front beam bottom (3.125 in): 2.675 in off the ground, under the 3 in minimum.
    const king = worldAABB(parts.find((q) => q.id === 'kingpin')!).min[2];
    expect(king).toBeCloseTo(computeLayout(defaults).beamF.bot - 0.45, 9);
    expect(king).toBeGreaterThan(2.5);
  });
});

/** Rider segments vs every non-payload part; the mannequin is rough, so a 0.1" tolerance. */
function riderClashes(parts: Part[], tol = 0.1): string[] {
  const riders = parts.filter((x) => x.body === 'rider');
  const structure = parts.filter((x) => !x.payload);
  const bad: string[] = [];
  for (const r of riders) for (const q of structure) {
    const o = partsOverlap(r, q);
    if (o > tol) bad.push(`${r.id} x ${q.id}: ${o.toFixed(2)}"`);
  }
  return bad;
}

describe('rider clearance consistency', () => {
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
});

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
    expect(dir('beam-F')[2]).toBeLessThan(-0.9); // the pivoting front axle drops away from the king beam (D-56)
    expect(dir('bridle-tongue')[0]).toBeGreaterThan(0.8); // the tongue plate slides forward
    expect(dir('beam-R')[2]).toBeLessThan(-0.9);
    expect(dir('bridle')[0]).toBeGreaterThan(0.9); // the rope bridle separates forward
    expect(dir('bridle-eye')[0]).toBeGreaterThan(0.8);
    expect(dir('bow-curl')[0]).toBeGreaterThan(0.5);
    expect(dir('side-L-web')[1]).toBeGreaterThan(0.9);
    expect(dir('side-R-web')[1]).toBeLessThan(-0.9);
    expect(dir('seat-cushion')[2]).toBeGreaterThan(0.9);
    expect(dir('seat-back-panel')[0]).toBeLessThan(-0.4);
    expect(dir('storage-lid')[2]).toBeGreaterThan(0.9);
    expect(dir('handle-bar')[0]).toBeLessThan(-0.8);
    expect(dir('rail-L')[2]).toBeLessThan(-0.5);
    expect(dir('deck')[2]).toBeGreaterThan(0.9);
    // Not all one direction: the exploded view separates the assembly.
    const distinct = new Set(parts.filter((x) => !x.payload).map((x) => x.explode!.map((v) => v.toFixed(1)).join(',')));
    expect(distinct.size).toBeGreaterThan(15);
  });
});

// ── Steer sweep: every part that turns with the front axle stays clear of the chassis over the whole steering range ───────────────────────────────────────
describe('steer sweep', () => {
  const turning = (x: Part) => x.body === 'front-axle' || x.body === 'wheel-FL' || x.body === 'wheel-FR';
  const sweep = (p: Params, label: string, tolerateKnown = false) => {
    const bad: string[] = [];
    const lock = Math.floor(p.steerLockDeg);
    for (let deg = -lock; deg <= lock; deg += 2) {
      const parts = buildModel(p, { steerDeg: deg });
      const moving = parts.filter((x) => !x.payload && turning(x));
      const fixed = parts.filter((x) => !x.payload && !turning(x) && SOLID.includes(x.group) && !/^brake-/.test(x.id));
      for (const a of moving) for (const b of fixed) {
        const o = partsOverlap(a, b);
        if (o > TOL && !ALLOW.some((r) => matches(r, a, b)) && !(tolerateKnown && (isKnown(`${a.id} x ${b.id}:`) || isKnown(`${b.id} x ${a.id}:`)))) bad.push(`${label} ${a.id} x ${b.id} @${deg}: ${o.toFixed(2)}`);
      }
    }
    return bad;
  };
  it('nothing on the front axle hits the chassis anywhere in the steering range at the defaults (the full sweep in 1 degree steps is in pivot.test.ts)', () => {
    expect(sweep(defaults, 'defaults')).toEqual([]);
  }, 120000);
  it('and for a wider body and track, a bigger lock, storage in the other place, a taller deck and a longer king beam', () => {
    const bad: string[] = [];
    for (const patch of [{ bodyWidthIn: 26, frontTrackIn: 39 }, { storageLocation: 2 }, VARIANTS.lock30, { deckHeightIn: 14 }, VARIANTS.kingBeam5, VARIANTS.thrust3]) {
      const p = { ...defaults, ...patch };
      if (!errorsOf(p).length) bad.push(...sweep(p, JSON.stringify(patch), true));
    }
    expect(bad).toEqual([]);
  }, 180000);
});

// ── Validator rules ──────────────────────────────────────────────────────────────────────────────────────────────
describe('validator rules', () => {
  it('rear U-bolt plates stay clear of the rails and sides (M3)', () => {
    const railErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The rails/sides reach'));
    expect(railErr({ ...defaults, bodyWidthIn: 30, rearTrackIn: 35.5 })).toBe(true);
    for (const bodyWidthIn of [22, 24, 26, 28, 29, 29.5, 30]) {
      const p = { ...defaults, bodyWidthIn };
      if (!errorsOf(p).length) expect(overlaps(buildModel(p), true), `body ${bodyWidthIn}`).toEqual([]);
    }
  });
  it('the body must leave the rear tires 3/4" each side', () => {
    expect(errorsOf({ ...defaults, bodyWidthIn: 33 }).some((i) => i.keys.includes('bodyWidthIn'))).toBe(true);
  });
  it('foot stop must end on the flat deck (the curl starts at xFlatEnd; 1/2" to spare for the front joist)', () => {
    const stopErr = (p: Params) => errorsOf(p).some((i) => i.message.startsWith('The foot stop reaches'));
    expect(stopErr(defaults)).toBe(false);
    const stopFront = defaults.seatXIn + defaults.riderLegReachIn + defaults.footStopThickIn / 2;
    const R = defaults.bowCurlRadiusIn, run = R * Math.sin((defaults.bowCurlAngleDeg * Math.PI) / 180);
    // xFlatEnd = wheelbase + frontOverhang - run must be >= stopFront + 1/2
    const needOverhang = stopFront + 0.5 + run - defaults.wheelbaseIn;
    expect(needOverhang).toBeLessThanOrEqual(defaults.frontOverhangIn);
    expect(stopErr({ ...defaults, frontOverhangIn: needOverhang })).toBe(false);
    expect(stopErr({ ...defaults, frontOverhangIn: needOverhang - 0.01 })).toBe(true);
    // a bigger curl eats the flat deck: a 10 in radius at the default overhang puts the foot stop on the curl
    expect(stopErr({ ...defaults, bowCurlRadiusIn: 10 })).toBe(true);
    expect(stopErr({ ...defaults, wheelbaseIn: 36, frontOverhangIn: 6 })).toBe(true);
  });
  it('the rider\'s feet must stay on the flat deck, and the leaning seat back must stay off the rear transom', () => {
    const seatErr = (p: Params) => errorsOf(p).filter((i) => /feet extend onto the bow curl|leaning seat back would hit/.test(i.message));
    expect(seatErr(defaults)).toEqual([]);
    expect(seatErr({ ...defaults, seatXIn: 17.5 }).some((i) => /feet extend onto the bow curl/.test(i.message))).toBe(true);
    expect(seatErr({ ...defaults, frontOverhangIn: 9 }).some((i) => /feet extend onto the bow curl/.test(i.message))).toBe(true);
    expect(seatErr({ ...defaults, seatXIn: 1.5, seatBackHeightIn: PARAM_DEFS.seatBackHeightIn.max }).some((i) => /leaning seat back would hit/.test(i.message))).toBe(true);
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
    'wheelbaseIn', 'rearTrackIn', 'deckHeightIn', 'bodyWidthIn', 'seatXIn', 'wheelDiameterIn', 'rearOverhangIn', 'frontOverhangIn', 'tireWidthIn',
    'sideHeightBowIn', 'sideHeightRearIn', 'sideProfileSagIn', 'bowCurlRadiusIn', 'bowCurlAngleDeg', 'steerLockDeg', 'frontTrackIn', 'kingBeamLengthIn', 'kingThrustOdIn', 'tongueTieAheadIn', 'tongueHeadWidthIn', 'frontStubLenIn',
    'axleBeamThicknessIn', 'axleBeamDepthIn', 'axleHangerWidthIn', 'axleHangerThickIn', 'railDepthIn', 'crossmemberDepthIn',
    'seatDepthIn', 'hubLengthIn', 'riderStatureIn', 'seatBackAngleDeg', 'storageVolumeIn3', 'footStopThickIn', 'panelPlyIn', 'riderLegReachIn', 'deckSlopIn',
  ];
  const OPTION_KEYS: ParamKey[] = ['storageLocation', 'axleBeamPosition', 'axleStyle', 'tireType', 'showSideSigns'];
  const N = 300; // raise (and change the seed) to hunt
  const samples = (() => {
    const rnd = mulberry32(455);
    const out: Params[] = [];
    for (let i = 0; i < N; i++) {
      const p = { ...defaults };
      // Jitter a random subset of keys around the defaults (±20% of each range) so many samples pass validation.
      for (const k of FUZZ_KEYS) {
        if (rnd() > 0.3) continue;
        const d = PARAM_DEFS[k];
        const v = d.default + (rnd() * 2 - 1) * 0.2 * (d.max - d.min);
        p[k] = Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step));
      }
      for (const k of OPTION_KEYS) if (rnd() < 0.35) p[k] = PARAM_DEFS[k].options![Math.floor(rnd() * PARAM_DEFS[k].options!.length)].value;
      out.push(p);
    }
    return out;
  })();
  it(`${N} seeded designs: no errors => no unintended overlaps (neutral, full lock each way, transport)`, () => {
    const t0 = Date.now();
    let clean = 0;
    const failures: string[] = [];
    fuzzMode = true;
    for (const p of samples) {
      if (errorsOf(p).length) continue;
      clean++;
      for (const view of [{ steerDeg: 0 }, { steerDeg: 99 }, { steerDeg: -99 }, { removed: true }]) {
        const bad = overlaps(buildModel(p, view), true);
        if (bad.length) failures.push(`${bad.slice(0, 3).join('; ')} @${JSON.stringify(view)} :: ${JSON.stringify(Object.fromEntries([...FUZZ_KEYS, ...OPTION_KEYS].filter((k) => p[k] !== defaults[k]).map((k) => [k, p[k]])))}`);
      }
    }
    fuzzMode = false;
    console.log(`fuzz: ${clean}/${N} validator-clean designs checked in ${Date.now() - t0} ms; ${failures.length} failures`);
    expect([...new Set(failures.flatMap((x) => x.split(' @')[0].split('; ').map((b) => b.replace(/:.*/, ''))))].slice(0, 30)).toEqual([]);
    expect(clean).toBeGreaterThanOrEqual(15); // the bow, caster and seat constraints reject much of the wild jitter
    expect(Date.now() - t0).toBeLessThan(40000); // a few seconds locally, ~18 s on shared CI runners
  }, 60000); // heavy sweep; shared CI runners are 2-3x slower
});

describe('resolveParams (D-54: no derived-by-rule params left)', () => {
  it('is the identity (the auto nose geometry went with the tapering hull), and the validator sees the same params', () => {
    for (const patch of [{}, { wheelbaseIn: 48 }, { bodyWidthIn: 22 }]) {
      const p = { ...defaults, ...patch };
      expect(resolveParams(p)).toBe(p);
      expect(validateParams(p)).toEqual(validateParams(resolveParams(p)));
    }
  });
});

describe('slider ranges (L1)', () => {
  // The bow side height and the curl radius are tied to each other (the curl must rise to the side height, and the flat deck must still carry the foot stop), so their valid bands are narrower.
  // The front overhang, the lock and the body width are tied together by the steering stops under the end joist (validateParams: the stop contact must lie between 2.5 in and the rail face less 1 in), so
  // at the other defaults only a narrow window is valid: the front overhang and the curl radius move the end joist, the lock and the body width move the contact point and the rail face.
  const MIN_FRACTION: Partial<Record<ParamKey, number>> = { sideHeightBowIn: 0.2, bowCurlRadiusIn: 0.04, steerLockDeg: 0.15, bodyWidthIn: 0.15, frontOverhangIn: 0.03 };
  it.each(['seatXIn', 'frontTrackIn', 'steerLockDeg', 'bodyWidthIn', 'sideHeightBowIn', 'sideHeightRearIn', 'bowCurlRadiusIn', 'frontOverhangIn'] as const)('%s: a useful part of its range is valid at the other defaults, and the default itself is clean', (k) => {
    const d = PARAM_DEFS[k];
    let ok = 0, n = 0;
    for (let v = d.min; v <= d.max + 1e-9; v += d.step) {
      n++;
      if (!errorsOf({ ...defaults, [k]: v }).length) ok++;
    }
    expect(ok / n, `${k} valid fraction`).toBeGreaterThanOrEqual(MIN_FRACTION[k] ?? 0.25);
    expect(errorsOf({ ...defaults, [k]: defaults[k] })).toEqual([]);
  });
});

describe('old shared links (Stage 2 flip)', () => {
  it('parameters of the removed design are ignored, the rest still load, and the cart builds identically to the defaults', () => {
    const old = {
      turntableType: 1, turntableSizeIn: 8, drawbar: 0, frontDeckRaiseIn: 0.5, kingpinSleeveOdIn: 1.25, frontAxleBeamThicknessIn: 4, kingpinThroughBolster: 1,
      sideBearerEmbedIn: 1, steerStopSizeIn: 2, bolsterRailWidthIn: 2, shoulderBeamIn: 1.5, rodKingpinWebMinIn: 0.5, frontEndType: 0, frontBrakeType: 0, notAKey: 7,
    };
    const s = sanitizeParams({ ...old, wheelbaseIn: 46 } as unknown as Partial<Params>);
    expect(s.wheelbaseIn).toBe(46);
    for (const k of Object.keys(old)) expect((s as unknown as Record<string, number>)[k], k).toBeUndefined();
    const d = sanitizeParams(old as unknown as Partial<Params>);
    expect(d).toEqual(defaults);
    expect(buildModel(d).map((x) => x.id)).toEqual(buildModel(defaults).map((x) => x.id));
    expect(Object.keys(PARAM_DEFS)).not.toEqual(expect.arrayContaining(['turntableType', 'drawbar', 'frontEndType']));
  });
});

describe('old shared links (Phase 3c-1)', () => {
  it('ride-mode, front-brake, hip-lever, lap-belt and cross-shaft brake params are ignored by the URL decoder and the sanitizer; the cart builds like the defaults', () => {
    const old = {
      rideStickLengthIn: 20, rideStickInsetIn: 4, steerRideLockDeg: 8, steerCenterSpringLbf: 3, stickCableDiaIn: 0.125, bellcrankCableArmIn: 3.8, modePinDiaIn: 0.375,
      frontBrakeBias: 0.6, frontShoeTravelIn: 0.3, brakeBiasBarIn: 6, hipLeverArmIn: 6, hipCableDiaIn: 0.0625, beltDesignG: 4, beltAnchorBoltDiaIn: 0.375,
      brakeType: 1, brakeShaftDiameterIn: 0.875, brakeRatchetRadiusIn: 8.5, brakeBearingBoltCols: 3, rideSpeedMph: 10, rideRunFt: 300, notAKey: 7,
    };
    const hash = '#' + Object.entries({ ...old, wheelbaseIn: 46 }).map(([k, v]) => `${k}=${v}`).join('&');
    const d = decodeHash(hash);
    expect(d.wheelbaseIn).toBe(46);
    for (const k of Object.keys(old)) expect((d as unknown as Record<string, number>)[k], k).toBeUndefined();
    const s = sanitizeParams(old as unknown as Partial<Params>);
    expect(s).toEqual(defaults);
    expect(buildModel(s).map((x) => x.id)).toEqual(buildModel(defaults).map((x) => x.id));
    const keys = Object.keys(PARAM_DEFS);
    for (const k of Object.keys(old)) expect(keys, k).not.toContain(k);
    // The bump model's design speeds are walking pace (normal use) and jogging pace (the occasional hard hit), D-55; the single bumpSpeedMph is gone.
    expect(defaults.bumpSpeedNormalMph).toBe(3);
    expect(defaults.bumpSpeedHardMph).toBe(5);
    expect(keys).not.toContain('bumpSpeedMph');
  });
});
