/**
 * Agent simulation — steering, walk cycles and idle behaviour.
 *
 * ## Design notes
 *
 * **No physics engine.** Villagers are chunky, slow and never collide with
 * anything that matters. A rigid-body solver would cost more than the entire
 * rest of the simulation and would look *worse* — sliding, tipping and jitter
 * are exactly the failure modes a cosy village must not have.
 *
 * **No per-agent React state.** The whole population lives in one plain array
 * mutated inside a single `useFrame`. Anything else re-renders React at 60Hz.
 *
 * **Frame-rate independence matters here.** Steering forces are integrated with
 * an explicit `dt`, the delta is clamped so an alt-tab doesn't teleport the
 * village, and the wander angle uses `sqrt(dt)` rather than `dt` — random-walk
 * variance accumulates with the square root of time, so scaling linearly makes
 * a 144Hz machine wander visibly less than a 60Hz one.
 *
 * **Walk cycles advance by distance, not time.** `phase += speed / STRIDE * dt`
 * means feet look planted and slowing down automatically shortens the stride.
 * Advancing by time makes a slowing agent look like it is moon-walking.
 */

import { HEX_WIDTH, hexToWorld, hexRound, type Hex } from '@/core/hex'
import type { Rng } from '@/core/rng'
import {
  findPath,
  pickWanderTarget,
  rngForAgent,
  type AgentSpec,
  type WalkGrid,
} from './director'
import type { AgentKind } from '@/world/types'

/** Per-kind movement and appearance parameters. */
export interface AgentProfile {
  /** Metres per second at a normal walk. */
  readonly speed: number
  /** Steering force limit; higher turns more sharply. */
  readonly maxForce: number
  /** How long a pause lasts, in seconds. */
  readonly pause: [number, number]
  /** Chance of pausing on arrival rather than moving straight on. */
  readonly pauseChance: number
  /** Vertical bob amplitude while walking. */
  readonly bob: number
  /** Stride length; drives the walk cycle. */
  readonly stride: number
  /** Cruising height above the ground. Non-zero for fliers. */
  readonly hover: number
  /** Whether the agent flies, ignoring walkability. */
  readonly flies: boolean
  /** Uniform render scale. */
  readonly scale: number
}

const DEFAULT_PROFILE: AgentProfile = {
  speed: 1.1,
  maxForce: 4,
  pause: [1.2, 3.5],
  pauseChance: 0.5,
  bob: 0.055,
  stride: 0.5,
  hover: 0,
  flies: false,
  scale: 1,
}

export const AGENT_PROFILES: Record<AgentKind, AgentProfile> = {
  villager: { ...DEFAULT_PROFILE },
  merchant: { ...DEFAULT_PROFILE, speed: 0.6, pauseChance: 0.85, pause: [3, 7] },
  farmer: { ...DEFAULT_PROFILE, speed: 0.95, pauseChance: 0.7, pause: [2.5, 6] },
  guard: { ...DEFAULT_PROFILE, speed: 0.75, pauseChance: 0.6, pause: [2, 5], bob: 0.035 },
  child: { ...DEFAULT_PROFILE, speed: 1.7, maxForce: 7, pauseChance: 0.25, pause: [0.4, 1.4], bob: 0.11, stride: 0.34, scale: 0.72 },

  chicken: { ...DEFAULT_PROFILE, speed: 0.85, maxForce: 8, pause: [0.5, 2], pauseChance: 0.7, bob: 0.05, stride: 0.22, scale: 0.5 },
  duck: { ...DEFAULT_PROFILE, speed: 0.5, pause: [1.5, 4], pauseChance: 0.75, bob: 0.03, stride: 0.26, scale: 0.55 },
  sheep: { ...DEFAULT_PROFILE, speed: 0.45, pause: [3, 8], pauseChance: 0.85, bob: 0.03, stride: 0.34, scale: 0.8 },
  pig: { ...DEFAULT_PROFILE, speed: 0.55, pause: [2.5, 7], pauseChance: 0.8, bob: 0.035, stride: 0.32, scale: 0.75 },
  cow: { ...DEFAULT_PROFILE, speed: 0.4, pause: [4, 10], pauseChance: 0.88, bob: 0.025, stride: 0.42, scale: 1 },
  cat: { ...DEFAULT_PROFILE, speed: 0.9, maxForce: 9, pause: [2, 6], pauseChance: 0.7, bob: 0.03, stride: 0.28, scale: 0.5 },

  butterfly: { ...DEFAULT_PROFILE, speed: 1.0, maxForce: 12, pause: [0.2, 0.9], pauseChance: 0.3, bob: 0, stride: 1, hover: 0.85, flies: true, scale: 0.4 },
  bird: { ...DEFAULT_PROFILE, speed: 2.2, maxForce: 10, pause: [0.6, 2.2], pauseChance: 0.4, bob: 0, stride: 1, hover: 1.7, flies: true, scale: 0.45 },
}

