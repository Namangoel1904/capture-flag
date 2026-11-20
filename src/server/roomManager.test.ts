import assert from 'node:assert/strict';
import test from 'node:test';
import { GameRoomManager } from './roomManager';

test('createRoom and joinRoom support Co-op (same team) and V/S (opposite team) setup', () => {
  const mgr = new GameRoomManager();
  const { room, player: host } = mgr.createRoom('c1', 'Alex');
  assert.equal(room.code.length, 4);
  assert.equal(host.team, 'cobalt');

  // Second player joins room
  const joinRes = mgr.joinRoom('c2', room.code.toLowerCase(), 'Sam');
  assert.equal(joinRes.ok, true);
  if (!joinRes.ok) return;

  // Switch Sam to Cobalt -> Play Along (Co-op)
  const swCoop = mgr.switchTeam('c2', 'cobalt');
  assert.equal(swCoop.ok, true);
  assert.equal(joinRes.player.team, 'cobalt');

  // Switch Sam to Crimson -> Play V/S
  const swVs = mgr.switchTeam('c2', 'crimson');
  assert.equal(swVs.ok, true);
  assert.equal(joinRes.player.team, 'crimson');

  // Start V/S match with bots enabled (4v4)
  const startRes = mgr.startMatch('c1');
  assert.equal(startRes.ok, true);
  if (!startRes.ok) return;

  const cobaltActors = startRes.snapshot.actors.filter((a) => a.team === 'cobalt');
  const crimsonActors = startRes.snapshot.actors.filter((a) => a.team === 'crimson');
  assert.equal(cobaltActors.length, 4);
  assert.equal(crimsonActors.length, 4);
  assert.equal(cobaltActors.some((a) => a.id === host.id && a.isHuman), true);
  assert.equal(crimsonActors.some((a) => a.id === joinRes.player.id && a.isHuman), true);
});

test('pure 1v1 V/S works when fillBots is disabled and blocks empty opposite team', () => {
  const mgr = new GameRoomManager();
  const { room } = mgr.createRoom('c1', 'Host');
  mgr.updateConfig('c1', { fillBots: false });

  // Starting with 0 players on Crimson should fail cleanly
  const badStart = mgr.startMatch('c1');
  assert.equal(badStart.ok, false);

  // Add second player on Crimson -> 1v1 pure PvP succeeds
  const joinRes = mgr.joinRoom('c2', room.code, 'Rival');
  assert.equal(joinRes.ok, true);
  mgr.switchTeam('c2', 'crimson');

  const okStart = mgr.startMatch('c1');
  assert.equal(okStart.ok, true);
  if (!okStart.ok) return;
  assert.equal(okStart.snapshot.actors.length, 2);
});

test('server-authoritative human input moves actor, fires paintballs, and triggers dash', () => {
  const mgr = new GameRoomManager();
  const { room, player: host } = mgr.createRoom('c1', 'Alex');
  mgr.startMatch('c1');

  const startActor = room.actors.find((a) => a.id === host.id)!;
  const startX = startActor.pos.x;

  // Send right movement + fire + dash
  mgr.handleInput('c1', {
    moveX: 1,
    moveZ: 0,
    aimAngle: Math.PI / 2,
    firing: true,
    dash: true,
  });

  // Step 10 ticks (~333ms)
  let sawShot = false;
  let sawDash = false;
  for (let i = 0; i < 10; i++) {
    const { events } = mgr.stepRoom(room, 1 / 30);
    if (events.some((e) => e.type === 'shot' && e.shooterId === host.id)) sawShot = true;
    if (events.some((e) => e.type === 'dash' && e.actorId === host.id)) sawDash = true;
  }

  assert.equal(sawDash, true, 'expected dash event');
  assert.equal(sawShot, true, 'expected shot event');
  assert.ok(startActor.pos.x > startX + 1.5, 'expected human actor to move east on +X input');
});

test('disconnect transfers host, converts mid-match player to AI, and cleans up empty room', () => {
  const mgr = new GameRoomManager();
  const { room, player: host } = mgr.createRoom('c1', 'Host');
  const joinRes = mgr.joinRoom('c2', room.code, 'Friend');
  assert.equal(joinRes.ok, true);

  mgr.startMatch('c1');
  const leave1 = mgr.leaveRoom('c1');
  assert.equal(leave1.deleted, false);
  assert.equal(room.hostClientId, 'c2', 'host should transfer to remaining player');

  const formerHostActor = room.actors.find((a) => a.id === host.id);
  assert.ok(formerHostActor);
  assert.equal(formerHostActor.isHuman, false, 'disconnected player should become AI bot');

  const leave2 = mgr.leaveRoom('c2');
  assert.equal(leave2.deleted, true, 'empty room should be cleaned up');
  assert.equal(mgr.getRoomCount(), 0);
});

