import type { ArenaObstacle, TeamId, Vec2 } from './types.ts';

/**
 * Playable arena dimensions in meters (world units).
 * Cobalt (Blue / Player Team) occupies West (-X); Crimson (Coral / Enemy Team) occupies East (+X).
 */
export const ARENA_HALF_W = 34; // 68m long
export const ARENA_HALF_D = 22; // 44m wide
export const SCORE_LIMIT = 3;
export const MATCH_DURATION_SEC = 240; // 4 minutes

export const BASE_POSITIONS: Record<TeamId, Vec2> = {
  cobalt: { x: -27.5, z: 0 },
  crimson: { x: 27.5, z: 0 },
};

export const FLAG_CAPTURE_RADIUS = 2.6;
export const FLAG_PICKUP_RADIUS = 1.65;
export const FLAG_AUTO_RETURN_TIME = 14; // seconds dropped before auto-returning

/**
 * Spawn points for each team (verified clear paths >= 4m wide, facing center midfield).
 */
export const SPAWN_POINTS: Record<TeamId, Vec2[]> = {
  cobalt: [
    { x: -21.8, z: 0 },
    { x: -26.2, z: -7.8 },
    { x: -26.2, z: 7.8 },
    { x: -29.0, z: -10.5 },
  ],
  crimson: [
    { x: 21.8, z: 0 },
    { x: 26.2, z: 7.8 },
    { x: 26.2, z: -7.8 },
    { x: 29.0, z: 10.5 },
  ],
};

/**
 * Symmetric tournament speedball & tactical timber bunker layout.
 * Designed for 3 distinct lanes (North flank, Center ridge, South flank) with generous sightlines
 * and wide corridors (>= 4.2m) so both human players and NPCs move fluidly without snagging.
 */
