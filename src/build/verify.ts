/**
 * "Verify before ordering" checklist (nine checks).
 *
 * Pure function of (parts, params). The numbers come from the params the model uses; the part ids are the ones present in the built
 * model. Every param whose `status` is 'verify' is claimed by a check, and any left over lands in the last item ("other params to
 * confirm") automatically, so promoting or adding a verify param never needs an edit here.
 */
import { bowTaper, KNEE_MOUNT, PARAM_DEFS, thinSheet, WEATHER_SPEC, type Params } from '../params';
import { runChecks } from '../analysis';
import { signKnobPlan } from '../model/body';
import { computeLayout, innerHalfWidth } from '../model/layout';
import { LASH_BOLTS, LASH_BOLT_DIA_IN, LASH_HOLE_DX_IN, LASH_PLATE, lashBoltLength, sideRibStations } from '../model/side-ribs';
import { CARRIAGE_STOCK_IN, EYE_BOLT_STOCK_IN, stockBoltFit } from '../model/rear-mount';
import { localBounds } from '../model/bounds';
import type { Part } from '../model/types';
import { cutList } from './cutlist';
import { OAK_PRICE_PER_BF } from './prices';
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
  /** DECISIONS.md IDs. */
  refs: string[];
}

/** The pre-order gate passes with a real rate up to this multiple of the modeled rate (560 / 500 lb/in at the defaults; bumpWheelRateLbIn note, D-54). */
export const BUMP_RATE_PASS_MARGIN = 1.12;
/** Inflation for the squash test (bumpWheelRateLbIn note). */
export const SQUASH_TEST_PSI = 30;

const f = (n: number, d = 2): string => String(+n.toFixed(d));

/** Fraction text for a size ("5/8", "2-1/4"), to the nearest 1/`denom` in (16 by default). */
function fr(x: number, denom = 16): string {
  const n = Math.round(x * denom);
  const whole = Math.floor(n / denom);
  let num = n % denom, den = denom;
  while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; }
  if (num === 0) return `${whole}`;
  return whole > 0 ? `${whole}-${num}/${den}` : `${num}/${den}`;
}
/** A length rounded UP to the next 1/16, as a fraction ("3-3/16"): a bolt that must be at least this long. */
const frUp = (x: number): string => fr(Math.ceil(x * 16 - 1e-6) / 16);

