import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_OBSTACLES, BASE_POSITIONS, POWERUP_SPAWN_POINTS, SPAWN_POINTS } from './arenaData';
import {
  computeAiObjective,
  computeStunWaveRadius,
  createInitialFlags,
  dropFlagForActor,
  evaluateMatchWinner,
  getActorBuffEffects,
  hasLineOfSight,
  pickFreePowerupSpawnIndex,
  registerKillForStunCharge,
  resolveArenaCollision,
  STUN_BASE_RADIUS,
  STUN_DURATION_SEC,
  STUN_KILLS_REQUIRED,
  stepActorBuffs,
  stepFlagRules,
  stepPowerupDrops,
  triggerStunShockwave,
} from './rules';
import {
  createWeatherCycle,
  evaluateWeatherAtmosphere,
  stepWeatherCycle,
  WEATHER_PRESETS,
} from './weather';
import type { ActorState, PowerupDropState, TeamId, UnitRole } from './types';

function makeActor(overrides: Partial<ActorState> & { id: string; team: TeamId; role?: UnitRole }): ActorState {
  return {
    id: overrides.id,
    name: overrides.id,
    team: overrides.team,
    role: overrides.role ?? 'striker',
    isPlayer: overrides.isPlayer ?? false,
    pos: overrides.pos ?? { x: 0, z: 0 },
    vel: { x: 0, z: 0 },
    facing: 0,
    radius: 0.65,
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
    ammo: overrides.ammo ?? 24,
    maxAmmo: overrides.maxAmmo ?? 24,
    reloading: false,
    reloadTimer: 0,
    fireCooldown: 0,
    burstCooldown: 0,
    dashCooldown: 0,
    dashTimer: 0,
    dashDir: { x: 1, z: 0 },
    alive: overrides.alive ?? true,
    koTimer: 0,
    respawnTimer: 0,
    hitFlashTimer: 0,
    recoilAmount: 0,
    gaitPhase: 0,
    windupTimer: 0,
    telegraphingBurst: false,
    aiWaypoint: null,
    aiStrafeDir: 1,
    aiThinkTimer: 0,
    buffs: overrides.buffs ? [...overrides.buffs] : [],
    stunTimer: overrides.stunTimer ?? 0,
    stunKillsProgress: overrides.stunKillsProgress ?? 0,
    stunActivations: overrides.stunActivations ?? 0,
    tags: 0,
    captures: 0,
    returns: 0,
  };
}

test('spawn points are clear of all arena obstacles', () => {
  for (const team of ['cobalt', 'crimson'] as TeamId[]) {
    for (const sp of SPAWN_POINTS[team]) {
      const resolved = resolveArenaCollision(sp, 0.7, ARENA_OBSTACLES);
      assert.ok(Math.hypot(resolved.x - sp.x, resolved.z - sp.z) < 0.05, `Spawn ${team} (${sp.x},${sp.z}) overlapped obstacle`);
    }
  }
});

test('powerup drop zones are completely clear of all arena obstacles', () => {
  for (let i = 0; i < POWERUP_SPAWN_POINTS.length; i++) {
    const sp = POWERUP_SPAWN_POINTS[i];
    const resolved = resolveArenaCollision(sp, 1.0, ARENA_OBSTACLES);
    assert.ok(
      Math.hypot(resolved.x - sp.x, resolved.z - sp.z) < 0.05,
      `Powerup drop point #${i} (${sp.x},${sp.z}) overlapped obstacle`,
    );
  }
});

test('collision resolver pushes actor out of obstacle AABB', () => {
  const ob = ARENA_OBSTACLES[0]; // center_north_bunker at (0, -4.8)
  const resolved = resolveArenaCollision({ x: ob.x, z: ob.z + 0.2 }, 0.65, ARENA_OBSTACLES);
  const insideX = Math.abs(resolved.x - ob.x) < ob.width * 0.5 + 0.6;
  const insideZ = Math.abs(resolved.z - ob.z) < ob.depth * 0.5 + 0.6;
  assert.equal(insideX && insideZ, false);
});

test('line of sight detects obstacles between two actors', () => {
  // Blocked by center_north_bunker at (0, -4.8)
  assert.equal(hasLineOfSight({ x: -5, z: -4.8 }, { x: 5, z: -4.8 }, ARENA_OBSTACLES), false);
  // Open central corridor at z = 0 between -8 and +8
  assert.equal(hasLineOfSight({ x: -8, z: 0 }, { x: 8, z: 0 }, ARENA_OBSTACLES), true);
});

