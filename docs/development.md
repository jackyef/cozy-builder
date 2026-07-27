# Development

Workflow, debugging, and the traps that cost real time.

## Setup

```bash
pnpm install
pnpm run dev
```

**Node 24** and **pnpm 10**. There are no native dependencies and nothing to
download at runtime.

The pnpm version is pinned by the `packageManager` field in `package.json`, so
`corepack enable` is enough to get the right one:

```bash
corepack enable
```

CI reads the same field rather than hardcoding a version, so there is exactly
one place to change it.

`engines.node` is `>=24`. pnpm only *warns* on a mismatch rather than refusing
to install, so an older Node will still get you running — but CI builds on 24,
so that is what to test against.

pnpm 10 does not run dependency postinstall scripts unless they are listed in
`pnpm.onlyBuiltDependencies`. `esbuild` (a Vite dependency) is the only one this
project needs. If you add a dependency whose install is incomplete without its
script, add it there — a bare warning during install is easy to miss.

| Command | What it does |
| --- | --- |
| `pnpm run dev` | Dev server with hot reload |
| `pnpm run build` | Type-check, then build to `dist/` |
| `pnpm run preview` | Serve the production build |
| `pnpm test` | Run the test suite once |
| `pnpm run test:watch` | Watch mode |
| `pnpm run typecheck` | Type-check only |

## Debugging the 3D scene

Append `?debug` to the URL to attach a console handle:

```js
__cozy.report()        // lights, shadows, draw calls, triangle count, camera
__cozy.gl              // the WebGLRenderer
__cozy.scene           // the scene graph
__cozy.camera
__cozy.THREE           // three itself, for building test objects
```

This exists because rendering bugs here are almost never visible in the code and
almost always obvious in the object graph. `report()` deliberately includes
`projectionHalfWidth` alongside the shadow camera's frustum bounds — if those
two disagree, `updateProjectionMatrix()` was never called and shadows are being
clipped to a stale box.

Useful things to do with it:

```js
// Is anything actually casting?
__cozy.scene.traverse(o => { if (o.isMesh && o.castShadow) console.log(o.name || o.type) })

// Drop an obvious test object into the world.
const m = new __cozy.THREE.Mesh(
  new __cozy.THREE.BoxGeometry(4, 6, 4),
  new __cozy.THREE.MeshLambertMaterial({ color: 'magenta' }))
m.position.set(0, 3, 0); m.castShadow = true; __cozy.scene.add(m)

// Isolate the toon material as a cause.
__cozy.scene.traverse(o => {
  if (o.isMesh && o.material?.type === 'MeshToonMaterial')
    o.material = new __cozy.THREE.MeshLambertMaterial({ vertexColors: true })
})
```

### Diagnosing "it renders but looks flat"

Shadows failing produce no error and no warning — the scene simply looks flat.
When that happens, work down this list:

1. `__cozy.report().renderer.shadowsEnabled` — is the shadow map on at all?
2. `report().sun.frustum` vs `report().sun.projectionHalfWidth` — do they agree?
   If not, the projection matrix is stale.
3. `report().sun.shadowMapSize` vs the actual allocated `light.shadow.map.width`
   — `mapSize` is only read at allocation time.
4. **Compare the sun's azimuth to the camera's.** If they are close, every
   shadow is hidden behind the object casting it. This is the one that wastes
   the most time, because everything is configured correctly and nothing is
   visible.
5. Measure rather than squint. Screenshot, disable every `castShadow`,
   screenshot again, and diff the pixels — a 4× amplified difference image shows
   exactly where shadows land and whether they are simply too subtle.

Shadows are genuinely hard to see in a wide shot of the whole island. Zoom in
before concluding they are broken.

## Testing

The suite is deliberately concentrated on the parts where bugs are silent and
expensive:

- **`core/hex.test.ts`** — everything spatial is built on this. `hexDistance` is
  checked against breadth-first search, and `worldToHex` is verified to return
  the genuinely nearest hex centre across a dense sweep, because naive rounding
  fails only near edges and corners.
- **`world/autoconnect.test.ts`** — mask computation, mutual connection rules,
  and the 64-masks-reduce-to-14-orbits property as a canary on the rotation
  logic.
- **`world/serialize.test.ts`** — round-trip fidelity using the sample villages
  as fixtures, plus a battery of hostile inputs. `parseWorld` must never throw.
- **`agents/director.test.ts`** — population is derived from pieces, and
  variance is deterministic. Both are core promises that could otherwise drift
  silently.

There are no rendering tests. Verify visual work by running the app and looking
at it; screenshots through a headless browser work well for regressions.

## Traps

