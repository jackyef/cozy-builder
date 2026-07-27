/**
 * Save format: reading, writing, validating and migrating village documents.
 *
 * ## The format
 *
 * A village is a single JSON object, designed to be small, diffable and
 * comfortable to edit by hand:
 *
 * ```json
 * {
 *   "format": "cozy-builder-village",
 *   "version": 1,
 *   "name": "Willowbrook",
 *   "seed": 1234567,
 *   "terrain": { "0,0": "grass", "1,0": "water" },
 *   "pieces":  { "0,0": "cottage", "1,-1": { "piece": "keep", "rotation": 2 } }
 * }
 * ```
 *
 * Keys are `"q,r"` axial coordinates. A piece with no rotation or variant is
 * written as a bare string; the object form is only used when there is
 * something extra to say. Both forms are always accepted on read.
 *
 * Inhabitants, autoconnect state and visual variance are absent by design —
 * see the docblock in `./types.ts`.
 *
 * ## Compatibility
 *
 * `SCHEMA_VERSION` is bumped whenever the shape changes, and {@link migrate}
 * walks an older document forward one version at a time. Loading a *newer*
 * document than this build understands fails loudly rather than silently
 * dropping fields the user cannot see.
 *
 * Imported JSON is untrusted input — it may come from a file someone was sent.
 * {@link parseWorld} therefore validates every field and reports problems
 * instead of throwing raw type errors, and unknown piece and terrain ids are
 * dropped with a warning rather than poisoning the running world.
 */

import { hexKey, parseHexKey } from '@/core/hex'
import { randomSeed } from '@/core/rng'
import { DEFAULT_TERRAIN, PIECES, TERRAIN } from './catalog'
import type { PlacedPiece, Rotation, World } from './types'

/** Marker so we can tell our files from arbitrary JSON. */
export const FORMAT_ID = 'cozy-builder-village'

/**
 * Current save-format version.
 *
 * History:
 *   1 — initial format.
 */
export const SCHEMA_VERSION = 1

/** The on-disk document. */
export interface VillageDocument {
  format: typeof FORMAT_ID
  version: number
  name: string
  seed: number
  terrain: Record<string, string>
  pieces: Record<string, string | PlacedPiece>
}

/** Outcome of parsing untrusted JSON. */
export type ParseResult =
  | { ok: true; world: World; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Convert a world to its document form, using the shorthand string encoding
 * wherever a piece carries no extra data.
 */
export function toDocument(world: World): VillageDocument {
  const pieces: Record<string, string | PlacedPiece> = {}
  for (const [key, placed] of Object.entries(world.pieces)) {
    pieces[key] =
      placed.rotation === undefined && placed.variant === undefined
        ? placed.piece
        : stripUndefined(placed)
  }
  return {
    format: FORMAT_ID,
    version: SCHEMA_VERSION,
    name: world.name,
    seed: world.seed,
    terrain: { ...world.terrain },
    pieces,
  }
}

function stripUndefined(placed: PlacedPiece): PlacedPiece {
  const out: { piece: string; rotation?: Rotation; variant?: number } = { piece: placed.piece }
  if (placed.rotation !== undefined) out.rotation = placed.rotation
  if (placed.variant !== undefined) out.variant = placed.variant
  return out as PlacedPiece
}

/**
 * Serialize to a JSON string.
 *
 * Keys are sorted so that saving the same village twice produces byte-identical
 * output — which is what makes exports diffable in git and lets the autosave
 * layer skip redundant writes.
 */
export function serializeWorld(world: World, pretty = true): string {
  const doc = toDocument(world)
  const ordered = {
    format: doc.format,
    version: doc.version,
    name: doc.name,
    seed: doc.seed,
    terrain: sortKeys(doc.terrain),
    pieces: sortKeys(doc.pieces),
  }
  return JSON.stringify(ordered, null, pretty ? 2 : 0)
}

/** Sorts by axial coordinate so output order is stable and human-scannable. */
function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  const keys = Object.keys(record).sort((a, b) => {
    const ha = safeParseKey(a)
    const hb = safeParseKey(b)
    if (!ha || !hb) return a.localeCompare(b)
    return ha.r - hb.r || ha.q - hb.q
  })
  for (const k of keys) out[k] = record[k]
  return out
}