export const ARENA_OBSTACLES: ArenaObstacle[] = [
  // --- CENTER MIDFIELD LANDMARKS (High-value cover & dramatic silhouettes) ---
  {
    id: 'center_north_bunker',
    kind: 'bunker_inflatable',
    x: 0,
    z: -4.8,
    width: 3.4,
    depth: 2.2,
    height: 2.2,
    accent: 'neutral',
    blocksProjectiles: true,
  },
  {
    id: 'center_south_bunker',
    kind: 'bunker_inflatable',
    x: 0,
    z: 4.8,
    width: 3.4,
    depth: 2.2,
    height: 2.2,
    accent: 'neutral',
    blocksProjectiles: true,
  },
  {
    id: 'center_top_timber',
    kind: 'timber_wall',
    x: 0,
    z: -14.2,
    width: 5.4,
    depth: 1.3,
    height: 2.5,
    accent: 'neutral',
    blocksProjectiles: true,
  },
  {
    id: 'center_bottom_timber',
    kind: 'timber_wall',
    x: 0,
    z: 14.2,
    width: 5.4,
    depth: 1.3,
    height: 2.5,
    accent: 'neutral',
    blocksProjectiles: true,
  },

  // --- COBALT HALF (WEST, -X) ---
  // Forward speedball pods
  {
    id: 'cobalt_mid_nw',
    kind: 'bunker_inflatable',
    x: -10.5,
    z: -8.5,
    width: 2.8,
    depth: 3.2,
    height: 2.1,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  {
    id: 'cobalt_mid_sw',
    kind: 'bunker_inflatable',
    x: -10.5,
    z: 8.5,
    width: 2.8,
    depth: 3.2,
    height: 2.1,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  // Mid-lane crate stacks (tactical cover along central axis)
  {
    id: 'cobalt_center_crates',
    kind: 'crate_stack',
    x: -12.5,
    z: 0,
    width: 2.4,
    depth: 3.0,
    height: 1.9,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  // Flank timber barricades
  {
    id: 'cobalt_flank_n',
    kind: 'timber_wall',
    x: -19.5,
    z: -13.5,
    width: 4.6,
    depth: 1.2,
    height: 2.3,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  {
    id: 'cobalt_flank_s',
    kind: 'timber_wall',
    x: -19.5,
    z: 13.5,
    width: 4.6,
    depth: 1.2,
    height: 2.3,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  // Base Fort wing walls flanking Cobalt flag pedestal (leaves wide front & side approaches)
  {
    id: 'cobalt_fort_n',
    kind: 'fort_wall',
    x: -24.5,
    z: -4.0,
    width: 1.4,
    depth: 3.2,
    height: 2.6,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  {
    id: 'cobalt_fort_s',
    kind: 'fort_wall',
    x: -24.5,
    z: 4.0,
    width: 1.4,
    depth: 3.2,
    height: 2.6,
    accent: 'cobalt',
    blocksProjectiles: true,
  },
  {
    id: 'cobalt_back_pillar',
    kind: 'stone_pillar',
    x: -31.2,
    z: 0,
    width: 1.8,
    depth: 4.6,
    height: 3.0,
    accent: 'cobalt',
    blocksProjectiles: true,
  },

  // --- CRIMSON HALF (EAST, +X) — Exact mirror symmetry ---
  {
    id: 'crimson_mid_ne',
    kind: 'bunker_inflatable',
    x: 10.5,
    z: -8.5,
    width: 2.8,
    depth: 3.2,
    height: 2.1,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_mid_se',
    kind: 'bunker_inflatable',
    x: 10.5,
    z: 8.5,
    width: 2.8,
    depth: 3.2,
    height: 2.1,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_center_crates',
    kind: 'crate_stack',
    x: 12.5,
    z: 0,
    width: 2.4,
    depth: 3.0,
    height: 1.9,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_flank_n',
    kind: 'timber_wall',
    x: 19.5,
    z: -13.5,
    width: 4.6,
    depth: 1.2,
    height: 2.3,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_flank_s',
    kind: 'timber_wall',
    x: 19.5,
    z: 13.5,
    width: 4.6,
    depth: 1.2,
    height: 2.3,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_fort_n',
    kind: 'fort_wall',
    x: 24.5,
    z: -4.0,
    width: 1.4,
    depth: 3.2,
    height: 2.6,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_fort_s',
    kind: 'fort_wall',
    x: 24.5,
    z: 4.0,
    width: 1.4,
    depth: 3.2,
    height: 2.6,
    accent: 'crimson',
    blocksProjectiles: true,
  },
  {
    id: 'crimson_back_pillar',
    kind: 'stone_pillar',
    x: 31.2,
    z: 0,
    width: 1.8,
    depth: 4.6,
    height: 3.0,
    accent: 'crimson',
    blocksProjectiles: true,
  },
];

/**
 * Tactical patrol and flank waypoints for AI decision policies.
 */
export const FLANK_WAYPOINTS: Record<'north' | 'south', Vec2[]> = {
  north: [
    { x: -17, z: -17.5 },
    { x: 0, z: -18.2 },
    { x: 17, z: -17.5 },
  ],
  south: [
    { x: -17, z: 17.5 },
    { x: 0, z: 18.2 },
    { x: 17, z: 17.5 },
  ],
};

/**
 * Symmetric, obstacle-free tactical powerup drop zones across midfield, lanes, and flanks.
 */
export const POWERUP_SPAWN_POINTS: Vec2[] = [
  { x: 0, z: 0 },
  { x: -17.0, z: 0 },
  { x: 17.0, z: 0 },
  { x: 0, z: -9.8 },
  { x: 0, z: 9.8 },
  { x: -10.5, z: -16.8 },
  { x: 10.5, z: 16.8 },
  { x: -10.5, z: 16.8 },
  { x: 10.5, z: -16.8 },
];

export const POWERUP_PICKUP_RADIUS = 1.65;
export const POWERUP_MAX_ACTIVE = 3;
export const POWERUP_DROP_LIFETIME = 28; // seconds before an unclaimed drop expires

export interface PowerupMeta {
  label: string;
  shortDesc: string;
  duration: number;
  colorHex: number;
  accentCss: string;
  glowHex: number;
}

export const POWERUP_META: Record<import('./types').PowerupKind, PowerupMeta> = {
  turbo_boots: {
    label: 'TURBO SPRINT',
    shortDesc: '+35% Speed & Fast Dash',
    duration: 10,
    colorHex: 0x10b981,
    accentCss: '#10B981',
    glowHex: 0x34d399,
  },
  rapid_hopper: {
    label: 'OVERCLOCK',
    shortDesc: '2x Fire Rate & Infinite Ammo',
    duration: 9,
    colorHex: 0xf59e0b,
    accentCss: '#F59E0B',
    glowHex: 0xfcd34d,
  },
  paint_shield: {
    label: 'KEVLAR SHIELD',
    shortDesc: '+45 Armor & 40% Dmg Resist',
    duration: 11,
    colorHex: 0x06b6d4,
    accentCss: '#06B6D4',
    glowHex: 0x67e8f9,
  },
  mega_splash: {
    label: 'SPLASH CANNON',
    shortDesc: 'Explosive Paintball Blast',
    duration: 9,
    colorHex: 0xa855f7,
    accentCss: '#A855F7',
    glowHex: 0xd8b4fe,
  },
};
