import {
  ARENA_HALF_D,
  ARENA_HALF_W,
  ARENA_OBSTACLES,
  MATCH_DURATION_SEC,
  POWERUP_DROP_LIFETIME,
  POWERUP_MAX_ACTIVE,
  POWERUP_SPAWN_POINTS,
  SCORE_LIMIT,
  SPAWN_POINTS,
} from '../game/arenaData.ts';
import {
  computeAiObjective,
  createInitialFlags,
  dist2D,
  dropFlagForActor,
  evaluateMatchWinner,
  getActorBuffEffects,
  hasLineOfSight,
  oppositeTeam,
  pickFreePowerupSpawnIndex,
  pointHitsObstacle,
  registerKillForStunCharge,
  resolveArenaCollision,
  stepActorBuffs,
  stepFlagRules,
  stepPowerupDrops,
  triggerStunShockwave,
} from '../game/rules.ts';
import { createWeatherCycle, stepWeatherCycle, type WeatherCycleState } from '../game/weather.ts';
import type {
  ActorState,
  FlagState,
  MatchStats,
  PowerupDropState,
  PowerupKind,
  TeamId,
  UnitRole,
} from '../game/types.ts';
import type {
  NetActorSnapshot,
  NetGameEvent,
  NetMatchSnapshot,
  NetProjectile,
  PlayerInputPacket,
  RoomConfig,
  RoomLobbyState,
  RoomPlayerInfo,
} from '../game/netTypes.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS_PER_TEAM = 4;
const RELOAD_DURATION = 1.15;
const DASH_COOLDOWN = 2.2;
const DASH_DURATION = 0.22;
const BURST_COOLDOWN = 2.6;
const RESPAWN_TIME = 4.0;
const KO_FALL_DURATION = 0.38;

interface ServerProjectile {
  id: number;
  team: TeamId;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  splashRadius: number;
}

interface HumanInputBuffer {
  moveX: number;
  moveZ: number;
  aimAngle: number;
  firing: boolean;
  pendingDash: boolean;
  pendingBurst: boolean;
  pendingReload: boolean;
  pendingStunWave: boolean;
}

export interface ServerPlayer {
  clientId: string;
  id: string;
  name: string;
  team: TeamId;
  input: HumanInputBuffer;
}

export interface GameRoom {
  code: string;
  hostClientId: string;
  status: 'lobby' | 'playing' | 'gameover';
  config: RoomConfig;
  players: Map<string, ServerPlayer>; // keyed by clientId
  tick: number;
  scores: Record<TeamId, number>;
  matchTimeRemaining: number;
  elapsedMatchTime: number;
  flags: Record<TeamId, FlagState>;
  weather: WeatherCycleState;
  actors: ActorState[];
  powerups: PowerupDropState[];
  powerupSpawnTimer: number;
  powerupSeq: number;
  powerupKindCursor: number;
  projectiles: ServerProjectile[];
  projectileSeq: number;
  endStats: MatchStats | null;
  pendingEvents: NetGameEvent[];
  attackTokenPool: number;
}

function sanitizePlayerName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16);
  return cleaned || 'Player';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function createEmptyInput(team: TeamId): HumanInputBuffer {
  return {
    moveX: 0,
    moveZ: 0,
    aimAngle: team === 'cobalt' ? Math.PI / 2 : -Math.PI / 2,
    firing: false,
    pendingDash: false,
    pendingBurst: false,
    pendingReload: false,
    pendingStunWave: false,
  };
}

export class GameRoomManager {
  private rooms = new Map<string, GameRoom>();
  private clientToRoom = new Map<string, string>();
  private playerSeq = 1;

  public getRoomCount(): number {
    return this.rooms.size;
  }