test('flag pickup, drop, friendly return, and capture scoring lifecycle', () => {
  const flags = createInitialFlags();
  const scores: Record<TeamId, number> = { cobalt: 0, crimson: 0 };

  const runner = makeActor({
    id: 'blue-1',
    team: 'cobalt',
    pos: { x: BASE_POSITIONS.crimson.x, z: BASE_POSITIONS.crimson.z },
  });
  const defender = makeActor({
    id: 'red-1',
    team: 'crimson',
    pos: { x: 0, z: 12 },
  });

  // 1. Runner picks up Crimson flag
  const ev1 = stepFlagRules(0.016, [runner, defender], flags, scores);
  assert.equal(ev1.some((e) => e.type === 'pickup' && e.flagTeam === 'crimson'), true);
  assert.equal(flags.crimson.status, 'carried');
  assert.equal(flags.crimson.carrierId, 'blue-1');

  // 2. Runner carries it to midfield and gets tagged out -> drops flag
  runner.pos = { x: 2, z: 3 };
  stepFlagRules(0.016, [runner, defender], flags, scores);
  assert.equal(flags.crimson.pos.x, 2);
  runner.alive = false;
  const dropEv = dropFlagForActor(runner, flags);
  assert.equal(dropEv?.type, 'drop');
  assert.equal(flags.crimson.status, 'dropped');

  // 3. Crimson defender touches dropped Crimson flag -> returns home
  defender.pos = { x: 2.2, z: 3.1 };
  const ev3 = stepFlagRules(0.016, [runner, defender], flags, scores);
  assert.equal(ev3.some((e) => e.type === 'return' && e.flagTeam === 'crimson'), true);
  assert.equal(flags.crimson.status, 'home');
  assert.equal(defender.returns, 1);

  // 4. Runner respawns, grabs Crimson flag again and carries it all the way to Cobalt home base -> CAPTURE!
  runner.alive = true;
  runner.pos = { ...BASE_POSITIONS.crimson };
  stepFlagRules(0.016, [runner, defender], flags, scores);
  runner.pos = { ...BASE_POSITIONS.cobalt };
  const ev4 = stepFlagRules(0.016, [runner, defender], flags, scores);
  assert.equal(ev4.some((e) => e.type === 'capture' && e.actorTeam === 'cobalt'), true);
  assert.equal(scores.cobalt, 1);
  assert.equal(runner.captures, 1);
  assert.equal(flags.crimson.status, 'home');
});

test('evaluateMatchWinner detects score limit and timer expiration', () => {
  assert.equal(evaluateMatchWinner({ cobalt: 2, crimson: 1 }, 120, 3), null);
  assert.equal(evaluateMatchWinner({ cobalt: 3, crimson: 1 }, 120, 3), 'cobalt');
  assert.equal(evaluateMatchWinner({ cobalt: 1, crimson: 3 }, 40, 3), 'crimson');
  assert.equal(evaluateMatchWinner({ cobalt: 2, crimson: 1 }, 0, 3), 'cobalt');
  assert.equal(evaluateMatchWinner({ cobalt: 2, crimson: 2 }, 0, 3), 'draw');
});

test('AI roles pick genuinely distinct tactical objectives', () => {
  const flags = createInitialFlags();
  const striker = makeActor({ id: 'b-s', team: 'cobalt', role: 'striker', pos: { x: -20, z: 0 } });
  const heavy = makeActor({ id: 'b-h', team: 'cobalt', role: 'heavy', pos: { x: -20, z: 2 } });
  const defender = makeActor({ id: 'b-d', team: 'cobalt', role: 'defender', pos: { x: -20, z: -2 } });
  const actors = [striker, heavy, defender];

  const oS = computeAiObjective(striker, actors, flags);
  const oH = computeAiObjective(heavy, actors, flags);
  const oD = computeAiObjective(defender, actors, flags);

  assert.equal(oS.mode, 'capture_enemy');
  assert.equal(oH.mode, 'suppress');
  assert.equal(oD.mode, 'defend');
  assert.ok(oD.target.x < 0, 'Cobalt defender should guard West half');
  assert.ok(oH.target.x > 0, 'Cobalt heavy should contest midfield');
});

