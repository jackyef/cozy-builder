/**
 * MeshBuilder — the procedural modelling API every piece is built with.
 *
 * ## Why bake instead of rendering components
 *
 * The obvious React-flavoured approach is a `<Cottage>` component containing a
 * dozen `<mesh>` elements. At village scale that is tens of thousands of
 * objects for three.js to traverse, cull and draw every frame, and it drops to
 * single-digit FPS long before the island is full.
 *
 * Instead, each piece is a *function that emits triangles* into a shared
 * buffer. A whole chunk of the world bakes down to one geometry with vertex
 * colours, drawn in one call (see `../chunks.ts`). A full village is a handful
 * of draw calls rather than thousands, and the cost of a piece is paid once
 * when it changes rather than once per frame.
 *
 * The cost of that choice is that pieces cannot hold React state or respond to
 * events individually — which is fine, because nothing in a village needs to.
 * Anything that *does* move (villagers, windmill sails, water) is rendered
 * separately as real objects; see `../agents` and `../animated`.
 *
 * ## Using it
 *
 * The builder keeps a transform stack, so pieces are modelled in local space
 * and composed hierarchically:
 *
 * ```ts
 * b.push({ position: [0, 1.2, 0], rotationY: Math.PI / 4 })
 * b.box({ size: [1, 0.4, 1], color: COLORS.wood })
 * b.pop()
 * ```
 *
 * Every primitive is placed relative to the current transform and its own
 * origin is its centre, except where noted (cones and the roof helpers sit on
 * their base, which is almost always what you want when stacking).
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three'

export type ColorInput = string | number | Color

/** A local placement applied on top of the current transform. */
export interface Transform {
  position?: [number, number, number]
  /** Rotation about Y, in radians. Applied before X and Z. */
  rotationY?: number
  rotationX?: number
  rotationZ?: number
  scale?: number | [number, number, number]
}

/**
 * Geometry cache. Primitive geometries are created from a small set of
 * parameter combinations and reused across every piece in the world, so the
 * builder never allocates a `BoxGeometry` in a hot loop.
 */
const geometryCache = new Map<string, BufferGeometry>()

function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geometryCache.get(key)
  if (!g) {
    g = make()
    // Non-indexed keeps the merge path simple and flat-shading correct.
    if (g.index) g = g.toNonIndexed()
    geometryCache.set(key, g)
  }
  return g
}

/** Frees cached geometry. Only useful in tests and hot-reload teardown. */
export function disposeGeometryCache(): void {
  for (const g of geometryCache.values()) g.dispose()
  geometryCache.clear()
}

const _matrix = new Matrix4()
const _quaternion = new Quaternion()
const _euler = new Euler()
const _position = new Vector3()
const _scale = new Vector3()
const _normalMatrix = new Matrix3()
const _vector = new Vector3()
const _color = new Color()

