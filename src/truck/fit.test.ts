import { describe, expect, it } from 'vitest';
import { defaultParams, validateParams } from '../params';
import { buildModel, type ViewState } from '../model';
import { partOBB } from '../model/bounds';
import { computeLayout } from '../model/layout';
import { translation } from '../model/mat4';
import type { Part } from '../model/types';
import { buildTruckBed } from './bed';
import { CONFIGS, checkTruckFit, computeFeasibleWindows, configParts, validatorError, type CartView } from './fit';

/** The default design's feasible windows: the search is slow (it builds the sled at many tracks and wheelbases), so the tests share one run. */
let defaultWindowsRun: ReturnType<typeof computeFeasibleWindows> | undefined;
const defaultWindows = () => (defaultWindowsRun ??= computeFeasibleWindows(defaultParams(), (q, v) => buildModel(q, v as ViewState)));

const stub = (p = defaultParams()) => (v: CartView) => buildModel(p, v as ViewState);

function box(id: string, size: [number, number, number], at: [number, number, number], extra: Partial<Part> = {}): Part {
  return {
    id, name: id, group: 'body', kind: 'lumber', material: 'oak', geometry: { type: 'box', size },
    transform: translation(...at), body: 'chassis', massLb: 1, fab: 'none', step: 1, ...extra,
  };
}

describe('truck bed', () => {
  it('is all payload reference parts in the truck frame', () => {
    const bed = buildTruckBed(defaultParams());
    expect(bed.length).toBe(8); // floor, bulkhead, cab, 2 walls, 2 wells, tailgate
    expect(bed.every((b) => b.payload && b.group === 'reference' && b.body === 'truck')).toBe(true);
    expect(buildTruckBed(defaultParams(), { ground: true }).length).toBe(9);
  });
  it('models the cab wall above the bulkhead and a real hinge gap', () => {
    const p = defaultParams();
    const bed = buildTruckBed(p);
    const cab = bed.find((b) => b.id === 'truck-cab')!;
    const top = cab.transform[14] + (cab.geometry as { size: number[] }).size[2] / 2;
    expect(top).toBeCloseTo(p.truckCabHeightIn, 6);
    const tg = bed.find((b) => b.id === 'truck-tailgate')!;
    const tgStart = tg.transform[12] - (tg.geometry as { size: number[] }).size[0] / 2;
    expect(tgStart).toBeCloseTo(p.truckBedLengthIn + p.truckTailgateGapIn, 6);
  });
});

