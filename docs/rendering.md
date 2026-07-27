# Rendering and art direction

What makes the world look the way it does, and which of those choices are load-
bearing.

## The look, in one paragraph

The reference style is soft-shaded, not cel-shaded. It has no outlines, a
**narrow high-key value range**, saturated-but-not-neon colour, rounded chunky
shapes, and soft shadows. Reaching for hard toon bands and black outlines
produces something quite different — good, but a different game. The single most
important discipline is the value range: nothing in the scene goes near black.

## Materials

Everything uses one shared `MeshToonMaterial` with vertex colours, so a whole
chunk of the world draws in a single call.

Toon is chosen for a reason that has little to do with the cel look: its
`gradientMap` lets us **author the value range directly**. The ramp in
`materials.ts` never drops below `0.72`, which guarantees no surface is ever
darker than 72% of its albedo. That is very hard to get out of a
physically-based material without fighting the lighting. `LinearFilter` on the
ramp keeps the terminator soft, so we get the floor without the banding.

Two facts about how three.js implements toon shading, both useful:

- Only the **direct** light term passes through the ramp. Indirect light — our
  hemisphere fill — is plain Lambert, so it stays perfectly smooth.
- Shadow attenuation is folded into the light colour *before* the ramp, so cast
  shadows are smooth too. Crisp form shading, soft shadows.

Water is the same material with a small vertex ripple injected via
`onBeforeCompile`. That injection **requires** a distinct `customProgramCacheKey`
— three.js caches compiled programs by material parameters, so without one the
water would silently share the village material's program and the ripple would
never appear.

## Colour management

Colours are authored as sRGB hex strings. `Color.set()` already converts them to
the linear working space (three.js colour management, on by default since r152),
so **calling `convertSRGBToLinear()` afterwards is a double conversion** and
renders everything dark and oversaturated. This was a real bug during
development.

The corollary: `setHSL` and `setRGB` default to the *linear* working space, not
sRGB. `builder.ts`'s `tint()` passes `SRGBColorSpace` explicitly, because HSL
lightness is only perceptually meaningful in a gamma-encoded space — the same
shift applied linearly is far stronger on dark colours than light ones and shows
up as blotchy terrain.

## Tone mapping

`NeutralToneMapping`, explicitly overriding React Three Fiber's `ACESFilmic`
default.

ACES bakes channel-blending desaturation in at *all* luminances, before any
curve, which eats precisely the mid-saturation greens and cyans this palette is
built from — it is the documented cause of the perennial "why is my scene washed
out" complaint. Neutral is effectively an identity function below a 0.76 peak
channel, which covers the entire palette, with a graceful rolloff above instead
of hard clipping.

If the scene looks too dark, raise light intensities rather than
`toneMappingExposure` — exposure multiplies *before* the knee, so pushing it
above ~1.15 starts driving bright sand into the desaturating branch.

## Lighting

A hemisphere light for fill and one directional light for the sun.

**Not an `AmbientLight`.** A flat ambient term adds the same value to every
surface regardless of orientation, which destroys the form read entirely. A
hemisphere light gives a sky-to-ground gradient along the surface normal, which
is the soft top-lit falloff this style wants — and it is what makes shadowed
faces read as cool blue-green rather than grey.

Intensities look high next to older three.js material and are correct: the
legacy lighting mode was removed in r165, and every pre-r155 intensity needs
multiplying by π. A tutorial's `intensity: 0.6` is `1.9` today.

### Shadows: three traps, all hit during development

These were each responsible for "the scene renders but looks inexplicably flat",
and none of them produce an error.

**1. The shadow camera's projection matrix.** Setting `shadow-camera-left` and
friends as JSX props assigns the values but does **not** rebuild the projection
matrix. `LightShadow` reuses whatever matrix the camera already has, so the
frustum stays at its 10×10 default and shadows appear only in a tiny patch near
the origin. The frustum is therefore configured imperatively in `Scene.tsx`
followed by an explicit `updateProjectionMatrix()`.

**2. `mapSize` is read only at allocation.** The render target is created on the
first shadow pass, which can happen before an effect that sets `mapSize` runs —
leaving shadows silently at the 512² default. `Scene.tsx` disposes an
already-allocated map of the wrong size so three rebuilds it.

**3. Sun azimuth versus camera azimuth.** This was the big one. With the sun at
the same azimuth as the default camera, every shadow falls precisely *behind*
the object casting it and is hidden by it. Shadows render correctly, cost
exactly as much, and cannot be seen.

`MIDDAY_AZIMUTH` in `lighting.ts` is set 90° from the default camera so shadows
throw toward screen-right. Elevation is bounded to 15°–58° for the same reason:
at 60° a cottage casts a shadow shorter than one hex and it disappears under the
building.

`shadows="percentage"` on the `<Canvas>` selects `PCFShadowMap`. Passing
`shadows` alone selects `PCFSoftShadowMap`, which three.js r182+ removed — it
warns and silently downgrades to the same thing. Post-r182 PCF is already soft.

### The optimisation that was removed

