/**
 * Castle pieces — walls, towers, gatehouses, the keep and banners.
 *
 * The wall is the other big autoconnect showcase. Like the fence it draws a hub
 * plus spokes, but with two extra behaviours that make a hand-drawn run of wall
 * look like fortification rather than a line of blocks:
 *
 *  - **Crenellations follow the run.** Merlons are laid along each spoke's own
 *    axis, so they stay square to the wall around corners.
 *  - **Dead ends get capped.** A wall that stops mid-air looks broken, so an
 *    unconnected end grows a buttress.
 *
 * Guards patrol the walkway on top; the walkway height is a shared constant so
 * the agent system can put them at the right elevation. See `WALL_WALK_HEIGHT`.
 */

import { HEX_WIDTH, directionVector, type HexDirection } from '@/core/hex'
import { connectedDirections, connectionHeading } from '@/world/autoconnect'
import { COLORS } from '@/world/catalog'
import { shade, tint } from '../geometry/builder'
import { addWindow } from './housing'
import type { PieceRenderer } from './context'

/**
 * Height of the wall walkway. The agent director places patrolling guards at
 * this elevation, so it must stay in sync with the geometry below.
 */
export const WALL_WALK_HEIGHT = 1.15

const SPOKE = HEX_WIDTH / 2

/** Crenellated stone curtain wall. */
export const castleWall: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const dirs = connectedDirections(ctx.mask)
  const stone = tint(COLORS.stone, ctx.jitter('hue', 0.008), ctx.jitter('light', 0.05))
  const wallW = 0.6
  const wallH = WALL_WALK_HEIGHT

  // Hub block, so corners are solid where two spokes meet.
  b.roundedBox({ size: [wallW, wallH, wallW], color: stone, bevel: 0.04, position: [0, wallH / 2, 0] })

  for (const d of dirs) {
    const [dx, dz] = directionVector(d)
    const angle = Math.atan2(-dz, dx)
    b.in({ rotationY: angle }, () => {
      // Wall body along +X after rotation.
      b.roundedBox({
        size: [SPOKE, wallH, wallW],
        color: shade(stone, ctx.jitter(`seg${d}`, 0.05)),
        bevel: 0.035,
        position: [SPOKE / 2, wallH / 2, 0],
      })
      // Stone coursing: a couple of darker bands break up the flat face.
      for (let i = 0; i < 2; i++) {
        b.box({
          size: [SPOKE * 0.98, 0.025, wallW + 0.02],
          color: shade(stone, -0.14),
          position: [SPOKE / 2, wallH * (0.35 + i * 0.3), 0],
        })
      }
      // Merlons along the top, square to this spoke.
      const merlons = 3
      for (let i = 0; i < merlons; i++) {
        const x = ((i + 0.5) / merlons) * SPOKE
        for (const sz of [-1, 1]) {
          b.roundedBox({
            size: [0.2, 0.22, 0.14],
            color: shade(stone, ctx.jitter(`m${d}${i}${sz}`, 0.08) + 0.04),
            bevel: 0.025,
            position: [x, wallH + 0.11, sz * (wallW / 2 - 0.07)],
          })
        }
      }
    })
  }

  // Merlons on the hub itself, so corners are not a gap in the battlement.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.roundedBox({
        size: [0.16, 0.22, 0.16],
        color: shade(stone, 0.04),
        bevel: 0.025,
        position: [sx * (wallW / 2 - 0.08), wallH + 0.11, sz * (wallW / 2 - 0.08)],
      })
    }
  }

  // Buttress any dead end, and any isolated block, so nothing floats.
  if (dirs.length <= 1) {
    const capDir: HexDirection = dirs.length ? ((dirs[0] + 3) % 6 as HexDirection) : 0
    const [dx, dz] = directionVector(capDir)
    b.roundedBox({
      size: [0.34, wallH * 0.72, 0.34],
      color: shade(stone, -0.06),
      bevel: 0.05,
      position: [dx * 0.34, wallH * 0.36, dz * 0.34],
      rotationY: Math.atan2(-dz, dx),
    })
  }
}

