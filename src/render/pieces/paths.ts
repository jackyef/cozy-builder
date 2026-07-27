/**
 * Connecting pieces — paths, fences and bridges.
 *
 * These are the clearest demonstration of the autoconnect model: none of them
 * has a "corner" or "T-junction" variant. Each draws a **hub** at the hex
 * centre plus one **spoke** per connected direction, and every junction shape a
 * player can build falls out of that. A path that bends is a hub with two
 * spokes 120° apart; the bend was never modelled.
 *
 * See `src/world/autoconnect.ts` for how the mask is computed.
 */

import { HEX_WIDTH, directionVector, type HexDirection } from '@/core/hex'
import { connectedDirections, connectionCount } from '@/world/autoconnect'
import { COLORS } from '@/world/catalog'
import { shade, tint } from '../geometry/builder'
import type { PieceRenderer } from './context'

/** Centre-to-edge distance: how far a spoke reaches to meet its neighbour. */
const SPOKE_LENGTH = HEX_WIDTH / 2

/**
 * A worn dirt path.
 *
 * Built from overlapping flattened blobs rather than clean quads. Sharp-edged
 * path tiles show their hex boundaries badly when they meet at an angle; soft
 * lozenges blur into each other and read as one trodden route.
 */
export const path: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const dirs = connectedDirections(ctx.mask)
  const base = tint(COLORS.dirt, ctx.jitter('hue', 0.012), ctx.jitter('light', 0.05))
  const y = 0.03

  // Hub. An isolated path tile gets a slightly larger patch so a single click
  // still produces something that looks deliberate.
  b.blob({
    radius: dirs.length === 0 ? 0.5 : 0.42,
    color: base,
    detail: 1,
    position: [ctx.jitter('hx', 0.05), y, ctx.jitter('hz', 0.05)],
    scale: [1, 0.055, 1],
    rotationY: ctx.range('spin', 0, Math.PI),
  })

  for (const d of dirs) {
    const [dx, dz] = directionVector(d)
    // Two lozenges per spoke, so the run keeps a slight organic waver instead
    // of a mechanically straight edge.
    for (let i = 0; i < 2; i++) {
      const t = 0.3 + i * 0.36
      b.blob({
        radius: ctx.range(`sw${d}${i}`, 0.34, 0.42),
        color: shade(base, ctx.jitter(`ss${d}${i}`, 0.05)),
        detail: 1,
        position: [
          dx * SPOKE_LENGTH * t + ctx.jitter(`sx${d}${i}`, 0.05),
          y,
          dz * SPOKE_LENGTH * t + ctx.jitter(`sz${d}${i}`, 0.05),
        ],
        scale: [1, 0.05, 1],
        rotationY: ctx.range(`sr${d}${i}`, 0, Math.PI),
      })
    }
  }

  // Occasional pebbles pressed into the surface.
  if (ctx.chance('pebbles', 0.4)) {
    for (let i = 0; i < 3; i++) {
      const angle = ctx.range(`pa${i}`, 0, Math.PI * 2)
      const dist = ctx.range(`pd${i}`, 0.1, 0.5)
      b.blob({
        radius: ctx.range(`pr${i}`, 0.03, 0.055),
        color: shade(COLORS.stone, ctx.jitter(`ps${i}`, 0.1)),
        detail: 0,
        position: [Math.cos(angle) * dist, y + 0.02, Math.sin(angle) * dist],
        scale: [1, 0.5, 1],
      })
    }
  }
}

/**
 * A wooden fence.
 *
 * A post at the hex centre, and two horizontal rails running out along every
 * connected direction. Posts lean by a degree or two and rails sag slightly —
 * deliberately, because a perfectly level fence looks manufactured and a
 * slightly tired one looks lived-with.
 */