export class MeshBuilder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []

  private stack: Matrix4[] = [new Matrix4()]

  /** The transform primitives are currently emitted with. */
  get transform(): Matrix4 {
    return this.stack[this.stack.length - 1]
  }

  /** How many triangles have been emitted so far. */
  get triangleCount(): number {
    return this.positions.length / 9
  }

  get isEmpty(): boolean {
    return this.positions.length === 0
  }

  /** Push a new transform relative to the current one. */
  push(t: Transform): this {
    _position.set(...(t.position ?? [0, 0, 0]))
    _euler.set(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0, 'YXZ')
    _quaternion.setFromEuler(_euler)
    const s = t.scale ?? 1
    if (typeof s === 'number') _scale.set(s, s, s)
    else _scale.set(...s)

    _matrix.compose(_position, _quaternion, _scale)
    this.stack.push(new Matrix4().multiplyMatrices(this.transform, _matrix))
    return this
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop()
    return this
  }

  /** Run `fn` inside a pushed transform, popping even if it throws. */
  in(t: Transform, fn: () => void): this {
    this.push(t)
    try {
      fn()
    } finally {
      this.pop()
    }
    return this
  }

  /** Reset to an identity transform with no geometry. */
  reset(): this {
    this.positions.length = 0
    this.normals.length = 0
    this.colors.length = 0
    this.stack = [new Matrix4()]
    return this
  }

  // -------------------------------------------------------------------------
  // Core emit
  // -------------------------------------------------------------------------

  /**
   * Append an arbitrary geometry, transformed into world space and tinted.
   *
   * The source geometry is never modified — positions and normals are copied
   * and transformed on the way in, so cached primitives stay reusable.
   */
  add(geometry: BufferGeometry, color: ColorInput, local?: Transform): this {
    if (local) this.push(local)

    const matrix = this.transform
    _normalMatrix.getNormalMatrix(matrix)
    // `Color.set()` with a hex or CSS string already converts sRGB -> the
    // linear working space (three.js ColorManagement, on by default since
    // r152). Calling `convertSRGBToLinear()` here as well would double-convert
    // and render the whole palette dark and oversaturated.
    _color.set(color as never)

    const pos = geometry.getAttribute('position') as BufferAttribute
    const nrm = geometry.getAttribute('normal') as BufferAttribute | undefined
    const count = pos.count

    for (let i = 0; i < count; i++) {
      _vector.fromBufferAttribute(pos, i).applyMatrix4(matrix)
      this.positions.push(_vector.x, _vector.y, _vector.z)

      if (nrm) {
        _vector.fromBufferAttribute(nrm, i).applyMatrix3(_normalMatrix).normalize()
        this.normals.push(_vector.x, _vector.y, _vector.z)
      } else {
        this.normals.push(0, 1, 0)
      }

      this.colors.push(_color.r, _color.g, _color.b)
    }

    if (local) this.pop()
    return this
  }

  /** Append everything from another builder, under the current transform. */
  addBuilder(other: MeshBuilder): this {
    const matrix = this.transform
    _normalMatrix.getNormalMatrix(matrix)
    for (let i = 0; i < other.positions.length; i += 3) {
      _vector.set(other.positions[i], other.positions[i + 1], other.positions[i + 2])
      _vector.applyMatrix4(matrix)
      this.positions.push(_vector.x, _vector.y, _vector.z)

      _vector.set(other.normals[i], other.normals[i + 1], other.normals[i + 2])
      _vector.applyMatrix3(_normalMatrix).normalize()
      this.normals.push(_vector.x, _vector.y, _vector.z)
    }
    this.colors.push(...other.colors)
    return this
  }

  /** Finalise into a geometry ready to render. */
  toGeometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  /** An axis-aligned box centred on the current origin. */
  box(opts: { size: [number, number, number]; color: ColorInput } & Transform): this {
    const [w, h, d] = opts.size
    const g = cached('box', () => new BoxGeometry(1, 1, 1))
    return this.add(g, opts.color, { ...opts, scale: scaleOf(opts.scale, [w, h, d]) })
  }

  /**
   * A box with chamfered edges.
   *
   * Soft edges are most of what separates a "cosy" look from a programmer-art
   * look: a hard 90° corner catches a hard specular line, while a small chamfer
   * catches a soft gradient. `bevel` is in world units and is clamped so it can
   * never exceed half the smallest dimension.
   */
  roundedBox(
    opts: { size: [number, number, number]; color: ColorInput; bevel?: number } & Transform,
  ): this {
    const [w, h, d] = opts.size
    const maxBevel = Math.min(w, h, d) * 0.49
    const bevel = Math.min(opts.bevel ?? Math.min(w, h, d) * 0.14, maxBevel)
    if (bevel <= 1e-4) return this.box(opts)

    // Extrude a rounded rectangle along Z, then stand it up so the chamfer
    // reads on all four vertical edges plus the top and bottom.
    const key = `rbox:${round3(w)}:${round3(h)}:${round3(d)}:${round3(bevel)}`
    const g = cached(key, () => {
      const shape = roundedRectShape(w - bevel * 2, d - bevel * 2, Math.max(0.001, bevel * 0.9))
      const geo = new ExtrudeGeometry(shape, {
        depth: h - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 3,
        steps: 1,
      })
      // ExtrudeGeometry builds on XY extruding along +Z; stand it upright and
      // centre it so the box behaves like every other primitive here.
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, -(h - bevel * 2) / 2 - bevel + bevel, 0)
      geo.computeVertexNormals()
      return geo
    })
    return this.add(g, opts.color, opts)
  }

  /** A cylinder centred on the current origin, standing on Y. */
  cylinder(
    opts: {
      radius: number
      height: number
      color: ColorInput
      radiusTop?: number
      segments?: number
      openEnded?: boolean
    } & Transform,
  ): this {
    const segments = opts.segments ?? 12
    const rt = opts.radiusTop ?? opts.radius
    const key = `cyl:${round3(rt / opts.radius)}:${segments}:${opts.openEnded ? 1 : 0}`
    const g = cached(
      key,
      () => new CylinderGeometry(rt / opts.radius, 1, 1, segments, 1, opts.openEnded),
    )
    return this.add(g, opts.color, {
      ...opts,
      scale: scaleOf(opts.scale, [opts.radius, opts.height, opts.radius]),
    })
  }

  /** A cone standing on its base at the current origin. */
  cone(
    opts: { radius: number; height: number; color: ColorInput; segments?: number } & Transform,
  ): this {
    const segments = opts.segments ?? 12
    const g = cached(`cone:${segments}`, () => {
      const geo = new ConeGeometry(1, 1, segments)
      geo.translate(0, 0.5, 0) // base at the origin, so cones stack naturally
      return geo
    })
    return this.add(g, opts.color, {
      ...opts,
      scale: scaleOf(opts.scale, [opts.radius, opts.height, opts.radius]),
    })
  }

  /** A sphere centred on the current origin. */
  sphere(
    opts: { radius: number; color: ColorInput; segments?: number } & Transform,
  ): this {
    const segments = opts.segments ?? 10
    const g = cached(`sphere:${segments}`, () => new SphereGeometry(1, segments, Math.max(4, segments >> 1)))
    return this.add(g, opts.color, { ...opts, scale: scaleOf(opts.scale, opts.radius) })
  }

  /**
   * A faceted blob — an icosphere at low subdivision.
   *
   * The go-to shape for rocks, bushes and tree canopies: it reads as organic
   * without a texture, and its facets catch the directional light in a way a
   * smooth sphere does not.
   */
  blob(
    opts: { radius: number; color: ColorInput; detail?: number } & Transform,
  ): this {
    const detail = opts.detail ?? 0
    const g = cached(`ico:${detail}`, () => new IcosahedronGeometry(1, detail))
    return this.add(g, opts.color, { ...opts, scale: scaleOf(opts.scale, opts.radius) })
  }

  /** A torus lying flat in the XZ plane. */
  torus(
    opts: {
      radius: number
      tube: number
      color: ColorInput
      segments?: number
      arc?: number
    } & Transform,
  ): this {
    const segments = opts.segments ?? 14
    const arc = opts.arc ?? Math.PI * 2
    const key = `torus:${round3(opts.tube / opts.radius)}:${segments}:${round3(arc)}`
    const g = cached(key, () => {
      const geo = new TorusGeometry(1, opts.tube / opts.radius, 6, segments, arc)
      geo.rotateX(Math.PI / 2)
      return geo
    })
    return this.add(g, opts.color, { ...opts, scale: scaleOf(opts.scale, opts.radius) })
  }

  /**
   * A regular prism — the shape of a ground tile.
   *
   * `pointy` matches our pointy-top hex orientation when `sides` is 6.
   */
  prism(
    opts: {
      radius: number
      height: number
      color: ColorInput
      sides?: number
      pointy?: boolean
    } & Transform,
  ): this {
    const sides = opts.sides ?? 6
    const pointy = opts.pointy ?? true
    const key = `prism:${sides}:${pointy ? 1 : 0}`
    const g = cached(key, () => {
      const geo = new CylinderGeometry(1, 1, 1, sides)
      // CylinderGeometry starts its first vertex at +X; rotating by a further
      // 30° puts vertices at north and south, matching a pointy-top hex.
      if (pointy && sides === 6) geo.rotateY(Math.PI / 6)
      return geo
    })
    return this.add(g, opts.color, {
      ...opts,
      scale: scaleOf(opts.scale, [opts.radius, opts.height, opts.radius]),
    })
  }

  /**
   * A gable roof: a triangular prism sitting on its base, ridge running along
   * X. Rotate it with `rotationY` to face the roof the other way.
   */
  roof(
    opts: { width: number; depth: number; height: number; color: ColorInput; overhang?: number } &
      Transform,
  ): this {
    const overhang = opts.overhang ?? 0
    const w = opts.width + overhang * 2
    const d = opts.depth + overhang * 2
    const g = cached('roofPrism', () => {
      const shape = new Shape()
      shape.moveTo(-0.5, 0)
      shape.lineTo(0.5, 0)
      shape.lineTo(0, 1)
      shape.closePath()
      const geo = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      // Extruded along +Z from the XY plane; centre it on Z and leave the base
      // at y = 0 so roofs sit directly on top of walls.
      geo.translate(0, 0, -0.5)
      geo.computeVertexNormals()
      return geo
    })
    // The shape's cross-section spans Z (depth) after extrusion along X.
    return this.add(g, opts.color, {
      ...opts,
      rotationY: (opts.rotationY ?? 0) + Math.PI / 2,
      scale: scaleOf(opts.scale, [d, opts.height, w]),
    })
  }

  /** A thin quad standing upright, for banners, signs and flat details. */
  plane(
    opts: { width: number; height: number; color: ColorInput; thickness?: number } & Transform,
  ): this {
    return this.box({
      ...opts,
      size: [opts.width, opts.height, opts.thickness ?? 0.03],
      color: opts.color,
    })
  }

  /**
   * A capsule-ish limb between two points — the workhorse for fence rails,
   * scaffolding and anything else that spans a gap at an arbitrary angle.
   */
  strut(
    from: [number, number, number],
    to: [number, number, number],
    thickness: number,
    color: ColorInput,
  ): this {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const dz = to[2] - from[2]
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-5) return this

    const mid: [number, number, number] = [
      (from[0] + to[0]) / 2,
      (from[1] + to[1]) / 2,
      (from[2] + to[2]) / 2,
    ]
    // Yaw about Y then pitch about Z lines a Y-up box up with the segment.
    const yaw = Math.atan2(-dz, dx)
    const pitch = Math.atan2(Math.hypot(dx, dz), dy)

    return this.in({ position: mid, rotationY: yaw, rotationZ: -pitch }, () => {
      this.box({ size: [thickness, length, thickness], color })
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * Combine a caller-supplied `scale` with the primitive's intrinsic dimensions.
 * Lets `box({ size, scale: 1.1 })` mean "this box, 10% bigger".
 */
function scaleOf(
  outer: number | [number, number, number] | undefined,
  intrinsic: number | [number, number, number],
): [number, number, number] {
  const i: [number, number, number] =
    typeof intrinsic === 'number' ? [intrinsic, intrinsic, intrinsic] : intrinsic
  if (outer === undefined) return i
  const o: [number, number, number] = typeof outer === 'number' ? [outer, outer, outer] : outer
  return [i[0] * o[0], i[1] * o[1], i[2] * o[2]]
}

/** A rectangle with rounded corners, centred on the origin, in the XY plane. */
function roundedRectShape(width: number, height: number, radius: number): Shape {
  const w = Math.max(0.001, width)
  const h = Math.max(0.001, height)
  const r = Math.min(radius, w / 2, h / 2)
  const shape = new Shape()
  shape.moveTo(-w / 2 + r, -h / 2)
  shape.lineTo(w / 2 - r, -h / 2)
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  shape.lineTo(w / 2, h / 2 - r)
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  shape.lineTo(-w / 2 + r, h / 2)
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  shape.lineTo(-w / 2, -h / 2 + r)
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  shape.closePath()
  return shape
}

/** Lighten or darken a colour, for cheap shading variation within a piece. */
export function shade(color: ColorInput, amount: number): Color {
  const c = new Color(color as never)
  if (amount >= 0) c.lerp(new Color(0xffffff), amount)
  else c.lerp(new Color(0x000000), -amount)
  return c
}

/**
 * Nudge a colour's hue and lightness — the main per-tile tint helper.
 *
 * Reads and writes HSL in **sRGB** rather than the linear working space. HSL
 * lightness is only perceptually meaningful in a gamma-encoded space; doing the
 * same shift linearly makes the jitter far stronger on dark colours than light
 * ones, which shows up as blotchy terrain.
 *
 * Keep `hueShift` small — beyond about ±0.04 the palette stops reading as one
 * coherent set of colours.
 */
export function tint(color: ColorInput, hueShift: number, lightShift: number): Color {
  const c = new Color(color as never)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl, SRGBColorSpace)
  c.setHSL(
    (hsl.h + hueShift + 1) % 1,
    Math.min(1, Math.max(0, hsl.s)),
    Math.min(1, Math.max(0, hsl.l + lightShift)),
    SRGBColorSpace,
  )
  return c
}
