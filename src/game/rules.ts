import {
  ARENA_HALF_D,
  ARENA_HALF_W,
  BASE_POSITIONS,
  FLAG_AUTO_RETURN_TIME,
  FLAG_CAPTURE_RADIUS,
  FLAG_PICKUP_RADIUS,
  POWERUP_META,
  POWERUP_PICKUP_RADIUS,
  POWERUP_SPAWN_POINTS,
  SCORE_LIMIT,
} from './arenaData.ts';
import type {
  ActorState,
  ArenaObstacle,
  FlagState,
  PowerupDropState,
  PowerupKind,
  TeamId,
  Vec2,
} from './types.ts';

export function oppositeTeam(team: TeamId): TeamId {
  return team === 'cobalt' ? 'crimson' : 'cobalt';
}

export function distSq2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist2D(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Resolves a circle (actor) against arena boundaries and all rectangular obstacles,
 * returning a smoothly slid position outside every AABB.
 */
export function resolveArenaCollision(
  pos: Vec2,
  radius: number,
  obstacles: ArenaObstacle[],
): Vec2 {
  let x = Math.max(-ARENA_HALF_W + radius + 0.4, Math.min(ARENA_HALF_W - radius - 0.4, pos.x));
  let z = Math.max(-ARENA_HALF_D + radius + 0.4, Math.min(ARENA_HALF_D - radius - 0.4, pos.z));

  // Two passes resolve corner-to-corner overlaps cleanly
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      const halfW = ob.width * 0.5;
      const halfD = ob.depth * 0.5;
      const minX = ob.x - halfW;
      const maxX = ob.x + halfW;
      const minZ = ob.z - halfD;
      const maxZ = ob.z + halfD;

      const closestX = Math.max(minX, Math.min(x, maxX));
      const closestZ = Math.max(minZ, Math.min(z, maxZ));
      const dx = x - closestX;
      const dz = z - closestZ;
      const dSq = dx * dx + dz * dz;

      if (dSq < radius * radius) {
        if (dSq > 1e-6) {
          const d = Math.sqrt(dSq);
          const overlap = radius - d;
          x += (dx / d) * overlap;
          z += (dz / d) * overlap;
        } else {
          // Inside AABB: push out along shallowest axis
          const penLeft = Math.abs(x - minX);
          const penRight = Math.abs(maxX - x);
          const penTop = Math.abs(z - minZ);
          const penBottom = Math.abs(maxZ - z);
          const minPen = Math.min(penLeft, penRight, penTop, penBottom);
          if (minPen === penLeft) x = minX - radius;
          else if (minPen === penRight) x = maxX + radius;
          else if (minPen === penTop) z = minZ - radius;
          else z = maxZ + radius;
        }
      }
    }
  }

  return {
    x: Math.max(-ARENA_HALF_W + radius + 0.4, Math.min(ARENA_HALF_W - radius - 0.4, x)),
    z: Math.max(-ARENA_HALF_D + radius + 0.4, Math.min(ARENA_HALF_D - radius - 0.4, z)),
  };
}

/**
 * Checks whether a point (e.g., paintball projectile) hits any blocking obstacle.
 * Returns the obstacle hit or null.
 */
export function pointHitsObstacle(
  x: number,
  z: number,
  radius: number,
  obstacles: ArenaObstacle[],
): ArenaObstacle | null {
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    if (!ob.blocksProjectiles) continue;
    const halfW = ob.width * 0.5 + radius;
    const halfD = ob.depth * 0.5 + radius;
    if (
      x >= ob.x - halfW &&
      x <= ob.x + halfW &&
      z >= ob.z - halfD &&
      z <= ob.z + halfD
    ) {
      return ob;
    }
  }
  return null;
}

