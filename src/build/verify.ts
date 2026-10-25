/**
 * "Verify before ordering" checklist: only the fits that change a purchase or a cut (D-100).
 *
 * Pure function of (parts, params). The numbers come from the params the model uses; the part ids are the ones present in the built
 * model. Every param whose `status` is 'verify' is claimed by a check, and any left over lands in the last item ("other params to
 * confirm") automatically, so promoting or adding a verify param never needs an edit here. Vendor ratings and material strengths are
 * 'assumed' with margin, not checks (D-100).
 */
import { bowTaper, KNEE_MOUNT, PARAM_DEFS, type Params } from '../params';
import { computeLayout, innerHalfWidth } from '../model/layout';
import { sideRibStations } from '../model/side-ribs';
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
  /** DECISIONS.md IDs. */
  refs: string[];
}

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

/** The parameters-panel labels of design values (never their keys), in the order given. */
export function paramLabels(keys: string[]): string[] {
  return keys.map((k) => PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.label ?? k);
}

/** Ids of the built parts matching a pattern. */
function ids(parts: Part[], re: RegExp): string[] {
  return parts.filter((x) => x.group !== 'reference' && re.test(x.id)).map((x) => x.id);
}

/** Param keys that are still 'verify' (a param Eric has confirmed and promoted drops out of the list by itself). */
function verifyKeys(keys: string[]): string[] {
  return keys.filter((k) => PARAM_DEFS[k as keyof typeof PARAM_DEFS]?.status === 'verify');
}

/** Verify params of parts THIS design does not use: they never go on the confirm list (none today; kept so a new one has a home). */
export function unusedVerifyKeys(_p: Params): string[] {
  return [];
}

/** Every param key currently at status 'verify'. */
export function verifyParamKeys(): string[] {
  return Object.entries(PARAM_DEFS).filter(([, d]) => d.status === 'verify').map(([k]) => k);
}