/** The parameters-panel labels of design values (never their keys), in the order given. */
export function paramLabels(keys: string[]): string[] {
  return keys.map((k) => PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.label ?? k);
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
/** The margin a utilization leaves, in plain words: "passes with about 20 % to spare" (to the nearest 5 %), "is at its limit", or "fails by about 50 %". */
export function marginWords(util: number): string {
  if (util < 0.975) return `passes with about ${Math.max(5, Math.round((1 - util) * 20) * 5)} % to spare`;
  if (util <= 1.025) return 'is right at its limit, with nothing to spare';
  return `fails by about ${Math.max(5, Math.round((util - 1) * 20) * 5)} %`;
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

/** Verify params of parts or materials THIS design does not use (the axle tube's strengths with a solid rod, the other thin sheets' thicknesses): they never go on the confirm list. */
export function unusedVerifyKeys(p: Params): string[] {
  const thin = thinSheet(p);
  return [
    ...(p.axleWallIn > 0 ? ['axleYieldPsi', 'axleUltimatePsi'] : ['axleTubeYieldPsi', 'axleTubeUltimatePsi']),
    ...(thin.key === 1 ? [] : ['whiteOakPlyThickIn']),
    ...(thin.key === 3 ? [] : ['balticThinThickIn']),
    ...(thin.key === 4 ? [] : ['balticSixThickIn']),
  ];
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
  const std = p.weatherSpec !== WEATHER_SPEC.extreme;
  const knob = signKnobPlan({ p, L: computeLayout(p) });
  // D-72: stock lengths of the eye bolts and the tongue's carriage bolts against their real stacks.
  const beamEye = stockBoltFit(p.frontBeamThicknessIn, p.steerEyeBoltDiaIn, 1, EYE_BOLT_STOCK_IN);
  const anchorEye = stockBoltFit(p.chainJoistThickIn, p.steerEyeBoltDiaIn, 2, EYE_BOLT_STOCK_IN);
  const tongueBolt = stockBoltFit(p.tongueHeadLenIn + p.frontBeamThicknessIn, p.tongueBoltDiaIn, 1, CARRIAGE_STOCK_IN);
  const thinKey = thin.key === 1 ? 'whiteOakPlyThickIn' : thin.key === 3 ? 'balticThinThickIn' : thin.key === 4 ? 'balticSixThickIn' : 'panelPlyIn';
  const tubeOd = p.axleDiameterIn;
  const tubeWall = p.axleWallIn;
  const railStrip = (parts.find((x) => x.id === 'rail-L')?.stock?.t ?? 0.375);
  // D-76: the bow post's inner face against a booted rider, and the chain joist as the fallback station.
  const ribL = computeLayout(p);
  const bowSt = sideRibStations(p, ribL)[2];
  const bowRib = {
    face: bowSt.yIn - p.sideRibDepthIn,
    fromTransom: bowSt.x - ribL.xRear,
    alt: ribL.chain.joistX < bowSt.x - 0.5
      ? { face: innerHalfWidth(ribL, ribL.chain.joistX) - p.sideRibDepthIn, fromTransom: ribL.chain.joistX - ribL.xRear, fromAxle: ribL.chain.joistX }
      : null,
  };
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
  let handHold = '4-1/2" × 1-1/4"';
  if (clip) {
    const b = localBounds(clip.geometry);
    handHold = `${fr(b.max[0] - b.min[0] + 0.04, 32)}" × ${fr(b.max[1] - b.min[1] + 0.04, 32)}"`;
  }

  type Draft = Omit<VerifyCheck, 'n' | 'whatToDo' | 'pass'>;
  const drafts: Draft[] = [
    {
      id: 'tire-squash',
      title: 'Tire squash test',
      how: [
        it('Try ONE wheel before getting four.', [`Inflate it to ${SQUASH_TEST_PSI} psi and stand it on a hard floor.`]),
        it(`Load it with a known ${testLb} lb.`, [`A bathroom scale under a plank, or ${testLb} lb of weights on the axle.`]),
        it('Measure how far the axle drops (the squash) with a ruler.', [`Rate = load / squash. The design assumes ${rate} lb/in, so it expects about ${fr(squashDesign)}" at ${testLb} lb.`]),
      ],
      passList: [
        `Squash at least ${frUp(squashMin)}" at ${testLb} lb, which is a rate of ${rateMax} lb/in or less.`,
        `A sled with only a rider on it tolerates up to about 800 lb/in. The front beam groove wall, the rear beam seat and the kingpin bearing are the first to fail above ${rateMax}.`,
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
        it('MEASURE THE HUB LENGTH with calipers.', [`The listing gives none, so ${fr(p.hubLengthIn)}" is assumed, not known: the Uline H-5454 (same class) and the Martin wheel list 2-1/4". The design stands on that number until you measure the real hub.`]),
        it('Weigh it and note the bearing type (sealed ball or flanged bronze) and the tire width (3-1/2").'),
      ],
      passList: [
        `Bore = ${fr(p.wheelBoreIn)}" (it matches the ${fr(tubeOd)}" axle: the bearings ride on the axle).`,
        `Rating ≥ ${p.wheelRatingLb} lb; mass ≤ ${p.wheelMass10Lb} lb + 1/4 lb.`,
        `Hub length ${fr(p.hubLengthIn)}" or less (shorter is fine; longer pushes the wheel out and moves the stub-axle loads and the beam ends).`,
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
          `Seamless DOM or CDS, not ERW "mechanical" tube (about 45 ksi yield, 55 ksi ultimate): at the goal rider the rear axle ${marginWords(axleBaseUtil(p))} with the design steel, but with ERW tube it ${marginWords(axleUtilAt(p, p.axleTubeYieldPsi, 45000))}, and with 60 ksi 1020 DOM it ${marginWords(axleUtilAt(p, p.axleTubeYieldPsi, 60000))}.`,
          `Yield ≥ ${f(p.axleTubeYieldPsi / 1000, 0)} ksi, tensile ≥ ${f(p.axleTubeUltimatePsi / 1000, 0)} ksi (a cert of at least 65 ksi).`,
          `OD ${fr(tubeOd)}" within 5 thousandths of an inch, wall ${f(tubeWall, 3)}" within 10 thousandths.`,
        ],
        ifFails: `Enter the cert values in ${lbl('axleTubeYieldPsi')} and the ultimate strength and re-run the checks; if the axle rows fail, go to the 3/16" wall or the solid 5/8" rod (about 2 lb heavier; set ${lbl('axleWallIn')} to 0).`,
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
          `At the ${p.riderGoalMassLb} lb goal rider the rear axle ${marginWords(axleBaseUtil(p))} with ${f(p.axleYieldPsi / 1000, 0)} ksi steel; with 1018 cold-drawn at 54 ksi it ${marginWords(axleUtilAt(p, p.axleYieldPsi, 54000))}, and with hot-rolled A36 at 36 ksi it ${marginWords(axleUtilAt(p, p.axleYieldPsi, 36000))}.`,
          `OD ${fr(tubeOd)}", within 5 thousandths of an inch.`,
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
        it('Eye-bolt lengths, measured under the shoulder:', [
          `Axle-beam bolt: crosses the ${fr(p.frontBeamThicknessIn)}" beam, a 2" fender washer and a nylock nut and needs ${frUp(beamEye.needIn)}" with a few threads past the nut, so buy the stock ${fr(beamEye.stockIn)}"` +
          `${beamEye.cutToIn ? ` and CUT it to ${fr(beamEye.cutToIn)}" after fitting (it would stand ${frUp(beamEye.pastNutIn)}" past the nut; deburr the end, touch it with cold galvanizing)` : ''}.`,
          `Chain-crossmember bolt: crosses the ${fr(p.chainJoistThickIn)}" crossmember and two washers and needs ${frUp(anchorEye.needIn)}", so buy the stock ${fr(anchorEye.stockIn)}"${anchorEye.cutToIn ? ` (optionally cut to ${fr(anchorEye.cutToIn)}")` : ''}.`,
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
        it(`Tongue bolts: the two ${fr(p.tongueBoltDiaIn)}" carriage bolts cross the ${fr(p.tongueHeadLenIn)}" head, the ${fr(p.frontBeamThicknessIn)}" beam, a washer and a nylock nut.`, [
          `They need ${frUp(tongueBolt.needIn)}" with a few threads past the nut, so the stock length is ${fr(tongueBolt.stockIn)}" (a 6" bolt stops 1/16" short of the top of the nut).`,
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
        it('Stack the real layers and run the screw home.', [`A ${thin.nominal} scrap, the ${fr(knob.standoffIn, 32)}" standoff disc, a ${thin.nominal} web scrap and the oak backing strip with its epoxied #10-32 × 5/16 insert.`]),
      ],
      passList: [
        `The screw reaches the insert with ${fr(knob.engagedIn, 32)}" of thread engaged.`,
        `The tip stops at least 1/16" short of the back of the ${fr(knob.stripT)}" strip (design: ${fr(knob.tipShortIn, 32)}" short).`,
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
          `Notch the pocket in the layers, glue the test knee up and recess the pocket; screw the stainless strap on and drill the pin hole through its hole. Use the real ${fr(p.brakePivotPinDiaIn)}" clevis pin, the hitch-pin clip and a flap tongue with its pivot block clamped in the pocket.`,
          p.kneeMount === KNEE_MOUNT.removable
            ? 'This test comes BEFORE the knees are bolted on: the knees go on first, while the hull is inverted (assembly step "Brake knees").'
            : 'This test comes BEFORE the knees are glued: the knees go on first, while the hull is inverted (assembly step "Brake knees").',
        ]),
        it(`Check the pocket clearance (${fr(p.brakePivotSlotClearIn)}" a side), the pin through the strap and into the blind hole, the flap swing and the pad gap to the tire.`),
        it('Drag-test a chock: pull a weighted chock across packed dirt or gravel with a scale, dry and wet.'),
        it('Test a pad sample on a wet tire.'),
      ],
      passList: [
        'The pin slides in with a drop of grease and no slop; the flap swings freely through its stroke.',
        `The pad hangs ${fr(p.brakePadGapIn)}" off the tread when released.`,
        `Chock μ ≥ ${p.brakeChockMuFouled} (design ${p.brakeChockMu}); pad μ ≥ 0.4 wet (0.25 fouled).`,
      ],
      ifFails: `Adjust the pocket width or the pin-hole height on the real knee before cutting the rest; enter the measured friction in the design (${lbl('brakeChockMu')}, ${lbl('brakeChockMuFouled')}; the park-hold row uses the lower).`,
      partIds: ids(parts, /^(brake-knee|brake-flap|brake-pivot|brake-chock|brake-pad|brake-shoe)/),
      paramKeys: verifyKeys(['brakeChockMu', 'brakeChockMuFouled']),
      when: 'before cutting',
      refs: ['D-57', 'D-65'],
    },
    {
      id: 'grab-reach',
      title: 'Grab board: can a scout reach the hand hole?',
      how: [
        it('Cut a cardboard board the size of the grab board (Shaper pattern, hole cut out) and tape it in place on one gunwale.', [`The hole's center is ${fr(p.grabHoleAheadOfHpointIn, 8)}" ahead of the hip point, which is ${fr(p.seatBehindHpointIn, 8)}" ahead of the rear edge of the seat cushion, and ${fr(p.grabBoardFootIn + p.grabHoleHeightIn / 2, 16)}" above the gunwale top.`]),
        it('Sit the smallest and the biggest scout in the sled, gloved, with the seat pad on and the seat back up.', ['Let the arm hang, then bring the forearm up and forward to the hole.']),
        it('Watch where the hand lands and how the wrist and elbow sit.'),
      ],
      passList: ['The gloved hand finds the hole without reaching or folding the arm back.', 'The elbow stays bent, never locked or behind the hip.', 'The knuckles clear the gunwale top and the thigh.'],
      ifFails: `Slide the hole fore or aft (${lbl('grabHoleAheadOfHpointIn')}: forward for long arms, back for short ones; the flat board cannot go much farther forward than it is, where the sides start to turn in) or change the oak under the hole (${lbl('grabBoardFootIn')}), then re-run the checks.`,
      partIds: ids(parts, /^seat-grip-[LR]$/),
      paramKeys: [],
      when: 'before cutting',
      refs: ['D-84', 'D-57'],
    },
    {
      id: 'bow-rib-clearance',
      title: 'Bow post: sit a booted rider in the bare hull before the ribs go in',
      how: [
        it('With the hull built and the deck in, but no side ribs cut or fitted yet, sit a rider in winter boots in it (or a mock-up of the seat and the bow).', [
          `Mark the bow post on each side: its inner face is ${fr(bowRib.face)}" from the center line, ${fr(bowRib.fromTransom, 8)}" from the transom.`,
          'Put the boots where the rider rests them against the foot brace, then at full steering lock.',
        ]),
        ...(bowRib.alt
          ? [it(`If the post is in the way, move the front rib to the chain crossmember (about ${fr(bowRib.alt.fromTransom, 8)}" from the transom, ${f(bowRib.alt.fromAxle, 0)}" ahead of the rear axle; its inner face is ${fr(bowRib.alt.face)}" from the center line).`, [
              `Change the design value ${lbl('sideRibFrontXIn')} to ${f(bowRib.alt.fromAxle, 0)}: the rib and its knee snap to the crossmember.`,
              'The knee screws then go into the chain crossmember: check them against the steering-chain anchor eye bolt in that crossmember and keep the two screws clear of its hole.',
            ])]
          : [it('If the post is in the way, leave the bow ring off (2 lash points per side) or ask for a thinner post.')]),
      ],
      passList: [`The boots clear the post by about 1" at full lock (the post face is ${fr(bowRib.face)}" from the center line).`],
      ifFails: bowRib.alt ? `Set ${lbl('sideRibFrontXIn')} to ${f(bowRib.alt.fromAxle, 0)}, re-run the checks (the side-lateral row) and cut the bow posts for the chain crossmember.` : 'Drop the bow ring and re-run the checks.',
      partIds: ids(parts, /^side-rib(-knee)?-[LR]3$/),
      paramKeys: verifyKeys(['sideRibFrontXIn']),
      when: 'at assembly',
      refs: ['D-76'],
    },
    {
      id: 'brake-strap',
      title: 'Brake pivot strap: pocket fit, pin and sideways push',
      how: [
        it('Do this on the first flap kit, on its knee with the strap screwed on (the brake flaps step).', [
          'Clamp the flap tongue and pivot block in the pocket and swing the flap through its whole stroke, released to applied.',
          `Look for ${fr(p.brakePivotSlotClearIn)}" of clearance all round, at every point of the swing: tongue and block to the floor, the roof, the inboard wall and the pocket's end (a strip of card or a feeler gauge).`,
        ]),
        it('Slide the pin through the strap, the tongue and block, and into the blind hole in the inboard ear; fit the hitch-pin clip.', ['A drop of grease on the pin. The clip goes through the cross hole outboard of the strap.']),
        it(`Push the flap foot sideways with about ${p.brakeFlapSideLoadLbf} lb, and watch the strap.`, [
          `This tests the sideways push the design assumes (${lbl('brakeFlapSideLoadLbf')}): a boot scuffing the foot.`,
          'Draw a pencil line across the strap onto the knee first; use a luggage scale or a bathroom scale pressed on the foot tread to know the push.',
        ]),
      ],
      passList: [
        `The tongue and block clear the pocket by ${fr(p.brakePivotSlotClearIn)}" all round through the full swing.`,
        'The pin slides through the strap and the blind hole with the clip on, and the flap pulls off when the pin is out.',
        `At ${p.brakeFlapSideLoadLbf} lb sideways the strap does not move: the pencil line stays across the joint, no screw backs out and no gap opens under the strap.`,
      ],
      ifFails: `Pocket too tight or too loose: take a sliver off with a chisel, or re-cut the pocket in the spare knee blank. If the strap moves under the push, bed it in epoxy or design a thicker strap (${lbl('brakeStrapThickIn')}); if a boot pushes harder than this, measure it and enter it in the design (${lbl('brakeFlapSideLoadLbf')}).`,
      partIds: ids(parts, /^(brake-knee|brake-strap|brake-flap|brake-pivot)/),
      paramKeys: [],
      when: 'at assembly',
      refs: ['D-65', 'D-77'],
    },
    {
      id: 'lamp-clip',
      title: 'Lamp clips: measure the real lights, then fit the clips',
      how: [
        it('Measure the real lights before anything is printed.', [
          'The clips were drawn for different lights. The front light is a Giant Recon 600 (87 g), the rear a Planet Bike Spok.',
          'Measure each light\'s flat mount: the distance between its two screw holes, the hole size, the width and thickness of the mount, and the lens clearance.',
          'The clip lips carry M4 (front) and M3 (rear) heat-set inserts: check the real screws are those sizes and set the insert spacing to the light.',
        ]),
        it('Print a 1" test slice of the clip.', ['About 3/64" clearance a side and 1/16" detent ribs; ASA, 4 or more perimeters, printed on a long face.']),
        it(`Cut a ${handHold} test slot in an offcut of the bulkhead stock on the Shaper.`, ['Epoxy-seal and ease it, then push the slice in.']),
        it('Bolt each real light to its clip lip.', ['Check the mount-hole spacing, the lens clearance and the pull-out force.']),
      ],
      passList: ['The slice is a firm push fit that pulls out by hand (detent ribs, no wobble).', 'The lamp mount-hole spacing matches the inserts on the clip lip.', 'Nothing binds once the slot is sealed with epoxy.'],
      ifFails: 'Re-print the clip at the measured clearance and insert spacing (the clip is a pure function of the hand-hold size and the light\'s mount), then cut the real slots.',
      partIds: ids(parts, /^(lamp-clip|rear-lamp-clip|front-light|rear-light|bow-bulkhead|transom-rear)$/),
      paramKeys: [],
      when: 'before cutting',
      refs: ['D-64', 'D-83'],
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
        it('Rip a lane off each board, then resaw and plane two dry test strips.', [`A rail strip (${fr(railStrip)}") and a band strip (${fr(bandStrip, 32)}").`]),
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
      id: 'oak-supplier',
      title: 'Lumber: Peach State price sheet and kiln drying',
      how: [
        it('Call Peach State Lumber (Kennesaw) before the lumber list goes out.', [
          `Ask whether the printed price sheet ("Hardwoods LEVEL 2") is the walk-in price: the design is priced on $${f(OAK_PRICE_PER_BF['4/4'].usd, 2)} a board foot for 4/4 FAS white oak and $${f(OAK_PRICE_PER_BF['5/4'].usd, 2)} for 5/4.`,
          'Ask whether the white oak is kiln dried. The sheet does not say.',
          'Ask whether they hold 4/4 and 5/4 white oak in boards wide and long enough for the cut list (the widest and longest board in the lumber list).',
        ]),
        it('When the boards arrive, put a moisture meter on every one.', ['Reject a board over 9 %. Sticker the lot and let it settle in the shop before milling.']),
        it('Only 4/4 and 5/4 are bought. Do not accept a substitute thickness without redoing the cut list: the thick parts are glued up from layers.'),
      ],
      passList: ['The walk-in price is at or under the sheet price.', 'The oak is kiln dried: 6 to 9 % on the meter.', '4/4 and 5/4 FAS are in stock in the widths and lengths the cut list needs.'],
      ifFails: 'If the price is higher, enter it in the price list and re-check the total. If the oak is green or air dried, sticker it for a few weeks first (bent strips cup and crack in wet boards) or use another yard: The Wood Yard has 4/4 at a higher price and no 5/4.',
      partIds: [],
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-79'],
    },
    {
      id: 'deck-sheet',
      title: 'Deck sheet: 12 mm okoume, not meranti',
      how: [
        it('Ask the yard what species the 12 mm marine plywood is.', [
          'Peach State lists no marine plywood. Ask them, and Randall Brothers (Atlanta), for 12 mm okoume BS 1088. The Wood Yard\'s sheet is the price reference.',
          'Marine plywood sold as "BS 1088" can be meranti: it is about 3 lb heavier over the deck and the seat back, and the design weights assume okoume.',
        ]),
        it('Look at the stamp on the sheet edge and the face veneer.', ['Okoume is pale pinkish-tan with a soft, even grain; meranti is darker and reddish.']),
        it('Measure the sheet (see "Plywood thickness") before the deck dado is cut.'),
      ],
      passList: ['The 12 mm sheet is okoume (BS 1088 or equivalent), glue line WBP or marine.', 'If it is meranti, the sled weighs about 3 lb more and the weight rows are re-run with the heavier density.'],
      ifFails: 'Enter the heavier density in the design if you accept meranti and re-run the checks; otherwise order okoume (Aircraft Spruce lists it only in 4 and 6 mm, so ask a local yard first).',
      partIds: ids(parts, /^(deck|seat-back-panel)$/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-79', 'D-80'],
    },
    ...(thin.key === 4 || thin.key === 2
      ? [{
        id: 'web-bend',
        title: `${thin.name}: count the plies, ask the glue, dry-bend a web strip`,
        how: [
          it('Count the plies at the edge of the sheet.', [
            `${thin.name} should show 5 plies. The side-web strength row assumes a 5-ply sheet: a 3-ply 6 mm sheet must NOT be used (it is far weaker across the grain). Reject it at the yard.`,
            'Do this at the lumberyard, with the sheet in front of you, before you pay.',
          ]),
          it(thin.key === 4 ? 'Ask what glue the sheet carries (interior or exterior).' : 'Ask for the BS 1088 stamp and the glue type (marine).', [thin.key === 4 ? 'The sled is garage-kept and every face and edge is sealed, so an interior glue line is acceptable; ask anyway.' : 'The Extreme weather spec is built for a wet life: a plain exterior sheet is not a substitute.']),
          it('Dry-bend a strip of the sheet over the S-ramp.', [
            'Cut a strip 6" × 24" along the length of the sheet (the web runs along the sheet), from the waste of the web blank.',
            `Clamp it dry over the S-ramp ribs or a block of the same rise (${fr(computeLayout(p).turnIn(computeLayout(p).xSideEnd), 8)}" over about 29-1/2").`,
            'No glue, no water: it must lie down on the ramp with no crack, no splintering and no white lines in the outer ply.',
            'Release it and see how much it springs back. The bands and cleats hold the bend in the real glue-up.',
          ]),
        ],
        passList: ['Five plies at the edge; the glue is known; the dry strip takes the S-ramp without a crack or white line.'],
        ifFails: 'A 3-ply sheet, a cracked strip or an unknown glue: reject the sheet, ask for another or change the thin-sheet material before ordering the rest. Re-run the side-web check with the real sheet before going on.',
        partIds: ids(parts, /^side-[LR]-web$/),
        paramKeys: [],
        when: 'before ordering' as VerifyWhen,
        refs: ['D-80'],
      }]
      : []),
    {
      id: 'ply-thickness',
      title: 'Plywood thickness: measure before any dado is cut',
      how: [
        it(`Measure the ${thin.nominal} ${thin.key === 1 ? 'white oak plywood' : thin.key === 3 || thin.key === 4 ? 'Baltic birch' : 'okoume'} and the 12 mm okoume deck sheet with calipers, at six or more points on the edges.`, [
          thin.key === 1 ? 'Nominal 1/4" white oak plywood runs about 7/32", and the veneer face varies.' : '',
          thin.key === 4 ? `Measure the sheet you will cut, not the listing: 6 mm Baltic birch is sold as "1/4 in" and runs from about 7/32" to 1/4". The design assumes ${fr(p.balticSixThickIn, 64)}".` : '',
          thin.key === 4 ? 'A typical "1/4 in" Baltic sheet measures a full 1/4", a little over the design figure: expect that case. Enter the measured value; the dado width follows it (the sheet plus the slop below), so no dado is cut to the nominal size.' : '',
          'BS 1088 12 mm often runs to 31/64" or more, and the sealed sheet is a few thousandths thicker.',
        ].filter(Boolean)),
        it('Compare with the dados the Shaper files will cut.', [
          `Web dados: the thin sheet ${fr(thin.thicknessIn, 64)}" plus ${fr(p.grooveSlopIn, 64)}" of slop, so ${fr(thin.thicknessIn + p.grooveSlopIn, 64)}" wide (fit to the ply).`,
          `Deck dado and the gap under the inner chine band: ${fr(p.deckPlyIn, 64)}" plus ${fr(p.deckSlopIn, 64)}" of slop, so ${fr(p.deckPlyIn + p.deckSlopIn, 64)}" wide (fit to the ply).`,
        ]),
        ...(thin.key === 1 ? [it('Check the glue-line type on the sheet (interior or Type II is what the Standard weather spec assumed); seal every face and edge.')] : []),
        ...(thin.key === 4 ? [it('Ask what glue the sheet carries (interior or exterior).', ['The sled is garage-kept and every face and edge is sealed, so an interior glue line is acceptable; ask anyway.'])] : []),
        ...(thin.key === 3 ? [it('Confirm the sheet size: probably 5 × 5 ft (60 × 60 in); the 59-5/8" side web blank only just fits.')] : []),
      ],
      passList: [`The ${thin.nominal} sheet measures ${fr(thin.thicknessIn, 64)}" or less and the 12 mm sheet ${fr(p.deckPlyIn, 64)}" or less: each, plus a seal coat of a few thousandths, still slides into its dado with a little to spare (about 1/32").`],
      ifFails: `Enter the measured thickness (plus the seal coat) in the design (${lbl(thinKey)}, ${lbl('deckPlyIn')}), re-run the checks and regenerate the Shaper files BEFORE a dado is cut: a thick sheet in a nominal dado cannot be fixed afterwards.`,
      partIds: ids(parts, /^(deck|side-[LR]-web|transom-rear|bow-bulkhead)$/),
      // the sheet this design uses and the deck ply: the two values the fail text tells you to enter (not the other thin sheets' thicknesses)
      paramKeys: [thinKey, 'deckPlyIn'],
      when: 'before cutting',
      refs: ['D-62', 'D-63', 'D-73', 'D-80'],
    },
    {
      id: 'd-ring',
      title: 'D-ring brackets: holes, bolts and working load',
      how: [
        it('Open one package of the bolt-on cargo D-rings and measure the bracket.', [
          `Count the holes (the design assumes ${LASH_BOLTS}), measure their diameter and the distance between their centers (assumed ${fr(2 * LASH_HOLE_DX_IN, 16)}", along the length of the bracket), and the bracket's length, width and thickness (assumed about ${fr(LASH_PLATE.len, 16)}" × ${fr(LASH_PLATE.tall, 16)}" × ${fr(LASH_PLATE.thick, 16)}").`,
          'Read the working load limit off the package. Ignore any breaking strength printed beside it.',
        ]),
        it(`Try a ${fr(LASH_BOLT_DIA_IN, 16)}"-20 button-head bolt in each hole.`, [`A 1/4-20 bolt must pass with a little play. Bolts of ${fr(lashBoltLength(p).len, 4)}" are long enough for the side, the rib head and the bracket.`]),
        it('Check the ring folds flat against the bracket.', ['In race mode it lies flat against the rib head.']),
      ],
      passList: [
        `The bracket has two holes for 1/4" bolts, about ${fr(2 * LASH_HOLE_DX_IN, 16)}" apart; if the holes are another size or spacing, the rib head and the drilling follow the bracket (it is the drilling template).`,
        `The working load is at least ${p.lashLoadLbf} lb (the lash-load row pulls each ring at ${p.lashLoadLbf} lb, at ${p.lashPullAngleDeg}°).`,
        'The ring folds flat.',
      ],
      ifFails: `Enter the real working load in the design (${lbl('lashLoadLbf')}) and re-run the checks; if it is lower, add a ring or limit the strap load. If the holes are not 1/4", change the bolt size and the drill with the bracket in hand.`,
      partIds: ids(parts, /^(lash-|side-rib-[LR]\d$)/),
      paramKeys: verifyKeys(['lashLoadLbf']),
      when: 'before ordering',
      refs: ['D-76', 'D-83'],
    },
    {
      id: 'eva-pads',
      title: 'Seat pads: closed-cell EVA',
      how: [
        it('Buy one kneeling pad first and look at it.', [
          'Press a thumb into the edge, then cut a small piece off a corner: closed-cell EVA is smooth and has no visible bubbles; open-cell foam (sponge) is rough and soaks up water.',
          'Drop a cut piece in water for a day; it should not gain weight.',
          'Check the pad size against the design: 11" × 18" × 1-1/2".',
        ]),
        it('Try the contact cement on a scrap of the pad.', ['Glue two cut edges together, let it set a day, and pull: the glue line should hold and the foam should tear before it lets go.']),
        it('Try a hook-and-loop strip on the pad and on a sealed wood scrap.', ['Press, load with the rider\'s weight, pull off: the strip should hold and release cleanly.']),
      ],
      passList: ['The pad is closed-cell (does not soak up water).', 'The edge-glued seam holds.', 'The strips hold on the foam and release without tearing it.'],
      ifFails: 'If the pad is open-cell, use a different closed-cell foam (polyethylene or EVA sheet) and re-run the seat checks with its thickness and weight.',
      partIds: ids(parts, /^seat-(cushion|back-pad)$/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-83'],
    },
    {
      id: 'hinges-304',
      title: std ? 'Hinges: 304 / 18-8 stainless on the package' : 'Hinges: 316 stainless on the package',
      how: [
        it('Read the package of each hinge pair (the lid hinges and the seat hinges).', [
          std ? 'It must say stainless steel and give the grade: 304 or 18-8 (the same steel). "Stainless" alone can be 201 or a plated steel.' : 'It must say stainless steel and give the grade: 316 (marine). "Stainless" alone can be 201, 304 or a plated steel.',
          'Check the screws that come with them: the sled uses its own stainless screws, so the hinge holes must take a #8 (lid) and a #10-32 (seat back) screw.',
        ]),
        it('Hold a magnet to a hinge.', [std ? '304 is barely magnetic or not at all; a strong pull means plated steel or 430.' : '316 is barely magnetic or not at all; a strong pull means plated steel or 430.']),
      ],
      passList: [std ? 'Each package says 304 or 18-8.' : 'Each package says 316.', 'The hinge holes are the size the sled needs.'],
      ifFails: 'Buy another brand that states the grade. A plated hinge rusts and stains the oak.',
      partIds: ids(parts, /^(seat-hinge|storage-hinge)/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-73', 'D-83'],
    },
    ...(parts.some((x) => x.id === 'storage-lid-stay' && /plated/.test(x.material))
      ? [{
        id: 'lid-support',
        title: 'Lid support: bracket holes and arm length',
        how: [
          it('Open the package of the 6" lid support.', ['Measure the base bracket and the arm-end bracket: the screw holes (size and spacing) and the arm length, open and folded.']),
          it('Hold it in the box on the left hinge backer and check the lid.', ['The arm folds flat when the lid is shut, and holds the lid open at about 75°.']),
        ],
        passList: ['The two brackets take #8 × 5/8" screws at the pilots the drawings give (or the pilots move to suit the bracket).', 'The lid stays open at its stop, and closes on the gasket with no gap.'],
        ifFails: 'Move the pilots to the real holes before they are drilled, or use the stainless friction stay.',
        partIds: ids(parts, /^(storage-lid-stay|storage-hinge-backer-L)$/),
        paramKeys: [],
        when: 'before cutting' as VerifyWhen,
        refs: ['D-83'],
      }]
      : []),
  ];

  // Removable knees: the check on the first refit (the ratchet and wrench setting).
  if (p.kneeMount === KNEE_MOUNT.removable) {
    const at = drafts.findIndex((c) => c.id === 'brake-strap');
    drafts.splice(at < 0 ? drafts.length : at + 1, 0, {
      id: 'brake-knee-refit',
      title: 'Removable brake knees: refit, bolts and chock cord',
      how: [
        it('Take one knee off and put it back with the ratchet and wrench, as the assembly step "Take the brake knees off and put them back" says.', [
          'Do it on the finished sled, with the flap on the knee.',
          `Time it: about 5 minutes a side, longer the first time.`,
          `Tighten each bolt snug, then a quarter turn (about ${p.kneeBoltTightenLbIn} in-lb; the quarter turn past snug is the spec, the torque only a check) and no more.`,
        ]),
        it('Look along the joint after the refit.', [
          'Seat a straightedge along the knee leg: it must sit flat on the rail and on the chine band.',
          'Try a slip of paper along the joint line: it must not enter.',
          'Look under the heads: no washer pressed into the oak.',
        ]),
        it('Reach under the deck and look at the backing plate.', ['It is still in its recess, bedded flush, with all four nuts on it.']),
        it('Tug the chock on its cord, still tied to the eye under the knee.'),
        it('Use the sled for the first outing, then check every bolt with the ratchet.', ['The bolts are held by clamping alone (no glue), so they must still be tight after the first outing.', 'After that, check each bolt is snug before every outing.']),
        it('Press the brake and rock the flap sideways.', ['Look for wobble at the knee: there should be none.']),
      ],
      passList: [
        'The knee seats flat on the rail and the chine band after every refit; a slip of paper does not enter the joint line.',
        'No washer is pressed into the oak.',
        'The backing plate is still in its recess with all four nuts on it.',
        'All four bolts are still tight after the first outing.',
        'The chock cord eye is solid and the cord is still tied.',
        'The first brake test shows no wobble at the knee.',
      ],
      ifFails: 'A gap or a wobble: take the knee off, clean both faces, check the bolt holes for dirt and refit, tightening a little at a time in turn. New lock nuts after about five removals. A washer sunk into the oak means the bolts were over-tightened: stop at a quarter turn past snug. If the backing plate has come loose, bed it again in thickened epoxy. If it still moves, stop using the brake and measure the holes against the drawing.',
      partIds: ids(parts, /^(brake-knee|brake-chock|brake-backplate)/),
      paramKeys: [],
      when: 'at assembly',
      refs: ['D-78'],
    });
  }

  // Leftovers: any 'verify' param no check claims (the truck bed measurements, the NDS value, ...).
  const claimed = new Set(drafts.flatMap((c) => c.paramKeys));
  const unused = new Set(unusedVerifyKeys(p));
  const other = verifyParamKeys().filter((k) => !claimed.has(k) && !unused.has(k));
  if (other.length) {
    drafts.push({
      id: 'other-params',
      title: 'Other design values to confirm',
      how: [
        it('Measure or look up each value and enter it in the design if it differs:', other.map((k) => {
          const d = PARAM_DEFS[k as keyof typeof PARAM_DEFS];
          return `${d.label}: ${d.unit === 'in' ? fr(d.default, 32) : d.default}${d.unit ? ` ${d.unit}` : ''}.`;
        })),
        it('The truck values are for a 2007 Tacoma short bed: measure yours with the tailgate down before cutting the transport fit.'),
      ],
      passList: ['Each value is within 1/4" (dimensions) or within the vendor / code figure (strengths) of the default; otherwise change it and re-run the checks.'],
      ifFails: 'Re-run the analysis with the measured value; change the design only if a row flips.',
      partIds: [],
      paramKeys: other,
      when: 'before cutting',
      refs: ['Q-1', 'D-35', 'D-43'],
    });
  }

  // Number the checks in the order they are shown: before ordering, then before cutting, then at assembly (each group keeps its build order).
  const order: VerifyWhen[] = ['before ordering', 'before cutting', 'at assembly'];
  const sorted = order.flatMap((w) => drafts.filter((c) => c.when === w));
  return sorted.map((c, i) => ({ ...c, n: i + 1, whatToDo: flatText(c.how), pass: c.passList.join(' ') }));
}

/**
 * The three lines of the "Verify before ordering" step: one per group of checks, with the real counts (checks before ordering, before the first cut, and at their assembly steps).
 * `text` is the line, `titles` the checks it lists.
 */
export function verifyGroups(checks: VerifyCheck[]): Array<{ when: VerifyWhen; text: string; titles: string[] }> {
  const n = (w: VerifyWhen): VerifyCheck[] => checks.filter((c) => c.when === w);
  const pl = (k: number, w: string): string => `${k} ${w}${k === 1 ? '' : 's'}`;
  const out: Array<{ when: VerifyWhen; text: string; titles: string[] }> = [];
  const b = n('before ordering'), c = n('before cutting'), a = n('at assembly');
  if (b.length) out.push({ when: 'before ordering', text: `Before the shopping list goes out: do these ${pl(b.length, 'check')} (how to do each is in the Verify section).`, titles: b.map((v) => v.title) });
  if (c.length) out.push({ when: 'before cutting', text: `Before the first cut: do ${b.length ? `${c.length} more` : String(c.length)} ${c.length === 1 ? 'check' : 'checks'}.`, titles: c.map((v) => v.title) });
  if (a.length) out.push({ when: 'at assembly', text: `During the build: ${pl(a.length, 'more check')}, each at its own step (the Verify section says which).`, titles: a.map((v) => v.title) });
  return out;
}
