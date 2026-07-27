/**
 * Market pieces — stalls, the fountain, the bakery and the tavern.
 *
 * These are the pieces that pull a crowd, so they are modelled to look busy
 * even before the agent simulation adds anyone: goods stacked on counters,
 * chalk boards, hanging signs, crates and barrels. The props do a lot of the
 * "somebody works here" work, and they cost almost nothing.
 */

import { COLORS } from '@/world/catalog'
import { shade, tint } from '../geometry/builder'
import { addChimney, addDoor, addWindow } from './housing'
import type { PieceRenderer } from './context'

/** Awning stripe pairs — each stall picks one, which is its whole identity. */
const AWNINGS: [string, string][] = [
  [COLORS.clothRed, COLORS.cloth],
  [COLORS.clothBlue, COLORS.cloth],
  ['#79b087', COLORS.cloth],
  ['#e0a45f', COLORS.cloth],
]

/**
 * A market stall: four posts, a striped awning, and a counter of produce.
 *
 * The awning is built from alternating boxes rather than a texture, which keeps
 * the whole project asset-free and reads better at this scale anyway.
 */
export const marketStall: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const [stripeA, stripeB] = AWNINGS[ctx.variant % AWNINGS.length]
  const wood = tint(COLORS.wood, ctx.jitter('hue', 0.01), ctx.jitter('light', 0.05))
  const width = 1.0
  const depth = 0.72
  const postH = 0.92

  b.in({ rotationY: ctx.rotationY + ctx.jitter('spin', 0.05) }, () => {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.roundedBox({
          size: [0.07, postH, 0.07],
          color: wood,
          bevel: 0.018,
          position: [(sx * width) / 2, postH / 2, (sz * depth) / 2],
        })
      }
    }

    // Counter with a cloth over it.
    b.roundedBox({
      size: [width, 0.06, depth * 0.6],
      color: shade(wood, 0.08),
      bevel: 0.02,
      position: [0, 0.5, depth * 0.14],
    })
    b.box({
      size: [width * 0.98, 0.4, 0.03],
      color: stripeA,
      position: [0, 0.3, depth * 0.14 + (depth * 0.6) / 2],
    })

    // Striped awning: one ridged roof per stripe, tiled along X.
    //
    // `roof()` puts the ridge along X, so `width` is the length *along* the
    // ridge (one stripe's worth) and `depth` is the span the roof slopes
    // across. Passing an extra rotationY here would turn each stripe 90° and
    // make them all overlap instead of tiling — a mistake worth not repeating.
    const slats = 7
    for (let i = 0; i < slats; i++) {
      const x = -width / 2 + ((i + 0.5) / slats) * width
      const color = i % 2 === 0 ? stripeA : stripeB
      b.roof({
        // A hair of overlap, so no seam shows between stripes.
        width: width / slats + 0.01,
        depth: depth + 0.24,
        height: 0.16,
        color,
        position: [x, postH, 0],
      })
    }
    // Scalloped valance along the front edge.
    for (let i = 0; i < 8; i++) {
      const x = -width / 2 + ((i + 0.5) / 8) * width
      b.sphere({
        radius: 0.06,
        color: i % 2 === 0 ? stripeA : stripeB,
        position: [x, postH - 0.02, depth / 2 + 0.12],
        scale: [1, 0.9, 0.5],
        segments: 6,
      })
    }

    // Goods on the counter. Which produce is on show is per-tile.
    const goods = ctx.pick('goods', [
      { color: COLORS.roofRed, radius: 0.055 },
      { color: '#e5a33f', radius: 0.05 },
      { color: '#7fb356', radius: 0.06 },
      { color: '#b06fc0', radius: 0.045 },
    ])
    for (let i = 0; i < 6; i++) {
      const x = -width * 0.36 + (i / 5) * width * 0.72
      b.sphere({
        radius: goods.radius,
        color: shade(goods.color, ctx.jitter(`g${i}`, 0.1)),
        position: [x, 0.56 + ctx.jitter(`gy${i}`, 0.01), depth * 0.14 + ctx.jitter(`gz${i}`, 0.06)],
        segments: 6,
      })
    }
    // A crate of stock and a basket beside the stall.
    b.roundedBox({
      size: [0.24, 0.2, 0.22],
      color: COLORS.woodDark,
      bevel: 0.025,
      position: [-width * 0.38, 0.1, -depth * 0.5],
      rotationY: ctx.jitter('crateSpin', 0.3),
    })
    b.cylinder({
      radius: 0.11,
      radiusTop: 0.13,
      height: 0.14,
      color: COLORS.thatch,
      position: [width * 0.4, 0.07, -depth * 0.48],
      segments: 8,
    })
  })
}