export function verifyChecklist(parts: Part[], p: Params): VerifyCheck[] {
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
      id: 'wheel',
      title: 'Wheel: try one first (the bore and the hub length)',
      how: [
        it('Get ONE wheel before getting four.', [
          `Slide a piece of the ${fr(tubeOd)}" axle through the bore: no play.`,
          `Measure the hub length with calipers. The listing gives none, so the design assumes ${fr(p.hubLengthIn)}".`,
        ]),
      ],
      passList: [
        `Bore ${fr(p.wheelBoreIn)}" (the bearings ride on the ${fr(tubeOd)}" axle).`,
        `Hub length ${fr(p.hubLengthIn)}" or less (shorter is fine; longer pushes the wheel out).`,
      ],
      ifFails: `Enter the measured hub length in ${lbl('hubLengthIn')} and re-run; the stub-axle length and the beam ends follow the hub. A different bore needs a different wheel (alternatives are on the BOM line).`,
      partIds: ids(parts, /^wheel-/),
      paramKeys: verifyKeys(['wheelBoreIn', 'hubLengthIn']),
      when: 'before ordering',
      refs: ['D-11', 'D-100'],
    },
    tubeWall > 0
      ? {
        id: 'axle-tube',
        title: `Axle tube: DOM, ${fr(tubeOd)}" × ${f(tubeWall, 3)}" (not ERW)`,
        how: [it(`Get ${fr(tubeOd)}" OD × ${f(tubeWall, 3)}" wall DOM (drawn over mandrel) tube, not ERW "mechanical" tube.`)],
        passList: ['The listing says DOM. Welded (ERW) tube is too weak for this axle.'],
        ifFails: `Go to the 3/16" wall or the solid 5/8" rod (set ${lbl('axleWallIn')} to 0).`,
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: [],
        when: 'before ordering',
        refs: ['D-71'],
      }
      : {
        id: 'axle-rod',
        title: `Axle rod: ${fr(tubeOd)}" 1045 or cold-drawn steel (not hot-rolled A36)`,
        how: [it(`Get ${fr(tubeOd)}" solid rod in 1045, not hot-rolled A36.`, ['The listing names the grade; that is enough.'])],
        passList: ['The listing says 1045 (or another cold-drawn grade). Hot-rolled A36 is too weak for this axle.'],
        ifFails: 'Get 1045 or 4140 instead.',
        partIds: ids(parts, /^axle-(R|F[LR])$/),
        paramKeys: [],
        when: 'before ordering',
        refs: ['D-71'],
      },
    {
      id: 'strip-bend',
      title: `Strip bend test: ${f(Math.round(bowTaper(p).minRadiusIn), 0)}" radius in 2 plies`,
      how: [
        it(`Get the FIRST board of each strip pool before the rest of the lumber list (${poolText('rail strips:', railPool)}; ${poolText('band strips:', bandPool)}).`, [
          spareOk
            ? 'Cut the test strips from the planned SPARE strips, so the test costs no extra board (a strip that bends without cracking goes into the laminate).'
            : 'A pool has no planned spare strip: this test needs one more board.',
        ]),
        it('Rip a lane off each board, then resaw and plane two dry test strips.', [`A rail strip (${fr(railStrip)}") and a band strip (${fr(bandStrip, 32)}").`]),
        it(`Bend them around a block cut to the tightest plan radius of the rail form (${f(bowTaper(p).minRadiusIn, 0)}").`, ['The result decides 2 vs 3 plies, which changes the strip count and the boards to get.']),
      ],
      passList: ['Both strips take the radius without a crack or raised grain.'],
      ifFails: `Plane the strips thinner (3 plies: the strip count, the cut list and the board plan all change), add damp heat, or relax the bow taper (${lbl('bowTaperStartIn')}) and re-run the checks, all before the lumber goes on order.`,
      partIds: ids(parts, /^(rail-[LR]|side-[LR]-(chine|gunwale)(-in)?)$/),
      paramKeys: [],
      when: 'before ordering',
      refs: ['D-62', 'D-66'],
    },
    {
      id: 'lamp-clip',
      title: 'Lamp clips: measure the real lights, then fit the clips',
      how: [
        it('Measure the real lights before anything is printed.', [
          'The front light is a Giant Recon 600, the rear a Planet Bike Spok.',
          'Measure each light\'s mount: the distance between its two screw holes and the hole size.',
        ]),
        it(`Print a 1" test slice of the clip and push it into a ${handHold} test slot cut in an offcut of the bulkhead stock.`),
      ],
      passList: ['The slice is a firm push fit that pulls out by hand.', 'The lamp mount holes line up with the inserts on the clip lip.'],
      ifFails: 'Re-print the clip at the measured clearance and insert spacing, then cut the real slots.',
      partIds: ids(parts, /^(lamp-clip|rear-lamp-clip|front-light|rear-light|bow-bulkhead|transom-rear)$/),
      paramKeys: [],
      when: 'before cutting',
      refs: ['D-64'],
    },
    {
      id: 'brake-knee',
      title: 'Brake: fit the first knee before cutting the other',
      how: [
        it('At the "Brake knees" assembly step, shape ONE knee first.', [
          'Try its pocket with a scrap block the size of the flap tongue with its pivot block on: it must slide in with a little play all round. Cut the other knee only when it does.',
          p.kneeMount === KNEE_MOUNT.removable
            ? 'The full test comes at the "Brake flaps" step, with the strap, the real pin and the flap tongue.'
            : 'With glued knees the full test must come first: make the test knee, strap and flap tongue before the knees are glued on.',
        ]),
        it(`Swing the flap through its stroke and check the pin goes through the strap into the blind hole, with ${fr(p.brakePivotSlotClearIn)}" of pocket clearance a side.`),
      ],
      passList: [
        'The pin slides in with a drop of grease and no slop; the flap swings freely through its stroke.',
        `The pad hangs ${fr(p.brakePadGapIn)}" off the tread when released.`,
      ],
      ifFails: 'Adjust the pocket width or the pin-hole height on the real knee before cutting the rest.',
      partIds: ids(parts, /^(brake-knee|brake-flap|brake-pivot|brake-strap)/),
      paramKeys: [],
      when: 'at assembly',
      refs: ['D-57', 'D-65', 'D-77'],
    },
    {
      id: 'bow-rib-clearance',
      title: 'Bow post: sit a booted rider in the bare hull before the ribs go in',
      how: [
        it('With the hull built and the deck in, but no side ribs cut or fitted yet, sit a rider in winter boots in it.', [
          `Mark the bow post on each side: its inner face is ${fr(bowRib.face)}" from the center line, ${fr(bowRib.fromTransom, 8)}" from the transom.`,
          'Put the boots where the rider rests them against the foot brace, then at full steering lock.',
        ]),
        ...(bowRib.alt
          ? [it(`If the post is in the way, move the front rib to the chain crossmember (about ${fr(bowRib.alt.fromTransom, 8)}" from the transom; its inner face is ${fr(bowRib.alt.face)}" from the center line).`, [
              `Change the design value ${lbl('sideRibFrontXIn')} to ${f(bowRib.alt.fromAxle, 0)}: the rib and its knee snap to the crossmember.`,
              'Keep the knee screws clear of the steering-chain anchor eye bolt in that crossmember.',
            ])]
          : [it('If the post is in the way, leave the bow ring off (2 lash points per side).')]),
      ],
      passList: [`The boots clear the post by about 1" at full lock.`],
      ifFails: bowRib.alt ? `Set ${lbl('sideRibFrontXIn')} to ${f(bowRib.alt.fromAxle, 0)}, re-run the checks and cut the bow posts for the chain crossmember.` : 'Drop the bow ring and re-run the checks.',
      partIds: ids(parts, /^side-rib(-knee)?-[LR]3$/),
      paramKeys: verifyKeys(['sideRibFrontXIn']),
      when: 'at assembly',
      refs: ['D-76'],
    },
    {
      id: 'grab-reach',
      title: 'Grab board: can a scout reach the hand hole?',
      how: [
        it('Before anything is drilled for the grab boards: tape a cardboard grab board (its pattern, hole cut out) in place on one gunwale.', [`The hole's center is ${fr(p.grabHoleAheadOfHpointIn, 8)}" ahead of the hip point and ${fr(p.grabBoardFootIn + p.grabHoleHeightIn / 2, 16)}" above the gunwale top.`]),
        it('Sit the smallest and the biggest scout in the sled, gloved, on the seat pad.'),
      ],
      passList: ['The gloved hand finds the hole without reaching or folding the arm back.', 'The knuckles clear the gunwale top and the thigh.'],
      ifFails: `Slide the hole fore or aft (${lbl('grabHoleAheadOfHpointIn')}) and re-run the checks. Cut the oak boards only after it passes.`,
      partIds: ids(parts, /^seat-grip-[LR]$/),
      paramKeys: [],
      when: 'at assembly',
      refs: ['D-84'],
    },
  ];

  // Leftovers: any 'verify' param no check claims (the truck bed measurements today).
  const claimed = new Set(drafts.flatMap((c) => c.paramKeys));
  const unused = new Set(unusedVerifyKeys(p));
  const other = verifyParamKeys().filter((k) => !claimed.has(k) && !unused.has(k));
  if (other.length) {
    const truckOnly = other.every((k) => k.startsWith('truck'));
    drafts.push({
      id: 'other-params',
      title: truckOnly ? 'Truck bed: measure yours' : 'Other design values to confirm',
      how: [
        it(truckOnly ? 'Measure the truck bed with the tailgate down and enter any value that differs:' : 'Measure each value and enter it in the design if it differs:', other.map((k) => {
          const d = PARAM_DEFS[k as keyof typeof PARAM_DEFS];
          return `${d.label}: ${d.unit === 'in' ? fr(d.default, 32) : d.default}${d.unit ? ` ${d.unit}` : ''}.`;
        })),
        ...(truckOnly ? [it('The defaults are for a 2007 Tacoma short bed.')] : []),
      ],
      passList: ['Each value is within 1/4" of the default; otherwise change it and re-run the checks.'],
      ifFails: 'Re-run the analysis with the measured value; change the design only if a row flips.',
      partIds: [],
      paramKeys: other,
      when: 'before cutting',
      refs: ['Q-1', 'D-6'],
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
