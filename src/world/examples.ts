/**
 * Prebuilt sample villages.
 *
 * These exist for three reasons:
 *
 *  1. **A first impression.** Opening to an empty island is a worse
 *     introduction than opening to somewhere that already looks alive.
 *  2. **Documentation by example.** Each one demonstrates a different part of
 *     the system — autoconnecting paths, a closed wall circuit, contiguous
 *     fields — so it doubles as a reference for what the pieces can do.
 *  3. **Serialization fixtures.** The tests round-trip every one of these
 *     through `serializeWorld`/`deserializeWorld`, which exercises the save
 *     format against realistic content rather than a toy object.
 *
 * They are *composed in code* rather than shipped as JSON so they stay small,
 * readable and diffable, and so improvements to the piece set flow through
 * automatically. They are still ordinary worlds — you can load one, edit it and
 * export it like anything else.
 */

import {
  hexLine,
  hexRange,
  hexRing,
  hexDistance,
  ORIGIN,
  type Hex,
} from '@/core/hex'
import { makeRng } from '@/core/rng'
import {
  clearPiece,
  draftFrom,
  finishDraft,
  generateIsland,
  paint,
  put,
  putLine,
  type Draft,
} from './generate'
import type { World } from './types'

export interface ExampleVillage {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  /** Built on demand — composing all of them up front is wasted work. */
  readonly build: () => World
}

/** Clear a disc so a settlement isn't fighting the generator's forest. */
function clearArea(draft: Draft, centre: Hex, radius: number, terrain?: string): void {
  for (const cell of hexRange(centre, radius)) {
    clearPiece(draft, cell)
    if (terrain) paint(draft, cell, terrain)
    else if (!draft.terrain[`${cell.q},${cell.r}`]) paint(draft, cell, 'grass')
    // Never leave a settlement half-submerged.
    if (draft.terrain[`${cell.q},${cell.r}`] === 'water') paint(draft, cell, 'grass')
  }
}

// ---------------------------------------------------------------------------
// Willowbrook — a market town
// ---------------------------------------------------------------------------

/**
 * Demonstrates the path network: a plaza with roads radiating out, houses
 * fronting onto them, and a small farm at the edge.
 */
function buildWillowbrook(): World {
  const base = generateIsland({ seed: 0x5eed17, name: 'Willowbrook', radius: 14 })
  const draft = draftFrom(base)
  const rng = makeRng(0x5eed17)

  clearArea(draft, ORIGIN, 4)

  // Central plaza: a stone-paved ring around a fountain.
  for (const cell of hexRange(ORIGIN, 2)) paint(draft, cell, 'stone')
  put(draft, ORIGIN, 'fountain')

  // Four market stalls facing the fountain.
  const stallRing = hexRing(ORIGIN, 1)
  for (let i = 0; i < stallRing.length; i += 2) {
    put(draft, stallRing[i], 'market_stall', { rotation: (i + 3) % 6 })
  }

  // Roads out of the plaza in three directions. The autoconnect system turns
  // these into a junction at the centre with no extra work.
  const spokes: Hex[] = [
    { q: 7, r: 0 },
    { q: -4, r: 7 },
    { q: -4, r: -3 },
  ]
  for (const end of spokes) {
    putLine(draft, hexLine({ q: 0, r: 2 }, end), 'path')
    putLine(draft, hexLine(ORIGIN, end).slice(2), 'path')
  }

  // Houses along the roads, alternating sides.
  const housePlots: Hex[] = [
    { q: 3, r: -1 },
    { q: 4, r: 1 },
    { q: 5, r: -1 },
    { q: 6, r: 1 },
    { q: -2, r: 4 },
    { q: -4, r: 5 },
    { q: -1, r: 5 },
    { q: -3, r: 7 },
    { q: -3, r: -1 },
    { q: -5, r: -1 },
    { q: -2, r: -3 },
    { q: -5, r: -2 },
  ]
  for (const plot of housePlots) {
    clearPiece(draft, plot)
    put(draft, plot, rng.chance(0.6) ? 'cottage' : 'house', { rotation: rng.int(6) })
  }

  // Civic buildings around the plaza.
  put(draft, { q: 2, r: -2 }, 'town_hall', { rotation: 3 })
  put(draft, { q: -2, r: 2 }, 'tavern', { rotation: 0 })
  put(draft, { q: 2, r: 1 }, 'bakery', { rotation: 3 })
  put(draft, { q: -2, r: 0 }, 'well')

  // Street lighting.
  for (const lamp of [
    { q: 1, r: 2 },
    { q: -1, r: -2 },
    { q: 3, r: 1 },
    { q: -3, r: 3 },
  ]) {
    clearPiece(draft, lamp)
    put(draft, lamp, 'lamp')
  }

  // A little farm on the eastern edge, showing contiguous fields.
  const farmCentre: Hex = { q: 8, r: 2 }
  clearArea(draft, farmCentre, 3)
  put(draft, farmCentre, 'barn', { rotation: 3 })
  for (const cell of hexRange({ q: 9, r: 3 }, 1)) put(draft, cell, 'field')
  put(draft, { q: 7, r: 4 }, 'pen')
  put(draft, { q: 8, r: 4 }, 'pen')

  // Fenced gardens behind a couple of the houses.
  putLine(draft, hexLine({ q: 5, r: 2 }, { q: 7, r: 2 }), 'fence')

  return finishDraft(draft, 'Willowbrook')
}

