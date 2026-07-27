/**
 * Agent director and deterministic-variance tests.
 *
 * These cover the two design promises that are easy to break silently:
 *
 *  - **Population is derived, never stored.** Build a market and shoppers
 *    appear; remove it and they leave. If this drifts, the save file and the
 *    village stop agreeing about who lives there.
 *  - **Visual variance is stable.** Tilt, tint and shape are pure functions of
 *    the seed and coordinate. If that stops holding, the whole village visibly
 *    reshuffles itself on every reload and on every neighbouring edit.
 */

import { describe, expect, it } from 'vitest'
import { hashChoice, hashJitter, hashNoise, hashPick, makeRng } from '@/core/rng'
import { hexKey, hexRange, type Hex } from '@/core/hex'
import { MAX_AGENTS, buildWalkGrid, findPath, planAgents } from './director'
import { flatWorld } from '@/world/generate'
import { EXAMPLE_VILLAGES } from '@/world/examples'
import type { PlacedPiece, World } from '@/world/types'

function worldOf(pieces: Record<string, string>, radius = 8): World {
  const base = flatWorld('test', 1, radius)
  const built: Record<string, PlacedPiece> = {}
  for (const [key, piece] of Object.entries(pieces)) built[key] = { piece }
  return { ...base, pieces: built }
}

describe('population is derived from pieces', () => {
  it('is empty for an empty world', () => {
    expect(planAgents(worldOf({}))).toHaveLength(0)
  })

  it('grows as more of a piece is built', () => {
    const one = planAgents(worldOf({ '0,0': 'market_stall' })).length
    const three = planAgents(
      worldOf({ '0,0': 'market_stall', '2,0': 'market_stall', '-2,0': 'market_stall' }),
    ).length
    expect(three).toBeGreaterThan(one)
  })

  it('leaves when the piece is removed', () => {
    const withBarn = planAgents(worldOf({ '0,0': 'barn' }))
    expect(withBarn.length).toBeGreaterThan(0)
    expect(planAgents(worldOf({}))).toHaveLength(0)
  })

  it('spawns the kinds a piece declares', () => {
    const kinds = new Set(planAgents(worldOf({ '0,0': 'barn' })).map((a) => a.kind))
    expect(kinds.has('farmer')).toBe(true)
    expect(kinds.has('cow')).toBe(true)
    expect(kinds.has('chicken')).toBe(true)
  })

  it('needs several of a low-contribution piece to justify one agent', () => {
    // A single castle wall contributes 0.25 guards; one block should not
    // produce a guard, but a run of four should.
    expect(planAgents(worldOf({ '0,0': 'castle_wall' })).filter((a) => a.kind === 'guard')).toHaveLength(0)

    const run: Record<string, string> = {}
    for (let q = 0; q < 4; q++) run[`${q},0`] = 'castle_wall'
    expect(planAgents(worldOf(run)).filter((a) => a.kind === 'guard').length).toBeGreaterThanOrEqual(1)
  })

  it('puts guards on patrol at rampart height', () => {
    const run: Record<string, string> = {}
    for (let q = 0; q < 6; q++) run[`${q},0`] = 'castle_wall'
    const guards = planAgents(worldOf(run)).filter((a) => a.kind === 'guard')
    expect(guards.length).toBeGreaterThan(0)
    for (const guard of guards) {
      expect(guard.behavior).toBe('patrol')
      expect(guard.elevation).toBeGreaterThan(0)
    }
  })

  it('spawns ducks from water, with no piece involved', () => {
    const world: World = {
      version: 1,
      name: 'pond',
      seed: 1,
      terrain: Object.fromEntries(hexRange({ q: 0, r: 0 }, 3).map((c) => [hexKey(c), 'water'])),
      pieces: {},
    }
    expect(planAgents(world).some((a) => a.kind === 'duck')).toBe(true)
  })

  it('is deterministic for the same world', () => {
    const world = EXAMPLE_VILLAGES[0].build()
    expect(planAgents(world).map((a) => a.id)).toEqual(planAgents(world).map((a) => a.id))
  })

  it('gives every agent a unique id', () => {
    for (const example of EXAMPLE_VILLAGES) {
      const specs = planAgents(example.build())
      expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length)
    }
  })

  it('stays within the population cap even for a dense village', () => {
    // Frame budget depends on this holding however much the player builds.
    const dense: Record<string, string> = {}
    for (const cell of hexRange({ q: 0, r: 0 }, 12)) dense[hexKey(cell)] = 'tavern'
    expect(planAgents(worldOf(dense, 14)).length).toBeLessThanOrEqual(MAX_AGENTS)
  })

  it('populates every sample village', () => {
    for (const example of EXAMPLE_VILLAGES) {
      expect(planAgents(example.build()).length, example.name).toBeGreaterThan(5)
    }
  })
})

