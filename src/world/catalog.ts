/**
 * The catalog — every terrain type and every buildable piece.
 *
 * This is the single place where content is declared. A new building needs an
 * entry here plus a renderer registered in `src/render/pieces/index.ts`; no
 * other file has to change. Placement rules, palette entry, autoconnect
 * behaviour and which inhabitants show up all follow from the data below.
 *
 * ## Adding a piece
 *
 *  1. Add a {@link PieceDefinition} to `PIECE_LIST`.
 *  2. Register a renderer under the same id in `src/render/pieces/index.ts`.
 *  3. That's it — the palette, save format and agent director pick it up.
 *
 * Ids are written into save files, so **renaming an id is a breaking change**.
 * Add a migration in `src/world/serialize.ts` if you must rename one.
 */

import type { PieceDefinition, PieceId, TerrainDefinition, TerrainId } from './types'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Shared colours, kept here so the whole village stays in one key. The look is
 * soft and high-value: nothing fully saturated, nothing near black. Shadows do
 * the contrast work instead of dark pigment, which is most of what makes the
 * style read as cosy rather than flat.
 */
export const COLORS = {
  grass: '#8ec962',
  grassDark: '#6fae4c',
  meadow: '#a5d977',
  dirt: '#c8a06e',
  soil: '#96674a',
  sand: '#f2e0b0',
  stone: '#b3b0aa',
  stoneDark: '#8d8a85',
  water: '#67c6e8',
  waterDeep: '#48a8d4',

  woodLight: '#d8a86a',
  wood: '#b07a45',
  woodDark: '#8a5a32',
  timber: '#7a4f2e',

  plaster: '#f6ead6',
  plasterWarm: '#f3ddbd',

  roofRed: '#d96a5f',
  roofBlue: '#6f9ad4',
  roofGreen: '#79b087',
  roofOrange: '#e39158',
  roofPurple: '#a288c4',
  thatch: '#dbb968',

  leafSpring: '#7fc25c',
  leafDeep: '#5fa04f',
  leafPine: '#4f8f63',
  leafOlive: '#93b95e',

  flowerPink: '#f2a3bd',
  flowerWhite: '#fdf6ef',
  flowerYellow: '#f7d371',

  cloth: '#f4f0e6',
  clothRed: '#e0645f',
  clothBlue: '#6aa5d8',
  banner: '#c4576a',

  skin: '#f0c4a0',
  skinDeep: '#c98d63',

  crop: '#c9bd5c',
  cropYoung: '#93bd5c',
} as const

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * Terrain is painted with the same click-and-drag gesture as pieces, so it
 * appears in the palette as its own category.
 */
export const TERRAIN_LIST: readonly TerrainDefinition[] = [
  {
    id: 'grass',
    name: 'Grass',
    icon: '🌱',
    color: COLORS.grass,
    elevation: 0,
    buildable: true,
    walkable: true,
  },
  {
    id: 'meadow',
    name: 'Meadow',
    icon: '🌼',
    color: COLORS.meadow,
    elevation: 0,
    buildable: true,
    walkable: true,
    spawns: [{ kind: 'butterfly', count: 0.35, radius: 2, behavior: 'flit' }],
  },
  {
    id: 'dirt',
    name: 'Dirt',
    icon: '🟫',
    color: COLORS.dirt,
    elevation: -0.02,
    buildable: true,
    walkable: true,
  },
  {
    id: 'soil',
    name: 'Tilled soil',
    icon: '🌾',
    color: COLORS.soil,
    elevation: -0.02,
    buildable: true,
    walkable: true,
  },
  {
    id: 'sand',
    name: 'Sand',
    icon: '🏖️',
    color: COLORS.sand,
    elevation: -0.04,
    buildable: true,
    walkable: true,
  },
  {
    id: 'stone',
    name: 'Stone',
    icon: '🪨',
    color: COLORS.stone,
    elevation: 0.02,
    buildable: true,
    walkable: true,
  },
  {
    id: 'water',
    name: 'Water',
    icon: '💧',
    color: COLORS.water,
    // Sunk well below the land so the shoreline reads as a bank, not a seam.
    elevation: -0.26,
    buildable: false,
    walkable: false,
    spawns: [{ kind: 'duck', count: 0.4, radius: 2, behavior: 'graze' }],
  },
]

