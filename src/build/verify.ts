/**
 * Phase 4 output 8: "Verify before ordering" checklist (docs/phase3-checkpoint.md, nine checks).
 *
 * Pure function of (parts, params). The numbers come from the params the model uses; the part ids are the ones present in the built
 * model. Every param whose `status` is 'verify' is claimed by a check, and any left over lands in the last item ("other params to
 * confirm") automatically, so promoting or adding a verify param never needs an edit here.
 */
import { bowTaper, PARAM_DEFS, thinSheet, type Params } from '../params';
import { runChecks } from '../analysis';
import { signKnobPlan } from '../model/body';
import { computeLayout } from '../model/layout';
import { CARRIAGE_STOCK_IN, EYE_BOLT_STOCK_IN, stockBoltFit } from '../model/rear-mount';
import { localBounds } from '../model/bounds';
import type { Part } from '../model/types';
import { cutList } from './cutlist';

export type VerifyWhen = 'before ordering' | 'before cutting' | 'at assembly';

export interface VerifyCheck {
  id: string;
  /** 1-based position in the checklist. */
  n: number;
  title: string;
  /** The test procedure. */
  whatToDo: string;
  /** Pass criteria, with numbers from the params. */
  pass: string;
  /** What to do when it fails. */
  ifFails: string;
  /** Built parts the check guards (only ids that exist in the model). */
  partIds: string[];
  /** Params with `status: 'verify'` that the check confirms. */
  paramKeys: string[];
  when: VerifyWhen;
  /** DECISIONS.md ids. */
  refs: string[];
}

/** The pre-order gate passes with a real rate up to this multiple of the modeled rate (560 / 500 lb/in at the defaults; bumpWheelRateLbIn note, D-54). */
export const BUMP_RATE_PASS_MARGIN = 1.12;
/** Inflation for the squash test (bumpWheelRateLbIn note). */
export const SQUASH_TEST_PSI = 30;

const f = (n: number, d = 2): string => String(+n.toFixed(d));

/** Fraction text for a stock size ("5/8", "2-1/4"), to 1/16 in. */
function fr(x: number): string {
  const n = Math.round(x * 16);
  const whole = Math.floor(n / 16);
  let num = n % 16, den = 16;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  if (num === 0) return `${whole}`;
  return whole > 0 ? `${whole}-${num}/${den}` : `${num}/${den}`;
}

/**
 * The rear-axle row's utilization at the goal rider (from the model's own check, run once and cached by the design), and what a weaker steel would make of it: the bump rows are
 * stress over yield, so the row scales with the assumed yield over the weaker one (a hard-hit case on the ultimate makes it a little less than linear: about, within 3 %).
 */
const axleUtilCache = new Map<string, number>();
function axleBaseUtil(p: Params): number {
  const key = JSON.stringify(p);
  const hit = axleUtilCache.get(key);
  if (hit !== undefined) return hit;
  const util = runChecks(p, { includeTruck: false, cargo: false }).find((c) => c.id === 'axle-stress')?.util ?? 0;
  if (axleUtilCache.size > 6) axleUtilCache.clear();
  axleUtilCache.set(key, util);
  return util;
}
/** The row at the goal rider if the axle steel yielded `yieldPsi` instead of the assumed `assumedPsi`. */
const axleUtilAt = (p: Params, assumedPsi: number, yieldPsi: number): number => (axleBaseUtil(p) * assumedPsi) / yieldPsi;

/** Ids of the built parts matching a pattern. */
function ids(parts: Part[], re: RegExp): string[] {
  return parts.filter((x) => x.group !== 'reference' && re.test(x.id)).map((x) => x.id);
}

/** Param keys that are still 'verify' (a param Eric has confirmed and promoted drops out of the list by itself). */
function verifyKeys(keys: string[]): string[] {
  return keys.filter((k) => PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.status === 'verify');
}

/** Every param key currently at status 'verify'. */
export function verifyParamKeys(): string[] {
  return Object.entries(PARAM_DEFS).filter(([, d]) => d.status === 'verify').map(([k]) => k);
}

