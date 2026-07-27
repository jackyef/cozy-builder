/**
 * Procedural models for villagers and animals.
 *
 * ## Why these are built as whole, pre-coloured meshes
 *
 * Agents render through `InstancedMesh`, which draws one geometry many times.
 * That means colour has to be baked in — so instead of one villager model
 * tinted per instance, we build a small set of fully-coloured **variants** per
 * kind (different shirts, hair, fur) and put each variant in its own instanced
 * mesh. Roughly thirty draw calls covers the entire population, and every
 * villager in the street can still look different.
 *
 * ## The shape language
 *
 * Everything is bottom-heavy: wide base, big head, short limbs, no neck. That
 * silhouette is doing almost all of the character work — it reads as friendly
 * at any distance and survives being two centimetres tall on screen, which is
 * how most villagers will actually be seen.
 *
 * Models face **+X** (east) at rest, matching the convention in
 * `src/core/hex.ts`, and stand on `y = 0` so the simulation can place them
 * directly on the terrain height.
 */

import type { BufferGeometry } from 'three'
import { MeshBuilder, shade } from '../geometry/builder'
import { COLORS } from '@/world/catalog'
import type { AgentKind } from '@/world/types'

const SKIN_TONES = ['#f2c9a4', '#e0ac7e', '#c38a5e', '#9b6642', '#7a4c31']
const HAIR_COLORS = ['#3a2a20', '#6b4429', '#a8762f', '#d8c27a', '#8a8a92', '#4a3550']
const SHIRT_COLORS = [
  '#e0645f',
  '#6aa5d8',
  '#79b087',
  '#e39158',
  '#a288c4',
  '#d98fae',
  '#5fb0a8',
  '#c9a05f',
]

/**
 * A humanoid villager.
 *
 * The proportions are the point: the head is about 45% of total height, which
 * is roughly double a realistic ratio and is what makes the character read as
 * cute rather than as a small adult.
 */
function buildVillager(
  b: MeshBuilder,
  opts: { skin: string; hair: string; shirt: string; trousers: string; scale?: number; hat?: string; apron?: string },
): void {
  const s = opts.scale ?? 1
  b.push({ scale: s })

  const legH = 0.16
  const bodyH = 0.3
  const headR = 0.19

  // Legs — stubby, set close together.
  for (const sz of [-1, 1]) {
    b.cylinder({
      radius: 0.055,
      height: legH,
      color: opts.trousers,
      position: [0, legH / 2, sz * 0.06],
      segments: 6,
    })
    b.roundedBox({
      size: [0.11, 0.05, 0.08],
      color: '#4a3a30',
      bevel: 0.02,
      position: [0.02, 0.025, sz * 0.06],
    })
  }

  // Body — a rounded barrel, wider at the bottom.
  b.cylinder({
    radius: 0.15,
    radiusTop: 0.13,
    height: bodyH,
    color: opts.shirt,
    position: [0, legH + bodyH / 2, 0],
    segments: 10,
  })
  b.sphere({ radius: 0.13, color: opts.shirt, position: [0, legH + bodyH, 0], scale: [1, 0.6, 1], segments: 8 })

  if (opts.apron) {
    b.cylinder({
      radius: 0.152,
      radiusTop: 0.135,
      height: bodyH * 0.55,
      color: opts.apron,
      position: [0.005, legH + bodyH * 0.28, 0],
      segments: 10,
    })
  }

  // Arms.
  for (const sz of [-1, 1]) {
    b.cylinder({
      radius: 0.042,
      height: 0.2,
      color: opts.shirt,
      position: [0, legH + bodyH * 0.72, sz * 0.155],
      rotationX: sz * 0.12,
      segments: 6,
    })
    b.sphere({ radius: 0.05, color: opts.skin, position: [0, legH + bodyH * 0.44, sz * 0.17], segments: 6 })
  }

  // Head — oversized, slightly forward.
  const headY = legH + bodyH + headR * 0.72
  b.sphere({ radius: headR, color: opts.skin, position: [0.005, headY, 0], scale: [0.98, 1, 0.96], segments: 12 })

  // Hair: a cap over the back and top of the skull.
  b.sphere({
    radius: headR * 1.03,
    color: opts.hair,
    position: [-0.02, headY + 0.02, 0],
    scale: [0.95, 0.85, 0.98],
    segments: 10,
  })
  b.sphere({
    radius: headR * 0.72,
    color: opts.skin,
    position: [0.075, headY - 0.01, 0],
    scale: [0.9, 0.95, 0.95],
    segments: 10,
  })

  // Eyes — two dark dots. At this scale, that is a complete face.
  for (const sz of [-1, 1]) {
    b.sphere({
      radius: 0.028,
      color: '#2e2420',
      position: [headR * 0.9, headY + 0.015, sz * 0.075],
      scale: [0.6, 1.1, 1],
      segments: 6,
    })
  }
  // A hint of a cheek blush, which is a strong cosy signal for one sphere each.
  for (const sz of [-1, 1]) {
    b.sphere({
      radius: 0.032,
      color: '#f0a0a0',
      position: [headR * 0.78, headY - 0.055, sz * 0.105],
      scale: [0.35, 0.6, 0.8],
      segments: 5,
    })
  }

  if (opts.hat) {
    b.cylinder({ radius: headR * 1.5, height: 0.022, color: opts.hat, position: [0, headY + headR * 0.72, 0], segments: 12 })
    b.cylinder({
      radius: headR * 0.85,
      radiusTop: headR * 0.78,
      height: 0.11,
      color: shade(opts.hat, -0.06),
      position: [0, headY + headR * 0.78, 0],
      segments: 12,
    })
  }

  b.pop()
}

