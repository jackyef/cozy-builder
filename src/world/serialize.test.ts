/**
 * Save format tests.
 *
 * Two things are being protected here.
 *
 * **Round-trip fidelity.** A village that survives export and import unchanged
 * is the whole promise of the format. The sample villages are used as the
 * fixtures because they are realistic — hundreds of tiles, every category of
 * piece, rotations and autoconnected runs — where a hand-written fixture would
 * only cover what its author remembered.
 *
 * **Behaviour on hostile input.** Import accepts arbitrary JSON from a file the
 * player may have been sent. It must never throw its way out of the app, and it
 * must never silently drop content: anything discarded has to come back as a
 * warning, or someone re-exports a village and quietly loses half of it.
 */

import { describe, expect, it } from 'vitest'
import {
  FORMAT_ID,
  SCHEMA_VERSION,
  deserializeWorld,
  parseWorld,
  serializeWorld,
  suggestFilename,
  toDocument,
} from './serialize'
import { EXAMPLE_VILLAGES } from './examples'
import { emptyWorld, generateIsland } from './generate'
import type { World } from './types'

describe('round trip', () => {
  for (const example of EXAMPLE_VILLAGES) {
    it(`preserves “${example.name}” exactly`, () => {
      const original = example.build()
      const result = deserializeWorld(serializeWorld(original))

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.warnings).toEqual([])
      expect(result.world.name).toBe(original.name)
      expect(result.world.seed).toBe(original.seed)
      expect(result.world.terrain).toEqual(original.terrain)
      expect(result.world.pieces).toEqual(original.pieces)
    })
  }

  it('preserves a generated island', () => {
    const original = generateIsland({ seed: 12345, name: 'Seeded' })
    const result = deserializeWorld(serializeWorld(original))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.pieces).toEqual(original.pieces)
    expect(result.world.terrain).toEqual(original.terrain)
  })

  it('preserves rotations and explicit variants', () => {
    const world: World = {
      version: 1,
      name: 'Rotations',
      seed: 7,
      terrain: { '0,0': 'grass', '1,0': 'grass', '2,0': 'grass' },
      pieces: {
        '0,0': { piece: 'cottage', rotation: 4 },
        '1,0': { piece: 'house', variant: 2 },
        '2,0': { piece: 'keep', rotation: 1, variant: 0 },
      },
    }
    const result = deserializeWorld(serializeWorld(world))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.pieces).toEqual(world.pieces)
  })

  it('survives repeated round trips unchanged', () => {
    const original = EXAMPLE_VILLAGES[0].build()
    let json = serializeWorld(original)
    for (let i = 0; i < 3; i++) {
      const parsed = deserializeWorld(json)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      json = serializeWorld(parsed.world)
    }
    expect(json).toBe(serializeWorld(original))
  })
})

describe('output', () => {
  it('is byte-identical for the same world', () => {
    // Stable output is what makes exports diffable in git and lets autosave
    // skip redundant writes.
    const world = EXAMPLE_VILLAGES[1].build()
    expect(serializeWorld(world)).toBe(serializeWorld(world))
  })

  it('writes plain pieces in shorthand form', () => {
    const world: World = {
      version: 1,
      name: 'Shorthand',
      seed: 1,
      terrain: { '0,0': 'grass', '1,0': 'grass' },
      pieces: { '0,0': { piece: 'rock' }, '1,0': { piece: 'cottage', rotation: 2 } },
    }
    const doc = toDocument(world)
    expect(doc.pieces['0,0']).toBe('rock')
    expect(doc.pieces['1,0']).toEqual({ piece: 'cottage', rotation: 2 })
  })

  it('stamps the format marker and version', () => {
    const doc = toDocument(emptyWorld())
    expect(doc.format).toBe(FORMAT_ID)
    expect(doc.version).toBe(SCHEMA_VERSION)
  })

  it('does not persist anything about inhabitants', () => {
    // Villagers and animals are derived at runtime and must never leak in.
    const json = serializeWorld(EXAMPLE_VILLAGES[0].build())
    for (const forbidden of ['villager', 'agent', 'guard', 'chicken', 'farmer']) {
      expect(json).not.toContain(forbidden)
    }
  })
})