/**
 * A tiered stone fountain.
 *
 * Water is drawn as flat discs of the palette's water colour rather than
 * anything transparent — the whole scene is opaque vertex-coloured geometry,
 * and a bright cyan disc reads perfectly well as water at this scale.
 */
export const fountain: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.stone, 0, ctx.jitter('light', 0.04))

  // Basin ring built from blocks so the masonry reads.
  const blocks = 14
  for (let i = 0; i < blocks; i++) {
    const angle = (i / blocks) * Math.PI * 2
    b.roundedBox({
      size: [0.16, 0.26, 0.16],
      color: shade(stone, ctx.jitter(`b${i}`, 0.1)),
      bevel: 0.035,
      position: [Math.cos(angle) * 0.6, 0.13, Math.sin(angle) * 0.6],
      rotationY: -angle,
    })
  }
  b.cylinder({ radius: 0.62, height: 0.1, color: shade(stone, -0.08), position: [0, 0.05, 0], segments: 16 })
  b.cylinder({ radius: 0.55, height: 0.06, color: COLORS.water, position: [0, 0.16, 0], segments: 16 })

  // Central column and upper bowls.
  b.cylinder({ radius: 0.13, height: 0.42, color: stone, position: [0, 0.36, 0], segments: 10 })
  b.cylinder({
    radius: 0.3,
    radiusTop: 0.34,
    height: 0.08,
    color: shade(stone, 0.06),
    position: [0, 0.6, 0],
    segments: 14,
  })
  b.cylinder({ radius: 0.28, height: 0.04, color: COLORS.water, position: [0, 0.65, 0], segments: 14 })

  b.cylinder({ radius: 0.08, height: 0.3, color: stone, position: [0, 0.79, 0], segments: 8 })
  b.sphere({ radius: 0.14, color: shade(stone, 0.1), position: [0, 0.98, 0], segments: 10 })

  // Water falling from the upper bowl and spouting from the top.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + ctx.range('spoutSpin', 0, 1)
    b.cylinder({
      radius: 0.022,
      height: 0.42,
      color: shade(COLORS.water, 0.22),
      position: [Math.cos(angle) * 0.31, 0.42, Math.sin(angle) * 0.31],
      segments: 5,
    })
  }
  b.cone({
    radius: 0.07,
    height: 0.24,
    color: shade(COLORS.water, 0.3),
    position: [0, 1.06, 0],
    segments: 8,
  })
}

/** A bakery: a shopfront with a display window, awning and a bread sign. */
export const bakery: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const wall = tint('#f6e3c8', 0, ctx.jitter('light', 0.03))
  const accent = '#c98a4f'
  const width = 0.98
  const depth = 0.82
  const wallHeight = 0.86

  b.in({ rotationY: ctx.rotationY }, () => {
    b.roundedBox({ size: [width, wallHeight, depth], color: wall, bevel: 0.05, position: [0, wallHeight / 2, 0] })
    b.roof({
      width,
      depth,
      height: 0.46,
      color: accent,
      overhang: 0.12,
      position: [0, wallHeight, 0],
    })

    // Big display window full of loaves.
    b.roundedBox({
      size: [0.05, 0.4, 0.5],
      color: COLORS.timber,
      bevel: 0.015,
      position: [width / 2, wallHeight * 0.55, -0.14],
    })
    b.box({ size: [0.03, 0.34, 0.44], color: '#ffe9b0', position: [width / 2 + 0.02, wallHeight * 0.55, -0.14] })
    for (let i = 0; i < 3; i++) {
      b.sphere({
        radius: 0.055,
        color: shade(COLORS.thatch, ctx.jitter(`loaf${i}`, 0.08) - 0.06),
        position: [width / 2 + 0.02, wallHeight * 0.44, -0.3 + i * 0.16],
        scale: [1, 0.8, 1.5],
        segments: 6,
      })
    }

    addDoor(ctx, width / 2, 0, 0.24, 0, 0.26, 0.5)
    addWindow(ctx, -width / 2, wallHeight * 0.6, 0, Math.PI, 0.2)
    addChimney(ctx, 0.2, wallHeight + 0.16, 0, 0.42)

    // Striped awning over the shopfront.
    for (let i = 0; i < 5; i++) {
      const z = -depth / 2 + ((i + 0.5) / 5) * depth
      b.box({
        size: [0.3, 0.04, depth / 5],
        color: i % 2 ? COLORS.cloth : '#d9866a',
        position: [width / 2 + 0.14, wallHeight * 0.82, z],
        rotationZ: -0.24,
      })
    }

    // Hanging sign: a pretzel on a bracket.
    b.strut([width / 2, wallHeight * 0.95, 0.42], [width / 2 + 0.28, wallHeight * 0.95, 0.42], 0.03, COLORS.timber)
    b.torus({
      radius: 0.1,
      tube: 0.03,
      color: '#b5773c',
      position: [width / 2 + 0.24, wallHeight * 0.95 - 0.14, 0.42],
      rotationX: Math.PI / 2,
      segments: 10,
    })
  })
}

