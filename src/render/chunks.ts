/**
 * Chunked geometry baking.
 *
 * ## The problem
 *
 * Baking every piece into one big geometry (see `geometry/builder.ts`) gives
 * excellent frame times but terrible *edit* times: placing a single fence post
 * would rebuild the entire village. At a few hundred pieces that is tens of
 * milliseconds on every pointer-move of a drag, which feels like mud.
 *
 * ## The fix
 *
 * Split the world into fixed **chunks** of `CHUNK_SIZE`² hexes. Each chunk bakes
 * independently and is cached. When the world changes we recompute a cheap
 * signature per chunk and rebake only those whose signature moved — normally
 * one, occasionally two when the edit sits on a chunk seam.
 *
 * The signature is the subtle part. A chunk's appearance depends not only on
 * its own cells but on the pieces immediately *outside* its border, because
 * autoconnect makes a wall change shape when a neighbour appears. So for any
 * cell holding a connecting piece, the signature also folds in that cell's six
 * neighbours. Without this, building a wall up to a chunk boundary leaves a
 * stub pointing at nothing until something else forces a rebake.
 *
 * ## Output
 *
 * Each chunk yields up to two geometries and a list of animated props:
 *
 *   - `solid` — everything opaque, one draw call.
 *   - `water` — water tiles, drawn with a separate rippling material.
 *   - `props` — windmill sails, banner cloth, lamp glows: the handful of things
 *     that must move, and therefore cannot be baked. See `./AnimatedProps.tsx`.
 */

import type { BufferGeometry } from 'three'
import {
  HEX_SIZE,
  hexKey,
  hexToWorld,
  parseHexKey,
  type Hex,
} from '@/core/hex'
import { hashInts, hashNoise, hashString } from '@/core/rng'
import { computeConnectionMask } from '@/world/autoconnect'
import { COLORS, getPiece, terrainOrDefault } from '@/world/catalog'
import type { World } from '@/world/types'
import { MeshBuilder, tint } from './geometry/builder'
import { getRenderer, groundDetail } from './pieces'
import { makeVariance } from './pieces/context'
import { BANNER_COLORS } from './pieces/castle'

/** Hexes per chunk along each axial axis. */
export const CHUNK_SIZE = 6

/** How far the ground prisms extend below the surface. */
const GROUND_DEPTH = 0.7

/**
 * Slight oversize applied to ground tiles, as a multiple of the circumradius.
 *
 * Tiles tile exactly at 1.0; this covers floating-point error along shared
 * edges, which would otherwise show as flickering hairline cracks at glancing
 * camera angles.
 */
const TILE_OVERLAP = 1.0015

/** A thing that moves, and so is rendered as a real object rather than baked. */
export interface AnimatedProp {
  readonly kind: 'windmill' | 'banner' | 'lamp'
  /** Stable React key. */
  readonly key: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly rotationY: number
  readonly color: string
  /** Animation phase offset, so identical props never move in lockstep. */
  readonly phase: number
  readonly scale: number
}

export interface BakedChunk {
  readonly key: string
  /** Opaque geometry, or `null` when the chunk holds nothing. */
  readonly solid: BufferGeometry | null
  /** Water surfaces, drawn with the rippling material. */
  readonly water: BufferGeometry | null
  readonly props: AnimatedProp[]
  /** Signature this chunk was baked from, used for invalidation. */
  readonly signature: number
}

export function chunkCoordOf(h: Hex): { cq: number; cr: number } {
  return { cq: Math.floor(h.q / CHUNK_SIZE), cr: Math.floor(h.r / CHUNK_SIZE) }
}

