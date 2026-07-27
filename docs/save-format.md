# Save format

A village is a single JSON object. It is designed to be small, diffable, and
comfortable to write by hand.

## Example

```json
{
  "format": "cozy-builder-village",
  "version": 1,
  "name": "Willowbrook",
  "seed": 6221847,
  "terrain": {
    "0,0": "stone",
    "1,0": "grass",
    "1,-1": "water"
  },
  "pieces": {
    "0,0": "fountain",
    "1,0": { "piece": "cottage", "rotation": 2 },
    "2,-1": { "piece": "house", "rotation": 4, "variant": 1 }
  }
}
```

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | Always `"cozy-builder-village"`. Optional on read, so hand-written files work. |
| `version` | number | Save-format version. See [Versioning](#versioning). |
| `name` | string | Shown in the UI; also the basis for the export filename. |
| `seed` | number | Drives every piece of deterministic visual variance. |
| `terrain` | object | Ground layer, keyed by coordinate. Hexes absent from this map are outside the island. |
| `pieces` | object | Building layer, keyed by coordinate. At most one per hex. |

### Coordinates

Keys are `"q,r"` — pointy-top **axial** hex coordinates. The implicit third cube
coordinate is `s = -q - r`. See `src/core/hex.ts` for the full convention.

### Piece entries

A piece with nothing extra to say is written as a bare string:

```json
"3,-1": "tree_pine"
```

The object form is used only when there is more to record:

```json
"3,-1": { "piece": "cottage", "rotation": 2, "variant": 1 }
```

| Field | Meaning |
| --- | --- |
| `piece` | Catalog id. Required. |
| `rotation` | 0–5, in sixths of a turn. Only meaningful for pieces with `rotatable: true`; autoconnecting pieces ignore it. |
| `variant` | Explicit appearance override. Normally omitted, in which case the variant is chosen deterministically from the seed and coordinate. |

**Both forms are always accepted on read.** The writer uses whichever is
shorter.

## What is deliberately absent

The format contains no villagers, no animals, no autoconnect state and no
per-tile appearance data. All of it is recomputed at load time:

- **Inhabitants** are derived from the pieces present (`src/agents/director.ts`).
- **Visual variance** is a pure function of `seed` and coordinate
  (`src/core/rng.ts`).
- **Connections** are recomputed from neighbours (`src/world/autoconnect.ts`).

The rule is: *if it can be recomputed from the pieces, it does not go in the
file.* Saves stay tiny, the document can never disagree with what is on screen,
and improvements to generation apply retroactively to old villages.

The practical consequence worth knowing: **changing `seed` reskins the whole
village** — same buildings, different tree shapes, roof colours and tints.

## Output guarantees

- **Keys are sorted** by row then column, so saving the same village twice
  produces byte-identical output. That is what makes exports diffable in git and
  lets autosave skip redundant writes.
- **Exports are pretty-printed**; the localStorage autosave is compact.

## Versioning

`SCHEMA_VERSION` in `src/world/serialize.ts` is the current format version.

| Version | Changes |
| --- | --- |
| 1 | Initial format. |

### Reading older files

`migrate()` walks a document forward one version at a time. To add a migration,
bump `SCHEMA_VERSION` and add a `case` for the version you are migrating
*from*; each case mutates the document into the next version's shape and falls
through, so a v1 file opened by a v4 build is handled without special casing.

Push a note onto `warnings` for anything a player would notice. A renamed piece
id can be migrated silently; a dropped feature cannot.

### Reading newer files

Loading a document with a higher `version` than the build understands **fails**,
rather than loading what it can. Silently discarding fields the player cannot
see, and then letting them re-export, would destroy their data.

## Robustness

Imported JSON is untrusted — it may be a file someone was sent. `parseWorld`
validates every field and distinguishes two outcomes:

- **Errors** mean the document cannot be loaded at all: malformed JSON, a
  different application's format, a future version.
- **Warnings** mean something was repaired or dropped but the rest loaded, and
  are surfaced in the UI.

Specific behaviours:

| Situation | Result |
| --- | --- |
| Unknown piece id | Dropped, with a warning naming it. Lets a village from a newer build open, minus what this one can't draw. |
| Unknown terrain id | Replaced with grass, tile kept, warning issued. The island's shape is worth more than the exact terrain. |
| Malformed coordinate key | Skipped, counted in a warning. |
| Rotation out of range | Normalised into 0–5. |
| Missing `seed` | A new one is generated, with a warning that decoration may differ. |
| `terrain`/`pieces` not objects | Treated as empty, with a warning. |

`parseWorld` never throws, for any input.

## Editing by hand

The format is meant to be edited. A minimal valid village:

```json
{
  "terrain": { "0,0": "grass", "1,0": "grass", "0,1": "grass" },
  "pieces": { "0,0": "well" }
}
```

`format`, `version` and `seed` may all be omitted — the seed will be generated
and you will get a warning saying so.

Neighbouring coordinates for `"q,r"` are `q±1,r`, `q,r±1`, `q+1,r-1` and
`q-1,r+1`. Lay several connecting pieces on adjacent hexes and they will link up
on load.
