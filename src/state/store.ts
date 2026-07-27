/**
 * The application store — the world, the current tool, and undo history.
 *
 * ## Interaction model
 *
 * The whole game is one gesture: **pick a piece, then click or drag on the
 * ground.** There is no rotate-before-place step, no snapping mode, no
 * confirm. That constraint is why autoconnect and deterministic variance exist
 * — the things a player would otherwise have to fiddle with are decided for
 * them.
 *
 * A drag is a *stroke*. `beginStroke` snapshots the world for undo exactly
 * once, then every `extendStroke` mutates the live world so the player sees
 * the result under the cursor immediately. `endStroke` just closes it out.
 * The result: a drag across forty tiles is one undo step, not forty.
 *
 * Strokes also interpolate. Pointer events are sampled far more coarsely than
 * a fast mouse moves, so `extendStroke` fills the hex line from the previous
 * sample to the current one — without that, quick drags lay down dotted lines.
 *
 * ## History
 *
 * Undo stores whole-world snapshots. Worlds are plain records of small values
 * and a snapshot is a shallow copy of two objects, so even a large village is
 * a few hundred kilobytes and well under a millisecond to capture. That buys a
 * history implementation with no diffing, no inverse operations, and no way
 * for a new piece type to silently break undo.
 */

import { create } from 'zustand'
import { hexKey, hexLine, type Hex } from '@/core/hex'
import { randomSeed } from '@/core/rng'
import { canPlaceOn, getPiece } from '@/world/catalog'
import { generateIsland } from '@/world/generate'
import { saveToLocalStorage } from '@/world/serialize'
import type { PieceId, PlacedPiece, Rotation, TerrainId, World } from '@/world/types'

/** How many undo steps to keep. */
const HISTORY_LIMIT = 60

/**
 * Selectable speeds for the day cycle.
 *
 * Powers of two so each step is an obvious doubling rather than a vague
 * "faster". 8x puts a full day at about half a minute, which is fast enough to
 * watch the light sweep across the village without it strobing.
 */
export const TIME_SCALES = [1, 2, 4, 8] as const
export type TimeScale = (typeof TIME_SCALES)[number]

/** What a click on the ground will do. */
export type Tool =
  | { kind: 'piece'; piece: PieceId }
  | { kind: 'terrain'; terrain: TerrainId }
  | { kind: 'erase' }
  | { kind: 'pan' }

/** A transient message shown in the corner of the screen. */
export interface Notice {
  id: number
  text: string
  tone: 'info' | 'warn' | 'error'
}

export interface BuilderState {
  world: World
  past: World[]
  future: World[]

  tool: Tool
  /** Rotation applied to the next rotatable piece placed. */
  rotation: Rotation

  /** Hex currently under the pointer, for the hover preview. `null` when off-world. */
  hovered: Hex | null

  /** True between `beginStroke` and `endStroke`. */
  painting: boolean

  notices: Notice[]

  // --- Display settings -------------------------------------------------
  /** 0..1 through a day. 0.5 is noon. Drives sun position and light colour. */
  timeOfDay: number
  /** Whether the clock advances on its own. */
  timeFlowing: boolean
  /** Multiplier applied to the day cycle while it is running. */
  timeScale: TimeScale
  showAgents: boolean
  showGrid: boolean
  /** Whether the build palette is expanded (collapsed on small screens). */
  paletteOpen: boolean

  // --- Actions ----------------------------------------------------------
  setTool: (tool: Tool) => void
  setRotation: (rotation: Rotation) => void
  rotateClockwise: () => void
  setHovered: (hex: Hex | null) => void

  beginStroke: (at: Hex) => void
  extendStroke: (at: Hex) => void
  endStroke: () => void

  undo: () => void
  redo: () => void

  newWorld: (name?: string) => void
  loadWorld: (world: World, warnings?: string[]) => void
  renameWorld: (name: string) => void

  notify: (text: string, tone?: Notice['tone']) => void
  dismissNotice: (id: number) => void

  setTimeOfDay: (t: number) => void
  toggleTimeFlowing: () => void
  setTimeScale: (scale: TimeScale) => void
  cycleTimeScale: () => void
  toggleAgents: () => void
  toggleGrid: () => void
  togglePalette: () => void
}

/** The coordinate covered by the last `extendStroke`, so we can interpolate. */
let lastStrokeHex: Hex | null = null
/** Hexes already touched by the current stroke, so we never redo work. */
let strokeTouched = new Set<string>()
let noticeSeq = 0