/**
 * Segment vs AABB intersection test for clean AI line-of-sight checks.
 */
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  obstacles: ArenaObstacle[],
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    if (!ob.blocksProjectiles) continue;
    const minX = ob.x - ob.width * 0.5;
    const maxX = ob.x + ob.width * 0.5;
    const minZ = ob.z - ob.depth * 0.5;
    const maxZ = ob.z + ob.depth * 0.5;

    let tmin = 0;
    let tmax = 1;

    if (Math.abs(dx) < 1e-6) {
      if (from.x < minX || from.x > maxX) continue;
    } else {
      const invD = 1 / dx;
      let t1 = (minX - from.x) * invD;
      let t2 = (maxX - from.x) * invD;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    if (Math.abs(dz) < 1e-6) {
      if (from.z < minZ || from.z > maxZ) continue;
    } else {
      const invD = 1 / dz;
      let t1 = (minZ - from.z) * invD;
      let t2 = (maxZ - from.z) * invD;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    if (tmin <= tmax && tmax >= 0 && tmin <= 1) {
      return false;
    }
  }
  return true;
}

export interface FlagEvent {
  type: 'pickup' | 'return' | 'auto_return' | 'capture' | 'drop';
  flagTeam: TeamId;
  actorId?: string;
  actorTeam?: TeamId;
  pos: Vec2;
}

export function createInitialFlags(): Record<TeamId, FlagState> {
  return {
    cobalt: {
      team: 'cobalt',
      status: 'home',
      homePos: { ...BASE_POSITIONS.cobalt },
      pos: { ...BASE_POSITIONS.cobalt },
      carrierId: null,
      droppedTimer: 0,
    },
    crimson: {
      team: 'crimson',
      status: 'home',
      homePos: { ...BASE_POSITIONS.crimson },
      pos: { ...BASE_POSITIONS.crimson },
      carrierId: null,
      droppedTimer: 0,
    },
  };
}

/**
 * Drops any flag held by the tagged-out actor at their last position.
 */
export function dropFlagForActor(
  actor: ActorState,
  flags: Record<TeamId, FlagState>,
): FlagEvent | null {
  const enemyTeam = oppositeTeam(actor.team);
  const flag = flags[enemyTeam];
  if (flag.status === 'carried' && flag.carrierId === actor.id) {
    flag.status = 'dropped';
    flag.carrierId = null;
    flag.pos = { x: actor.pos.x, z: actor.pos.z };
    flag.droppedTimer = FLAG_AUTO_RETURN_TIME;
    return {
      type: 'drop',
      flagTeam: enemyTeam,
      actorId: actor.id,
      actorTeam: actor.team,
      pos: { ...flag.pos },
    };
  }
  return null;
}

/**
 * Updates flag positions, pickups, friendly returns, auto-returns, and captures.
 * Pure deterministic rule evaluator.
 */
