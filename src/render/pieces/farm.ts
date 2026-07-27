/**
 * Farm pieces — crop fields, the barn, the windmill, animal pens and scarecrows.
 *
 * The field is the interesting one. Like paths and fences it uses the
 * autoconnect mask, but for a different purpose: instead of drawing spokes, it
 * **aligns its furrows with the run of the field** and suppresses the raised
 * bank on any edge it shares with another field. Two adjacent field tiles
 * therefore read as one continuous ploughed area rather than two tiles that
 * happen to be next to each other.
 */

import { HEX_SIZE, HEX_WIDTH, directionVector } from '@/core/hex'
import { connectedDirections, hasConnection } from '@/world/autoconnect'
import { COLORS } from '@/world/catalog'
import { shade, tint } from '../geometry/builder'
import type { PieceRenderer } from './context'

/**
 * The axis every connected field is ploughed along, in radians.
 *
 * Chosen to run across the default camera rather than straight at it, so the
 * rows read as rows instead of converging to a point.
 */
const FIELD_FURROW_HEADING = Math.PI / 6

/** Crop appearances, cycled through by variant so a farm has mixed produce. */
const CROPS = [
  { stalk: COLORS.cropYoung, head: COLORS.crop, tall: true }, // wheat
  { stalk: '#5fa04f', head: '#e0644f', tall: false }, // tomatoes
  { stalk: '#6fae4c', head: '#d9c26a', tall: false }, // squash
]

/**
 * A ploughed field with crops in rows.
 *
 * Furrows run perpendicular to the field's overall heading so rows continue
 * across tile boundaries, and each tile's crops are individually jittered so
 * the rows are not mechanically perfect.
 */
export const field: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const crop = CROPS[ctx.variant % CROPS.length]
  const soil = tint(COLORS.soil, ctx.jitter('hue', 0.01), ctx.jitter('light', 0.05))
  const dirs = connectedDirections(ctx.mask)

  /*
   * Furrow direction.
   *
   * Every tile that is part of a larger field ploughs along the *same* fixed
   * axis, so rows run unbroken across tile boundaries and a farm reads as one
   * worked estate rather than a patchwork of hexes.
   *
   * Deriving this per tile from `connectionHeading` was the obvious approach
   * and looks wrong: an interior tile connects on all six sides, those
   * directions cancel out, and neighbouring tiles end up ploughed at different
   * angles. A shared constant is both simpler and what real fields look like.
   *
   * Only a lone plot gets its own angle, where there is no neighbour to agree
   * with and a little variety is welcome.
   */
  const heading = dirs.length ? FIELD_FURROW_HEADING : ctx.range('heading', 0, Math.PI)

  b.in({ rotationY: -heading }, () => {
    // Ploughed base: a low hex slab plus raised furrow ridges.
    // Circumradius, not inradius: `HEX_WIDTH / 2` is the centre-to-edge
    // distance and would leave a gap at every corner between adjacent plots.
    // The slight oversize hides floating-point seams along shared edges.
    b.prism({
      radius: HEX_SIZE * 1.002,
      height: 0.06,
      color: soil,
      position: [0, 0.03, 0],
      rotationY: heading,
    })

    const rows = 5
    const spacing = 0.3
    for (let i = 0; i < rows; i++) {
      const z = (i - (rows - 1) / 2) * spacing
      // Furrow ridge.
      b.roundedBox({
        size: [1.32, 0.05, 0.14],
        color: shade(soil, ctx.jitter(`ridge${i}`, 0.08) - 0.04),
        bevel: 0.02,
        position: [0, 0.07, z],
      })

      // Crops along the ridge.
      const perRow = 4
      for (let j = 0; j < perRow; j++) {
        const x = (j - (perRow - 1) / 2) * 0.32 + ctx.jitter(`cx${i}${j}`, 0.05)
        const height = crop.tall
          ? ctx.range(`ch${i}${j}`, 0.22, 0.34)
          : ctx.range(`ch${i}${j}`, 0.12, 0.19)

        b.cone({
          radius: crop.tall ? 0.045 : 0.075,
          height,
          color: shade(crop.stalk, ctx.jitter(`cs${i}${j}`, 0.08)),
          position: [x, 0.09, z + ctx.jitter(`cz${i}${j}`, 0.03)],
          rotationZ: ctx.jitter(`ct${i}${j}`, 0.12),
          segments: 4,
        })
        if (crop.tall) {
          b.sphere({
            radius: 0.035,
            color: crop.head,
            position: [x, 0.09 + height, z],
            scale: [0.7, 1.5, 0.7],
            segments: 5,
          })
        } else if (ctx.chance(`fruit${i}${j}`, 0.7)) {
          b.sphere({
            radius: 0.05,
            color: crop.head,
            position: [x + 0.05, 0.13, z + 0.05],
            segments: 6,
          })
        }
      }
    }
  })

  // A low earth bank on every edge that is *not* shared with another field, so
  // the outside of a farm is bounded but its interior stays continuous.
  for (let d = 0; d < 6; d++) {
    if (hasConnection(ctx.mask, d as 0)) continue
    const [dx, dz] = directionVector(d as 0)
    b.roundedBox({
      size: [0.16, 0.1, 0.9],
      color: shade(soil, -0.12),
      bevel: 0.03,
      position: [dx * (HEX_WIDTH / 2 - 0.06), 0.05, dz * (HEX_WIDTH / 2 - 0.06)],
      rotationY: Math.atan2(-dz, dx),
    })
  }
}