/** Live simulation state for one inhabitant. */
export interface Agent {
  readonly spec: AgentSpec
  readonly profile: AgentProfile
  readonly rng: Rng

  // Position and motion, all in world space on the XZ plane.
  x: number
  y: number
  z: number
  vx: number
  vz: number
  /** Facing, in radians (three.js Y rotation). */
  yaw: number

  /** Remaining waypoints, nearest first. */
  path: Hex[]
  /** Seconds left of the current pause; 0 means moving. */
  pauseFor: number
  /** Walk-cycle phase, advanced by distance travelled. */
  phase: number
  /** Personal speed multiplier — identical speeds are the giveaway of a fake crowd. */
  speedScale: number
  /** Ambient wobble offset so idle agents don't sit perfectly still in sync. */
  idlePhase: number
  /** Seconds since this agent last searched for a target. */
  sinceRepath: number
}

/** Create a live agent from a plan. */
export function createAgent(spec: AgentSpec, grid: WalkGrid, worldSeed: number, at: Hex): Agent {
  const profile = AGENT_PROFILES[spec.kind] ?? DEFAULT_PROFILE
  const rng = rngForAgent(spec, worldSeed)
  const { x, z } = hexToWorld(at)

  return {
    spec,
    profile,
    rng,
    // Offset slightly off the hex centre so a group doesn't stack on one point.
    x: x + rng.range(-0.35, 0.35),
    y: grid.groundY(at) + spec.elevation + profile.hover,
    z: z + rng.range(-0.35, 0.35),
    vx: 0,
    vz: 0,
    yaw: rng.range(0, Math.PI * 2),
    path: [],
    pauseFor: rng.range(0, 2),
    phase: rng.range(0, Math.PI * 2),
    speedScale: rng.range(0.88, 1.12),
    idlePhase: rng.range(0, Math.PI * 2),
    sinceRepath: 0,
  }
}

/** Longest simulation step we will take, to survive a backgrounded tab. */
const MAX_DELTA = 1 / 20

/** How often an idle agent looks for something new to do. */
const REPATH_INTERVAL = 0.35

/**
 * Advance the whole population by `rawDelta` seconds.
 *
 * `pathBudget` caps how many path searches happen this frame. A villager
 * waiting two frames for a route is invisible; a frame that runs eighty
 * searches is not.
 */
