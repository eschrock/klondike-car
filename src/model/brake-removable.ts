/**
 * D-78: the parts of the removable brake knee (`kneeMount` = removable). Per side: the knee TAB (oak, glued to the knee), two 3/8-16 stainless hex bolts with a flat washer under each head (bottom: through
 * the knee leg and the rail; top: through the tab, the web, the filler and the box rib block), and two flanged threaded inserts in the hull (rail, box rib block) that stay on the sled. All sizes and places come
 * from `BrakeGeom.removable` (brake-layout.ts); nothing is typed here. The rail's and the rib's hole joints are written by frame.ts and side-ribs.ts. Plain TS, no three.js.
 */
import { STEP, box, cylinder, stainless, stainlessName, type Ctx } from './build-utils';
import type { BoltSite, BrakeGeom } from './brake-layout';
import { frac } from './joinery';
import { localPoint } from './rear-mount';
import type { Part, Vec3 } from './types';

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
/** Shop note on every part that comes off with the knee. */
const KIT_NOTE = 'REMOVABLE: it comes off with the knee and the flap when the two bolts are undone; nothing of it stays on the hull.';

/** The D-78 parts for one side. `g.removable` must be present. */
export function buildRemovableKneeParts(ctx: Ctx, g: BrakeGeom, sgn: 1 | -1, tag: 'L' | 'R'): Part[] {
  const { p } = ctx;
  const rm = g.removable!;
  const out: Part[] = [];
  const mid = (a: number, b: number) => (a + b) / 2;
  const yMid = (a: number, b: number) => sgn * mid(a, b);
  const at = (part: Part, w: Vec3): Vec3 => localPoint(part.transform, w);
  const steelLb = p.steelDensityPcf / 1728; // lb per in^3
  const bt = rm.bottom, tp = rm.top;
  const boltId = (k: 'bottom' | 'top') => `brake-bolt-${k}-${tag}`;

  // ── The tab: oak, grain vertical, face-glued to the knee's rear face, lying on the side web ──
  const tb = rm.tab;
  const tab = box(ctx, {
    id: `brake-tab-${tag}`, partNo: 'brake-tab', name: `Brake knee tab ${tag} (white oak)`, group: 'brake', mat: 'oak', grain: 'z', fab: 'table-saw', step: STEP.brake, removable: true,
    size: [tb.x1 - tb.x0, tb.t, tb.z1 - tb.z0], center: [mid(tb.x0, tb.x1), yMid(tb.yIn, tb.yOut), mid(tb.z0, tb.z1)], explode: [-0.6, sgn, 0.3],
    notes: `Oak block ${frac(tb.t)}" thick (across) x ${frac(tb.x1 - tb.x0)}" long (fore and aft) x ${frac(tb.z1 - tb.z0)}" tall, grain running up, from 4/4 stock laminated to ${frac(tb.t)}" or a single 8/4 offcut. Its long face lies against the knee's rear face and is glued to it with epoxy (about ${f2(tb.glueArea)} square inches of glue, over the lower ${f2(tb.patch.z1 - tb.patch.z0)}" of the tab, which hangs well below the top bolt; clamp it square for the cure and check the fit dry); the tab sticks out behind the knee ${frac(tb.x1 - tb.x0)}" and lies flat on the side's web, the top part over the box rib block, which backs the web there. The knee itself touches only the rail and the chine band. Its inboard face is ${frac(rm.webRecess)}" inboard of the knee's inboard face (the web is recessed that much between the chine band and the gunwale band), so the tab sits flat on the web. It is NOT glued to the web. The top bolt's ${frac(rm.clearHole)}" clearance hole goes through it ${frac(p.brakeTabEndIn)}" in from its rear end and ${frac(p.brakeTabAboveBoltIn)}" under its top. It stays ${f2(rm.clear.tabTopToWasher)}" under the fender washers of the D-ring and ${frac(p.brakeTabClearIn)}" clear of the side sign. ${KIT_NOTE}`,
    sourcing: { vendor: `Shop-cut white oak, ${frac(tb.t)}" x ${frac(tb.x1 - tb.x0)}" x ${frac(tb.z1 - tb.z0)}"` },
  });
  const kneeX = g.knee;
  tab.joints = [
    { type: 'glue', to: `brake-knee-${tag}`, count: 1, note: `epoxy, the tab's front face against the knee's rear face, ${f2(tb.glueArea)} square inches; clamp it square`, at: [at(tab, [tb.x1, sgn * (g.y.face + (tb.yOut - g.y.face) / 2), (Math.max(tb.z0, kneeX.zBot) + Math.min(tb.z1, kneeX.zTopLeg)) / 2])] },
    { type: 'hole', to: boltId('top'), count: 1, diaIn: rm.clearHole, at: [at(tab, [tp.x, sgn * mid(tb.yIn, tb.yOut), tp.z])],
      size: `1 x ${frac(rm.clearHole)}" clearance hole through the tab for the top bolt: ${frac(tp.x - tb.x0)}" from the tab's rear end and ${frac(tb.z1 - tp.z)}" under its top (${frac(tp.z - tb.z0)}" up from its bottom, the tab is ${frac(tb.z1 - tb.z0)}" tall), square to the face`,
      note: 'drilled on the drill press with the tab square to the table' },
    { type: 'pin', to: boltId('top'), count: 1, diaIn: rm.dia, size: `${frac(rm.dia)}-16 hex bolt through the tab, the web, the filler and the rib block into the threaded insert`, at: [at(tab, [tp.x, sgn * mid(tb.yIn, tb.yOut), tp.z])] },
  ];
  out.push(tab);

  // ── The two bolts (bought) and the flat washers under their heads ──
  const bolt = (key: 'bottom' | 'top', s: BoltSite, members: string, extra: string): Part => {
    const shankLen = s.len - rm.headH;
    const headVol = (Math.sqrt(3) / 2) * rm.headAf * rm.headAf * rm.headH;
    const mass = ((Math.PI / 4) * rm.dia * rm.dia * shankLen + headVol) * steelLb;
    const part = cylinder(ctx, {
      id: boltId(key), partNo: `brake-bolt-${key}`, name: `Brake knee ${key} bolt ${tag} (${frac(rm.dia)}-16 hex, ${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', fab: 'buy', step: STEP.brake,
      massLb: mass, material: `${stainless(p)} hex-head bolt ${frac(rm.dia)}-16 x ${frac(s.orderLen)}", fully threaded or with 1 in of thread at the tip`,
      center: [s.x, yMid(s.yTip, s.yHead), s.z], axis: 'y', radius: rm.dia / 2, length: s.len, removable: true, explode: [0, sgn * 1.5, 0],
      sourcing: { vendor: `McMaster-Carr or Bolt Depot (${stainless(p)} hex-head cap screw or bolt, ${frac(rm.dia)}-16 x ${frac(s.orderLen)}")`, costUsd: 2 },
      notes: `${frac(rm.dia)}-16 x ${frac(s.orderLen)}" hex bolt for the stack ${members} (${frac(s.stack)}" thick, a ${f2(s.washer.t)}" flat washer under the head and two threads showing past the insert). It goes in from the OUTSIDE through a ${frac(s.washer.od)}" flat washer and threads into the insert in the hull; tighten it firmly with the 3/8" drive ratchet and the 9/16" deep socket kept in the storage box, the two bolts a little at a time, so the knee is clamped to the hull. The tip stands ${f2(s.tipPast)}" past the inner face of the ${key === 'bottom' ? 'rail' : 'rib'}. ${extra} Put a drop of anti-seize on the thread of a stainless bolt in a stainless insert. ${KIT_NOTE}`,
    });
    part.joints = [{ type: 'pin', to: `brake-insert-${key}-${tag}`, count: 1, diaIn: rm.dia, size: `${frac(rm.dia)}-16 thread into the insert, ${f2(s.insert.engage)}" of thread`, at: [at(part, [s.x, sgn * s.insert.body.y0, s.z])] },
      { type: 'pin', to: `brake-washer-${key}-${tag}`, count: 1, diaIn: rm.dia, size: `through the ${frac(s.washer.id)}" hole of the flat washer under the head`, at: [at(part, [s.x, sgn * mid(s.washer.y0, s.washer.y1), s.z])] }];
    return part;
  };
  out.push(bolt('bottom', bt, 'knee leg and rail', `It goes through the ${frac(g.knee.legT)}" knee leg and the ${frac(rm.hull.rail)}" rail at the knee's center fore and aft and the rail's mid-height.`));
  out.push(bolt('top', tp, 'tab, web, filler and box rib', `It goes through the tab (${frac(tb.t)}"), the web, the filler and the box rib block (together ${frac(tp.insert.member)}"), above the top of the box tie spacer, which no bolt can pass; the tip comes out ${f2(rm.clear.boltTipToBox)}" short of the storage box side.`));

  const washer = (key: 'bottom' | 'top', s: BoltSite): Part => {
    const w = s.washer;
    const part = cylinder(ctx, {
      id: `brake-washer-${key}-${tag}`, partNo: `brake-washer-${key}`, name: `Brake knee ${key} bolt washer ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', fab: 'buy', step: STEP.brake,
      massLb: ((Math.PI / 4) * (w.od * w.od - w.id * w.id) * w.t) * steelLb, material: `${stainless(p)} flat washer (USS) for a ${frac(rm.dia)} bolt, ${frac(w.od)}" OD x ${frac(w.id)}" hole`,
      center: [s.x, yMid(w.y0, w.y1), s.z], axis: 'y', radius: w.od / 2, length: w.t, wall: (w.od - w.id) / 2, removable: true, explode: [0, sgn * 1.5, 0],
      sourcing: { vendor: `McMaster-Carr or similar (${stainless(p)} USS flat washer for a ${frac(rm.dia)} bolt, ${frac(w.od)}" OD)`, costUsd: 0.5 },
      notes: `${stainless(p)} flat washer under the head of the ${key} bolt, on the outer face of the ${key === 'bottom' ? 'knee leg' : 'tab'}; it spreads the bolt's clamp over the oak. ${KIT_NOTE}`,
    });
    part.joints = [{ type: 'pin', to: boltId(key), count: 1, diaIn: rm.dia, size: `the bolt passes the ${frac(w.id)}" hole`, at: [at(part, [s.x, sgn * mid(w.y0, w.y1), s.z])] }];
    return part;
  };
  out.push(washer('bottom', bt));
  out.push(washer('top', tp));

  // ── The two flanged threaded inserts in the hull (bought; they stay) ──
  const insert = (key: 'bottom' | 'top', s: BoltSite, host: string, step: number, where: string, extra: string): Part => {
    const ins = s.insert;
    const total = ins.flangeT + ins.len;
    const thread = rm.dia; // 3/8-16 inside
    const body = (Math.PI / 4) * (ins.od * ins.od - thread * thread) * ins.len;
    const flange = (Math.PI / 4) * (ins.flangeOd * ins.flangeOd - thread * thread) * ins.flangeT;
    const part = cylinder(ctx, {
      id: `brake-insert-${key}-${tag}`, partNo: `brake-insert-${key}`, name: `Brake ${key}-bolt threaded insert in the ${key === 'bottom' ? 'rail' : 'box rib'} ${tag} (${stainlessName(p)})`, group: 'brake', mat: 'fixed', kind: 'purchased', fab: 'buy', step,
      massLb: (body + flange) * steelLb, material: `${stainless(p)} flanged threaded insert for wood, ${frac(rm.dia)}-16, ${frac(ins.od)}" body x ${frac(ins.len)}" long, ${frac(ins.flangeOd)}" flange`,
      center: [s.x, yMid(ins.flange.y0, ins.body.y1), s.z], axis: 'y', radius: ins.od / 2, length: total, wall: (ins.od - thread) / 2, explode: [0, -sgn, 0.1],
      sourcing: { vendor: `McMaster-Carr or similar (${stainless(p)} flanged threaded insert for wood, ${frac(rm.dia)}-16 thread, about ${frac(ins.od)}" body, ${frac(ins.len)}" long, ${frac(ins.flangeOd)}" flange; a stock size near these is wanted: confirm it before buying and before drilling)`, costUsd: 4 },
      notes: `Stainless flanged threaded insert, ${frac(rm.dia)}-16, ${frac(ins.len)}" of body under a ${frac(ins.flangeT)}" flange, set from the INBOARD face of the ${where}: cut the ${ins.cboreDia.toFixed(4)}" counterbore ${ins.cboreDepth.toFixed(4)}" deep first, then the ${frac(ins.od)}" pilot hole ${frac(ins.len)}" deeper, then screw the insert in with epoxy until the flange is flush with the face. ${extra} Keep epoxy out of the thread. ${f2(ins.woodBeyond)}" of wood is left outboard of its end. It stays in the hull when the knee is off.`,
    });
    const c = at(part, [s.x, sgn * mid(ins.flange.y0, ins.body.y1), s.z]);
    part.joints = [
      { type: 'glue', to: host, count: 1, note: 'epoxy around the body and under the flange in its counterbore', at: [c] },
      { type: 'pin', to: boltId(key), count: 1, diaIn: rm.dia, size: `${frac(rm.dia)}-16 thread, ${f2(ins.engage)}" long`, at: [c] },
    ];
    return part;
  };
  out.push(insert('bottom', bt, `rail-${tag}`, STEP.frame, "rail", `It goes ${f2(bt.fromRailRear)}" from the rail's rear end and ${f2(bt.belowRailTop)}" below its top edge.`));
  out.push(insert('top', tp, `side-rib-${tag}1`, STEP.seatStorage, "box rib block", `It goes ${f2(tp.fromRibFoot)}" up from the bottom of the rib and ${f2(tp.belowRibTop)}" under the gunwale top, through ${f2(tp.insert.member)}" of rib, filler and web, ending in the rib and filler.`));
  return out;
}

