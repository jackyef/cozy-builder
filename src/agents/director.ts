/**
 * The agent director — decides *who lives here*.
 *
 * ## The core idea
 *
 * Villagers, guards, farmers and animals are **never stored in the save file**.
 * The director derives the entire population from the pieces that are present,
 * every time the world loads or changes. A village with three market stalls is
 * busier than one with a single stall because the stalls say so, not because
 * somebody placed the shoppers.
 *
 * This is what makes the world feel alive "for free": you build a barn and
 * chickens appear, you knock it down and they leave. There is nothing to
 * manage, nothing to serialize, and no way for the population to drift out of
 * sync with the buildings.
 *
 * ## How the counts work
 *
 * Every catalog entry may declare {@link AgentSpawnRule}s: a kind, a fractional
 * `count`, a roaming `radius` and a behaviour. The director sums the fractions
 * per kind and materialises one agent each time the running total crosses an
 * integer, anchoring it to whichever piece pushed it over. Fractional counts are
 * the mechanism that stops a single cottage from spawning a crowd while still
 * letting a street of ten cottages fill up naturally.
 *
 * Results are capped — see {@link MAX_AGENTS} — because a very large village
 * would otherwise plan thousands of agents and spend the whole frame budget on
 * them.
 */

import {
  hexDistance,
  hexKey,
  hexNeighbors,
  hexRange,
  parseHexKey,
  type Hex,
} from '@/core/hex'
import { makeRng, type Rng } from '@/core/rng'
import { PIECES, TERRAIN, getPiece, pieceBlocksMovement, terrainOrDefault } from '@/world/catalog'
import type { AgentKind, AgentSpawnRule, World } from '@/world/types'

/** Hard ceiling on simultaneous agents, for frame budget. */
export const MAX_AGENTS = 220

/** Per-kind ceiling, so one enormous farm can't crowd out everything else. */
export const MAX_PER_KIND = 40

export type AgentBehavior = AgentSpawnRule['behavior']

/** A planned inhabitant: what to spawn, where it belongs, and how it acts. */
export interface AgentSpec {
  /** Stable across replans, so an agent keeps its identity as the world changes. */
  readonly id: string
  readonly kind: AgentKind
  /** The piece this agent belongs to; it roams around here. */
  readonly home: Hex
  readonly radius: number
  readonly behavior: AgentBehavior
  /**
   * Height above the ground the agent walks at. Non-zero for guards, who
   * patrol along the top of castle walls.
   */
  readonly elevation: number
}

/**
 * Where agents may walk.
 *
 * Precomputed once per world change and shared by every agent, since testing
 * "can I stand here" happens constantly during simulation.
 */
export interface WalkGrid {
  /** Keys of hexes that can be stood on at ground level. */
  readonly walkable: ReadonlySet<string>
  /** Keys of hexes carrying a wall-network piece, walkable at elevation. */
  readonly ramparts: ReadonlySet<string>
  /** Ground surface height by hex key. */
  readonly elevation: ReadonlyMap<string, number>
  isWalkable(h: Hex): boolean
  isRampart(h: Hex): boolean
  groundY(h: Hex): number
}

/** Pieces whose tops guards patrol along. */
const RAMPART_PIECES = new Set(['castle_wall', 'tower', 'gate'])

/** Build the walkability grid for a world. */
export function buildWalkGrid(world: World): WalkGrid {
  const walkable = new Set<string>()
  const ramparts = new Set<string>()
  const elevation = new Map<string, number>()

  for (const [key, terrainId] of Object.entries(world.terrain)) {
    const terrain = TERRAIN[terrainId] ?? terrainOrDefault(terrainId)
    elevation.set(key, terrain.elevation)
    if (!terrain.walkable) continue

    const placed = world.pieces[key]
    if (placed) {
      const def = getPiece(placed.piece)
      if (def && RAMPART_PIECES.has(def.id)) ramparts.add(key)
      if (def && pieceBlocksMovement(def)) continue
    }
    walkable.add(key)
  }

  return {
    walkable,
    ramparts,
    elevation,
    isWalkable: (h) => walkable.has(hexKey(h)),
    isRampart: (h) => ramparts.has(hexKey(h)),
    groundY: (h) => elevation.get(hexKey(h)) ?? 0,
  }
}

/**
 * Plan the population for a world.
 *
 * Deterministic: the same world always yields the same roster, so reloading a
 * village doesn't reshuffle who lives in it. Iteration is over sorted keys
 * because object key order is not something to build behaviour on.
 */