/** A generic quadruped, parameterised into every farm animal we need. */
function buildQuadruped(
  b: MeshBuilder,
  opts: {
    body: string
    belly?: string
    head?: string
    legs: string
    bodyLength: number
    bodyRadius: number
    legHeight: number
    headRadius: number
    ears?: 'floppy' | 'round' | 'none'
    horns?: boolean
    tail?: 'tuft' | 'thin' | 'curly' | 'none'
    fluffy?: boolean
    scale?: number
  },
): void {
  const s = opts.scale ?? 1
  b.push({ scale: s })

  const { bodyLength, bodyRadius, legHeight, headRadius } = opts
  const headColor = opts.head ?? opts.body

  // Legs at the four corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cylinder({
        radius: bodyRadius * 0.16,
        height: legHeight,
        color: opts.legs,
        position: [sx * bodyLength * 0.3, legHeight / 2, sz * bodyRadius * 0.55],
        segments: 5,
      })
    }
  }

  const bodyY = legHeight + bodyRadius * 0.85
  if (opts.fluffy) {
    // Wool: overlapping blobs instead of a smooth barrel.
    for (let i = 0; i < 5; i++) {
      const t = (i / 4 - 0.5) * bodyLength * 0.75
      b.blob({
        radius: bodyRadius * (i === 0 || i === 4 ? 0.82 : 1),
        color: shade(opts.body, i % 2 ? 0.05 : -0.04),
        detail: 1,
        position: [t, bodyY + (i % 2 ? 0.02 : 0), 0],
        scale: [0.85, 0.95, 1],
      })
    }
  } else {
    b.cylinder({
      radius: bodyRadius,
      height: bodyLength,
      color: opts.body,
      position: [0, bodyY, 0],
      rotationZ: Math.PI / 2,
      segments: 10,
    })
    b.sphere({ radius: bodyRadius, color: opts.body, position: [bodyLength / 2, bodyY, 0], segments: 10 })
    b.sphere({ radius: bodyRadius, color: opts.body, position: [-bodyLength / 2, bodyY, 0], segments: 10 })
    if (opts.belly) {
      b.sphere({
        radius: bodyRadius * 0.86,
        color: opts.belly,
        position: [0, bodyY - bodyRadius * 0.3, 0],
        scale: [bodyLength / bodyRadius / 2.1, 0.7, 0.92],
        segments: 8,
      })
    }
  }

  // Head, slightly lowered — grazing posture reads calmer than head-up.
  const headX = bodyLength * 0.55 + headRadius * 0.5
  const headY = bodyY + bodyRadius * 0.25
  b.sphere({ radius: headRadius, color: headColor, position: [headX, headY, 0], segments: 10 })
  b.sphere({
    radius: headRadius * 0.55,
    color: shade(headColor, 0.12),
    position: [headX + headRadius * 0.7, headY - headRadius * 0.25, 0],
    scale: [0.9, 0.7, 0.85],
    segments: 8,
  })

  for (const sz of [-1, 1]) {
    b.sphere({
      radius: headRadius * 0.16,
      color: '#2e2420',
      position: [headX + headRadius * 0.72, headY + headRadius * 0.15, sz * headRadius * 0.45],
      segments: 5,
    })
  }

  if (opts.ears === 'floppy') {
    for (const sz of [-1, 1]) {
      b.sphere({
        radius: headRadius * 0.4,
        color: shade(headColor, -0.1),
        position: [headX - headRadius * 0.2, headY + headRadius * 0.35, sz * headRadius * 0.85],
        scale: [0.5, 0.9, 0.4],
        rotationZ: 0.4,
        segments: 6,
      })
    }
  } else if (opts.ears === 'round') {
    for (const sz of [-1, 1]) {
      b.cone({
        radius: headRadius * 0.32,
        height: headRadius * 0.55,
        color: shade(headColor, -0.08),
        position: [headX - headRadius * 0.25, headY + headRadius * 0.7, sz * headRadius * 0.5],
        segments: 5,
      })
    }
  }

  if (opts.horns) {
    for (const sz of [-1, 1]) {
      b.cone({
        radius: headRadius * 0.16,
        height: headRadius * 0.55,
        color: '#e8ddc4',
        position: [headX - headRadius * 0.1, headY + headRadius * 0.72, sz * headRadius * 0.55],
        rotationZ: sz * 0.3,
        rotationX: sz * 0.5,
        segments: 5,
      })
    }
  }

  const tailX = -bodyLength / 2 - bodyRadius * 0.4
  if (opts.tail === 'tuft') {
    b.sphere({ radius: bodyRadius * 0.32, color: shade(opts.body, -0.12), position: [tailX, bodyY + bodyRadius * 0.4, 0], segments: 6 })
  } else if (opts.tail === 'thin') {
    b.cylinder({
      radius: bodyRadius * 0.08,
      height: bodyRadius * 1.1,
      color: opts.legs,
      position: [tailX, bodyY + bodyRadius * 0.5, 0],
      rotationZ: -0.6,
      segments: 5,
    })
  } else if (opts.tail === 'curly') {
    b.torus({
      radius: bodyRadius * 0.22,
      tube: bodyRadius * 0.08,
      color: shade(opts.body, -0.08),
      position: [tailX, bodyY + bodyRadius * 0.45, 0],
      rotationX: Math.PI / 2,
      rotationZ: 0.4,
      segments: 8,
    })
  }

  b.pop()
}

