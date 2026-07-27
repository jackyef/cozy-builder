/**
 * Homes — cottages, town houses, the town hall, the well and lamp posts.
 *
 * ## What makes these read as cosy
 *
 * Three things, applied consistently across every building here:
 *
 *  1. **Chamfered everything.** No hard 90° edge anywhere. `roundedBox` costs a
 *     few extra triangles and does more for the style than any amount of extra
 *     detail would.
 *  2. **Oversized roofs.** Roofs overhang their walls generously and are pitched
 *     steeply. A roof that reaches past the walls casts a soft shadow line down
 *     the facade and makes the building look sheltering rather than boxy.
 *  3. **Warm windows.** Windows are emissive-bright cream, not dark glass. A
 *     lit window is the single strongest "someone lives here" signal available,
 *     and it costs one small quad.
 *
 * Variance is per-hex and deterministic: roof colour, wall tint, building
 * height, door placement and window count all wobble, so a street of cottages
 * is a street rather than a row of clones.
 */

import { COLORS } from '@/world/catalog'
import { shade, tint, type ColorInput } from '../geometry/builder'
import type { PieceContext, PieceRenderer } from './context'

const ROOF_COLORS = [
  COLORS.roofRed,
  COLORS.roofBlue,
  COLORS.roofGreen,
  COLORS.roofOrange,
  COLORS.roofPurple,
  COLORS.thatch,
]

const WALL_COLORS = [COLORS.plaster, COLORS.plasterWarm, '#f7e3cd', '#eee0cd']

/** Warm interior glow used for every window in the village. */
const WINDOW_GLOW = '#ffe9b0'

// ---------------------------------------------------------------------------
// Shared building parts
// ---------------------------------------------------------------------------

/** A window: a recessed frame with a bright pane and a cross mullion. */
export function addWindow(
  ctx: PieceContext,
  x: number,
  y: number,
  z: number,
  facing: number,
  size = 0.26,
  frameColor: ColorInput = COLORS.woodDark,
): void {
  const { builder: b } = ctx
  b.in({ position: [x, y, z], rotationY: facing }, () => {
    b.roundedBox({ size: [0.04, size * 1.24, size * 1.24], color: frameColor, bevel: 0.012 })
    b.box({ size: [0.03, size, size], color: WINDOW_GLOW, position: [0.02, 0, 0] })
    // Mullions: two thin bars, which is enough to make a pane read as glazed.
    b.box({ size: [0.02, size * 1.02, 0.032], color: frameColor, position: [0.035, 0, 0] })
    b.box({ size: [0.02, 0.032, size * 1.02], color: frameColor, position: [0.035, 0, 0] })
    // A sill catches light along the bottom edge and grounds the window.
    b.roundedBox({
      size: [0.09, 0.04, size * 1.4],
      color: shade(frameColor, 0.18),
      bevel: 0.012,
      position: [0.02, -size * 0.7, 0],
    })
  })
}

/** A door with a frame, a step and a handle. */
export function addDoor(
  ctx: PieceContext,
  x: number,
  y: number,
  z: number,
  facing: number,
  width = 0.3,
  height = 0.52,
): void {
  const { builder: b } = ctx
  const doorColor = ctx.pick('doorColor', [COLORS.woodDark, COLORS.roofRed, '#5f7f9c', '#7a5a86'])
  b.in({ position: [x, y, z], rotationY: facing }, () => {
    b.roundedBox({
      size: [0.05, height * 1.12, width * 1.16],
      color: COLORS.timber,
      bevel: 0.014,
      position: [0, height / 2, 0],
    })
    b.roundedBox({
      size: [0.05, height, width],
      color: doorColor,
      bevel: 0.014,
      position: [0.02, height / 2, 0],
    })
    b.sphere({
      radius: 0.032,
      color: COLORS.thatch,
      position: [0.06, height * 0.48, width * 0.27],
      segments: 6,
    })
    // A stone step, so the door meets the ground instead of floating on it.
    b.roundedBox({
      size: [0.16, 0.06, width * 1.3],
      color: COLORS.stone,
      bevel: 0.018,
      position: [0.08, 0.03, 0],
    })
  })
}

