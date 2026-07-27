/**
 * Hex math tests.
 *
 * These are the highest-value tests in the project. Everything spatial —
 * placement, autoconnect, chunking, pathfinding — is built on this module, and
 * hex bugs are miserable to diagnose downstream: a wrong `hexRound` shows up as
 * "clicks sometimes place a piece one tile off near the edges", which looks
 * like an input bug rather than a maths one.
 *
 * The round-trip and nearest-centre properties below are checked exhaustively
 * rather than on hand-picked examples, because the failure cases live exactly
 * at the boundaries a human would forget to write down.
 */

import { describe, expect, it } from 'vitest'
import {
  HEX_DIRECTIONS,
  HEX_SIZE,
  edgeKey,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbor,
  hexNeighbors,
  hexRange,
  hexRing,
  hexRound,
  hexSpiral,
  hexToWorld,
  hexDirectionBetween,
  oppositeDirection,
  parseHexKey,
  worldToHex,
  type Hex,
  type HexDirection,
} from './hex'

describe('coordinates', () => {
  it('round-trips hex -> world -> hex over a large area', () => {
    for (const cell of hexRange({ q: 0, r: 0 }, 30)) {
      const world = hexToWorld(cell)
      const back = worldToHex(world)
      expect(back, `failed for ${hexKey(cell)}`).toEqual(cell)
    }
  })

  it('picks the nearest hex centre for arbitrary points', () => {
    // The property that matters for clicking: whatever point the ray hits, the
    // hex we return must be the one whose centre is closest. Naive rounding of
    // both axial coordinates fails this near edges and corners.
    //
    // The comparison is done in plain arithmetic with a single assertion per
    // sample; one `expect` per candidate would be hundreds of thousands of
    // calls and slower than the maths by orders of magnitude.
    const candidates = hexRange({ q: 0, r: 0 }, 5).map((cell) => ({
      cell,
      centre: hexToWorld(cell),
    }))

    let worstOvershoot = 0
    let worstPoint = ''

    for (let ix = 0; ix < 90; ix++) {
      for (let iz = 0; iz < 90; iz++) {
        // A deterministic sweep, offset by an irrational-ish step so samples
        // land on and around hex boundaries rather than only in tile middles.
        const x = -6 + ix * 0.1337
        const z = -6 + iz * 0.1337

        const picked = worldToHex({ x, z })
        const pickedCentre = hexToWorld(picked)
        const pickedDist = Math.hypot(pickedCentre.x - x, pickedCentre.z - z)

        for (const { centre } of candidates) {
          const overshoot = pickedDist - Math.hypot(centre.x - x, centre.z - z)
          if (overshoot > worstOvershoot) {
            worstOvershoot = overshoot
            worstPoint = `(${x.toFixed(4)}, ${z.toFixed(4)}) -> ${hexKey(picked)}`
          }
        }
      }
    }

    // Zero, up to floating-point slack on exact ties along a hex edge.
    expect(worstOvershoot, `nearest-centre violated at ${worstPoint}`).toBeLessThan(1e-9)
  })

  it('never returns negative zero, so keys stay canonical', () => {
    const rounded = hexRound(-0.2, -0.2)
    expect(Object.is(rounded.q, -0)).toBe(false)
    expect(Object.is(rounded.r, -0)).toBe(false)
    expect(hexKey(rounded)).not.toContain('-0,')
  })

  it('places neighbours exactly one hex width apart', () => {
    const origin = { q: 0, r: 0 }
    const centre = hexToWorld(origin)
    for (let d = 0; d < 6; d++) {
      const neighbour = hexToWorld(hexNeighbor(origin, d as HexDirection))
      const distance = Math.hypot(neighbour.x - centre.x, neighbour.z - centre.z)
      expect(distance).toBeCloseTo(Math.sqrt(3) * HEX_SIZE, 10)
    }
  })

  it('spaces the six directions 60 degrees apart', () => {
    const angles = HEX_DIRECTIONS.map((d) => {
      const p = hexToWorld(d)
      return (Math.atan2(-p.z, p.x) * 180) / Math.PI
    })
    for (let i = 0; i < 6; i++) {
      const delta = (((angles[i] - angles[0]) % 360) + 360) % 360
      expect(delta).toBeCloseTo(i * 60, 6)
    }
  })
})

describe('distance', () => {
  it('agrees with breadth-first search', () => {
    // An inadmissible distance function silently corrupts pathfinding, so this
    // is checked against ground truth rather than against itself.
    const origin: Hex = { q: 0, r: 0 }
    const seen = new Map<string, number>([[hexKey(origin), 0]])
    const queue: Hex[] = [origin]
    let head = 0

    while (head < queue.length) {
      const current = queue[head++]
      const depth = seen.get(hexKey(current))!
      if (depth >= 8) continue
      for (const next of hexNeighbors(current)) {
        const key = hexKey(next)
        if (seen.has(key)) continue
        seen.set(key, depth + 1)
        queue.push(next)
      }
    }

    for (const [key, depth] of seen) {
      expect(hexDistance(origin, parseHexKey(key))).toBe(depth)
    }
  })

  it('is symmetric', () => {
    for (const a of hexRange({ q: 0, r: 0 }, 5)) {
      for (const b of hexRange({ q: 2, r: -1 }, 3)) {
        expect(hexDistance(a, b)).toBe(hexDistance(b, a))
      }
    }
  })
})