/** A bird: chicken, duck, or the small flying kind. */
function buildBird(
  b: MeshBuilder,
  opts: {
    body: string
    wing?: string
    beak: string
    comb?: string
    legs: string
    radius: number
    tall?: boolean
    scale?: number
  },
): void {
  const s = opts.scale ?? 1
  b.push({ scale: s })

  const r = opts.radius
  const legH = opts.tall ? r * 0.7 : r * 0.35
  for (const sz of [-1, 1]) {
    b.cylinder({ radius: r * 0.09, height: legH, color: opts.legs, position: [0, legH / 2, sz * r * 0.3], segments: 4 })
    b.roundedBox({ size: [r * 0.5, r * 0.08, r * 0.28], color: opts.legs, bevel: r * 0.03, position: [r * 0.12, r * 0.04, sz * r * 0.3] })
  }

  const bodyY = legH + r * 0.85
  b.sphere({ radius: r, color: opts.body, position: [0, bodyY, 0], scale: [1.15, 1, 0.95], segments: 10 })
  // Tail.
  b.cone({
    radius: r * 0.42,
    height: r * 0.75,
    color: shade(opts.body, -0.1),
    position: [-r * 0.95, bodyY + r * 0.35, 0],
    rotationZ: -1.9,
    segments: 5,
  })
  // Wings.
  for (const sz of [-1, 1]) {
    b.sphere({
      radius: r * 0.55,
      color: opts.wing ?? shade(opts.body, -0.08),
      position: [-r * 0.05, bodyY, sz * r * 0.82],
      scale: [1.2, 0.8, 0.3],
      segments: 7,
    })
  }

  const headY = bodyY + r * 0.85
  b.sphere({ radius: r * 0.62, color: opts.body, position: [r * 0.5, headY, 0], segments: 9 })
  b.cone({
    radius: r * 0.2,
    height: r * 0.42,
    color: opts.beak,
    position: [r * 1.02, headY - r * 0.05, 0],
    rotationZ: -Math.PI / 2,
    segments: 5,
  })
  for (const sz of [-1, 1]) {
    b.sphere({ radius: r * 0.11, color: '#2e2420', position: [r * 0.86, headY + r * 0.16, sz * r * 0.32], segments: 5 })
  }
  if (opts.comb) {
    b.sphere({ radius: r * 0.2, color: opts.comb, position: [r * 0.55, headY + r * 0.6, 0], scale: [1.2, 0.8, 0.35], segments: 6 })
    b.sphere({ radius: r * 0.14, color: opts.comb, position: [r * 0.92, headY - r * 0.3, 0], scale: [0.7, 1.1, 0.4], segments: 5 })
  }

  b.pop()
}

