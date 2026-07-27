/**
 * Hex grid math — pointy-top, axial coordinates.
 *
 * ## Conventions (read this before touching anything spatial)
 *
 * We use **pointy-top** hexagons addressed by **axial** coordinates `{ q, r }`.
 * The implicit third cube coordinate is `s = -q - r`.
 *
 * Pointy-top means a vertex points "up" (toward -Z) and the hex has flat
 * left/right edges, so every hex has a true East and West neighbour. Roads and
 * walls therefore read as natural horizontal runs on screen, which matters a
 * lot for how the autoconnect system looks.
 *
 * World-space mapping (three.js right-handed Y-up):
 *   +X = east,  -Z = north,  +Y = up.
 * The hex grid lives on the XZ plane; Y is elevation only.
 *
 *   width  (east-west, flat-to-flat)   = sqrt(3) * size
 *   height (north-south, point-to-point) = 2 * size
 *
 * where `size` is the circumradius (centre to vertex).
 *
 * Direction indices are fixed and used as bit positions by the autoconnect
 * system (`src/world/autoconnect.ts`), so **do not reorder them**:
 *
 *   0 = E, 1 = NE, 2 = NW, 3 = W, 4 = SW, 5 = SE
 *
 * They proceed counter-clockwise on screen starting from East.
 *
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

/** Axial hex coordinate. `s` is implicit: `s = -q - r`. */
export interface Hex {
  readonly q: number
  readonly r: number
}

/** A point on the XZ ground plane. */
export interface Point2 {
  readonly x: number
  readonly z: number
}

/**
 * Circumradius of one hex in world units. Everything spatial derives from this
 * constant, so changing it rescales the whole world coherently.
 */
export const HEX_SIZE = 1

/** East-west flat-to-flat distance. */
export const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE
/** North-south point-to-point distance. */
export const HEX_HEIGHT = 2 * HEX_SIZE

const SQRT3 = Math.sqrt(3)

/**
 * Neighbour offsets in axial space, indexed by direction.
 * Index order is load-bearing — see the module docblock.
 */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, // 0 E
  { q: 1, r: -1 }, // 1 NE
  { q: 0, r: -1 }, // 2 NW
  { q: -1, r: 0 }, // 3 W
  { q: -1, r: 1 }, // 4 SW
  { q: 0, r: 1 }, // 5 SE
]

/** Human-readable names, parallel to {@link HEX_DIRECTIONS}. */
export const HEX_DIRECTION_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const

export type HexDirection = 0 | 1 | 2 | 3 | 4 | 5

/**
 * World-space heading of each direction, in radians, measured as a three.js
 * Y-rotation. A mesh authored facing +X (east) and rotated by
 * `HEX_DIRECTION_ANGLES[d]` ends up facing direction `d`.
 *
 * Y-rotation is counter-clockwise when viewed from above (+Y looking down),
 * which on our map (with -Z as north) turns +X toward -Z. Since our directions
 * also run counter-clockwise from East, this is simply `d * 60°`.
 */
export const HEX_DIRECTION_ANGLES: readonly number[] = HEX_DIRECTIONS.map(
  (_, i) => (i * Math.PI) / 3,
)

/**
 * Unit vector pointing along direction `d` on the XZ plane, as `[x, z]`.
 *
 * Consistent with {@link HEX_DIRECTION_ANGLES}: a three.js Y-rotation of θ maps
 * +X to `(cos θ, −sin θ)`, so the z component is negated. Renderers use this to
 * aim wall segments and path spokes at their connected neighbours.
 */
export const HEX_DIRECTION_VECTORS: readonly [number, number][] = HEX_DIRECTION_ANGLES.map(
  (angle) => [Math.cos(angle), -Math.sin(angle)] as [number, number],
)

export function directionVector(d: HexDirection): [number, number] {
  return HEX_DIRECTION_VECTORS[d]
}

export const ORIGIN: Hex = { q: 0, r: 0 }

export function hex(q: number, r: number): Hex {
  return { q, r }
}

/** The implicit cube coordinate. */
export function hexS(a: Hex): number {
  return -a.q - a.r
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function hexSubtract(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r }
}

export function hexScale(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k }
}

/** The neighbour of `a` in direction `d`. */
export function hexNeighbor(a: Hex, d: HexDirection): Hex {
  const dir = HEX_DIRECTIONS[d]
  return { q: a.q + dir.q, r: a.r + dir.r }
}

/** All six neighbours, in direction order. */
export function hexNeighbors(a: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }))
}

/** Number of grid steps between two hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  const ds = hexS(a) - hexS(b)
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

/**
 * The direction from `a` to an adjacent hex `b`, or `null` if they are not
 * neighbours. Used by the autoconnect system to work out which edge two
 * touching pieces share.
 */
export function hexDirectionBetween(a: Hex, b: Hex): HexDirection | null {
  const dq = b.q - a.q
  const dr = b.r - a.r
  for (let i = 0; i < 6; i++) {
    const d = HEX_DIRECTIONS[i]
    if (d.q === dq && d.r === dr) return i as HexDirection
  }
  return null
}

/** The direction facing the opposite way. */
export function oppositeDirection(d: HexDirection): HexDirection {
  return ((d + 3) % 6) as HexDirection
}

// ---------------------------------------------------------------------------
// World-space conversion
// ---------------------------------------------------------------------------

