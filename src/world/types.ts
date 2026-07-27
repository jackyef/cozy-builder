/**
 * The world data model.
 *
 * ## What is and is not persisted
 *
 * The serialized world is deliberately small: a seed, a terrain layer, and a
 * piece layer. Everything else in the running game is *derived*:
 *
 *   - **Villagers, guards, farmers and animals are never stored.** They are
 *     regenerated at runtime from whatever pieces are nearby (see
 *     `src/agents/director.ts`). Loading the same file always yields the same
 *     village, populated the same way, but the population is not part of the
 *     document.
 *   - **Visual variance is never stored.** Tilt, tint and shape wobble are
 *     recomputed from `seed` + hex coordinate (see `src/core/rng.ts`).
 *   - **Autoconnect state is never stored.** Which way a wall turns is a pure
 *     function of its neighbours, recomputed on load (see
 *     `src/world/autoconnect.ts`).
 *
 * The practical rule: if it can be recomputed from the pieces, it does not go
 * in the file. This keeps saves tiny, diffable, and hand-editable, and means
 * improvements to generation immediately apply to existing villages.
 */

import type { Hex } from '@/core/hex'

/** Stable identifier of a catalog entry, e.g. `'cottage'`. */
export type PieceId = string

/** Stable identifier of a terrain type, e.g. `'grass'`. */
export type TerrainId = string

/** `"q,r"` — see {@link import('@/core/hex').hexKey}. */
export type HexKey = string

/** Rotation in sixths of a turn. Only meaningful for pieces that opt in. */
export type Rotation = 0 | 1 | 2 | 3 | 4 | 5

/**
 * One placed piece. The hex coordinate lives in the containing map's key, not
 * here, so the same object is never out of sync with its location.
 */
export interface PlacedPiece {
  /** Which catalog entry this is. */
  readonly piece: PieceId
  /**
   * Manual rotation, for pieces with `rotatable: true`. Pieces that autoconnect
   * ignore this — their orientation comes from their neighbours.
   */
  readonly rotation?: Rotation
  /**
   * Explicit variant override. Normally omitted, in which case the variant is
   * chosen deterministically from the seed and coordinate. Set only when the
   * player deliberately picks a look.
   */
  readonly variant?: number
}

/**
 * A complete village. This is exactly what gets written to disk, so treat any
 * change to this shape as a save-format change (bump `SCHEMA_VERSION` and add a
 * migration in `src/world/serialize.ts`).
 */
export interface World {
  /** Save-format version. See `SCHEMA_VERSION`. */
  readonly version: number
  /** Player-facing name, shown in the UI and used for the export filename. */
  readonly name: string
  /** Drives all deterministic visual variance. Changing it reskins the world. */
  readonly seed: number
  /** Ground layer. Hexes absent from this map are outside the island. */
  readonly terrain: Readonly<Record<HexKey, TerrainId>>
  /** Building/prop layer. At most one piece per hex. */
  readonly pieces: Readonly<Record<HexKey, PlacedPiece>>
}

/** A piece together with the coordinate it sits on. */
export interface PieceInstance extends PlacedPiece {
  readonly hex: Hex
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Top-level grouping, used for the build palette's tabs. */
export type PieceCategory = 'terrain' | 'nature' | 'paths' | 'housing' | 'farm' | 'market' | 'castle'

/**
 * Connection groups drive autoconnect. Two adjacent pieces link up when each
 * one's `connectsTo` contains the other's `connects` group.
 *
 * Kept as a plain string union rather than free-form strings so a typo in a
 * catalog entry is a compile error rather than a piece that silently refuses to
 * connect to anything.
 */
export type ConnectionGroup = 'path' | 'fence' | 'wall' | 'field' | 'water'

/**
 * What a piece is attached to. Everything currently occupies a whole hex cell;
 * `footprint` exists so multi-hex pieces can be added later without reworking
 * placement.
 */
export interface PieceDefinition {
  readonly id: PieceId
  /** Shown in the palette. */
  readonly name: string
  /** One-line palette tooltip. */
  readonly description: string
  readonly category: PieceCategory
  /** Palette icon — an emoji, so the UI needs no image assets. */
  readonly icon: string

  /**
   * Connection group this piece belongs to. A piece with no group never
   * autoconnects and is always rendered standalone.
   */
  readonly connects?: ConnectionGroup
  /** Groups this piece will link to. Defaults to `[connects]` when omitted. */
  readonly connectsTo?: readonly ConnectionGroup[]

  /** Whether the player can rotate this piece manually. */
  readonly rotatable?: boolean
  /** How many distinct looks this piece has. Defaults to 1. */
  readonly variants?: number

  /**
   * Approximate height in world units, used for camera framing, hover
   * highlight placement and agent avoidance. Not a physics volume.
   */
  readonly height: number

  /**
   * Terrain ids this piece may be placed on. Omit to allow any land terrain.
   * Water-only pieces list `['water']`.
   */
  readonly allowedTerrain?: readonly TerrainId[]

  /**
   * Terrain automatically painted underneath when this piece is placed — a
   * farm field brings its own tilled soil, a road brings packed dirt. Applied
   * only if the current terrain is not already in `allowedTerrain`.
   */
  readonly foundation?: TerrainId

  /** Which agents this piece attracts. See `src/agents/director.ts`. */
  readonly spawns?: readonly AgentSpawnRule[]

  /**
   * Whether agents may walk across this hex. Buildings block; roads, fields and
   * empty ground do not. Defaults to `true` (blocking) for anything with a
   * meaningful height.
   */
  readonly blocksMovement?: boolean
}

/** A terrain type in the ground layer. */
export interface TerrainDefinition {
  readonly id: TerrainId
  readonly name: string
  readonly icon: string
  /** Base colour; per-tile variance is applied on top of this. */
  readonly color: string
  /** How far the tile top sits above/below the reference plane. */
  readonly elevation: number
  /** Whether pieces without an explicit `allowedTerrain` can sit here. */
  readonly buildable: boolean
  /** Whether agents can walk here. */
  readonly walkable: boolean
  /**
   * Agents attracted by the terrain itself rather than by a building — ducks
   * belong to a pond, not to any piece someone placed on it.
   */
  readonly spawns?: readonly AgentSpawnRule[]
}

// ---------------------------------------------------------------------------
// Agent spawning
// ---------------------------------------------------------------------------

/** Kinds of runtime-only inhabitants. */
export type AgentKind =
  | 'villager'
  | 'guard'
  | 'farmer'
  | 'merchant'
  | 'child'
  | 'chicken'
  | 'sheep'
  | 'cow'
  | 'pig'
  | 'duck'
  | 'cat'
  | 'butterfly'
  | 'bird'

/**
 * A declaration on a piece: "this building should have N of these around it."
 *
 * The director totals these up across the world, clamps them, and materialises
 * the result — so a village with three market stalls is busier than one with a
 * single stall, without anything being stored in the save file.
 */
export interface AgentSpawnRule {
  readonly kind: AgentKind
  /**
   * How many this piece contributes. Fractional values are allowed and
   * accumulate: `0.5` means two of these pieces are needed to justify one
   * agent, which keeps a single farmhouse from spawning a crowd.
   */
  readonly count: number
  /** How far from the piece the agent will roam, in hexes. */
  readonly radius: number
  /**
   * Behaviour preset. `'wander'` mills about, `'patrol'` walks the perimeter of
   * the spawning structure, `'work'` moves between nearby work tiles,
   * `'graze'` drifts slowly and pauses often.
   */
  readonly behavior: 'wander' | 'patrol' | 'work' | 'graze' | 'flit'
}