  public getAllRooms(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  public getRoomByCode(code: string): GameRoom | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  public getRoomForClient(clientId: string): GameRoom | undefined {
    const code = this.clientToRoom.get(clientId);
    return code ? this.rooms.get(code) : undefined;
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
  }

  public serializeLobby(room: GameRoom): RoomLobbyState {
    const players: RoomPlayerInfo[] = [];
    for (const p of room.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        team: p.team,
        isHost: p.clientId === room.hostClientId,
      });
    }
    const hostPlayer = room.players.get(room.hostClientId);
    return {
      code: room.code,
      hostId: hostPlayer?.id ?? '',
      status: room.status,
      config: { ...room.config },
      players,
    };
  }

  public serializeSnapshot(room: GameRoom): NetMatchSnapshot {
    const actors: NetActorSnapshot[] = room.actors.map((a) => ({
      id: a.id,
      name: a.name,
      team: a.team,
      role: a.role,
      isHuman: Boolean(a.isHuman),
      pos: { x: a.pos.x, z: a.pos.z },
      vel: { x: a.vel.x, z: a.vel.z },
      facing: a.facing,
      radius: a.radius,
      hp: a.hp,
      maxHp: a.maxHp,
      ammo: a.ammo,
      maxAmmo: a.maxAmmo,
      reloading: a.reloading,
      reloadTimer: a.reloadTimer,
      burstCooldown: a.burstCooldown,
      dashCooldown: a.dashCooldown,
      dashTimer: a.dashTimer,
      alive: a.alive,
      koTimer: a.koTimer,
      respawnTimer: a.respawnTimer,
      hitFlashTimer: a.hitFlashTimer,
      recoilAmount: a.recoilAmount,
      telegraphingBurst: a.telegraphingBurst,
      buffs: a.buffs.map((b) => ({ ...b })),
      stunTimer: a.stunTimer,
      stunKillsProgress: a.stunKillsProgress,
      stunActivations: a.stunActivations,
      tags: a.tags,
      captures: a.captures,
      returns: a.returns,
    }));

    const projectiles: NetProjectile[] = room.projectiles.map((p) => ({
      id: p.id,
      team: p.team,
      x: p.x,
      y: p.y,
      z: p.z,
      vx: p.vx,
      vz: p.vz,
      splashRadius: p.splashRadius,
    }));

    return {
      tick: room.tick,
      phase: room.status === 'gameover' ? 'gameover' : 'playing',
      scores: { ...room.scores },
      matchTimeRemaining: room.matchTimeRemaining,
      elapsedMatchTime: room.elapsedMatchTime,
      weather: {
        current: room.weather.current,
        target: room.weather.target,
        blend: room.weather.blend,
      },
      flags: {
        cobalt: {
          ...room.flags.cobalt,
          homePos: { ...room.flags.cobalt.homePos },
          pos: { ...room.flags.cobalt.pos },
        },
        crimson: {
          ...room.flags.crimson,
          homePos: { ...room.flags.crimson.homePos },
          pos: { ...room.flags.crimson.pos },
        },
      },
      powerups: room.powerups.map((d) => ({
        ...d,
        pos: { ...d.pos },
      })),
      actors,
      projectiles,
      endStats: room.endStats ? { ...room.endStats } : null,
    };
  }

  public createRoom(
    clientId: string,
    rawName: string,
  ): { room: GameRoom; player: ServerPlayer } {
    this.leaveRoom(clientId);

    const code = this.generateCode();
    const playerId = `p-${this.playerSeq++}`;
    const player: ServerPlayer = {
      clientId,
      id: playerId,
      name: sanitizePlayerName(rawName),
      team: 'cobalt',
      input: createEmptyInput('cobalt'),
    };

    const room: GameRoom = {
      code,
      hostClientId: clientId,
      status: 'lobby',
      config: {
        teamSize: 4,
        difficulty: 'standard',
        fillBots: true,
      },
      players: new Map([[clientId, player]]),
      tick: 0,
      scores: { cobalt: 0, crimson: 0 },
      matchTimeRemaining: MATCH_DURATION_SEC,
      elapsedMatchTime: 0,
      flags: createInitialFlags(),
      weather: createWeatherCycle('clear', false),
      actors: [],
      powerups: [],
      powerupSpawnTimer: 11,
      powerupSeq: 1,
      powerupKindCursor: 0,
      projectiles: [],
      projectileSeq: 1,
      endStats: null,
      pendingEvents: [],
      attackTokenPool: 3,
    };

    this.rooms.set(code, room);
    this.clientToRoom.set(clientId, code);
    return { room, player };
  }

  public joinRoom(
    clientId: string,
    rawCode: string,
    rawName: string,
  ): { ok: true; room: GameRoom; player: ServerPlayer; snapshot?: NetMatchSnapshot } | { ok: false; error: string } {
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: `Room "${code}" not found. Check the 4-letter code and try again.` };
    }

    if (room.players.size >= MAX_PLAYERS_PER_TEAM * 2) {
      return { ok: false, error: 'This room is already full (8/8 players).' };
    }

    this.leaveRoom(clientId);

    // Count humans per team to place newcomer cleanly (prefers Cobalt up to teamSize for easy co-op, or balances if Cobalt full)
    let cobaltCount = 0;
    let crimsonCount = 0;
    for (const p of room.players.values()) {
      if (p.team === 'cobalt') cobaltCount++;
      else crimsonCount++;
    }
    const defaultTeam: TeamId =
      cobaltCount < MAX_PLAYERS_PER_TEAM && cobaltCount <= crimsonCount
        ? 'cobalt'
        : crimsonCount < MAX_PLAYERS_PER_TEAM
          ? 'crimson'
          : 'cobalt';

    const playerId = `p-${this.playerSeq++}`;
    const player: ServerPlayer = {
      clientId,
      id: playerId,
      name: sanitizePlayerName(rawName),
      team: defaultTeam,
      input: createEmptyInput(defaultTeam),
    };

    room.players.set(clientId, player);
    this.clientToRoom.set(clientId, code);

    // If match is currently live, seamlessly slot newcomer into a bot or fresh actor on their team
    if (room.status === 'playing') {
      const botSlot = room.actors.find((a) => a.team === player.team && !a.isHuman);
      if (botSlot) {
        botSlot.id = player.id;
        botSlot.name = player.name;
        botSlot.isHuman = true;
        botSlot.isPlayer = true;
        botSlot.maxHp = 125;
        botSlot.hp = 125;
        botSlot.maxAmmo = 24;
        botSlot.ammo = 24;
        botSlot.role = 'striker';
      } else {
        const sp = SPAWN_POINTS[player.team][0];
        room.actors.push(this.createActor(player.id, player.name, player.team, 'striker', true, sp));
      }
      room.pendingEvents.push({
        type: 'banner',
        text: `${player.name.toUpperCase()} JOINED`,
        subtext: `Reinforcing Team ${player.team === 'cobalt' ? 'Cobalt' : 'Crimson'}`,
        team: player.team,
      });
      return { ok: true, room, player, snapshot: this.serializeSnapshot(room) };
    }

    return { ok: true, room, player };
  }

  public switchTeam(
    clientId: string,
    team: TeamId,
  ): { ok: true; room: GameRoom } | { ok: false; error: string } {
    const room = this.getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'Not in a room.' };
    if (room.status !== 'lobby') return { ok: false, error: 'Cannot switch teams during a match.' };

    const player = room.players.get(clientId);
    if (!player) return { ok: false, error: 'Player not found.' };
    if (player.team === team) return { ok: true, room };

    let countOnTarget = 0;
    for (const p of room.players.values()) {
      if (p.team === team) countOnTarget++;
    }
    if (countOnTarget >= MAX_PLAYERS_PER_TEAM) {
      return { ok: false, error: `Team ${team === 'cobalt' ? 'Cobalt' : 'Crimson'} is full.` };
    }

    player.team = team;
    player.input = createEmptyInput(team);
    return { ok: true, room };
  }

  public updateConfig(
    clientId: string,
    partial: Partial<RoomConfig>,
  ): { ok: true; room: GameRoom } | { ok: false; error: string } {
    const room = this.getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'Not in a room.' };
    if (room.hostClientId !== clientId) return { ok: false, error: 'Only the room host can change settings.' };
    if (room.status !== 'lobby') return { ok: false, error: 'Cannot change settings during a match.' };

    if (partial.teamSize === 3 || partial.teamSize === 4) {
      room.config.teamSize = partial.teamSize;
    }
    if (partial.difficulty === 'standard' || partial.difficulty === 'veteran') {
      room.config.difficulty = partial.difficulty;
    }
    if (typeof partial.fillBots === 'boolean') {
      room.config.fillBots = partial.fillBots;
    }

    return { ok: true, room };
  }

  public startMatch(
    clientId: string,
  ): { ok: true; room: GameRoom; snapshot: NetMatchSnapshot } | { ok: false; error: string } {
    const room = this.getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'Not in a room.' };
    if (room.hostClientId !== clientId) {
      return { ok: false, error: 'Only the room host can start the match.' };
    }

    const cobaltHumans: ServerPlayer[] = [];
    const crimsonHumans: ServerPlayer[] = [];
    for (const p of room.players.values()) {
      p.input = createEmptyInput(p.team);
      if (p.team === 'cobalt') cobaltHumans.push(p);
      else crimsonHumans.push(p);
    }

    if (!room.config.fillBots && (cobaltHumans.length === 0 || crimsonHumans.length === 0)) {
      return {
        ok: false,
        error: 'Both teams need at least 1 player when AI bots are turned off, or enable AI bots.',
      };
    }

    room.status = 'playing';
    room.tick = 0;
    room.scores = { cobalt: 0, crimson: 0 };
    room.matchTimeRemaining = MATCH_DURATION_SEC;
    room.elapsedMatchTime = 0;
    room.flags = createInitialFlags();
    room.weather = createWeatherCycle('clear', false);
    room.projectiles = [];
    room.endStats = null;
    room.pendingEvents = [];

    // Spawn actors: human players first, then AI bots filling up to teamSize
    room.actors = [];
    const cobaltBotNames = ['Vanguard', 'Nova', 'Titan', 'Aegis'];
    const crimsonBotNames = ['Blaze', 'Viper', 'Forge', 'Bastion'];
    const roleOrder: UnitRole[] =
      room.config.teamSize === 3
        ? ['striker', 'heavy', 'defender']
        : ['striker', 'striker', 'heavy', 'defender'];

    const spawnTeam = (team: TeamId, humans: ServerPlayer[], botNames: string[]) => {
      const spawns = SPAWN_POINTS[team];
      const targetSize = room.config.fillBots
        ? Math.max(room.config.teamSize, humans.length)
        : humans.length;

      for (let i = 0; i < targetSize; i++) {
        const sp = spawns[i % spawns.length];
        if (i < humans.length) {
          const hp = humans[i];
          room.actors.push(this.createActor(hp.id, hp.name, team, 'striker', true, sp));
        } else {
          const role = roleOrder[i % roleOrder.length];
          const botName = botNames[i % botNames.length];
          room.actors.push(this.createActor(`bot-${team}-${i}`, botName, team, role, false, sp));
        }
      }
    };

    spawnTeam('cobalt', cobaltHumans, cobaltBotNames);
    spawnTeam('crimson', crimsonHumans, crimsonBotNames);

    // Seed initial powerups (symmetric drops in midfield and lanes)
    room.powerups = [];
    room.powerupSpawnTimer = 11;
    room.powerupSeq = 1;
    room.powerupKindCursor = 0;
    this.spawnPowerupDrop(room, 1, 'turbo_boots', true);
    this.spawnPowerupDrop(room, 2, 'turbo_boots', true);
    this.spawnPowerupDrop(room, 0, 'mega_splash', false);

    room.pendingEvents.push({
      type: 'banner',
      text: 'MATCH START',
      subtext: 'Capture the enemy flag 3 times to win!',
      team: 'neutral',
    });

    return { ok: true, room, snapshot: this.serializeSnapshot(room) };
  }

  public returnToLobby(
    clientId: string,
  ): { ok: true; room: GameRoom } | { ok: false; error: string } {
    const room = this.getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'Not in a room.' };
    if (room.hostClientId !== clientId) {
      return { ok: false, error: 'Only the room host can return everyone to the lobby.' };
    }
    room.status = 'lobby';
    room.projectiles = [];
    room.actors = [];
    room.endStats = null;
    room.pendingEvents = [];
    return { ok: true, room };
  }

  public handleInput(clientId: string, packet: PlayerInputPacket): void {
    const room = this.getRoomForClient(clientId);
    if (!room || room.status !== 'playing') return;
    const player = room.players.get(clientId);
    if (!player) return;

    const moveX = Number.isFinite(packet.moveX) ? Math.max(-1, Math.min(1, packet.moveX)) : 0;
    const moveZ = Number.isFinite(packet.moveZ) ? Math.max(-1, Math.min(1, packet.moveZ)) : 0;
    const aimAngle = Number.isFinite(packet.aimAngle) ? packet.aimAngle : player.input.aimAngle;

    player.input.moveX = moveX;
    player.input.moveZ = moveZ;
    player.input.aimAngle = aimAngle;
    player.input.firing = Boolean(packet.firing);
    if (packet.dash) player.input.pendingDash = true;
    if (packet.burst) player.input.pendingBurst = true;
    if (packet.reload) player.input.pendingReload = true;
    if (packet.stunWave) player.input.pendingStunWave = true;
  }

  public leaveRoom(clientId: string): { room: GameRoom | null; deleted: boolean } {
    const code = this.clientToRoom.get(clientId);
    if (!code) return { room: null, deleted: false };
    this.clientToRoom.delete(clientId);

    const room = this.rooms.get(code);
    if (!room) return { room: null, deleted: false };

    const leaving = room.players.get(clientId);
    room.players.delete(clientId);

    // If room is now empty, delete it cleanly
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return { room: null, deleted: true };
    }

    // Transfer host if needed
    if (room.hostClientId === clientId) {
      const nextHost = room.players.keys().next().value as string | undefined;
      if (nextHost) {
        room.hostClientId = nextHost;
      }
    }

    // If mid-match, convert disconnected player's actor smoothly into a bot (or drop flag & remove if no bots)
    if (leaving && room.status === 'playing') {
      const actor = room.actors.find((a) => a.id === leaving.id);
      if (actor) {
        actor.isHuman = false;
        actor.isPlayer = false;
        actor.name = `${leaving.name} (AI)`;
      }
      room.pendingEvents.push({
        type: 'banner',
        text: `${leaving.name.toUpperCase()} LEFT`,
        subtext: 'AI took over their paintball slot',
        team: 'neutral',
      });
    }

    return { room, deleted: false };
  }

  private createActor(
    id: string,
    name: string,
    team: TeamId,
    role: UnitRole,
    isHuman: boolean,
    sp: { x: number; z: number },
  ): ActorState {
    const maxHp = isHuman ? 125 : role === 'heavy' ? 130 : role === 'defender' ? 110 : 95;
    const maxAmmo = isHuman ? 24 : role === 'heavy' ? 32 : 20;
    return {
      id,
      name,
      team,
      role,
      isPlayer: isHuman,
      isHuman,
      pos: { x: sp.x, z: sp.z },
      vel: { x: 0, z: 0 },
      facing: team === 'cobalt' ? Math.PI / 2 : -Math.PI / 2,
      radius: role === 'heavy' ? 0.72 : 0.62,
      hp: maxHp,
      maxHp,
      ammo: maxAmmo,
      maxAmmo,
      reloading: false,
      reloadTimer: 0,
      fireCooldown: 0.25,
      burstCooldown: 0,
      dashCooldown: 0,
      dashTimer: 0,
      dashDir: { x: team === 'cobalt' ? 1 : -1, z: 0 },
      alive: true,
      koTimer: 0,
      respawnTimer: 0,
      hitFlashTimer: 0,
      recoilAmount: 0,
      gaitPhase: 0,
      windupTimer: 0,
      telegraphingBurst: false,
      aiWaypoint: null,
      aiStrafeDir: Math.random() < 0.5 ? 1 : -1,
      aiThinkTimer: Math.random() * 0.6,
      buffs: [],
      stunTimer: 0,
      stunKillsProgress: 0,
      stunActivations: 0,
      tags: 0,
      captures: 0,
      returns: 0,
    };
  }

  // =========================================================================
  // AUTHORITATIVE ROOM SIMULATION TICK
  // =========================================================================

  public stepRoom(room: GameRoom, dt: number): { snapshot: NetMatchSnapshot; events: NetGameEvent[] } {
    const events: NetGameEvent[] = room.pendingEvents.splice(0, room.pendingEvents.length);
    if (room.status !== 'playing') {
      return { snapshot: this.serializeSnapshot(room), events };
    }

    room.tick += 1;
    room.matchTimeRemaining = Math.max(0, room.matchTimeRemaining - dt);
    room.elapsedMatchTime += dt;
    room.attackTokenPool = room.config.difficulty === 'veteran' ? 4 : 3;

    // Map playerId -> ServerPlayer for fast lookup
    const humanById = new Map<string, ServerPlayer>();
    for (const p of room.players.values()) {
      humanById.set(p.id, p);
    }

    // 1. Update all actors (Humans + AI bots)
    for (const actor of room.actors) {
      if (actor.hitFlashTimer > 0) actor.hitFlashTimer = Math.max(0, actor.hitFlashTimer - dt);
      if (actor.recoilAmount > 0) actor.recoilAmount = Math.max(0, actor.recoilAmount - dt * 6.5);
      if (actor.fireCooldown > 0) actor.fireCooldown = Math.max(0, actor.fireCooldown - dt);
      if (actor.burstCooldown > 0) actor.burstCooldown = Math.max(0, actor.burstCooldown - dt);
      if (actor.dashCooldown > 0) actor.dashCooldown = Math.max(0, actor.dashCooldown - dt);
      if (actor.stunTimer > 0) actor.stunTimer = Math.max(0, actor.stunTimer - dt);
      stepActorBuffs(actor, dt);

      if (!actor.alive) {
        if (actor.koTimer > 0) actor.koTimer = Math.max(0, actor.koTimer - dt);
        actor.respawnTimer -= dt;
        if (actor.respawnTimer <= 0) {
          this.respawnActor(actor, events);
        }
        continue;
      }

      if (actor.reloading) {
        actor.reloadTimer -= dt;
        if (actor.reloadTimer <= 0) {
          actor.reloading = false;
          actor.ammo = actor.maxAmmo;
        }
      }

      const human = actor.isHuman ? humanById.get(actor.id) : undefined;
      if (actor.stunTimer > 0) {
        // Stunned actors cannot move, dash, burst, stun-wave, or shoot
        actor.vel.x = 0;
        actor.vel.z = 0;
        actor.dashTimer = 0;
        actor.telegraphingBurst = false;
        if (human) {
          human.input.pendingDash = false;
          human.input.pendingBurst = false;
          human.input.pendingReload = false;
          human.input.pendingStunWave = false;
        }
        continue;
      }

      if (human) {
        this.stepHumanActor(room, actor, human.input, dt, events);
      } else {
        this.stepAiActor(room, actor, dt, events);
      }
    }

    // 2. Soft actor-vs-actor separation
    for (let i = 0; i < room.actors.length; i++) {
      const a = room.actors[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < room.actors.length; j++) {
        const b = room.actors[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minDist = a.radius + b.radius;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDist * minDist && dSq > 1e-5) {
          const d = Math.sqrt(dSq);
          const push = (minDist - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
        }
      }
    }

    // 3. Step projectiles
    this.stepProjectiles(room, dt, events);

    // 4. Step Flag Rules
    const flagEvents = stepFlagRules(dt, room.actors, room.flags, room.scores);
    for (const ev of flagEvents) {
      const actor = room.actors.find((a) => a.id === ev.actorId);
      events.push({
        type: 'flag_event',
        kind: ev.type,
        flagTeam: ev.flagTeam,
        actorId: ev.actorId,
        actorTeam: ev.actorTeam,
        actorName: actor?.name,
        pos: { ...ev.pos },
        cobaltScore: room.scores.cobalt,
        crimsonScore: room.scores.crimson,
      });
    }

    // 5. Step Powerup Drops
    if (room.powerups.length < POWERUP_MAX_ACTIVE) {
      room.powerupSpawnTimer -= dt;
      if (room.powerupSpawnTimer <= 0) {
        room.powerupSpawnTimer = 11.5 + Math.random() * 3.5;
        this.spawnPowerupDrop(room);
      }
    }
    const powerupEvents = stepPowerupDrops(dt, room.powerups, room.actors);
    for (const pe of powerupEvents) {
      events.push({
        type: 'powerup_event',
        kind: pe.type,
        powerupKind: pe.kind,
        actorId: pe.actorId,
        actorTeam: pe.actorTeam,
        pos: { ...pe.pos },
      });
    }

    // 6. Step Dynamic Weather Cycle
    const { startedTransitionTo } = stepWeatherCycle(room.weather, dt);
    if (startedTransitionTo) {
      events.push({ type: 'weather_shift', weather: startedTransitionTo });
    }

    // 7. Evaluate Match Winner
    const winner = evaluateMatchWinner(room.scores, room.matchTimeRemaining, SCORE_LIMIT);
    if (winner !== null) {
      room.status = 'gameover';
      const totalTags = room.actors.reduce((acc, a) => acc + a.tags, 0);
      room.endStats = {
        winner,
        cobaltScore: room.scores.cobalt,
        crimsonScore: room.scores.crimson,
        elapsedSeconds: Math.round(room.elapsedMatchTime),
        playerTags: 0,
        playerCaptures: 0,
        playerReturns: 0,
        teamTags: totalTags,
      };
    }

    return { snapshot: this.serializeSnapshot(room), events };
  }

  private stepHumanActor(
    room: GameRoom,
    actor: ActorState,
    input: HumanInputBuffer,
    dt: number,
    events: NetGameEvent[],
  ): void {
    const buffs = getActorBuffEffects(actor);
    const enemyFlag = room.flags[oppositeTeam(actor.team)];
    const carryingFlag = enemyFlag.status === 'carried' && enemyFlag.carrierId === actor.id;
    const baseSpeed = (carryingFlag ? 7.6 : 8.6) * buffs.speedMult;

    actor.facing = input.aimAngle;

    // One-shot Kill-Earned Stun Shockwave [Q]
    if (input.pendingStunWave) {
      input.pendingStunWave = false;
      const res = triggerStunShockwave(actor, room.actors);
      if (res.triggered) {
        events.push({
          type: 'stun_wave',
          casterId: actor.id,
          casterName: actor.name,
          team: actor.team,
          x: actor.pos.x,
          z: actor.pos.z,
          radius: res.radius,
          tier: res.tier,
          affectedIds: res.affectedIds,
        });
      }
    }

    // One-shot Dash
    if (input.pendingDash) {
      input.pendingDash = false;
      if (actor.dashCooldown <= 0) {
        let dx = input.moveX;
        let dz = input.moveZ;
        if (Math.abs(dx) < 0.05 && Math.abs(dz) < 0.05) {
          dx = Math.sin(actor.facing);
          dz = Math.cos(actor.facing);
        } else {
          const len = Math.hypot(dx, dz);
          dx /= len;
          dz /= len;
        }
        actor.dashDir = { x: dx, z: dz };
        actor.dashTimer = DASH_DURATION;
        actor.dashCooldown = DASH_COOLDOWN * buffs.dashCooldownMult;
        events.push({
          type: 'dash',
          actorId: actor.id,
          x: actor.pos.x,
          z: actor.pos.z,
          hasTurbo: buffs.hasTurbo,
        });
      }
    }

    // One-shot Reload
    if (input.pendingReload) {
      input.pendingReload = false;
      if (!actor.reloading && actor.ammo < actor.maxAmmo) {
        actor.reloading = true;
        actor.reloadTimer = RELOAD_DURATION;
        events.push({ type: 'reload', actorId: actor.id });
      }
    }

    // One-shot Tri-Burst
    if (input.pendingBurst) {
      input.pendingBurst = false;
      if (!actor.reloading && actor.burstCooldown <= 0 && (buffs.infiniteAmmo || actor.ammo >= 3)) {
        actor.burstCooldown = BURST_COOLDOWN;
        if (!buffs.infiniteAmmo) {
          actor.ammo = Math.max(0, actor.ammo - 3);
        }
        actor.recoilAmount = 1.0;
        for (const spread of [-0.11, 0, 0.11]) {
          this.spawnProjectile(
            room,
            actor,
            actor.facing + spread,
            Math.round(23 * buffs.damageDealMult),
            30,
            buffs.splashRadius,
          );
        }
        events.push({
          type: 'shot',
          shooterId: actor.id,
          team: actor.team,
          x: actor.pos.x + Math.sin(actor.facing) * 0.95,
          y: 1.08,
          z: actor.pos.z + Math.cos(actor.facing) * 0.95,
          isBurst: true,
          isMega: buffs.splashRadius > 0,
        });
        if (!buffs.infiniteAmmo && actor.ammo === 0) {
          actor.reloading = true;
          actor.reloadTimer = RELOAD_DURATION;
          events.push({ type: 'reload', actorId: actor.id });
        }
      }
    }

    // Movement integration
    if (actor.dashTimer > 0) {
      actor.dashTimer = Math.max(0, actor.dashTimer - dt);
      const dashSpd = 19.5 * (buffs.hasTurbo ? 1.15 : 1.0);
      actor.vel.x = actor.dashDir.x * dashSpd;
      actor.vel.z = actor.dashDir.z * dashSpd;
    } else {
      let mx = input.moveX;
      let mz = input.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      const accel = 1 - Math.exp(-16 * dt);
      actor.vel.x = lerp(actor.vel.x, mx * baseSpeed, accel);
      actor.vel.z = lerp(actor.vel.z, mz * baseSpeed, accel);
    }

    const nextPos = resolveArenaCollision(
      { x: actor.pos.x + actor.vel.x * dt, z: actor.pos.z + actor.vel.z * dt },
      actor.radius,
      ARENA_OBSTACLES,
    );
    const moved = Math.hypot(nextPos.x - actor.pos.x, nextPos.z - actor.pos.z);
    actor.pos = nextPos;
    actor.gaitPhase += moved * 2.8;

    // Continuous paintball fire
    if (input.firing && !actor.reloading && actor.fireCooldown <= 0) {
      if (buffs.infiniteAmmo || actor.ammo > 0) {
        if (!buffs.infiniteAmmo) {
          actor.ammo -= 1;
        }
        actor.fireCooldown = 0.155 / buffs.fireRateMult;
        actor.recoilAmount = 0.85;
        const jitter = (Math.random() - 0.5) * 0.045;
        this.spawnProjectile(
          room,
          actor,
          actor.facing + jitter,
          Math.round(25 * buffs.damageDealMult),
          32,
          buffs.splashRadius,
        );
        events.push({
          type: 'shot',
          shooterId: actor.id,
          team: actor.team,
          x: actor.pos.x + Math.sin(actor.facing) * 0.95,
          y: 1.08,
          z: actor.pos.z + Math.cos(actor.facing) * 0.95,
          isMega: buffs.splashRadius > 0,
        });
        if (!buffs.infiniteAmmo && actor.ammo === 0) {
          actor.reloading = true;
          actor.reloadTimer = RELOAD_DURATION;
          events.push({ type: 'reload', actorId: actor.id });
        }
      }
    }
  }

  private stepAiActor(
    room: GameRoom,
    actor: ActorState,
    dt: number,
    events: NetGameEvent[],
  ): void {
    const enemyTeam = oppositeTeam(actor.team);
    const carryingFlag =
      room.flags[enemyTeam].status === 'carried' && room.flags[enemyTeam].carrierId === actor.id;

    actor.aiThinkTimer -= dt;
    if (actor.aiThinkTimer <= 0) {
      actor.aiThinkTimer = 2.4 + Math.random() * 2.6;
      if (Math.random() < 0.45) actor.aiStrafeDir *= -1;
    }

    const objective = computeAiObjective(actor, room.actors, room.flags);

    let closestEnemy: ActorState | null = null;
    let closestDist = 26;
    for (const other of room.actors) {
      if (!other.alive || other.team === actor.team) continue;
      const d = dist2D(actor.pos, other.pos);
      if (d < closestDist && hasLineOfSight(actor.pos, other.pos, ARENA_OBSTACLES)) {
        closestDist = d;
        closestEnemy = other;
      }
    }

    let dirX = objective.target.x - actor.pos.x;
    let dirZ = objective.target.z - actor.pos.z;
    const distToObj = Math.hypot(dirX, dirZ);
    if (distToObj > 0.7) {
      dirX /= distToObj;
      dirZ /= distToObj;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    if (closestEnemy && objective.mode !== 'carry_home') {
      const toEnemyX = (closestEnemy.pos.x - actor.pos.x) / Math.max(0.1, closestDist);
      const toEnemyZ = (closestEnemy.pos.z - actor.pos.z) / Math.max(0.1, closestDist);
      const perpX = -toEnemyZ * actor.aiStrafeDir;
      const perpZ = toEnemyX * actor.aiStrafeDir;
      if (actor.role === 'heavy' && closestDist < 15) {
        dirX = dirX * 0.35 + perpX * 0.65;
        dirZ = dirZ * 0.35 + perpZ * 0.65;
      } else if (actor.role === 'defender' && closestDist < 14) {
        dirX = dirX * 0.45 + perpX * 0.55;
        dirZ = dirZ * 0.45 + perpZ * 0.55;
      } else if (closestDist < 10) {
        dirX = dirX * 0.72 + perpX * 0.28;
        dirZ = dirZ * 0.72 + perpZ * 0.28;
      }
    }

    const probeX = actor.pos.x + dirX * 2.4;
    const probeZ = actor.pos.z + dirZ * 2.4;
    if (pointHitsObstacle(probeX, probeZ, actor.radius + 0.25, ARENA_OBSTACLES)) {
      const perpX = -dirZ * actor.aiStrafeDir;
      const perpZ = dirX * actor.aiStrafeDir;
      dirX = dirX * 0.2 + perpX * 0.95;
      dirZ = dirZ * 0.2 + perpZ * 0.95;
    }

    const dLen = Math.hypot(dirX, dirZ);
    if (dLen > 0.01) {
      dirX /= dLen;
      dirZ /= dLen;
    }

    const aiBuffs = getActorBuffEffects(actor);
    const diffMult = room.config.difficulty === 'veteran' ? 1.1 : 1.0;
    const roleSpeed = actor.role === 'striker' ? 7.2 : actor.role === 'defender' ? 6.4 : 5.7;
    const speed = (carryingFlag ? roleSpeed * 0.9 : roleSpeed) * diffMult * aiBuffs.speedMult;

    const accel = 1 - Math.exp(-10 * dt);
    actor.vel.x = lerp(actor.vel.x, dirX * speed, accel);
    actor.vel.z = lerp(actor.vel.z, dirZ * speed, accel);

    const nextPos = resolveArenaCollision(
      { x: actor.pos.x + actor.vel.x * dt, z: actor.pos.z + actor.vel.z * dt },
      actor.radius,
      ARENA_OBSTACLES,
    );
    const moved = Math.hypot(nextPos.x - actor.pos.x, nextPos.z - actor.pos.z);
    actor.pos = nextPos;
    actor.gaitPhase += moved * 2.8;

    if (closestEnemy) {
      const targetAngle = Math.atan2(
        closestEnemy.pos.x - actor.pos.x,
        closestEnemy.pos.z - actor.pos.z,
      );
      actor.facing = lerpAngle(actor.facing, targetAngle, 1 - Math.exp(-12 * dt));

      if (actor.role === 'heavy') {
        if (actor.telegraphingBurst) {
          actor.windupTimer -= dt;
          if (actor.windupTimer <= 0) {
            actor.telegraphingBurst = false;
            actor.fireCooldown =
              (room.config.difficulty === 'veteran' ? 1.15 : 1.45) / aiBuffs.fireRateMult;
            actor.recoilAmount = 1.0;
            for (const sp of [-0.12, 0, 0.12]) {
              this.spawnProjectile(
                room,
                actor,
                actor.facing + sp,
                Math.round(20 * aiBuffs.damageDealMult),
                22,
                aiBuffs.splashRadius,
              );
            }
            events.push({
              type: 'shot',
              shooterId: actor.id,
              team: actor.team,
              x: actor.pos.x + Math.sin(actor.facing) * 0.95,
              y: 1.08,
              z: actor.pos.z + Math.cos(actor.facing) * 0.95,
              isBurst: true,
              isMega: aiBuffs.splashRadius > 0,
            });
          }
        } else if (
          actor.fireCooldown <= 0 &&
          !actor.reloading &&
          closestDist < 21 &&
          room.attackTokenPool > 0
        ) {
          room.attackTokenPool--;
          actor.telegraphingBurst = true;
          actor.windupTimer = 0.42;
          events.push({ type: 'windup', actorId: actor.id, targetId: closestEnemy.id });
        }
      } else {
        if (
          actor.fireCooldown <= 0 &&
          !actor.reloading &&
          closestDist < 22 &&
          room.attackTokenPool > 0
        ) {
          room.attackTokenPool--;
          const spread = room.config.difficulty === 'veteran' ? 0.09 : 0.14;
          const aimJitter = (Math.random() - 0.5) * spread;
          actor.fireCooldown =
            ((actor.role === 'striker' ? 0.34 : 0.28) *
              (room.config.difficulty === 'veteran' ? 0.85 : 1.05)) /
            aiBuffs.fireRateMult;
          actor.recoilAmount = 0.8;
          if (!aiBuffs.infiniteAmmo) {
            actor.ammo = Math.max(0, actor.ammo - 1);
          }
          this.spawnProjectile(
            room,
            actor,
            actor.facing + aimJitter,
            Math.round(21 * aiBuffs.damageDealMult),
            20,
            aiBuffs.splashRadius,
          );
          events.push({
            type: 'shot',
            shooterId: actor.id,
            team: actor.team,
            x: actor.pos.x + Math.sin(actor.facing) * 0.95,
            y: 1.08,
            z: actor.pos.z + Math.cos(actor.facing) * 0.95,
            isMega: aiBuffs.splashRadius > 0,
          });
          if (!aiBuffs.infiniteAmmo && actor.ammo === 0) {
            actor.reloading = true;
            actor.reloadTimer = RELOAD_DURATION * 1.2;
          }
        }
      }
    } else {
      actor.telegraphingBurst = false;
      if (dLen > 0.05) {
        const moveAng = Math.atan2(dirX, dirZ);
        actor.facing = lerpAngle(actor.facing, moveAng, 1 - Math.exp(-9 * dt));
      }
    }
  }

  private spawnProjectile(
    room: GameRoom,
    shooter: ActorState,
    angle: number,
    damage: number,
    speed: number,
    splashRadius: number,
  ): void {
    if (room.projectiles.length >= 120) return;
    room.projectiles.push({
      id: room.projectileSeq++,
      team: shooter.team,
      ownerId: shooter.id,
      x: shooter.pos.x + Math.sin(angle) * 0.95,
      y: 1.08,
      z: shooter.pos.z + Math.cos(angle) * 0.95,
      vx: Math.sin(angle) * speed,
      vy: 0.65,
      vz: Math.cos(angle) * speed,
      life: 1.5,
      damage,
      splashRadius,
    });
  }

  private stepProjectiles(room: GameRoom, dt: number, events: NetGameEvent[]): void {
    for (let i = room.projectiles.length - 1; i >= 0; i--) {
      const p = room.projectiles[i];
      p.life -= dt;
      p.vy -= 4.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (
        p.life <= 0 ||
        p.y <= 0.12 ||
        Math.abs(p.x) >= ARENA_HALF_W ||
        Math.abs(p.z) >= ARENA_HALF_D
      ) {
        const cx = Math.max(-ARENA_HALF_W + 0.5, Math.min(ARENA_HALF_W - 0.5, p.x));
        const cz = Math.max(-ARENA_HALF_D + 0.5, Math.min(ARENA_HALF_D - 0.5, p.z));
        if (p.splashRadius > 0) {
          this.detonateSplash(room, cx, Math.max(0.2, p.y), cz, p, null, events);
        } else {
          events.push({ type: 'splat_ground', x: cx, z: cz, team: p.team, scale: 0.95 });
        }
        room.projectiles.splice(i, 1);
        continue;
      }

      const hitOb = pointHitsObstacle(p.x, p.z, 0.14, ARENA_OBSTACLES);
      if (hitOb && p.y <= hitOb.height) {
        const dx = p.x - hitOb.x;
        const dz = p.z - hitOb.z;
        const normX = Math.abs(dx / (hitOb.width * 0.5));
        const normZ = Math.abs(dz / (hitOb.depth * 0.5));
        let nx = 0;
        let nz = 0;
        let sx = p.x;
        let sz = p.z;
        if (normX > normZ) {
          nx = dx >= 0 ? 1 : -1;
          sx = hitOb.x + nx * (hitOb.width * 0.5);
        } else {
          nz = dz >= 0 ? 1 : -1;
          sz = hitOb.z + nz * (hitOb.depth * 0.5);
        }
        events.push({
          type: 'splat_wall',
          x: sx,
          y: p.y,
          z: sz,
          nx,
          nz,
          team: p.team,
          shooterId: p.ownerId,
        });
        if (p.splashRadius > 0) {
          this.detonateSplash(room, sx, p.y, sz, p, null, events);
        }
        room.projectiles.splice(i, 1);
        continue;
      }

      let hitTarget: ActorState | null = null;
      for (const a of room.actors) {
        if (!a.alive || a.team === p.team) continue;
        const dx = a.pos.x - p.x;
        const dz = a.pos.z - p.z;
        const hitRad = a.radius + (p.splashRadius > 0 ? 0.36 : 0.24);
        if (dx * dx + dz * dz <= hitRad * hitRad) {
          hitTarget = a;
          break;
        }
      }

      if (hitTarget) {
        this.applyHit(room, hitTarget, p, events);
        if (p.splashRadius > 0) {
          this.detonateSplash(room, hitTarget.pos.x, 1.0, hitTarget.pos.z, p, hitTarget.id, events);
        }
        room.projectiles.splice(i, 1);
      }
    }
  }

  private detonateSplash(
    room: GameRoom,
    x: number,
    y: number,
    z: number,
    proj: ServerProjectile,
    directTargetId: string | null,
    events: NetGameEvent[],
  ): void {
    events.push({
      type: 'splash_boom',
      x,
      y,
      z,
      team: proj.team,
      shooterId: proj.ownerId,
    });
    const r = proj.splashRadius;
    const rSq = r * r;
    for (const a of room.actors) {
      if (!a.alive || a.team === proj.team || a.id === directTargetId) continue;
      const dx = a.pos.x - x;
      const dz = a.pos.z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= rSq) {
        const falloff = 1 - (Math.sqrt(dSq) / r) * 0.45;
        const splashDmg = Math.round(proj.damage * 0.72 * falloff);
        this.applyHit(room, a, { ...proj, damage: splashDmg, splashRadius: 0 }, events);
      }
    }
  }

  private applyHit(
    room: GameRoom,
    target: ActorState,
    proj: ServerProjectile,
    events: NetGameEvent[],
  ): void {
    const targetBuffs = getActorBuffEffects(target);
    const effectiveDamage = Math.max(1, Math.round(proj.damage * targetBuffs.damageTakenMult));
    target.hp = Math.max(0, target.hp - effectiveDamage);
    target.hitFlashTimer = 0.085;

    const spd = Math.hypot(proj.vx, proj.vz) || 1;
    const kb = (target.role === 'heavy' ? 1.8 : 3.2) * (targetBuffs.hasShield ? 0.65 : 1.0);
    target.vel.x += (proj.vx / spd) * kb;
    target.vel.z += (proj.vz / spd) * kb;

    const fatal = target.hp <= 0;
    events.push({
      type: 'hit',
      targetId: target.id,
      shooterId: proj.ownerId,
      team: proj.team,
      x: target.pos.x,
      z: target.pos.z,
      hasShield: targetBuffs.hasShield,
      fatal,
    });

    if (fatal) {
      target.alive = false;
      target.koTimer = KO_FALL_DURATION;
      target.respawnTimer = RESPAWN_TIME;
      target.telegraphingBurst = false;
      target.stunTimer = 0;

      const shooter = room.actors.find((a) => a.id === proj.ownerId);
      if (shooter) {
        shooter.tags += 1;
        const { becameReady } = registerKillForStunCharge(shooter);
        if (becameReady) {
          events.push({ type: 'stun_ready', actorId: shooter.id });
        }
      }

      events.push({
        type: 'splat_ground',
        x: target.pos.x,
        z: target.pos.z,
        team: proj.team,
        scale: 1.85,
      });

      const dropEv = dropFlagForActor(target, room.flags);
      if (dropEv) {
        events.push({
          type: 'flag_event',
          kind: 'drop',
          flagTeam: dropEv.flagTeam,
          actorId: target.id,
          actorTeam: target.team,
          actorName: target.name,
          pos: { ...dropEv.pos },
          cobaltScore: room.scores.cobalt,
          crimsonScore: room.scores.crimson,
        });
      }
    }
  }

  private respawnActor(actor: ActorState, events: NetGameEvent[]): void {
    const spawns = SPAWN_POINTS[actor.team];
    const sp = spawns[Math.floor(Math.random() * spawns.length)];
    actor.alive = true;
    actor.hp = actor.maxHp;
    actor.ammo = actor.maxAmmo;
    actor.reloading = false;
    actor.buffs = [];
    actor.stunTimer = 0;
    // Note: actor.stunKillsProgress & actor.stunActivations persist across death & respawn!
    actor.pos = { x: sp.x, z: sp.z };
    actor.vel = { x: 0, z: 0 };
    actor.facing = actor.team === 'cobalt' ? Math.PI / 2 : -Math.PI / 2;
    actor.hitFlashTimer = 0.14;
    events.push({
      type: 'respawn',
      actorId: actor.id,
      team: actor.team,
      x: actor.pos.x,
      z: actor.pos.z,
    });
  }

  private spawnPowerupDrop(
    room: GameRoom,
    forcedSpawnIndex?: number,
    forcedKind?: PowerupKind,
    startLanded = false,
  ): void {
    const spawnIndex =
      forcedSpawnIndex !== undefined ? forcedSpawnIndex : pickFreePowerupSpawnIndex(room.powerups);
    if (spawnIndex === null) return;

    const kinds: PowerupKind[] = ['turbo_boots', 'rapid_hopper', 'paint_shield', 'mega_splash'];
    const kind = forcedKind ?? kinds[room.powerupKindCursor++ % kinds.length];
    const pos = POWERUP_SPAWN_POINTS[spawnIndex];
    const id = `pw-${room.powerupSeq++}`;

    room.powerups.push({
      id,
      kind,
      pos: { x: pos.x, z: pos.z },
      altitude: startLanded ? 0 : 12.5,
      landed: startLanded,
      life: POWERUP_DROP_LIFETIME,
      maxLife: POWERUP_DROP_LIFETIME,
      spawnIndex,
    });
  }
}
