/**
 * Shared materials.
 *
 * ## Why toon, and why a *soft* ramp
 *
 * Animal Crossing is not cel-shaded — it has no hard bands and no outlines. But
 * `MeshToonMaterial` is still the right base here, for a reason that has little
 * to do with the cel look: its `gradientMap` lets us **author the value range
 * directly**. The ramp below never drops below `0.68`, which hard-guarantees
 * that no surface in the village ever goes darker than 68% of its albedo.
 *
 * That high, narrow value range is the single strongest ingredient of the cosy
 * look, and it is very difficult to get out of a physically-based material
 * without fighting the lighting. With `LinearFilter` on the ramp the terminator
 * stays soft, so we get the authored floor without the anime banding.
 *
 * Two useful facts about how three.js implements toon shading:
 *
 *   - Only the **direct** light term is passed through the ramp. Indirect light
 *     (our hemisphere fill) is plain Lambert, so it stays perfectly smooth.
 *   - Shadow attenuation is folded into the light colour *before* the ramp is
 *     applied, so cast shadows are smooth too. Crisp form shading, soft shadows.
 *
 * Vertex colours work on toon materials, which is what lets the entire village
 * share one material and still be multicoloured — see `./geometry/builder.ts`.
 */

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  MeshBasicMaterial,
  MeshToonMaterial,
  NoColorSpace,
  RedFormat,
  type Texture,
} from 'three'

/**
 * Build a toon ramp addressed in `dot(N, L)` space.
 *
 * The shader samples the gradient at `dotNL * 0.5 + 0.5`, so the lower half of
 * the texture maps to surfaces facing away from the light. Authoring stops in
 * `dotNL` space rather than texel space avoids quietly wasting half the ramp.
 */
export function makeToonRamp(
  stops: readonly { at: number; value: number }[],
  { soft = true, width = 32 }: { soft?: boolean; width?: number } = {},
): Texture {
  const data = new Uint8Array(width)
  for (let i = 0; i < width; i++) {
    const coord = (i + 0.5) / width // texel centre, matching texture2D()
    const dotNL = coord * 2 - 1
    let value = stops[0].value
    for (const stop of stops) if (dotNL >= stop.at) value = stop.value
    data[i] = Math.round(Math.min(1, Math.max(0, value)) * 255)
  }

  const texture = new DataTexture(data, width, 1, RedFormat)
  texture.magFilter = soft ? LinearFilter : LinearFilter
  texture.minFilter = soft ? LinearFilter : LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  // This is data, not colour. Tagging it sRGB would crush the ramp.
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * The village ramp: two gentle steps with a high floor.
 *
 * `0.72` is the darkest any lit surface gets. Lower it toward 0.55 for a more
 * dramatic, later-in-the-day look; raise it toward 0.85 to flatten everything
 * into storybook illustration.
 */
export const COZY_RAMP = makeToonRamp(
  [
    { at: -1.0, value: 0.72 },
    { at: 0.28, value: 1.0 },
  ],
  { soft: true, width: 32 },
)

/**
 * The one material almost everything in the village uses.
 *
 * All colour comes from baked vertex colours, so a whole chunk — ground,
 * buildings, trees, fences — draws in a single call.
 */
export const villageMaterial = new MeshToonMaterial({
  vertexColors: true,
  gradientMap: COZY_RAMP,
})

/**
 * Water: the same toon shading, slightly translucent and slightly emissive so
 * it stays bright and inviting rather than reading as a dark hole in the
 * island.
 *
 * The ripple is a small vertex displacement injected via `onBeforeCompile`.
 * `customProgramCacheKey` is **required** — three.js caches compiled programs by
 * material parameters, so without a distinct key this material would silently
 * share the village material's program and the ripple would never appear.
 */
export const waterUniforms = { uTime: { value: 0 } }

export const waterMaterial = new MeshToonMaterial({
  vertexColors: true,
  gradientMap: COZY_RAMP,
  transparent: true,
  opacity: 0.9,
  emissive: new Color('#12384a'),
  emissiveIntensity: 0.35,
})

waterMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = waterUniforms.uTime
  shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     // Only lift the top surface; the sides of the prism must stay put or the
     // tile visibly detaches from its neighbours.
     if ( normal.y > 0.5 ) {
       float wave = sin( position.x * 1.7 + uTime * 1.1 )
                  * cos( position.z * 1.9 - uTime * 0.85 );
       transformed.y += wave * 0.035;
     }`,
  )
}
waterMaterial.customProgramCacheKey = () => 'cozy-water-ripple'

/**
 * The invisible plane that pointer events are raycast against.
 *
 * Picking a hex is a closed-form calculation from the ray/plane hit point (see
 * `worldToHex`), so we never raycast the terrain itself. That keeps picking O(1)
 * no matter how large the village grows, and it works over water and over empty
 * space where there is no geometry to hit.
 */
export const pickPlaneMaterial = new MeshBasicMaterial({
  visible: false,
  side: DoubleSide,
})

/** Material for the hover/selection highlight ring. */
export const highlightMaterial = new MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  toneMapped: false,
})

/** Frees everything. Only needed for tests and hot-reload teardown. */
export function disposeMaterials(): void {
  villageMaterial.dispose()
  waterMaterial.dispose()
  pickPlaneMaterial.dispose()
  highlightMaterial.dispose()
  COZY_RAMP.dispose()
}