describe('checkTruckFit with the stub model', () => {
  const p = defaultParams();
  const r = checkTruckFit(p, stub(p));
  it('returns all 8 cases and overall dimensions', () => {
    expect(r.cases.length).toBe(8); // 2 modes x 2 orientations x 2 configurations (D-65: no bridle-off)
    expect(r.dims.installed.lengthIn).toBeGreaterThan(0);
    expect(r.evalMs).toBeLessThan(500);
  });
  it('every case has a placement and consistent verdict', () => {
    for (const c of r.cases) {
      expect(c.placement).not.toBeNull();
      expect(c.fits).toBe(c.colliding.length === 0 && c.modeFeasible);
    }
  });
  it('beside fits at default track in transport config (D-8: the handle comes off)', () => {
    const c = r.cases.find((x) => x.mode === 'beside' && x.config === 'removed')!;
    expect(c.fits).toBe(true);
    expect(c.minClearanceIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
  });
});

describe('checkTruckFit synthetic parts', () => {
  const p = defaultParams();
  it('a small box fits; an over-wide box collides with walls', () => {
    const small = [box('a', [20, 20, 6], [0, 0, 3])];
    expect(checkTruckFit(p, () => small).anyFits).toBe(true);
    const wide = [box('wide', [30, p.truckBedWidthIn + 6, 4], [0, 0, 20])];
    const r = checkTruckFit(p, () => wide);
    expect(r.anyFits).toBe(false);
    const c = r.best!;
    expect(c.colliding.some((q) => q.partId === 'wide' && q.solidId.startsWith('truck-wall'))).toBe(true);
  });
  it('a low slab wider than the well gap fits only ahead of / behind the wells', () => {
    const lowWide = [box('slab', [10, p.truckWellGapIn + 6, 4], [0, 0, 2])];
    const r = checkTruckFit(p, () => lowWide);
    expect(r.anyFits).toBe(true);
    const tx = r.best!.placement!.txIn;
    expect(tx + 5 <= p.truckWellStartIn - p.truckClearanceIn + 1e-9 || tx - 5 >= p.truckWellStartIn + p.truckWellLengthIn).toBe(true);
  });
  it('too long for bed + tailgate does not fit', () => {
    const long = [box('long', [p.truckBedLengthIn + p.truckTailgateLengthIn + 5, 10, 4], [0, 0, 2])];
    const r = checkTruckFit(p, () => long);
    expect(r.anyFits).toBe(false);
    expect(r.best!.colliding.length).toBeGreaterThan(0);
  });
  it('ignores the bridle and payload parts', () => {
    const parts = [box('a', [20, 20, 6], [0, 0, 3]), box('bridle', [500, 2, 2], [0, 0, 1]), box('rider', [500, 99, 99], [0, 0, 0], { payload: true })];
    expect(checkTruckFit(p, () => parts).anyFits).toBe(true);
  });
  it('removed config can fit when installed does not', () => {
    const parts = (v: CartView) => [box('a', [20, 20, 6], [0, 0, 3]), ...(v.removed ? [] : [box('tall', [10, 10, 80], [0, 0, 40], { removable: true })])];
    const r = checkTruckFit(p, parts);
    // tall box fits in bed (no roof), so make it too long instead
    expect(r.cases.length).toBe(8); // 2 modes x 2 orientations x 2 configurations (D-65: no bridle-off)
    const long = (v: CartView) => [box('a', [20, 20, 6], [0, 0, 3]), ...(v.removed ? [] : [box('handle', [100, 2, 2], [40, 0, 3], { removable: true })])];
    const r2 = checkTruckFit(p, long);
    expect(r2.cases.filter((c) => c.config === 'installed').some((c) => c.fits)).toBe(false);
    expect(r2.cases.filter((c) => c.config === 'removed').some((c) => c.fits)).toBe(true);
  });
});

describe('fit performance', () => {
  it('stays fast with a ~150-part sled', () => {
    const p = defaultParams();
    const base = buildModel(p, {});
    const many: Part[] = [...base];
    for (let i = 0; i < 150; i++) many.push(box(`s${i}`, [3, 2, 1], [(i % 30) * 2, ((i % 7) - 3) * 4, 8 + (i % 5)]));
    const r = checkTruckFit(p, () => many);
    expect(r.cases.length).toBe(8); // 2 modes x 2 orientations x 2 configurations (D-65: no bridle-off)
    // A guard against a big regression, not a benchmark: the interactive budget is 50 ms on a quiet machine, and a parallel test run or a CI runner is several times slower.
    expect(r.evalMs).toBeLessThan(500);
    console.log('fit ms (154 parts):', r.evalMs.toFixed(1));
  });
});

describe('real sled (D-6, D-23, D-54)', () => {
  const p = defaultParams();
  const build = (q: ReturnType<typeof defaultParams>) => (v: CartView) => buildModel(q, v as ViewState);
  const find = (r: ReturnType<typeof checkTruckFit>, mode: string, config: string) =>
    r.cases.filter((c) => c.mode === mode && c.config === config);
  const r = checkTruckFit(p, build(p));

  it('has two configurations (D-65: installed and Transport mode); the oak tongue stays on in both, so Transport mode is no longer than installed; it is lower, but the parked handle stands above the 22 in transom corners', () => {
    // D-65 (Eric): the tongue is bolted on and stays; the 'bridle-off' configuration is gone. Transport mode = TRANSPORT_VIEW: brakes, lights, chocks and the seat pad off, handle parked, seat flat.
    expect(r.dims.removed.lengthIn).toBeLessThanOrEqual(r.dims.installed.lengthIn);
    // Pinned (defaults): installed 67.0 x 38.8 x 35.5 in (the flap no longer sticks out 3 in behind the transom: 68.8 long before D-65); Transport mode 66.9 long (the tongue sets the length) and 25.7 high
    // (the parked handlebow rests just above the rear side top). Width = the axle ends (30 in tracks, D-66 (34 1/2 in front track before) + the 2.28 in hub and 1 in of axle beyond it each side).
    expect(r.dims.installed.lengthIn).toBeCloseTo(67.0, 0);
    expect(r.dims.installed.widthIn).toBeCloseTo(34.28, 1); // D-66: 30 in front and rear tracks + the hubs and axle ends (38.78 at the 34 1/2 in front track)
    expect(r.dims.installed.heightIn).toBeCloseTo(35.5, 0);
    expect(r.dims.removed.lengthIn).toBeCloseTo(66.9, 0);
    expect(r.dims.removed.heightIn).toBeCloseTo(25.7, 0);
    expect(r.dims.removed.heightIn).toBeLessThan(r.dims.installed.heightIn);
  });
  it("Transport mode (the 'removed' configuration, TRANSPORT_VIEW, D-65) keeps the oak tongue, its sleeve, the rope, the signs and the parked handle, and takes off the flap kit, the lights, the chocks and the seat pad; the front axle stays", () => {
    const inst = configParts('installed', build(p)).map((x) => x.id);
    const removed = configParts('removed', build(p)).map((x) => x.id);
    for (const id of ['bridle', 'bridle-sleeve', 'bridle-tongue', 'sign-L', 'sign-R', 'handle-bar', 'handle-post-L', 'brake-backer-R', 'beam-F', 'kingpin', 'king-beam', 'steer-chain-L', 'axle-FL', 'wheel-FL']) expect(removed, id).toContain(id);
    const gone = inst.filter((id) => !removed.includes(id));
    for (const id of ['brake-flap-L', 'brake-pivot-pin-R', 'brake-cord-L', 'brake-chock-L', 'front-light', 'rear-light', 'lamp-clip', 'rear-lamp-clip', 'seat-back-pad']) expect(gone, id).toContain(id);
    expect(gone.some((id) => /^(bridle|sign|handle)/.test(id))).toBe(false);
    expect(CONFIGS).toEqual(['installed', 'removed']);
  });
  it('the fit builds the front axle straight (steerDeg 0), the tongue plate counts as steel in the clearance check but the rope does not, and the tongue tip is tongueTieAheadIn past the bow', () => {
    const view: CartView[] = [];
    configParts('installed', (v) => { view.push(v); return build(p)(v); });
    expect(view[0].steerDeg ?? 0).toBe(0);
    const parts = configParts('installed', build(p));
    const beam = parts.find((x) => x.id === 'beam-F')!;
    expect(Math.abs(beam.transform[1])).toBeLessThan(1e-9); // no yaw: the beam lies along Y
    const tongue = parts.find((x) => x.id === 'bridle-tongue')!;
    const o = partOBB(tongue);
    expect(o.center[0] + o.half[0]).toBeCloseTo(computeLayout(p).tongue.tipX, 4);
    // A tongue plate 100 in long blocks the fit in every configuration (D-65: it stays on); a 100 in rope never counts.
    const sled = (id: string, name: string) => (_v: CartView) => [box('a', [20, 20, 6], [0, 0, 3]), { ...box(id, [100, 2, 2], [40, 0, 3]), name }];
    const rt = checkTruckFit(p, sled('bridle-tongue', 'Bridle tongue plate'));
    expect(rt.cases.some((c) => c.fits)).toBe(false);
    expect(checkTruckFit(p, sled('bridle', 'Bridle rope')).cases.filter((c) => c.config === 'installed').some((c) => c.fits)).toBe(true);
  });
  it('beside fits in every configuration and both orientations at the defaults, with the tires wholly inside the well gap', () => {
    for (const config of ['installed', 'removed']) {
      const fits = find(r, 'beside', config).filter((x) => x.fits);
      expect(fits.length).toBe(2); // nose to the tailgate and nose to the bulkhead
      for (const c of fits) expect(c.minClearanceIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
    }
    // Tire edges (in the truck frame, via the placement) are inside the well gap by the required clearance.
    const c = find(r, 'beside', 'removed').find((x) => x.fits)!;
    const M = c.placement!.transform;
    const parts = configParts('removed', build(p));
    for (const w of parts.filter((x) => x.geometry.type === 'wheel')) {
      const cy = M[1] * w.transform[12] + M[5] * w.transform[13] + M[13];
      const half = (w.geometry as { width: number }).width / 2;
      expect(Math.abs(cy) + half + p.truckClearanceIn).toBeLessThanOrEqual(p.truckWellGapIn / 2 + 1e-6);
    }
  });
  it('straddle does not fit at the default 44 in wheelbase, in any configuration; beside is the only mode there (the 5 in shorter D-57 nose lets a 48 in sled straddle without its tongue)', () => {
    // Straddling needs both axles wholly outside the 34 in well zone (so >= 45 in between axle centers) and no tire over the 1 in hinge gap at x = 60.5.
    expect(p.wheelbaseIn).toBe(44);
    for (const config of ['installed', 'removed']) expect(find(r, 'straddle', config).some((x) => x.fits)).toBe(false);
    expect(r.anyFits).toBe(true);
    expect(r.cases.filter((x) => x.fits).every((x) => x.mode === 'beside')).toBe(true);
    // D-65: the tongue stays on in Transport mode, so Transport mode and the assembled sled straddle alike: not at 48 in (a tire over the hinge gap), yes at 52 in.
    const q48 = { ...p, wheelbaseIn: 48 };
    const r48 = checkTruckFit(q48, build(q48));
    expect(find(r48, 'straddle', 'installed').some((x) => x.fits)).toBe(false); // 48 in puts a tire over the 1 in tailgate hinge gap in both configurations (46 and 50 in straddle)
    expect(find(r48, 'straddle', 'removed').some((x) => x.fits)).toBe(false);
    const q52 = { ...p, wheelbaseIn: 52 };
    expect(find(checkTruckFit(q52, build(q52)), 'straddle', 'installed').some((x) => x.fits)).toBe(true); // D-62: no bow shackle, the assembled sled is 1.07 in shorter and a 52 in one can now straddle the wells
    expect(find(checkTruckFit(q52, build(q52)), 'straddle', 'removed').some((x) => x.fits)).toBe(true);
  });
  it('a longer wheelbase costs the fit: 52 and 56 in still fit beside, assembled and in Transport mode; 58 in fits neither (the tongue sets the length in both, D-65)', () => {
    for (const wb of [52, 56]) {
      const q = { ...p, wheelbaseIn: wb };
      const rq = checkTruckFit(q, build(q));
      expect(find(rq, 'beside', 'installed').some((x) => x.fits), `${wb} assembled`).toBe(true);
      expect(find(rq, 'beside', 'removed').some((x) => x.fits), `${wb} transport`).toBe(true);
    }
    const q58 = { ...p, wheelbaseIn: 58 };
    const r58 = checkTruckFit(q58, build(q58));
    expect(find(r58, 'beside', 'installed').some((x) => x.fits)).toBe(false);
    expect(find(r58, 'beside', 'removed').some((x) => x.fits)).toBe(false);
  });
  it('beside fits only when the track fits the well gap', () => {
    const q = { ...p, rearTrackIn: 40 };
    const rr = checkTruckFit(q, build(q));
    expect(find(rr, 'beside', 'removed').some((x) => x.fits)).toBe(false);
    expect(find(r, 'beside', 'removed').some((x) => x.fits)).toBe(true);
  });
  it('feasible windows: max track is monotone-consistent and contains the current fit; straddle has no window', async () => {
    const w = await defaultWindows();
    expect(w).not.toBeNull();
    const beside = w!.windows.find((x) => x.mode === 'beside' && x.config === 'removed')!;
    expect(beside.fitsNow).toBe(true);
    expect(beside.maxTrackIn!).toBeGreaterThanOrEqual(p.rearTrackIn);
    // Pinned: the widest rear track is 37 in (tire 3.5 in: 40.5 in outside, the 41.5 in well gap less 2 x 0.5 in clearance).
    expect(beside.maxTrackIn!).toBeCloseTo(p.truckWellGapIn - 2 * p.truckClearanceIn - p.tireWidthIn, 0);
    const q = { ...p, rearTrackIn: beside.maxTrackIn! };
    expect(find(checkTruckFit(q, build(q)), 'beside', 'removed').some((x) => x.fits)).toBe(true);
    const wider = { ...p, rearTrackIn: beside.maxTrackIn! + 1 };
    expect(find(checkTruckFit(wider, build(wider)), 'beside', 'removed').some((x) => x.fits)).toBe(false);
    // Wheelbase window: the validator sets the minimum (44 in, where the foot stop meets the end of the flat deck); the bed sets the maximum (the sled gets too long).
    expect(beside.wheelbaseMinIn!).toBeCloseTo(44, 0);
    expect(beside.wheelbaseBoundedByValidator).toBe(true);
    expect(beside.wheelbaseMaxIn!).toBeGreaterThan(p.wheelbaseIn);
    expect(beside.wheelbaseMaxIn!).toBeCloseTo(57.25, 0); // 62.25 with the handle and tongue off before D-65, 60.25 before the flap was shortened
    const besideInstalled = w!.windows.find((x) => x.mode === 'beside' && x.config === 'installed')!;
    expect(besideInstalled.wheelbaseMaxIn!).toBeLessThanOrEqual(beside.wheelbaseMaxIn!); // D-65: the tongue stays on in Transport mode, so it buys no length
    expect(besideInstalled.wheelbaseMaxIn!).toBeCloseTo(57.25, 0); // D-62: 1.25 in more than with the bow shackle (54); D-65 +2 in with the flap ending at the transom face
    // Straddle: not at the default wheelbase (see the test above), and never as assembled (D-58 tongue); without the tongue it has a window from 45 in (both axles outside the 34 in well zone)
    // up to where the sled is too long for the bed.
    for (const config of ['installed', 'removed']) {
      const st = w!.windows.find((x) => x.mode === 'straddle' && x.config === config)!;
      expect(st.fitsNow).toBe(false);
      // D-62: the assembled sled (no bow shackle) now has a straddle window too, a little narrower than without the tongue
      expect(st.wheelbaseMinIn!).toBeCloseTo(45, 0);
      expect(st.wheelbaseMaxIn!).toBeGreaterThan(50);
      if (config === 'installed') expect(st.wheelbaseMaxIn!).toBeLessThanOrEqual(w!.windows.find((x) => x.mode === 'straddle' && x.config === 'removed')!.wheelbaseMaxIn!);
    }
  }, 60000);
});

describe('cab and hinge gap', () => {
  it('a part above the bed walls collides with the cab wall, and does not when the cab is low', () => {
    const p = defaultParams();
    const hi = [box('long', [80.9, 4, 2], [0, 0, 28])];
    expect(checkTruckFit(p, () => hi).anyFits).toBe(false);
    const q = { ...p, truckCabHeightIn: 18 };
    expect(checkTruckFit(q, () => hi).anyFits).toBe(true);
  });
  it('a tire never rests over the tailgate hinge gap', () => {
    const p = { ...defaultParams(), truckTailgateGapIn: 3 };
    const wheel: Part = { ...box('wheel-x', [13, 4, 13], [0, 0, 6.5]), geometry: { type: 'wheel', diameter: 13, width: 4, hubDiameter: 4, hubLength: 4, bore: 1 } };
    const r = checkTruckFit(p, () => [wheel]);
    for (const c of r.cases.filter((x) => x.fits)) {
      const cx = c.placement!.transform[12] + (c.placement!.yawDeg === 0 ? 0 : 0);
      expect(Math.abs(cx - (p.truckBedLengthIn + 1.5))).toBeGreaterThan(1.5);
    }
  });
});

describe('fit timing', () => {
  it('real sled fit is fast when warm', () => {
    const p = defaultParams();
    checkTruckFit(p, stub(p));
    const r = checkTruckFit(p, stub(p));
    console.log('warm real-sled fit ms:', r.evalMs.toFixed(1));
    expect(r.evalMs).toBeLessThan(150);
  });
});

describe('window validity (round-2 M1)', () => {
  const buildQ = (q: ReturnType<typeof defaultParams>, v: CartView) => buildModel(q, v as ViewState);
  it('never reports a track or wheelbase the validator rejects, and names the validator when it bounds the window', async () => {
    const p = defaultParams();
    expect(validatorError(p)).toBeNull();
    const w = await defaultWindows();
    expect(w).not.toBeNull();
    for (const x of w!.windows) {
      if (x.maxTrackIn !== null) {
        const q = { ...p, rearTrackIn: x.maxTrackIn, frontTrackIn: x.maxTrackIn };
        expect(validateParams(q).some((i) => i.severity === 'error')).toBe(false);
        // Bed alone is never tighter than bed + validator.
        expect(x.maxTrackBedOnlyIn!).toBeGreaterThanOrEqual(x.maxTrackIn - 1e-9);
        expect(x.trackBoundedByValidator).toBe((x.trackLimitedBy ?? '').includes('(validator)'));
      }
      if (x.wheelbaseMinIn !== null) {
        for (const wb of [x.wheelbaseMinIn, x.wheelbaseMaxIn!]) {
          expect(validatorError({ ...p, wheelbaseIn: wb })).toBeNull();
        }
      }
      expect(x.wheelbaseBoundedByValidator).toBe((x.wheelbaseLimitedBy ?? '').includes('(validator)'));
    }
  }, 60000);
  it('reports nothing feasible (and why) when the current design itself fails validation', async () => {
    // A body too wide to clear the rear tires: the validator rejects it (the nose-width example of the Ackermann hull is gone, D-54).
    const p = { ...defaultParams(), bodyWidthIn: 40 };
    expect(validatorError(p)).not.toBeNull();
    const w = await computeFeasibleWindows(p, buildQ);
    for (const x of w!.windows) {
      expect(x.maxTrackIn).toBeNull();
      expect(x.wheelbaseMinIn).toBeNull();
      expect(x.invalidNow).toBeTruthy();
    }
  }, 60000);
  it('windows carry a stability preview that follows the model CG', async () => {
    const p = defaultParams();
    const w = await defaultWindows();
    const x = w!.windows.find((y) => y.mode === 'beside' && y.config === 'removed')!;
    expect(x.cgHeightNowIn).toBeGreaterThan(5);
    expect(x.ssfNow).toBeCloseTo(p.rearTrackIn / 2 / x.cgHeightNowIn, 9);
    if (x.maxTrackIn !== null) expect(x.ssfAtMax!).toBeCloseTo(x.maxTrackIn / 2 / x.cgHeightAtMaxIn!, 9);
  }, 60000);
});

describe('honest mode reporting (round-2 beside/straddle)', () => {
  it('reports true fore-aft slack for a box in an open bed', () => {
    const p = defaultParams();
    const L = 20;
    const r = checkTruckFit(p, () => [box('a', [L, 20, 6], [0, 0, 3])]);
    const c = r.cases.find((x) => x.mode === 'beside' && x.orientation === 'nose-tailgate' && x.config === 'installed')!;
    expect(c.fits).toBe(true);
    const expected = r.usableLengthIn - L - 2 * p.truckClearanceIn;
    expect(Math.abs(c.slack!.totalIn - expected)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(c.slack!.toBulkheadIn + c.slack!.toTailgateIn).toBeCloseTo(c.slack!.totalIn, 9);
  });
  it('straddle: reports each axle fore-aft margin to the well zone and the slack equals the wheelbase excess', () => {
    const p = { ...defaultParams(), truckTailgateGapIn: 0 };
    const D = 13, W = 4, excess = 3;
    const wells = p.truckWellLengthIn;
    const wb = wells + 2 * p.truckClearanceIn + D + excess;
    const wheel = (id: string, x: number, y: number): Part => ({
      ...box(id, [D, W, D], [x, y, D / 2]),
      geometry: { type: 'wheel', diameter: D, width: W, hubDiameter: 4, hubLength: 4, bore: 1 },
    });
    const parts = [wheel('wheel-RL', 0, 15), wheel('wheel-RR', 0, -15), wheel('wheel-FL', wb, 15), wheel('wheel-FR', wb, -15)];
    const r = checkTruckFit(p, () => parts);
    const c = r.cases.find((x) => x.mode === 'straddle' && x.orientation === 'nose-tailgate' && x.config === 'installed')!;
    expect(c.fits).toBe(true);
    expect(c.axles).toHaveLength(2);
    const [low, high] = c.axles;
    expect(low.side).toBe('bulkhead');
    expect(low.relation).toBe('ahead');
    expect(high.relation).toBe('behind');
    expect(low.wheelWellGapIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
    expect(high.wheelWellGapIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
    // The two margins add up to the wheelbase excess plus the two required clearances, and the slack equals the excess.
    expect(low.wheelWellGapIn + high.wheelWellGapIn).toBeCloseTo(2 * p.truckClearanceIn + excess, 9);
    expect(Math.abs(c.slack!.totalIn - excess)).toBeLessThanOrEqual(0.5 + 1e-9);
    // With no excess the straddle has no slack (D-6: zero fore-aft slack).
    const tight = [wheel('wheel-RL', 0, 15), wheel('wheel-FL', wells + 2 * p.truckClearanceIn + D, 15)];
    const t = checkTruckFit(p, () => tight).cases.find((x) => x.mode === 'straddle' && x.orientation === 'nose-tailgate' && x.config === 'installed')!;
    expect(t.fits).toBe(true);
    expect(t.slack!.totalIn).toBeLessThan(1e-9);
  });
  it('real sled: a fitting straddle case reports both axles clear of the wells; non-fitting cases have no slack', () => {
    const p = defaultParams();
    const r = checkTruckFit(p, (v) => buildModel(p, v as ViewState));
    for (const c of r.cases) {
      if (!c.fits) expect(c.slack).toBeNull();
      else {
        expect(c.slack!.totalIn).toBeGreaterThanOrEqual(0);
        if (c.mode === 'straddle') for (const a of c.axles) expect(a.wheelWellGapIn).toBeGreaterThanOrEqual(p.truckClearanceIn - 1e-9);
      }
    }
  });
});
