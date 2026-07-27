/**
 * Autoconnect tests.
 *
 * The behaviour under test is the one a player notices immediately when it
 * breaks: walls that don't join, fences that grab onto things they shouldn't,
 * and stubs left pointing at nothing after an erase.
 */

import { describe, expect, it } from 'vitest'
import { hexKey, hexNeighbor, type Hex, type HexDirection } from '@/core/hex'
import {
  ALL_CONNECTIONS,
  NO_CONNECTIONS,
  canonicalMask,
  classifyConnections,
  computeConnectionMask,
  connectedDirections,
  connectionCount,
  connectionDirtySet,
  hasConnection,
  piecesConnect,
  rotateMask,
} from './autoconnect'
import { getPiece } from './catalog'
import type { PlacedPiece, World } from './types'

/** Builds a world from a map of coordinate -> piece id. */
function worldWith(pieces: Record<string, string>): World {
  const built: Record<string, PlacedPiece> = {}
  const terrain: Record<string, string> = {}
  for (const [key, piece] of Object.entries(pieces)) {
    built[key] = { piece }
    terrain[key] = 'grass'
  }
  return { version: 1, name: 'test', seed: 1, terrain, pieces: built }
}

const ORIGIN: Hex = { q: 0, r: 0 }

describe('mask computation', () => {
  it('reports no connections for a lone piece', () => {
    const world = worldWith({ '0,0': 'castle_wall' })
    expect(computeConnectionMask(world, ORIGIN)).toBe(NO_CONNECTIONS)
  })

  it('reports no connections for a piece with no connection group', () => {
    const world = worldWith({ '0,0': 'cottage', '1,0': 'cottage' })
    expect(computeConnectionMask(world, ORIGIN)).toBe(NO_CONNECTIONS)
  })

  it('sets exactly the bit for each connected neighbour', () => {
    for (let d = 0; d < 6; d++) {
      const neighbour = hexNeighbor(ORIGIN, d as HexDirection)
      const world = worldWith({ '0,0': 'castle_wall', [hexKey(neighbour)]: 'castle_wall' })
      const mask = computeConnectionMask(world, ORIGIN)
      expect(mask).toBe(1 << d)
      expect(hasConnection(mask, d as HexDirection)).toBe(true)
    }
  })

  it('connects on all six sides when fully surrounded', () => {
    const pieces: Record<string, string> = { '0,0': 'path' }
    for (let d = 0; d < 6; d++) pieces[hexKey(hexNeighbor(ORIGIN, d as HexDirection))] = 'path'
    expect(computeConnectionMask(worldWith(pieces), ORIGIN)).toBe(ALL_CONNECTIONS)
  })

  it('is symmetric between two neighbours', () => {
    const world = worldWith({ '0,0': 'fence', '1,0': 'fence' })
    const a = computeConnectionMask(world, ORIGIN)
    const b = computeConnectionMask(world, { q: 1, r: 0 })
    expect(connectionCount(a)).toBe(1)
    expect(connectionCount(b)).toBe(1)
    // Each should point at the other.
    expect(connectedDirections(a)[0]).toBe(0) // east
    expect(connectedDirections(b)[0]).toBe(3) // west
  })

  it('returns nothing for an empty hex', () => {
    expect(computeConnectionMask(worldWith({}), ORIGIN)).toBe(NO_CONNECTIONS)
  })
})

