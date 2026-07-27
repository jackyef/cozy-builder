/**
 * The piece renderer registry.
 *
 * Maps catalog ids to the functions that build their geometry. This is the one
 * seam between "what a piece is" (`src/world/catalog.ts`) and "what it looks
 * like", and it is where a future GLTF-backed renderer would slot in — see
 * `./context.ts` and `docs/architecture.md`.
 *
 * A catalog entry with no renderer here falls back to {@link placeholder}, which
 * draws a visible marker rather than nothing. Silently rendering empty space is
 * the worst possible failure mode: the piece is in the save file, occupies the
 * hex and blocks placement, but the player cannot see why.
 */

import { COLORS } from '@/world/catalog'
import type { PieceId } from '@/world/types'
import type { PieceRenderer } from './context'
import { bush, flowers, rock, treePine, treeRound } from './nature'
import { bridge, fence, path } from './paths'
import { cottage, house, lamp, townHall, well } from './housing'
import { barn, field, pen, scarecrow, windmill } from './farm'
import { bakery, fountain, marketStall, tavern } from './market'
import { banner, castleWall, gate, keep, tower } from './castle'

/** Drawn for any catalog entry missing a renderer. */
export const placeholder: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const h = Math.max(0.4, ctx.def.height * 0.5)
  b.roundedBox({ size: [0.5, h, 0.5], color: '#c46fb0', bevel: 0.06, position: [0, h / 2, 0] })
  b.cone({ radius: 0.16, height: 0.24, color: COLORS.flowerWhite, position: [0, h, 0], segments: 4 })
}

export const PIECE_RENDERERS: Readonly<Record<PieceId, PieceRenderer>> = {
  // Nature
  tree_round: treeRound,
  tree_pine: treePine,
  bush,
  rock,
  flowers,

  // Paths
  path,
  fence,
  bridge,

  // Housing
  cottage,
  house,
  town_hall: townHall,
  well,
  lamp,

  // Farm
  field,
  barn,
  windmill,
  pen,
  scarecrow,

  // Market
  market_stall: marketStall,
  fountain,
  bakery,
  tavern,

  // Castle
  castle_wall: castleWall,
  tower,
  gate,
  keep,
  banner,
}

export function getRenderer(id: PieceId): PieceRenderer {
  return PIECE_RENDERERS[id] ?? placeholder
}

export { groundDetail } from './nature'
export type { PieceContext, PieceRenderer } from './context'