test('dynamic weather cycles smoothly through clear, overcast, and light_fog', () => {
  const weather = createWeatherCycle('clear', false);
  const clearAtmo = evaluateWeatherAtmosphere(weather);
  assert.equal(clearAtmo.fogDensity, WEATHER_PRESETS.clear.fogDensity);
  assert.equal(clearAtmo.mistOpacity, 0);

  // Trigger transition from clear -> overcast
  const res1 = stepWeatherCycle(weather, 40, 30, 6);
  assert.equal(res1.startedTransitionTo, 'overcast');
  assert.equal(weather.current, 'clear');
  assert.equal(weather.target, 'overcast');

  // Mid-transition blend sits strictly between clear and overcast fog densities
  stepWeatherCycle(weather, 3, 30, 6);
  const midAtmo = evaluateWeatherAtmosphere(weather);
  assert.ok(midAtmo.fogDensity > WEATHER_PRESETS.clear.fogDensity);
  assert.ok(midAtmo.fogDensity < WEATHER_PRESETS.overcast.fogDensity);
  assert.ok(midAtmo.sunIntensity < WEATHER_PRESETS.clear.sunIntensity);

  // Finish transition to overcast, then transition into light_fog
  stepWeatherCycle(weather, 4, 30, 6);
  assert.equal(weather.current, 'overcast');
  const res2 = stepWeatherCycle(weather, 35, 30, 6);
  assert.equal(res2.startedTransitionTo, 'light_fog');
  stepWeatherCycle(weather, 10, 30, 6);
  assert.equal(weather.current, 'light_fog');
  const fogAtmo = evaluateWeatherAtmosphere(weather);
  assert.ok(fogAtmo.fogDensity > WEATHER_PRESETS.overcast.fogDensity);
  assert.ok(fogAtmo.mistOpacity > 0.35);

  // Cycles cleanly back to clear
  const res3 = stepWeatherCycle(weather, 35, 30, 6);
  assert.equal(res3.startedTransitionTo, 'clear');
});

test('powerup drops descend, grant buffs & multipliers on pickup, and expire cleanly', () => {
  const actor = makeActor({
    id: 'player',
    team: 'cobalt',
    isPlayer: true,
    pos: { x: 0, z: 0 },
    hp: 60,
    maxHp: 125,
    ammo: 6,
    maxAmmo: 24,
  });

  const drops: PowerupDropState[] = [
    {
      id: 'drop-1',
      kind: 'paint_shield',
      pos: { x: 0, z: 0 },
      altitude: 6.8,
      landed: false,
      life: 28,
      maxLife: 28,
      spawnIndex: 0,
    },
    {
      id: 'drop-2',
      kind: 'rapid_hopper',
      pos: { x: 10, z: 0 },
      altitude: 0,
      landed: true,
      life: 28,
      maxLife: 28,
      spawnIndex: 1,
    },
  ];

  // Pick free spawn excludes indices 0 and 1
  const freeIdx = pickFreePowerupSpawnIndex(drops, () => 0);
  assert.equal(freeIdx, 2);

  // While descending, drop cannot be collected yet
  const evAir = stepPowerupDrops(0.5, drops, [actor]);
  assert.equal(evAir.length, 0);
  assert.equal(actor.buffs.length, 0);

  // Descend to ground -> landed event
  const evLand = stepPowerupDrops(0.6, drops, [actor]);
  assert.equal(evLand.some((e) => e.type === 'landed' && e.dropId === 'drop-1'), true);
  assert.equal(drops[0].landed, true);

  // Next tick -> actor standing on drop collects paint_shield (+45 HP, 40% damage resist)
  const evCollect = stepPowerupDrops(0.05, drops, [actor]);
  assert.equal(evCollect.some((e) => e.type === 'collected' && e.kind === 'paint_shield'), true);
  assert.equal(actor.hp, 105);
  assert.equal(getActorBuffEffects(actor).damageTakenMult, 0.6);
  assert.equal(getActorBuffEffects(actor).hasShield, true);

  // Move to rapid_hopper drop -> instant ammo refill + 1.9x fire rate + infinite ammo
  actor.pos = { x: 10, z: 0 };
  const evRapid = stepPowerupDrops(0.05, drops, [actor]);
  assert.equal(evRapid.some((e) => e.type === 'collected' && e.kind === 'rapid_hopper'), true);
  assert.equal(actor.ammo, 24);
  assert.equal(getActorBuffEffects(actor).infiniteAmmo, true);
  assert.ok(getActorBuffEffects(actor).fireRateMult > 1.5);
  assert.equal(drops.length, 0);

  // Tick buffs past expiration
  stepActorBuffs(actor, 12);
  assert.equal(actor.buffs.length, 0);
  assert.equal(getActorBuffEffects(actor).damageTakenMult, 1);
  assert.equal(getActorBuffEffects(actor).infiniteAmmo, false);
});