function safeParseKey(key: string): { q: number; r: number } | null {
  try {
    return parseHexKey(key)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Parse a JSON string into a world, validating as we go. */
export function deserializeWorld(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return {
      ok: false,
      error: `That file isn't valid JSON (${err instanceof Error ? err.message : 'parse failed'}).`,
      warnings: [],
    }
  }
  return parseWorld(raw)
}

/**
 * Validate an already-parsed value into a world.
 *
 * Distinguishes two failure modes deliberately:
 *   - **Errors** mean the document cannot be loaded at all.
 *   - **Warnings** mean something was dropped or repaired but the rest loaded.
 *     Unknown piece ids land here, so a village saved by a newer build with
 *     extra content still opens, minus the pieces this build cannot draw.
 */
export function parseWorld(raw: unknown): ParseResult {
  const warnings: string[] = []

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Expected a village object at the top level.', warnings }
  }
  const doc = raw as Record<string, unknown>

  if (doc.format !== undefined && doc.format !== FORMAT_ID) {
    return {
      ok: false,
      error: `This doesn't look like a Cozy Builder village (format was "${String(doc.format)}").`,
      warnings,
    }
  }

  const version = typeof doc.version === 'number' ? doc.version : 1
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: `Unrecognised save version: ${String(doc.version)}.`, warnings }
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `This village was saved by a newer version of Cozy Builder ` +
        `(format v${version}, this build reads up to v${SCHEMA_VERSION}). ` +
        `Loading it here would quietly discard things you can't see.`,
      warnings,
    }
  }

  const migrated = migrate(doc, version, warnings)

  const name =
    typeof migrated.name === 'string' && migrated.name.trim() ? migrated.name.trim() : 'Untitled village'

  let seed: number
  if (typeof migrated.seed === 'number' && Number.isFinite(migrated.seed)) {
    seed = Math.floor(migrated.seed) >>> 0
  } else {
    seed = randomSeed()
    warnings.push('No seed in the file — generated a new one, so decoration may differ.')
  }

  const terrain = parseTerrainLayer(migrated.terrain, warnings)
  const pieces = parsePieceLayer(migrated.pieces, warnings)

  return { ok: true, world: { version: SCHEMA_VERSION, name, seed, terrain, pieces }, warnings }
}

function parseTerrainLayer(raw: unknown, warnings: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw === undefined || raw === null) return out
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('The terrain layer was not an object; ignoring it.')
    return out
  }

  let badKeys = 0
  const unknownTerrain = new Set<string>()

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!safeParseKey(key)) {
      badKeys++
      continue
    }
    if (typeof value !== 'string') {
      badKeys++
      continue
    }
    if (!TERRAIN[value]) {
      unknownTerrain.add(value)
      // Keep the tile so the island's shape survives; just fall back visually.
      out[key] = DEFAULT_TERRAIN
      continue
    }
    out[key] = value
  }

  if (badKeys) warnings.push(`Skipped ${badKeys} malformed terrain ${plural(badKeys, 'entry', 'entries')}.`)
  if (unknownTerrain.size) {
    warnings.push(
      `Unknown terrain replaced with grass: ${[...unknownTerrain].sort().join(', ')}.`,
    )
  }
  return out
}

function parsePieceLayer(raw: unknown, warnings: string[]): Record<string, PlacedPiece> {
  const out: Record<string, PlacedPiece> = {}
  if (raw === undefined || raw === null) return out
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('The piece layer was not an object; ignoring it.')
    return out
  }

  let badKeys = 0
  let dropped = 0
  const unknownPieces = new Set<string>()

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const coord = safeParseKey(key)
    if (!coord) {
      badKeys++
      continue
    }

    const placed = normalizePlaced(value)
    if (!placed) {
      badKeys++
      continue
    }
    if (!PIECES[placed.piece]) {
      unknownPieces.add(placed.piece)
      dropped++
      continue
    }
    // Re-key through hexKey so `"+1,-0"` and friends normalise to one form.
    out[hexKey(coord)] = placed
  }

  if (badKeys) warnings.push(`Skipped ${badKeys} malformed piece ${plural(badKeys, 'entry', 'entries')}.`)
  if (unknownPieces.size) {
    warnings.push(
      `Dropped ${dropped} ${plural(dropped, 'piece', 'pieces')} this build doesn't know: ` +
        `${[...unknownPieces].sort().join(', ')}.`,
    )
  }
  return out
}