describe('connection groups', () => {
  it('links pieces in the same group', () => {
    const wall = getPiece('castle_wall')!
    const tower = getPiece('tower')!
    expect(piecesConnect(wall, tower)).toBe(true)
  })

  it('does not link across unrelated groups', () => {
    // A fence must not fuse onto a castle wall — the wall has no matching stub
    // to meet it and the join would look broken.
    const fence = getPiece('fence')!
    const wall = getPiece('castle_wall')!
    expect(piecesConnect(fence, wall)).toBe(false)

    const world = worldWith({ '0,0': 'fence', '1,0': 'castle_wall' })
    expect(computeConnectionMask(world, ORIGIN)).toBe(NO_CONNECTIONS)
  })

  it('requires the relationship to be mutual', () => {
    // A gate accepts paths, but a path does not accept walls, so the two must
    // not connect. One-directional acceptance would leave a stub on only one
    // side of the boundary.
    const gate = getPiece('gate')!
    const path = getPiece('path')!
    expect(gate.connectsTo).toContain('path')
    expect(path.connectsTo).not.toContain('wall')
    expect(piecesConnect(gate, path)).toBe(false)
  })

  it('links animal pens to hand-placed fences', () => {
    const world = worldWith({ '0,0': 'pen', '1,0': 'fence' })
    expect(connectionCount(computeConnectionMask(world, ORIGIN))).toBe(1)
  })

  it('links bridges into a path run', () => {
    const world = worldWith({ '0,0': 'bridge', '1,0': 'path', '-1,0': 'path' })
    expect(connectionCount(computeConnectionMask(world, ORIGIN))).toBe(2)
  })
})

describe('shape classification', () => {
  it('classifies each arrangement', () => {
    expect(classifyConnections(0b000000)).toBe('isolated')
    expect(classifyConnections(0b000001)).toBe('end')
    expect(classifyConnections(0b001001)).toBe('straight') // opposite pair
    expect(classifyConnections(0b000011)).toBe('bend') // adjacent pair
    expect(classifyConnections(0b000101)).toBe('bend') // 120 degrees apart
    expect(classifyConnections(0b000111)).toBe('junction')
    expect(classifyConnections(ALL_CONNECTIONS)).toBe('junction')
  })

  it('treats all three opposite pairs as straight', () => {
    for (let d = 0; d < 3; d++) {
      const mask = (1 << d) | (1 << (d + 3))
      expect(classifyConnections(mask)).toBe('straight')
    }
  })
})

describe('rotation', () => {
  it('rotates masks within six bits', () => {
    expect(rotateMask(0b000001, 1)).toBe(0b000010)
    expect(rotateMask(0b100000, 1)).toBe(0b000001) // wraps
    expect(rotateMask(0b000001, 6)).toBe(0b000001) // full turn
    expect(rotateMask(ALL_CONNECTIONS, 3)).toBe(ALL_CONNECTIONS)
  })

  it('preserves the number of connections', () => {
    for (let mask = 0; mask < 64; mask++) {
      for (let k = 0; k < 6; k++) {
        expect(connectionCount(rotateMask(mask, k))).toBe(connectionCount(mask))
      }
    }
  })

  it('reduces all 64 masks to 14 orbits under rotation', () => {
    // The classic result for a 6-neighbour grid, and a good canary: if the
    // rotation logic is wrong this number changes.
    const canonicals = new Set<number>()
    for (let mask = 0; mask < 64; mask++) canonicals.add(canonicalMask(mask).canonical)
    expect(canonicals.size).toBe(14)
  })

  it('reports a rotation that maps the canonical form back to the mask', () => {
    for (let mask = 0; mask < 64; mask++) {
      const { canonical, rotation } = canonicalMask(mask)
      expect(rotateMask(canonical, rotation)).toBe(mask)
    }
  })
})

describe('invalidation', () => {
  it('covers the hex and all six neighbours', () => {
    // Missing a neighbour here leaves a wall stub pointing at nothing after an
    // erase, which is the classic autotiling bug.
    const dirty = connectionDirtySet(ORIGIN)
    expect(dirty).toHaveLength(7)
    const keys = new Set(dirty.map(hexKey))
    expect(keys.has(hexKey(ORIGIN))).toBe(true)
    for (let d = 0; d < 6; d++) {
      expect(keys.has(hexKey(hexNeighbor(ORIGIN, d as HexDirection)))).toBe(true)
    }
  })
})