export function verifyChecklist(parts: Part[], p: Params): VerifyCheck[] {
  const rate = p.bumpWheelRateLbIn;
  const rateMax = Math.round((rate * BUMP_RATE_PASS_MARGIN) / 10) * 10;
  const testLb = p.wheelRatingLb;
  const squashDesign = testLb / rate;
  const squashMin = Math.ceil((testLb / rateMax) * 20) / 20;
  const thin = thinSheet(p);
  const knob = signKnobPlan({ p, L: computeLayout(p) });
  // D-72: stock lengths of the eye bolts and the tongue's carriage bolts against their real stacks.
  const beamEye = stockBoltFit(p.frontBeamThicknessIn, p.steerEyeBoltDiaIn, 1, EYE_BOLT_STOCK_IN);
  const anchorEye = stockBoltFit(p.chainJoistThickIn, p.steerEyeBoltDiaIn, 2, EYE_BOLT_STOCK_IN);
  const tongueBolt = stockBoltFit(p.tongueHeadLenIn + p.frontBeamThicknessIn, p.tongueBoltDiaIn, 1, CARRIAGE_STOCK_IN);
  const tubeOd = p.axleDiameterIn;
  const tubeWall = p.axleWallIn;
  const railStrip = (parts.find((x) => x.id === 'rail-L')?.stock?.t ?? 0.375);
  const bandStrip = (parts.find((x) => x.id === 'side-L-chine')?.stock?.t ?? 0.234);

  // The resaw pools (rip first, then resaw; the cut list's plan): the rail and band strip boards and the spare strips each purchase leaves for the bend test.
  const cut = cutList(parts, p);
  const poolOf = (id: string) => {
    const row = cut.strips.find((r) => r.ids.includes(id));
    return row ? cut.resaw.find((q) => Math.abs(q.roughT - row.rough.t) < 0.002) : undefined;
  };
  const railPool = poolOf('rail-L');
  const bandPool = poolOf('side-L-chine');
  const spareOk = !!railPool && !!bandPool && railPool.spares > 0 && bandPool.spares > 0;
  const poolText = (label: string, q: typeof railPool): string => (q ? `${label} ${q.board} × ${q.boardWidthIn}" (${q.spares} spare ${q.spares === 1 ? 'strip' : 'strips'})` : label);

  // Lamp clip: the hand-hold is the clip outline plus 0.02" a side (clip notes, D-64).
  const clip = parts.find((x) => x.id === 'lamp-clip');
  let handHold = '4.5" × 1.25"';
  if (clip) {
    const b = localBounds(clip.geometry);
    handHold = `${f(b.max[0] - b.min[0] + 0.04, 2)}" × ${f(b.max[1] - b.min[1] + 0.04, 2)}"`;
  }

  const checks: Omit<VerifyCheck, 'n'>[] = [
    {
      id: 'tire-squash',
      title: 'Tire squash test (wheel stiffness)',
      whatToDo:
        `Before ordering four wheels, buy ONE. Inflate to ${SQUASH_TEST_PSI} psi, stand it on a hard floor, put a known ${testLb} lb over it (bathroom scale under a plank, or ${testLb} lb of weights on the axle) ` +
        `and measure the drop of the axle height with a ruler. Rate = load / squash. The model uses ${rate} lb/in, so it expects ${f(squashDesign)}" at ${testLb} lb.`,
      pass: `Squash ≥ ${f(squashMin)}" at ${testLb} lb, i.e. a rate ≤ ${rateMax} lb/in. A rider-only sled tolerates up to about 800 lb/in; the hard-hit rows (front beam groove wall, rear beam seat, king bearing) are the first to flip above ${rateMax}.`,
      ifFails:
        `Try a softer or larger tire, or lower the pressure; flat-free tires are stiffer (rate roughly doubles). Enter the measured rate in bumpWheelRateLbIn and re-run the checks before buying more.` +
        (p.tireType === 1 ? ' (This model is set to flat-free tires: measure that tire, not a pneumatic.)' : ''),
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['bumpWheelRateLbIn']),
      when: 'before ordering',
      refs: ['D-54', 'D-62'],
    },
    {
      id: 'wheel',
      title: `Wheel: Harbor Freight 10" pneumatic (SKU 67465), ${p.wheelMass10Lb} lb, ${p.wheelRatingLb} lb rating, ${fr(p.wheelBoreIn)}" bore, ${f(p.hubLengthIn)}" hub`,
      whatToDo:
        `Buy ONE wheel. Read the load rating off the box or the vendor listing (not the retailer blurb), slide a ${fr(p.wheelBoreIn)}" gauge pin (or a piece of the ${fr(tubeOd)}" axle rod) through the bore and check there is no play, and MEASURE THE HUB LENGTH with calipers: the Harbor Freight listing gives none, so the ${f(p.hubLengthIn)}" is assumed (the Uline H-5454, same class, and the Martin wheel list 2-1/4"). ` +
        `Weigh the wheel, check the bearing type (sealed ball or flanged bronze) and the tire width (3-1/2").`,
      pass:
        `Bore = ${fr(p.wheelBoreIn)}" (it matches the ${fr(tubeOd)}" axle: the bearings ride on the axle OD); rating ≥ ${p.wheelRatingLb} lb; hub length ≤ ${f(p.hubLengthIn)}" (shorter is fine, longer pushes the wheel out and shifts the stub-axle loads and the beam ends); ` +
        `mass ≤ ${p.wheelMass10Lb} lb + 0.25 lb. Peak rating allowance ${p.wheelRatingPeakMult}× and side rating ${f(p.wheelSideRatingFrac * 100, 0)} % of the radial rating are assumptions: ask the vendor, or drop-test one wheel.`,
      ifFails:
        'Enter the measured hub length, mass and rating in hubLengthIn / wheelMass10Lb / wheelRatingLb and re-run; the stub-axle length and the beam ends follow the hub. A different wheel (the Haul-Master steel hub, SKU 40729, $11.99, or the Uline H-5454 flat-free, $34, which is stiffer) is on the BOM line; the 3.5 lb, 350 lb Wesco 151551 class is the heavier fallback.',
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['wheelRatingLb', 'wheelBoreIn', 'hubLengthIn', 'wheelMass10Lb', 'wheelMass13Lb', 'flatFreeExtraLb', 'wheelRatingPeakMult', 'wheelSideRatingFrac']),
      when: 'before ordering',
      refs: ['D-11', 'D-60', 'D-71'],
    },
    ...(tubeWall > 0
      ? [{
        id: 'axle-tube',
        title: `Axle tube: DOM A513 Type 5, ${fr(tubeOd)}" × ${f(tubeWall, 3)}" (not ERW)`,
        whatToDo:
          `Order ${fr(tubeOd)}" OD × ${f(tubeWall, 3)}" wall DOM (drawn over mandrel) or CDS tube to ASTM A513 Type 5, 1020 or 1026, and ask for the mill cert, at ${f(p.axleTubeYieldPsi / 1000, 0)} ksi yield or better. Measure OD and wall with calipers on receipt (the cut ends show the wall). ` +
          `Read yield and tensile off the cert or the vendor listing. 1020 DOM is often listed at 55 to 60 ksi: that is not enough at ${f(p.axleTubeYieldPsi / 1000, 0)} ksi assumed.`,
        pass:
          `Seamless DOM/CDS, not ERW "mechanical" tube (about 45 ksi yield, 55 ksi ultimate, which takes the rear axle row from ${f(axleBaseUtil(p), 2)} to about ${f(axleUtilAt(p, p.axleTubeYieldPsi, 45000), 2)} at the goal rider; 60 ksi 1020 DOM gives about ${f(axleUtilAt(p, p.axleTubeYieldPsi, 60000), 2)}). Yield ≥ ${f(p.axleTubeYieldPsi / 1000, 0)} ksi, tensile ≥ ${f(p.axleTubeUltimatePsi / 1000, 0)} ksi (a cert of at least 65 ksi). OD ${fr(tubeOd)}" ±0.005", wall ${f(tubeWall, 3)}" ±0.010".`,
        ifFails: 'Lower axleTubeYieldPsi / axleTubeUltimatePsi to the cert values and re-run the checks; if the axle rows fail, go to the 0.188" wall or the solid 5/8" rod (+1.9 lb, axleWallIn 0).',
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: verifyKeys(['axleTubeYieldPsi', 'axleTubeUltimatePsi']),
        when: 'before ordering' as VerifyWhen,
        refs: ['D-60', 'D-71'],
      }]
      : [{
        id: 'axle-rod',
        title: `Axle rod: ${fr(tubeOd)}" 1045 or cold-drawn steel (not hot-rolled A36)`,
        whatToDo:
          `Order ${fr(tubeOd)}" solid rod in 1045 (cold-drawn or turned-ground-polished), 60 in or two shorter pieces, and ask for the mill cert or the supplier's listed yield. Reject hot-rolled A36 (36 ksi) and plain 1018 cold-drawn (about 54 ksi). ` +
          `Measure the OD with calipers on receipt (the wheel's ${fr(p.wheelBoreIn)}" bearings ride on it: ±0.005").`,
        pass:
          `Yield ≥ ${f(p.axleYieldPsi / 1000, 0)} ksi (1045 cold-drawn is typically 77 ksi or better). The rear axle row is ${f(axleBaseUtil(p), 2)} at the ${p.riderGoalMassLb} lb goal rider with ${f(p.axleYieldPsi / 1000, 0)} ksi; 1018 cold-drawn at 54 ksi would be about ${f(axleUtilAt(p, p.axleYieldPsi, 54000), 2)}, hot-rolled A36 at 36 ksi about ${f(axleUtilAt(p, p.axleYieldPsi, 36000), 2)}. OD ${fr(tubeOd)}" ±0.005".`,
        ifFails: 'Enter the cert yield in axleYieldPsi (and the tensile in axleUltimatePsi) and re-run the checks; if the axle rows fail, buy 1045 or 4140 instead, or accept a lower green range.',
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: verifyKeys(['axleYieldPsi', 'axleUltimatePsi']),
        when: 'before ordering' as VerifyWhen,
        refs: ['D-71'],
      }]),
    {
      id: 'steering-parts',
      title: 'Steering parts: eye bolts, check chain, kingpin, thrust disc',
      whatToDo:
        `Read the working load limit (WLL) off the vendor listing or the tag for: ${f(p.steerEyeBoltDiaIn)}" forged shoulder eye bolts (in-line WLL), ${f(p.steerChainDiaIn, 3)}" chain, the ${f(p.kingpinDiaIn)}" SAE grade 8 kingpin bolt (head marking: 6 radial lines), ` +
        `and the UHMW disc supplier's bearing-pressure limit. Listing numbers vary, so confirm the exact SKU. Check the eye bolts are forged shoulder type (not bent-wire "lag" eyes). ` +
        `Lengths (D-72, measured under the shoulder): the axle-beam bolt crosses the ${f(p.frontBeamThicknessIn)}" beam, a 2" fender washer and a nylock nut and needs ${f(beamEye.needIn)}" with 1.5 threads past the nut, so buy the stock ${fr(beamEye.stockIn)}"` +
        `${beamEye.cutToIn ? ` and CUT it to ${fr(beamEye.cutToIn)}" after fitting (it would stand ${f(beamEye.pastNutIn)}" past the nut; file the end, touch it with cold galvanizing)` : ''}; ` +
        `the chain-joist bolt crosses the ${f(p.chainJoistThickIn)}" joist and two washers and needs ${f(anchorEye.needIn)}", so buy the stock ${fr(anchorEye.stockIn)}"${anchorEye.cutToIn ? ` (optionally cut to ${fr(anchorEye.cutToIn)}")` : ''}. ` +
        `Neither fouls the wheel (the beam bolts sit ${f(p.steerChainBeamYIn)}" from the kingpin, inboard of the tires), the chain or the tongue swing.`,
      pass:
        `Eye bolt WLL ≥ ${p.steerEyeWllLb} lb in line; chain WLL ≥ ${p.steerChainWllLb} lb (grade 30 proof coil is lower: confirm the grade); kingpin yield ≥ ${f(p.grade8BoltYieldPsi / 1000, 0)} ksi (grade 8); UHMW ≥ ${p.steerBearingAllowPsi} psi static bearing.`,
      ifFails: 'Enter the listed WLLs in steerEyeWllLb / steerChainWllLb and re-run; step the eye bolt up to 1/2" or the chain up to 1/4" grade 43 if a steering-stop row fails (about +1 lb).',
      partIds: ids(parts, /^(steer-eye|steer-anchor|steer-chain|kingpin|king-thrust)/),
      paramKeys: verifyKeys(['steerEyeWllLb', 'steerChainWllLb', 'grade8BoltYieldPsi', 'steerBearingAllowPsi']),
      when: 'before ordering',
      refs: ['D-56', 'D-58', 'D-60'],
    },
    {
      id: 'bridle',
      title: 'Bridle: nylon rope strength and stretch, bronze sleeve stock size',
      whatToDo:
        `Read the minimum tensile strength of the ${f(p.bridleRopeDiaIn, 3)}" three-strand nylon off the listing (Cordage Institute figure). Field-test the stretch: tie a ${f(p.bridleRopeRunIn / 12, 0)} ft run, pull it with a luggage scale and measure the extension at 50 lb. ` +
        `Confirm the bronze sleeve is a stocked size: ${f(p.tongueSleeveBoreIn, 3)}" ID × 1" OD oil-embedded sleeve bearing (McMaster class), fits a 1" drilled hole. ` +
        `Tongue bolts (D-72): the two ${f(p.tongueBoltDiaIn, 3)}" 316 carriage bolts cross the ${f(p.tongueHeadLenIn)}" head and the ${f(p.frontBeamThicknessIn)}" beam, a washer and a nylock nut: they need ${f(tongueBolt.needIn)}" with 1.5 threads past the nut, so the stock length is ${fr(tongueBolt.stockIn)}" (a 6" bolt stops 1/16" short of the top of the nut).`,
      pass:
        `Break strength ≥ ${p.bridleRopeBreakLbf} lbf (the rope stays the weak link: WLL ${f(p.bridleRopeBreakLbf * p.bridleRopeWllFraction, 0)} lbf, ${f(p.bridleRopeBreakLbf * p.bridleKnotEfficiency, 0)} lbf at the bowline); ` +
        `stiffness ≈ ${p.bridleSnatchStiffLbIn} lb/in or softer (nylon ≈ 25, polyester ≈ 100); sleeve bore ${f(p.tongueSleeveBoreIn, 3)}" passes the ${f(p.bridleRopeDiaIn, 3)}" rope.`,
      ifFails: 'Enter the real strength and stiffness (bridleRopeBreakLbf, bridleSnatchStiffLbIn) and re-run the bridle rows; a stiffer rope needs a 3 ft shock-cord section.',
      partIds: ids(parts, /^(bridle|bridle-sleeve|bridle-tongue)$/),
      paramKeys: verifyKeys(['bridleRopeBreakLbf', 'bridleSnatchStiffLbIn', 'tongueSleeveBoreIn']),
      when: 'before ordering',
      refs: ['D-58', 'D-62'],
    },
    {
      id: 'seat-back',
      title: 'Seat back: spring-detent pin, threaded inserts, pin head vs cushion',
      whatToDo:
        'Spring-detent pin: with the real pin, measure the tip-to-ball distance and the head height; the upright groove is 0.73" from the hole mouth and the flat groove 0.26" below the deck (cut both with a hook tool, 1/16" wide, 1/32" deep). ' +
        `Inserts: epoxy a #10-32 × 5/16 insert in a scrap of the ${f(p.seatBackPlyIn * 25.4, 0)} mm okoume (0.344" blind hole, drill stop), cure, screw in a bolt and hang a bucket from it. Hinge: confirm the 2" 316 butt hinge's screw-in-oak rating. ` +
        'Fit the pin in the panel and check the head clears the cushion (cushion is set back 3/8").',
      pass:
        `Pin ball seats in both grooves and the pin retains in the blind holes; insert holds ≥ ${p.seatInsertPulloutLbf} lbf for 1 min with no creep; hinge allowable ≥ ${p.seatHingeLoadLbf} lbf each with #8 screws in oak; pin head clears the cushion (or notch the foam corners); ` +
        `#10 wood screw lateral value ≥ ${p.woodScrewLateralLbf} lbf in wet oak.`,
      ifFails: 'Move the insert holes or add a second row; if pull-out < 150 lbf use a thicker (9/16") back or through-bolts; buy a pin with a longer ball offset.',
      partIds: ids(parts, /^(seat-pin|seat-hinge|seat-back|seat-wedge|seat-crest)/),
      paramKeys: verifyKeys(['seatInsertPulloutLbf', 'seatHingeLoadLbf', 'woodScrewLateralLbf']),
      when: 'before cutting',
      refs: ['D-57', 'D-62', 'D-63'],
    },
    {
      id: 'sign-knobs',
      title: `Sign: ${fr(knob.lenIn)}" #10-32 thumb-knob screws`,
      whatToDo:
        `Order one sample of the 316 #10-32 × ${fr(knob.lenIn)}" thumb-knob screw (a ${fr(knob.lenIn)}" length is not stocked by every vendor; 1" and 3/4" are common). Stack a ${thin.nominal} scrap + the ${f(knob.standoffIn, 3)}" standoff disc + a ${thin.nominal} web scrap + the oak backing strip with the epoxied #10-32 × 5/16 insert, and run the screw home.`,
      pass: `Screw reaches the insert with ${f(knob.engagedIn, 2)}" of thread engaged and the tip stops ≥ 0.05" short of the back of the ${fr(knob.stripT)}" strip (design: ${f(knob.tipShortIn, 2)}" short); the knob can be turned by a gloved hand.`,
      ifFails: 'Use the next screw length that is stocked and change the standoff disc thickness to suit (a 5/16" nylon spacer is the alternative).',
      partIds: ids(parts, /^(sign-L|sign-R|sign-backer)/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-63', 'D-73'],
    },
    {
      id: 'brake-knee',
      title: 'Brake: pivot pin, flap tongue and tire clearance on the first knee',
      whatToDo:
        `Cut ONE knee blank (bandsaw the slot, 0.38" pin hole) with the real ${f(p.brakePivotPinDiaIn, 3)}" clevis pin, hitch-pin clip and a flap tongue + pivot block clamped in the slot, before cutting the other knee and the flaps; this test comes BEFORE the knees are glued, since the knees go on first while the hull is inverted (assembly step "Brake knees"). ` +
        `Check the slot clearance (0.06" a side), the pin bore across the ears, the flap swing and the pad gap to the tire. Drag-test the chock: pull a weighted chock across packed dirt or gravel with a scale (and wet). Test a pad sample on a wet tire.`,
      pass:
        `Pin slides in with a drop of grease and no slop, flap swings freely through its stroke and the pad hangs ${f(p.brakePadGapIn, 2)}" off the tread released; chock μ ≥ ${p.brakeChockMuFouled} (design ${p.brakeChockMu}); pad μ ≥ 0.4 wet (0.25 fouled).`,
      ifFails: 'Adjust the slot width or the pin-hole height on the real knee before cutting the rest; re-set brakeChockMu / brakeChockMuFouled to the measured values (the park-hold row uses the lower).',
      partIds: ids(parts, /^(brake-knee|brake-flap|brake-pivot|brake-chock|brake-pad|brake-shoe)/),
      paramKeys: verifyKeys(['brakeChockMu', 'brakeChockMuFouled']),
      when: 'before cutting',
      refs: ['D-57', 'D-65'],
    },
    {
      id: 'lamp-clip',
      title: 'Lamp clips: clearance against the real lamps',
      whatToDo:
        `Print a 1" test slice of the clip at 0.04 to 0.05" a side with 0.05" detent ribs (ASA, 4+ perimeters, printed on a long face). Cut a ${handHold} test slot in an offcut of the bulkhead stock on the Shaper, epoxy-seal and ease it, and push the slice in. ` +
        'Bolt each real lamp to the clip lip (M4 front, M3 rear heat-set inserts) and check the mount-hole spacing, lens clearance and the pull-out force.',
      pass: 'Slice is a firm push fit that pulls out by hand (detent ribs, no wobble); the lamp mount hole spacing matches the inserts; nothing binds when the slot is sealed with epoxy.',
      ifFails: 'Re-print the clip at the measured clearance (the clip is a pure function of the hand-hold size), then cut the real slots.',
      partIds: ids(parts, /^(lamp-clip|rear-lamp-clip|front-light|rear-light|bow-bulkhead|transom-rear)$/),
      paramKeys: [],
      when: 'before cutting',
      refs: ['D-64'],
    },
    {
      id: 'strip-bend',
      title: `Strip bend test: the rails and bands bend to the ${f(Math.round(bowTaper(p).minRadiusIn), 0)}" radius, in 2 plies`,
      whatToDo:
        `Before ordering the rest of the lumber list, buy the FIRST board of each strip pool (${poolText('rail strips:', railPool)}; ${poolText('band strips:', bandPool)}), rip a lane off it, then resaw and plane two dry test strips: a rail strip (${f(railStrip, 3)}" thick) and a band strip (${f(bandStrip, 3)}" thick). ` +
        (spareOk ? `Cut them from the planned SPARE strips, so the test costs no extra board (a strip that bends without cracking is not used up: it goes into the laminate). ` : `A pool has no planned spare strip: this test needs one more board. `) + `Bend them ` +
        `around a block cut to the tightest plan radius of the rail form (${f(bowTaper(p).minRadiusIn, 0)}"). Note any cracking, the spring-back, and whether damp heat is needed. The result decides 2 vs 3 plies, which changes the strip count and the boards to buy.`,
      pass: 'Both strips take the radius without a crack or raised grain; spring-back stays under about 10 % of the turn-in (the rail-form drawing notes the allowance).',
      ifFails: 'Plane the strips thinner (3 plies: the strip count, the cut list and the board plan all change), add damp heat, or relax the bow taper (bowTaperStartIn) and re-run the checks, all before the order goes in.',
      partIds: ids(parts, /^(rail-[LR]|side-[LR]-(chine|gunwale)(-in)?)$/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-66'],
    },
    {
      id: 'ply-thickness',
      title: 'Plywood thickness: measure the real sheets before any dado is cut',
      whatToDo:
        `Measure the ${thin.nominal} ${thin.key === 1 ? 'white oak plywood (nominal 1/4": it runs about 5.3 mm, and the veneer face varies)' : thin.key === 3 ? 'Baltic birch' : 'okoume'} and the 12 mm okoume with calipers on the edges at six or more points (BS 1088 12 mm often runs to 0.49" or more, and the sealed sheet is a few thousandths thicker). ` +
        `The web dados are the thin sheet ${f(thin.thicknessIn, 3)}" + ${f(p.grooveSlopIn, 3)}" slop = ${f(thin.thicknessIn + p.grooveSlopIn, 3)}"; the deck dado and the gap under the inner chine band are deckPlyIn ${f(p.deckPlyIn, 3)}" + ${f(p.deckSlopIn, 3)}" = ${f(p.deckPlyIn + p.deckSlopIn, 3)}". ` +
        (thin.key === 1 ? `Also check the glue line type on the sheet (interior or Type II is what the Standard weather spec assumes) and seal every face and edge. ` : '') +
        (thin.key === 3 ? `The sheet is probably 5 × 5 ft (60 × 60 in): confirm the size before ordering (the 59.6" side web blank only just fits). ` : ''),
      pass: `The ${thin.nominal} sheet measures ≤ ${f(thin.thicknessIn, 3)}" and the 12 mm ≤ ${f(p.deckPlyIn, 3)}" (each plus a 0.005" seal coat still enters its dado with 0.02-0.04" to spare).`,
      ifFails: `Enter the measured thickness (plus the seal coat) in ${thin.key === 1 ? 'whiteOakPlyThickIn' : thin.key === 3 ? 'balticThinThickIn' : 'panelPlyIn'} / deckPlyIn, re-run the checks and regenerate the Shaper files BEFORE a dado is cut; a thick sheet in a nominal dado cannot be fixed afterwards.`,
      partIds: ids(parts, /^(deck|side-[LR]-web|transom-rear|bow-bulkhead)$/),
      paramKeys: verifyKeys(['panelPlyIn', 'whiteOakPlyThickIn', 'balticThinThickIn', 'deckPlyIn', 'grooveSlopIn', 'deckSlopIn']),
      when: 'before cutting',
      refs: ['D-62', 'D-63', 'D-73'],
    },
  ];

  // Leftovers: any 'verify' param no check claims (the truck bed measurements, the NDS value, ...).
  const claimed = new Set(checks.flatMap((c) => c.paramKeys));
  const other = verifyParamKeys().filter((k) => !claimed.has(k));
  if (other.length) {
    const labels = other.map((k) => `${k} = ${PARAM_DEFS[k as keyof typeof PARAM_DEFS].default} ${PARAM_DEFS[k as keyof typeof PARAM_DEFS].unit}`.trim());
    checks.push({
      id: 'other-params',
      title: 'Other params to confirm',
      whatToDo: `Measure or look up each value and enter it if it differs: ${labels.join('; ')}. The truck dimensions (Q-1) are for a 2007 Tacoma short bed: measure yours with the tailgate down before cutting the transport fit.`,
      pass: 'Each value is within 0.25" (dimensions) or within the vendor / code figure (strengths) of the default; otherwise change the param and re-run the checks.',
      ifFails: 'Re-run the analysis with the measured value; fix the design only if a row flips.',
      partIds: [],
      paramKeys: other,
      when: 'before cutting',
      refs: ['Q-1', 'D-35', 'D-43'],
    });
  }

  return checks.map((c, i) => ({ ...c, n: i + 1 }));
}