export function stepFlagRules(
  dt: number,
  actors: ActorState[],
  flags: Record<TeamId, FlagState>,
  scores: Record<TeamId, number>,
): FlagEvent[] {
  const events: FlagEvent[] = [];
  const teams: TeamId[] = ['cobalt', 'crimson'];

  // 1. Update carried flag positions & dropped auto-return timers
  for (const team of teams) {
    const flag = flags[team];
    if (flag.status === 'carried' && flag.carrierId) {
      const carrier = actors.find((a) => a.id === flag.carrierId);
      if (!carrier || !carrier.alive) {
        flag.status = 'dropped';
        flag.carrierId = null;
        flag.droppedTimer = FLAG_AUTO_RETURN_TIME;
        events.push({
          type: 'drop',
          flagTeam: team,
          pos: { ...flag.pos },
        });
      } else {
        flag.pos.x = carrier.pos.x;
        flag.pos.z = carrier.pos.z;
      }
    } else if (flag.status === 'dropped') {
      flag.droppedTimer -= dt;
      if (flag.droppedTimer <= 0) {
        flag.status = 'home';
        flag.pos = { ...flag.homePos };
        flag.droppedTimer = 0;
        events.push({
          type: 'auto_return',
          flagTeam: team,
          pos: { ...flag.homePos },
        });
      }
    }
  }

  // 2. Check actor interactions with flags
  for (const actor of actors) {
    if (!actor.alive) continue;

    const ownFlag = flags[actor.team];
    const enemyTeam = oppositeTeam(actor.team);
    const enemyFlag = flags[enemyTeam];

    // Touch dropped own flag -> instant return to base
    if (
      ownFlag.status === 'dropped' &&
      distSq2D(actor.pos, ownFlag.pos) <= FLAG_PICKUP_RADIUS * FLAG_PICKUP_RADIUS
    ) {
      ownFlag.status = 'home';
      ownFlag.pos = { ...ownFlag.homePos };
      ownFlag.droppedTimer = 0;
      actor.returns += 1;
      events.push({
        type: 'return',
        flagTeam: actor.team,
        actorId: actor.id,
        actorTeam: actor.team,
        pos: { ...ownFlag.homePos },
      });
    }

    // Touch enemy flag (home or dropped) -> pick up!
    if (
      enemyFlag.status !== 'carried' &&
      distSq2D(actor.pos, enemyFlag.pos) <= FLAG_PICKUP_RADIUS * FLAG_PICKUP_RADIUS
    ) {
      enemyFlag.status = 'carried';
      enemyFlag.carrierId = actor.id;
      enemyFlag.droppedTimer = 0;
      enemyFlag.pos = { x: actor.pos.x, z: actor.pos.z };
      events.push({
        type: 'pickup',
        flagTeam: enemyTeam,
        actorId: actor.id,
        actorTeam: actor.team,
        pos: { ...actor.pos },
      });
    }

    // Carrying enemy flag back to home base while own flag is home -> CAPTURE!
    if (
      enemyFlag.status === 'carried' &&
      enemyFlag.carrierId === actor.id &&
      ownFlag.status === 'home' &&
      distSq2D(actor.pos, ownFlag.homePos) <= FLAG_CAPTURE_RADIUS * FLAG_CAPTURE_RADIUS
    ) {
      scores[actor.team] += 1;
      actor.captures += 1;
      enemyFlag.status = 'home';
      enemyFlag.carrierId = null;
      enemyFlag.pos = { ...enemyFlag.homePos };
      enemyFlag.droppedTimer = 0;
      events.push({
        type: 'capture',
        flagTeam: enemyTeam,
        actorId: actor.id,
        actorTeam: actor.team,
        pos: { ...ownFlag.homePos },
      });
    }
  }

  return events;
}

/**
 * Evaluates whether the match has concluded by score limit or timer expiration.
 */
export function evaluateMatchWinner(
  scores: Record<TeamId, number>,
  timeRemaining: number,
  scoreLimit: number = SCORE_LIMIT,
): TeamId | 'draw' | null {
  if (scores.cobalt >= scoreLimit) return 'cobalt';
  if (scores.crimson >= scoreLimit) return 'crimson';
  if (timeRemaining <= 0) {
    if (scores.cobalt > scores.crimson) return 'cobalt';
    if (scores.crimson > scores.cobalt) return 'crimson';
    return 'draw';
  }
  return null;
}

/**
 * Pure tactical target selector implementing 3 genuinely distinct NPC role policies:
 * - striker: flanks along outer corridors to steal enemy flag, or sprints home when carrying
 * - heavy: pushes midfield control & escorts friendly flag carrier or suppresses enemy carrier
 * - defender: guards own flag base, intercepts enemy flag carrier, returns dropped own flag
 */