/** A red-boarded barn with big doors and a hay loft. */
export const barn: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const boards = tint('#c4514a', ctx.jitter('hue', 0.008), ctx.jitter('light', 0.04))
  const trim = COLORS.flowerWhite
  const width = 1.05
  const depth = 0.9
  const wallHeight = 0.72

  b.in({ rotationY: ctx.rotationY + ctx.jitter('spin', 0.04) }, () => {
    b.roundedBox({
      size: [width, wallHeight, depth],
      color: boards,
      bevel: 0.05,
      position: [0, wallHeight / 2, 0],
    })

    // Vertical board lines, cheap but they sell the material.
    for (let i = 0; i < 6; i++) {
      const z = -depth / 2 + ((i + 0.5) / 6) * depth
      b.box({
        size: [0.02, wallHeight * 0.9, 0.025],
        color: shade(boards, -0.14),
        position: [width / 2, wallHeight / 2, z],
      })
    }

    // Gambrel-ish roof: two stacked pitches, which is what makes a barn a barn.
    b.roof({
      width,
      depth: depth * 0.62,
      height: 0.3,
      color: shade(boards, -0.16),
      overhang: 0.09,
      position: [0, wallHeight, 0],
    })
    b.roof({
      width,
      depth: depth * 0.34,
      height: 0.28,
      color: shade(boards, -0.1),
      overhang: 0.03,
      position: [0, wallHeight + 0.28, 0],
    })

    // Doors: two leaves with white cross-bracing.
    const doorW = 0.46
    const doorH = 0.52
    b.roundedBox({
      size: [0.05, doorH, doorW],
      color: shade(boards, -0.2),
      bevel: 0.015,
      position: [width / 2, doorH / 2, 0],
    })
    for (const sz of [-1, 1]) {
      b.box({
        size: [0.03, doorH * 0.94, 0.03],
        color: trim,
        position: [width / 2 + 0.03, doorH / 2, (sz * doorW) / 2 - sz * 0.03],
      })
      b.strut(
        [width / 2 + 0.03, 0.03, sz * 0.02],
        [width / 2 + 0.03, doorH - 0.03, (sz * doorW) / 2],
        0.028,
        trim,
      )
    }
    b.box({ size: [0.03, 0.03, doorW], color: trim, position: [width / 2 + 0.03, doorH * 0.55, 0] })

    // Hay loft opening with straw spilling out.
    b.box({
      size: [0.04, 0.2, 0.24],
      color: '#5a3d33',
      position: [width / 2, wallHeight + 0.14, 0],
    })
    for (let i = 0; i < 4; i++) {
      b.cone({
        radius: 0.03,
        height: 0.12,
        color: COLORS.thatch,
        position: [width / 2 + 0.03, wallHeight + 0.06, ctx.jitter(`hay${i}`, 0.09)],
        rotationZ: Math.PI / 2 + ctx.jitter(`hayT${i}`, 0.4),
        segments: 4,
      })
    }

    // A haystack beside the barn.
    if (ctx.chance('haystack', 0.6)) {
      b.cone({
        radius: 0.22,
        height: 0.34,
        color: COLORS.thatch,
        position: [-width * 0.35, 0, depth * 0.62],
        segments: 8,
      })
    }
  })
}