export const useBuilder = create<BuilderState>((set, get) => ({
  world: generateIsland({ seed: randomSeed(), name: 'New village' }),
  past: [],
  future: [],

  tool: { kind: 'piece', piece: 'cottage' },
  rotation: 0,
  hovered: null,
  painting: false,
  notices: [],

  timeOfDay: 0.38,
  timeFlowing: false,
  timeScale: 1,
  showAgents: true,
  showGrid: false,
  paletteOpen: true,

  setTool: (tool) => set({ tool }),
  setRotation: (rotation) => set({ rotation }),
  rotateClockwise: () => set((s) => ({ rotation: (((s.rotation + 1) % 6) as Rotation) })),
  setHovered: (hovered) => set({ hovered }),

  beginStroke: (at) => {
    const { world } = get()
    // Snapshot before the first change, so the whole drag is one undo step.
    set((s) => ({
      past: [...s.past, s.world].slice(-HISTORY_LIMIT),
      future: [],
      painting: true,
    }))
    lastStrokeHex = null
    strokeTouched = new Set()
    const next = applyToolAt(world, get().tool, at, get().rotation, strokeTouched)
    lastStrokeHex = at
    if (next !== world) set({ world: next })
  },

  extendStroke: (at) => {
    const state = get()
    if (!state.painting) return

    // Fill the gap since the last sample so fast drags stay continuous.
    const span = lastStrokeHex ? hexLine(lastStrokeHex, at) : [at]
    lastStrokeHex = at

    let next = state.world
    for (const h of span) {
      next = applyToolAt(next, state.tool, h, state.rotation, strokeTouched)
    }
    if (next !== state.world) set({ world: next })
  },

  endStroke: () => {
    if (!get().painting) return
    lastStrokeHex = null

    // Nothing actually changed (a click on a tile that was already correct):
    // drop the snapshot rather than leaving a no-op undo step behind.
    const { past, world } = get()
    const previous = past[past.length - 1]
    if (previous && worldsEqual(previous, world)) {
      set({ past: past.slice(0, -1), painting: false })
    } else {
      set({ painting: false })
    }
    strokeTouched = new Set()
    scheduleAutosave(get().world)
  },

  undo: () =>
    set((s) => {
      if (!s.past.length) return s
      const previous = s.past[s.past.length - 1]
      scheduleAutosave(previous)
      return {
        world: previous,
        past: s.past.slice(0, -1),
        future: [s.world, ...s.future].slice(0, HISTORY_LIMIT),
      }
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length) return s
      const next = s.future[0]
      scheduleAutosave(next)
      return {
        world: next,
        past: [...s.past, s.world].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
      }
    }),

  newWorld: (name = 'New village') => {
    const world = generateIsland({ seed: randomSeed(), name })
    set((s) => ({ world, past: [...s.past, s.world].slice(-HISTORY_LIMIT), future: [] }))
    scheduleAutosave(world)
  },

  loadWorld: (world, warnings = []) => {
    set((s) => ({ world, past: [...s.past, s.world].slice(-HISTORY_LIMIT), future: [] }))
    for (const w of warnings) get().notify(w, 'warn')
    scheduleAutosave(world)
  },

  renameWorld: (name) => {
    set((s) => ({ world: { ...s.world, name } }))
    scheduleAutosave(get().world)
  },

  notify: (text, tone = 'info') => {
    const id = ++noticeSeq
    set((s) => ({ notices: [...s.notices, { id, text, tone }] }))
    // Errors and warnings linger; plain confirmations get out of the way.
    const ttl = tone === 'info' ? 2600 : 7000
    setTimeout(() => get().dismissNotice(id), ttl)
  },

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  setTimeOfDay: (timeOfDay) => set({ timeOfDay: clamp01(timeOfDay) }),
  // Starting the clock at 1x every time would make the fast-forward buttons
  // feel like they had been ignored, so the chosen speed is sticky.
  toggleTimeFlowing: () => set((s) => ({ timeFlowing: !s.timeFlowing })),
  setTimeScale: (timeScale) => set({ timeScale, timeFlowing: true }),
  cycleTimeScale: () =>
    set((s) => {
      const next = TIME_SCALES[(TIME_SCALES.indexOf(s.timeScale) + 1) % TIME_SCALES.length]
      return { timeScale: next, timeFlowing: true }
    }),
  toggleAgents: () => set((s) => ({ showAgents: !s.showAgents })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}))

// ---------------------------------------------------------------------------
// Tool application
// ---------------------------------------------------------------------------

/**
 * Apply the active tool to one hex, returning a new world — or the *same*
 * world object when nothing changed.
 *
 * Returning the identical reference on a no-op matters: it is what lets the
 * store skip a React update for the (very common) case of dragging back across
 * tiles that are already painted.
 */