export function computeAiObjective(
  actor: ActorState,
  actors: ActorState[],
  flags: Record<TeamId, FlagState>,
): { target: Vec2; mode: 'carry_home' | 'capture_enemy' | 'return_own' | 'escort' | 'defend' | 'suppress' } {
  const ownFlag = flags[actor.team];
  const enemyTeam = oppositeTeam(actor.team);
  const enemyFlag = flags[enemyTeam];
  const dirSign = actor.team === 'cobalt' ? 1 : -1;

  // Priority 1 (all roles): If I am carrying the enemy flag, bring it home!
  if (enemyFlag.status === 'carried' && enemyFlag.carrierId === actor.id) {
    // If our own flag is stolen, hover near home fort edge or hunt enemy carrier if close
    if (ownFlag.status === 'carried' && ownFlag.carrierId) {
      const enemyCarrier = actors.find((a) => a.id === ownFlag.carrierId && a.alive);
      if (enemyCarrier && dist2D(actor.pos, enemyCarrier.pos) < 16) {
        return { target: { ...enemyCarrier.pos }, mode: 'return_own' };
      }
    }
    return { target: { ...ownFlag.homePos }, mode: 'carry_home' };
  }

  // Role: DEFENDER (Sentinel)
  if (actor.role === 'defender') {
    if (ownFlag.status === 'dropped') {
      return { target: { ...ownFlag.pos }, mode: 'return_own' };
    }
    if (ownFlag.status === 'carried' && ownFlag.carrierId) {
      const carrier = actors.find((a) => a.id === ownFlag.carrierId && a.alive);
      if (carrier) {
        return { target: { ...carrier.pos }, mode: 'return_own' };
      }
    }
    // Patrol defensive arc in front of own base
    const guardX = ownFlag.homePos.x + dirSign * 7.5;
    const guardZ = actor.aiStrafeDir * 5.2;
    return { target: { x: guardX, z: guardZ }, mode: 'defend' };
  }

  // Role: HEAVY (Suppressor / Escort)
  if (actor.role === 'heavy') {
    // If teammate is carrying the enemy flag, escort them!
    if (enemyFlag.status === 'carried' && enemyFlag.carrierId) {
      const friendlyCarrier = actors.find((a) => a.id === enemyFlag.carrierId && a.alive);
      if (friendlyCarrier) {
        return {
          target: {
            x: friendlyCarrier.pos.x + dirSign * 2.5,
            z: friendlyCarrier.pos.z + actor.aiStrafeDir * 2.5,
          },
          mode: 'escort',
        };
      }
    }
    // If our flag is dropped nearby, grab it
    if (ownFlag.status === 'dropped' && dist2D(actor.pos, ownFlag.pos) < 18) {
      return { target: { ...ownFlag.pos }, mode: 'return_own' };
    }
    // Control midfield bunker ridge & suppress enemies
    const midX = dirSign * 4.5;
    const midZ = actor.aiStrafeDir * 7.2;
    return { target: { x: midX, z: midZ }, mode: 'suppress' };
  }

  // Role: STRIKER (Flank Flag Runner)
  if (ownFlag.status === 'dropped' && dist2D(actor.pos, ownFlag.pos) < 10) {
    return { target: { ...ownFlag.pos }, mode: 'return_own' };
  }

  // If enemy flag is already carried by a teammate, intercept enemy defenders / escort
  if (enemyFlag.status === 'carried' && enemyFlag.carrierId) {
    const friendlyCarrier = actors.find((a) => a.id === enemyFlag.carrierId && a.alive);
    if (friendlyCarrier) {
      return {
        target: { x: friendlyCarrier.pos.x - dirSign * 2.0, z: friendlyCarrier.pos.z + actor.aiStrafeDir * 3.5 },
        mode: 'escort',
      };
    }
  }

  // Route along outer flank if far from enemy flag, then cut inward cleanly
  const distToEnemyFlag = dist2D(actor.pos, enemyFlag.pos);
  if (distToEnemyFlag > 18 && Math.abs(actor.pos.z) < 12) {
    const flankZ = actor.aiStrafeDir >= 0 ? 16.5 : -16.5;
    return {
      target: { x: actor.pos.x + dirSign * 11, z: flankZ },
      mode: 'capture_enemy',
    };
  }
  return { target: { ...enemyFlag.pos }, mode: 'capture_enemy' };
}

export interface ActorBuffEffects {
  speedMult: number;
  fireRateMult: number;
  dashCooldownMult: number;
  damageTakenMult: number;
  infiniteAmmo: boolean;
  splashRadius: number;
  damageDealMult: number;
  hasShield: boolean;
  hasTurbo: boolean;
}

export interface PowerupCollectEvent {
  type: 'landed' | 'collected' | 'expired';
  dropId: string;
  kind: PowerupKind;
  pos: Vec2;
  actorId?: string;
  actorTeam?: TeamId;
}

/**
 * Computes combined live combat & movement multipliers from an actor's active powerup buffs.
 */
