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
import type { Instr } from './assembly';

/** An instruction with plain sub-items. */
function it(text: string, sub: string[] = []): Instr {
  return { text, ...(sub.length ? { sub: sub.map((t) => ({ text: t })) } : {}) };
}
/** The instructions as one paragraph: each item, its sub-items after a colon or as sentences. */
function flatText(items: Instr[]): string {
  return items.map((i) => [i.text, ...(i.sub ?? []).map((q) => q.text)].join(' ')).join(' ');
}
/** A design value by the name the parameters panel shows (never its key). */
const lbl = (k: string): string => `"${PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.label ?? k}"`;

export type VerifyWhen = 'before ordering' | 'before cutting' | 'at assembly';

export interface VerifyCheck {
  id: string;
  /** 1-based position in the checklist. */
  n: number;
  /** A short title. */
  title: string;
  /** How to check: short actions with sub-bullets (the same shape as the assembly steps' `items`). */
  how: Instr[];
  /** `how` as one paragraph, for readers that do not know `how` yet. */
  whatToDo: string;
  /** Pass criteria, one short line each, with numbers from the params. */
  passList: string[];
  /** `passList` as one paragraph. */
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

  type Draft = Omit<VerifyCheck, 'n' | 'whatToDo' | 'pass'>;
  const drafts: Draft[] = [
    {
      id: 'tire-squash',
      title: 'Tire squash test',
      how: [
        it('Try ONE wheel before getting four.', [`Inflate it to ${SQUASH_TEST_PSI} psi and stand it on a hard floor.`]),
        it(`Load it with a known ${testLb} lb.`, [`A bathroom scale under a plank, or ${testLb} lb of weights on the axle.`]),
        it('Measure how far the axle drops (the squash) with a ruler.', [`Rate = load / squash. The design assumes ${rate} lb/in, so it expects ${f(squashDesign)}" at ${testLb} lb.`]),
      ],
      passList: [
        `Squash ≥ ${f(squashMin)}" at ${testLb} lb, i.e. a rate ≤ ${rateMax} lb/in.`,
        `A rider-only sled tolerates up to about 800 lb/in; the hard-hit rows (front beam groove wall, rear beam seat, king bearing) are the first to flip above ${rateMax}.`,
      ],
      ifFails:
        `Try a softer or larger tire, or lower the pressure; flat-free tires are stiffer (the rate roughly doubles). Enter the measured rate in ${lbl('bumpWheelRateLbIn')} and re-run the checks before getting more wheels.` +
        (p.tireType === 1 ? ' (This design is set to flat-free tires: measure that tire, not a pneumatic.)' : ''),
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['bumpWheelRateLbIn']),
      when: 'before ordering',
      refs: ['D-54', 'D-62'],
    },
    {
      id: 'wheel',
      title: `Wheel: Harbor Freight 10" pneumatic (SKU 67465)`,
      how: [
        it('With the one wheel in hand:', [
          'Read the load rating off the box or the vendor listing (not the retailer blurb).',
          `Slide a ${fr(p.wheelBoreIn)}" gauge pin (or a piece of the ${fr(tubeOd)}" axle) through the bore: no play.`,
        ]),
        it('MEASURE THE HUB LENGTH with calipers.', [`The listing gives none, so ${f(p.hubLengthIn)}" is assumed (the Uline H-5454, same class, and the Martin wheel list 2-1/4").`]),
        it('Weigh it and note the bearing type (sealed ball or flanged bronze) and the tire width (3-1/2").'),
      ],
      passList: [
        `Bore = ${fr(p.wheelBoreIn)}" (it matches the ${fr(tubeOd)}" axle: the bearings ride on the axle).`,
        `Rating ≥ ${p.wheelRatingLb} lb; mass ≤ ${p.wheelMass10Lb} lb + 1/4 lb.`,
        `Hub length ≤ ${f(p.hubLengthIn)}" (shorter is fine; longer pushes the wheel out and moves the stub-axle loads and the beam ends).`,
        `The ${p.wheelRatingPeakMult}× peak allowance and the side rating of ${f(p.wheelSideRatingFrac * 100, 0)} % of the radial rating are assumptions: ask the vendor, or drop-test one wheel.`,
      ],
      ifFails:
        `Enter the measured hub length, mass and rating in the design (${lbl('hubLengthIn')}, ${lbl('wheelMass10Lb')}, ${lbl('wheelRatingLb')}) and re-run; the stub-axle length and the beam ends follow the hub. Alternatives are on the BOM line: the Haul-Master steel hub (SKU 40729) or the stiffer Uline H-5454 flat-free; the 3.5 lb, 350 lb Wesco 151551 class is the heavier fallback.`,
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['wheelRatingLb', 'wheelBoreIn', 'hubLengthIn', 'wheelMass10Lb', 'wheelMass13Lb', 'flatFreeExtraLb', 'wheelRatingPeakMult', 'wheelSideRatingFrac']),
      when: 'before ordering',
      refs: ['D-11', 'D-60', 'D-71'],
    },
    ...(tubeWall > 0
      ? [{
        id: 'axle-tube',
        title: `Axle tube: DOM A513 Type 5, ${fr(tubeOd)}" × ${f(tubeWall, 3)}" (not ERW)`,
        how: [
          it(`Get ${fr(tubeOd)}" OD × ${f(tubeWall, 3)}" wall DOM (drawn over mandrel) or CDS tube to ASTM A513 Type 5, 1020 or 1026, with the mill cert.`, [`It needs ${f(p.axleTubeYieldPsi / 1000, 0)} ksi yield or better; 1020 DOM is often listed at 55 to 60 ksi, which is not enough.`]),
          it('On receipt, measure the OD and the wall with calipers (the cut ends show the wall).'),
          it('Read the yield and tensile strength off the cert or the vendor listing.'),
        ],
        passList: [
          `Seamless DOM or CDS, not ERW "mechanical" tube (about 45 ksi yield, 55 ksi ultimate, which takes the rear axle row from ${f(axleBaseUtil(p), 2)} to about ${f(axleUtilAt(p, p.axleTubeYieldPsi, 45000), 2)} at the goal rider; 60 ksi 1020 DOM gives about ${f(axleUtilAt(p, p.axleTubeYieldPsi, 60000), 2)}).`,
          `Yield ≥ ${f(p.axleTubeYieldPsi / 1000, 0)} ksi, tensile ≥ ${f(p.axleTubeUltimatePsi / 1000, 0)} ksi (a cert of at least 65 ksi).`,
          `OD ${fr(tubeOd)}" ±0.005", wall ${f(tubeWall, 3)}" ±0.010".`,
        ],
        ifFails: `Enter the cert values in ${lbl('axleTubeYieldPsi')} and the ultimate strength and re-run the checks; if the axle rows fail, go to the 0.188" wall or the solid 5/8" rod (+1.9 lb; ${lbl('axleWallIn')} 0).`,
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: verifyKeys(['axleTubeYieldPsi', 'axleTubeUltimatePsi']),
        when: 'before ordering' as VerifyWhen,
        refs: ['D-60', 'D-71'],
      }]
      : [{
        id: 'axle-rod',
        title: `Axle rod: ${fr(tubeOd)}" 1045 or cold-drawn steel (not hot-rolled A36)`,
        how: [
          it(`Get ${fr(tubeOd)}" solid rod in 1045 (cold-drawn or turned-ground-polished), 60" or two shorter pieces, with the mill cert or the supplier's listed yield.`, ['Reject hot-rolled A36 (36 ksi) and plain 1018 cold-drawn (about 54 ksi).']),
          it('On receipt, measure the OD with calipers.', [`The wheel's ${fr(p.wheelBoreIn)}" bearings ride on it.`]),
        ],
        passList: [
          `Yield ≥ ${f(p.axleYieldPsi / 1000, 0)} ksi (1045 cold-drawn is typically 77 ksi or better).`,
          `The rear axle row is ${f(axleBaseUtil(p), 2)} at the ${p.riderGoalMassLb} lb goal rider with ${f(p.axleYieldPsi / 1000, 0)} ksi; 1018 cold-drawn at 54 ksi would be about ${f(axleUtilAt(p, p.axleYieldPsi, 54000), 2)}, hot-rolled A36 at 36 ksi about ${f(axleUtilAt(p, p.axleYieldPsi, 36000), 2)}.`,
          `OD ${fr(tubeOd)}" ±0.005".`,
        ],
        ifFails: `Enter the cert yield in ${lbl('axleYieldPsi')} (and the tensile in ${lbl('axleUltimatePsi')}) and re-run the checks; if the axle rows fail, get 1045 or 4140 instead, or accept a lower green range.`,
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: verifyKeys(['axleYieldPsi', 'axleUltimatePsi']),
        when: 'before ordering' as VerifyWhen,
        refs: ['D-71'],
      }]),
    {
      id: 'steering-parts',
      title: 'Steering parts: eye bolts, check chain, kingpin, thrust disc',
      how: [
        it('Read the working load limit (WLL) off the vendor listing or the tag, and confirm the exact SKU (listings vary).', [
          `${fr(p.steerEyeBoltDiaIn)}" forged shoulder eye bolts, in-line WLL; not bent-wire "lag" eyes.`,
          `${fr(p.steerChainDiaIn)}" chain.`,
          `The ${fr(p.kingpinDiaIn)}" SAE grade 8 kingpin bolt (head marking: 6 radial lines).`,
          'The UHMW disc supplier\'s bearing-pressure limit.',
        ]),
        it('Eye-bolt lengths (D-72, measured under the shoulder):', [
          `Axle-beam bolt: crosses the ${fr(p.frontBeamThicknessIn)}" beam, a 2" fender washer and a nylock nut and needs ${f(beamEye.needIn)}" with 1.5 threads past the nut, so buy the stock ${fr(beamEye.stockIn)}"` +
          `${beamEye.cutToIn ? ` and CUT it to ${fr(beamEye.cutToIn)}" after fitting (it would stand ${f(beamEye.pastNutIn)}" past the nut; file the end, touch it with cold galvanizing)` : ''}.`,
          `Chain-crossmember bolt: crosses the ${fr(p.chainJoistThickIn)}" crossmember and two washers and needs ${f(anchorEye.needIn)}", so buy the stock ${fr(anchorEye.stockIn)}"${anchorEye.cutToIn ? ` (optionally cut to ${fr(anchorEye.cutToIn)}")` : ''}.`,
          `Neither fouls the wheel (the beam bolts sit ${fr(p.steerChainBeamYIn)}" from the kingpin, inboard of the tires), the chain or the tongue swing.`,
        ]),
      ],
      passList: [
        `Eye bolt WLL ≥ ${p.steerEyeWllLb} lb in line.`,
        `Chain WLL ≥ ${p.steerChainWllLb} lb (grade 30 proof coil is lower: confirm the grade).`,
        `Kingpin yield ≥ ${f(p.grade8BoltYieldPsi / 1000, 0)} ksi (grade 8); UHMW ≥ ${p.steerBearingAllowPsi} psi static bearing.`,
      ],
      ifFails: `Enter the listed WLLs in the design (${lbl('steerEyeWllLb')}, ${lbl('steerChainWllLb')}) and re-run; step the eye bolt up to 1/2" or the chain to 1/4" grade 43 if a steering-stop row fails (about +1 lb).`,
      partIds: ids(parts, /^(steer-eye|steer-anchor|steer-chain|kingpin|king-thrust)/),
      paramKeys: verifyKeys(['steerEyeWllLb', 'steerChainWllLb', 'grade8BoltYieldPsi', 'steerBearingAllowPsi']),
      when: 'before ordering',
      refs: ['D-56', 'D-58', 'D-60'],
    },
    {
      id: 'bridle',
      title: 'Bridle: rope strength and stretch, bronze sleeve size',
      how: [
        it(`Read the minimum tensile strength of the ${fr(p.bridleRopeDiaIn)}" three-strand nylon off the listing (Cordage Institute figure).`),
        it('Field-test the stretch.', [`Tie a ${f(p.bridleRopeRunIn / 12, 0)} ft run, pull it with a luggage scale and measure the stretch at 50 lb.`]),
        it(`Confirm the bronze sleeve is a stocked size: ${fr(p.tongueSleeveBoreIn)}" ID × 1" OD oil-embedded sleeve bearing (McMaster class), for a 1" drilled hole.`),
        it(`Tongue bolts (D-72): the two ${fr(p.tongueBoltDiaIn)}" carriage bolts cross the ${fr(p.tongueHeadLenIn)}" head, the ${fr(p.frontBeamThicknessIn)}" beam, a washer and a nylock nut.`, [
          `They need ${f(tongueBolt.needIn)}" with 1.5 threads past the nut, so the stock length is ${fr(tongueBolt.stockIn)}" (a 6" bolt stops 1/16" short of the top of the nut).`,
        ]),
      ],
      passList: [
        `Break strength ≥ ${p.bridleRopeBreakLbf} lbf (the rope stays the weak link: WLL ${f(p.bridleRopeBreakLbf * p.bridleRopeWllFraction, 0)} lbf, ${f(p.bridleRopeBreakLbf * p.bridleKnotEfficiency, 0)} lbf at the bowline).`,
        `Stiffness about ${p.bridleSnatchStiffLbIn} lb/in or softer (nylon about 25, polyester about 100).`,
        `The ${fr(p.tongueSleeveBoreIn)}" sleeve bore passes the ${fr(p.bridleRopeDiaIn)}" rope.`,
      ],
      ifFails: `Enter the real strength and stiffness in the design (${lbl('bridleRopeBreakLbf')}, ${lbl('bridleSnatchStiffLbIn')}) and re-run the bridle rows; a stiffer rope needs a 3 ft shock-cord section.`,
      partIds: ids(parts, /^(bridle|bridle-sleeve|bridle-tongue)$/),
      paramKeys: verifyKeys(['bridleRopeBreakLbf', 'bridleSnatchStiffLbIn', 'tongueSleeveBoreIn']),
      when: 'before ordering',
      refs: ['D-58', 'D-62'],
    },
    {
      id: 'seat-back',
      title: 'Seat back: detent pin, inserts, pin head vs cushion',
      how: [
        it('Spring-detent pin: with the real pin, measure the tip-to-ball distance and the head height.', ['The upright groove is 23/32" from the hole mouth, the flat groove 1/4" below the deck.', 'Cut both with a hook tool, 1/16" wide, 1/32" deep.']),
        it(`Inserts: epoxy a #10-32 × 5/16 insert in a scrap of the ${f(p.seatBackPlyIn * 25.4, 0)} mm okoume.`, ['11/32" blind hole with a drill stop; let it cure.', 'Screw in a bolt and hang a bucket from it.']),
        it('Hinge: confirm the 2" stainless butt hinge\'s screw-in-oak rating.'),
        it('Fit the pin in the panel and check the head clears the cushion (the cushion is set back 3/8").'),
      ],
      passList: [
        'The pin ball seats in both grooves and the pin stays in the blind holes.',
        `The insert holds ≥ ${p.seatInsertPulloutLbf} lbf for 1 min with no creep.`,
        `Hinge allowable ≥ ${p.seatHingeLoadLbf} lbf each with #8 screws in oak; #10 wood screw lateral value ≥ ${p.woodScrewLateralLbf} lbf in wet oak.`,
        'The pin head clears the cushion (or notch the foam corners).',
      ],
      ifFails: 'Move the insert holes or add a second row; if the pull-out is under 150 lbf use a thicker (9/16") back or through-bolts; get a pin with a longer ball offset.',
      partIds: ids(parts, /^(seat-pin|seat-hinge|seat-back|seat-wedge|seat-crest)/),
      paramKeys: verifyKeys(['seatInsertPulloutLbf', 'seatHingeLoadLbf', 'woodScrewLateralLbf']),
      when: 'before cutting',
      refs: ['D-57', 'D-62', 'D-63'],
    },
    {
      id: 'sign-knobs',
      title: `Sign: ${fr(knob.lenIn)}" #10-32 thumb-knob screws`,
      how: [
        it(`Get one sample of the stainless #10-32 × ${fr(knob.lenIn)}" thumb-knob screw.`, [`A ${fr(knob.lenIn)}" length is not stocked by every vendor; 1" and 3/4" are common.`]),
        it('Stack the real layers and run the screw home.', [`A ${thin.nominal} scrap, the ${f(knob.standoffIn, 2)}" standoff disc, a ${thin.nominal} web scrap and the oak backing strip with its epoxied #10-32 × 5/16 insert.`]),
      ],
      passList: [
        `The screw reaches the insert with ${f(knob.engagedIn, 2)}" of thread engaged.`,
        `The tip stops at least 0.05" short of the back of the ${fr(knob.stripT)}" strip (design: ${f(knob.tipShortIn, 2)}" short).`,
        'The knob turns by a gloved hand.',
      ],
      ifFails: 'Use the next stocked screw length and change the standoff disc thickness to suit (a 5/16" nylon spacer is the alternative).',
      partIds: ids(parts, /^(sign-L|sign-R|sign-backer)/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-63', 'D-73'],
    },
    {
      id: 'brake-knee',
      title: 'Brake: pin, flap tongue and tire clearance on the first knee',
      how: [
        it('Cut ONE knee blank first, before cutting the other knee and the flaps.', [
          `Bandsaw the slot and drill the 3/8" pin hole; use the real ${fr(p.brakePivotPinDiaIn)}" clevis pin, the hitch-pin clip and a flap tongue with its pivot block clamped in the slot.`,
          'This test comes BEFORE the knees are glued: the knees go on first, while the hull is inverted (assembly step "Brake knees").',
        ]),
        it('Check the slot clearance (1/16" a side), the pin bore across the ears, the flap swing and the pad gap to the tire.'),
        it('Drag-test a chock: pull a weighted chock across packed dirt or gravel with a scale, dry and wet.'),
        it('Test a pad sample on a wet tire.'),
      ],
      passList: [
        'The pin slides in with a drop of grease and no slop; the flap swings freely through its stroke.',
        `The pad hangs ${fr(p.brakePadGapIn)}" off the tread when released.`,
        `Chock μ ≥ ${p.brakeChockMuFouled} (design ${p.brakeChockMu}); pad μ ≥ 0.4 wet (0.25 fouled).`,
      ],
      ifFails: `Adjust the slot width or the pin-hole height on the real knee before cutting the rest; enter the measured friction in the design (${lbl('brakeChockMu')}, ${lbl('brakeChockMuFouled')}; the park-hold row uses the lower).`,
      partIds: ids(parts, /^(brake-knee|brake-flap|brake-pivot|brake-chock|brake-pad|brake-shoe)/),
      paramKeys: verifyKeys(['brakeChockMu', 'brakeChockMuFouled']),
      when: 'before cutting',
      refs: ['D-57', 'D-65'],
    },
    {
      id: 'lamp-clip',
      title: 'Lamp clips: fit against the real lamps',
      how: [
        it('Print a 1" test slice of the clip.', ['0.04-0.05" clearance a side, 0.05" detent ribs; ASA, 4+ perimeters, printed on a long face.']),
        it(`Cut a ${handHold} test slot in an offcut of the bulkhead stock on the Shaper.`, ['Epoxy-seal and ease it, then push the slice in.']),
        it('Bolt each real lamp to the clip lip (M4 front, M3 rear heat-set inserts).', ['Check the mount-hole spacing, the lens clearance and the pull-out force.']),
      ],
      passList: ['The slice is a firm push fit that pulls out by hand (detent ribs, no wobble).', 'The lamp mount-hole spacing matches the inserts.', 'Nothing binds once the slot is sealed with epoxy.'],
      ifFails: 'Re-print the clip at the measured clearance (the clip is a pure function of the hand-hold size), then cut the real slots.',
      partIds: ids(parts, /^(lamp-clip|rear-lamp-clip|front-light|rear-light|bow-bulkhead|transom-rear)$/),
      paramKeys: [],
      when: 'before cutting',
      refs: ['D-64'],
    },
    {
      id: 'strip-bend',
      title: `Strip bend test: ${f(Math.round(bowTaper(p).minRadiusIn), 0)}" radius in 2 plies`,
      how: [
        it(`Get the FIRST board of each strip pool before the rest of the lumber list (${poolText('rail strips:', railPool)}; ${poolText('band strips:', bandPool)}).`, [
          spareOk
            ? 'Cut the test strips from the planned SPARE strips, so the test costs no extra board (a strip that bends without cracking is not used up: it goes into the laminate).'
            : 'A pool has no planned spare strip: this test needs one more board.',
        ]),
        it('Rip a lane off each board, then resaw and plane two dry test strips.', [`A rail strip (${f(railStrip * 25.4, 1)} mm, ${fr(railStrip)}") and a band strip (${f(bandStrip * 25.4, 1)} mm).`]),
        it(`Bend them around a block cut to the tightest plan radius of the rail form (${f(bowTaper(p).minRadiusIn, 0)}").`, ['Note any cracking, the spring-back, and whether damp heat is needed.', 'The result decides 2 vs 3 plies, which changes the strip count and the boards to get.']),
      ],
      passList: ['Both strips take the radius without a crack or raised grain.', 'Spring-back stays under about 10 % of the turn-in (the rail-form drawing notes the allowance).'],
      ifFails: `Plane the strips thinner (3 plies: the strip count, the cut list and the board plan all change), add damp heat, or relax the bow taper (${lbl('bowTaperStartIn')}) and re-run the checks, all before the lumber goes on order.`,
      partIds: ids(parts, /^(rail-[LR]|side-[LR]-(chine|gunwale)(-in)?)$/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-66'],
    },
    {
      id: 'ply-thickness',
      title: 'Plywood thickness: measure before any dado is cut',
      how: [
        it(`Measure the ${thin.nominal} ${thin.key === 1 ? 'white oak plywood' : thin.key === 3 ? 'Baltic birch' : 'okoume'} and the 12 mm okoume with calipers, at six or more points on the edges.`, [
          thin.key === 1 ? 'Nominal 1/4" white oak plywood runs about 5.3 mm, and the veneer face varies.' : '',
          'BS 1088 12 mm often runs to 0.49" or more, and the sealed sheet is a few thousandths thicker.',
        ].filter(Boolean)),
        it('Compare with the dados the Shaper files will cut.', [
          `Web dados: the thin sheet ${f(thin.thicknessIn, 3)}" + ${f(p.grooveSlopIn, 3)}" slop = ${f(thin.thicknessIn + p.grooveSlopIn, 3)}".`,
          `Deck dado and the gap under the inner chine band: ${f(p.deckPlyIn, 3)}" + ${f(p.deckSlopIn, 3)}" = ${f(p.deckPlyIn + p.deckSlopIn, 3)}".`,
        ]),
        ...(thin.key === 1 ? [it('Check the glue-line type on the sheet (interior or Type II is what the Standard weather spec assumes); seal every face and edge.')] : []),
        ...(thin.key === 3 ? [it('Confirm the sheet size: probably 5 × 5 ft (60 × 60 in); the 59.6" side web blank only just fits.')] : []),
      ],
      passList: [`The ${thin.nominal} sheet measures ≤ ${f(thin.thicknessIn, 3)}" and the 12 mm ≤ ${f(p.deckPlyIn, 3)}": each, plus a 0.005" seal coat, still enters its dado with 0.02-0.04" to spare.`],
      ifFails: `Enter the measured thickness (plus the seal coat) in the design (${lbl(thin.key === 1 ? 'whiteOakPlyThickIn' : thin.key === 3 ? 'balticThinThickIn' : 'panelPlyIn')}, ${lbl('deckPlyIn')}), re-run the checks and regenerate the Shaper files BEFORE a dado is cut: a thick sheet in a nominal dado cannot be fixed afterwards.`,
      partIds: ids(parts, /^(deck|side-[LR]-web|transom-rear|bow-bulkhead)$/),
      paramKeys: verifyKeys(['panelPlyIn', 'whiteOakPlyThickIn', 'balticThinThickIn', 'deckPlyIn', 'grooveSlopIn', 'deckSlopIn']),
      when: 'before cutting',
      refs: ['D-62', 'D-63', 'D-73'],
    },
  ];

  // Leftovers: any 'verify' param no check claims (the truck bed measurements, the NDS value, ...).
  const claimed = new Set(drafts.flatMap((c) => c.paramKeys));
  const other = verifyParamKeys().filter((k) => !claimed.has(k));
  if (other.length) {
    drafts.push({
      id: 'other-params',
      title: 'Other design values to confirm',
      how: [
        it('Measure or look up each value and enter it in the design if it differs:', other.map((k) => {
          const d = PARAM_DEFS[k as keyof typeof PARAM_DEFS];
          return `${d.label}: ${d.default}${d.unit ? ` ${d.unit}` : ''}.`;
        })),
        it('The truck values are for a 2007 Tacoma short bed: measure yours with the tailgate down before cutting the transport fit (Q-1).'),
      ],
      passList: ['Each value is within 1/4" (dimensions) or within the vendor / code figure (strengths) of the default; otherwise change it and re-run the checks.'],
      ifFails: 'Re-run the analysis with the measured value; change the design only if a row flips.',
      partIds: [],
      paramKeys: other,
      when: 'before cutting',
      refs: ['Q-1', 'D-35', 'D-43'],
    });
  }

  return drafts.map((c, i) => ({ ...c, n: i + 1, whatToDo: flatText(c.how), pass: c.passList.join(' ') }));
}
