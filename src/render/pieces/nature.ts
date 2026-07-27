/**
 * Nature pieces — trees, bushes, rocks and flowers.
 *
 * These are the most-repeated pieces in any village, so they carry the heaviest
 * variance budget. A forest of forty identical pines reads as a texture error;
 * the same forty with wobbled height, lean, canopy count and leaf tint reads as
 * a wood. Every number below that could plausibly differ between two trees
 * does.
 */

import { COLORS } from '@/world/catalog'
import { shade, tint } from '../geometry/builder'
import type { PieceContext, PieceRenderer } from './context'

/** Leaf tints. Picking from a small set keeps a wood coherent but not uniform. */
const LEAF_COLORS = [COLORS.leafSpring, COLORS.leafDeep, COLORS.leafOlive, '#8fc76a']

/**
 * A round, deciduous tree: a slightly leaning trunk under two or three
 * overlapping canopy blobs.
 *
 * The blobs are deliberately offset from the trunk axis rather than stacked
 * concentrically — an asymmetric canopy is what stops it looking like a
 * lollipop.
 */
export const treeRound: PieceRenderer = (ctx) => {
  const { builder: b } = ctx

  const scale = ctx.range('scale', 0.82, 1.2)
  const leanX = ctx.jitter('leanX', 0.09)
  const leanZ = ctx.jitter('leanZ', 0.09)
  const trunkHeight = 0.75 * scale
  const trunkColor = ctx.pick('trunkTone', [COLORS.wood, COLORS.woodDark, '#9c6a3f'])
  const leaf = tint(ctx.pick('leaf', LEAF_COLORS), ctx.jitter('leafHue', 0.015), ctx.jitter('leafLight', 0.05))

  b.in(
    {
      position: [ctx.jitter('offX', 0.16), 0, ctx.jitter('offZ', 0.16)],
      rotationX: leanX,
      rotationZ: leanZ,
      rotationY: ctx.range('spin', 0, Math.PI * 2),
    },
    () => {
      b.cylinder({
        radius: 0.1 * scale,
        radiusTop: 0.075 * scale,
        height: trunkHeight,
        color: trunkColor,
        position: [0, trunkHeight / 2, 0],
        segments: 7,
      })

      // A visible root flare stops the trunk looking like a dowel in a hole.
      b.cone({
        radius: 0.17 * scale,
        height: 0.16 * scale,
        color: shade(trunkColor, -0.08),
        position: [0, 0, 0],
        segments: 7,
      })

      const blobs = ctx.index('blobs', 3) + 2
      const canopyBase = trunkHeight + 0.28 * scale
      for (let i = 0; i < blobs; i++) {
        const t = i / Math.max(1, blobs - 1)
        const angle = ctx.range(`blobA${i}`, 0, Math.PI * 2)
        const spread = 0.24 * scale * (1 - t * 0.5)
        b.blob({
          radius: ctx.range(`blobR${i}`, 0.32, 0.46) * scale * (1 - t * 0.28),
          color: i === 0 ? leaf : shade(leaf, i % 2 ? 0.07 : -0.06),
          detail: 1,
          position: [
            Math.cos(angle) * spread,
            canopyBase + t * 0.42 * scale,
            Math.sin(angle) * spread,
          ],
          scale: [1, ctx.range(`blobSq${i}`, 0.78, 1.02), 1],
        })
      }
    },
  )
}

/**
 * A conifer: stacked cones on a short trunk.
 *
 * Each tier is rotated independently so the silhouettes of adjacent trees never
 * line up, which is what makes a stand of pines look deep rather than flat.
 */
export const treePine: PieceRenderer = (ctx) => {
  const { builder: b } = ctx

  const scale = ctx.range('scale', 0.85, 1.28)
  const tiers = ctx.index('tiers', 2) + 3
  const trunkColor = ctx.pick('trunkTone', [COLORS.woodDark, COLORS.timber])
  const leaf = tint(
    ctx.pick('leaf', [COLORS.leafPine, '#48876a', '#5b9a63']),
    ctx.jitter('leafHue', 0.02),
    ctx.jitter('leafLight', 0.045),
  )

  b.in(
    {
      position: [ctx.jitter('offX', 0.15), 0, ctx.jitter('offZ', 0.15)],
      rotationX: ctx.jitter('leanX', 0.05),
      rotationZ: ctx.jitter('leanZ', 0.05),
    },
    () => {
      const trunkHeight = 0.5 * scale
      b.cylinder({
        radius: 0.085 * scale,
        height: trunkHeight,
        color: trunkColor,
        position: [0, trunkHeight / 2, 0],
        segments: 6,
      })

      let y = trunkHeight * 0.55
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers
        const radius = (0.52 - t * 0.3) * scale * ctx.range(`tierR${i}`, 0.92, 1.08)
        const height = (0.62 - t * 0.13) * scale
        b.cone({
          radius,
          height,
          color: i % 2 ? shade(leaf, 0.06) : leaf,
          position: [0, y, 0],
          rotationY: ctx.range(`tierSpin${i}`, 0, Math.PI * 2),
          segments: 7,
        })
        y += height * 0.56
      }
    },
  )
}

