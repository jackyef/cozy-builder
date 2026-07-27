/**
 * Deterministic hash-based randomness.
 *
 * ## Why hashing and not a seeded stream
 *
 * Every repeated element in the world — fence posts, wall segments, grass
 * tufts, roof tiles, the exact tint of a patch of ground — gets a small random
 * wobble so a long run of identical pieces does not read as a copy-paste. That
 * variance must be:
 *
 *   1. **Stable.** The same tile looks the same after a reload, an export/import
 *      round-trip, or a re-render. Otherwise the village visibly reshuffles
 *      itself every time you open it.
 *   2. **Free of storage.** Variance is a pure function of a piece's identity,
 *      so it never enters the save file. `hashNoise(worldSeed, q, r, 'tilt')`
 *      recomputes it on demand.
 *   3. **Order-independent.** A sequential PRNG would give a tile a different
 *      value depending on how many tiles were drawn before it. Hashing the
 *      coordinates directly sidesteps that entirely.
 *
 * So: no streams, no global state. Hash the inputs, get the value.
 */

/** Mixes a 32-bit integer into a well-distributed 32-bit integer. */
function mix32(x: number): number {
  let h = x | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** FNV-1a over a string, used to fold string tags into the hash. */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Combine any number of integer inputs into one 32-bit hash. Order matters, so
 * `hashInts(1, 2) !== hashInts(2, 1)`.
 */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9
  for (const v of values) {
    h = (mix32(h ^ (v | 0)) + 0x9e3779b9) >>> 0
  }
  return mix32(h)
}

/**
 * The workhorse: a stable value in `[0, 1)` for a given seed, hex coordinate
 * and named channel.
 *
 * The `channel` tag is what lets one tile carry many independent wobbles —
 * `'tilt'`, `'hue'`, `'scale'` — without them correlating with each other.
 * Always pass a distinct channel per property, or a tile that is tall will
 * also always be dark.
 */
export function hashNoise(seed: number, q: number, r: number, channel: string): number {
  return hashInts(seed, q, r, hashString(channel)) / 0x100000000
}

/** {@link hashNoise} remapped to `[min, max)`. */
export function hashRange(
  seed: number,
  q: number,
  r: number,
  channel: string,
  min: number,
  max: number,
): number {
  return min + hashNoise(seed, q, r, channel) * (max - min)
}

/** A stable integer in `[0, count)` — for picking a variant from a set. */
export function hashPick(
  seed: number,
  q: number,
  r: number,
  channel: string,
  count: number,
): number {
  if (count <= 1) return 0
  return Math.min(count - 1, Math.floor(hashNoise(seed, q, r, channel) * count))
}

/** A stable element of `items`. */
export function hashChoice<T>(
  seed: number,
  q: number,
  r: number,
  channel: string,
  items: readonly T[],
): T {
  return items[hashPick(seed, q, r, channel, items.length)]
}

/** A stable boolean that is true with probability `p`. */
export function hashChance(
  seed: number,
  q: number,
  r: number,
  channel: string,
  p: number,
): boolean {
  return hashNoise(seed, q, r, channel) < p
}

/**
 * A stable signed wobble in `[-amount, +amount]`, the shape most visual jitter
 * wants (tilt a fence post, nudge a tree off-centre, vary a roof pitch).
 */
export function hashJitter(
  seed: number,
  q: number,
  r: number,
  channel: string,
  amount: number,
): number {
  return (hashNoise(seed, q, r, channel) * 2 - 1) * amount
}

// ---------------------------------------------------------------------------
// Sequential PRNG
// ---------------------------------------------------------------------------

/**
 * A small seeded stream, for the cases where hashing by coordinate does not
 * apply: terrain generation and agent behaviour.
 *
 * Agents are runtime-only and never serialized, so their randomness does not
 * need to be reproducible across sessions — but a seeded stream still keeps a
 * given session deterministic, which makes bugs reproducible.
 */
export interface Rng {
  /** Next value in `[0, 1)`. */
  next(): number
  /** Next value in `[min, max)`. */
  range(min: number, max: number): number
  /** Next integer in `[0, count)`. */
  int(count: number): number
  /** A random element. */
  pick<T>(items: readonly T[]): T
  /** True with probability `p`. */
  chance(p: number): boolean
}

/** Creates a mulberry32 stream — small, fast, and good enough for visuals. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (count) => Math.min(count - 1, Math.floor(next() * count)),
    pick: (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))],
    chance: (p) => next() < p,
  }
}

/** A fresh world seed, used when starting a new village. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