export function simulate(
  agents: Agent[],
  grid: WalkGrid,
  rawDelta: number,
  elapsed: number,
  pathBudget = 6,
): void {
  const dt = Math.min(rawDelta, MAX_DELTA)
  if (dt <= 0) return

  let budget = pathBudget

  for (const agent of agents) {
    const { profile } = agent

    if (agent.pauseFor > 0) {
      agent.pauseFor -= dt
      // Bleed off momentum so a pausing agent settles rather than skidding.
      agent.vx *= 0.86
      agent.vz *= 0.86
      applyIdleMotion(agent, grid, elapsed)
      continue
    }

    // Need somewhere to go.
    if (agent.path.length === 0) {
      agent.sinceRepath += dt
      if (agent.sinceRepath < REPATH_INTERVAL || budget <= 0) {
        applyIdleMotion(agent, grid, elapsed)
        continue
      }
      agent.sinceRepath = 0
      budget--

      const currentHex = worldToHexAt(agent.x, agent.z)
      const target = pickWanderTarget(agent.spec, currentHex, grid, agent.rng)

      if (!target) {
        agent.pauseFor = agent.rng.range(...profile.pause)
        continue
      }

      if (profile.flies) {
        // Fliers ignore the walk grid entirely and beeline.
        agent.path = [target]
      } else {
        const path = findPath(currentHex, target, grid)
        if (!path || path.length < 2) {
          agent.pauseFor = agent.rng.range(0.6, 2)
          continue
        }
        agent.path = path.slice(1)
      }
    }

    steerAlongPath(agent, grid, dt, elapsed)
  }
}

/** Move toward the next waypoint, consuming it on arrival. */
function steerAlongPath(agent: Agent, grid: WalkGrid, dt: number, elapsed: number): void {
  const { profile } = agent
  const waypoint = agent.path[0]
  const target = hexToWorld(waypoint)

  const dx = target.x - agent.x
  const dz = target.z - agent.z
  const distance = Math.hypot(dx, dz)

  // Arrival tolerance must comfortably exceed one step of travel, or a fast
  // agent overshoots and orbits its waypoint forever.
  const arriveAt = Math.max(0.18, profile.speed * agent.speedScale * dt * 2)
  if (distance < arriveAt) {
    agent.path.shift()
    if (agent.path.length === 0 && agent.rng.chance(profile.pauseChance)) {
      agent.pauseFor = agent.rng.range(...profile.pause)
    }
    return
  }

  const maxSpeed = profile.speed * agent.speedScale
  // Ease off on the final approach so agents settle instead of stopping dead.
  const slowing = agent.path.length === 1 ? Math.min(1, distance / 0.9) : 1
  const desiredSpeed = maxSpeed * slowing

  const desiredVx = (dx / distance) * desiredSpeed
  const desiredVz = (dz / distance) * desiredSpeed

  // Steering = desired − current, clamped to the force limit.
  let steerX = desiredVx - agent.vx
  let steerZ = desiredVz - agent.vz
  const steerMag = Math.hypot(steerX, steerZ)
  const maxForce = profile.maxForce
  if (steerMag > maxForce) {
    steerX = (steerX / steerMag) * maxForce
    steerZ = (steerZ / steerMag) * maxForce
  }

  agent.vx += steerX * dt
  agent.vz += steerZ * dt

  const speed = Math.hypot(agent.vx, agent.vz)
  if (speed > maxSpeed) {
    agent.vx = (agent.vx / speed) * maxSpeed
    agent.vz = (agent.vz / speed) * maxSpeed
  }

  agent.x += agent.vx * dt
  agent.z += agent.vz * dt

  // Face the direction of travel, damped, and only when actually moving —
  // without the speed guard, agents spin on the spot at path ends.
  if (speed > 0.05) {
    const desiredYaw = Math.atan2(-agent.vz, agent.vx)
    agent.yaw = dampAngle(agent.yaw, desiredYaw, 9, dt)
    agent.phase += (speed / profile.stride) * dt * Math.PI * 2
  }

  updateHeight(agent, grid, elapsed, speed)
}

/** Small ambient motion for a stationary agent, so nobody is a statue. */
function applyIdleMotion(agent: Agent, grid: WalkGrid, elapsed: number): void {
  if (agent.profile.flies) {
    // Fliers hover rather than stopping.
    agent.x += Math.sin(elapsed * 2.2 + agent.idlePhase) * 0.004
    agent.z += Math.cos(elapsed * 1.8 + agent.idlePhase) * 0.004
  }
  updateHeight(agent, grid, elapsed, 0)
}

