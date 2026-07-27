/**
 * The day cycle — sun position and the colour of everything that depends on it.
 *
 * ## Keeping the horizon seamless
 *
 * Four things must agree or you get a visible seam where the ground meets the
 * sky: the sky dome's horizon band, the fog colour, the hemisphere light's sky
 * colour, and the renderer clear colour. They are all derived here from one
 * time value so they cannot drift apart.
 *
 * The fog colour is deliberately **less saturated and slightly lighter** than
 * the sky horizon. Real aerial perspective loses chroma faster than luminance;
 * fog at the same saturation as the sky tints distant geometry blue and reads
 * as underwater rather than hazy.
 *
 * ## The value range
 *
 * Even at night nothing goes truly dark — the darkest ambient here is a deep
 * blue, not black. A cosy village at midnight should look like a moonlit
 * storybook page, not like a horror game.
 */

import { Color } from 'three'

export interface DayState {
  /** Sun/moon direction, already scaled to a useful distance. */
  sunPosition: [number, number, number]
  sunColor: string
  sunIntensity: number
  /** How dark cast shadows go. Softer at dawn and dusk. */
  shadowIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  /** Sky dome zenith and horizon. */
  skyTop: string
  skyHorizon: string
  fogColor: string
  fogDensity: number
  /** 0 at full day, 1 at full night — drives lamp glow. */
  nightAmount: number
}

/** Keyframes through the day, interpolated between. `t` is 0..1. */
interface Keyframe {
  t: number
  sunColor: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  skyTop: string
  skyHorizon: string
  fogColor: string
  night: number
}

/**
 * The palette through a day. Values follow the research-backed post-r155
 * lighting scale — a directional light around 2.5–3 and a hemisphere around
 * 1.5–2 is "bright midday", not the sub-1.0 numbers older tutorials use.
 */
const KEYFRAMES: Keyframe[] = [
  {
    t: 0.0, // deep night
    sunColor: '#8fa8d8',
    sunIntensity: 0.5,
    hemiSky: '#3f5a86',
    hemiGround: '#2c3a4a',
    hemiIntensity: 1.0,
    skyTop: '#1e2a4a',
    skyHorizon: '#4a5f88',
    fogColor: '#5a6d92',
    night: 1,
  },
  {
    t: 0.22, // dawn
    sunColor: '#ffc9a0',
    sunIntensity: 1.9,
    hemiSky: '#c9b0d8',
    hemiGround: '#7a7a68',
    hemiIntensity: 1.5,
    skyTop: '#6a8fc4',
    skyHorizon: '#f2c4b0',
    fogColor: '#ecd2c8',
    night: 0.35,
  },
  {
    t: 0.5, // noon
    sunColor: '#fff3dc',
    sunIntensity: 2.8,
    hemiSky: '#bfe9f5',
    hemiGround: '#8a9e6b',
    hemiIntensity: 1.7,
    skyTop: '#4fb3e8',
    skyHorizon: '#bfe9f5',
    fogColor: '#cde9f0',
    night: 0,
  },
  {
    t: 0.78, // golden hour
    sunColor: '#ffb877',
    sunIntensity: 2.3,
    hemiSky: '#e8c9b0',
    hemiGround: '#8a8060',
    hemiIntensity: 1.5,
    skyTop: '#6f9ed4',
    skyHorizon: '#f7cfa0',
    fogColor: '#f0dcc4',
    night: 0.2,
  },
  {
    t: 1.0, // wraps to deep night
    sunColor: '#8fa8d8',
    sunIntensity: 0.5,
    hemiSky: '#3f5a86',
    hemiGround: '#2c3a4a',
    hemiIntensity: 1.0,
    skyTop: '#1e2a4a',
    skyHorizon: '#4a5f88',
    fogColor: '#5a6d92',
    night: 1,
  },
]

const _a = new Color()
const _b = new Color()

function mixHex(from: string, to: string, amount: number): string {
  _a.set(from)
  _b.set(to)
  return `#${_a.lerp(_b, amount).getHexString()}`
}

/** Fog thickness, in the FogExp2 sense. */
const FOG_DENSITY = 0.0125

/** Distance the sun is placed at. Only its direction matters for shading. */
const SUN_DISTANCE = 70

/** Fraction of the day the sun spends above the horizon. */
const DAY_START = 0.2
const DAY_END = 0.8

/**
 * Elevation bounds, in degrees.
 *
 * These are the numbers that decide whether the village has readable shadows.
 * Elevation controls shadow *length*: a building of height `h` casts a shadow
 * `h / tan(elevation)` long. At 60° a 2.4-unit cottage casts 1.4 units — less
 * than one hex, so the shadow hides behind the building itself and the scene
 * reads flat. At 35° the same cottage casts 3.4 units, which is visible from
 * any camera angle and does the work of grounding the building.
 *
 * The floor is not lower because shadows long enough to leave the shadow
 * camera's frustum get clipped, and because a sun on the horizon turns
 * everything into silhouettes.
 */