/**
 * A chimney with a stone stack and a cap.
 *
 * Sits at a random offset along the ridge, which is a surprisingly effective
 * silhouette-breaker across a row of otherwise similar roofs.
 */
export function addChimney(
  ctx: PieceContext,
  x: number,
  baseY: number,
  z: number,
  height = 0.5,
): void {
  const { builder: b } = ctx
  const stone = tint(COLORS.stoneDark, ctx.jitter('chimHue', 0.01), ctx.jitter('chimLight', 0.06))
  b.roundedBox({
    size: [0.19, height, 0.19],
    color: stone,
    bevel: 0.03,
    position: [x, baseY + height / 2, z],
    rotationY: ctx.jitter('chimSpin', 0.12),
  })
  b.roundedBox({
    size: [0.26, 0.07, 0.26],
    color: shade(stone, -0.12),
    bevel: 0.02,
    position: [x, baseY + height + 0.02, z],
  })
}

/**
 * A gable-roofed building body: walls, roof, overhang, and optional exposed
 * timber framing. The shared skeleton behind cottages, houses and shops.
 */
export function addGableBuilding(
  ctx: PieceContext,
  opts: {
    width: number
    depth: number
    wallHeight: number
    roofHeight: number
    wallColor: ColorInput
    roofColor: ColorInput
    /** Timber framing on the walls, for the storybook look. */
    timbered?: boolean
    /** Ridge along X (default) or along Z. */
    ridgeAlongZ?: boolean
  },
): void {
  const { builder: b } = ctx
  const { width, depth, wallHeight, roofHeight, wallColor, roofColor } = opts
  const ridgeRotation = opts.ridgeAlongZ ? Math.PI / 2 : 0

  b.roundedBox({
    size: [width, wallHeight, depth],
    color: wallColor,
    bevel: 0.05,
    position: [0, wallHeight / 2, 0],
  })

  if (opts.timbered) {
    const timber = COLORS.timber
    const t = 0.045
    // Corner posts plus a mid rail — enough to suggest a frame without
    // modelling one, and it survives being seen from any angle.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box({
          size: [t * 1.6, wallHeight, t * 1.6],
          color: timber,
          position: [(sx * width) / 2, wallHeight / 2, (sz * depth) / 2],
        })
      }
    }
    b.box({
      size: [width * 1.01, t, depth * 1.01],
      color: timber,
      position: [0, wallHeight * 0.58, 0],
    })
  }

  const roofBase = wallHeight
  const overhang = 0.11
  b.roof({
    width: opts.ridgeAlongZ ? depth : width,
    depth: opts.ridgeAlongZ ? width : depth,
    height: roofHeight,
    color: roofColor,
    overhang,
    position: [0, roofBase, 0],
    rotationY: ridgeRotation,
  })

  // A darker fascia board under the eaves. This one small strip does most of
  // the work of separating roof from wall visually.
  const fasciaW = (opts.ridgeAlongZ ? depth : width) + overhang * 2
  const fasciaD = (opts.ridgeAlongZ ? width : depth) + overhang * 2
  b.in({ position: [0, roofBase, 0], rotationY: ridgeRotation }, () => {
    for (const sz of [-1, 1]) {
      b.box({
        size: [fasciaD, 0.05, 0.05],
        color: shade(roofColor, -0.22),
        position: [0, -0.01, (sz * fasciaW) / 2],
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A small single-storey home. The most common building in any village. */
export const cottage: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const roofColor = tint(
    ROOF_COLORS[ctx.variant % ROOF_COLORS.length],
    ctx.jitter('roofHue', 0.015),
    ctx.jitter('roofLight', 0.05),
  )
  const wallColor = tint(ctx.pick('wall', WALL_COLORS), ctx.jitter('wallHue', 0.01), ctx.jitter('wallLight', 0.04))

  const width = ctx.range('w', 0.88, 1.02)
  const depth = ctx.range('d', 0.76, 0.9)
  const wallHeight = ctx.range('h', 0.62, 0.78)
  const roofHeight = ctx.range('rh', 0.52, 0.68)

  b.in({ rotationY: ctx.rotationY + ctx.jitter('spin', 0.06) }, () => {
    addGableBuilding(ctx, {
      width,
      depth,
      wallHeight,
      roofHeight,
      wallColor,
      roofColor,
      timbered: ctx.chance('timbered', 0.45),
    })

    // Door on the +X face, windows either side of it and one on the back.
    addDoor(ctx, width / 2, 0, ctx.jitter('doorZ', 0.12), 0)
    addWindow(ctx, width / 2, wallHeight * 0.62, depth * 0.34, 0, 0.2)
    addWindow(ctx, -width / 2, wallHeight * 0.62, ctx.jitter('backWinZ', 0.2), Math.PI, 0.2)
    if (ctx.chance('sideWindow', 0.6)) {
      addWindow(ctx, ctx.jitter('sideWinX', 0.2), wallHeight * 0.62, depth / 2, Math.PI / 2, 0.2)
    }

    addChimney(ctx, ctx.jitter('chimX', width * 0.28), wallHeight + roofHeight * 0.35, ctx.jitter('chimZ', 0.08), 0.42)

    // A window box or a barrel by the door — small props that suggest the
    // building is used, at almost no triangle cost.
    if (ctx.chance('planter', 0.5)) {
      b.roundedBox({
        size: [0.1, 0.09, 0.3],
        color: COLORS.woodDark,
        bevel: 0.02,
        position: [width / 2 + 0.06, wallHeight * 0.46, depth * 0.34],
      })
      for (let i = 0; i < 3; i++) {
        b.sphere({
          radius: 0.045,
          color: ctx.pick(`bloom${i}`, [COLORS.flowerPink, COLORS.flowerYellow, COLORS.flowerWhite]),
          position: [width / 2 + 0.06, wallHeight * 0.52, depth * 0.34 + (i - 1) * 0.09],
          segments: 6,
        })
      }
    }
    if (ctx.chance('barrel', 0.35)) {
      b.cylinder({
        radius: 0.11,
        height: 0.2,
        color: COLORS.wood,
        position: [width / 2 - 0.05, 0.1, -depth * 0.42],
        segments: 8,
      })
    }
  })
}

/** A taller two-storey house with a jettied upper floor. */
export const house: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const roofColor = tint(
    ROOF_COLORS[(ctx.variant + 2) % ROOF_COLORS.length],
    ctx.jitter('roofHue', 0.015),
    ctx.jitter('roofLight', 0.05),
  )
  const wallColor = tint(ctx.pick('wall', WALL_COLORS), ctx.jitter('wallHue', 0.01), ctx.jitter('wallLight', 0.04))

  const width = ctx.range('w', 0.8, 0.94)
  const depth = ctx.range('d', 0.72, 0.86)
  const floor1 = ctx.range('h1', 0.62, 0.72)
  const floor2 = ctx.range('h2', 0.56, 0.66)
  const roofHeight = ctx.range('rh', 0.5, 0.62)

  b.in({ rotationY: ctx.rotationY + ctx.jitter('spin', 0.05) }, () => {
    b.roundedBox({
      size: [width, floor1, depth],
      color: shade(wallColor, -0.05),
      bevel: 0.05,
      position: [0, floor1 / 2, 0],
    })

    // The upper floor overhangs slightly — a jetty. It is the detail that most
    // reads as "old town" and it breaks up an otherwise plain box.
    const jetty = 0.07
    b.roundedBox({
      size: [width + jetty, floor2, depth + jetty],
      color: wallColor,
      bevel: 0.05,
      position: [0, floor1 + floor2 / 2, 0],
    })
    b.box({
      size: [width + jetty + 0.02, 0.04, depth + jetty + 0.02],
      color: COLORS.timber,
      position: [0, floor1 + 0.02, 0],
    })

    b.roof({
      width,
      depth,
      height: roofHeight,
      color: roofColor,
      overhang: 0.13,
      position: [0, floor1 + floor2, 0],
    })

    addDoor(ctx, width / 2, 0, ctx.jitter('doorZ', 0.1), 0, 0.28, 0.5)
    addWindow(ctx, width / 2, floor1 * 0.66, depth * 0.3, 0, 0.18)
    addWindow(ctx, (width + jetty) / 2, floor1 + floor2 * 0.55, 0.18, 0, 0.2)
    addWindow(ctx, (width + jetty) / 2, floor1 + floor2 * 0.55, -0.18, 0, 0.2)
    addWindow(ctx, -(width + jetty) / 2, floor1 + floor2 * 0.55, 0, Math.PI, 0.2)
    addChimney(ctx, ctx.jitter('chimX', 0.2), floor1 + floor2 + roofHeight * 0.4, ctx.jitter('chimZ', 0.1), 0.46)
  })
}

/** The civic centre: a wide hall with a portico, a clock and a bell tower. */
export const townHall: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.plaster, 0, ctx.jitter('light', 0.03))
  const roofColor = COLORS.roofBlue
  const width = 1.15
  const depth = 0.95
  const wallHeight = 0.86

  b.in({ rotationY: ctx.rotationY }, () => {
    // Plinth — civic buildings sit on a base, which instantly reads as important.
    b.roundedBox({
      size: [width + 0.16, 0.1, depth + 0.16],
      color: COLORS.stone,
      bevel: 0.03,
      position: [0, 0.05, 0],
    })

    addGableBuilding(ctx, {
      width,
      depth,
      wallHeight,
      roofHeight: 0.5,
      wallColor: stone,
      roofColor,
    })

    // Portico: four columns and a pediment over the entrance.
    const porchDepth = 0.26
    for (let i = 0; i < 4; i++) {
      const z = -depth * 0.34 + (i / 3) * depth * 0.68
      b.cylinder({
        radius: 0.055,
        height: wallHeight * 0.82,
        color: COLORS.plaster,
        position: [width / 2 + porchDepth * 0.7, (wallHeight * 0.82) / 2 + 0.1, z],
        segments: 8,
      })
    }
    b.roundedBox({
      size: [porchDepth + 0.14, 0.1, depth * 0.86],
      color: shade(stone, -0.06),
      bevel: 0.02,
      position: [width / 2 + porchDepth * 0.55, wallHeight * 0.82 + 0.15, 0],
    })

    addDoor(ctx, width / 2, 0.1, 0, 0, 0.34, 0.6)
    for (const z of [-0.3, 0.3]) {
      addWindow(ctx, width / 2, wallHeight * 0.66, z, 0, 0.2)
      addWindow(ctx, -width / 2, wallHeight * 0.66, z, Math.PI, 0.2)
    }

    // Bell tower with a clock face.
    const towerBase = wallHeight + 0.5
    b.roundedBox({
      size: [0.34, 0.5, 0.34],
      color: stone,
      bevel: 0.04,
      position: [0, towerBase - 0.08, 0],
    })
    b.cylinder({
      radius: 0.13,
      height: 0.03,
      color: COLORS.flowerWhite,
      position: [0.175, towerBase + 0.06, 0],
      rotationZ: Math.PI / 2,
      segments: 12,
    })
    b.box({ size: [0.02, 0.08, 0.014], color: COLORS.timber, position: [0.192, towerBase + 0.09, 0] })
    b.box({ size: [0.02, 0.014, 0.06], color: COLORS.timber, position: [0.192, towerBase + 0.06, 0.02] })

    b.cone({
      radius: 0.28,
      height: 0.38,
      color: shade(roofColor, -0.1),
      position: [0, towerBase + 0.17, 0],
      segments: 8,
    })
    b.sphere({ radius: 0.05, color: COLORS.thatch, position: [0, towerBase + 0.58, 0], segments: 8 })
  })
}

/** A stone well with a shingled canopy and a bucket on a rope. */
export const well: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const stone = tint(COLORS.stone, ctx.jitter('hue', 0.01), ctx.jitter('light', 0.05))

  b.in({ rotationY: ctx.range('spin', 0, Math.PI * 2) }, () => {
    // Wall ring built from individual stones, so it reads as masonry.
    const stones = 10
    for (let i = 0; i < stones; i++) {
      const angle = (i / stones) * Math.PI * 2
      b.roundedBox({
        size: [0.15, 0.26, 0.12],
        color: shade(stone, ctx.jitter(`s${i}`, 0.12)),
        bevel: 0.03,
        position: [Math.cos(angle) * 0.32, 0.13, Math.sin(angle) * 0.32],
        rotationY: -angle,
      })
    }
    b.cylinder({ radius: 0.29, height: 0.06, color: COLORS.waterDeep, position: [0, 0.2, 0], segments: 12 })
    b.torus({ radius: 0.33, tube: 0.045, color: shade(stone, 0.12), position: [0, 0.27, 0] })

    // Posts and roof.
    for (const sx of [-1, 1]) {
      b.cylinder({
        radius: 0.04,
        height: 0.6,
        color: COLORS.woodDark,
        position: [sx * 0.3, 0.55, 0],
        segments: 6,
      })
    }
    b.roof({
      width: 0.78,
      depth: 0.5,
      height: 0.26,
      color: COLORS.thatch,
      overhang: 0.08,
      position: [0, 0.85, 0],
      rotationY: Math.PI / 2,
    })

    // Winch and bucket.
    b.cylinder({
      radius: 0.035,
      height: 0.52,
      color: COLORS.wood,
      position: [0, 0.78, 0],
      rotationZ: Math.PI / 2,
      segments: 6,
    })
    b.cylinder({ radius: 0.006, height: 0.26, color: '#8a7a62', position: [0, 0.65, 0], segments: 4 })
    b.cylinder({
      radius: 0.075,
      height: 0.11,
      color: COLORS.woodDark,
      position: [0, 0.47, 0],
      segments: 8,
    })
  })
}