/**
 * A windmill. The tower and cap are baked; the sails are an animated prop
 * placed by the chunk baker — see `../animated.tsx`.
 */
export const windmill: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.plaster, 0, ctx.jitter('light', 0.03))
  const towerHeight = 1.7

  b.in({ rotationY: ctx.rotationY }, () => {
    b.cylinder({
      radius: 0.44,
      radiusTop: 0.3,
      height: towerHeight,
      color: stone,
      position: [0, towerHeight / 2, 0],
      segments: 12,
    })

    // A spiral of stone banding around the tower.
    for (let i = 0; i < 3; i++) {
      const y = 0.3 + i * 0.5
      b.torus({
        radius: 0.44 - (y / towerHeight) * 0.14,
        tube: 0.035,
        color: shade(stone, -0.12),
        position: [0, y, 0],
        segments: 12,
      })
    }

    b.cone({
      radius: 0.38,
      height: 0.4,
      color: COLORS.roofRed,
      position: [0, towerHeight, 0],
      segments: 12,
    })

    addWindowSlit(0.5, 0)
    addWindowSlit(1.0, Math.PI * 0.66)
    addWindowSlit(1.35, Math.PI * 1.4)

    // Door at the base.
    b.roundedBox({
      size: [0.06, 0.44, 0.28],
      color: COLORS.woodDark,
      bevel: 0.015,
      position: [0.42, 0.22, 0],
    })
  })

  function addWindowSlit(y: number, angle: number): void {
    const r = 0.44 - (y / towerHeight) * 0.14
    b.in({ rotationY: angle }, () => {
      b.box({ size: [0.05, 0.16, 0.12], color: '#ffe9b0', position: [r, y, 0] })
      b.roundedBox({ size: [0.04, 0.2, 0.16], color: COLORS.woodDark, bevel: 0.012, position: [r - 0.02, y, 0] })
    })
  }
}

/**
 * An animal pen: a fenced patch of trodden earth with a feed trough.
 *
 * Shares the `fence` connection group, so pens link up with hand-placed fences
 * and with each other.
 */