// ---------------------------------------------------------------------------
// Thornkeep — a castle
// ---------------------------------------------------------------------------

/**
 * Demonstrates the wall autoconnect system: a closed curtain wall with towers
 * at the corners and a gatehouse where the road enters. Guards patrol the
 * rampart automatically.
 */
function buildThornkeep(): World {
  const base = generateIsland({ seed: 0x7a17e, name: 'Thornkeep', radius: 14 })
  const draft = draftFrom(base)
  const rng = makeRng(0x7a17e)

  clearArea(draft, ORIGIN, 6)

  // Curtain wall: a ring, with towers spaced around it.
  const wallRing = hexRing(ORIGIN, 4)
  for (let i = 0; i < wallRing.length; i++) {
    const cell = wallRing[i]
    // Every fourth block becomes a tower, which the wall connects straight to.
    put(draft, cell, i % 4 === 0 ? 'tower' : 'castle_wall', { under: 'stone' })
  }

  // Gatehouse on the eastern face, replacing a wall block.
  const gateCell = wallRing.find((c) => c.q > 3 && c.r === 0) ?? wallRing[0]
  put(draft, gateCell, 'gate', { under: 'stone' })

  // Road in through the gate.
  putLine(draft, hexLine({ q: 5, r: 0 }, { q: 11, r: 0 }), 'path')
  putLine(draft, hexLine({ q: 3, r: 0 }, ORIGIN), 'path')

  // The keep at the centre, on a stone court.
  for (const cell of hexRange(ORIGIN, 1)) paint(draft, cell, 'stone')
  put(draft, ORIGIN, 'keep', { rotation: 0 })

  // Banners flanking the keep.
  put(draft, { q: 1, r: -1 }, 'banner')
  put(draft, { q: 1, r: 1 }, 'banner')
  put(draft, { q: -1, r: 1 }, 'banner')
  put(draft, { q: -1, r: 0 }, 'banner')

  // Barracks and stores inside the walls.
  for (const cell of [
    { q: -3, r: 1 },
    { q: -2, r: 3 },
    { q: 0, r: -3 },
    { q: 2, r: -3 },
    { q: -3, r: -1 },
  ]) {
    put(draft, cell, 'house', { rotation: rng.int(6) })
  }
  put(draft, { q: 2, r: 2 }, 'well')

  // A village grown up outside the gate.
  for (const cell of [
    { q: 7, r: -2 },
    { q: 8, r: -1 },
    { q: 7, r: 2 },
    { q: 9, r: 1 },
    { q: 6, r: -3 },
  ]) {
    clearPiece(draft, cell)
    put(draft, cell, 'cottage', { rotation: rng.int(6) })
  }
  put(draft, { q: 8, r: 2 }, 'market_stall', { rotation: 3 })

  return finishDraft(draft, 'Thornkeep')
}

