/**
 * Pointer interaction: picking a hex, and previewing what will be built there.
 *
 * ## Picking without raycasting the world
 *
 * Pointer events hit a single large invisible plane. From the hit point we go
 * straight to a hex with `worldToHex`, which is closed-form arithmetic. The
 * terrain is never raycast.
 *
 * This matters more than it sounds. Raycasting thousands of tiles is slow, but
 * worse, it only works where geometry exists — you could not hover over water,
 * over a gap in the island, or over the empty space you are about to extend the
 * island into. One plane plus arithmetic is O(1), always works, and stays
 * correct however large the village grows.
 *
 * ## The gesture
 *
 * Pointer down starts a stroke, pointer move extends it, pointer up ends it.
 * The store handles interpolation between samples and collapses the whole drag
 * into a single undo step — see `src/state/store.ts`.
 *
 * Pointer capture is essential here: without it, dragging off the canvas and
 * releasing leaves the stroke open forever, and the next hover paints a line
 * across the map.
 */

import { useCallback, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { DoubleSide, type Mesh } from 'three'
import { HEX_SIZE, hexKey, hexToWorld, worldToHex, type Hex } from '@/core/hex'
import { computeConnectionMask } from '@/world/autoconnect'
import { getPiece, terrainOrDefault } from '@/world/catalog'
import { canPlaceAt, useBuilder } from '@/state/store'
import { MeshBuilder } from './geometry/builder'
import { makeVariance } from './pieces/context'
import { getRenderer } from './pieces'
import { COZY_RAMP } from './materials'
import { MeshToonMaterial } from 'three'

/** Half-extent of the pick plane. Large enough to cover any plausible village. */
const PICK_PLANE_SIZE = 400

/**
 * The invisible ground plane that receives all pointer events.
 */
export function Picker(): React.ReactElement {
  const beginStroke = useBuilder((s) => s.beginStroke)
  const extendStroke = useBuilder((s) => s.extendStroke)
  const endStroke = useBuilder((s) => s.endStroke)
  const setHovered = useBuilder((s) => s.setHovered)

  /** Last hex we reported, so we only touch the store when it actually changes. */
  const lastHex = useRef<string | null>(null)
  const meshRef = useRef<Mesh>(null)

  const hexAt = useCallback((event: ThreeEvent<PointerEvent>): Hex => {
    return worldToHex({ x: event.point.x, z: event.point.z })
  }, [])

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      // Only the primary button builds; the others belong to camera control.
      if (event.button !== 0) return
      event.stopPropagation()

      const target = event.nativeEvent.target as Element | null
      // Capture so a drag that leaves the canvas still delivers its pointerup.
      if (target && 'setPointerCapture' in target) {
        try {
          target.setPointerCapture(event.pointerId)
        } catch {
          /* capture is best-effort */
        }
      }

      const hex = hexAt(event)
      lastHex.current = hexKey(hex)
      beginStroke(hex)
    },
    [beginStroke, hexAt],
  )

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const hex = hexAt(event)
      const key = hexKey(hex)
      if (key === lastHex.current) return
      lastHex.current = key

      setHovered(hex)
      if (useBuilder.getState().painting) extendStroke(hex)
    },
    [extendStroke, hexAt, setHovered],
  )

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0) return
      const target = event.nativeEvent.target as Element | null
      if (target && 'releasePointerCapture' in target) {
        try {
          target.releasePointerCapture(event.pointerId)
        } catch {
          /* capture is best-effort */
        }
      }
      endStroke()
    },
    [endStroke],
  )

  const handlePointerLeave = useCallback(() => {
    lastHex.current = null
    setHovered(null)
    // Close any open stroke; a drag that ends off-canvas must not stay live.
    if (useBuilder.getState().painting) endStroke()
  }, [endStroke, setHovered])

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
    >
      <planeGeometry args={[PICK_PLANE_SIZE, PICK_PLANE_SIZE]} />
      <meshBasicMaterial visible={false} side={DoubleSide} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * The hover indicator: a coloured hex outline, plus a translucent ghost of the
 * piece that is about to be placed.
 *
 * Showing the actual piece — correctly autoconnected to its future neighbours —
 * rather than a generic marker is what makes the one-gesture build model
 * legible. You can see the wall turn the corner before you commit to it.
 */
export function HoverPreview(): React.ReactElement | null {
  const hovered = useBuilder((s) => s.hovered)
  const tool = useBuilder((s) => s.tool)
  const rotation = useBuilder((s) => s.rotation)
  const world = useBuilder((s) => s.world)

  const ghostMaterial = useMemo(
    () =>
      new MeshToonMaterial({
        vertexColors: true,
        gradientMap: COZY_RAMP,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    [],
  )

  /**
   * The ghost geometry.
   *
   * Built against a *hypothetical* world in which the piece already exists, so
   * its autoconnect mask reflects the neighbours it will actually link to.
   */
  const ghost = useMemo(() => {
    if (!hovered || tool.kind !== 'piece') return null
    const def = getPiece(tool.piece)
    if (!def) return null

    const key = hexKey(hovered)
    const speculativeWorld = {
      ...world,
      pieces: {
        ...world.pieces,
        [key]: def.rotatable ? { piece: def.id, rotation } : { piece: def.id },
      },
    }

    const builder = new MeshBuilder()
    const variance = makeVariance(world.seed, hovered)
    try {
      getRenderer(def.id)({
        builder,
        world: speculativeWorld,
        hex: hovered,
        placed: speculativeWorld.pieces[key],
        def,
        mask: def.connects ? computeConnectionMask(speculativeWorld, hovered) : 0,
        variant: variance.index('variant', def.variants ?? 1),
        rotationY: def.rotatable ? (rotation * Math.PI) / 3 : 0,
        groundY: 0,
        ...variance,
      })
    } catch {
      return null
    }
    return builder.isEmpty ? null : builder.toGeometry()
  }, [hovered, tool, rotation, world])

  if (!hovered) return null

  const { x, z } = hexToWorld(hovered)
  const terrainId = world.terrain[hexKey(hovered)]
  const elevation = terrainId ? terrainOrDefault(terrainId).elevation : 0

  const valid =
    tool.kind === 'piece'
      ? canPlaceAt(world, tool.piece, hovered)
      : tool.kind === 'erase'
        ? Boolean(world.pieces[hexKey(hovered)] || terrainId)
        : true

  const ringColor = tool.kind === 'erase' ? '#ff8a7a' : valid ? '#ffffff' : '#ff8a7a'

  return (
    <group position={[x, elevation + 0.02, z]}>
      {/* Hex outline. A six-segment ring rather than a filled hex, so it reads
          on top of any terrain colour. The extra 30° twist lines its corners up
          with a pointy-top hex, whose vertices sit at 60·i − 30 degrees. */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} renderOrder={10}>
        <ringGeometry args={[HEX_SIZE * 0.82, HEX_SIZE * 0.97, 6, 1]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      {valid && ghost && (
        <mesh geometry={ghost} material={ghostMaterial} renderOrder={11} />
      )}
    </group>
  )
}
