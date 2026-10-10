import { derived, type Params } from '../params';
import { compose, multiply, translation, rotationZ } from './mat4';
import type { Part } from './types';

/**
 * Phase 0 placeholder: four wheels and a deck. Real geometry replaces this in Phase 1,
 * but the signature (Params -> Part[]) is the contract every view depends on.
 */
export interface ViewState {
  /** Displayed steer angle, degrees (+ = turning left). Clamped to ± lock. */
  steerDeg?: number;
}

export function buildModel(p: Params, view: ViewState = {}): Part[] {
  const d = derived(p);
  const r = d.wheelRadiusIn;
  const lock = Math.abs(p.steerLockDeg);
  const steer = (Math.min(lock, Math.max(-lock, (view.steerDeg ?? 0))) * Math.PI) / 180;

  const wheel = (id: 'wheel-FL' | 'wheel-FR' | 'wheel-RL' | 'wheel-RR', name: string, transform: number[]): Part => ({
    id,
    name,
    group: 'running-gear',
    kind: 'purchased',
    material: 'pneumatic tire + hub',
    geometry: { type: 'wheel', diameter: p.wheelDiameterIn, width: p.tireWidthIn, hubDiameter: Math.min(p.wheelDiameterIn * 0.5, 6), hubLength: p.hubLengthIn, bore: p.axleDiameterIn },
    body: id,
    partNo: 'wheel',
    transform,
    massLb: d.wheelMassLb,
    fab: 'buy',
    step: 3,
  });

  const rearY = p.rearTrackIn / 2;
  const frontY = p.frontTrackIn / 2;
  // Front wheels pivot about the kingpin at (wheelbase, 0): T(kingpin) · Rz(steer) · T(local offset).
  const kingpin = multiply(translation(p.wheelbaseIn, 0, 0), rotationZ(steer));

  const deckLen = d.overallLengthIn;
  const deckX = (-p.rearOverhangIn + p.wheelbaseIn + p.frontOverhangIn) / 2;
  const deckVolIn3 = deckLen * p.bodyWidthIn * p.deckPlyIn;

  const deck: Part = {
    id: 'deck',
    name: 'Deck (placeholder)',
    group: 'body',
    kind: 'sheet',
    material: p.plySpecies === 0 ? 'okoume marine plywood' : 'baltic birch plywood',
    stock: { t: p.deckPlyIn, w: p.bodyWidthIn, l: deckLen },
    geometry: { type: 'box', size: [deckLen, p.bodyWidthIn, p.deckPlyIn] },
    transform: compose([deckX, 0, p.deckHeightIn - p.deckPlyIn / 2]),
    massLb: (deckVolIn3 / 1728) * d.plyDensityPcf,
    fab: 'table-saw',
    body: 'chassis',
    step: 1,
  };

  return [
    wheel('wheel-RL', 'Rear left wheel', translation(0, rearY, r)),
    wheel('wheel-RR', 'Rear right wheel', translation(0, -rearY, r)),
    wheel('wheel-FL', 'Front left wheel', multiply(kingpin, translation(0, frontY, r))),
    wheel('wheel-FR', 'Front right wheel', multiply(kingpin, translation(0, -frontY, r))),
    deck,
  ];
}
