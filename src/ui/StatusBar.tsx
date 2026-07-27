/**
 * A small readout of what the village currently contains.
 *
 * Population is the interesting number: it is *derived*, not stored, so
 * watching it change as you build is the clearest possible demonstration of how
 * the agent director works. Build a market, the number goes up.
 */

import { useMemo } from 'react'
import { useBuilder } from '@/state/store'
import { planAgents } from '@/agents/director'
import { getPiece } from '@/world/catalog'

export function StatusBar(): React.ReactElement {
  const world = useBuilder((s) => s.world)
  const hovered = useBuilder((s) => s.hovered)

  const stats = useMemo(() => {
    const pieces = Object.values(world.pieces)
    const tiles = Object.keys(world.terrain).length
    const agents = planAgents(world)

    let people = 0
    let animals = 0
    for (const agent of agents) {
      if (['villager', 'guard', 'farmer', 'merchant', 'child'].includes(agent.kind)) people++
      else animals++
    }

    return { pieces: pieces.length, tiles, people, animals }
  }, [world])

  const hoveredLabel = useMemo(() => {
    if (!hovered) return null
    const key = `${hovered.q},${hovered.r}`
    const placed = world.pieces[key]
    const terrain = world.terrain[key]
    if (placed) return getPiece(placed.piece)?.name ?? placed.piece
    if (terrain) return terrain
    return 'open water'
  }, [hovered, world])

  return (
    <div className="status-bar">
      <Stat icon="🧱" value={stats.pieces} label="pieces" />
      <Stat icon="🗺️" value={stats.tiles} label="tiles" />
      <Stat icon="🧑" value={stats.people} label="villagers" />
      <Stat icon="🐑" value={stats.animals} label="animals" />
      {hovered && (
        <span className="status-bar__hover">
          {hoveredLabel} <span className="status-bar__coord">{hovered.q},{hovered.r}</span>
        </span>
      )}
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: string
  value: number
  label: string
}): React.ReactElement {
  return (
    <span className="status-bar__stat" title={label}>
      <span aria-hidden>{icon}</span> {value}
    </span>
  )
}
