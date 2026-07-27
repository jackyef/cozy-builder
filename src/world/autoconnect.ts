/**
 * Autoconnect — how neighbouring pieces decide to join up.
 *
 * ## The model
 *
 * Every piece occupies a whole hex. For a piece that belongs to a *connection
 * group* (walls, fences, paths, fields, water), we compute a **6-bit mask** of
 * which of its six neighbours it links to. Bit `d` is set when the neighbour in
 * direction `d` is a piece this one connects to.
 *
 * Renderers then draw a hub plus one outward stub per set bit. That single rule
 * covers every shape a player can build — dead ends, straights, corners, tees,
 * crossroads, full six-way junctions — without authoring 64 variants or
 * classifying tiles by hand. A wall that turns a corner is not a "corner wall
 * piece"; it is a wall hub with two stubs that happen to be 120° apart.
 *
 * This is why the direction indices in `src/core/hex.ts` must never be
 * reordered: they are bit positions.
 *
 * ## Why this over marching-squares-style variant tables
 *
 * The classic alternative is to enumerate neighbour configurations and map each
 * to a pre-authored mesh (for 6 neighbours that is 64 raw cases, 14 up to
 * rotation). That needs 14 hand-made meshes per connecting piece type, and each
 * new piece type multiplies the work. Generating geometry from the mask instead
 * means one renderer per piece type, and adding a new wall style is one entry
 * in the catalog.
 *
 * ## Connection rules
 *
 * Two adjacent pieces connect when the link is mutual: A's `connectsTo`
 * includes B's group *and* B's `connectsTo` includes A's group. Mutuality is
 * what stops a fence from visibly grabbing onto a castle wall that has no
 * matching stub to meet it. `connectsTo` defaults to the piece's own group, so
 * the common case — fences join fences — needs no configuration.
 */

import { HEX_DIRECTIONS, hexKey, type Hex, type HexDirection } from '@/core/hex'
import { getPiece } from './catalog'
import type { PieceDefinition, World } from './types'

/** A 6-bit field; bit `d` means "connected in direction `d`". */
export type ConnectionMask = number

export const NO_CONNECTIONS: ConnectionMask = 0
export const ALL_CONNECTIONS: ConnectionMask = 0b111111

/** Whether `mask` links in direction `d`. */
export function hasConnection(mask: ConnectionMask, d: HexDirection): boolean {
  return (mask & (1 << d)) !== 0
}

/** `mask` with direction `d` set. */
export function withConnection(mask: ConnectionMask, d: HexDirection): ConnectionMask {
  return mask | (1 << d)
}

/** How many of the six directions are connected. */
export function connectionCount(mask: ConnectionMask): number {
  let n = 0
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) n++
  return n
}

/** The connected directions, ascending. */
export function connectedDirections(mask: ConnectionMask): HexDirection[] {
  const out: HexDirection[] = []
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) out.push(d as HexDirection)
  return out
}

/**
 * Whether two piece definitions link when placed side by side.
 *
 * Requires the relationship to be mutual — see the module docblock.
 */
export function piecesConnect(a: PieceDefinition, b: PieceDefinition): boolean {
  if (!a.connects || !b.connects) return false
  const aAccepts = a.connectsTo ?? [a.connects]
  const bAccepts = b.connectsTo ?? [b.connects]
  return aAccepts.includes(b.connects) && bAccepts.includes(a.connects)
}

/**
 * The connection mask for the piece at `at`.
 *
 * Returns `NO_CONNECTIONS` when the hex is empty or holds a piece that does not
 * belong to a connection group.
 */
export function computeConnectionMask(world: World, at: Hex): ConnectionMask {
  const self = world.pieces[hexKey(at)]
  if (!self) return NO_CONNECTIONS
  const selfDef = getPiece(self.piece)
  if (!selfDef?.connects) return NO_CONNECTIONS

  let mask = NO_CONNECTIONS
  for (let d = 0; d < 6; d++) {
    const dir = HEX_DIRECTIONS[d]
    const neighbor = world.pieces[hexKey({ q: at.q + dir.q, r: at.r + dir.r })]
    if (!neighbor) continue
    const neighborDef = getPiece(neighbor.piece)
    if (!neighborDef) continue
    if (piecesConnect(selfDef, neighborDef)) mask |= 1 << d
  }
  return mask
}