export const fence: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const dirs = connectedDirections(ctx.mask)
  const wood = tint(
    ctx.variant === 1 ? COLORS.woodLight : COLORS.wood,
    ctx.jitter('hue', 0.012),
    ctx.jitter('light', 0.06),
  )
  const postHeight = ctx.range('postH', 0.62, 0.76)

  drawPost(0, 0, postHeight)

  for (const d of dirs) {
    const [dx, dz] = directionVector(d)
    // Rails span from the hub post to the hex edge, where the neighbour's rail
    // meets them. Only draw each edge once per side — the neighbour draws its
    // own half — so overlapping geometry never z-fights.
    const railY1 = postHeight * 0.72
    const railY2 = postHeight * 0.38
    const sag = 0.02

    for (const [ry, thickness] of [
      [railY1, 0.05],
      [railY2, 0.045],
    ] as const) {
      b.strut(
        [0, ry, 0],
        [dx * SPOKE_LENGTH, ry - sag, dz * SPOKE_LENGTH],
        thickness,
        shade(wood, ctx.jitter(`rail${d}${ry}`, 0.07)),
      )
    }
  }

  // A lone fence post gets a second post beside it, so a stray click still
  // looks like a fragment of fence rather than a mistake.
  if (dirs.length === 0) {
    drawPost(0.3, 0.16, postHeight * 0.92)
    b.strut([0, postHeight * 0.6, 0], [0.3, postHeight * 0.56, 0.16], 0.045, wood)
  }

  function drawPost(x: number, z: number, h: number): void {
    b.in(
      {
        position: [x, 0, z],
        rotationX: ctx.jitter(`leanX${x}`, 0.055),
        rotationZ: ctx.jitter(`leanZ${x}`, 0.055),
      },
      () => {
        b.roundedBox({
          size: [0.11, h, 0.11],
          color: wood,
          bevel: 0.02,
          position: [0, h / 2, 0],
          rotationY: ctx.jitter(`postSpin${x}`, 0.2),
        })
        // Chamfered cap, so the post reads as cut rather than snapped off.
        b.cone({
          radius: 0.075,
          height: 0.06,
          color: shade(wood, 0.1),
          position: [0, h, 0],
          segments: 4,
        })
      },
    )
  }
}

/**
 * A plank bridge over water.
 *
 * Uses the same path connection group, so a path run simply continues across
 * water once a bridge is dropped in. Deck planks are laid perpendicular to the
 * run, which is derived from the mask rather than from a stored rotation.
 */
export const bridge: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const dirs = connectedDirections(ctx.mask)
  const wood = tint(COLORS.wood, ctx.jitter('hue', 0.01), ctx.jitter('light', 0.05))
  const deckY = 0.34

  // Span the connected directions; an unconnected bridge still lays a deck
  // east-west so it doesn't vanish into the water.
  const spans: HexDirection[] = dirs.length ? dirs : [0, 3]

  for (const d of spans) {
    const [dx, dz] = directionVector(d)
    const planks = 4
    for (let i = 0; i < planks; i++) {
      const t = ((i + 0.5) / planks) * SPOKE_LENGTH
      b.roundedBox({
        size: [0.16, 0.06, 0.86],
        color: shade(wood, ctx.jitter(`plank${d}${i}`, 0.09)),
        bevel: 0.02,
        position: [dx * t, deckY, dz * t],
        rotationY: Math.atan2(-dz, dx),
      })
    }

    // Support piles down into the water at the edge of the span.
    b.cylinder({
      radius: 0.055,
      height: deckY + 0.3,
      color: COLORS.woodDark,
      position: [dx * SPOKE_LENGTH * 0.8, (deckY - 0.3) / 2 + 0.02, dz * SPOKE_LENGTH * 0.8],
      segments: 6,
    })
  }

  // Central deck patch tying the spans together.
  b.cylinder({
    radius: 0.44,
    height: 0.06,
    color: shade(wood, 0.04),
    position: [0, deckY, 0],
    segments: 6,
  })

  // Handrails, but only on a straight run — rails through a junction would
  // fence the bridge off from the path meeting it.
  if (connectionCount(ctx.mask) <= 2) {
    for (const d of spans) {
      const [dx, dz] = directionVector(d)
      // Perpendicular offset, to sit the rail at the deck's edge.
      const px = -dz
      const pz = dx
      for (const side of [-1, 1]) {
        const ox = px * 0.42 * side
        const oz = pz * 0.42 * side
        b.strut(
          [ox, deckY + 0.34, oz],
          [dx * SPOKE_LENGTH + ox, deckY + 0.34, dz * SPOKE_LENGTH + oz],
          0.045,
          shade(wood, 0.08),
        )
        b.cylinder({
          radius: 0.04,
          height: 0.36,
          color: COLORS.woodDark,
          position: [dx * SPOKE_LENGTH * 0.55 + ox, deckY + 0.18, dz * SPOKE_LENGTH * 0.55 + oz],
          segments: 5,
        })
      }
    }
  }
}