/** A low, round shrub — two or three small blobs clustered on the ground. */
export const bush: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const leaf = tint(ctx.pick('leaf', LEAF_COLORS), ctx.jitter('leafHue', 0.02), ctx.jitter('leafLight', 0.06))
  const clusters = ctx.index('clusters', 3) + 2

  for (let i = 0; i < clusters; i++) {
    const angle = ctx.range(`a${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`d${i}`, 0, 0.3)
    const radius = ctx.range(`r${i}`, 0.2, 0.33)
    b.blob({
      radius,
      color: i % 2 ? shade(leaf, -0.07) : leaf,
      detail: 1,
      position: [Math.cos(angle) * dist, radius * 0.72, Math.sin(angle) * dist],
      scale: [1, ctx.range(`sq${i}`, 0.66, 0.86), 1],
      rotationY: ctx.range(`spin${i}`, 0, Math.PI),
    })
  }

  // A few berries on some bushes, because tiny surprises reward looking closely.
  if (ctx.chance('berries', 0.35)) {
    const berry = ctx.pick('berryColor', [COLORS.flowerPink, COLORS.roofRed, COLORS.flowerYellow])
    for (let i = 0; i < 5; i++) {
      const angle = ctx.range(`ba${i}`, 0, Math.PI * 2)
      const dist = ctx.range(`bd${i}`, 0.1, 0.34)
      b.sphere({
        radius: 0.045,
        color: berry,
        position: [Math.cos(angle) * dist, ctx.range(`by${i}`, 0.22, 0.42), Math.sin(angle) * dist],
        segments: 6,
      })
    }
  }
}

/** A weathered boulder: one large faceted blob with smaller ones around it. */
export const rock: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const base = tint(
    ctx.pick('tone', [COLORS.stone, COLORS.stoneDark, '#c0bcb4']),
    ctx.jitter('hue', 0.01),
    ctx.jitter('light', 0.06),
  )
  const scale = ctx.range('scale', 0.8, 1.25)

  b.blob({
    radius: 0.42 * scale,
    color: base,
    detail: 0,
    position: [ctx.jitter('x', 0.12), 0.26 * scale, ctx.jitter('z', 0.12)],
    // Squashing on Y and stretching unevenly on X/Z is what makes an
    // icosahedron read as a rock rather than a die.
    scale: [ctx.range('sx', 0.9, 1.35), ctx.range('sy', 0.62, 0.92), ctx.range('sz', 0.9, 1.35)],
    rotationY: ctx.range('spin', 0, Math.PI * 2),
    rotationX: ctx.jitter('tiltX', 0.25),
  })

  const companions = ctx.index('companions', 3)
  for (let i = 0; i < companions; i++) {
    const angle = ctx.range(`ca${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`cd${i}`, 0.35, 0.6)
    const r = ctx.range(`cr${i}`, 0.1, 0.2)
    b.blob({
      radius: r,
      color: shade(base, ctx.jitter(`cs${i}`, 0.12)),
      detail: 0,
      position: [Math.cos(angle) * dist, r * 0.7, Math.sin(angle) * dist],
      scale: [1.2, 0.75, 1.1],
      rotationY: ctx.range(`cspin${i}`, 0, Math.PI * 2),
    })
  }
}

/** A scatter of blooms: thin stems with a coloured head, plus a little grass. */
export const flowers: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const palette = ctx.pick('palette', [
    [COLORS.flowerPink, COLORS.flowerWhite],
    [COLORS.flowerYellow, COLORS.flowerWhite],
    ['#b48fd8', COLORS.flowerPink],
    ['#f28f6a', COLORS.flowerYellow],
  ])
  const count = 5 + ctx.index('count', 4)

  for (let i = 0; i < count; i++) {
    const angle = ctx.range(`a${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`d${i}`, 0.05, 0.62)
    const x = Math.cos(angle) * dist
    const z = Math.sin(angle) * dist
    const height = ctx.range(`h${i}`, 0.16, 0.3)
    const color = i % 3 === 0 ? palette[1] : palette[0]

    b.cylinder({
      radius: 0.012,
      height,
      color: COLORS.leafDeep,
      position: [x, height / 2, z],
      segments: 4,
    })
    b.sphere({
      radius: ctx.range(`fr${i}`, 0.045, 0.07),
      color,
      position: [x, height + 0.02, z],
      scale: [1, 0.62, 1],
      segments: 6,
    })
  }

  // Loose grass tufts tie the flowers into the ground plane.
  for (let i = 0; i < 4; i++) {
    const angle = ctx.range(`ga${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`gd${i}`, 0.1, 0.6)
    b.cone({
      radius: 0.05,
      height: ctx.range(`gh${i}`, 0.12, 0.22),
      color: shade(COLORS.grassDark, ctx.jitter(`gs${i}`, 0.1)),
      position: [Math.cos(angle) * dist, 0, Math.sin(angle) * dist],
      rotationZ: ctx.jitter(`gt${i}`, 0.3),
      segments: 4,
    })
  }
}

/**
 * Small grass tufts and pebbles scattered on bare ground.
 *
 * Not a placeable piece — the chunk baker sprinkles these onto empty tiles so
 * open ground has some life to it without the player having to decorate every
 * hex by hand.
 */
export function groundDetail(ctx: PieceContext): void {
  const { builder: b } = ctx
  const tufts = ctx.index('tufts', 3)
  for (let i = 0; i < tufts; i++) {
    const angle = ctx.range(`ta${i}`, 0, Math.PI * 2)
    const dist = ctx.range(`td${i}`, 0.15, 0.62)
    b.cone({
      radius: ctx.range(`tr${i}`, 0.035, 0.06),
      height: ctx.range(`th${i}`, 0.1, 0.2),
      color: shade(COLORS.grassDark, ctx.jitter(`ts${i}`, 0.12)),
      position: [Math.cos(angle) * dist, 0, Math.sin(angle) * dist],
      rotationZ: ctx.jitter(`tt${i}`, 0.25),
      segments: 4,
    })
  }
}