**Never call `Math.random()` in a piece renderer.** Chunks rebake whenever a
neighbour changes, so anything non-deterministic twitches while the player
builds nearby. Use the variance helpers on `PieceContext`.

**Direction indices are bit positions.** The order of `HEX_DIRECTIONS` in
`core/hex.ts` is used as bit positions by the autoconnect mask. Reordering it
silently corrupts every connecting piece.

**Piece ids are in save files.** Renaming one breaks existing villages. Add a
migration — see `docs/save-format.md`.

**`Color.set()` already converts sRGB → linear.** Calling
`convertSRGBToLinear()` after it is a double conversion. Conversely `setHSL` and
`setRGB` default to the *linear* working space and need `SRGBColorSpace` passed
explicitly if you are thinking in sRGB.

**`onBeforeCompile` needs `customProgramCacheKey`.** Without a distinct key, two
materials with the same parameters share a compiled program and your shader
injection silently does nothing.

**React 19 StrictMode double-invokes effects.** Anything that mutates renderer
state in an effect must be idempotent. The session restore in `App.tsx` guards
against this explicitly.

**`frustumCulled={false}` on instanced agents is load-bearing.** The bounding
sphere is computed once from the geometry and never updated as agents walk, so
culling makes the whole crowd vanish when the camera looks away from the origin.

## Where to make a change

| I want to… | Go to |
| --- | --- |
| Add a building, terrain type or animal | `docs/adding-content.md` |
| Change how a piece looks | `src/render/pieces/` |
| Change the palette | `COLORS` in `src/world/catalog.ts` |
| Change lighting or the day cycle | `src/render/lighting.ts` |
| Change how villagers behave | `src/agents/simulation.ts` |
| Change who spawns | `spawns` on catalog entries, and `src/agents/director.ts` |
| Change the save format | `src/world/serialize.ts`, then bump `SCHEMA_VERSION` |
| Change build controls or undo | `src/state/store.ts` |
| Change the UI | `src/ui/` and `src/styles.css` |

## CI and deploying

There are two workflows, deliberately kept separate.

**`.github/workflows/ci.yml`** type-checks, tests and builds on every pull
request and every push to `main`. This is the meaningful status check.

**`.github/workflows/deploy.yml`** publishes to GitHub Pages on pushes to
`main`. It sets `VITE_BASE=/<repo-name>/` so assets resolve under the Pages
sub-path (`vite.config.ts` reads it) and copies `index.html` to `404.html`,
since Pages has no rewrite rules and a deep link would otherwise 404.

The split exists because `actions/configure-pages` fails hard when Pages has not
been enabled on the repository — "Get Pages site failed … Not Found". That is a
repository-settings and billing-plan question, not a statement about the code,
and when the deploy shared a job with the build it turned an otherwise-green
commit red and buried the real signal.

So `deploy.yml` now asks the Pages API whether a site exists before doing
anything. If not, it logs what to do and finishes successfully. Every non-200
response is treated as "not configured" and skips rather than fails, including
a connection error — the check must never be the thing that breaks the build.

### Enabling Pages

**Settings → Pages → Source → GitHub Actions**, then re-run the workflow
(Actions → Deploy to GitHub Pages → Run workflow).

The **Source** setting is the part that matters, and choosing the other option
fails in a way that looks like a code bug. With **Deploy from a branch**,
GitHub's own legacy builder publishes the *repository root* verbatim — and the
root `index.html` is Vite's source template, which references `/src/main.tsx`.
That path only exists while the dev server is running, so the published page
loads and then errors at runtime with nothing in the build logs to explain it.
Meanwhile the Actions workflow deploys nothing, because branch-based publishing
bypasses it entirely.

`deploy.yml` detects this state explicitly and **fails with an explanation**,
rather than skipping quietly as it does when Pages simply isn't set up. The
distinction is deliberate: "no Pages site" is a legitimate steady state, but
"Pages is publishing something other than what this pipeline builds" is a
misconfiguration actively serving a broken page, and silence there is worse than
a red run.

`actions/configure-pages` cannot fix it either. With `enablement: true` it
creates a *missing* site with `build_type: workflow`, but it never updates an
existing one — so a site already set to branch-deploy stays that way until the
setting is changed by hand.

**Pages on a private repository requires GitHub Pro, Team or Enterprise.** On
the Free plan the option is unavailable until the repository is public. If you
don't want to publish it, there is nothing to do — `ci.yml` still gates the code
and `deploy.yml` will keep skipping quietly.

`actions/configure-pages` also accepts `enablement: true`, which provisions
Pages itself. It's left off, and commented in the workflow, because it changes
repository settings as a side effect of a push — and it can't succeed on a
private repository on a plan without Pages anyway.