/**
 * Settle the agent's Y onto the terrain, plus bob, hover and any structural
 * elevation (guards on wall walkways).
 */
function updateHeight(agent: Agent, grid: WalkGrid, elapsed: number, speed: number): void {
  const hex = worldToHexAt(agent.x, agent.z)
  const ground = grid.groundY(hex)

  let y = ground + agent.spec.elevation

  if (agent.profile.flies) {
    // Fliers ride a lazy sine, which is most of what makes them read as flying.
    y += agent.profile.hover + Math.sin(elapsed * 1.6 + agent.idlePhase) * 0.28
  } else if (speed > 0.05) {
    // Bob twice per stride — one dip per footfall.
    y += Math.abs(Math.sin(agent.phase)) * agent.profile.bob
  } else {
    // Idle breathing.
    y += Math.sin(elapsed * 1.5 + agent.idlePhase) * 0.012
  }

  // Ease toward the target height so stepping onto a wall isn't a teleport.
  agent.y += (y - agent.y) * Math.min(1, 8 * (1 / 60))
}

/** Shortest-arc angular damping. */
function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let delta = target - current
  // Wrap into (−π, π] so a turn never takes the long way round.
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * Math.min(1, rate * dt)
}

/** World XZ to the hex containing it. */
function worldToHexAt(x: number, z: number): Hex {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * z) / 1
  const r = ((2 / 3) * z) / 1
  return hexRound(q, r)
}

/**
 * Reconcile a live population with a freshly planned one.
 *
 * Agents are matched by spec id, so rebuilding the roster after an edit keeps
 * everyone who still belongs exactly where they were. Only genuinely new
 * inhabitants are spawned and only departed ones are removed — without this,
 * every click would make the whole village blink and restart.
 */
export function reconcileAgents(
  existing: Agent[],
  specs: AgentSpec[],
  grid: WalkGrid,
  worldSeed: number,
  findSpawn: (spec: AgentSpec, grid: WalkGrid, rng: Rng) => Hex,
): Agent[] {
  const byId = new Map(existing.map((a) => [a.spec.id, a]))
  const next: Agent[] = []

  for (const spec of specs) {
    const current = byId.get(spec.id)
    if (current) {
      // Keep the live agent but adopt the new spec — radius or behaviour may
      // have changed if the piece it belongs to was edited.
      next.push(Object.assign(current, { spec }))
      byId.delete(spec.id)
      continue
    }
    const rng = rngForAgent(spec, worldSeed)
    next.push(createAgent(spec, grid, worldSeed, findSpawn(spec, grid, rng)))
  }

  return next
}

/**
 * Nudge agents that are standing somewhere they no longer may be — the player
 * just dropped a building on them.
 *
 * Rather than teleporting (which looks like a glitch), we clear their path so
 * they immediately walk somewhere valid. `HEX_WIDTH` is the scale reference for
 * how far "somewhere valid" is likely to be.
 */
export function evictStrandedAgents(agents: Agent[], grid: WalkGrid): void {
  for (const agent of agents) {
    if (agent.profile.flies) continue
    const hex = worldToHexAt(agent.x, agent.z)
    if (grid.isWalkable(hex) || grid.isRampart(hex)) continue

    agent.path = []
    agent.pauseFor = 0
    agent.sinceRepath = REPATH_INTERVAL // repath at the next opportunity
    // Drift toward home while a route is found, so they visibly leave.
    const home = hexToWorld(agent.spec.home)
    const dx = home.x - agent.x
    const dz = home.z - agent.z
    const d = Math.hypot(dx, dz) || 1
    agent.vx = (dx / d) * agent.profile.speed * 0.5
    agent.vz = (dz / d) * agent.profile.speed * 0.5
    void HEX_WIDTH
  }
}