export function getActorBuffEffects(actor: ActorState): ActorBuffEffects {
  let speedMult = 1;
  let fireRateMult = 1;
  let dashCooldownMult = 1;
  let damageTakenMult = 1;
  let infiniteAmmo = false;
  let splashRadius = 0;
  let damageDealMult = 1;
  let hasShield = false;
  let hasTurbo = false;

  for (let i = 0; i < actor.buffs.length; i++) {
    const b = actor.buffs[i];
    if (b.remaining <= 0) continue;
    if (b.kind === 'turbo_boots') {
      speedMult *= 1.35;
      dashCooldownMult *= 0.55;
      hasTurbo = true;
    } else if (b.kind === 'rapid_hopper') {
      fireRateMult *= 1.9;
      infiniteAmmo = true;
    } else if (b.kind === 'paint_shield') {
      damageTakenMult *= 0.6;
      hasShield = true;
    } else if (b.kind === 'mega_splash') {
      splashRadius = Math.max(splashRadius, 2.85);
      damageDealMult *= 1.45;
    }
  }

  return {
    speedMult,
    fireRateMult,
    dashCooldownMult,
    damageTakenMult,
    infiniteAmmo,
    splashRadius,
    damageDealMult,
    hasShield,
    hasTurbo,
  };
}

/**
 * Applies a collected field powerup drop to an actor (refreshes timer if already active,
 * triggers instant heal/ammo bonuses where applicable).
 */
export function applyPowerupToActor(actor: ActorState, kind: PowerupKind): void {
  const meta = POWERUP_META[kind];
  const existing = actor.buffs.find((b) => b.kind === kind);
  if (existing) {
    existing.remaining = meta.duration;
    existing.duration = meta.duration;
  } else {
    actor.buffs.push({
      kind,
      remaining: meta.duration,
      duration: meta.duration,
    });
  }

  if (kind === 'paint_shield') {
    actor.hp = Math.min(actor.maxHp, actor.hp + 45);
  } else if (kind === 'rapid_hopper') {
    actor.ammo = actor.maxAmmo;
    actor.reloading = false;
    actor.reloadTimer = 0;
  } else if (kind === 'turbo_boots') {
    actor.dashCooldown = 0;
  }
}

/**
 * Decrements active buff timers and removes expired buffs.
 */
export function stepActorBuffs(actor: ActorState, dt: number): void {
  if (actor.buffs.length === 0) return;
  for (let i = actor.buffs.length - 1; i >= 0; i--) {
    actor.buffs[i].remaining -= dt;
    if (actor.buffs[i].remaining <= 0) {
      actor.buffs.splice(i, 1);
    }
  }
}

/**
 * Picks an unoccupied field spawn index for a new powerup drop.
 */
export function pickFreePowerupSpawnIndex(
  drops: PowerupDropState[],
  randomFn: () => number = Math.random,
): number | null {
  const occupied = new Set(drops.map((d) => d.spawnIndex));
  const candidates: number[] = [];
  for (let i = 0; i < POWERUP_SPAWN_POINTS.length; i++) {
    if (!occupied.has(i)) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(randomFn() * candidates.length) % candidates.length];
}

/**
 * Steps all active field powerup drops: air-drop descent, landing, actor pickup, and expiry.
 * Mutates `drops` in place to remove collected/expired entries and returns lifecycle events.
 */
export function stepPowerupDrops(
  dt: number,
  drops: PowerupDropState[],
  actors: ActorState[],
): PowerupCollectEvent[] {
  const events: PowerupCollectEvent[] = [];

  for (let i = drops.length - 1; i >= 0; i--) {
    const drop = drops[i];

    if (!drop.landed) {
      drop.altitude = Math.max(0, drop.altitude - 6.8 * dt);
      if (drop.altitude <= 0) {
        drop.landed = true;
        events.push({
          type: 'landed',
          dropId: drop.id,
          kind: drop.kind,
          pos: { ...drop.pos },
        });
      }
      continue;
    }

    // Check if any living actor touches the landed drop
    let collector: ActorState | null = null;
    for (let j = 0; j < actors.length; j++) {
      const a = actors[j];
      if (!a.alive) continue;
      if (distSq2D(a.pos, drop.pos) <= POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS) {
        collector = a;
        break;
      }
    }

    if (collector) {
      applyPowerupToActor(collector, drop.kind);
      events.push({
        type: 'collected',
        dropId: drop.id,
        kind: drop.kind,
        pos: { ...drop.pos },
        actorId: collector.id,
        actorTeam: collector.team,
      });
      drops.splice(i, 1);
      continue;
    }

    drop.life -= dt;
    if (drop.life <= 0) {
      events.push({
        type: 'expired',
        dropId: drop.id,
        kind: drop.kind,
        pos: { ...drop.pos },
      });
      drops.splice(i, 1);
    }
  }

  return events;
}

