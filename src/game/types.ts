export type TeamId = 'cobalt' | 'crimson';

export type UnitRole = 'striker' | 'heavy' | 'defender';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type FlagStatus = 'home' | 'carried' | 'dropped';

export type DifficultyMode = 'standard' | 'veteran';

export interface Vec2 {
  x: number;
  z: number;
}

export type ObstacleKind =
  | 'bunker_inflatable'
  | 'timber_wall'
  | 'crate_stack'
  | 'stone_pillar'
  | 'fort_wall';

export interface ArenaObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Team accent if tied to a side, or neutral */
  accent?: TeamId | 'neutral';
  /** Low cover blocks movement and crouching shots, tall cover blocks all paintballs */
  blocksProjectiles: boolean;
}

export interface FlagState {
  team: TeamId;
  status: FlagStatus;
  homePos: Vec2;
  pos: Vec2;
  carrierId: string | null;
  droppedTimer: number;
}

export type WeatherKind = 'clear' | 'overcast' | 'light_fog';

export type PowerupKind = 'turbo_boots' | 'rapid_hopper' | 'paint_shield' | 'mega_splash';

export interface ActiveBuffState {
  kind: PowerupKind;
  remaining: number;
  duration: number;
}

export interface PowerupDropState {
  id: string;
  kind: PowerupKind;
  pos: Vec2;
  /** Air-drop vertical altitude (descends from 14m to 0m on spawn) */
  altitude: number;
  landed: boolean;
  /** Despawn countdown once landed so field stays fresh */
  life: number;
  maxLife: number;
  spawnIndex: number;
}

export interface MinimapPowerup {
  id: string;
  kind: PowerupKind;
  x: number;
  z: number;
  landed: boolean;
}

export interface ActorState {
  id: string;
  name: string;
  team: TeamId;
  role: UnitRole;
  isPlayer: boolean;
  isHuman?: boolean;
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
  fireCooldown: number;
  burstCooldown: number;
  dashCooldown: number;
  dashTimer: number;
  dashDir: Vec2;
  alive: boolean;
  koTimer: number;
  respawnTimer: number;
  hitFlashTimer: number;
  recoilAmount: number;
  gaitPhase: number;
  windupTimer: number;
  telegraphingBurst: boolean;
  aiWaypoint: Vec2 | null;
  aiStrafeDir: number;
  aiThinkTimer: number;
  buffs: ActiveBuffState[];
  stunTimer: number;
  stunKillsProgress: number;
  stunActivations: number;
  tags: number;
  captures: number;
  returns: number;
}

export interface MinimapActor {
  id: string;
  team: TeamId;
  isPlayer: boolean;
  isHuman?: boolean;
  x: number;
  z: number;
  alive: boolean;
  carryingFlag: boolean;
}

export interface MatchBanner {
  id: number;
  text: string;
  subtext: string;
  team: TeamId | 'neutral';
}

export interface MatchStats {
  winner: TeamId | 'draw';
  cobaltScore: number;
  crimsonScore: number;
  elapsedSeconds: number;
  playerTags: number;
  playerCaptures: number;
  playerReturns: number;
  teamTags: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  localTeam: TeamId;
  isMultiplayer: boolean;
  roomCode: string | null;
  isHost: boolean;
  connectedPlayers: number;
  cobaltScore: number;
  crimsonScore: number;
  scoreLimit: number;
  matchTimeRemaining: number;
  cobaltFlag: FlagStatus;
  crimsonFlag: FlagStatus;
  weather: WeatherKind;
  weatherTransitioning: boolean;
  playerHp: number;
  playerMaxHp: number;
  playerAlive: boolean;
  playerRespawnTimer: number;
  playerAmmo: number;
  playerMaxAmmo: number;
  playerReloading: boolean;
  playerReloadProgress: number;
  playerDashReady: number; // 0..1
  playerBurstReady: number; // 0..1
  playerCarryingFlag: boolean;
  playerBuffs: ActiveBuffState[];
  playerStunTimer: number;
  playerStunKills: number;
  playerStunKillsRequired: number;
  playerStunReady: boolean;
  playerStunRadius: number;
  playerStunTier: number;
  playerTags: number;
  playerCaptures: number;
  muted: boolean;
  banner: MatchBanner | null;
  minimapActors: MinimapActor[];
  minimapPowerups: MinimapPowerup[];
  cobaltFlagPos: Vec2;
  crimsonFlagPos: Vec2;
  endStats: MatchStats | null;
}

export interface MatchConfig {
  teamSize: 3 | 4;
  difficulty: DifficultyMode;
}
