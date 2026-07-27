# Adding content

How to add a building, a terrain type, or a new kind of inhabitant. Each is a
small, well-bounded change — the system is designed so that content additions
touch two files at most.

## Adding a buildable piece

### 1. Declare it in the catalog

Add a `PieceDefinition` to `PIECE_LIST` in `src/world/catalog.ts`:

```ts
{
  id: 'lighthouse',
  name: 'Lighthouse',
  description: 'A striped tower with a lamp at the top.',
  category: 'housing',
  icon: '🗼',
  height: 6,
  rotatable: true,
  variants: 2,
  allowedTerrain: ['sand', 'stone'],
  spawns: [{ kind: 'villager', count: 0.5, radius: 3, behavior: 'wander' }],
}
```

The fields worth thinking about:

| Field | Notes |
| --- | --- |
| `id` | **Written into save files. Renaming one is a breaking change** — add a migration (see `docs/save-format.md`). |
| `category` | Which palette tab it appears under. |
| `height` | Approximate, in world units. Used for camera framing and to decide whether the piece blocks movement. |
| `variants` | How many distinct looks. The renderer receives `ctx.variant`. |
| `rotatable` | Whether the player can rotate it. Autoconnecting pieces should not be — their orientation comes from their neighbours. |
| `connects` / `connectsTo` | See "Making a piece autoconnect" below. |
| `allowedTerrain` | Omit to allow any buildable ground. |
| `foundation` | Terrain automatically painted underneath, e.g. a field brings its own tilled soil. |
| `blocksMovement` | Whether agents can walk through. Defaults to blocking for anything over 0.5 units tall. |
| `spawns` | Who this piece attracts. See "Adding an inhabitant". |

### 2. Write the renderer

Add a `PieceRenderer` to the appropriate file in `src/render/pieces/` and
register it in `src/render/pieces/index.ts` under the same id.

```ts
export const lighthouse: PieceRenderer = (ctx) => {
  const { builder: b } = ctx
  const height = ctx.range('height', 2.4, 3.0)

  b.in({ rotationY: ctx.rotationY }, () => {
    b.cylinder({ radius: 0.35, radiusTop: 0.24, height, color: COLORS.plaster,
                 position: [0, height / 2, 0], segments: 12 })
    // Painted bands.
    for (let i = 0; i < 3; i++) {
      b.cylinder({ radius: 0.36 - i * 0.03, height: 0.3, color: COLORS.roofRed,
                   position: [0, 0.4 + i * 0.8, 0], segments: 12 })
    }
    b.cone({ radius: 0.34, height: 0.4, color: COLORS.roofBlue,
             position: [0, height + 0.2, 0], segments: 12 })
  })
}
```

That's it. The palette, save format, placement rules and agent director all pick
it up from the catalog entry.

### Rules for renderers

**Model in local space.** The origin is the centre of the hex at ground level,
`+X` is east, `-Z` is north, `+Y` is up. One hex is `HEX_WIDTH` (≈1.73) across.
The chunk baker positions your piece; never reference world coordinates.

**Never call `Math.random()`.** Chunks rebake whenever a neighbour changes, so
anything non-deterministic visibly twitches while the player builds next to it.
Use the variance helpers on the context — `ctx.rand`, `ctx.jitter`, `ctx.range`,
`ctx.pick`, `ctx.chance` — which are seeded from the world seed and the hex
coordinate.

**Use a distinct channel name per property.** `ctx.range('height', ...)` and
`ctx.range('colour', ...)` are independent; reusing one channel makes every
tall building also a dark one.

**Vary everything that could plausibly vary.** Height, tint, rotation, prop
placement, which details are present at all. This is the single biggest factor
in whether a row of the same piece reads as a street or as a copy-paste.

**Keep it under a few hundred triangles.** A village holds hundreds of pieces
and detail invisible at normal camera distance costs real frame time.

