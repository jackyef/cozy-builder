/**
 * Keyboard camera movement.
 *
 * WASD (and the arrow keys) glide the camera across the island. Holding shift
 * moves faster.
 *
 * ## How it moves
 *
 * Panning is **camera-relative and flattened to the ground plane**: W goes the
 * way the camera is facing, projected onto XZ, rather than along the camera's
 * actual forward vector. Using the raw forward vector would drive the camera
 * into the ground, since it is always looking downward at the village.
 *
 * Both `camera.position` and the orbit target move by the same amount, which
 * pans without changing the viewing angle or distance. Moving only one would
 * turn W into a slow orbit or a zoom.
 *
 * Speed scales with how far out the camera is, so a key press covers a
 * consistent fraction of what you can see rather than crawling when zoomed out
 * and rocketing when zoomed in.
 *
 * ## Why it doesn't use React state
 *
 * Key state lives in a ref and is applied inside `useFrame`. Holding a key
 * produces a continuous glide with no re-renders; routing it through React
 * state would re-render the whole scene sixty times a second while moving.
 */

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'

/** World units per second at a reference camera distance. */
const BASE_SPEED = 0.55

/** Multiplier while shift is held. */
const SPRINT = 2.6

/** How far the orbit target may stray from the origin. */
const MAX_DISTANCE_FROM_ORIGIN = 70

/** Seconds to reach full speed, so starting and stopping is not a jolt. */
const RAMP = 0.12

const KEY_BINDINGS: Record<string, 'forward' | 'back' | 'left' | 'right'> = {
  keyw: 'forward',
  arrowup: 'forward',
  keys: 'back',
  arrowdown: 'back',
  keya: 'left',
  arrowleft: 'left',
  keyd: 'right',
  arrowright: 'right',
}

interface OrbitLike {
  target: Vector3
  update?: () => void
}

const _forward = new Vector3()
const _right = new Vector3()
const _move = new Vector3()

export function KeyboardCamera(): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null

  const held = useRef(new Set<string>())
  const sprinting = useRef(false)
  const velocity = useRef({ x: 0, z: 0 })

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el || !el.tagName) return false
      return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Never steal keys from the village-name field, and leave shortcuts like
      // ctrl+A alone.
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Shift') sprinting.current = true
      const binding = KEY_BINDINGS[event.code.toLowerCase()]
      if (!binding) return
      // Arrow keys scroll the page otherwise.
      event.preventDefault()
      held.current.add(binding)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') sprinting.current = false
      const binding = KEY_BINDINGS[event.code.toLowerCase()]
      if (binding) held.current.delete(binding)
    }

    // Losing focus mid-press would otherwise leave the camera gliding forever.
    const release = (): void => {
      held.current.clear()
      sprinting.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
    }
  }, [])

  useFrame((_state, rawDelta) => {
    const target = controls?.target
    if (!target) return

    const delta = Math.min(rawDelta, 1 / 20)
    const keys = held.current

    // Desired direction in camera-relative ground space.
    let inputX = 0
    let inputZ = 0
    if (keys.has('forward')) inputZ += 1
    if (keys.has('back')) inputZ -= 1
    if (keys.has('right')) inputX += 1
    if (keys.has('left')) inputX -= 1

    const moving = inputX !== 0 || inputZ !== 0

    if (moving) {
      // Camera forward, flattened onto the ground plane.
      camera.getWorldDirection(_forward)
      _forward.y = 0
      if (_forward.lengthSq() < 1e-8) return // looking straight down
      _forward.normalize()
      _right.set(-_forward.z, 0, _forward.x)

      // Distance-proportional speed: a press should cover a similar share of
      // the screen whether zoomed in on a cottage or out over the whole island.
      const distance = camera.position.distanceTo(target)
      const speed = BASE_SPEED * distance * (sprinting.current ? SPRINT : 1)

      _move.set(0, 0, 0)
      _move.addScaledVector(_forward, inputZ)
      _move.addScaledVector(_right, inputX)
      // Normalise so diagonals are not faster than the axes.
      if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(speed)

      velocity.current.x += (_move.x - velocity.current.x) * Math.min(1, delta / RAMP)
      velocity.current.z += (_move.z - velocity.current.z) * Math.min(1, delta / RAMP)
    } else {
      // Coast to a stop rather than halting dead.
      const decay = Math.min(1, delta / RAMP)
      velocity.current.x -= velocity.current.x * decay
      velocity.current.z -= velocity.current.z * decay
    }

    const dx = velocity.current.x * delta
    const dz = velocity.current.z * delta
    if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return

    // Keep the island reachable but stop the camera drifting into empty space.
    const nextX = target.x + dx
    const nextZ = target.z + dz
    if (Math.hypot(nextX, nextZ) > MAX_DISTANCE_FROM_ORIGIN) {
      velocity.current.x = 0
      velocity.current.z = 0
      return
    }

    // Move the eye and what it is looking at together: that is a pan. Moving
    // only the target would orbit; only the position would dolly.
    target.x = nextX
    target.z = nextZ
    camera.position.x += dx
    camera.position.z += dz
    controls?.update?.()
  })

  return null
}