test('multiplayer Stun Shockwave persists through respawn, blocks stunned movement/shooting, and rewrites on teammate overlap', () => {
  const mgr = new GameRoomManager();
  const { room, player: p1 } = mgr.createRoom('c1', 'Alpha');
  const join2 = mgr.joinRoom('c2', room.code, 'Bravo');
  assert.equal(join2.ok, true);
  if (!join2.ok) return;
  mgr.switchTeam('c2', 'cobalt'); // Co-op teammates on Cobalt!

  const join3 = mgr.joinRoom('c3', room.code, 'Rival');
  assert.equal(join3.ok, true);
  if (!join3.ok) return;
  mgr.switchTeam('c3', 'crimson');
  mgr.updateConfig('c1', { fillBots: false });

  const startRes = mgr.startMatch('c1');
  assert.equal(startRes.ok, true);

  const a1 = room.actors.find((a) => a.id === p1.id)!;
  const a2 = room.actors.find((a) => a.id === join2.player.id)!;
  const rival = room.actors.find((a) => a.id === join3.player.id)!;

  // Position all 3 close together in open midfield
  a1.pos = { x: 0, z: 0 };
  a2.pos = { x: 2, z: 0 };
  rival.pos = { x: 4, z: 0 };

  // Give a1 full charge (2 kills) and verify it survives death + respawn!
  a1.stunKillsProgress = 2;
  a1.stunActivations = 1;
  a1.alive = false;
  a1.respawnTimer = 0.02;
  mgr.stepRoom(room, 0.05);
  assert.equal(a1.alive, true, 'actor should respawn');
  assert.equal(a1.stunKillsProgress, 2, 'stun charge must carry over across death and respawn');
  assert.equal(a1.stunActivations, 1, 'stun activation tier must carry over across death and respawn');

  // Move back near rival and trigger a1 Stun Shockwave (tier 2 => radius 10.25)
  a1.pos = { x: 0, z: 0 };
  a2.pos = { x: 2, z: 0 };
  rival.pos = { x: 4, z: 0 };
  mgr.handleInput('c1', {
    moveX: 0,
    moveZ: 0,
    aimAngle: 0,
    firing: false,
    stunWave: true,
  });
  const tick1 = mgr.stepRoom(room, 1 / 30);
  const wave1 = tick1.events.find((e) => e.type === 'stun_wave');
  assert.ok(wave1 && wave1.type === 'stun_wave');
  assert.equal(wave1.radius, 10.25);
  assert.deepEqual(wave1.affectedIds, [rival.id]);
  assert.equal(a2.stunTimer, 0, 'teammate must not be stunned');
  assert.ok(rival.stunTimer >= 3.95 && rival.stunTimer <= 4.0, 'rival should be stunned for 4.0s');

  // While stunned, rival sends movement & firing inputs — must neither move nor shoot!
  const frozenX = rival.pos.x;
  const frozenZ = rival.pos.z;
  mgr.handleInput('c3', {
    moveX: 1,
    moveZ: 1,
    aimAngle: 0,
    firing: true,
    dash: true,
    burst: true,
  });
  let rivalShot = false;
  for (let i = 0; i < 30; i++) {
    const { events } = mgr.stepRoom(room, 0.05); // 1.5s elapsed -> rival.stunTimer ~ 2.47s
    if (events.some((e) => e.type === 'shot' && e.shooterId === rival.id)) rivalShot = true;
  }
  assert.equal(rivalShot, false, 'stunned enemy must not be able to shoot');
  assert.equal(rival.pos.x, frozenX, 'stunned enemy must not move X');
  assert.equal(rival.pos.z, frozenZ, 'stunned enemy must not move Z');
  assert.ok(rival.stunTimer > 2.3 && rival.stunTimer < 2.7);

  // Teammate a2 now activates Stun Shockwave on the already-stunned rival -> timer REWRITES to 4.0s (not 6.5s)
  a2.stunKillsProgress = 2;
  mgr.handleInput('c2', {
    moveX: 0,
    moveZ: 0,
    aimAngle: 0,
    firing: false,
    stunWave: true,
  });
  mgr.stepRoom(room, 1 / 30);
  assert.ok(
    rival.stunTimer >= 3.95 && rival.stunTimer <= 4.0,
    'overlapping teammate stun must rewrite timer to 4.0s, never append',
  );
});