**Bevel edges.** `roundedBox` rather than `box` wherever an edge is visible. A
hard 90° corner catches a hard specular line; a small chamfer catches a soft
gradient, and that is most of what separates "cosy" from "programmer art".

The full modelling API is documented in `src/render/geometry/builder.ts`.

## Making a piece autoconnect

Give it a `connects` group, and optionally the groups it accepts:

```ts
connects: 'wall',
connectsTo: ['wall', 'path'],   // defaults to [connects]
```

Two adjacent pieces link when the relationship is **mutual** — A accepts B's
group *and* B accepts A's. That mutuality is what stops a fence visibly grabbing
onto a castle wall that has no matching stub to meet it.

In the renderer, read `ctx.mask` and draw a hub plus a stub per connected
direction:

```ts
for (const d of connectedDirections(ctx.mask)) {
  const [dx, dz] = directionVector(d)
  b.strut([0, 0.5, 0], [dx * HEX_WIDTH / 2, 0.5, dz * HEX_WIDTH / 2], 0.08, wood)
}
```

`classifyConnections(mask)` gives a shape category (`isolated`, `end`,
`straight`, `bend`, `junction`) if you want a different silhouette for dead ends
or junctions.

To add a new connection group, extend the `ConnectionGroup` union in
`src/world/types.ts`. It is a string union rather than free-form text so a typo
is a compile error rather than a piece that silently refuses to connect.

## Adding a terrain type

One entry in `TERRAIN_LIST` in `src/world/catalog.ts`:

```ts
{
  id: 'snow',
  name: 'Snow',
  icon: '❄️',
  color: '#eef3f7',
  elevation: 0.02,
  buildable: true,
  walkable: true,
}
```

Terrain needs no renderer — ground tiles are hex prisms tinted from `color`,
with deterministic per-tile variation applied on top.

`elevation` offsets the tile surface. Keep it small; the world reads as flat and
large steps produce visible gaps between neighbouring tiles.

Terrain may also carry `spawns`, which is how ponds get ducks without any piece
being involved.

## Adding an inhabitant

### 1. Add the kind

Extend the `AgentKind` union in `src/world/types.ts`.

### 2. Give it movement parameters

Add an entry to `AGENT_PROFILES` in `src/agents/simulation.ts`:

```ts
goose: { ...DEFAULT_PROFILE, speed: 0.7, pause: [1, 3], pauseChance: 0.6,
         bob: 0.04, stride: 0.28, scale: 0.6 },
```

`speed`, `pause` and `pauseChance` do most of the character work. A fast agent
with short pauses reads as excitable; a slow one with long pauses reads as
content.

### 3. Build the model

Add an entry to `KIND_BUILDERS` in `src/render/agents/models.ts`. There are
existing parameterised builders for humanoids, quadrupeds and birds — most new
animals are a few lines against `buildQuadruped` or `buildBird`.

Give the kind two to four **variants** with different colours. Colour is baked
into the geometry (instanced meshes share one material), so variants are how a
crowd looks varied.

### 4. Attract it from a piece

Add a spawn rule to any catalog entry:

```ts
spawns: [{ kind: 'goose', count: 1.5, radius: 3, behavior: 'graze' }],
```

`count` is fractional and accumulates across every piece of that type in the
world — `0.5` means two of the piece are needed to justify one agent. This is
what makes population scale smoothly with how much has been built.

`behavior` is one of `wander`, `patrol` (follows the wall network, at rampart
height), `work` (long pauses near the workplace), `graze` (slow, frequent
pauses), or `flit` (flies).

## Adding a sample village

Sample villages are composed in code in `src/world/examples.ts`, using helpers
from `generate.ts` (`put`, `putLine`, `putDisc`, `paint`, `clearArea`). Add an
entry to `EXAMPLE_VILLAGES` and it appears in the **Villages** menu.

They are composed rather than shipped as JSON so they stay diffable and pick up
content improvements automatically. The serialization tests round-trip every one
of them, so they double as realistic save-format fixtures — which is a good
reason to make a new one exercise pieces the others don't.
