/**
 * Procedural island generation — the blank canvas a new village starts on.
 *
 * The goal is not a realistic landmass. It is a small, legible island that
 * *invites building*: mostly flat buildable ground, a readable shoreline, a
 * pond or two for interest, and a scatter of trees and rocks so the world does
 * not open empty. Anything more dramatic competes with what the player builds.
 *
 * Everything here is a pure function of the seed, so a given seed always
 * produces the same island — which is what makes the sample villages below
 * reproducible without shipping large JSON fixtures.
 */

import { hexDistance, hexKey, hexRange, hexToWorld, ORIGIN, type Hex } from '@/core/hex'
import { hashInts, hashNoise, makeRng } from '@/core/rng'
import type { PlacedPiece, TerrainId, World } from './types'

/** Radius of a starting island, in hexes. */
export const DEFAULT_ISLAND_RADIUS = 13

export interface GenerateOptions {
  seed: number
  name: string
  radius?: number
  /** Whether to scatter starting trees, rocks and flowers. */
  decorate?: boolean
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** Hash a lattice point to `[0, 1)`. */
function latticeValue(seed: number, xi: number, yi: number): number {
  return hashInts(seed, xi, yi) / 0x100000000
}

/** Smoothstep, so interpolated noise has no visible lattice creases. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Bilinearly interpolated value noise over the continuous plane. */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const tx = smooth(x - xi)
  const ty = smooth(y - yi)

  const v00 = latticeValue(seed, xi, yi)
  const v10 = latticeValue(seed, xi + 1, yi)
  const v01 = latticeValue(seed, xi, yi + 1)
  const v11 = latticeValue(seed, xi + 1, yi + 1)

  const top = v00 + (v10 - v00) * tx
  const bottom = v01 + (v11 - v01) * tx
  return top + (bottom - top) * ty
}

/** Summed octaves of {@link valueNoise}, normalised to `[0, 1]`. */
export function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let total = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(seed + i * 7919, x * frequency, y * frequency) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total / norm
}

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

/**
 * Build a fresh island.
 *
 * The shape comes from `noise - falloff`: fBm gives the coastline its wobble,
 * and a radial falloff guarantees the island closes rather than running off to
 * the edge of the grid. Anything below the water line simply isn't in the
 * terrain map at all, so the world has a real boundary instead of an infinite
 * plane of nothing.
 */
export function generateIsland(options: GenerateOptions): World {
  const { seed, name, radius = DEFAULT_ISLAND_RADIUS, decorate = true } = options

  const terrain: Record<string, TerrainId> = {}
  const pieces: Record<string, PlacedPiece> = {}

  const cells = hexRange(ORIGIN, radius + 1)

  for (const cell of cells) {
    const world2d = hexToWorld(cell)
    const nx = world2d.x * 0.075
    const nz = world2d.z * 0.075

    const dist = hexDistance(cell, ORIGIN) / radius
    // Flat in the middle, then falls away hard near the rim. The exponent
    // keeps the interior generously buildable instead of doming it.
    const falloff = Math.pow(Math.max(0, dist), 2.4)
    const height = fbm(seed, nx, nz, 3) * 0.9 + 0.28 - falloff

    if (height <= 0.16) continue // sea — leave the hex out of the world entirely

    let type: TerrainId
    if (height < 0.24) {
      type = 'sand' // beach ring just above the water line
    } else {
      // Inland ponds: a second, independent noise field carves water out of
      // the interior so lakes aren't just an artefact of the coastline.
      const wet = fbm(seed ^ 0x5bf03635, nx * 1.7 + 11, nz * 1.7 - 7, 2)
      if (wet > 0.74 && dist < 0.82) {
        type = 'water'
      } else if (wet > 0.7 && dist < 0.85) {
        type = 'sand' // shore around each pond
      } else {
        const meadowNoise = fbm(seed ^ 0x1b873593, nx * 2.3 - 5, nz * 2.3 + 3, 2)
        type = meadowNoise > 0.62 ? 'meadow' : 'grass'
      }
    }
    terrain[hexKey(cell)] = type
  }

  if (decorate) scatterNature(terrain, pieces, seed, radius)

  return { version: 1, name, seed, terrain, pieces }
}

/**
 * Scatter starting trees, rocks and flowers.
 *
 * Density is driven by a low-frequency noise field rather than a flat
 * probability, so trees clump into little woods and leave open glades — which
 * looks intentional, where uniform scattering looks like static.
 */