const MIN_ELEVATION_DEG = 15
const MAX_ELEVATION_DEG = 58

/**
 * Azimuth of the sun at midday, in radians, measured from +X toward +Z.
 *
 * This is chosen for **shading, not astronomy**, and it is the single most
 * important number for whether the village looks three-dimensional.
 *
 * The default camera sits at `[26, 20, 26]`, an azimuth of 45°. Screen-right
 * for that camera is the world direction `(+X, −Z)`, i.e. azimuth −45°. Shadows
 * fall directly opposite the sun, so putting the sun at 135° throws every
 * shadow toward screen-right, where it is fully visible.
 *
 * Get this wrong and the failure is silent and very confusing: with the sun at
 * the camera's own azimuth, every shadow falls precisely *behind* the object
 * casting it and is hidden by it. Shadows render correctly, cost exactly as
 * much, and cannot be seen — the scene just looks inexplicably flat.
 */
const MIDDAY_AZIMUTH = Math.PI * 0.75

/**
 * Sun direction for a time of day.
 *
 * The sun sweeps a 180° arc centred on {@link MIDDAY_AZIMUTH}, with elevation
 * following a sine over the daylight hours. At night the same path continues,
 * but the light is dim and blue and treated as a moon — kept above the horizon
 * at a low angle so the village gets a soft rim rather than going black.
 */
function sunDirection(time: number): [number, number, number] {
  const isDay = time >= DAY_START && time <= DAY_END
  // Night runs from DAY_END round through 0 to DAY_START.
  const progress = isDay
    ? (time - DAY_START) / (DAY_END - DAY_START)
    : ((time > DAY_END ? time - DAY_END : time + 1 - DAY_END) / (1 + DAY_START - DAY_END))

  const elevationDeg = isDay
    ? MIN_ELEVATION_DEG + (MAX_ELEVATION_DEG - MIN_ELEVATION_DEG) * Math.sin(Math.PI * progress)
    : // The moon rides lower and flatter than the sun.
      MIN_ELEVATION_DEG + 18 * Math.sin(Math.PI * progress)

  const elevation = (elevationDeg * Math.PI) / 180
  // Sweep 180° centred on the midday azimuth, so sunrise and sunset sit at
  // right angles to it and shadows swing across the scene through the day.
  const azimuth = MIDDAY_AZIMUTH - Math.PI / 2 + Math.PI * progress

  const horizontal = Math.cos(elevation) * SUN_DISTANCE
  return [
    Math.cos(azimuth) * horizontal,
    Math.sin(elevation) * SUN_DISTANCE,
    Math.sin(azimuth) * horizontal,
  ]
}

/**
 * Resolve the lighting state for a time of day.
 *
 * `t` runs 0 → 1 over a full day, with 0.5 as noon.
 */
export function dayCycle(t: number): DayState {
  const time = ((t % 1) + 1) % 1

  let lower = KEYFRAMES[0]
  let upper = KEYFRAMES[KEYFRAMES.length - 1]
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (time >= KEYFRAMES[i].t && time <= KEYFRAMES[i + 1].t) {
      lower = KEYFRAMES[i]
      upper = KEYFRAMES[i + 1]
      break
    }
  }
  const span = upper.t - lower.t || 1
  const raw = (time - lower.t) / span
  // Smoothstep between keyframes so the sun never changes speed abruptly.
  const k = raw * raw * (3 - 2 * raw)

  const sunPosition = sunDirection(time)
  // Normalised height, used to soften shadows as the sun drops.
  const elevationFraction = sunPosition[1] / SUN_DISTANCE

  return {
    sunPosition,
    sunColor: mixHex(lower.sunColor, upper.sunColor, k),
    sunIntensity: lower.sunIntensity + (upper.sunIntensity - lower.sunIntensity) * k,
    // Shadows lift as the sun gets low, which keeps the long shadows of dawn
    // and dusk from turning the village into silhouettes.
    shadowIntensity: 0.6 + elevationFraction * 0.32,
    hemiSky: mixHex(lower.hemiSky, upper.hemiSky, k),
    hemiGround: mixHex(lower.hemiGround, upper.hemiGround, k),
    hemiIntensity: lower.hemiIntensity + (upper.hemiIntensity - lower.hemiIntensity) * k,
    skyTop: mixHex(lower.skyTop, upper.skyTop, k),
    skyHorizon: mixHex(lower.skyHorizon, upper.skyHorizon, k),
    fogColor: mixHex(lower.fogColor, upper.fogColor, k),
    fogDensity: FOG_DENSITY,
    nightAmount: lower.night + (upper.night - lower.night) * k,
  }
}

/** How long a full in-game day takes, in real seconds. */
export const DAY_LENGTH_SECONDS = 240
