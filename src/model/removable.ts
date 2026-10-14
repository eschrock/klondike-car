/**
 * The removable kits and the transport configuration (D-9, D-65). Plain TS, no three.js.
 *
 * `Part.removable` marks what comes off for the truck: the seat back's pad and pins, the wheel chocks and their cords, the lights and their clips, and the brake flaps with
 * everything that goes with them. Everything else stays on (Eric, D-65): the side SIGNS ("that seems excessive"), the oak TONGUE with its sleeve and the bridle rope (bolted to the front
 * axle beam, not a no-tool part, and the sled fits the truck fully assembled), the push handle (it is PARKED for transport) and the brake knees and backers. The viewer's Brakes, Lights and Wheel chocks toggles switch one kit at a time; Transport mode switches the whole transport configuration, which the truck-fit check also uses.
 */
import type { Part } from './types';

/** The brake flap kit: the flap, its pivot block, pin and clip, the shoe block and pad, the foot tread, the return cord and its snap hook (not the knees, backers or chocks). */
export const BRAKE_KIT_RE = /^brake-(flap|pivot-block|pivot-pin|pivot-clip|shoe|pad|foot-tread|cord|snap)-[LR]$/;
/** The lights: front lamp and its clip, rear light and its clip. */
export const LIGHT_KIT_RE = /^(front-light|lamp-clip|rear-light|rear-lamp-clip)$/;
/** The wheel chocks and their cords. */
export const CHOCK_KIT_RE = /^brake-chock(-cord)?-[LR]$/;

export const isBrakeKit = (x: Pick<Part, 'id'>): boolean => BRAKE_KIT_RE.test(x.id);
export const isLightKit = (x: Pick<Part, 'id'>): boolean => LIGHT_KIT_RE.test(x.id);
export const isChockKit = (x: Pick<Part, 'id'>): boolean => CHOCK_KIT_RE.test(x.id);

/**
 * The transport configuration as view options (D-65): every `removable` part off (brakes, lights, chocks, the seat back's pad and pins), the tongue on, the handlebow PARKED and the seat back
 * flat (the cushions in the box). The truck-fit check builds exactly this, and the viewer's Transport mode shows exactly this.
 */
export const TRANSPORT_VIEW = { removed: true, handle: 'parked', seat: 'stowed' } as const;