/** Centre of a hex on the XZ ground plane. */
export function hexToWorld(a: Hex, size = HEX_SIZE): Point2 {
  return {
    x: size * (SQRT3 * a.q + (SQRT3 / 2) * a.r),
    z: size * (1.5 * a.r),
  }
}

/**
 * The hex containing a point on the ground plane. Combines the inverse of
 * {@link hexToWorld} with cube rounding, so it is exact on hex boundaries.
 */
export function worldToHex(p: Point2, size = HEX_SIZE): Hex {
  const q = ((SQRT3 / 3) * p.x - (1 / 3) * p.z) / size
  const r = ((2 / 3) * p.z) / size
  return hexRound(q, r)
}

/**
 * Round fractional axial coordinates to the nearest hex.
 *
 * Rounds in cube space and then repairs the `q + r + s = 0` constraint by
 * discarding whichever component moved furthest — this is what makes the
 * result correct near edges and corners, where naive rounding picks the wrong
 * hex.
 */
export function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)

  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)

  if (dq > dr && dq > ds) {
    q = -r - s
  } else if (dr > ds) {
    r = -q - s
  }
  // else: s is the odd one out, and s is derived — nothing to fix.

  // Normalise -0 so that keys and equality behave.
  return { q: q + 0, r: r + 0 }
}

/**
 * The six corners of a hex on the ground plane, counter-clockwise. Corner `i`
 * sits at 60·i − 30 degrees, which puts vertices at the north and south poles
 * (pointy-top) and flat edges facing east and west.
 */
export function hexCorners(a: Hex, size = HEX_SIZE): Point2[] {
  const c = hexToWorld(a, size)
  const out: Point2[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    out.push({ x: c.x + size * Math.cos(angle), z: c.z + size * Math.sin(angle) })
  }
  return out
}

/**
 * Midpoint of the edge shared with the neighbour in direction `d`. Wall and
 * fence pieces are drawn on these midpoints rather than at hex centres.
 */
export function hexEdgeMidpoint(a: Hex, d: HexDirection, size = HEX_SIZE): Point2 {
  const c = hexToWorld(a, size)
  const n = hexToWorld(hexNeighbor(a, d), size)
  return { x: (c.x + n.x) / 2, z: (c.z + n.z) / 2 }
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/** The `radius`-step ring around `centre`. `radius === 0` yields `[centre]`. */
export function hexRing(centre: Hex, radius: number): Hex[] {
  if (radius <= 0) return [centre]
  const results: Hex[] = []
  // Start on the SW spoke so the ring walks counter-clockwise from the west.
  let current = hexAdd(centre, hexScale(HEX_DIRECTIONS[4], radius))
  for (let d = 0; d < 6; d++) {
    for (let step = 0; step < radius; step++) {
      results.push(current)
      current = hexNeighbor(current, d as HexDirection)
    }
  }
  return results
}

/** Every hex within `radius` steps of `centre`, centre first. */
export function hexSpiral(centre: Hex, radius: number): Hex[] {
  const results: Hex[] = [centre]
  for (let k = 1; k <= radius; k++) results.push(...hexRing(centre, k))
  return results
}

/** Every hex within `radius` steps of `centre`, unordered. */
export function hexRange(centre: Hex, radius: number): Hex[] {
  const results: Hex[] = []
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius)
    const hi = Math.min(radius, -dq + radius)
    for (let dr = lo; dr <= hi; dr++) {
      results.push({ q: centre.q + dq, r: centre.r + dr })
    }
  }
  return results
}

/**
 * Every hex on the straight line from `a` to `b`, inclusive. Used for drag
 * painting, so a fast mouse sweep still fills a continuous run of tiles
 * instead of leaving gaps where no pointer event landed.
 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b)
  if (n === 0) return [a]
  const results: Hex[] = []
  // Nudge off exact hex boundaries so rounding never lands ambiguously.
  const epsQ = 1e-6
  const epsR = 1e-6
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const qf = a.q + (b.q - a.q) * t + epsQ
    const rf = a.r + (b.r - a.r) * t + epsR
    results.push(hexRound(qf, rf))
  }
  return results
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Canonical string key for map/set storage and for the save format.
 *
 * The format is `"q,r"` and it is **part of the serialized world file**, so
 * changing it is a breaking format change requiring a schema migration.
 */
export function hexKey(a: Hex): string {
  return `${a.q},${a.r}`
}

export function parseHexKey(key: string): Hex {
  const comma = key.indexOf(',')
  if (comma < 0) throw new Error(`Malformed hex key: ${JSON.stringify(key)}`)
  const q = Number(key.slice(0, comma))
  const r = Number(key.slice(comma + 1))
  if (!Number.isFinite(q) || !Number.isFinite(r)) {
    throw new Error(`Malformed hex key: ${JSON.stringify(key)}`)
  }
  return { q, r }
}

/**
 * A stable key for the edge between two adjacent hexes, identical from either
 * side. Edge-mounted pieces (walls, fences) use this so the same physical edge
 * is never stored twice.
 */
export function edgeKey(a: Hex, d: HexDirection): string {
  const b = hexNeighbor(a, d)
  // Order the pair deterministically so both hexes agree on the key.
  const aFirst = a.q < b.q || (a.q === b.q && a.r < b.r)
  const [lo, hi] = aFirst ? [a, b] : [b, a]
  return `${lo.q},${lo.r}|${hi.q},${hi.r}`
}
