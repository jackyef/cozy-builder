/**
 * Renders the baked world.
 *
 * Each chunk is at most two meshes — opaque and water — so a full village is a
 * few dozen draw calls regardless of how many pieces are in it. See
 * `./chunks.ts` for how the geometry is produced and invalidated.
 *
 * ## A note on shadow updates
 *
 * The obvious optimisation here is `shadowMap.autoUpdate = false` plus a
 * one-shot `needsUpdate` whenever the geometry changes: the *buildings* only
 * change when the player edits them, and a shadow pass is a complete extra
 * render of the scene.
 *
 * It is the wrong optimisation for this project, and it was tried and removed.
 * The village is never actually static — villagers walk around it continuously,
 * and freezing the shadow map glues their shadows to the ground while they walk
 * out from under them. It also makes correctness depend on every code path
 * remembering to request a refresh, and a missed one fails *silently*: the
 * scene renders with no shadows at all and simply looks flat, with nothing to
 * indicate why.
 *
 * If agents are ever made optional-and-off by default, this becomes worth
 * revisiting — but it must then be driven by "is anything moving", not by "did
 * the geometry change".
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { ChunkCache, type AnimatedProp, type BakedChunk } from './chunks'
import { villageMaterial, waterMaterial, waterUniforms } from './materials'
import type { World } from '@/world/types'

export interface WorldChunksProps {
  world: World
  /** Called whenever the baked set changes, with the animated props to render. */
  onProps?: (props: AnimatedProp[]) => void
}

export function WorldChunks({ world, onProps }: WorldChunksProps): React.ReactElement {
  const cache = useMemo(() => new ChunkCache(), [])

  // Rebaking is synchronous and fast (one chunk per edit), so it happens during
  // render rather than in an effect — that keeps the geometry in lockstep with
  // the world and avoids a frame of stale visuals after every click.
  const chunks: BakedChunk[] = useMemo(() => cache.update(world), [cache, world])

  useEffect(() => () => cache.dispose(), [cache])

  useEffect(() => {
    if (!onProps) return
    onProps(chunks.flatMap((c) => c.props))
  }, [chunks, onProps])

  useFrame((_, delta) => {
    waterUniforms.uTime.value += delta
  })

  return (
    <group>
      {chunks.map((chunk) => (
        <group key={chunk.key}>
          {chunk.solid && (
            <mesh geometry={chunk.solid} material={villageMaterial} castShadow receiveShadow />
          )}
          {chunk.water && <mesh geometry={chunk.water} material={waterMaterial} receiveShadow />}
        </group>
      ))}
    </group>
  )
}