function scatterNature(
  terrain: Record<string, TerrainId>,
  pieces: Record<string, PlacedPiece>,
  seed: number,
  radius: number,
): void {
  for (const [key, type] of Object.entries(terrain)) {
    if (type === 'water' || type === 'sand') continue

    const [q, r] = key.split(',').map(Number)
    const world2d = hexToWorld({ q, r })
    const forest = fbm(seed ^ 0x27d4eb2f, world2d.x * 0.11 + 31, world2d.z * 0.11 - 17, 2)

    // Keep the middle of the island clear so there's somewhere to start.
    const centerBias = Math.min(1, hexDistance({ q, r }, ORIGIN) / (radius * 0.45))
    const density = forest * centerBias

    const roll = hashNoise(seed, q, r, 'scatter')

    if (density > 0.55 && roll < 0.62) {
      pieces[key] = { piece: hashNoise(seed, q, r, 'treekind') > 0.55 ? 'tree_pine' : 'tree_round' }
    } else if (density > 0.4 && roll < 0.16) {
      pieces[key] = { piece: 'bush' }
    } else if (roll > 0.965) {
      pieces[key] = { piece: 'rock' }
    } else if (type === 'meadow' && roll > 0.9) {
      pieces[key] = { piece: 'flowers' }
    }
  }
}

/** An empty world, for tests and for "clear everything". */
export function emptyWorld(name = 'Empty', seed = 1): World {
  return { version: 1, name, seed, terrain: {}, pieces: {} }
}

/** A flat disc of grass with no decoration — a clean slate to build on. */
export function flatWorld(name = 'Flat', seed = 1, radius = DEFAULT_ISLAND_RADIUS): World {
  const terrain: Record<string, TerrainId> = {}
  for (const cell of hexRange(ORIGIN, radius)) terrain[hexKey(cell)] = 'grass'
  return { version: 1, name, seed, terrain, pieces: {} }
}

// ---------------------------------------------------------------------------
// Village composition helpers
// ---------------------------------------------------------------------------

/**
 * Small building blocks used by the sample villages in `./examples.ts`.
 *
 * These mutate plain records rather than returning new worlds — they run once,
 * at composition time, where the immutability the store relies on is not yet
 * relevant and would only add noise.
 */
export interface Draft {
  terrain: Record<string, TerrainId>
  pieces: Record<string, PlacedPiece>
  seed: number
}

export function draftFrom(world: World): Draft {
  return { terrain: { ...world.terrain }, pieces: { ...world.pieces }, seed: world.seed }
}

export function finishDraft(draft: Draft, name: string): World {
  return {
    version: 1,
    name,
    seed: draft.seed,
    terrain: draft.terrain,
    pieces: draft.pieces,
  }
}

/** Place a piece, adding ground beneath it if the hex is bare. */
export function put(
  draft: Draft,
  at: Hex,
  piece: string,
  opts: { rotation?: number; under?: TerrainId } = {},
): void {
  const key = hexKey(at)
  if (opts.under) draft.terrain[key] = opts.under
  else if (!draft.terrain[key]) draft.terrain[key] = 'grass'
  draft.pieces[key] = {
    piece,
    ...(opts.rotation !== undefined ? { rotation: (opts.rotation % 6) as PlacedPiece['rotation'] } : {}),
  }
}

/** Clear whatever is built on a hex, leaving the ground. */
export function clearPiece(draft: Draft, at: Hex): void {
  delete draft.pieces[hexKey(at)]
}

export function paint(draft: Draft, at: Hex, terrain: TerrainId): void {
  draft.terrain[hexKey(at)] = terrain
}

/** Walk a run of hexes, laying the same piece along it. */
export function putLine(draft: Draft, cells: Hex[], piece: string, under?: TerrainId): void {
  for (const cell of cells) put(draft, cell, piece, under ? { under } : {})
}

/** Fill a hex disc with a piece, optionally leaving a hollow centre. */
export function putDisc(
  draft: Draft,
  centre: Hex,
  radius: number,
  piece: string,
  opts: { innerRadius?: number; chance?: number; seed?: number; under?: TerrainId } = {},
): void {
  const inner = opts.innerRadius ?? -1
  const rng = makeRng(opts.seed ?? draft.seed)
  for (const cell of hexRange(centre, radius)) {
    const d = hexDistance(cell, centre)
    if (d <= inner) continue
    if (opts.chance !== undefined && !rng.chance(opts.chance)) continue
    put(draft, cell, piece, opts.under ? { under: opts.under } : {})
  }
}
