/**
 * The 3D scene.
 *
 * ## Lighting rig
 *
 * A hemisphere light for ambient fill and one directional light for the sun.
 * Notably **not** an `AmbientLight`: a flat ambient term adds the same value to
 * every surface regardless of orientation, which destroys the form read
 * entirely. A hemisphere light gives a sky-to-ground gradient along the surface
 * normal, which is exactly the soft top-lit falloff this style wants — and it
 * is what makes shadowed faces read as cool blue-green rather than grey.
 *
 * Intensities look high compared to older three.js material. They are correct:
 * the legacy lighting mode was removed in r165, and every pre-r155 intensity
 * needs multiplying by π. A tutorial's `intensity: 0.6` is `1.9` today.
 *
 * ## Shadows
 *
 * `shadows="percentage"` selects `PCFShadowMap`. Passing `shadows` alone would
 * select `PCFSoftShadowMap`, which three.js r182+ has removed — it warns and
 * silently downgrades to exactly the same thing. PCF post-r182 is already soft.
 *
 * The shadow camera frustum is kept tight on purpose. Texel density is
 * `mapSize / frustumWidth`, so widening the frustum to cover a bigger island
 * without raising `mapSize` is the single most common cause of blocky shadows.
 *
 * ## Tone mapping
 *
 * `NeutralToneMapping`, overriding R3F's `ACESFilmic` default. ACES bakes
 * channel-blending desaturation in at *all* luminances, which eats precisely
 * the mid-saturation greens and cyans this palette is built from. Neutral is an
 * identity function below a 0.76 peak — which covers our whole palette — with a
 * graceful rolloff above it instead of hard clipping.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  FogExp2,
  MOUSE,
  NeutralToneMapping,
  TOUCH,
  type Color as ThreeColor,
  type DirectionalLight,
} from 'three'
import { useBuilder } from '@/state/store'
import { DAY_LENGTH_SECONDS, dayCycle } from './lighting'
import { SkyDome } from './SkyDome'
import { WorldChunks } from './WorldChunks'
import { AnimatedProps } from './AnimatedProps'
import { Agents } from './agents/Agents'
import { HoverPreview, Picker } from './Interaction'
import { DebugHandle } from './DebugHandle'
import { KeyboardCamera } from './KeyboardCamera'
import type { AnimatedProp } from './chunks'

export function Scene(): React.ReactElement {
  return (
    <Canvas
      // See the docblock: 'percentage' is PCFShadowMap, which is what we want
      // on three r182+.
      shadows="percentage"
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{
        // A long lens. Perspective compression is what makes the village read
        // as a model rather than a place — the core of the diorama look.
        fov: 22,
        near: 1,
        far: 400,
        position: [26, 20, 26],
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1.0
      }}
    >
      <Suspense fallback={null}>
        <SceneContents />
      </Suspense>
    </Canvas>
  )
}

function SceneContents(): React.ReactElement {
  const world = useBuilder((s) => s.world)
  const showAgents = useBuilder((s) => s.showAgents)
  const timeOfDay = useBuilder((s) => s.timeOfDay)
  const tool = useBuilder((s) => s.tool)

  const [props, setProps] = useState<AnimatedProp[]>([])
  const day = useMemo(() => dayCycle(timeOfDay), [timeOfDay])

  return (
    <>
      <DayClock />
      <DebugHandle />
      <SceneEnvironment day={day} />

      <hemisphereLight
        args={[day.hemiSky, day.hemiGround, day.hemiIntensity]}
      />

      <Sun day={day} />

      <SkyDome topColor={day.skyTop} horizonColor={day.skyHorizon} />

      <WorldChunks world={world} onProps={setProps} />
      <AnimatedProps props={props} nightAmount={day.nightAmount} />
      <Agents world={world} enabled={showAgents} />

      <Picker />
      <HoverPreview />
      <KeyboardCamera />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        // Left-drag builds, so orbiting moves to the right button. Middle-drag
        // pans. The 'pan' tool in the palette hands the left button back for
        // players who would rather not use a right button at all.
        mouseButtons={{
          LEFT: tool.kind === 'pan' ? MOUSE.ROTATE : (-1 as unknown as MOUSE),
          MIDDLE: MOUSE.PAN,
          RIGHT: MOUSE.ROTATE,
        }}
        touches={{
          ONE: tool.kind === 'pan' ? TOUCH.ROTATE : (-1 as unknown as TOUCH),
          TWO: TOUCH.DOLLY_PAN,
        }}
        // Keep the camera in the shallow band the art direction assumes. Looking
        // straight down flattens the buildings and the look collapses.
        minPolarAngle={Math.PI * 0.12}
        maxPolarAngle={Math.PI * 0.44}
        minDistance={8}
        maxDistance={90}
        target={[0, 0, 0]}
        // Panning across the ground plane, not through the camera's own plane.
        screenSpacePanning={false}
      />
    </>
  )
}

/**
 * The sun: one directional light, and the only shadow caster in the scene.
 *
 * ## Why this isn't just JSX props
 *
 * Setting `shadow-camera-left` and friends declaratively assigns the values but
 * **does not rebuild the shadow camera's projection matrix**. `LightShadow`
 * reuses whatever `projectionMatrix` the camera already has, so the frustum
 * stays at its 10×10 default and shadows only appear in a tiny patch near the
 * origin — everything else silently renders unshadowed. It looks like shadows
 * are "just soft", which is why this is easy to miss.
 *
 * So the frustum is configured imperatively and followed by an explicit
 * `updateProjectionMatrix()`.
 *
 * ## Frustum sizing
 *
 * Shadow texel density is `mapSize / frustumWidth`. At 2048 over a 76-unit
 * span that is ~27 texels per world unit, which is crisp for chunky geometry.
 * Widening the frustum to cover a bigger island without raising `mapSize` is
 * the usual cause of blocky shadows — change both together.
 */