export function planAgents(world: World): AgentSpec[] {
  interface Contribution {
    hex: Hex
    key: string
    rule: AgentSpawnRule
  }

  const byKind = new Map<AgentKind, Contribution[]>()

  const addRules = (key: string, hex: Hex, rules: readonly AgentSpawnRule[] | undefined): void => {
    if (!rules) return
    for (const rule of rules) {
      let list = byKind.get(rule.kind)
      if (!list) {
        list = []
        byKind.set(rule.kind, list)
      }
      list.push({ hex, key, rule })
    }
  }

  for (const key of Object.keys(world.pieces).sort()) {
    let hex: Hex
    try {
      hex = parseHexKey(key)
    } catch {
      continue
    }
    const placed = world.pieces[key]
    addRules(key, hex, PIECES[placed.piece]?.spawns)
  }

  // Terrain can attract agents too — ducks belong to ponds, not to buildings.
  // Only sample a fraction of water tiles: a large lake shouldn't mean a
  // hundred ducks, and iterating every tile of one is wasted work.
  for (const key of Object.keys(world.terrain).sort()) {
    const terrain = TERRAIN[world.terrain[key]]
    if (!terrain?.spawns) continue
    let hex: Hex
    try {
      hex = parseHexKey(key)
    } catch {
      continue
    }
    addRules(key, hex, terrain.spawns)
  }

  const specs: AgentSpec[] = []

  for (const kind of [...byKind.keys()].sort()) {
    const contributions = byKind.get(kind)!
    let running = 0
    let spawned = 0

    for (const { hex, key, rule } of contributions) {
      running += rule.count
      // Emit one agent per whole unit accumulated, anchored to whichever piece
      // tipped the total over.
      while (running >= 1 && spawned < MAX_PER_KIND && specs.length < MAX_AGENTS) {
        running -= 1
        specs.push({
          id: `${kind}:${key}:${spawned}`,
          kind,
          home: hex,
          radius: rule.radius,
          behavior: rule.behavior,
          elevation: rule.behavior === 'patrol' ? 1.15 : 0,
        })
        spawned++
      }
      if (specs.length >= MAX_AGENTS) break
    }
  }

  return specs
}

/**
 * Pick a spawn point for an agent: a walkable hex near its home.
 *
 * Falls back to the home hex itself when nothing nearby is walkable, which
 * happens transiently while the player is mid-drag over the agent's territory.
 * Returning `null` instead would make agents flicker in and out during builds.
 */
export function findSpawnHex(spec: AgentSpec, grid: WalkGrid, rng: Rng): Hex {
  if (spec.behavior === 'patrol') {
    const rampart = findNearestRampart(spec.home, grid)
    if (rampart) return rampart
  }

  const candidates = hexRange(spec.home, Math.max(1, Math.floor(spec.radius))).filter((h) =>
    grid.isWalkable(h),
  )
  if (!candidates.length) return spec.home
  return candidates[rng.int(candidates.length)]
}

function findNearestRampart(from: Hex, grid: WalkGrid): Hex | null {
  for (const h of hexRange(from, 2)) {
    if (grid.isRampart(h)) return h
  }
  return null
}

/**
 * Choose the next place an agent should walk to.
 *
 * Deliberately simple: a random walkable hex within the agent's territory,
 * biased by behaviour. Agents in a cosy village are not solving problems —
 * they are milling about — so the target selection just needs to look
 * plausible and never strand anyone.
 */
export function pickWanderTarget(
  spec: AgentSpec,
  current: Hex,
  grid: WalkGrid,
  rng: Rng,
): Hex | null {
  if (spec.behavior === 'patrol') {
    // Guards follow the wall network rather than roaming freely.
    const options = hexNeighbors(current).filter((h) => grid.isRampart(h))
    if (options.length) return options[rng.int(options.length)]
    const nearby = findNearestRampart(current, grid)
    if (nearby) return nearby
  }

  const radius = Math.max(1, Math.round(spec.radius))
  // Sample a handful of candidates instead of enumerating the whole disc —
  // with dozens of agents repathing constantly, the allocation shows up.
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = {
      q: spec.home.q + rng.int(radius * 2 + 1) - radius,
      r: spec.home.r + rng.int(radius * 2 + 1) - radius,
    }
    if (hexDistance(candidate, spec.home) > radius) continue
    if (!grid.isWalkable(candidate)) continue
    if (candidate.q === current.q && candidate.r === current.r) continue
    return candidate
  }
  return null
}

/**
 * Breadth-first path between two nearby hexes, or `null` if unreachable.
 *
 * A* would be the textbook choice, but agent territories are small (radius ≤ 5,
 * so at most ~91 cells) and BFS over that is both faster in practice and
 * impossible to get subtly wrong — an inadmissible heuristic fails silently and
 * produces paths that look drunk.
 */
export function findPath(from: Hex, to: Hex, grid: WalkGrid, maxNodes = 160): Hex[] | null {
  const startKey = hexKey(from)
  const goalKey = hexKey(to)
  if (startKey === goalKey) return [from]

  const passable = (h: Hex): boolean => grid.isWalkable(h) || grid.isRampart(h)
  if (!passable(to)) return null

  const cameFrom = new Map<string, Hex | null>([[startKey, null]])
  const queue: Hex[] = [from]
  let head = 0
  let visited = 0

  while (head < queue.length && visited < maxNodes) {
    const current = queue[head++]
    visited++

    for (const next of hexNeighbors(current)) {
      const key = hexKey(next)
      if (cameFrom.has(key)) continue
      if (!passable(next)) continue

      cameFrom.set(key, current)
      if (key === goalKey) return reconstruct(cameFrom, next)
      queue.push(next)
    }
  }
  return null
}

function reconstruct(cameFrom: Map<string, Hex | null>, goal: Hex): Hex[] {
  const path: Hex[] = []
  let cursor: Hex | null = goal
  while (cursor) {
    path.push(cursor)
    cursor = cameFrom.get(hexKey(cursor)) ?? null
  }
  return path.reverse()
}

/** A deterministic RNG for a given agent, so behaviour is reproducible. */
export function rngForAgent(spec: AgentSpec, worldSeed: number): Rng {
  let hash = worldSeed >>> 0
  for (let i = 0; i < spec.id.length; i++) {
    hash = (Math.imul(hash ^ spec.id.charCodeAt(i), 0x01000193) + 1) >>> 0
  }
  return makeRng(hash)
}
