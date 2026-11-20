import type {
  ActiveBuffState,
  DifficultyMode,
  FlagState,
  MatchStats,
  PowerupDropState,
  PowerupKind,
  TeamId,
  UnitRole,
  Vec2,
  WeatherKind,
} from './types.ts';

export interface RoomConfig {
  teamSize: 3 | 4;
  difficulty: DifficultyMode;
  fillBots: boolean;
}

export interface RoomPlayerInfo {
  id: string;
  name: string;
  team: TeamId;
  isHost: boolean;
}

export interface RoomLobbyState {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'gameover';
  config: RoomConfig;
  players: RoomPlayerInfo[];
}

export interface PlayerInputPacket {
  moveX: number;
  moveZ: number;
  aimAngle: number;
  firing: boolean;
  dash?: boolean;
  burst?: boolean;
  reload?: boolean;
  stunWave?: boolean;
}

export interface NetProjectile {
  id: number;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  splashRadius: number;
}

export interface NetActorSnapshot {
  id: string;
  name: string;
  team: TeamId;
  role: UnitRole;
  isHuman: boolean;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  radius: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  reloadTimer: number;
  burstCooldown: number;
  dashCooldown: number;
  dashTimer: number;
  alive: boolean;
  koTimer: number;
  respawnTimer: number;
  hitFlashTimer: number;
  recoilAmount: number;
  telegraphingBurst: boolean;
  buffs: ActiveBuffState[];
  stunTimer: number;
  stunKillsProgress: number;
  stunActivations: number;
  tags: number;
  captures: number;
  returns: number;
}

export type NetGameEvent =
  | {
      type: 'shot';
      shooterId: string;
      team: TeamId;
      x: number;
      y: number;
      z: number;
      isBurst?: boolean;
      isMega?: boolean;
    }
  | {
      type: 'dash';
      actorId: string;
      x: number;
      z: number;
      hasTurbo: boolean;
    }
  | {
      type: 'reload';
      actorId: string;
    }
  | {
      type: 'windup';
      actorId: string;
      targetId: string;
    }
  | {
      type: 'splat_ground';
      x: number;
      z: number;
      team: TeamId;
      scale: number;
      isSplash?: boolean;
    }
  | {
      type: 'splat_wall';
      x: number;
      y: number;
      z: number;
      nx: number;
      nz: number;
      team: TeamId;
      shooterId: string;
    }
  | {
      type: 'hit';
      targetId: string;
      shooterId: string;
      team: TeamId;
      x: number;
      z: number;
      hasShield: boolean;
      fatal: boolean;
    }
  | {
      type: 'splash_boom';
      x: number;
      y: number;
      z: number;
      team: TeamId;
      shooterId: string;
    }
  | {
      type: 'respawn';
      actorId: string;
      team: TeamId;
      x: number;
      z: number;
    }
  | {
      type: 'flag_event';
      kind: 'pickup' | 'return' | 'auto_return' | 'capture' | 'drop';
      flagTeam: TeamId;
      actorId?: string;
      actorTeam?: TeamId;
      actorName?: string;
      pos: Vec2;
      cobaltScore: number;
      crimsonScore: number;
    }
  | {
      type: 'powerup_event';
      kind: 'landed' | 'collected' | 'expired';
      powerupKind: PowerupKind;
      actorId?: string;
      actorTeam?: TeamId;
      pos: Vec2;
    }
  | {
      type: 'stun_wave';
      casterId: string;
      casterName: string;
      team: TeamId;
      x: number;
      z: number;
      radius: number;
      tier: number;
      affectedIds: string[];
    }
  | {
      type: 'stun_ready';
      actorId: string;
    }
  | {
      type: 'weather_shift';
      weather: WeatherKind;
    }
  | {
      type: 'banner';
      text: string;
      subtext: string;
      team: TeamId | 'neutral';
    };

export interface NetMatchSnapshot {
  tick: number;
  phase: 'playing' | 'gameover';
  scores: Record<TeamId, number>;
  matchTimeRemaining: number;
  elapsedMatchTime: number;
  weather: {
    current: WeatherKind;
    target: WeatherKind;
    blend: number;
  };
  flags: Record<TeamId, FlagState>;
  powerups: PowerupDropState[];
  actors: NetActorSnapshot[];
  projectiles: NetProjectile[];
  endStats: MatchStats | null;
}

export interface NetworkInfoResponse {
  port: number;
  lanUrls: string[];
  activeRooms: number;
  isPrivateDevPreview?: boolean;
  sharedAppUrl?: string | null;
}

export type ClientToServerMessage =
  | { type: 'create_room'; name: string }
  | { type: 'join_room'; code: string; name: string }
  | { type: 'switch_team'; team: TeamId }
  | { type: 'update_config'; config: Partial<RoomConfig> }
  | { type: 'start_match' }
  | { type: 'return_to_lobby' }
  | { type: 'leave_room' }
  | { type: 'input'; input: PlayerInputPacket };

export type ServerToClientMessage =
  | { type: 'room_joined'; playerId: string; room: RoomLobbyState; snapshot?: NetMatchSnapshot }
  | { type: 'room_state'; room: RoomLobbyState }
  | { type: 'match_started'; room: RoomLobbyState; snapshot: NetMatchSnapshot }
  | { type: 'state'; snapshot: NetMatchSnapshot; events: NetGameEvent[] }
  | { type: 'returned_to_lobby'; room: RoomLobbyState }
  | { type: 'error'; message: string };