/** A butterfly: a tiny body and two pairs of bright wings held open. */
function buildButterfly(b: MeshBuilder, color: string, accent: string): void {
  b.cylinder({ radius: 0.022, height: 0.16, color: '#3a2f28', position: [0, 0, 0], rotationZ: Math.PI / 2, segments: 5 })
  b.sphere({ radius: 0.032, color: '#3a2f28', position: [0.08, 0.005, 0], segments: 5 })
  for (const sz of [-1, 1]) {
    b.sphere({
      radius: 0.1,
      color,
      position: [0.02, 0.03, sz * 0.09],
      scale: [1, 0.16, 0.95],
      rotationX: sz * 0.55,
      segments: 7,
    })
    b.sphere({
      radius: 0.07,
      color: accent,
      position: [-0.06, 0.02, sz * 0.07],
      scale: [1, 0.16, 0.9],
      rotationX: sz * 0.55,
      segments: 6,
    })
  }
  // Antennae.
  for (const sz of [-1, 1]) {
    b.cylinder({ radius: 0.006, height: 0.08, color: '#3a2f28', position: [0.11, 0.05, sz * 0.02], rotationZ: -0.7, rotationX: sz * 0.3, segments: 4 })
  }
}

/** A cat: a rounded quadruped with a long tail and pointed ears. */
function buildCat(b: MeshBuilder, fur: string, belly: string): void {
  buildQuadruped(b, {
    body: fur,
    belly,
    legs: shade(fur, -0.1).getStyle(),
    bodyLength: 0.3,
    bodyRadius: 0.13,
    legHeight: 0.12,
    headRadius: 0.13,
    ears: 'round',
    tail: 'none',
  })
  // A raised, slightly curled tail — the most cat-like single detail available.
  b.cylinder({ radius: 0.028, height: 0.26, color: fur, position: [-0.22, 0.34, 0], rotationZ: -0.5, segments: 5 })
  b.sphere({ radius: 0.032, color: shade(fur, 0.12), position: [-0.3, 0.45, 0], segments: 5 })
}

// ---------------------------------------------------------------------------
// Variant tables
// ---------------------------------------------------------------------------

/** Builds one variant of one kind. */
type VariantBuilder = (b: MeshBuilder, variant: number) => void

