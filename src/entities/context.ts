/**
 * The slice of the world entities may touch during update(). Keeps entity
 * modules canvas-free (node-safe) and lets tests inject fakes trivially.
 */

import type { SfxName } from '../engine/audio';
import type { ParticleSystem } from '../engine/particles';
import type { Rng } from '../engine/rng';
import type { TileMap } from '../world/tiles';

export interface EntityWorld {
  map: TileMap;
  particles: ParticleSystem;
  /** Cosmetic randomness (particle jitter). */
  rng: Rng;
  sfx(name: SfxName): void;
}

/** A no-op world for tests. */
export function nullWorldParts(): Pick<EntityWorld, 'sfx'> {
  return { sfx: () => undefined };
}
