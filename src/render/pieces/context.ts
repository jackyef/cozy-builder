/**
 * The context a piece renderer is handed, and the registry that maps piece ids
 * to renderers.
 *
 * ## Local space
 *
 * A renderer is called with the builder already transformed so that:
 *
 *   - the origin is the **centre of the hex, at ground level**,
 *   - **+X is east**, **-Z is north**, **+Y is up**,
 *   - one hex is `HEX_WIDTH` (≈1.73) across east-west.
 *
 * So a renderer never deals with world coordinates. It models one cottage at
 * the origin and the chunk baker puts it where it belongs.
 *
 * ## Determinism
 *
 * Variance helpers (`rand`, `jitter`, `pick`, `chance`) are seeded from the
 * world seed *and the hex coordinate*, so a piece looks identical every time it
 * is rebuilt but different from its neighbours. Each helper takes a `channel`
 * name; use a distinct one per property, or every tall cottage will also be
 * red. See `src/core/rng.ts`.
 *
 * **Never call `Math.random()` in a renderer.** Chunks rebake whenever a
 * neighbour changes, so anything non-deterministic visibly twitches while you
 * build next to it.
 *
 * ## Adding a renderer
 *
 * Write a `PieceRenderer` and register it in `./index.ts` under the same id as
 * the catalog entry. Keep it under a few hundred triangles: a village can hold
 * hundreds of pieces, and detail that is invisible at normal camera distance
 * costs real frame time.
 *
 * ## Swapping in real 3D models later
 *
 * This registry is the seam. A renderer is just `(ctx) => void`, so a
 * GLTF-backed implementation can replace a procedural one piece by piece —
 * bake the loaded model's geometry through `ctx.builder.add(...)` and nothing
 * else in the codebase needs to know. See `docs/architecture.md`.
 */

import type { MeshBuilder } from '../geometry/builder'
import { hashChance, hashChoice, hashJitter, hashNoise, hashPick } from '@/core/rng'
import type { ConnectionMask } from '@/world/autoconnect'
import type { Hex } from '@/core/hex'
import type { PieceDefinition, PlacedPiece, World } from '@/world/types'

export interface PieceContext {
  /** Emit geometry here. Already positioned at the hex — model in local space. */
  readonly builder: MeshBuilder
  /** The world, for renderers that need to look at neighbours directly. */
  readonly world: World
  readonly hex: Hex
  readonly placed: PlacedPiece
  readonly def: PieceDefinition
  /** Which of the six neighbours this piece links to. See `world/autoconnect.ts`. */
  readonly mask: ConnectionMask
  /** Chosen variant index, already resolved from the seed or an explicit override. */
  readonly variant: number
  /** Manual rotation in radians, or 0 for pieces that aren't rotatable. */
  readonly rotationY: number
  /** Height of the ground surface under this hex, relative to y = 0. */
  readonly groundY: number

  /** Stable value in `[0, 1)` for this hex and channel. */
  rand(channel: string): number
  /** Stable value in `[-amount, amount]`. */
  jitter(channel: string, amount: number): number
  /** Stable value in `[min, max)`. */
  range(channel: string, min: number, max: number): number
  /** Stable element of `items`. */
  pick<T>(channel: string, items: readonly T[]): T
  /** Stable integer in `[0, count)`. */
  index(channel: string, count: number): number
  /** Stable boolean, true with probability `p`. */
  chance(channel: string, p: number): boolean
}

/** Builds one piece into `ctx.builder`. */
export type PieceRenderer = (ctx: PieceContext) => void

/** Creates the variance helpers bound to a seed and coordinate. */
export function makeVariance(
  seed: number,
  hex: Hex,
): Pick<PieceContext, 'rand' | 'jitter' | 'range' | 'pick' | 'index' | 'chance'> {
  const { q, r } = hex
  return {
    rand: (channel) => hashNoise(seed, q, r, channel),
    jitter: (channel, amount) => hashJitter(seed, q, r, channel, amount),
    range: (channel, min, max) => min + hashNoise(seed, q, r, channel) * (max - min),
    pick: (channel, items) => hashChoice(seed, q, r, channel, items),
    index: (channel, count) => hashPick(seed, q, r, channel, count),
    chance: (channel, p) => hashChance(seed, q, r, channel, p),
  }
}