export function applyToolAt(
  world: World,
  tool: Tool,
  at: Hex,
  rotation: Rotation,
  touched?: Set<string>,
): World {
  const key = hexKey(at)
  if (touched?.has(key)) return world

  switch (tool.kind) {
    case 'pan':
      return world

    case 'terrain': {
      touched?.add(key)
      if (world.terrain[key] === tool.terrain) return world
      const terrain = { ...world.terrain, [key]: tool.terrain }
      let pieces = world.pieces

      // Painting water under a cottage would leave it floating; clear anything
      // the new ground can no longer support.
      const existing = world.pieces[key]
      if (existing) {
        const def = getPiece(existing.piece)
        if (def && !canPlaceOn(def, tool.terrain)) {
          const next: Record<string, PlacedPiece> = { ...world.pieces }
          delete next[key]
          pieces = next
        }
      }
      return { ...world, terrain, pieces }
    }

    case 'erase': {
      touched?.add(key)
      if (world.pieces[key]) {
        const pieces: Record<string, PlacedPiece> = { ...world.pieces }
        delete pieces[key]
        return { ...world, pieces }
      }
      // Nothing built here — erase the ground itself, shrinking the island.
      if (world.terrain[key]) {
        const terrain: Record<string, TerrainId> = { ...world.terrain }
        delete terrain[key]
        return { ...world, terrain }
      }
      return world
    }

    case 'piece': {
      const def = getPiece(tool.piece)
      if (!def) return world

      const currentTerrain = world.terrain[key]
      // Only build on ground that exists. Silently extending the island under
      // a misplaced click is worse than doing nothing.
      if (!currentTerrain) return world

      touched?.add(key)

      let terrain = world.terrain
      let terrainHere = currentTerrain

      // Some pieces bring their own ground: a field tills the soil beneath it.
      if (def.foundation && !canPlaceOn(def, currentTerrain)) {
        terrainHere = def.foundation
        terrain = { ...world.terrain, [key]: def.foundation }
      } else if (def.foundation && currentTerrain !== def.foundation && !def.allowedTerrain) {
        terrainHere = def.foundation
        terrain = { ...world.terrain, [key]: def.foundation }
      }

      if (!canPlaceOn(def, terrainHere)) return world

      const existing = world.pieces[key]
      const nextPlaced = def.rotatable ? { piece: def.id, rotation } : { piece: def.id }
      if (
        existing &&
        existing.piece === nextPlaced.piece &&
        existing.rotation === nextPlaced.rotation
      ) {
        return terrain === world.terrain ? world : { ...world, terrain }
      }

      return { ...world, terrain, pieces: { ...world.pieces, [key]: nextPlaced } }
    }
  }
}

/**
 * Whether a piece could be placed at `at` right now. Drives the hover preview's
 * valid/invalid tint, so the player learns the rules by seeing them rather than
 * by reading them.
 */
export function canPlaceAt(world: World, pieceId: PieceId, at: Hex): boolean {
  const def = getPiece(pieceId)
  if (!def) return false
  const key = hexKey(at)
  const terrainId = world.terrain[key]
  if (!terrainId) return false
  if (def.foundation && !def.allowedTerrain) return true
  return canPlaceOn(def, terrainId)
}

/** Reference-cheap equality, used to discard no-op undo entries. */
function worldsEqual(a: World, b: World): boolean {
  return a.terrain === b.terrain && a.pieces === b.pieces && a.name === b.name && a.seed === b.seed
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Debounced write to localStorage.
 *
 * Serializing on every stroke of a big village is measurable, and a player who
 * is actively dragging does not need the intermediate states persisted — only
 * the moment they stop.
 */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let autosaveFailed = false

export function scheduleAutosave(world: World, delayMs = 800): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    const result = saveToLocalStorage(world)
    // Warn once, not on every keystroke, if the browser is refusing to store.
    if (!result.ok && !autosaveFailed) {
      autosaveFailed = true
      useBuilder
        .getState()
        .notify(`Autosave is unavailable (${result.error}). Export to keep your village.`, 'warn')
    } else if (result.ok) {
      autosaveFailed = false
    }
  }, delayMs)
}

/** Flush any pending autosave immediately — used on tab hide/unload. */
export function flushAutosave(): void {
  if (!autosaveTimer) return
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  saveToLocalStorage(useBuilder.getState().world)
}

/** Convenience selectors. */
export const selectWorld = (s: BuilderState) => s.world
export const selectTool = (s: BuilderState) => s.tool
export const selectCanUndo = (s: BuilderState) => s.past.length > 0
export const selectCanRedo = (s: BuilderState) => s.future.length > 0
