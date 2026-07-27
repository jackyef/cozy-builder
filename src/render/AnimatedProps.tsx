/**
 * The handful of things that move.
 *
 * Everything static is baked into chunk geometry, which is why the village
 * renders in a few draw calls. These three exceptions are rendered as real
 * scene objects because they animate:
 *
 *   - **Windmill sails** turn.
 *   - **Banners** ripple.
 *   - **Lamps** glow, and their glow strengthens after dark.
 *
 * All three read their placement from `AnimatedProp` records that the chunk
 * baker emits alongside the geometry, so the piece renderer stays a pure
 * geometry function and nothing has to reach into the world from here.
 *
 * Each prop carries a `phase`, hashed from its coordinate, so two windmills
 * side by side never turn in lockstep — synchronised motion is uncanny in a way
 * that is hard to place but immediately noticeable.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, Group, Mesh, MeshToonMaterial } from 'three'
import { COZY_RAMP } from './materials'
import { COLORS } from '@/world/catalog'
import type { AnimatedProp } from './chunks'

export interface AnimatedPropsProps {
  props: AnimatedProp[]
  /** 0 = day, 1 = night. Drives lamp brightness. */
  nightAmount: number
}

/**
 * How many lamps get a real point light.
 *
 * Every additional dynamic light re-lights every material it touches, so this
 * has to be bounded or a well-lit street tanks the frame rate. Beyond the cap,
 * lamps still show their emissive bulb — which is what actually reads as "lit"
 * — they just stop spilling light onto the ground.
 */
const MAX_LIT_LAMPS = 8

export function AnimatedProps({ props, nightAmount }: AnimatedPropsProps): React.ReactElement {
  const windmills = props.filter((p) => p.kind === 'windmill')
  const banners = props.filter((p) => p.kind === 'banner')
  const lamps = props.filter((p) => p.kind === 'lamp')

  return (
    <group>
      {windmills.map((p) => (
        <WindmillSails key={p.key} prop={p} />
      ))}
      {banners.map((p) => (
        <BannerCloth key={p.key} prop={p} />
      ))}
      {lamps.map((p, i) => (
        <LampGlow key={p.key} prop={p} nightAmount={nightAmount} lit={i < MAX_LIT_LAMPS} />
      ))}
    </group>
  )
}

/** Four sails on a hub, turning slowly about the mill's axis. */
function WindmillSails({ prop }: { prop: AnimatedProp }): React.ReactElement {
  const ref = useRef<Group>(null)
  const material = useMemo(
    () => new MeshToonMaterial({ color: COLORS.woodLight, gradientMap: COZY_RAMP }),
    [],
  )
  const clothMaterial = useMemo(
    () => new MeshToonMaterial({ color: COLORS.cloth, gradientMap: COZY_RAMP, side: DoubleSide }),
    [],
  )

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.x += delta * 0.55
  })

  return (
    <group position={[prop.x, prop.y, prop.z]} rotation={[0, prop.rotationY, 0]}>
      {/* Axle. The sail assembly spins about local X, which points out of the
          mill's face after the group's Y rotation. */}
      <mesh material={material} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.22, 8]} />
      </mesh>
      <group ref={ref} rotation={[prop.phase, 0, 0]} position={[0.14, 0, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[(i * Math.PI) / 2, 0, 0]}>
            <mesh position={[0, 0.62, 0]} material={material} castShadow>
              <boxGeometry args={[0.05, 1.24, 0.06]} />
            </mesh>
            <mesh position={[0.02, 0.66, 0.16]} material={clothMaterial} castShadow>
              <boxGeometry args={[0.02, 1.0, 0.24]} />
            </mesh>
          </group>
        ))}
        <mesh material={material} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.1, 8]} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * A pennant that ripples.
 *
 * Built as a strip of segments whose vertical offset and twist increase along
 * its length, driven by a travelling sine. A cloth simulation would be far more
 * work for a result nobody would look at more closely than this.
 */
function BannerCloth({ prop }: { prop: AnimatedProp }): React.ReactElement {
  const ref = useRef<Group>(null)
  const material = useMemo(
    () => new MeshToonMaterial({ color: new Color(prop.color), gradientMap: COZY_RAMP, side: DoubleSide }),
    [prop.color],
  )

  const SEGMENTS = 6
  const segmentLength = 0.13

  useFrame(({ clock }) => {
    const group = ref.current
    if (!group) return
    const t = clock.elapsedTime * 2.4 + prop.phase
    group.children.forEach((child, i) => {
      const along = i / SEGMENTS
      // Amplitude grows toward the free end — the fixed edge cannot move.
      const amplitude = along * along * 0.5
      child.position.y = Math.sin(t - along * 2.6) * amplitude * 0.16
      child.rotation.y = Math.sin(t - along * 2.6) * amplitude
      child.rotation.z = Math.cos(t * 0.8 - along * 2) * amplitude * 0.35
    })
  })

  return (
    <group position={[prop.x, prop.y, prop.z]} rotation={[0, prop.rotationY, 0]}>
      <group ref={ref}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <mesh
            key={i}
            position={[0.05 + i * segmentLength, 0, 0]}
            material={material}
            castShadow
          >
            <boxGeometry args={[segmentLength * 1.05, 0.42 - i * 0.03, 0.018]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/**
 * A lamp's glow: an emissive ball, plus a real point light after dark for the
 * first {@link MAX_LIT_LAMPS} lamps.
 */
function LampGlow({
  prop,
  nightAmount,
  lit,
}: {
  prop: AnimatedProp
  nightAmount: number
  lit: boolean
}): React.ReactElement | null {
  const ref = useRef<Mesh>(null)
  const material = useMemo(
    () =>
      new MeshToonMaterial({
        color: new Color(prop.color),
        emissive: new Color(prop.color),
        emissiveIntensity: 1,
        gradientMap: COZY_RAMP,
        toneMapped: false,
      }),
    [prop.color],
  )

  useFrame(({ clock }) => {
    if (!ref.current) return
    // A slow flicker, so the light feels like a flame rather than an LED.
    const flicker = 0.92 + Math.sin(clock.elapsedTime * 3.1 + prop.phase) * 0.05
    const scale = 1 + nightAmount * 0.25 * flicker
    ref.current.scale.setScalar(scale)
    material.emissiveIntensity = 0.35 + nightAmount * 0.9 * flicker
  })

  return (
    <group position={[prop.x, prop.y, prop.z]}>
      <mesh ref={ref} material={material}>
        <sphereGeometry args={[0.1, 10, 8]} />
      </mesh>
      {lit && nightAmount > 0.25 && (
        <pointLight
          color={prop.color}
          intensity={nightAmount * 3.2}
          distance={5.5}
          decay={2}
          castShadow={false}
        />
      )}
    </group>
  )
}