/** A round watchtower with a conical roof and a pennant. */
export const tower: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.stone, ctx.jitter('hue', 0.008), ctx.jitter('light', 0.04))
  const height = 2.6
  const radius = 0.46

  b.cylinder({ radius: radius + 0.08, height: 0.16, color: shade(stone, -0.1), position: [0, 0.08, 0], segments: 14 })
  b.cylinder({ radius, height, color: stone, position: [0, height / 2 + 0.1, 0], segments: 14 })

  for (let i = 0; i < 3; i++) {
    b.torus({
      radius: radius + 0.01,
      tube: 0.03,
      color: shade(stone, -0.14),
      position: [0, 0.5 + i * 0.7, 0],
      segments: 14,
    })
  }

  // Machicolation ring and crenellations.
  const topY = height + 0.1
  b.cylinder({ radius: radius + 0.12, height: 0.12, color: shade(stone, 0.06), position: [0, topY + 0.06, 0], segments: 14 })
  const merlons = 10
  for (let i = 0; i < merlons; i++) {
    const angle = (i / merlons) * Math.PI * 2
    b.roundedBox({
      size: [0.16, 0.2, 0.14],
      color: shade(stone, ctx.jitter(`m${i}`, 0.08) + 0.04),
      bevel: 0.025,
      position: [Math.cos(angle) * (radius + 0.04), topY + 0.22, Math.sin(angle) * (radius + 0.04)],
      rotationY: -angle,
    })
  }

  b.cone({
    radius: radius + 0.18,
    height: 0.8,
    color: ctx.pick('roof', [COLORS.roofBlue, COLORS.roofRed, '#6f7fa8']),
    position: [0, topY + 0.3, 0],
    segments: 14,
  })

  // Arrow slits.
  for (let i = 0; i < 3; i++) {
    const angle = ctx.range(`slit${i}`, 0, Math.PI * 2)
    b.in({ rotationY: angle }, () => {
      b.box({ size: [0.06, 0.28, 0.08], color: '#3a3a44', position: [radius, 0.6 + i * 0.6, 0] })
    })
  }
}

/**
 * A gatehouse: twin towers with an arch between them.
 *
 * The arch is oriented from the connection mask so the opening always lines up
 * with the wall it sits in — build a wall, drop a gate anywhere along it, and
 * the road passes straight through.
 */
export const gate: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.stone, 0, ctx.jitter('light', 0.04))
  const heading = connectionHeading(ctx.mask)
  const height = 1.7

  b.in({ rotationY: -heading }, () => {
    // Two flanking towers, offset perpendicular to the run.
    for (const sz of [-1, 1]) {
      b.roundedBox({
        size: [0.52, height, 0.46],
        color: stone,
        bevel: 0.05,
        position: [0, height / 2, sz * 0.56],
      })
      for (let i = 0; i < 3; i++) {
        b.roundedBox({
          size: [0.14, 0.2, 0.14],
          color: shade(stone, 0.05),
          bevel: 0.025,
          position: [(i - 1) * 0.17, height + 0.1, sz * 0.56],
        })
      }
      b.box({ size: [0.06, 0.24, 0.08], color: '#3a3a44', position: [0.26, height * 0.62, sz * 0.56] })
    }

    // Lintel spanning the towers, plus a walkway above the opening.
    b.roundedBox({ size: [0.5, 0.3, 0.72], color: shade(stone, -0.05), bevel: 0.04, position: [0, height - 0.15, 0] })
    b.roundedBox({ size: [0.56, 0.14, 0.86], color: shade(stone, 0.06), bevel: 0.03, position: [0, height + 0.07, 0] })
    for (let i = 0; i < 3; i++) {
      b.roundedBox({
        size: [0.14, 0.18, 0.14],
        color: shade(stone, 0.05),
        bevel: 0.025,
        position: [0, height + 0.22, (i - 1) * 0.28],
      })
    }

    // The arch itself: stacked voussoir blocks around the opening.
    const arcBlocks = 7
    for (let i = 0; i < arcBlocks; i++) {
      const a = Math.PI * (0.06 + (i / (arcBlocks - 1)) * 0.88)
      b.roundedBox({
        size: [0.5, 0.14, 0.15],
        color: shade(stone, ctx.jitter(`v${i}`, 0.08) - 0.04),
        bevel: 0.02,
        position: [0, 0.92 + Math.sin(a) * 0.3, Math.cos(a) * 0.42],
        rotationX: -a + Math.PI / 2,
      })
    }

    // Portcullis grid, raised.
    for (let i = 0; i < 5; i++) {
      b.cylinder({
        radius: 0.018,
        height: 0.34,
        color: '#4b4a52',
        position: [-0.2, height - 0.32, -0.3 + i * 0.15],
        segments: 4,
      })
    }
  })
}

