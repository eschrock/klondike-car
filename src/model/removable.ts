/**
 * The removable kits and the transport configuration (D-9, D-65). Plain TS, no three.js.
 *
 * `Part.removable` marks what comes off for the truck: the seat back's pad and pins, the wheel chocks and their cords, the lights and their clips, and the brake flaps with
 * everything that goes with them. Everything else stays on (Eric, D-65): the side SIGNS ("that seems excessive"), the oak TONGUE with its sleeve and the bridle rope (bolted to the front
 * axle beam, not a no-tool part, and the sled fits the truck fully assembled), the push handle (it is PARKED for transport) and (bolted knees, the default) the brake knees and backers; with the knee removable (D-78) the knee, strap, tab and two bolts come off with the flap. The viewer's Brakes, Lights and Wheel chocks toggles switch one kit at a time; Transport mode switches the whole transport configuration, which the truck-fit check also uses.
 */
import type { Part } from './types';

/**
 * The brake flap kit: the flap, its pivot block, pin and clip, the shoe block and pad, the foot tread, the return cord and its snap hook (not the knees, backers or chocks).
 * D-78 (removable knee, `kneeMount` = removable) adds the knee's own parts, which exist only in that setting: the tab, the two bolts and their flat washers. The threaded inserts in the rail and in the box rib stay on the hull and are NOT in the kit.
 */
export const BRAKE_KIT_RE = /^brake-(flap|pivot-block|pivot-pin|pivot-clip|shoe|pad|foot-tread|cord|snap|tab|bolt-bottom|bolt-top|washer-bottom|washer-top)-[LR]$/;
/** The knee and its strap: in the kit only when the knee is removable (D-78; they are then flagged `removable`). Bolted (the default), they stay on the rail. */
export const BRAKE_KNEE_RE = /^brake-(knee|strap)-[LR]$/;
/** The lights: front lamp and its clip, rear light and its clip. */
export const LIGHT_KIT_RE = /^(front-light|lamp-clip|rear-light|rear-lamp-clip)$/;
/** The wheel chocks and their cords. */
export const CHOCK_KIT_RE = /^brake-chock(-cord)?-[LR]$/;

export const isBrakeKit = (x: Pick<Part, 'id'> & { removable?: boolean }): boolean => BRAKE_KIT_RE.test(x.id) || (!!x.removable && BRAKE_KNEE_RE.test(x.id));
export const isLightKit = (x: Pick<Part, 'id'>): boolean => LIGHT_KIT_RE.test(x.id);
export const isChockKit = (x: Pick<Part, 'id'>): boolean => CHOCK_KIT_RE.test(x.id);

/**
 * The transport configuration as view options (D-65): every `removable` part off (brakes, lights, chocks, the seat back's pad and pins), the tongue on, the handlebow PARKED and the seat back
 * flat (the cushions in the box). The truck-fit check builds exactly this, and the viewer's Transport mode shows exactly this.
 */
export const TRANSPORT_VIEW = { removed: true, handle: 'parked', seat: 'stowed' } as const;