function Sun({ day }: { day: ReturnType<typeof dayCycle> }): React.ReactElement {
  const ref = useRef<DirectionalLight>(null)

  const HALF_EXTENT = 38

  useEffect(() => {
    const light = ref.current
    if (!light) return

    const camera = light.shadow.camera
    camera.left = -HALF_EXTENT
    camera.right = HALF_EXTENT
    camera.top = HALF_EXTENT
    camera.bottom = -HALF_EXTENT
    // Kept tight around the island. The light sits SUN_DISTANCE away, so
    // everything worth shadowing falls in a narrow depth band around it, and a
    // near plane at 1 would throw away most of the depth buffer's precision.
    camera.near = 20
    camera.far = 130
    camera.updateProjectionMatrix()

    light.shadow.mapSize.set(2048, 2048)
    // `mapSize` is only read when the render target is allocated, which happens
    // on the first shadow pass — potentially before this effect runs. If the
    // map already exists at the wrong size, drop it so three rebuilds it.
    // Without this the shadows silently stay at the 512² default.
    if (light.shadow.map && light.shadow.map.width !== 2048) {
      light.shadow.map.dispose()
      light.shadow.map = null
    }

    // normalBias fights acne on the rounded, chamfered geometry this project is
    // made of; a small negative bias handles the flat tops.
    light.shadow.bias = -0.0004
    light.shadow.normalBias = 0.03

  }, [])

  useEffect(() => {
    const light = ref.current
    if (!light) return
    // Shadows never go fully black. A large part of the high-key cosy read, and
    // cheaper to control here than by raising ambient light.
    light.shadow.intensity = day.shadowIntensity
  }, [day.shadowIntensity])

  return (
    <directionalLight
      ref={ref}
      position={day.sunPosition}
      intensity={day.sunIntensity}
      color={day.sunColor}
      castShadow
    />
  )
}

/** Applies fog and the clear colour, which must track the sky exactly. */
function SceneEnvironment({ day }: { day: ReturnType<typeof dayCycle> }): null {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    // Fog is applied after tone mapping and after colour-space conversion, so
    // fogColor renders as literally the sRGB value given. Matching it to the
    // sky horizon (also untone-mapped) is exact and free; letting them drift is
    // the usual cause of a visible seam at the horizon.
    const fog = new FogExp2(day.fogColor, day.fogDensity)
    scene.fog = fog
    gl.setClearColor(fog.color as ThreeColor, 1)
    return () => {
      scene.fog = null
    }
  }, [scene, gl, day.fogColor, day.fogDensity])

  return null
}

/**
 * Advances the time of day when the clock is running.
 *
 * The delta is clamped before scaling, so a backgrounded tab does not resume by
 * jumping several days forward — at 8x an unclamped delta of a few seconds
 * would skip right past dusk.
 */
function DayClock(): null {
  const timeFlowing = useBuilder((s) => s.timeFlowing)
  const timeScale = useBuilder((s) => s.timeScale)
  const setTimeOfDay = useBuilder((s) => s.setTimeOfDay)

  useFrame((_, rawDelta) => {
    if (!timeFlowing) return
    const delta = Math.min(rawDelta, 1 / 20) * timeScale
    const current = useBuilder.getState().timeOfDay
    setTimeOfDay((current + delta / DAY_LENGTH_SECONDS) % 1)
  })

  return null
}