/** The keep: a broad stone hall with corner turrets and a banner-topped tower. */
export const keep: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.stone, 0, ctx.jitter('light', 0.03))
  const width = 1.1
  const depth = 0.98
  const bodyH = 1.5

  b.in({ rotationY: ctx.rotationY }, () => {
    b.roundedBox({ size: [width + 0.2, 0.14, depth + 0.2], color: shade(stone, -0.1), bevel: 0.03, position: [0, 0.07, 0] })
    b.roundedBox({ size: [width, bodyH, depth], color: stone, bevel: 0.05, position: [0, bodyH / 2 + 0.1, 0] })

    // Battlements around the main body.
    const perX = 4
    const perZ = 4
    for (let i = 0; i < perX; i++) {
      const x = -width / 2 + ((i + 0.5) / perX) * width
      for (const sz of [-1, 1]) {
        b.roundedBox({
          size: [0.16, 0.2, 0.14],
          color: shade(stone, ctx.jitter(`bx${i}${sz}`, 0.07) + 0.04),
          bevel: 0.025,
          position: [x, bodyH + 0.2, (sz * depth) / 2 - sz * 0.06],
        })
      }
    }
    for (let i = 0; i < perZ; i++) {
      const z = -depth / 2 + ((i + 0.5) / perZ) * depth
      for (const sx of [-1, 1]) {
        b.roundedBox({
          size: [0.14, 0.2, 0.16],
          color: shade(stone, ctx.jitter(`bz${i}${sx}`, 0.07) + 0.04),
          bevel: 0.025,
          position: [(sx * width) / 2 - sx * 0.06, bodyH + 0.2, z],
        })
      }
    }

    // Corner turrets.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tx = (sx * width) / 2
        const tz = (sz * depth) / 2
        b.cylinder({ radius: 0.2, height: bodyH + 0.5, color: shade(stone, 0.04), position: [tx, (bodyH + 0.5) / 2 + 0.1, tz], segments: 10 })
        b.cone({ radius: 0.26, height: 0.42, color: COLORS.roofBlue, position: [tx, bodyH + 0.6, tz], segments: 10 })
      }
    }

    // Great door and windows.
    b.roundedBox({ size: [0.06, 0.62, 0.4], color: COLORS.timber, bevel: 0.02, position: [width / 2, 0.41, 0] })
    for (let i = 0; i < 5; i++) {
      b.cylinder({
        radius: 0.02,
        height: 0.56,
        color: '#4b4a52',
        position: [width / 2 + 0.03, 0.41, -0.16 + i * 0.08],
        segments: 4,
      })
    }
    for (const z of [-0.3, 0.3]) {
      addWindow(ctx, width / 2, bodyH * 0.75, z, 0, 0.18)
      addWindow(ctx, -width / 2, bodyH * 0.75, z, Math.PI, 0.18)
    }
  })
}

/**
 * A banner on a pole. The cloth is an animated prop placed by the chunk baker
 * so it can ripple — see `../animated.tsx`.
 */
export const banner: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const poleH = 2.2

  b.in({ position: [ctx.jitter('x', 0.12), 0, ctx.jitter('z', 0.12)] }, () => {
    b.cylinder({ radius: 0.13, height: 0.1, color: COLORS.stoneDark, position: [0, 0.05, 0], segments: 8 })
    b.cylinder({ radius: 0.045, height: poleH, color: COLORS.woodDark, position: [0, poleH / 2 + 0.08, 0], segments: 8 })
    b.sphere({ radius: 0.07, color: COLORS.thatch, position: [0, poleH + 0.14, 0], segments: 8 })
  })
}

/** Banner cloth colours, indexed by piece variant. Shared with the animated prop. */
export const BANNER_COLORS = [COLORS.banner, COLORS.clothBlue, '#6f9a5f', '#8a6fb0']