/**
 * Shape classification of a mask. Renderers use this to pick a silhouette —
 * a wall `'end'` gets a capped post, a `'junction'` gets a tower — while still
 * placing individual stubs from the raw mask.
 */
export type ConnectionShape =
  | 'isolated' // no neighbours: a standalone post or block
  | 'end' // one neighbour: a dead end that wants a cap
  | 'straight' // two opposite neighbours
  | 'bend' // two non-opposite neighbours
  | 'junction' // three or more neighbours

export function classifyConnections(mask: ConnectionMask): ConnectionShape {
  const dirs = connectedDirections(mask)
  switch (dirs.length) {
    case 0:
      return 'isolated'
    case 1:
      return 'end'
    case 2:
      return (dirs[1] - dirs[0]) % 3 === 0 ? 'straight' : 'bend'
    default:
      return 'junction'
  }
}

/**
 * A representative heading for the piece as a whole, in radians (three.js Y
 * rotation). Used to orient a body that should face along the run — a gatehouse
 * spanning a wall, a bridge crossing a river.
 *
 * Averaging direction vectors rather than the raw indices keeps this correct
 * across the 5→0 wraparound.
 */
export function connectionHeading(mask: ConnectionMask): number {
  const dirs = connectedDirections(mask)
  if (dirs.length === 0) return 0
  let x = 0
  let y = 0
  for (const d of dirs) {
    // Directions run counter-clockwise from east at 60° steps.
    const angle = (d * Math.PI) / 3
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  // A straight run averages to zero; fall back to the axis of the first stub.
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return (dirs[0] * Math.PI) / 3
  return Math.atan2(y, x)
}

/**
 * Canonical form of a mask under rotation.
 *
 * Returns the numerically smallest of the mask's six rotations, together with
 * the rotation that maps that canonical form **back onto the original**:
 *
 * ```ts
 * const { canonical, rotation } = canonicalMask(mask)
 * rotateMask(canonical, rotation) === mask          // always true
 * ```
 *
 * That direction is deliberate — it is the one a renderer needs. Given a mesh
 * authored for the canonical shape, `rotation * 60°` is how far to turn it to
 * match this tile. Returning the inverse would read more naturally as "how far
 * we rotated to canonicalise", and would be wrong at every call site.
 *
 * Not needed for the stub-based rendering this project uses, but it is what you
 * would key a mesh cache or a pre-authored variant table on, and it exposes the
 * structure that reduces all 64 masks to 14 shapes up to rotation.
 */
export function canonicalMask(mask: ConnectionMask): { canonical: ConnectionMask; rotation: number } {
  let best = mask
  let appliedRotation = 0
  for (let k = 1; k < 6; k++) {
    const rotated = rotateMask(mask, k)
    if (rotated < best) {
      best = rotated
      appliedRotation = k
    }
  }
  // `best === rotateMask(mask, appliedRotation)`, so undoing it takes the
  // complementary turn.
  return { canonical: best, rotation: (6 - appliedRotation) % 6 }
}

/** Rotate a mask by `k` sixths of a turn (counter-clockwise). */
export function rotateMask(mask: ConnectionMask, k: number): ConnectionMask {
  const shift = ((k % 6) + 6) % 6
  return ((mask << shift) | (mask >> (6 - shift))) & ALL_CONNECTIONS
}

/**
 * Every hex whose rendered appearance depends on the piece at `at` — the hex
 * itself plus its six neighbours.
 *
 * Placing or removing a piece changes how its neighbours draw themselves, so
 * this is the invalidation set the renderer must refresh. Getting it wrong
 * shows up as a wall stub pointing at nothing after an erase.
 */
export function connectionDirtySet(at: Hex): Hex[] {
  const out: Hex[] = [at]
  for (const d of HEX_DIRECTIONS) out.push({ q: at.q + d.q, r: at.r + d.r })
  return out
}
