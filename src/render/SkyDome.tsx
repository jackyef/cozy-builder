/**
 * The sky: a large inverted sphere with a two-colour vertical gradient.
 *
 * Deliberately not drei's `<Sky>`, which is a physical daylight model. Physical
 * skies produce physically-correct horizon desaturation and a real sun disc —
 * the opposite of the flat, authored, slightly unreal band this style wants —
 * and they cannot be pinned to an exact colour, so the fog would never match.
 *
 * ## The one thing that always goes wrong here
 *
 * A raw `ShaderMaterial` writing `gl_FragColor` gets **neither tone mapping nor
 * output colour-space conversion**. Uniform colours are in the linear working
 * space, so without `#include <colorspace_fragment>` the sky renders dark and
 * oversaturated and will never line up with the fog. That include is not
 * optional.
 */

import { useMemo, useRef } from 'react'
import { BackSide, Color, ShaderMaterial } from 'three'
import { useFrame } from '@react-three/fiber'

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;
  varying vec3 vWorldPosition;

  void main() {
    float h = normalize( vWorldPosition + offset ).y;
    gl_FragColor = vec4(
      mix( bottomColor, topColor, max( pow( max( h, 0.0 ), exponent ), 0.0 ) ),
      1.0
    );
    #include <colorspace_fragment>
  }
`

export interface SkyDomeProps {
  topColor: string
  horizonColor: string
  /** Drops the gradient midpoint toward eye level. Roughly the island radius. */
  offset?: number
  /** Below 1 widens the pale horizon band, which reads cosier. */
  exponent?: number
  radius?: number
}

export function SkyDome({
  topColor,
  horizonColor,
  offset = 30,
  exponent = 0.62,
  radius = 320,
}: SkyDomeProps): React.ReactElement {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          topColor: { value: new Color(topColor) },
          bottomColor: { value: new Color(horizonColor) },
          offset: { value: offset },
          exponent: { value: exponent },
        },
        vertexShader,
        fragmentShader,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    // Built once; colours are updated imperatively below so a changing time of
    // day never triggers a shader recompile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const lastTop = useRef(topColor)
  const lastHorizon = useRef(horizonColor)

  useFrame(() => {
    if (lastTop.current !== topColor) {
      ;(material.uniforms.topColor.value as Color).set(topColor)
      lastTop.current = topColor
    }
    if (lastHorizon.current !== horizonColor) {
      ;(material.uniforms.bottomColor.value as Color).set(horizonColor)
      lastHorizon.current = horizonColor
    }
    material.uniforms.offset.value = offset
    material.uniforms.exponent.value = exponent
  })

  return (
    <mesh material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  )
}
