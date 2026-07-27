/**
 * Geometry tests.
 *
 * These exist because of a real bug: ground prisms were built 30° off the hex
 * lattice, which still *looks* like a honeycomb — the tiles overlap along the
 * six neighbour axes — but leaves a small triangular hole at every three-way
 * corner. It reads as "a gap between the hexes" rather than as a rotation
 * error, and nothing about it is visible in the code.
 *
 * The check below is against `hexCorners`, which is the lattice's own
 * definition of where a tile's corners belong, so the two cannot drift apart.
 */

import { describe, expect, it } from 'vitest'
import { HEX_SIZE, hexCorners, hexNeighbor, hexToWorld, type HexDirection } from '@/core/hex'
import { MeshBuilder } from './builder'

/** Every distinct XZ position on the top face of a baked prism. */
function topFaceOutline(radius: number, pointy: boolean): { x: number; z: number }[] {
  const b = new MeshBuilder()
  b.prism({ radius, height: 1, color: '#ffffff', pointy })
  const geometry = b.toGeometry()
  const position = geometry.getAttribute('position')

  const seen = new Set<string>()
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (Math.abs(y - 0.5) > 1e-6) continue // top face only
    if (Math.hypot(x, z) < 1e-6) continue // skip the fan centre

    // The cap fan closes on itself, so the seam vertex is emitted twice — once
    // at theta 0 and once at 2*pi — differing only in the sign of a zero.
    // `+ 0` normalises -0 to 0 so the two dedupe to one corner.
    const key = `${Number(x.toFixed(5)) + 0},${Number(z.toFixed(5)) + 0}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x, z })
  }
  geometry.dispose()
  return out.sort((a, b2) => Math.atan2(a.z, a.x) - Math.atan2(b2.z, b2.x))
}

describe('hex prisms', () => {
  it('puts its corners exactly where the lattice expects them', () => {
    const corners = topFaceOutline(HEX_SIZE, true)
    expect(corners).toHaveLength(6)

    const expected = [...hexCorners({ q: 0, r: 0 })].sort(
      (a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x),
    )

    for (let i = 0; i < 6; i++) {
      expect(corners[i].x).toBeCloseTo(expected[i].x, 6)
      expect(corners[i].z).toBeCloseTo(expected[i].z, 6)
    }
  })

  it('has flat edges facing its neighbours, not vertices', () => {
    // The distinguishing property. A tile rotated 30° off has a *vertex*
    // pointing at each neighbour, which is what opens the corner gaps.
    const corners = topFaceOutline(HEX_SIZE, true)
    for (let d = 0; d < 6; d++) {
      const neighbour = hexToWorld(hexNeighbor({ q: 0, r: 0 }, d as HexDirection))
      const bearing = Math.atan2(neighbour.z, neighbour.x)

      // No corner may sit along a neighbour direction.
      for (const corner of corners) {
        let delta = Math.atan2(corner.z, corner.x) - bearing
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        expect(Math.abs(delta)).toBeGreaterThan(0.4) // ~23°, well clear of 0
      }
    }
  })

  it('tiles seamlessly: neighbours meet edge to edge', () => {
    // Two adjacent tiles must share an edge exactly — the inradius has to be
    // half the centre-to-centre distance.
    const corners = topFaceOutline(HEX_SIZE, true)
    const inradius = Math.min(
      ...corners.map((c, i) => {
        const next = corners[(i + 1) % corners.length]
        // Distance from the origin to the midpoint of this edge.
        return Math.hypot((c.x + next.x) / 2, (c.z + next.z) / 2)
      }),
    )

    const origin = hexToWorld({ q: 0, r: 0 })
    const neighbour = hexToWorld(hexNeighbor({ q: 0, r: 0 }, 0))
    const spacing = Math.hypot(neighbour.x - origin.x, neighbour.z - origin.z)

    expect(inradius * 2).toBeCloseTo(spacing, 6)
  })

  it('leaves no hole at a three-way corner', () => {
    // The exact failure mode of the original bug. Three mutually adjacent tiles
    // meet at a point; every one of them must reach it.
    const a = { q: 0, r: 0 }
    const b = hexNeighbor(a, 0)
    const c = hexNeighbor(a, 1)

    // Note the arrow function: `.map(hexToWorld)` would pass the array index as
    // hexToWorld's optional `size` argument and silently scale each centre
    // differently.
    const centres = [a, b, c].map((h) => hexToWorld(h))
    const corner = {
      x: (centres[0].x + centres[1].x + centres[2].x) / 3,
      z: (centres[0].z + centres[1].z + centres[2].z) / 3,
    }

    const corners = topFaceOutline(HEX_SIZE, true)
    for (const centre of centres) {
      const local = { x: corner.x - centre.x, z: corner.z - centre.z }
      const reach = Math.min(
        ...corners.map((p) => Math.hypot(p.x - local.x, p.z - local.z)),
      )
      // The triple point must coincide with one of the tile's own corners.
      expect(reach).toBeLessThan(1e-6)
    }
  })

  it('turns flat-top 30 degrees from pointy-top', () => {
    const pointy = topFaceOutline(HEX_SIZE, true)
    const flat = topFaceOutline(HEX_SIZE, false)
    const bearing = (p: { x: number; z: number }) =>
      ((Math.atan2(p.z, p.x) * 180) / Math.PI + 360) % 360
    expect(pointy.map(bearing).map(Math.round).sort((x, y) => x - y)).toEqual([30, 90, 150, 210, 270, 330])
    expect(flat.map(bearing).map(Math.round).sort((x, y) => x - y)).toEqual([0, 60, 120, 180, 240, 300])
  })

  it('treats radius as the circumradius', () => {
    const corners = topFaceOutline(2.5, true)
    for (const corner of corners) {
      expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(2.5, 6)
    }
  })
})