describe('walkability', () => {
  it('excludes water and solid buildings, and includes paths', () => {
    const world = worldOf({ '0,0': 'cottage', '1,0': 'path', '2,0': 'field' })
    const grid = buildWalkGrid(world)
    expect(grid.isWalkable({ q: 0, r: 0 })).toBe(false) // a cottage blocks
    expect(grid.isWalkable({ q: 1, r: 0 })).toBe(true) // a path does not
    expect(grid.isWalkable({ q: 2, r: 0 })).toBe(true) // nor does a field
    expect(grid.isWalkable({ q: 3, r: 0 })).toBe(true) // open ground
  })

  it('marks wall pieces as ramparts', () => {
    const grid = buildWalkGrid(worldOf({ '0,0': 'castle_wall', '1,0': 'tower' }))
    expect(grid.isRampart({ q: 0, r: 0 })).toBe(true)
    expect(grid.isRampart({ q: 1, r: 0 })).toBe(true)
    expect(grid.isRampart({ q: 2, r: 0 })).toBe(false)
  })

  it('treats hexes outside the island as unwalkable', () => {
    const grid = buildWalkGrid(worldOf({}, 3))
    expect(grid.isWalkable({ q: 40, r: 0 })).toBe(false)
  })
})

describe('pathfinding', () => {
  const grid = buildWalkGrid(worldOf({}, 6))

  it('finds a path between two open hexes', () => {
    const path = findPath({ q: -3, r: 0 }, { q: 3, r: 0 }, grid)
    expect(path).not.toBeNull()
    expect(path![0]).toEqual({ q: -3, r: 0 })
    expect(path![path!.length - 1]).toEqual({ q: 3, r: 0 })
  })

  it('returns adjacent steps only', () => {
    const path = findPath({ q: -3, r: 2 }, { q: 3, r: -2 }, grid)!
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]
      const b = path[i]
      expect(Math.abs(a.q - b.q) + Math.abs(a.r - b.r)).toBeLessThanOrEqual(2)
    }
  })

  it('returns null for an unreachable target', () => {
    expect(findPath({ q: 0, r: 0 }, { q: 50, r: 0 }, grid)).toBeNull()
  })

  it('routes around a wall of buildings', () => {
    const blocked: Record<string, string> = {}
    for (let r = -3; r <= 3; r++) blocked[`0,${r}`] = 'cottage'
    const walled = buildWalkGrid(worldOf(blocked, 6))
    const path = findPath({ q: -2, r: 0 }, { q: 2, r: 0 }, walled, 400)
    expect(path).not.toBeNull()
    // Every step must avoid the blocked column.
    for (const cell of path!) {
      if (cell.r >= -3 && cell.r <= 3) expect(cell.q).not.toBe(0)
    }
  })

  it('returns a single cell when start and goal match', () => {
    const start: Hex = { q: 1, r: 1 }
    expect(findPath(start, start, grid)).toEqual([start])
  })
})

describe('deterministic variance', () => {
  it('returns the same value for the same inputs', () => {
    for (let i = 0; i < 50; i++) {
      expect(hashNoise(1234, i, -i, 'tilt')).toBe(hashNoise(1234, i, -i, 'tilt'))
    }
  })

  it('decorrelates channels, so a tall tree is not always a dark one', () => {
    let matches = 0
    for (let q = 0; q < 200; q++) {
      const a = hashNoise(99, q, 0, 'height')
      const b = hashNoise(99, q, 0, 'colour')
      if (Math.abs(a - b) < 0.02) matches++
    }
    // Independent channels collide about 4% of the time; correlated ones
    // would collide every time.
    expect(matches).toBeLessThan(30)
  })

  it('varies between neighbouring tiles', () => {
    const values = new Set<number>()
    for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) values.add(hashNoise(7, q, r, 'scale'))
    expect(values.size).toBeGreaterThan(100)
  })

  it('changes completely with the seed, so a new seed reskins the world', () => {
    let different = 0
    for (let q = 0; q < 100; q++) {
      if (hashNoise(1, q, 0, 'x') !== hashNoise(2, q, 0, 'x')) different++
    }
    expect(different).toBe(100)
  })

  it('stays inside its documented ranges', () => {
    for (let q = 0; q < 500; q++) {
      const noise = hashNoise(3, q, q * 7, 'n')
      expect(noise).toBeGreaterThanOrEqual(0)
      expect(noise).toBeLessThan(1)

      const jitter = hashJitter(3, q, 0, 'j', 0.25)
      expect(Math.abs(jitter)).toBeLessThanOrEqual(0.25)

      const pick = hashPick(3, q, 0, 'p', 4)
      expect(pick).toBeGreaterThanOrEqual(0)
      expect(pick).toBeLessThan(4)
    }
  })

  it('distributes picks across all options', () => {
    const counts = [0, 0, 0, 0]
    for (let q = 0; q < 800; q++) counts[hashPick(11, q, 0, 'variant', 4)]++
    for (const count of counts) expect(count).toBeGreaterThan(120)
  })

  it('never picks outside a choice list', () => {
    const options = ['a', 'b', 'c'] as const
    for (let q = 0; q < 200; q++) {
      expect(options).toContain(hashChoice(5, q, 0, 'c', options))
    }
  })

  it('handles a single-option pick', () => {
    expect(hashPick(1, 2, 3, 'only', 1)).toBe(0)
    expect(hashPick(1, 2, 3, 'none', 0)).toBe(0)
  })
})

describe('seeded stream', () => {
  it('replays identically from the same seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('differs between seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next())
  })

  it('stays within range', () => {
    const rng = makeRng(9)
    for (let i = 0; i < 500; i++) {
      const value = rng.range(-3, 7)
      expect(value).toBeGreaterThanOrEqual(-3)
      expect(value).toBeLessThan(7)
      expect(rng.int(5)).toBeLessThan(5)
    }
  })
})
