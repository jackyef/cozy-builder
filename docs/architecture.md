# Architecture

This document explains how Cozy Builder is put together and, more importantly,
*why* — several decisions here are deliberate and would look arbitrary or wrong
without the reasoning behind them.

Read this before making structural changes.

## The shape of the thing

```
src/
├── core/          Pure maths. No React, no three.js, no world knowledge.
│   ├── hex.ts        Hex grid: coordinates, neighbours, regions, conversion
│   └── rng.ts        Deterministic hash-based randomness
│
├── world/         The data model. No rendering.
│   ├── types.ts      World, PlacedPiece, catalog and spawn-rule types
│   ├── catalog.ts    Every terrain type and buildable piece — the content
│   ├── autoconnect.ts How neighbouring pieces decide to link up
│   ├── generate.ts   Island generation and village-composition helpers
│   ├── examples.ts   The three sample villages
│   └── serialize.ts  Save format: read, write, validate, migrate
│
├── state/
│   └── store.ts      Zustand store: world, tool, undo history, autosave
│
├── agents/        The population. Runtime only, never serialized.
│   ├── director.ts   Who exists, where they belong, walkability, pathfinding
│   └── simulation.ts Steering, walk cycles, idle behaviour
│
├── render/
│   ├── geometry/builder.ts  The procedural modelling API
│   ├── pieces/              One renderer per piece, grouped by category
│   ├── chunks.ts            Bakes the world into per-chunk geometry
│   ├── materials.ts         Shared materials and the toon ramp
│   ├── lighting.ts          The day cycle
│   ├── Scene.tsx            Canvas, lights, camera, composition
│   ├── WorldChunks.tsx      Renders baked chunks
│   ├── AnimatedProps.tsx    The few things that move
│   ├── Interaction.tsx      Pointer picking and the placement preview
│   ├── SkyDome.tsx          Gradient sky
│   ├── DebugHandle.tsx      `?debug` console access to the live scene
│   └── agents/              Agent models and instanced rendering
│
└── ui/            React DOM overlay: palette, toolbar, notices, help
```

The dependency direction is strictly downward: `core` knows nothing about
`world`, `world` knows nothing about `render`, and `render` reads the world but
never writes it. The only thing that mutates the world is the store.

## The five decisions that matter

### 1. The world is small; everything else is derived

The serialized world is a seed, a terrain layer and a piece layer. That is all.
Three categories of thing are deliberately *not* stored:

- **Inhabitants.** Villagers, guards, farmers and animals are recomputed from
  the pieces present, every time the world loads or changes.
- **Visual variance.** Every tilt, tint and wobble is a pure function of the
  seed and the hex coordinate.
- **Autoconnect state.** Which way a wall turns is recomputed from its
  neighbours.

The rule: **if it can be recomputed from the pieces, it does not go in the
file.** This keeps saves tiny and hand-editable, makes it impossible for the
document to disagree with what is on screen, and means improvements to
generation immediately apply to villages saved months ago.

It also makes the world feel alive for free. You build a barn, chickens appear;
you knock it down, they leave. There is no population to manage and no way for
it to drift out of sync.

### 2. Autoconnect is hub-and-spokes, not a variant table

Every connecting piece computes a **6-bit mask** of which neighbours it links
to, then draws a hub plus one outward stub per set bit.

The conventional alternative is to enumerate neighbour configurations and map
each to a pre-authored mesh — 64 raw cases, 14 up to rotation. That needs
fourteen hand-made meshes *per connecting piece type*, and every new piece type
multiplies the work.

Generating from the mask instead means one renderer per piece type and no
variant authoring at all. A wall that turns a corner is not a "corner piece";
it is a hub with two stubs 120° apart. Every junction shape a player can build
falls out of the same code.

Because the mask uses direction indices as bit positions, **the direction order
in `core/hex.ts` must never be reordered.**

`autoconnect.ts` still exposes `canonicalMask()` for the 14-orbit reduction, in
case a future variant-table renderer wants it.

### 3. Geometry is baked into chunks, not rendered as components

The natural React approach is a `<Cottage>` component containing a dozen
`<mesh>` elements. At village scale that is tens of thousands of objects for
three.js to traverse, cull and draw every frame, and it drops to single-digit
frame rates long before the island is full.