// ============================================================================
// STUN SHOCKWAVE ABILITY (2-Kill Charge, Persists Across Respawn, Growing Radius)
// ============================================================================

export const STUN_KILLS_REQUIRED = 2;
export const STUN_DURATION_SEC = 4.0;
export const STUN_BASE_RADIUS = 8.5;
export const STUN_RADIUS_STEP = 1.75;
export const STUN_MAX_RADIUS = 19.0;

/**
 * Computes the circular shockwave radius based on how many times this player
 * has already activated Stun Shockwave during the match.
 */
export function computeStunWaveRadius(activationCount: number): number {
  const safeCount = Math.max(0, Math.floor(activationCount));
  return Math.min(STUN_MAX_RADIUS, STUN_BASE_RADIUS + safeCount * STUN_RADIUS_STEP);
}

/**
 * Credits an elimination toward the killer's Stun Shockwave charge.
 * Persists across death & respawn until activated.
 */
export function registerKillForStunCharge(killer: ActorState): { becameReady: boolean } {
  const wasReady = killer.stunKillsProgress >= STUN_KILLS_REQUIRED;
  if (!wasReady) {
    killer.stunKillsProgress = Math.min(STUN_KILLS_REQUIRED, killer.stunKillsProgress + 1);
  }
  const nowReady = killer.stunKillsProgress >= STUN_KILLS_REQUIRED;
  return { becameReady: !wasReady && nowReady };
}

export interface StunShockwaveResult {
  triggered: boolean;
  radius: number;
  tier: number;
  affectedIds: string[];
}

/**
 * Triggers a circular Stun Shockwave centered on `caster`:
 * - Only affects living OPPONENTS inside the radius (never teammates or self).
 * - Stuns affected opponents for 4.0 seconds (no movement, no shooting).
 * - Edge case: If an opponent is already stunned (e.g., by another teammate's shockwave),
 *   their stun timer is REWRITTEN to 4.0s rather than appended!
 * - Increases `caster.stunActivations` so each subsequent activation covers a wider radius.
 */
export function triggerStunShockwave(
  caster: ActorState,
  actors: ActorState[],
): StunShockwaveResult {
  if (!caster.alive || caster.stunTimer > 0 || caster.stunKillsProgress < STUN_KILLS_REQUIRED) {
    return {
      triggered: false,
      radius: computeStunWaveRadius(caster.stunActivations),
      tier: caster.stunActivations,
      affectedIds: [],
    };
  }

  const radius = computeStunWaveRadius(caster.stunActivations);
  const radiusSq = radius * radius;
  caster.stunKillsProgress = 0;
  caster.stunActivations += 1;
  const tier = caster.stunActivations;

  const affectedIds: string[] = [];
  for (let i = 0; i < actors.length; i++) {
    const target = actors[i];
    if (!target.alive) continue;
    // Strictly affect opponents only — never self or same-team allies
    if (target.team === caster.team) continue;

    if (distSq2D(caster.pos, target.pos) <= radiusSq) {
      // Rewrite stun duration to 4.0s (never append if already stunned by a teammate)
      target.stunTimer = STUN_DURATION_SEC;
      target.vel.x = 0;
      target.vel.z = 0;
      target.dashTimer = 0;
      target.telegraphingBurst = false;
      target.windupTimer = 0;
      affectedIds.push(target.id);
    }
  }

  return { triggered: true, radius, tier, affectedIds };
}