export function chunkKey(cq: number, cr: number): string {
  return `${cq}:${cr}`
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/**
 * Group every occupied hex by chunk and compute each chunk's signature.
 *
 * Runs on every world change, so it stays deliberately cheap: one pass over the
 * terrain and piece maps, with the seven-neighbour lookup only for pieces that
 * actually autoconnect.
 */
export function computeChunkSignatures(world: World): Map<string, number> {
  const sigs = new Map<string, number>()

  const fold = (key: string, value: number): void => {
    // Order-independent accumulation: chunks must hash the same regardless of
    // the order object keys happen to come back in.
    sigs.set(key, ((sigs.get(key) ?? 0x9e3779b9) ^ value) >>> 0)
  }

  for (const [key, terrainId] of Object.entries(world.terrain)) {
    let coord: Hex
    try {
      coord = parseHexKey(key)
    } catch {
      continue
    }
    const { cq, cr } = chunkCoordOf(coord)
    fold(chunkKey(cq, cr), hashInts(coord.q, coord.r, hashString(terrainId)))
  }

  for (const [key, placed] of Object.entries(world.pieces)) {
    let coord: Hex
    try {
      coord = parseHexKey(key)
    } catch {
      continue
    }
    const { cq, cr } = chunkCoordOf(coord)
    const ck = chunkKey(cq, cr)

    fold(
      ck,
      hashInts(
        coord.q,
        coord.r,
        hashString(placed.piece),
        (placed.rotation ?? 0) + 1,
        (placed.variant ?? -1) + 2,
      ),
    )

    // Autoconnecting pieces also depend on their neighbours' identities, which
    // may live in an adjacent chunk.
    const def = getPiece(placed.piece)
    if (def?.connects) {
      fold(ck, hashInts(coord.q, coord.r, computeConnectionMask(world, coord), 0x5bf0));
    }
  }

  // The seed changes every decorative detail in the world.
  for (const key of sigs.keys()) {
    sigs.set(key, (sigs.get(key)! ^ hashInts(world.seed, 0xc0de)) >>> 0)
  }

  return sigs
}

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

/** Build the geometry for one chunk. */
export function bakeChunk(world: World, cq: number, cr: number, signature: number): BakedChunk {
  const solid = new MeshBuilder()
  const water = new MeshBuilder()
  const props: AnimatedProp[] = []

  const q0 = cq * CHUNK_SIZE
  const r0 = cr * CHUNK_SIZE

  for (let dq = 0; dq < CHUNK_SIZE; dq++) {
    for (let dr = 0; dr < CHUNK_SIZE; dr++) {
      const cell: Hex = { q: q0 + dq, r: r0 + dr }
      const key = hexKey(cell)
      const terrainId = world.terrain[key]
      if (!terrainId) continue

      const terrain = terrainOrDefault(terrainId)
      const { x, z } = hexToWorld(cell)
      const isWater = terrainId === 'water'
      const target = isWater ? water : solid

      bakeGroundTile(target, world, cell, x, z, terrain.color, terrain.elevation)

      const placed = world.pieces[key]
      if (!placed) {
        // Sprinkle grass on bare, walkable ground so open space isn't sterile.
        if ((terrainId === 'grass' || terrainId === 'meadow') && hashNoise(world.seed, cell.q, cell.r, 'tuftGate') < 0.5) {
          solid.push({ position: [x, terrain.elevation, z] })
          groundDetail(makeContext(solid, world, cell, terrain.elevation))
          solid.pop()
        }
        continue
      }

      const def = getPiece(placed.piece)
      if (!def) continue

      const ctx = makeContext(solid, world, cell, terrain.elevation, placed.piece)
      solid.push({ position: [x, terrain.elevation, z] })
      try {
        getRenderer(placed.piece)(ctx)
      } catch (err) {
        // One bad renderer must not blank the whole chunk.
        console.error(`[cozy-builder] Renderer for "${placed.piece}" failed at ${key}:`, err)
      }
      solid.pop()

      collectProps(props, world, cell, x, z, terrain.elevation, placed.piece, ctx.variant)
    }
  }

  return {
    key: chunkKey(cq, cr),
    solid: solid.isEmpty ? null : solid.toGeometry(),
    water: water.isEmpty ? null : water.toGeometry(),
    props,
    signature,
  }
}

/**
 * A ground tile: a hex prism with a tinted top.
 *
 * The prism extends well below the surface so the island rim reads as a solid
 * slab of earth rather than a paper-thin sheet, and each tile's colour is
 * nudged from the terrain's base so large areas of one terrain don't flatten
 * into a single block of colour.
 *
 * ## Seamlessness
 *
 * `radius` must be the **circumradius**, which is exactly `HEX_SIZE`: hex
 * centres sit `sqrt(3) * HEX_SIZE` apart and a hexagon of circumradius
 * `HEX_SIZE` has inradius `sqrt(3)/2 * HEX_SIZE`, so two neighbours meet
 * edge-to-edge with nothing left over. The tiny {@link TILE_OVERLAP} on top of
 * that is insurance against hairline cracks from floating-point error along
 * shared edges — at 0.15% of a tile it is invisible, including where two tiles
 * sit at different elevations.
 */
function bakeGroundTile(
  b: MeshBuilder,
  world: World,
  cell: Hex,
  x: number,
  z: number,
  baseColor: string,
  elevation: number,
): void {
  const hueShift = (hashNoise(world.seed, cell.q, cell.r, 'tileHue') - 0.5) * 0.02
  const lightShift = (hashNoise(world.seed, cell.q, cell.r, 'tileLight') - 0.5) * 0.075
  const top = tint(baseColor, hueShift, lightShift)

  const height = GROUND_DEPTH + elevation
  b.prism({
    radius: HEX_SIZE * TILE_OVERLAP,
    height,
    color: top,
    position: [x, elevation - height / 2, z],
  })
}

/** Builds the {@link PieceContext} for one hex. */
function makeContext(
  builder: MeshBuilder,
  world: World,
  cell: Hex,
  groundY: number,
  pieceId?: string,
) {
  const placed = pieceId ? world.pieces[hexKey(cell)] : undefined
  const def = pieceId ? getPiece(pieceId) : undefined
  const variance = makeVariance(world.seed, cell)

  const variantCount = def?.variants ?? 1
  const variant =
    placed?.variant !== undefined
      ? placed.variant % Math.max(1, variantCount)
      : variance.index('variant', variantCount)

  return {
    builder,
    world,
    hex: cell,
    placed: placed ?? { piece: pieceId ?? '' },
    // A synthetic definition keeps ground-detail calls (which have no piece)
    // from needing a separate, nearly identical context type.
    def: def ?? { id: '', name: '', description: '', category: 'nature' as const, icon: '', height: 0 },
    mask: def?.connects ? computeConnectionMask(world, cell) : 0,
    variant,
    rotationY: def?.rotatable ? ((placed?.rotation ?? 0) * Math.PI) / 3 : 0,
    groundY,
    ...variance,
  }
}

/**
 * Record the animated attachments for a piece.
 *
 * Kept as data rather than as part of the piece renderer so the baked geometry
 * stays a single static buffer. The renderer draws the windmill; this notes
 * where its sails go.
 */
function collectProps(
  out: AnimatedProp[],
  world: World,
  cell: Hex,
  x: number,
  z: number,
  groundY: number,
  pieceId: string,
  variant: number,
): void {
  const key = hexKey(cell)
  const phase = hashNoise(world.seed, cell.q, cell.r, 'phase') * Math.PI * 2
  const placed = world.pieces[key]

  switch (pieceId) {
    case 'windmill': {
      const rotation = ((placed?.rotation ?? 0) * Math.PI) / 3
      out.push({
        kind: 'windmill',
        key,
        // Sails mount on the +X face of the cap, just under the roof.
        x: x + Math.cos(rotation) * 0.42,
        y: groundY + 1.72,
        z: z - Math.sin(rotation) * 0.42,
        rotationY: rotation,
        color: COLORS.woodLight,
        phase,
        scale: 1,
      })
      break
    }
    case 'banner': {
      out.push({
        kind: 'banner',
        key,
        x: x + (hashNoise(world.seed, cell.q, cell.r, 'x') * 2 - 1) * 0.12,
        y: groundY + 1.28,
        z: z + (hashNoise(world.seed, cell.q, cell.r, 'z') * 2 - 1) * 0.12,
        rotationY: hashNoise(world.seed, cell.q, cell.r, 'bannerSpin') * Math.PI * 2,
        color: BANNER_COLORS[variant % BANNER_COLORS.length],
        phase,
        scale: 1,
      })
      break
    }
    case 'lamp': {
      const height = 1.5 + hashNoise(world.seed, cell.q, cell.r, 'h') * 0.25
      out.push({
        kind: 'lamp',
        key,
        x: x + (hashNoise(world.seed, cell.q, cell.r, 'x') * 2 - 1) * 0.1,
        y: groundY + height + 0.24,
        z: z + (hashNoise(world.seed, cell.q, cell.r, 'z') * 2 - 1) * 0.1,
        rotationY: 0,
        color: '#ffe9b0',
        phase,
        scale: 1,
      })
      break
    }
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Incremental chunk cache.
 *
 * Holds baked chunks between world updates and disposes the GPU buffers of
 * chunks that change or disappear. Forgetting the dispose is a slow leak that
 * only shows up after a long build session, so it is centralised here rather
 * than left to callers.
 */
export class ChunkCache {
  private chunks = new Map<string, BakedChunk>()

  /** Rebake whatever changed and return the current full set of chunks. */
  update(world: World): BakedChunk[] {
    const signatures = computeChunkSignatures(world)

    // Drop chunks that no longer contain anything.
    for (const [key, chunk] of this.chunks) {
      if (!signatures.has(key)) {
        disposeChunk(chunk)
        this.chunks.delete(key)
      }
    }

    for (const [key, signature] of signatures) {
      const existing = this.chunks.get(key)
      if (existing && existing.signature === signature) continue

      if (existing) disposeChunk(existing)
      const [cq, cr] = key.split(':').map(Number)
      this.chunks.set(key, bakeChunk(world, cq, cr, signature))
    }

    return [...this.chunks.values()]
  }

  /** How many chunks are currently baked. Used by the debug overlay. */
  get size(): number {
    return this.chunks.size
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) disposeChunk(chunk)
    this.chunks.clear()
  }
}

function disposeChunk(chunk: BakedChunk): void {
  chunk.solid?.dispose()
  chunk.water?.dispose()
}