/** A lamp post with a warm glass lantern. */
export const lamp: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const height = ctx.range('h', 1.5, 1.75)
  const metal = '#4b4a52'

  b.in({ position: [ctx.jitter('x', 0.1), 0, ctx.jitter('z', 0.1)], rotationY: ctx.range('spin', 0, Math.PI * 2) }, () => {
    b.cylinder({ radius: 0.13, height: 0.08, color: shade(metal, 0.1), position: [0, 0.04, 0], segments: 8 })
    b.cylinder({ radius: 0.055, height: 0.14, color: metal, position: [0, 0.12, 0], segments: 8 })
    b.cylinder({
      radius: 0.038,
      radiusTop: 0.028,
      height,
      color: metal,
      position: [0, height / 2 + 0.16, 0],
      segments: 8,
    })

    const lanternY = height + 0.24
    b.cylinder({ radius: 0.075, height: 0.03, color: metal, position: [0, lanternY - 0.11, 0], segments: 8 })
    // Tapered glass housing, brighter than anything else in the scene.
    b.cylinder({
      radius: 0.095,
      radiusTop: 0.075,
      height: 0.2,
      color: WINDOW_GLOW,
      position: [0, lanternY, 0],
      segments: 8,
    })
    b.cone({ radius: 0.115, height: 0.1, color: metal, position: [0, lanternY + 0.1, 0], segments: 8 })
    b.sphere({ radius: 0.028, color: metal, position: [0, lanternY + 0.22, 0], segments: 6 })
  })
}
