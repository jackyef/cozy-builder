/**
 * Renders and drives the village population.
 *
 * ## Structure
 *
 * One `InstancedMesh` per (kind, variant) — see `./models.ts` for why colour is
 * baked into variants rather than applied per instance. Roughly thirty meshes
 * covers everyone.
 *
 * The whole simulation runs in **one** `useFrame`. There is no React state per
 * agent and no component per agent; agents live in a plain array behind a ref
 * and their transforms are written straight into instance matrices. Anything
 * else re-renders React at sixty hertz for a village of walking capsules.
 *
 * ## Replanning
 *
 * When the world changes, the roster is replanned and reconciled by spec id, so
 * inhabitants who still belong stay exactly where they were. Only genuinely new
 * arrivals spawn and only departed ones vanish — otherwise every single click
 * would make the entire village blink and restart.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import { buildWalkGrid, findSpawnHex, planAgents, type WalkGrid } from '@/agents/director'
import {
  evictStrandedAgents,
  reconcileAgents,
  simulate,
  type Agent,
} from '@/agents/simulation'
import { villageMaterial } from '../materials'
import { agentGeometry, variantCount } from './models'
import type { AgentKind, World } from '@/world/types'

export interface AgentsProps {
  world: World
  enabled: boolean
}

/** One instanced mesh's worth of agents. */
interface Bucket {
  kind: AgentKind
  variant: number
  agents: Agent[]
}

const _dummy = new Object3D()

export function Agents({ world, enabled }: AgentsProps): React.ReactElement | null {
  const agentsRef = useRef<Agent[]>([])
  const gridRef = useRef<WalkGrid | null>(null)
  const elapsedRef = useRef(0)

  // Replan whenever the world changes. Both of these are cheap enough to do
  // synchronously on an edit — the walk grid is one pass over the tile maps.
  const { specs, grid } = useMemo(() => {
    const nextGrid = buildWalkGrid(world)
    return { specs: planAgents(world), grid: nextGrid }
  }, [world])

  useEffect(() => {
    gridRef.current = grid
    agentsRef.current = reconcileAgents(
      agentsRef.current,
      specs,
      grid,
      world.seed,
      findSpawnHex,
    )
    // Anyone the player just built on top of needs to walk somewhere legal.
    evictStrandedAgents(agentsRef.current, grid)
  }, [specs, grid, world.seed])

  /**
   * Group agents into instanced buckets.
   *
   * The variant is derived from a hash of the agent's stable id, so a given
   * villager keeps the same face and shirt for as long as they exist.
   */
  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>()
    for (const spec of specs) {
      const count = variantCount(spec.kind)
      const variant = hashId(spec.id) % count
      const key = `${spec.kind}:${variant}`
      let bucket = map.get(key)
      if (!bucket) {
        bucket = { kind: spec.kind, variant, agents: [] }
        map.set(key, bucket)
      }
      // Filled in each frame from the live array; this only fixes capacity.
      bucket.agents.push(null as unknown as Agent)
    }
    return [...map.entries()].map(([key, bucket]) => ({ key, ...bucket }))
  }, [specs])

  const meshRefs = useRef(new Map<string, InstancedMesh>())

  useFrame((_, delta) => {
    if (!enabled) return
    const grid = gridRef.current
    if (!grid) return

    elapsedRef.current += delta
    simulate(agentsRef.current, grid, delta, elapsedRef.current)

    // Write transforms. Agents are re-bucketed here rather than kept in sorted
    // order so the simulation array stays a single flat list.
    const counters = new Map<string, number>()
    for (const agent of agentsRef.current) {
      const count = variantCount(agent.spec.kind)
      const variant = hashId(agent.spec.id) % count
      const key = `${agent.spec.kind}:${variant}`
      const mesh = meshRefs.current.get(key)
      if (!mesh) continue

      const index = counters.get(key) ?? 0
      if (index >= mesh.count) continue
      counters.set(key, index + 1)

      _dummy.position.set(agent.x, agent.y, agent.z)
      _dummy.rotation.set(0, agent.yaw, 0)

      const speed = Math.hypot(agent.vx, agent.vz)
      if (agent.profile.flies) {
        // Fliers bank into their turns and flap by scaling on Z.
        _dummy.rotation.z = Math.sin(elapsedRef.current * 18 + agent.idlePhase) * 0.5
        _dummy.scale.set(agent.profile.scale, agent.profile.scale, agent.profile.scale)
      } else if (speed > 0.05) {
        // Walk cycle: a slight roll side to side, plus volume-preserving
        // squash on the footfalls. Both are small; at 5% they read as life,
        // at 15% they read as a bug.
        _dummy.rotation.z = Math.sin(agent.phase) * 0.055
        const squash = 1 + Math.abs(Math.cos(agent.phase)) * 0.045
        _dummy.scale.set(
          (agent.profile.scale * 1) / Math.sqrt(squash),
          agent.profile.scale * squash,
          (agent.profile.scale * 1) / Math.sqrt(squash),
        )
      } else {
        // Idle breathing.
        const breathe = 1 + Math.sin(elapsedRef.current * 1.5 + agent.idlePhase) * 0.02
        _dummy.rotation.z = 0
        _dummy.scale.set(
          agent.profile.scale / Math.sqrt(breathe),
          agent.profile.scale * breathe,
          agent.profile.scale / Math.sqrt(breathe),
        )
      }

      _dummy.updateMatrix()
      mesh.setMatrixAt(index, _dummy.matrix)
    }

    // Hide unused slots by collapsing their count, and flush the buffers.
    for (const [key, mesh] of meshRefs.current) {
      mesh.count = counters.get(key) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  if (!enabled) return null

  return (
    <group>
      {buckets.map((bucket) => (
        <instancedMesh
          key={bucket.key}
          ref={(mesh) => {
            if (mesh) meshRefs.current.set(bucket.key, mesh as InstancedMesh)
            else meshRefs.current.delete(bucket.key)
          }}
          args={[agentGeometry(bucket.kind, bucket.variant), villageMaterial, bucket.agents.length]}
          castShadow
          // The bounding sphere is computed from instance 0's geometry and
          // never updated as agents walk, so culling would make the whole
          // crowd vanish when the camera looks away from the origin.
          frustumCulled={false}
        />
      ))}
    </group>
  )
}

/** Small stable hash of an agent id, for picking its look. */
function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
