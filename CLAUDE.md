# Cozy Builder — notes for future sessions

A 3D cosy village builder on a hex grid. React 19 + React Three Fiber 9 +
three.js r185 + Zustand + Vite + TypeScript. Everything is procedurally
generated in code; there are no asset files.

## Read first

- `docs/architecture.md` — how it fits together and **why**. Several decisions
  look arbitrary without the reasoning.
- `docs/development.md` — debugging, and a list of traps that cost real time.
- `docs/adding-content.md` — adding a piece, terrain type or animal.
- `docs/save-format.md` — the save format and how to evolve it.
- `docs/rendering.md` — art direction and the geometry/lighting pipeline.

## The core ideas, compressed

1. **The save file is minimal; everything else is derived.** Villagers, animals,
   visual variance and autoconnect state are all recomputed at runtime from the
   pieces present. If it can be recomputed, it does not go in the file.
2. **Autoconnect is a 6-bit neighbour mask** driving a hub-and-spokes renderer,
   not a table of pre-authored variants. Direction indices in `core/hex.ts` are
   bit positions — **never reorder them**.
3. **Geometry is baked into chunks**, not rendered as React components. A piece
   renderer is a pure function that emits triangles. This registry is also the
   seam where real GLTF models could replace procedural ones.
4. **Picking is arithmetic, not raycasting** — a ray/plane hit converted with
   `worldToHex`.
5. **Undo stores whole-world snapshots**, and a drag is one undo step.

## Verify visual work by looking at it

The build passing says nothing about whether the scene renders. Run the app and
screenshot it. Shadow bugs in particular produce no error — the scene just looks
flat. `?debug` attaches `__cozy` to the console; `__cozy.report()` dumps lights,
shadow state, draw calls and triangle counts. See `docs/development.md` for a
diagnosis checklist.

## Conventions

- Pointy-top **axial** hex coordinates `{ q, r }`. World space is `+X` east,
  `-Z` north, `+Y` up.
- Piece renderers model at the origin in local space and must be deterministic —
  **never `Math.random()`**; use the variance helpers on `PieceContext`.
- Piece and terrain ids appear in save files. Renaming one needs a migration.
- Comments explain *why*, especially where a simpler-looking approach was tried
  and rejected. Keep that up; several of them exist because the obvious thing is
  wrong.

## Commands

```bash
pnpm run dev        # dev server
pnpm run build      # typecheck + build
pnpm test           # 99 tests
pnpm run typecheck
```