`shadowMap.autoUpdate = false` with a one-shot `needsUpdate` on geometry change
is the obvious win here, and it is wrong for this project: the village is never
static, because villagers walk around it. Freezing the shadow map glues their
shadows to the ground while they walk out from under them. It also makes
correctness depend on every code path remembering to request a refresh, and a
missed refresh fails silently.

## Sky and fog

A large inverted sphere with a two-colour vertical gradient, not drei's `<Sky>`.
Physical daylight models produce physically-correct horizon desaturation and a
real sun disc — the opposite of the flat authored band this style wants — and
they cannot be pinned to an exact colour, so the fog would never match.

**A raw `ShaderMaterial` writing `gl_FragColor` gets neither tone mapping nor
output colour-space conversion.** `#include <colorspace_fragment>` is not
optional in the sky shader; without it the sky renders dark and oversaturated
and will never line up with the fog.

Fog is `FogExp2`. Four things must agree or a seam appears at the horizon: the
sky dome's horizon band, the fog colour, the hemisphere light's sky colour, and
the renderer clear colour. `lighting.ts` derives all four from one time value so
they cannot drift.

Fog colour is deliberately **less saturated and slightly lighter** than the sky
horizon. Real aerial perspective loses chroma faster than luminance; fog at the
same saturation tints distant geometry blue and reads as underwater rather than
hazy. Fog is applied *after* tone mapping and colour conversion, so `fogColor`
renders as literally the sRGB value given.

## Camera

Perspective at `fov: 22` — roughly a 50mm lens. The three.js default of 50 is a
wide-angle lens and reads "gamey". Perspective compression is what makes the
village look like a *model* rather than a place, which is the core of the
diorama feel.

Pitch is clamped to a shallow band. Looking straight down flattens the buildings
and the whole look collapses.

Orthographic was considered and rejected: it reads as a strategy game and
removes exactly the foreshortening doing the work.

## Geometry

`MeshBuilder` in `render/geometry/builder.ts` is the modelling API — a transform
stack plus primitives that emit triangles into a shared buffer. Primitive
geometries are cached and reused across every piece in the world.

### Hex prisms must match the lattice exactly

Ground tiles, field slabs and pen floors are hex prisms, and two things have to
be right or the world stops tiling seamlessly.

**`radius` is the circumradius**, which is exactly `HEX_SIZE`. Passing
`HEX_WIDTH / 2` — the *inradius*, centre to edge — is the easy mistake and
leaves a gap at every corner.

**Pointy-top needs no rotation.** `CylinderGeometry(…, 6)` already places its
first vertex at +Z and steps round from there, producing vertices at 30°, 90°,
150°… which is exactly what `hexCorners` specifies. It is *flat-top* that needs
the 30° turn.

Getting that backwards was a real bug, and its symptom is worth recognising: a
tile rotated 30° off the lattice still looks like a honeycomb, because it
overlaps its neighbours along the six neighbour axes. But its flat edges then
face the lattice's triple points, so every three-way corner is left with a small
triangular hole. It reads as "there's a gap between the hexagons", not as a
rotation error.

`builder.test.ts` checks prism corners against `hexCorners` directly, asserts
that flat edges rather than vertices face the neighbours, and verifies that
three mutually adjacent tiles all reach their shared corner.

Tiles are also baked at `TILE_OVERLAP` (1.0015× the circumradius). They tile
exactly at 1.0; the fraction on top covers floating-point error along shared
edges, which otherwise shows as flickering hairline cracks at glancing angles.

**Bevel everything.** `roundedBox` rather than `box` wherever an edge is
visible. A hard 90° corner catches a hard specular line; a small chamfer catches
a soft gradient, and that is most of what separates "soft toy" from
"untextured cube". A radius of 15–20% of the smallest dimension is the sweet
spot.

**Vary everything.** Height, tint, rotation, prop presence. All variance is
seeded from the world seed and hex coordinate so it is stable across reloads —
see `core/rng.ts` for why hashing beats a sequential PRNG here.

## Outlines

There are none, deliberately. The reference style has no outlines; the
silhouette read comes from shape language and value contrast against the ground.

If you do add them, drei's `<Outlines>` is the right tool — it is an inverted
hull that supports `InstancedMesh`, so it costs one extra draw call per outlined
mesh rather than per instance. Use a dark tint of the object's own hue at low
opacity, never black: a black outline instantly flips the read from "cosy" to
"cel-shaded anime". The post-processing `<Outline>` effect is the right choice
only for hover/selection highlighting, where it operates on a small selection.

## Performance

Roughly, for a full village: ~50 draw calls, ~150k triangles.

- Baked chunks: 1–2 draw calls each, rebuilt only when their signature changes.
- Agents: one `InstancedMesh` per (kind, variant), around 30 calls.
- Dynamic point lights are capped (`MAX_LIT_LAMPS`); beyond the cap lamps keep
  their emissive bulb, which is what actually reads as "lit", and simply stop
  spilling light.

If frame rate becomes a problem, look at chunk rebake frequency and the shadow
pass before anything else. `?debug` gives you `__cozy.report()` with live draw
call and triangle counts.