const KIND_BUILDERS: Record<AgentKind, { variants: number; build: VariantBuilder }> = {
  villager: {
    variants: 8,
    build: (b, v) =>
      buildVillager(b, {
        skin: SKIN_TONES[v % SKIN_TONES.length],
        hair: HAIR_COLORS[(v * 3) % HAIR_COLORS.length],
        shirt: SHIRT_COLORS[v % SHIRT_COLORS.length],
        trousers: ['#4a5a72', '#6b5642', '#3f5a4a', '#5a4a62'][v % 4],
      }),
  },
  child: {
    variants: 4,
    build: (b, v) =>
      buildVillager(b, {
        skin: SKIN_TONES[v % SKIN_TONES.length],
        hair: HAIR_COLORS[(v * 2 + 1) % HAIR_COLORS.length],
        shirt: SHIRT_COLORS[(v * 3 + 2) % SHIRT_COLORS.length],
        trousers: ['#6a7a92', '#8b6652'][v % 2],
        scale: 0.72,
      }),
  },
  merchant: {
    variants: 3,
    build: (b, v) =>
      buildVillager(b, {
        skin: SKIN_TONES[(v + 1) % SKIN_TONES.length],
        hair: HAIR_COLORS[v % HAIR_COLORS.length],
        shirt: ['#8a6fb0', '#c26a5f', '#5f8ab0'][v % 3],
        trousers: '#4a4250',
        apron: '#e8dcc4',
      }),
  },
  farmer: {
    variants: 3,
    build: (b, v) =>
      buildVillager(b, {
        skin: SKIN_TONES[(v + 2) % SKIN_TONES.length],
        hair: HAIR_COLORS[(v + 1) % HAIR_COLORS.length],
        shirt: ['#7fa05f', '#b08a5f', '#6a90a8'][v % 3],
        trousers: '#5a6a80',
        hat: COLORS.thatch,
      }),
  },
  guard: {
    variants: 2,
    build: (b, v) =>
      buildVillager(b, {
        skin: SKIN_TONES[(v + 3) % SKIN_TONES.length],
        hair: HAIR_COLORS[v % HAIR_COLORS.length],
        shirt: ['#8a8f9c', '#7a8290'][v % 2],
        trousers: '#4a4f5a',
        hat: '#9aa0ac',
      }),
  },

  chicken: {
    variants: 3,
    build: (b, v) =>
      buildBird(b, {
        body: ['#f6f0e4', '#e0c088', '#6b5442'][v % 3],
        beak: '#e8a83c',
        comb: '#d9544c',
        legs: '#e8a83c',
        radius: 0.13,
        tall: true,
      }),
  },
  duck: {
    variants: 2,
    build: (b, v) =>
      buildBird(b, {
        body: ['#f2ead8', '#8a9c72'][v % 2],
        wing: ['#dcd2bc', '#6f8060'][v % 2],
        beak: '#e8a83c',
        legs: '#e8a83c',
        radius: 0.14,
      }),
  },
  bird: {
    variants: 3,
    build: (b, v) =>
      buildBird(b, {
        body: ['#6a9ad4', '#d97a5f', '#8a7f9c'][v % 3],
        beak: '#e0b04c',
        legs: '#c08a4c',
        radius: 0.085,
      }),
  },

  sheep: {
    variants: 2,
    build: (b, v) =>
      buildQuadruped(b, {
        body: ['#f4f0e6', '#e6e0d2'][v % 2],
        head: '#3f3a36',
        legs: '#3f3a36',
        bodyLength: 0.34,
        bodyRadius: 0.19,
        legHeight: 0.15,
        headRadius: 0.12,
        ears: 'floppy',
        tail: 'tuft',
        fluffy: true,
      }),
  },
  cow: {
    variants: 3,
    build: (b, v) =>
      buildQuadruped(b, {
        body: ['#f6f2ea', '#6b5442', '#3f3a38'][v % 3],
        belly: '#f6f2ea',
        legs: '#4a4038',
        bodyLength: 0.46,
        bodyRadius: 0.22,
        legHeight: 0.22,
        headRadius: 0.15,
        ears: 'floppy',
        horns: true,
        tail: 'thin',
      }),
  },
  pig: {
    variants: 2,
    build: (b, v) =>
      buildQuadruped(b, {
        body: ['#f0b4b0', '#d9968f'][v % 2],
        legs: '#c98a86',
        bodyLength: 0.34,
        bodyRadius: 0.17,
        legHeight: 0.12,
        headRadius: 0.12,
        ears: 'floppy',
        tail: 'curly',
      }),
  },
  cat: {
    variants: 4,
    build: (b, v) => buildCat(b, ['#e8a05f', '#3f3a38', '#c9762f', '#f2ece0'][v % 4], '#f6f0e4'),
  },

  butterfly: {
    variants: 4,
    build: (b, v) =>
      buildButterfly(
        b,
        ['#f2c14e', '#e88fb0', '#8fb0e8', '#f0f0e0'][v % 4],
        ['#e09a3c', '#d97a9c', '#6f96d4', '#d8d8c4'][v % 4],
      ),
  },
}

// ---------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------

const cache = new Map<string, BufferGeometry>()

/** How many distinct looks a kind has. */
export function variantCount(kind: AgentKind): number {
  return KIND_BUILDERS[kind]?.variants ?? 1
}

/**
 * Geometry for one (kind, variant), built once and shared by every instance.
 *
 * Agent models never change, so unlike world chunks these are built lazily on
 * first use and then kept for the lifetime of the page.
 */
export function agentGeometry(kind: AgentKind, variant: number): BufferGeometry {
  const key = `${kind}:${variant}`
  let geometry = cache.get(key)
  if (geometry) return geometry

  const entry = KIND_BUILDERS[kind]
  const builder = new MeshBuilder()
  if (entry) {
    entry.build(builder, variant)
  } else {
    // Unknown kind: draw something visible rather than nothing.
    builder.sphere({ radius: 0.2, color: '#c46fb0', position: [0, 0.2, 0], segments: 8 })
  }

  geometry = builder.toGeometry()
  cache.set(key, geometry)
  return geometry
}

export function disposeAgentGeometry(): void {
  for (const g of cache.values()) g.dispose()
  cache.clear()
}
