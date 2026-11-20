import type { WeatherKind } from './types.ts';

export interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

export interface WeatherAtmosphereParams {
  sky: RgbTuple;
  fog: RgbTuple;
  fogDensity: number;
  sunColor: RgbTuple;
  sunIntensity: number;
  hemiSky: RgbTuple;
  hemiGround: RgbTuple;
  hemiIntensity: number;
  rimColor: RgbTuple;
  rimIntensity: number;
  exposure: number;
  pollenColor: RgbTuple;
  pollenOpacity: number;
  mistOpacity: number;
  cloudShadowOpacity: number;
}

export const WEATHER_SEQUENCE: WeatherKind[] = ['clear', 'overcast', 'light_fog'];

export const WEATHER_HOLD_DURATION = 34; // seconds spent in each weather state before shifting
export const WEATHER_TRANSITION_DURATION = 7.5; // silky cross-fade seconds between weather states

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Sunlit Clear',
  overcast: 'High Overcast',
  light_fog: 'Canyon Mist',
};

function hexToRgb(hex: number): RgbTuple {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

/**
 * Hand-tuned golden-hour alpine weather presets preserving crisp figure-ground contrast
 * and team readability (Cobalt Blue vs. Crimson Coral) in every atmospheric state.
 */
export const WEATHER_PRESETS: Record<WeatherKind, WeatherAtmosphereParams> = {
  clear: {
    sky: hexToRgb(0x9fc5e2),
    fog: hexToRgb(0x9fc5e2),
    fogDensity: 0.0058,
    sunColor: hexToRgb(0xffe7b8),
    sunIntensity: 2.22,
    hemiSky: hexToRgb(0x78b6dc),
    hemiGround: hexToRgb(0x3b3022),
    hemiIntensity: 0.74,
    rimColor: hexToRgb(0xaad6ff),
    rimIntensity: 0.58,
    exposure: 1.01,
    pollenColor: hexToRgb(0xffe8a6),
    pollenOpacity: 0.58,
    mistOpacity: 0.0,
    cloudShadowOpacity: 0.0,
  },
  overcast: {
    sky: hexToRgb(0x8fa3b4),
    fog: hexToRgb(0x93a7b8),
    fogDensity: 0.0096,
    sunColor: hexToRgb(0xdce6f2),
    sunIntensity: 1.18,
    hemiSky: hexToRgb(0xa6bdd0),
    hemiGround: hexToRgb(0x3c4338),
    hemiIntensity: 1.05,
    rimColor: hexToRgb(0xc7dcf0),
    rimIntensity: 0.42,
    exposure: 0.94,
    pollenColor: hexToRgb(0xdbe7f2),
    pollenOpacity: 0.34,
    mistOpacity: 0.14,
    cloudShadowOpacity: 0.22,
  },
  light_fog: {
    sky: hexToRgb(0xc9d7df),
    fog: hexToRgb(0xc6d5dd),
    fogDensity: 0.0172,
    sunColor: hexToRgb(0xfff0d4),
    sunIntensity: 1.48,
    hemiSky: hexToRgb(0xc2d5e0),
    hemiGround: hexToRgb(0x4c5448),
    hemiIntensity: 1.08,
    rimColor: hexToRgb(0xe2eef5),
    rimIntensity: 0.52,
    exposure: 0.98,
    pollenColor: hexToRgb(0xeef6fa),
    pollenOpacity: 0.52,
    mistOpacity: 0.44,
    cloudShadowOpacity: 0.08,
  },
};

export interface WeatherCycleState {
  current: WeatherKind;
  target: WeatherKind;
  /** 0..1 blend between current and target */
  blend: number;
  holdTimer: number;
  locked: boolean;
}

export function createWeatherCycle(initial: WeatherKind = 'clear', locked = false): WeatherCycleState {
  return {
    current: initial,
    target: initial,
    blend: 1,
    holdTimer: WEATHER_HOLD_DURATION,
    locked,
  };
}

export function getNextWeather(kind: WeatherKind): WeatherKind {
  const idx = WEATHER_SEQUENCE.indexOf(kind);
  return WEATHER_SEQUENCE[(idx + 1) % WEATHER_SEQUENCE.length];
}

export function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: RgbTuple, b: RgbTuple, t: number): RgbTuple {
  return {
    r: lerpNum(a.r, b.r, t),
    g: lerpNum(a.g, b.g, t),
    b: lerpNum(a.b, b.b, t),
  };
}

/**
 * Pure deterministic weather progression. Returns whether a new weather transition just began.
 */
export function stepWeatherCycle(
  state: WeatherCycleState,
  dt: number,
  holdDuration = WEATHER_HOLD_DURATION,
  transitionDuration = WEATHER_TRANSITION_DURATION,
): { startedTransitionTo: WeatherKind | null } {
  if (state.locked) {
    return { startedTransitionTo: null };
  }

  if (state.current !== state.target) {
    state.blend = Math.min(1, state.blend + dt / Math.max(0.01, transitionDuration));
    if (state.blend >= 1) {
      state.current = state.target;
      state.blend = 1;
      state.holdTimer = holdDuration;
    }
    return { startedTransitionTo: null };
  }

  state.holdTimer -= dt;
  if (state.holdTimer <= 0) {
    const next = getNextWeather(state.current);
    state.target = next;
    state.blend = 0;
    state.holdTimer = holdDuration;
    return { startedTransitionTo: next };
  }

  return { startedTransitionTo: null };
}

/**
 * Computes the current smoothly blended weather atmosphere values.
 */
export function evaluateWeatherAtmosphere(state: WeatherCycleState): WeatherAtmosphereParams {
  const from = WEATHER_PRESETS[state.current];
  const to = WEATHER_PRESETS[state.target];
  const t = state.current === state.target ? 1 : smoothstep01(state.blend);

  return {
    sky: lerpRgb(from.sky, to.sky, t),
    fog: lerpRgb(from.fog, to.fog, t),
    fogDensity: lerpNum(from.fogDensity, to.fogDensity, t),
    sunColor: lerpRgb(from.sunColor, to.sunColor, t),
    sunIntensity: lerpNum(from.sunIntensity, to.sunIntensity, t),
    hemiSky: lerpRgb(from.hemiSky, to.hemiSky, t),
    hemiGround: lerpRgb(from.hemiGround, to.hemiGround, t),
    hemiIntensity: lerpNum(from.hemiIntensity, to.hemiIntensity, t),
    rimColor: lerpRgb(from.rimColor, to.rimColor, t),
    rimIntensity: lerpNum(from.rimIntensity, to.rimIntensity, t),
    exposure: lerpNum(from.exposure, to.exposure, t),
    pollenColor: lerpRgb(from.pollenColor, to.pollenColor, t),
    pollenOpacity: lerpNum(from.pollenOpacity, to.pollenOpacity, t),
    mistOpacity: lerpNum(from.mistOpacity, to.mistOpacity, t),
    cloudShadowOpacity: lerpNum(from.cloudShadowOpacity, to.cloudShadowOpacity, t),
  };
}
