/**
 * The removable kits and the transport configuration (D-9, D-65). Plain TS, no three.js.
 *
 * `Part.removable` marks what comes off for the truck (`offForTransport`): the seat back's pad (its quick-release latch pins are removable too, but they stay in for the truck, holding the flat back down), the wheel chocks and their cords, the lights and their clips, and the brake flaps with
 * everything that goes with them (D-78: with the optional removable knees, the knees and their straps too, bolted on with a ratchet and wrench). Everything else stays on (Eric, D-65): the side SIGNS ("that seems excessive"), the oak TONGUE with its sleeve and the bridle rope (bolted to the front
 * axle beam, not a no-tool part, and the sled fits the truck fully assembled), the push handle (it is PARKED for transport) and the brake knees and backers (unless the knees are set removable, D-78; the backers and backing plates always stay). The viewer's Brakes, Lights and Wheel chocks toggles switch one kit at a time; Transport mode switches the whole transport configuration, which the truck-fit check also uses.
 */
import { KNEE_MOUNT, type Params } from '../params';
import type { Part } from './types';

/** The brake flap kit: the flap, its pivot block, pin and clip, the shoe block and pad, the foot tread, the return cord and its snap hook (not the knees, backers or chocks). */
export const BRAKE_KIT_RE = /^brake-(flap|pivot-block|pivot-pin|pivot-clip|shoe|pad|foot-tread|cord|snap)-[LR]$/;
/** The lights: front lamp and its clip, rear light and its clip. */
export const LIGHT_KIT_RE = /^(front-light|lamp-clip|rear-light|rear-lamp-clip)$/;
/** The wheel chocks and their cords. */
export const CHOCK_KIT_RE = /^brake-chock(-cord)?-[LR]$/;

/** D-78: with removable knees the knee and its strap come off with the flap kit (the backer, backing plate and rail holes stay). */
export const BRAKE_KNEE_RE = /^brake-(knee|strap)-[LR]$/;

/**
 * Removable parts that STAY ON in the transport configuration: the seat-back latch pins. They are quick-release pins (so `removable`), but in Transport mode they hold the
 * flat seat back down on the deck; unpinned, the hinged back could lift and slam in the wind in the truck bed. They ride on their lanyards either way.
 */
export const TRANSPORT_KEEP_RE = /^seat-pin-[LR]$/;
/** Does `x` come off for the truck (Transport mode, the transport mass and the lift)? Every `removable` part except the ones in `TRANSPORT_KEEP_RE`. */
export const offForTransport = (x: Pick<Part, 'id' | 'removable'>): boolean => !!x.removable && !TRANSPORT_KEEP_RE.test(x.id);

/** Is `x` in the brake kit? With `p` set to removable knees (D-78) the knees and straps are in it too; without `p`, or with the default fixed knees, they are not. */
export const isBrakeKit = (x: Pick<Part, 'id'>, p?: Pick<Params, 'kneeMount'>): boolean => BRAKE_KIT_RE.test(x.id) || (p?.kneeMount === KNEE_MOUNT.removable && BRAKE_KNEE_RE.test(x.id));
export const isLightKit = (x: Pick<Part, 'id'>): boolean => LIGHT_KIT_RE.test(x.id);
export const isChockKit = (x: Pick<Part, 'id'>): boolean => CHOCK_KIT_RE.test(x.id);

/**
 * The transport configuration as view options (D-65): every `removable` part off (brakes, lights, chocks, the seat back's pad; the latch pins stay in and hold the flat back), the tongue on, the handlebow PARKED and the seat back
 * flat (the cushions in the box). The truck-fit check builds exactly this, and the viewer's Transport mode shows exactly this.
 */
export const TRANSPORT_VIEW = { removed: true, handle: 'parked', seat: 'stowed' } as const;