/** Accepts both the shorthand string form and the full object form. */
function normalizePlaced(value: unknown): PlacedPiece | null {
  if (typeof value === 'string') {
    return value ? { piece: value } : null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const obj = value as Record<string, unknown>
  const id = obj.piece
  if (typeof id !== 'string' || !id) return null

  const placed: { piece: string; rotation?: Rotation; variant?: number } = { piece: id }

  if (typeof obj.rotation === 'number' && Number.isFinite(obj.rotation)) {
    placed.rotation = (((Math.floor(obj.rotation) % 6) + 6) % 6) as Rotation
  }
  if (typeof obj.variant === 'number' && Number.isFinite(obj.variant) && obj.variant >= 0) {
    placed.variant = Math.floor(obj.variant)
  }
  return placed as PlacedPiece
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Walk a document forward to {@link SCHEMA_VERSION}, one version at a time.
 *
 * ## Adding a migration
 *
 * When you change the format, bump `SCHEMA_VERSION` and add a `case` for the
 * version you are migrating *from*. Each case mutates `doc` in place into the
 * next version's shape and falls through to the one after it, so the chain
 * handles a v1 file opened by a v4 build without any special casing.
 *
 * Push a note onto `warnings` for anything a player would notice — a renamed
 * piece is fine to do silently, a dropped feature is not.
 */
function migrate(
  doc: Record<string, unknown>,
  fromVersion: number,
  warnings: string[],
): Record<string, unknown> {
  const working = { ...doc }
  /* eslint-disable no-fallthrough */
  switch (fromVersion) {
    // case 1:
    //   renamePiece(working, 'old_id', 'new_id')
    //   working.version = 2
    // falls through
    case SCHEMA_VERSION:
    default:
      break
  }
  /* eslint-enable no-fallthrough */
  void warnings
  return working
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A filesystem-safe filename derived from the village name. */
export function suggestFilename(world: World): string {
  const slug =
    world.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'village'
  return `${slug}.village.json`
}

/** Trigger a browser download of the village as JSON. */
export function downloadWorld(world: World): void {
  const blob = new Blob([serializeWorld(world)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestFilename(world)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke on the next frame; revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/** Read a user-selected file and parse it. */
export async function readWorldFile(file: File): Promise<ParseResult> {
  try {
    return deserializeWorld(await file.text())
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't read that file (${err instanceof Error ? err.message : 'unknown error'}).`,
      warnings: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

export const AUTOSAVE_KEY = 'cozy-builder:autosave:v1'

/**
 * Persist to localStorage. Never throws: a full or unavailable store (private
 * browsing, a huge village) must not take the game down mid-build, so failures
 * are reported by return value and surfaced in the UI as a quiet notice.
 */
export function saveToLocalStorage(world: World): { ok: boolean; error?: string } {
  try {
    // Compact form — this copy is never read by a human.
    localStorage.setItem(AUTOSAVE_KEY, serializeWorld(world, false))
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not write to local storage.',
    }
  }
}

/** Load the autosave, or `null` when there isn't a usable one. */
export function loadFromLocalStorage(): { world: World; warnings: string[] } | null {
  let json: string | null
  try {
    json = localStorage.getItem(AUTOSAVE_KEY)
  } catch {
    return null
  }
  if (!json) return null

  const result = deserializeWorld(json)
  if (!result.ok) {
    console.warn('[cozy-builder] Discarding unreadable autosave:', result.error)
    return null
  }
  return { world: result.world, warnings: result.warnings }
}

export function clearLocalStorage(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    /* nothing useful to do */
  }
}