/** A tavern: timbered, jettied, with lit windows, a swinging sign and barrels. */
export const tavern: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const wall = tint(COLORS.plasterWarm, 0, ctx.jitter('light', 0.03))
  const roofColor = '#8a5f4a'
  const width = 1.0
  const depth = 0.86
  const floor1 = 0.7
  const floor2 = 0.56

  b.in({ rotationY: ctx.rotationY }, () => {
    b.roundedBox({ size: [width, floor1, depth], color: wall, bevel: 0.05, position: [0, floor1 / 2, 0] })

    // Heavy exposed timber — the tavern is the most storybook building here.
    const t = 0.055
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box({
          size: [t * 1.6, floor1, t * 1.6],
          color: COLORS.timber,
          position: [(sx * width) / 2, floor1 / 2, (sz * depth) / 2],
        })
      }
    }
    for (const sz of [-1, 1]) {
      b.strut(
        [-width / 2 + 0.08, 0.06, (sz * depth) / 2],
        [width / 2 - 0.08, floor1 - 0.06, (sz * depth) / 2],
        t,
        COLORS.timber,
      )
    }

    const jetty = 0.08
    b.roundedBox({
      size: [width + jetty, floor2, depth + jetty],
      color: shade(wall, 0.04),
      bevel: 0.05,
      position: [0, floor1 + floor2 / 2, 0],
    })
    b.box({ size: [width + jetty + 0.02, 0.045, depth + jetty + 0.02], color: COLORS.timber, position: [0, floor1 + 0.02, 0] })

    b.roof({ width, depth, height: 0.5, color: roofColor, overhang: 0.15, position: [0, floor1 + floor2, 0] })
    addChimney(ctx, -0.24, floor1 + floor2 + 0.2, 0.1, 0.5)

    addDoor(ctx, width / 2, 0, -0.16, 0, 0.32, 0.52)
    addWindow(ctx, width / 2, floor1 * 0.62, 0.24, 0, 0.22)
    addWindow(ctx, (width + jetty) / 2, floor1 + floor2 * 0.55, 0.2, 0, 0.2)
    addWindow(ctx, (width + jetty) / 2, floor1 + floor2 * 0.55, -0.2, 0, 0.2)
    addWindow(ctx, -(width + jetty) / 2, floor1 + floor2 * 0.55, 0, Math.PI, 0.2)

    // Swinging sign with a painted tankard.
    b.strut([width / 2, floor1 * 0.94, 0.44], [width / 2 + 0.3, floor1 * 0.94, 0.44], 0.032, COLORS.timber)
    b.cylinder({ radius: 0.006, height: 0.1, color: COLORS.timber, position: [width / 2 + 0.26, floor1 * 0.88, 0.44], segments: 4 })
    b.roundedBox({
      size: [0.02, 0.2, 0.24],
      color: COLORS.woodDark,
      bevel: 0.015,
      position: [width / 2 + 0.26, floor1 * 0.72, 0.44],
    })
    b.cylinder({
      radius: 0.055,
      height: 0.02,
      color: COLORS.thatch,
      position: [width / 2 + 0.25, floor1 * 0.72, 0.44],
      rotationZ: Math.PI / 2,
      segments: 8,
    })

    // Barrels stacked by the door.
    for (let i = 0; i < 3; i++) {
      const angle = ctx.range(`ba${i}`, 0, Math.PI * 2)
      b.cylinder({
        radius: 0.12,
        radiusTop: 0.105,
        height: 0.22,
        color: shade(COLORS.wood, ctx.jitter(`bs${i}`, 0.08)),
        position: [width / 2 + 0.18, 0.11 + (i === 2 ? 0.22 : 0), -0.34 - i * 0.02 + Math.cos(angle) * 0.06],
        segments: 8,
      })
    }
  })
}