test('Stun Shockwave unlocks after 2 kills, grows in radius, affects only enemies, and rewrites (never appends) shared stun timer', () => {
  const cobaltA = makeActor({ id: 'c1', team: 'cobalt', isPlayer: true, pos: { x: 0, z: 0 } });
  const cobaltB = makeActor({ id: 'c2', team: 'cobalt', isPlayer: true, pos: { x: 2, z: 0 } });
  const enemyNear = makeActor({ id: 'r1', team: 'crimson', pos: { x: 5, z: 0 } });
  const enemyFar = makeActor({ id: 'r2', team: 'crimson', pos: { x: 9.8, z: 0 } });
  const allActors = [cobaltA, cobaltB, enemyNear, enemyFar];

  // 0 kills -> cannot trigger
  assert.equal(triggerStunShockwave(cobaltA, allActors).triggered, false);

  // 1 kill -> still not ready (1/2)
  assert.equal(registerKillForStunCharge(cobaltA).becameReady, false);
  assert.equal(cobaltA.stunKillsProgress, 1);
  assert.equal(triggerStunShockwave(cobaltA, allActors).triggered, false);

  // 2nd kill -> becomes READY (2/2)
  assert.equal(registerKillForStunCharge(cobaltA).becameReady, true);
  assert.equal(cobaltA.stunKillsProgress, STUN_KILLS_REQUIRED);

  // First activation: base radius (8.5m) hits enemyNear (5m), misses enemyFar (9.8m), NEVER affects teammate cobaltB (2m) or self!
  const res1 = triggerStunShockwave(cobaltA, allActors);
  assert.equal(res1.triggered, true);
  assert.equal(res1.radius, STUN_BASE_RADIUS);
  assert.equal(res1.tier, 1);
  assert.deepEqual(res1.affectedIds, ['r1']);
  assert.equal(enemyNear.stunTimer, STUN_DURATION_SEC);
  assert.equal(enemyFar.stunTimer, 0);
  assert.equal(cobaltB.stunTimer, 0, 'teammate inside radius must NOT be stunned');
  assert.equal(cobaltA.stunTimer, 0, 'caster must NOT be stunned');
  assert.equal(cobaltA.stunKillsProgress, 0, 'charge consumed after activation');

  // Edge Case: 1.5s elapses (enemyNear has 2.5s stun left), then teammate cobaltB activates Stun Shockwave hitting same enemyNear!
  enemyNear.stunTimer -= 1.5;
  assert.equal(enemyNear.stunTimer, 2.5);
  registerKillForStunCharge(cobaltB);
  registerKillForStunCharge(cobaltB);
  const resTeammate = triggerStunShockwave(cobaltB, allActors);
  assert.equal(resTeammate.triggered, true);
  assert.equal(
    enemyNear.stunTimer,
    STUN_DURATION_SEC,
    'overlapping teammate stun must REWRITE timer to 4.0s, NOT append to 6.5s',
  );

  // Progression: cobaltA earns 2 more kills -> 2nd activation has larger radius (10.25m) and now reaches enemyFar (9.8m)!
  registerKillForStunCharge(cobaltA);
  registerKillForStunCharge(cobaltA);
  assert.ok(computeStunWaveRadius(cobaltA.stunActivations) > STUN_BASE_RADIUS);
  const res2 = triggerStunShockwave(cobaltA, allActors);
  assert.equal(res2.triggered, true);
  assert.equal(res2.tier, 2);
  assert.ok(res2.radius > 9.8);
  assert.equal(res2.affectedIds.includes('r2'), true, 'expanded radius should now stun enemyFar at 9.8m');
  assert.equal(enemyFar.stunTimer, STUN_DURATION_SEC);
});