export const TERRAIN: Readonly<Record<TerrainId, TerrainDefinition>> = Object.fromEntries(
  TERRAIN_LIST.map((t) => [t.id, t]),
)

/** Terrain used for hexes that have never been painted. */
export const DEFAULT_TERRAIN: TerrainId = 'grass'

export function getTerrain(id: TerrainId): TerrainDefinition | undefined {
  return TERRAIN[id]
}

/** Terrain lookup that always succeeds, falling back to grass. */
export function terrainOrDefault(id: TerrainId | undefined): TerrainDefinition {
  return (id ? TERRAIN[id] : undefined) ?? TERRAIN[DEFAULT_TERRAIN]
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export const PIECE_LIST: readonly PieceDefinition[] = [
  // --- Nature ------------------------------------------------------------
  {
    id: 'tree_round',
    name: 'Round tree',
    description: 'A big friendly blob of leaves.',
    category: 'nature',
    icon: '🌳',
    height: 2.6,
    variants: 3,
    spawns: [{ kind: 'bird', count: 0.25, radius: 3, behavior: 'flit' }],
  },
  {
    id: 'tree_pine',
    name: 'Pine tree',
    description: 'Stacked cones. Smells like winter.',
    category: 'nature',
    icon: '🌲',
    height: 3.2,
    variants: 3,
    spawns: [{ kind: 'bird', count: 0.2, radius: 3, behavior: 'flit' }],
  },
  {
    id: 'bush',
    name: 'Bush',
    description: 'Low and round. Good for hiding behind.',
    category: 'nature',
    icon: '🪴',
    height: 0.7,
    variants: 3,
    blocksMovement: false,
  },
  {
    id: 'rock',
    name: 'Rock',
    description: 'A weathered boulder.',
    category: 'nature',
    icon: '🪨',
    height: 0.9,
    variants: 3,
  },
  {
    id: 'flowers',
    name: 'Flowers',
    description: 'A scatter of blooms. Butterflies approve.',
    category: 'nature',
    icon: '🌷',
    height: 0.3,
    variants: 4,
    blocksMovement: false,
    spawns: [{ kind: 'butterfly', count: 0.8, radius: 2, behavior: 'flit' }],
  },

  // --- Paths -------------------------------------------------------------
  {
    id: 'path',
    name: 'Path',
    description: 'Packed earth. Connects to other paths and bridges.',
    category: 'paths',
    icon: '🛤️',
    height: 0.06,
    connects: 'path',
    connectsTo: ['path'],
    foundation: 'dirt',
    blocksMovement: false,
  },
  {
    id: 'fence',
    name: 'Fence',
    description: 'Wooden rails that link up along a run.',
    category: 'paths',
    icon: '🚧',
    height: 0.8,
    connects: 'fence',
    connectsTo: ['fence'],
    variants: 2,
  },
  {
    id: 'bridge',
    name: 'Bridge',
    description: 'Carries a path over water.',
    category: 'paths',
    icon: '🌉',
    height: 0.5,
    connects: 'path',
    connectsTo: ['path'],
    allowedTerrain: ['water'],
    blocksMovement: false,
  },

  // --- Housing -----------------------------------------------------------
  {
    id: 'cottage',
    name: 'Cottage',
    description: 'A small home with a steep roof.',
    category: 'housing',
    icon: '🏠',
    height: 2.4,
    variants: 4,
    rotatable: true,
    spawns: [
      { kind: 'villager', count: 1, radius: 4, behavior: 'wander' },
      { kind: 'cat', count: 0.34, radius: 2, behavior: 'wander' },
    ],
  },
  {
    id: 'house',
    name: 'Town house',
    description: 'Two storeys and a proper chimney.',
    category: 'housing',
    icon: '🏡',
    height: 3.4,
    variants: 4,
    rotatable: true,
    spawns: [
      { kind: 'villager', count: 1.5, radius: 4, behavior: 'wander' },
      { kind: 'child', count: 0.5, radius: 3, behavior: 'wander' },
    ],
  },
  {
    id: 'town_hall',
    name: 'Town hall',
    description: 'The heart of the village. Draws a crowd.',
    category: 'housing',
    icon: '🏛️',
    height: 4.2,
    rotatable: true,
    spawns: [
      { kind: 'villager', count: 2.5, radius: 5, behavior: 'wander' },
      { kind: 'child', count: 1, radius: 4, behavior: 'wander' },
    ],
  },
  {
    id: 'well',
    name: 'Well',
    description: 'Everyone stops here eventually.',
    category: 'housing',
    icon: '⛲',
    height: 1.2,
    spawns: [{ kind: 'villager', count: 0.5, radius: 3, behavior: 'wander' }],
  },
  {
    id: 'lamp',
    name: 'Lamp post',
    description: 'Warm light after dark.',
    category: 'housing',
    icon: '🏮',
    height: 2.2,
    blocksMovement: false,
  },

  // --- Farm --------------------------------------------------------------
  {
    id: 'field',
    name: 'Crop field',
    description: 'Rows of crops. Merges with neighbouring fields.',
    category: 'farm',
    icon: '🌾',
    height: 0.4,
    connects: 'field',
    connectsTo: ['field'],
    foundation: 'soil',
    variants: 3,
    blocksMovement: false,
    spawns: [
      { kind: 'farmer', count: 0.34, radius: 3, behavior: 'work' },
      { kind: 'butterfly', count: 0.4, radius: 2, behavior: 'flit' },
    ],
  },
  {
    id: 'barn',
    name: 'Barn',
    description: 'Red boards, big doors, livestock out front.',
    category: 'farm',
    icon: '🛖',
    height: 3,
    rotatable: true,
    spawns: [
      { kind: 'farmer', count: 1, radius: 4, behavior: 'work' },
      { kind: 'cow', count: 1, radius: 3, behavior: 'graze' },
      { kind: 'chicken', count: 2, radius: 2, behavior: 'graze' },
    ],
  },
  {
    id: 'windmill',
    name: 'Windmill',
    description: 'Sails turn in the breeze.',
    category: 'farm',
    icon: '🌬️',
    height: 5,
    spawns: [{ kind: 'farmer', count: 0.5, radius: 3, behavior: 'work' }],
  },
  {
    id: 'pen',
    name: 'Animal pen',
    description: 'A fenced patch. Fills up with livestock.',
    category: 'farm',
    icon: '🐑',
    height: 0.8,
    connects: 'fence',
    connectsTo: ['fence'],
    foundation: 'dirt',
    blocksMovement: false,
    spawns: [
      { kind: 'sheep', count: 1.2, radius: 2, behavior: 'graze' },
      { kind: 'pig', count: 0.5, radius: 2, behavior: 'graze' },
      { kind: 'chicken', count: 0.8, radius: 2, behavior: 'graze' },
    ],
  },
  {
    id: 'scarecrow',
    name: 'Scarecrow',
    description: 'Does not, in practice, scare the crows.',
    category: 'farm',
    icon: '🎃',
    height: 1.8,
    blocksMovement: false,
    spawns: [{ kind: 'bird', count: 1, radius: 3, behavior: 'flit' }],
  },

  // --- Market ------------------------------------------------------------
  {
    id: 'market_stall',
    name: 'Market stall',
    description: 'Striped awning, produce, a merchant behind it.',
    category: 'market',
    icon: '🎪',
    height: 2.2,
    variants: 4,
    rotatable: true,
    spawns: [
      { kind: 'merchant', count: 1, radius: 1, behavior: 'work' },
      { kind: 'villager', count: 2, radius: 3, behavior: 'wander' },
    ],
  },
  {
    id: 'fountain',
    name: 'Fountain',
    description: 'A plaza centrepiece. Children gather.',
    category: 'market',
    icon: '⛲',
    height: 1.4,
    spawns: [
      { kind: 'villager', count: 2, radius: 4, behavior: 'wander' },
      { kind: 'child', count: 1.5, radius: 3, behavior: 'wander' },
      { kind: 'duck', count: 0.5, radius: 1, behavior: 'graze' },
    ],
  },
  {
    id: 'bakery',
    name: 'Bakery',
    description: 'Smells wonderful. Permanent queue.',
    category: 'market',
    icon: '🥐',
    height: 3,
    rotatable: true,
    spawns: [
      { kind: 'merchant', count: 1, radius: 1, behavior: 'work' },
      { kind: 'villager', count: 1.5, radius: 3, behavior: 'wander' },
    ],
  },
  {
    id: 'tavern',
    name: 'Tavern',
    description: 'Warm windows and a busy doorstep.',
    category: 'market',
    icon: '🍺',
    height: 3.4,
    rotatable: true,
    spawns: [
      { kind: 'villager', count: 3, radius: 3, behavior: 'wander' },
      { kind: 'cat', count: 0.5, radius: 2, behavior: 'wander' },
    ],
  },

  // --- Castle ------------------------------------------------------------
  {
    id: 'castle_wall',
    name: 'Castle wall',
    description: 'Crenellated stone. Guards patrol the walkway.',
    category: 'castle',
    icon: '🧱',
    height: 2.6,
    connects: 'wall',
    connectsTo: ['wall'],
    foundation: 'stone',
    spawns: [{ kind: 'guard', count: 0.25, radius: 3, behavior: 'patrol' }],
  },
  {
    id: 'tower',
    name: 'Watchtower',
    description: 'A round tower with a conical roof.',
    category: 'castle',
    icon: '🗼',
    height: 5,
    connects: 'wall',
    connectsTo: ['wall'],
    foundation: 'stone',
    spawns: [{ kind: 'guard', count: 1, radius: 3, behavior: 'patrol' }],
  },
  {
    id: 'gate',
    name: 'Gatehouse',
    description: 'An arch through the wall. Always guarded.',
    category: 'castle',
    icon: '🚪',
    height: 3.6,
    connects: 'wall',
    connectsTo: ['wall', 'path'],
    foundation: 'stone',
    spawns: [{ kind: 'guard', count: 2, radius: 2, behavior: 'patrol' }],
  },
  {
    id: 'keep',
    name: 'Keep',
    description: 'The great hall at the centre of the castle.',
    category: 'castle',
    icon: '🏰',
    height: 6,
    rotatable: true,
    spawns: [
      { kind: 'guard', count: 2, radius: 4, behavior: 'patrol' },
      { kind: 'villager', count: 1, radius: 4, behavior: 'wander' },
    ],
  },
  {
    id: 'banner',
    name: 'Banner',
    description: 'A tall pennant on a pole.',
    category: 'castle',
    icon: '🚩',
    height: 3,
    variants: 4,
    blocksMovement: false,
  },
]

export const PIECES: Readonly<Record<PieceId, PieceDefinition>> = Object.fromEntries(
  PIECE_LIST.map((p) => [p.id, p]),
)

export function getPiece(id: PieceId): PieceDefinition | undefined {
  return PIECES[id]
}

/** Order the palette renders its tabs in. */
export const CATEGORY_ORDER = [
  'terrain',
  'nature',
  'paths',
  'housing',
  'farm',
  'market',
  'castle',
] as const

export const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  terrain: 'Ground',
  nature: 'Nature',
  paths: 'Paths',
  housing: 'Homes',
  farm: 'Farm',
  market: 'Market',
  castle: 'Castle',
}

export const CATEGORY_ICONS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  terrain: '🎨',
  nature: '🌳',
  paths: '🛤️',
  housing: '🏠',
  farm: '🌾',
  market: '🎪',
  castle: '🏰',
}

export function piecesInCategory(category: string): PieceDefinition[] {
  return PIECE_LIST.filter((p) => p.category === category)
}

/**
 * Whether a piece may sit on a terrain type. Pieces without an explicit
 * `allowedTerrain` go on anything buildable, which keeps the common case
 * declaration-free.
 */
export function canPlaceOn(piece: PieceDefinition, terrainId: TerrainId): boolean {
  if (piece.allowedTerrain) return piece.allowedTerrain.includes(terrainId)
  return terrainOrDefault(terrainId).buildable
}

/**
 * Whether agents may walk through a hex holding this piece. Anything without an
 * explicit setting blocks if it is tall enough to be a solid object.
 */
export function pieceBlocksMovement(piece: PieceDefinition): boolean {
  return piece.blocksMovement ?? piece.height > 0.5
}
