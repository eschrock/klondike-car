/**
 * Phase 4 output 8: "Verify before ordering" checklist (docs/phase3-checkpoint.md, nine checks).
 *
 * Pure function of (parts, params). The numbers come from the params the model uses; the part ids are the ones present in the built
 * model. Every param whose `status` is 'verify' is claimed by a check, and any left over lands in the last item ("other params to
 * confirm") automatically, so promoting or adding a verify param never needs an edit here.
 */
import { bowTaper, PARAM_DEFS, type Params } from '../params';
import { localBounds } from '../model/bounds';
import type { Part } from '../model/types';

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
  const tubeOd = p.axleDiameterIn;
  const tubeWall = p.axleWallIn;
  const railStrip = (parts.find((x) => x.id === 'rail-L')?.stock?.t ?? 0.375);
  const bandStrip = (parts.find((x) => x.id === 'side-L-chine')?.stock?.t ?? 0.234);

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
      title: `Wheel: ${p.wheelMass10Lb} lb, ${p.wheelRatingLb} lb rating, ${f(p.wheelBoreIn)}" bore, ${f(p.hubLengthIn)}" hub`,
      whatToDo:
        `On the same sample wheel: read the load rating off the vendor listing (not the retailer blurb), put a ${f(p.wheelBoreIn)}" gauge pin (or calipers) in the bore, measure the hub length with calipers and weigh the wheel. ` +
        `Check the bearing type (sealed ball or flanged bronze) and that a ${f(tubeOd)}" tube slides in without play.`,
      pass:
        `Rating ≥ ${p.wheelRatingLb} lb; bore = ${f(p.wheelBoreIn)}" (a 5/8" bore does not fit the ${f(tubeOd)}" axle); hub length ≤ ${f(p.hubLengthIn)}" (shorter is fine, longer pushes the wheel out and shifts the stub-axle loads); ` +
        `mass ≤ ${p.wheelMass10Lb} lb + 0.25 lb. Peak rating allowance ${p.wheelRatingPeakMult}× and side rating ${f(p.wheelSideRatingFrac * 100, 0)} % of the radial rating are assumptions: ask the vendor, or drop-test one wheel.`,
      ifFails:
        'Pick another wheel (the 3.5 lb, 350 lb Wesco 151551 class is the fallback, +0.7 lb each) and update wheelMass10Lb / wheelRatingLb / wheelBoreIn / hubLengthIn; the stub-axle length and beam end follow the hub.',
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['wheelRatingLb', 'wheelBoreIn', 'hubLengthIn', 'wheelMass10Lb', 'wheelMass13Lb', 'flatFreeExtraLb', 'wheelRatingPeakMult', 'wheelSideRatingFrac']),
      when: 'before ordering',
      refs: ['D-11', 'D-60'],
    },
    {
      id: 'axle-tube',
      title: `Axle tube: DOM A513 Type 5, ${f(tubeOd)}" × ${f(tubeWall, 3)}" (not ERW)`,
      whatToDo:
        `Order ${f(tubeOd)}" OD × ${f(tubeWall, 3)}" wall DOM (drawn over mandrel) or CDS tube to ASTM A513 Type 5, 1020 or 1026, and ask for the mill cert. Measure OD and wall with calipers on receipt (the cut ends show the wall). ` +
        `Read yield and tensile off the cert or the vendor listing.`,
      pass:
        `Seamless DOM/CDS, not ERW "mechanical" tube (about 45 ksi yield, 55 ksi ultimate, which takes the axle stress from 0.59 to 0.94). Yield ≥ ${f(p.axleTubeYieldPsi / 1000, 0)} ksi, tensile ≥ ${f(p.axleTubeUltimatePsi / 1000, 0)} ksi. OD ${f(tubeOd)}" ±0.005", wall ${f(tubeWall, 3)}" ±0.010".`,
      ifFails: 'Lower axleTubeYieldPsi / axleTubeUltimatePsi to the cert values and re-run the checks; if the axle rows fail, go to the 0.188" wall or the solid rod (+3.5 lb).',
      partIds: ids(parts, /^axle-(R|F[LR])$/),
      paramKeys: verifyKeys(['axleTubeYieldPsi', 'axleTubeUltimatePsi']),
      when: 'before ordering',
      refs: ['D-60'],
    },
    {
      id: 'steering-parts',
      title: 'Steering parts: eye bolts, check chain, kingpin, thrust disc',
      whatToDo:
        `Read the working load limit (WLL) off the vendor listing or the tag for: ${f(p.steerEyeBoltDiaIn)}" forged shoulder eye bolts (in-line WLL), ${f(p.steerChainDiaIn, 3)}" chain, the ${f(p.kingpinDiaIn)}" SAE grade 8 kingpin bolt (head marking: 6 radial lines), ` +
        `and the UHMW disc supplier's bearing-pressure limit. Listing numbers vary, so confirm the exact SKU. Check the eye bolts are forged shoulder type (not bent-wire "lag" eyes).`,
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
        `Confirm the bronze sleeve is a stocked size: ${f(p.tongueSleeveBoreIn, 3)}" ID × 1" OD oil-embedded sleeve bearing (McMaster class), fits a 1" drilled hole.`,
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
      title: 'Sign: 7/8" #10-32 thumb-knob screws',
      whatToDo:
        'Order one sample of the 316 #10-32 × 7/8" thumb-knob screw (a 7/8" length is not stocked by every vendor). Stack a 4 mm scrap + the 0.296" standoff disc + a 4 mm web scrap + the oak backing strip with the epoxied insert, and run the screw home.',
      pass: 'Screw reaches the insert with 0.26" of thread engaged and the tip stops ≥ 0.05" short of the back of the 1/2" strip (design: 0.24" short); the knob can be turned by a gloved hand.',
      ifFails: 'Use the 3/4" or 1" screw and change the standoff disc thickness to suit (a 5/16" nylon spacer is the alternative).',
      partIds: ids(parts, /^(sign-L|sign-R|sign-backer)/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-63'],
    },
    {
      id: 'brake-knee',
      title: 'Brake: pivot pin, flap tongue and tire clearance on the first knee',
      whatToDo:
        `Cut ONE knee blank (bandsaw the slot, 0.38" pin hole) with the real ${f(p.brakePivotPinDiaIn, 3)}" clevis pin, hitch-pin clip and a flap tongue + pivot block clamped in the slot, before cutting the other three knees and the flaps. ` +
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
        `Before ordering the lumber list, buy ONE board of the stock the strips are resawn from (the cut list's resaw pool) and resaw, plane and bend two dry test strips: a rail strip (${f(railStrip, 3)}" thick) and a band strip (${f(bandStrip, 3)}" thick), ` +
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
        `Measure the 4 mm and the 12 mm okoume with calipers on the edges at six or more points (BS 1088 12 mm often runs to 0.49" or more, and the sealed sheet is a few thousandths thicker). ` +
        `The web dados are panelPlyIn ${f(p.panelPlyIn, 3)}" + ${f(p.grooveSlopIn, 3)}" slop = ${f(p.panelPlyIn + p.grooveSlopIn, 3)}"; the deck dado and the gap under the inner chine band are deckPlyIn ${f(p.deckPlyIn, 3)}" + ${f(p.deckSlopIn, 3)}" = ${f(p.deckPlyIn + p.deckSlopIn, 3)}".`,
      pass: `The 4 mm sheet measures ≤ ${f(p.panelPlyIn, 3)}" and the 12 mm ≤ ${f(p.deckPlyIn, 3)}" (each plus a 0.005" seal coat still enters its dado with 0.02-0.04" to spare).`,
      ifFails: 'Enter the measured thickness (plus the seal coat) in panelPlyIn / deckPlyIn, re-run the checks and regenerate the Shaper files BEFORE a dado is cut; a thick sheet in a nominal dado cannot be fixed afterwards.',
      partIds: ids(parts, /^(deck|side-[LR]-web|transom-rear|bow-bulkhead)$/),
      paramKeys: verifyKeys(['panelPlyIn', 'deckPlyIn', 'grooveSlopIn', 'deckSlopIn']),
      when: 'before cutting',
      refs: ['D-62', 'D-63'],
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