describe('reading hostile input', () => {
  it('rejects non-JSON without throwing', () => {
    const result = deserializeWorld('this is not json {{{')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/valid JSON/i)
  })

  it('rejects a JSON array', () => {
    expect(parseWorld([1, 2, 3]).ok).toBe(false)
  })

  it('rejects null', () => {
    expect(parseWorld(null).ok).toBe(false)
  })

  it('rejects a file from a different application', () => {
    const result = parseWorld({ format: 'some-other-app', version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/Cozy Builder/)
  })

  it('refuses a save from a newer build rather than dropping fields', () => {
    const result = parseWorld({ format: FORMAT_ID, version: SCHEMA_VERSION + 5, terrain: {}, pieces: {} })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/newer version/i)
  })

  it('accepts a minimal document', () => {
    const result = parseWorld({ format: FORMAT_ID, version: 1, terrain: {}, pieces: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.name).toBe('Untitled village')
  })

  it('generates a seed when one is missing, and says so', () => {
    const result = parseWorld({ format: FORMAT_ID, version: 1, terrain: {}, pieces: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Number.isFinite(result.world.seed)).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/seed/i)
  })

  it('drops unknown pieces and reports them', () => {
    const result = parseWorld({
      format: FORMAT_ID,
      version: 1,
      terrain: { '0,0': 'grass', '1,0': 'grass' },
      pieces: { '0,0': 'cottage', '1,0': 'spaceship' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.pieces['0,0']).toBeDefined()
    expect(result.world.pieces['1,0']).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('spaceship')
  })

  it('replaces unknown terrain but keeps the tile', () => {
    // The island's shape is worth more than the exact terrain type.
    const result = parseWorld({
      format: FORMAT_ID,
      version: 1,
      terrain: { '0,0': 'lava' },
      pieces: {},
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.terrain['0,0']).toBe('grass')
    expect(result.warnings.join(' ')).toContain('lava')
  })

  it('skips malformed coordinates and reports the count', () => {
    const result = parseWorld({
      format: FORMAT_ID,
      version: 1,
      terrain: { '0,0': 'grass', 'not-a-coord': 'grass', '': 'grass' },
      pieces: { 'also-bad': 'cottage' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.world.terrain)).toEqual(['0,0'])
    expect(result.warnings.join(' ')).toMatch(/malformed/i)
  })

  it('normalises out-of-range rotations', () => {
    const result = parseWorld({
      format: FORMAT_ID,
      version: 1,
      terrain: { '0,0': 'grass', '1,0': 'grass' },
      pieces: {
        '0,0': { piece: 'cottage', rotation: 11 },
        '1,0': { piece: 'cottage', rotation: -1 },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.pieces['0,0'].rotation).toBe(5)
    expect(result.world.pieces['1,0'].rotation).toBe(5)
  })

  it('tolerates wrong types for the layers', () => {
    const result = parseWorld({ format: FORMAT_ID, version: 1, terrain: 'nope', pieces: 42 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.terrain).toEqual({})
    expect(result.world.pieces).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('accepts a document with no format marker, for hand-written files', () => {
    const result = parseWorld({ terrain: { '0,0': 'grass' }, pieces: { '0,0': 'well' }, seed: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.pieces['0,0'].piece).toBe('well')
  })

  it('never throws on arbitrary junk', () => {
    const junk: unknown[] = [
      undefined,
      0,
      '',
      true,
      { format: FORMAT_ID, version: 1, terrain: { '0,0': 5 }, pieces: { '0,0': { piece: 9 } } },
      { format: FORMAT_ID, version: 1, terrain: null, pieces: [] },
      { format: FORMAT_ID, version: '1' },
    ]
    for (const value of junk) {
      expect(() => parseWorld(value)).not.toThrow()
    }
  })
})

describe('filenames', () => {
  it('slugifies the village name', () => {
    expect(suggestFilename({ ...emptyWorld(), name: 'Willow Brook!' })).toBe('willow-brook.village.json')
  })

  it('falls back for a name with no usable characters', () => {
    expect(suggestFilename({ ...emptyWorld(), name: '???' })).toBe('village.village.json')
  })
})
