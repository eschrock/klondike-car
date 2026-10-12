/**
 * The cargo bed (D-53): the flat deck between the storage box and the foot stop that carries the post-race payload once the seat is stowed in the box. Derived from
 * the layout (never typed in): the usable length, width and height to the gunwale, and the floor area the payload spreads over. Plain math, no three.js.
 */
import { STORAGE_LOCATION, type Params } from '../params';
import { innerHalfWidth, type Layout } from './layout';

export interface CargoBed {
  /** The bed starts at the box's fore end (the seat wedge is a loose block that stows, so nothing stands proud of the deck). */
  x0: number;
  /** End of the flat deck (the bow curl starts here); the hull is the same width all the way (D-54). */
  xFull: number;
  /** Where the clear width has narrowed to `cargoLoadWidthIn`: the payload block is piled no farther forward than this. */
  xLoadEnd: number;
  /** That width, and the bed's length (from the box) that is at least that wide. */
  loadWidthIn: number;
  loadLengthIn: number;
  /** Rear face of the foot stop: the bed ends here. */
  xStop: number;
  /** Clear width between the cabin sides (full width), and the narrowest clear width at the foot stop. */
  widthIn: number;
  stopWidthIn: number;
  /** Deck to the lowest gunwale top. */
  heightIn: number;
  /** Lengths: the straight side at full width (D-54: the whole bed), and to the foot stop. */
  straightLengthIn: number;
  fullLengthIn: number;
  totalLengthIn: number;
  /** Floor area (in²) between x0 and the foot stop, and over the full-width run to xn. */
  areaIn2: number;
  fullAreaIn2: number;
  /** Top of the box above the deck (the lid is a table for light loads) and its plan size. */
  boxTopIn: number;
}

const STEP_IN = 0.25;

export function cargoBed(p: Params, L: Layout): CargoBed {
  // The wedge-free bed starts at the box's fore end when the box stands behind the seat; with another box location (not the stow design) the whole cabin floor is bed.
  const x0 = p.storageLocation === STORAGE_LOCATION.rearOverAxle ? L.storage.x1 : L.xRear + L.transom;
  const fx = p.seatXIn + p.riderLegReachIn;
  const xStop = Math.min(fx, L.railEnd);
  const widthAt = (x: number) => 2 * innerHalfWidth(L, x);
  // First x (from the box) where the clear width has dropped below the payload block width.
  let xLoadEnd = x0;
  for (let x = x0; x <= xStop + 1e-9; x += STEP_IN) { if (widthAt(x) < p.cargoLoadWidthIn) break; xLoadEnd = x; }
  const integral = (a: number, b: number) => {
    let area = 0;
    for (let x = a; x < b; x += STEP_IN) area += 2 * innerHalfWidth(L, Math.min(b, x + STEP_IN / 2)) * Math.min(STEP_IN, b - x);
    return area;
  };
  return {
    x0, xFull: L.xFlatEnd, xLoadEnd, loadWidthIn: p.cargoLoadWidthIn, loadLengthIn: Math.max(0, xLoadEnd - x0), xStop, widthIn: 2 * L.hwC, stopWidthIn: 2 * innerHalfWidth(L, xStop), heightIn: L.sideH,
    straightLengthIn: Math.max(0, xStop - x0), fullLengthIn: Math.max(0, xStop - x0), totalLengthIn: Math.max(0, xStop - x0),
    areaIn2: Math.max(1, integral(x0, xStop)), fullAreaIn2: Math.max(1, integral(x0, xStop)), boxTopIn: L.storage.zTop - L.deckTop,
  };
}

/** Length (in) of the bed, from the box, that is at least `widthIn` clear: the longest rectangular load of that width. */
export function bedLengthAtWidth(L: Layout, bed: CargoBed, widthIn: number): number {
  let x = bed.x0;
  while (x <= bed.xStop && 2 * innerHalfWidth(L, x) >= widthIn) x += STEP_IN;
  return Math.max(0, x - STEP_IN - bed.x0);
}