describe('regions', () => {
  it('produces rings of 6n cells at distance n', () => {
    for (let radius = 1; radius <= 6; radius++) {
      const ring = hexRing({ q: 0, r: 0 }, radius)
      expect(ring).toHaveLength(6 * radius)
      for (const cell of ring) {
        expect(hexDistance(cell, { q: 0, r: 0 })).toBe(radius)
      }
      // No duplicates — a ring that revisits a cell means the walk is wrong.
      expect(new Set(ring.map(hexKey)).size).toBe(ring.length)
    }
  })

  it('walks rings in contiguous steps', () => {
    const ring = hexRing({ q: 0, r: 0 }, 4)
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length]
      expect(hexDistance(ring[i], next)).toBe(1)
    }
  })

  it('produces 3n(n+1)+1 cells within radius n', () => {
    for (let radius = 0; radius <= 6; radius++) {
      const expected = 3 * radius * (radius + 1) + 1
      expect(hexRange({ q: 0, r: 0 }, radius)).toHaveLength(expected)
      expect(hexSpiral({ q: 0, r: 0 }, radius)).toHaveLength(expected)
    }
  })

  it('spirals outward in non-decreasing distance', () => {
    const spiral = hexSpiral({ q: 1, r: -2 }, 4)
    let previous = -1
    for (const cell of spiral) {
      const distance = hexDistance(cell, { q: 1, r: -2 })
      expect(distance).toBeGreaterThanOrEqual(previous)
      previous = distance
    }
  })
})

describe('lines', () => {
  it('returns a contiguous run of adjacent hexes', () => {
    // Drag painting depends on this: any gap shows up as a dotted line when the
    // player drags quickly.
    const cases: [Hex, Hex][] = [
      [{ q: 0, r: 0 }, { q: 5, r: 0 }],
      [{ q: 0, r: 0 }, { q: -4, r: 7 }],
      [{ q: 3, r: -3 }, { q: -3, r: 3 }],
      [{ q: -2, r: 5 }, { q: 6, r: -1 }],
    ]

    for (const [from, to] of cases) {
      const line = hexLine(from, to)
      expect(line[0]).toEqual(from)
      expect(line[line.length - 1]).toEqual(to)
      expect(line).toHaveLength(hexDistance(from, to) + 1)
      for (let i = 1; i < line.length; i++) {
        expect(hexDistance(line[i - 1], line[i])).toBe(1)
      }
    }
  })

  it('returns a single cell for a zero-length line', () => {
    expect(hexLine({ q: 2, r: 2 }, { q: 2, r: 2 })).toEqual([{ q: 2, r: 2 }])
  })
})

describe('directions', () => {
  it('identifies the direction between adjacent hexes', () => {
    const origin: Hex = { q: 0, r: 0 }
    for (let d = 0; d < 6; d++) {
      expect(hexDirectionBetween(origin, hexNeighbor(origin, d as HexDirection))).toBe(d)
    }
    expect(hexDirectionBetween(origin, { q: 3, r: 0 })).toBeNull()
  })

  it('has opposite directions that undo each other', () => {
    const origin: Hex = { q: 0, r: 0 }
    for (let d = 0; d < 6; d++) {
      const there = hexNeighbor(origin, d as HexDirection)
      const back = hexNeighbor(there, oppositeDirection(d as HexDirection))
      expect(back).toEqual(origin)
    }
  })
})

describe('keys', () => {
  it('round-trips through parse', () => {
    for (const cell of hexRange({ q: -3, r: 4 }, 5)) {
      expect(parseHexKey(hexKey(cell))).toEqual(cell)
    }
  })

  it('rejects malformed keys', () => {
    expect(() => parseHexKey('nonsense')).toThrow()
    expect(() => parseHexKey('1,abc')).toThrow()
    expect(() => parseHexKey('')).toThrow()
  })

  it('gives both sides of an edge the same key', () => {
    // Edge-mounted pieces rely on this, or the same physical edge gets stored
    // twice under two different names.
    const origin: Hex = { q: 0, r: 0 }
    for (let d = 0; d < 6; d++) {
      const direction = d as HexDirection
      const neighbour = hexNeighbor(origin, direction)
      expect(edgeKey(origin, direction)).toBe(edgeKey(neighbour, oppositeDirection(direction)))
    }
  })

  it('gives different edges different keys', () => {
    const keys = new Set<string>()
    for (const cell of hexRange({ q: 0, r: 0 }, 3)) {
      for (let d = 0; d < 6; d++) keys.add(edgeKey(cell, d as HexDirection))
    }
    // 37 cells, each contributing 6 edges, with interior edges shared.
    expect(keys.size).toBeGreaterThan(60)
  })
})
