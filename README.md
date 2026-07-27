# Cozy Builder

A 3D cosy village builder on a hexagon grid. Pick a piece, click or drag on the
ground, and watch the place fill up with people.

<!-- Screenshots live in docs/images and are referenced from docs/README.md -->

## What it is

- **Hex-grid world.** Pointy-top hexagons, one piece per tile, terrain you paint
  the same way you build.
- **One gesture.** Pick something from the palette, then click or drag. There is
  no rotate-before-place step, no snapping mode, no confirm. A drag lays a whole
  run of wall in one action — and undoes as one action too.
- **Pieces that join up by themselves.** Walls, fences, paths and fields connect
  to their neighbours automatically. Draw the shape you want; corners, junctions
  and dead ends take care of themselves.
- **A village that populates itself.** Build a market and shoppers arrive. Build
  a barn and livestock appear. Build a castle wall and guards patrol along the
  top of it. Nobody is placed by hand and nobody is saved to disk.
- **Everything procedural.** Every building, tree, villager and animal is
  generated in code from primitives. There are no model files, no textures and
  no downloads — the whole world is a few hundred kilobytes of TypeScript.
- **Portable saves.** Villages export as small, readable, diffable JSON, and
  import back exactly as they left.

## Running it

```bash
npm install
npm run dev
```

Then open the printed URL.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check without building |

## Controls

| Input | Action |
| --- | --- |
| **Left-drag on the ground** | Build with the selected piece |
| **Right-drag** | Orbit the camera |
| **Middle-drag** | Pan |
| **Scroll** | Zoom |
| `R` | Rotate the next piece placed |
| `1`–`6` | Jump to a rotation |
| `E` | Eraser |
| `Space` | Look mode — left-drag orbits instead of building |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |

The eraser removes the piece on a tile. On a tile with nothing built on it, it
removes the ground instead, which is how you reshape the island.

## Saving

Your village autosaves to the browser's local storage as you build. **Export**
downloads it as a `.village.json` file; **Import** loads one back. The format is
documented in [`docs/save-format.md`](docs/save-format.md) and is stable across
versions — older files keep opening.

Three sample villages ship with the app under **Villages**, each demonstrating a
different part of the system: a market town built around a path network, a
walled castle, and a farm of merged fields.

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | How the whole thing fits together, and why |
| [`docs/adding-content.md`](docs/adding-content.md) | Adding a piece, terrain type or inhabitant |
| [`docs/save-format.md`](docs/save-format.md) | The save file format and how to evolve it |
| [`docs/rendering.md`](docs/rendering.md) | Art direction, lighting and the geometry pipeline |
| [`docs/development.md`](docs/development.md) | Workflow, debugging, and traps worth knowing about |

If you are picking this project up fresh, read `docs/architecture.md` first —
the design has a few deliberate and unobvious decisions, and it explains what
they buy.

## Tech

React 19, React Three Fiber 9, three.js r185, Zustand, Vite, TypeScript. No
runtime asset dependencies.

## Licence

MIT.