Instead, each piece is a **function that emits triangles** into a shared buffer.
The world is divided into fixed chunks of 6×6 hexes; each chunk bakes down to
one opaque geometry with vertex colours plus an optional water geometry. A whole
village is a few dozen draw calls.

Chunks are cached and rebuilt individually. On every world change a cheap
signature is computed per chunk and only those that moved are rebaked — normally
one, occasionally two when the edit sits on a chunk seam. The signature folds in
each connecting piece's neighbours, because autoconnect makes a wall change
shape when something appears *outside* its own chunk.

The cost of this choice is that baked pieces cannot hold state or receive
events. Nothing in a village needs to. The handful of things that genuinely move
— windmill sails, banners, lamp glow, and the inhabitants — are rendered
separately as real objects.

### 4. Picking is arithmetic, not raycasting

Pointer events hit a single large invisible plane. From the hit point,
`worldToHex` gives the hex directly in closed form. The terrain is never
raycast.

This is O(1) however large the village grows, and — the part that actually
matters — it works where there is no geometry: over water, over gaps in the
island, and over the empty space you are about to extend the island into.

### 5. Undo stores whole-world snapshots

A world is two plain records of small values, so a snapshot is a shallow copy of
two objects: well under a millisecond even for a large village. That buys a
history implementation with no diffing, no inverse operations, and no way for a
new piece type to silently break undo.

A drag is a **stroke**: one snapshot is taken when it begins, and the whole drag
collapses into a single undo step regardless of how many tiles it covers.

## How a click becomes a village

1. `Interaction.tsx` receives a pointer event on the pick plane and converts the
   hit point to a hex.
2. `store.beginStroke` snapshots the world for undo, then applies the tool.
3. `store.extendStroke` fills the hex line from the previous sample to the
   current one — pointer events are sampled far more coarsely than a fast mouse
   moves, and without interpolation quick drags lay down dotted lines.
4. The store produces a new `World` object. Tool applications that change
   nothing return the *same* reference, so no-op drags skip React entirely.
5. `WorldChunks` recomputes chunk signatures, rebakes what changed, and renders.
6. `Agents` replans the population and reconciles it against the live one by
   spec id, so everyone who still belongs stays exactly where they were.

## Rendering pipeline

```
catalog entry ─→ piece renderer ─→ MeshBuilder ─→ chunk geometry ─→ one draw call
                     (pure fn)     (triangles)      (cached)
```

A piece renderer is `(ctx: PieceContext) => void`. It models one building at the
origin in local space; the chunk baker positions it. The context carries
deterministic variance helpers, the connection mask, the resolved variant and
the rotation.

**This registry is the seam for real 3D models.** A renderer is just a function
that emits geometry, so a GLTF-backed implementation can replace a procedural
one piece by piece — load the model, feed its geometry through
`ctx.builder.add(...)`, and nothing else in the codebase needs to change. Piece
ids, placement rules, autoconnect and the save format are all independent of how
a piece is drawn. See `docs/adding-content.md`.

## Agents

`director.ts` decides *who exists*. Catalog entries declare spawn rules — a
kind, a fractional count, a radius, a behaviour. The director sums the fractions
per kind and materialises one agent each time the running total crosses an
integer. Fractional counts are what stop a single cottage spawning a crowd while
still letting a street of ten fill up naturally. Results are capped for frame
budget.

`simulation.ts` decides *what they do*. Steering behaviours with an explicit
`dt`, waypoints from a small breadth-first search over the walk grid, and walk
cycles advanced by **distance travelled rather than time** so feet look planted
and slowing down shortens the stride.

There is no physics engine and no React state per agent. The whole population
lives in one array mutated inside a single `useFrame`.

Rendering is one `InstancedMesh` per (kind, variant). Colour is baked into
variants rather than applied per instance, so a street of villagers all look
different for about thirty draw calls.

## What isn't here

Worth knowing so you don't go looking:

- **No physics.** Deliberate; see `agents/simulation.ts`.
- **No outlines.** The cosy reference style has none — the silhouette read comes
  from shape language and value contrast. See `docs/rendering.md`.
- **No multi-hex buildings.** `PieceDefinition.footprint` is reserved for it but
  nothing implements it yet; placement assumes one piece per hex.
- **No A\*.** Agent territories are small enough that breadth-first search is
  both faster in practice and impossible to get subtly wrong.
- **No texture atlas or UVs.** Everything is vertex-coloured.
