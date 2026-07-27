/**
 * Day-cycle continuity tests.
 *
 * The day cycle is sampled every frame while the clock runs, so any
 * discontinuity in it becomes a visible pop. These are hard bugs to attribute
 * from the symptom: a jump in the sun's *direction* looks like the whole scene
 * lurching sideways (every shadow flips at once), and a jump in a *colour*
 * looks like a rendering glitch. Neither points at the clock.
 *
 * The original bug this file was written for: day and night reused the same
 * azimuth range, so the light snapped 180° at dawn and dusk, roughly twice per
 * in-game day. Elevation was continuous across the boundary, which is why the
 * sun itself looked fine.
 *
 * Rather than testing the two known boundaries, these scan the entire cycle —
 * including the wrap from 1 back to 0 — so a discontinuity introduced anywhere
 * is caught.
 */

import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { dayCycle } from './lighting'

/** Samples per day. Fine enough that a real pop dwarfs the per-step rate. */
const SAMPLES = 2000

/** Every sample point, including the wrap back to the start. */
function cycle(): { t: number; state: ReturnType<typeof dayCycle> }[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES
    return { t, state: dayCycle(t) }
  })
}

/** Compass bearing of the light, in degrees. */
function azimuth(position: readonly [number, number, number]): number {
  return (Math.atan2(position[2], position[0]) * 180) / Math.PI
}

/** Height above the horizon, in degrees. */
function elevation(position: readonly [number, number, number]): number {
  return (Math.atan2(position[1], Math.hypot(position[0], position[2])) * 180) / Math.PI
}

/** Smallest angular difference, accounting for the 360° wrap. */
function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Largest per-channel difference between two colours, 0..1. */
function colorDelta(a: string, b: string): number {
  const ca = new Color(a)
  const cb = new Color(b)
  return Math.max(Math.abs(ca.r - cb.r), Math.abs(ca.g - cb.g), Math.abs(ca.b - cb.b))
}

/**
 * Walk consecutive samples and report the largest step, wrapping at the end of
 * the day so `t = 1` is compared against `t = 0`.
 */
function largestStep(measure: (state: ReturnType<typeof dayCycle>) => number, diff = (a: number, b: number) => Math.abs(a - b)): { step: number; at: number } {
  const samples = cycle()
  let step = 0
  let at = 0
  for (let i = 0; i < samples.length - 1; i++) {
    const d = diff(measure(samples[i].state), measure(samples[i + 1].state))
    if (d > step) {
      step = d
      at = samples[i].t
    }
  }
  return { step, at }
}

describe('the light moves continuously', () => {
  it('never jumps in direction', () => {
    // The bug: 179.92 degrees in a single frame, at dawn and at dusk.
    const { step, at } = largestStep((s) => azimuth(s.sunPosition), angularDelta)
    expect(step, `azimuth jumped ${step.toFixed(2)} degrees at t=${at.toFixed(4)}`).toBeLessThan(2)
  })

  it('never jumps in elevation', () => {
    const { step, at } = largestStep((s) => elevation(s.sunPosition))
    expect(step, `elevation jumped ${step.toFixed(2)} degrees at t=${at.toFixed(4)}`).toBeLessThan(2)
  })

  it('joins up across the midnight wrap', () => {
    // `timeOfDay` wraps with `% 1`, so the two ends of the cycle are adjacent
    // frames in practice and have to agree.
    const end = dayCycle(0.9999)
    const start = dayCycle(0)
    expect(angularDelta(azimuth(end.sunPosition), azimuth(start.sunPosition))).toBeLessThan(2)
    expect(Math.abs(elevation(end.sunPosition) - elevation(start.sunPosition))).toBeLessThan(2)
  })

  it('circles the sky exactly once per day', () => {
    // Confirms the two halves compose into one full revolution rather than
    // retracing the same arc twice, which is what the bug amounted to.
    const samples = cycle()
    let turned = 0
    for (let i = 0; i < samples.length - 1; i++) {
      const a = (azimuth(samples[i].state.sunPosition) * Math.PI) / 180
      const b = (azimuth(samples[i + 1].state.sunPosition) * Math.PI) / 180
      // Signed shortest turn between consecutive samples.
      turned += Math.atan2(Math.sin(b - a), Math.cos(b - a))
    }
    expect(Math.abs((turned * 180) / Math.PI)).toBeCloseTo(360, 0)
  })

  it('stays above the horizon', () => {
    // A light at or below the horizon casts shadows the length of the island
    // and clips out of the shadow camera's frustum.
    for (const { t, state } of cycle()) {
      expect(elevation(state.sunPosition), `sun dipped at t=${t}`).toBeGreaterThan(5)
    }
  })
})

describe('the palette moves continuously', () => {
  const channels: [string, (s: ReturnType<typeof dayCycle>) => string][] = [
    ['sunColor', (s) => s.sunColor],
    ['hemiSky', (s) => s.hemiSky],
    ['hemiGround', (s) => s.hemiGround],
    ['skyTop', (s) => s.skyTop],
    ['skyHorizon', (s) => s.skyHorizon],
    ['fogColor', (s) => s.fogColor],
  ]

  for (const [name, read] of channels) {
    it(`never jumps in ${name}`, () => {
      const samples = cycle()
      let worst = 0
      let at = 0
      for (let i = 0; i < samples.length - 1; i++) {
        const d = colorDelta(read(samples[i].state), read(samples[i + 1].state))
        if (d > worst) {
          worst = d
          at = samples[i].t
        }
      }
      expect(worst, `${name} jumped ${worst.toFixed(3)} at t=${at.toFixed(4)}`).toBeLessThan(0.05)
    })
  }

  it('never jumps in intensity', () => {
    expect(largestStep((s) => s.sunIntensity).step).toBeLessThan(0.05)
    expect(largestStep((s) => s.hemiIntensity).step).toBeLessThan(0.05)
    expect(largestStep((s) => s.shadowIntensity).step).toBeLessThan(0.05)
    expect(largestStep((s) => s.nightAmount).step).toBeLessThan(0.05)
  })

  it('keeps everything in a sane range all day', () => {
    for (const { t, state } of cycle()) {
      expect(state.sunIntensity, `at t=${t}`).toBeGreaterThan(0)
      expect(state.hemiIntensity, `at t=${t}`).toBeGreaterThan(0)
      expect(state.nightAmount, `at t=${t}`).toBeGreaterThanOrEqual(0)
      expect(state.nightAmount, `at t=${t}`).toBeLessThanOrEqual(1)
      expect(state.shadowIntensity, `at t=${t}`).toBeGreaterThan(0)
      expect(state.shadowIntensity, `at t=${t}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('time input handling', () => {
  it('accepts values outside 0..1 by wrapping', () => {
    // The clock advances with `% 1`, but nothing stops a caller passing 1.5 or
    // a small negative from a slider rounding down.
    expect(dayCycle(1.25).sunPosition).toEqual(dayCycle(0.25).sunPosition)
    expect(dayCycle(-0.25).sunPosition).toEqual(dayCycle(0.75).sunPosition)
    expect(dayCycle(3).sunPosition).toEqual(dayCycle(0).sunPosition)
  })

  it('is a pure function of time', () => {
    expect(dayCycle(0.42)).toEqual(dayCycle(0.42))
  })
})