export const pen: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const wood = tint(COLORS.wood, ctx.jitter('hue', 0.01), ctx.jitter('light', 0.05))

  // Trodden ground.
  // Slightly inset on purpose, so a pen reads as a trodden patch within its
  // tile rather than as ground in its own right.
  b.prism({
    radius: HEX_SIZE * 0.96,
    height: 0.04,
    color: shade(COLORS.dirt, -0.06),
    position: [0, 0.02, 0],
  })

  // Rails on every *unconnected* edge, so a run of pens is open in the middle
  // and fenced only around its outside.
  for (let d = 0; d < 6; d++) {
    if (hasConnection(ctx.mask, d as 0)) continue
    const [dx, dz] = directionVector(d as 0)
    const cx = dx * (HEX_WIDTH / 2 - 0.04)
    const cz = dz * (HEX_WIDTH / 2 - 0.04)
    const angle = Math.atan2(-dz, dx)

    b.in({ position: [cx, 0, cz], rotationY: angle }, () => {
      for (const sz of [-1, 1]) {
        b.roundedBox({
          size: [0.08, 0.5, 0.08],
          color: wood,
          bevel: 0.018,
          position: [0, 0.25, sz * 0.44],
          rotationZ: ctx.jitter(`post${d}${sz}`, 0.05),
        })
      }
      for (const y of [0.42, 0.24]) {
        b.box({ size: [0.05, 0.05, 0.92], color: shade(wood, ctx.jitter(`rail${d}${y}`, 0.07)), position: [0, y, 0] })
      }
    })
  }

  // Feed trough and a scatter of straw.
  b.in({ rotationY: ctx.range('troughSpin', 0, Math.PI * 2), position: [ctx.jitter('tx', 0.2), 0, ctx.jitter('tz', 0.2)] }, () => {
    b.roundedBox({ size: [0.44, 0.12, 0.2], color: COLORS.woodDark, bevel: 0.03, position: [0, 0.08, 0] })
    b.box({ size: [0.36, 0.06, 0.13], color: COLORS.thatch, position: [0, 0.13, 0] })
  })
  for (let i = 0; i < 5; i++) {
    const angle = ctx.range(`sa${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`sd${i}`, 0.2, 0.6)
    b.box({
      size: [0.12, 0.015, 0.03],
      color: COLORS.thatch,
      position: [Math.cos(angle) * dist, 0.045, Math.sin(angle) * dist],
      rotationY: ctx.range(`sr${i}`, 0, Math.PI),
    })
  }
}

/** A scarecrow: crossed poles, a straw body and a pumpkin head. */
export const scarecrow: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const shirt = ctx.pick('shirt', [COLORS.clothRed, COLORS.clothBlue, '#8fae6a', '#c9a05f'])

  b.in({ rotationY: ctx.range('spin', 0, Math.PI * 2), rotationZ: ctx.jitter('lean', 0.08) }, () => {
    b.cylinder({ radius: 0.045, height: 1.3, color: COLORS.woodDark, position: [0, 0.65, 0], segments: 6 })
    b.cylinder({
      radius: 0.035,
      height: 0.86,
      color: COLORS.woodDark,
      position: [0, 0.95, 0],
      rotationZ: Math.PI / 2,
      segments: 6,
    })

    // Body.
    b.roundedBox({ size: [0.34, 0.42, 0.24], color: shirt, bevel: 0.06, position: [0, 0.86, 0] })
    // Straw poking out of the sleeves and hem.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        b.cone({
          radius: 0.022,
          height: 0.14,
          color: COLORS.thatch,
          position: [sx * 0.42, 0.95 + ctx.jitter(`sy${sx}${i}`, 0.03), ctx.jitter(`sz${sx}${i}`, 0.05)],
          rotationZ: (sx * Math.PI) / 2 + ctx.jitter(`st${sx}${i}`, 0.5),
          segments: 4,
        })
      }
    }

    // Pumpkin head with a carved grin.
    b.sphere({ radius: 0.19, color: '#e08a3c', position: [0, 1.24, 0], scale: [1, 0.88, 1], segments: 10 })
    b.cylinder({ radius: 0.035, height: 0.08, color: COLORS.leafDeep, position: [0, 1.42, 0], segments: 5 })
    for (const sx of [-1, 1]) {
      b.box({ size: [0.06, 0.05, 0.03], color: '#3a2a20', position: [sx * 0.06, 1.28, 0.17] })
    }
    b.box({ size: [0.14, 0.04, 0.03], color: '#3a2a20', position: [0, 1.18, 0.17] })

    // Straw hat.
    b.cylinder({ radius: 0.28, height: 0.025, color: COLORS.thatch, position: [0, 1.4, 0], segments: 10 })
    b.cylinder({ radius: 0.14, height: 0.14, color: shade(COLORS.thatch, -0.08), position: [0, 1.47, 0], segments: 10 })
  })
}