// ---------------------------------------------------------------------------
// Harvest Hollow — farmland
// ---------------------------------------------------------------------------

/**
 * Demonstrates fields merging into contiguous ploughed land, plus a fenced
 * network of animal pens. Densely populated by farmers and livestock.
 */
function buildHarvestHollow(): World {
  const base = generateIsland({ seed: 0xfa12, name: 'Harvest Hollow', radius: 13 })
  const draft = draftFrom(base)
  const rng = makeRng(0xfa12)

  clearArea(draft, ORIGIN, 7)

  // A broad sweep of fields, with a couple of gaps so it isn't a solid block.
  for (const cell of hexRange({ q: -2, r: -1 }, 3)) {
    if (hexDistance(cell, { q: -3, r: 0 }) === 0) continue
    put(draft, cell, 'field')
  }
  for (const cell of hexRange({ q: 3, r: 2 }, 2)) put(draft, cell, 'field')

  // Farmstead.
  put(draft, { q: 2, r: -2 }, 'barn', { rotation: 3 })
  put(draft, { q: 4, r: -3 }, 'windmill')
  put(draft, { q: 0, r: -4 }, 'cottage', { rotation: 4 })
  put(draft, { q: 2, r: -5 }, 'cottage', { rotation: 3 })
  put(draft, { q: -1, r: -3 }, 'well')

  // Pens, which share the fence connection group and so join up.
  for (const cell of hexRange({ q: 5, r: -1 }, 1)) put(draft, cell, 'pen')
  putLine(draft, hexLine({ q: 4, r: 1 }, { q: 7, r: 1 }), 'fence')

  // A track running through the farm.
  putLine(draft, hexLine({ q: -6, r: 2 }, { q: 6, r: -4 }), 'path')

  // Scarecrows watching over the crops, and a fenced orchard.
  put(draft, { q: -2, r: 1 }, 'scarecrow')
  put(draft, { q: 3, r: 3 }, 'scarecrow')
  for (const cell of hexRing({ q: -5, r: -2 }, 2)) put(draft, cell, 'fence')
  for (const cell of hexRange({ q: -5, r: -2 }, 1)) {
    if (rng.chance(0.75)) put(draft, cell, 'tree_round')
  }

  // Wildflowers along the edges.
  for (const cell of hexRing(ORIGIN, 7)) {
    if (rng.chance(0.25)) {
      clearPiece(draft, cell)
      put(draft, cell, 'flowers')
    }
  }

  return finishDraft(draft, 'Harvest Hollow')
}

// ---------------------------------------------------------------------------

export const EXAMPLE_VILLAGES: readonly ExampleVillage[] = [
  {
    id: 'willowbrook',
    name: 'Willowbrook',
    description: 'A market town with a busy plaza and roads out to the fields.',
    icon: '🎪',
    build: buildWillowbrook,
  },
  {
    id: 'thornkeep',
    name: 'Thornkeep',
    description: 'A walled castle with patrolling guards and a village outside the gate.',
    icon: '🏰',
    build: buildThornkeep,
  },
  {
    id: 'harvest-hollow',
    name: 'Harvest Hollow',
    description: 'Rolling farmland, animal pens and a windmill.',
    icon: '🌾',
    build: buildHarvestHollow,
  },
]

export function getExample(id: string): ExampleVillage | undefined {
  return EXAMPLE_VILLAGES.find((v) => v.id === id)
}
