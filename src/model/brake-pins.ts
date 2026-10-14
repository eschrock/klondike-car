/**
 * D-78: the parts of the removable brake knee on quick-release pins (`kneeMount` = pins). Per side: the knee TAB, two 3/8 in ball-lock pins (bottom: through the knee leg and the
 * rail; top: through the tab, the web, the filler and the box rib) and four stainless sleeves (two FLANGED bushings in the hull, which stay, and two plain tubes on the knee side, which come off with it). All sizes and
 * places come from `BrakeGeom.pins` (brake-layout.ts); nothing is typed here. The rail's and the rib's hole joints are written by frame.ts and side-ribs.ts. Plain TS, no three.js.
 */
import { WEATHER_SPEC } from '../params';
import { STEP, box, cylinder, stainless, stainlessName, type Ctx } from './build-utils';
import type { BrakeGeom } from './brake-layout';
import { frac } from './joinery';
import { localPoint } from './rear-mount';
import type { Joint, Part, Vec3 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/** Shop note on every part that comes off with the knee. */
const KIT_NOTE = 'REMOVABLE: it comes off with the knee and the flap, with the two pins pulled; nothing of it stays on the hull.';

/** The D-78 parts for one side. `g.pins` must be present. */
export function buildKneePinParts(ctx: Ctx, g: BrakeGeom, sgn: 1 | -1, tag: 'L' | 'R'): Part[] {
  const { p } = ctx;
  const pn = g.pins!;
  const out: Part[] = [];
  const mid = (a: number, b: number) => (a + b) / 2;
  const yMid = (a: number, b: number) => sgn * mid(a, b);
  const at = (part: Part, w: Vec3): Vec3 => localPoint(part.transform, w);
  const sOd = pn.sleeveOd, sId = pn.sleeveId, wall = (sOd - sId) / 2;
  const steelLb = p.steelDensityPcf / 1728; // lb per in^3
  const std = p.weatherSpec === WEATHER_SPEC.standard;

  // ── The tab: oak, grain vertical, face-glued to the knee's rear face, lying on the side web ──
  const tb = pn.tab;
  const tab = box(ctx, {
    id: `brake-tab-${tag}`, partNo: 'brake-tab', name: `Brake knee tab ${tag} (white oak)`, group: 'brake', mat: 'oak', grain: 'z', fab: 'table-saw', step: STEP.brake, removable: true,
    size: [tb.x1 - tb.x0, tb.t, tb.z1 - tb.z0], center: [mid(tb.x0, tb.x1), yMid(tb.yIn, tb.yOut), mid(tb.z0, tb.z1)], explode: [-0.6, sgn, 0.3],
    notes: `Oak block ${frac(tb.t)}" thick (across) x ${frac(tb.x1 - tb.x0)}" long (fore and aft) x ${frac(tb.z1 - tb.z0)}" tall, grain running up, from 4/4 stock laminated to ${frac(tb.t)}" or a single 8/4 offcut. Its long face lies against the knee's rear face and is glued to it with epoxy (about ${f2(tb.glueArea)} square inches of glue, over the lower ${f2(tb.patch.z1 - tb.patch.z0)}" of the tab, which hangs well below the pin; clamp it square for the cure and check the fit dry); the tab sticks out behind the knee ${frac(tb.x1 - tb.x0)}" and lies flat on the side's web, the top part over the box rib, which backs the web there. The knee itself touches only the rail and the chine band. Its inboard face is ${frac(pn.webRecess)}" inboard of the knee's inboard face (the web is recessed that much between the chine band and the gunwale band), so the tab sits flat on the web. It is NOT glued to the web. The top-pin hole (${frac(sOd)}") goes through it ${frac(p.brakeTabEndIn)}" in from its rear end and ${frac(p.brakeTabAbovePinIn)}" under its top, and holds a stainless sleeve. It stays ${f2(pn.clear.tabTopToWasher)}" under the fender washers of the D-ring and ${frac(p.brakeTabClearIn)}" clear of the side sign. ${KIT_NOTE}`,
    sourcing: { vendor: `Shop-cut white oak, ${frac(tb.t)}" x ${frac(tb.x1 - tb.x0)}" x ${frac(tb.z1 - tb.z0)}"` },
  });
  const kneeX = g.knee;
  tab.joints = [
    { type: 'glue', to: `brake-knee-${tag}`, count: 1, note: `epoxy, the tab's front face against the knee's rear face, ${f2(tb.glueArea)} square inches; clamp it square`, at: [at(tab, [tb.x1, sgn * (g.y.face + (tb.yOut - g.y.face) / 2), (Math.max(tb.z0, kneeX.zBot) + Math.min(tb.z1, kneeX.zTop)) / 2])] },
    { type: 'hole', to: `brake-sleeve-T-tab-${tag}`, count: 1, diaIn: pn.sleeveOd, at: [at(tab, [pn.T.x, sgn * mid(tb.yIn, tb.yOut), pn.T.z])],
      size: `1 x ${frac(pn.sleeveOd)}" hole through the tab for the top-pin sleeve: ${frac(pn.T.x - tb.x0)}" from the tab's rear end and ${frac(tb.z1 - pn.T.z)}" under its top (${frac(pn.T.z - tb.z0)}" up from its bottom, the tab is ${frac(tb.z1 - tb.z0)}" tall), square to the face`,
      note: 'drilled on the drill press with the tab square to the table; the stainless sleeve is epoxied in flush with both faces' },
    { type: 'pin', to: `brake-pin-T-${tag}`, count: 1, diaIn: pn.dia, size: `${frac(pn.dia)}" ball-lock pin through the tab's sleeve and on through the hull sleeve`, at: [at(tab, [pn.T.x, sgn * mid(tb.yIn, tb.yOut), pn.T.z])] },
  ];
  const dm = tb.dominos;
  if (dm) tab.joints.push({ type: 'domino', to: `brake-knee-${tag}`, count: dm.count, size: `${dm.name} (${dm.tool})`,
    at: dm.zs.map((z) => at(tab, [dm.xFace, sgn * dm.y, z])),
    note: `${dm.count} Dominos in the tab's end face (the face against the knee), each ${f2(dm.wIn)}" wide up the face and ${f2(dm.tIn)}" thick, ${f2(dm.depthEach)}" deep into the tab and the same into the knee's rear layer (grain running up in both, so the Domino's grain matches). Centers ${dm.zs.map((z) => f2(z - tb.z0)).join('" and ')}" up from the tab's bottom, ${f2(dm.y - tb.yIn)}" in from the tab's inboard face; the topmost stays ${f2(pn.T.z - pn.sleeveOd / 2 - (dm.zs[dm.zs.length - 1] + dm.wIn / 2))}" under the top-pin sleeve. Mortise the knee's rear face and the tab's end face from the same layout (a stop on the Domino cutter), dry-fit, then glue with epoxy.` });
  out.push(tab);

  // ── The four sleeves: stainless tube, cut to length ──
  const tubeLb = (len: number) => ((Math.PI / 4) * (sOd * sOd - sId * sId) * len) * steelLb;
  const sleeve = (key: 'B' | 'T', side: 'hull' | 'knee', x: number, z: number, y0: number, y1: number, host: string, step: number, extra: string): Part => {
    const len = y1 - y0;
    const id = key === 'B' ? (side === 'hull' ? `brake-sleeve-B-hull-${tag}` : `brake-sleeve-B-knee-${tag}`) : (side === 'hull' ? `brake-sleeve-T-hull-${tag}` : `brake-sleeve-T-tab-${tag}`);
    const partNo = id.replace(/-[LR]$/, '');
    const pinId = `brake-pin-${key}-${tag}`;
    const part = cylinder(ctx, {
      id, partNo, name: `Brake ${key === 'B' ? 'bottom' : 'top'}-pin sleeve in the ${side === 'hull' ? (key === 'B' ? 'rail' : 'box rib') : key === 'B' ? 'knee leg' : 'tab'} ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'steel', kind: 'metal', fab: 'bandsaw', step,
      material: `${stainless(p)} tube ${frac(sOd)}" OD x ${frac(sId)}" ID`, center: [x, yMid(y0, y1), z], axis: 'y', radius: sOd / 2, length: len, wall,
      removable: side === 'knee', explode: [0, sgn, 0.1],
      sourcing: { vendor: `McMaster-Carr or Online Metals (${stainless(p)} tube or plain bushing, ${frac(sOd)}" OD x ${frac(sId)}" ID, close sliding fit for a ${frac(pn.dia)}" pin; cut a ${frac(len)}" piece on the metal bandsaw and deburr the ends)`, costUsd: 2 },
      notes: `Stainless sleeve ${frac(len)}" long, ${frac(sOd)}" outside and ${frac(sId)}" inside: the ${frac(pn.dia)}" pin bears on steel instead of on a hole in oak. ${extra} Epoxy it into its ${frac(sOd)}" hole with a smear of thickened epoxy (keep the epoxy out of the bore; run a waxed ${frac(pn.dia)}" rod through it while it cures). ${side === 'hull' ? `Its inboard end stops against the bearing washer let into the ${key === 'B' ? "rail's" : "box rib's"} inner face (${frac(pn.washer.t)}" shorter than the member). ` : ''}Cut square, deburr the ends and check the pin slides in and out by hand before the glue is on.${side === 'knee' ? ' ' + KIT_NOTE : ' It stays in the hull when the knee is off, flush with the surface.'}`,
    });
    const w = (yy: number): Vec3 => [x, sgn * yy, z];
    part.massLb = tubeLb(len);
    part.joints = [
      { type: 'glue', to: host, count: 1, note: 'epoxy around the sleeve in its hole', at: [at(part, w(mid(y0, y1)))] },
      { type: 'pin', to: pinId, count: 1, diaIn: pn.dia, size: `${frac(sId)}" bore, ${frac(len)}" of bearing for the ${frac(pn.dia)}" ball-lock pin`, at: [at(part, w(mid(y0, y1)))] },
    ];
    return part;
  };
  const B = pn.B, T = pn.T;
  out.push(sleeve('B', 'hull', B.x, B.z, B.hullSleeve.y0, B.hullSleeve.y1, `rail-${tag}`, STEP.frame, `It goes through the rail ${f2(B.fromRailRear)}" from the rail's rear end and ${f2(B.belowRailTop)}" below its top edge, its outer end flush with the rail's outer face and its inner end against the bearing washer.`));
  out.push(sleeve('B', 'knee', B.x, B.z, B.kneeSleeve.y0, B.kneeSleeve.y1, `brake-knee-${tag}`, STEP.brake, `It goes through the knee leg ${f2(B.fromKneeRear)}" from the knee's rear face and ${f2(B.fromKneeBottom)}" up from its bottom, flush with both faces of the leg.`));
  out.push(sleeve('T', 'hull', T.x, T.z, T.hullSleeve.y0, T.hullSleeve.y1, `side-rib-${tag}1`, STEP.seatStorage, `It goes through the box rib, the filler behind it and the web, ${f2(T.fromRibFoot)}" up from the bottom of the rib and ${f2(T.belowRibTop)}" under the gunwale top, its outer end flush with the web's outer face and its inner end against the bearing washer.`));
  out.push(sleeve('T', 'knee', T.x, T.z, T.kneeSleeve.y0, T.kneeSleeve.y1, `brake-tab-${tag}`, STEP.brake, `It goes through the tab, ${frac(p.brakeTabEndIn)}" in from the tab's rear end, flush with both faces of the tab.`));

  // ── The two bearing washers (bought): stainless fender washers let flush into the hull members' inboard faces ──
  const wa = pn.washer;
  const washer = (key: 'B' | 'T', site: typeof B | typeof T, host: string, step: number, where: string): Part => {
    const part = cylinder(ctx, {
      id: `brake-washer-${key}-hull-${tag}`, partNo: `brake-washer-${key}-hull`, name: `Brake ${key === 'B' ? 'bottom' : 'top'}-pin bearing washer on the ${key === 'B' ? 'rail' : 'box rib'} ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', fab: 'buy', step,
      massLb: ((Math.PI / 4) * (wa.od * wa.od - wa.id * wa.id) * wa.t) * steelLb, material: `${stainless(p)} flat (fender) washer ${frac(wa.od)}" OD x ${frac(wa.id)}" hole x ${frac(wa.t)}" thick`,
      center: [site.x, yMid(site.hullWasher.y0, site.hullWasher.y1), site.z], axis: 'y', radius: wa.od / 2, length: wa.t, wall: (wa.od - wa.id) / 2, explode: [0, -sgn, 0.1],
      sourcing: { vendor: `McMaster-Carr or similar (${stainless(p)} flat (fender) washer for a 3/8" bolt, ${frac(wa.od)}" OD, ${frac(wa.id)}" hole)`, costUsd: 1 },
      notes: `Stainless fender washer, ${frac(wa.od)}" across, let into a ${(Math.round(wa.cboreDia * 10000) / 10000).toString()}" counterbore ${frac(wa.cboreDepth)}" deep in the ${where}, epoxied in so its face is flush with the wood (cut the counterbore first, then drill the pin hole through its center). The sleeve ends against its outer face; the pin passes the hole and its locking balls bear on the washer, spread over about ${f2(wa.ringArea)} square inches of oak outside the sleeve. It stays in the hull when the knee is off.`,
    });
    const c = at(part, [site.x, sgn * mid(site.hullWasher.y0, site.hullWasher.y1), site.z]);
    part.joints = [
      { type: 'glue', to: host, count: 1, note: 'epoxy in the counterbore, face flush', at: [c] },
      { type: 'pin', to: `brake-pin-${key}-${tag}`, count: 1, diaIn: pn.dia, size: `${frac(wa.id)}" hole for the ${frac(pn.dia)}" ball-lock pin; the balls bear on the washer`, at: [c] },
    ];
    return part;
  };
  out.push(washer('B', B, `rail-${tag}`, STEP.frame, "rail's inner face"));
  out.push(washer('T', T, `side-rib-${tag}1`, STEP.seatStorage, "box rib's inner face"));

  // ── The two ball-lock pins (bought) ──
  const pinMass = (len: number) => (Math.PI / 4) * pn.dia * pn.dia * (len - pn.headIn) * steelLb + p.brakePinHeadLb;
  const pin = (key: 'B' | 'T', site: typeof B | typeof T, members: string, mates: Array<{ to: string; note: string }>, extra: string): Part => {
    const usable = site.gripOrder;
    const part = cylinder(ctx, {
      id: `brake-pin-${key}-${tag}`, partNo: `brake-pin-${key}`, name: `Brake knee ${key === 'B' ? 'bottom' : 'top'} pin ${tag} (3/8" ball-lock, ${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', fab: 'buy', step: STEP.brake,
      massLb: pinMass(site.len), material: `${stainless(p)} ball-lock quick-release pin, ${frac(pn.dia)}" dia, ${frac(usable)}" usable length, with lanyard`,
      center: [site.x, yMid(site.yTip, site.yHead), site.z], axis: 'y', radius: pn.dia / 2, length: site.len, removable: true, explode: [0, sgn * 1.5, 0],
      sourcing: {
        vendor: std
          ? `McMaster-Carr or similar (stainless ball-lock quick-release pin, ${frac(pn.dia)}" diameter, ${frac(usable)}" usable length; 17-4 PH is the usual grade and is accepted for the Standard spec; get the vendor's pull-out rating, the button end is outboard)`
          : `A 316 stainless ball-lock quick-release pin must be sourced for the Extreme spec (${frac(pn.dia)}" diameter, ${frac(usable)}" usable length); the common ones are 17-4 PH stainless, which is not 316 (ask the vendor, or accept 17-4 PH as a written exception); get the vendor's pull-out rating, the button end is outboard`,
        costUsd: 25,
      },
      notes: `${frac(pn.dia)}" ball-lock quick-release pin, ${frac(usable)}" usable length, for the stack ${members} (${frac(site.stack)}" thick; buy the next 1/4" grip up, ${frac(usable)}"). Push the button, slide it in from the OUTSIDE until the balls are through the last sleeve (they stand ${f2(pn.tipIn)}" past it), let the button go: the balls hold it. The handle stands ${f2(pn.headIn)}" proud outboard. Pull the button to take it out. A short lanyard to the knee keeps it from getting lost. ${extra} Ball-lock pins are usually 17-4 PH stainless: right for the Standard spec; for the Extreme spec a 316 pin has to be sourced. The pull-out rating of the locking balls is not published for these pins: ask the vendor before buying. ${KIT_NOTE}`,
    });
    part.joints = mates.map((m): Joint => ({ type: 'pin', to: m.to, count: 1, diaIn: pn.dia, size: m.note, at: [at(part, [site.x, sgn * mid(site.yTip, site.yHead), site.z])] }));
    return part;
  };
  out.push(pin('B', B, 'knee leg and rail', [
    { to: `brake-sleeve-B-knee-${tag}`, note: `through the ${frac(B.kneeSleeve.len)}" sleeve in the knee leg` },
    { to: `brake-sleeve-B-hull-${tag}`, note: `through the ${frac(B.hullSleeve.len)}" sleeve in the rail` },
  ], `It passes the ${frac(B.kneeSleeve.len)}" knee leg and the ${frac(B.hullSleeve.len)}" rail only, at the knee's center fore and aft and the rail's mid-height; the balls come out on the rail's inner face, in the open space under the deck.`));
  out.push(pin('T', T, 'tab, web, filler and box rib', [
    { to: `brake-sleeve-T-tab-${tag}`, note: `through the ${frac(T.kneeSleeve.len)}" sleeve in the tab` },
    { to: `brake-sleeve-T-hull-${tag}`, note: `through the ${frac(T.hullSleeve.len)}" sleeve through the web, the filler and the box rib` },
  ], `It passes the tab (${frac(T.kneeSleeve.len)}"), the web, the filler and the box rib (together ${frac(T.hullSleeve.len)}"), above the top of the box tie spacer, which no pin can pass; the balls come out ${f2(pn.clear.ballTipToBox)}" short of the storage box side.`));
  return out;
}
