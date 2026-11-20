import React from 'react';
import { ARENA_HALF_D, ARENA_HALF_W, ARENA_OBSTACLES, BASE_POSITIONS, POWERUP_META } from '../game/arenaData';
import type { FlagStatus, HudSnapshot, PowerupKind, WeatherKind } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onRestart: () => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function flagStatusLabel(status: FlagStatus): string {
  if (status === 'home') return 'Home';
  if (status === 'carried') return 'Taken';
  return 'Dropped';
}

const FlagIconSvg: React.FC<{ color: string; status: FlagStatus }> = ({ color, status }) => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
    <line x1="5" y1="3" x2="5" y2="21" stroke="#E2E8F0" strokeWidth="2.2" strokeLinecap="round" />
    <path
      d="M6.5 4.5 L20 7.5 L16 11 L20 14.5 L6.5 14.5 Z"
      fill={status === 'home' ? color : status === 'dropped' ? '#FACC15' : 'none'}
      stroke={status === 'carried' ? color : '#0F172A'}
      strokeWidth={status === 'carried' ? '2.2' : '1.4'}
    />
  </svg>
);

const ShieldPipSvg: React.FC<{ state: 'full' | 'cracked' | 'empty' }> = ({ state }) => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" aria-hidden="true">
    <path
      d="M12 2.5 L20 5.8 V11.8 C20 16.6 16.5 20.1 12 21.8 C7.5 20.1 4 16.6 4 11.8 V5.8 Z"
      fill={state === 'full' ? '#38BDF8' : state === 'cracked' ? '#F59E0B' : 'rgba(15, 23, 34, 0.7)'}
      stroke="#0B111A"
      strokeWidth="2.2"
    />
    {state === 'full' && (
      <path d="M12 4.8 L17.5 7.1 V11.4 C17.5 14.2 15.6 16.6 12 18.2 V4.8 Z" fill="#7DD3FC" opacity="0.45" />
    )}
    {state === 'cracked' && (
      <path d="M13.5 5.5 L10.5 11 L13.8 13 L10.2 19" stroke="#0B111A" strokeWidth="2" fill="none" />
    )}
    {state === 'empty' && (
      <path
        d="M12 4.8 L18 7.2 V11.8 C18 15.4 15.4 18.2 12 19.6 C8.6 18.2 6 15.4 6 11.8 V7.2 Z"
        fill="none"
        stroke="rgba(148,163,184,0.38)"
        strokeWidth="1.2"
      />
    )}
  </svg>
);

const WeatherIconSvg: React.FC<{ weather: WeatherKind }> = ({ weather }) => {
  if (weather === 'clear') {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#FCD34D] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <path d="M12 2.5v2.2M12 19.3v2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (weather === 'overcast') {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#CBD5E1] shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M6.8 18h10.8a4.2 4.2 0 0 0 .6-8.35A5.5 5.5 0 0 0 7.7 8.1 3.9 3.9 0 0 0 6.8 18Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#BAE6FD] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 9h14M6 13h14M3 17h13" />
    </svg>
  );
};

function weatherShortLabel(weather: WeatherKind): string {
  if (weather === 'clear') return 'CLEAR';
  if (weather === 'overcast') return 'OVERCAST';
  return 'MIST';
}

const PowerupIconSvg: React.FC<{ kind: PowerupKind; color: string }> = ({ kind, color }) => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'turbo_boots' && <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={color} />}
    {kind === 'rapid_hopper' && (
      <>
        <rect x="6" y="4" width="5" height="16" rx="2" fill={color} />
        <rect x="13" y="4" width="5" height="16" rx="2" fill={color} />
      </>
    )}
    {kind === 'paint_shield' && (
      <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6l7-3z" fill={color} />
    )}
    {kind === 'mega_splash' && (
      <>
        <circle cx="12" cy="12" r="5" fill={color} />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.2 2.2M16.8 16.8L19 19M19 5l-2.2 2.2M7.2 16.8L5 19" />
      </>
    )}
  </svg>
);

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  onTogglePause,
  onToggleMute,
  onRestart,
}) => {
  // 5 discrete vitality shield pips derived from live player HP
  const pipCount = 5;
  const hpPerPip = hud.playerMaxHp / pipCount;
  const pips: Array<'full' | 'cracked' | 'empty'> = [];
  for (let i = 0; i < pipCount; i++) {
    const pipFloor = i * hpPerPip;
    const pipFill = hud.playerHp - pipFloor;
    if (pipFill >= hpPerPip * 0.65) pips.push('full');
    else if (pipFill > 0) pips.push('cracked');
    else pips.push('empty');
  }

  // Subtle low-HP crimson screen edge vignette
  const lowHp = hud.playerAlive && hud.playerHp <= hud.playerMaxHp * 0.35;
  const isCrimsonLocal = hud.localTeam === 'crimson';
  const homeBaseLabel = isCrimsonLocal ? 'Crimson Base' : 'Cobalt Base';
  const enemyFlagLabel = isCrimsonLocal ? 'COBALT FLAG' : 'CRIMSON FLAG';
  const teamAccentPrimary = isCrimsonLocal ? '#E6452E' : '#2563EB';
  const teamAccentLight = isCrimsonLocal ? '#FB923C' : '#38BDF8';
  const teamLabelText = isCrimsonLocal ? 'text-[#FDBA74]' : 'text-[#93C5FD]';

  // Minimap coordinate mapping: 68m x 44m -> 170 x 110 SVG viewBox
  const mapX = (wx: number) => ((wx + ARENA_HALF_W) / (ARENA_HALF_W * 2)) * 170;
  const mapY = (wz: number) => ((wz + ARENA_HALF_D) / (ARENA_HALF_D * 2)) * 110;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Low-HP peripheral warning vignette */}
      {lowHp && hud.playerStunTimer <= 0 && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-200"
          style={{
            boxShadow: 'inset 0 0 90px rgba(230, 69, 46, 0.55)',
          }}
        />
      )}

      {/* Electric Stun Shockwave locked peripheral vignette */}
      {hud.playerAlive && hud.playerStunTimer > 0 && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-150"
          style={{
            boxShadow: 'inset 0 0 110px rgba(34, 211, 238, 0.65)',
          }}
        />
      )}

      {/* TOP-CENTER: World-Matched Tournament Scoreboard Plaque */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-0 rounded-lg overflow-hidden shadow-[0_8px_24px_rgba(7,12,18,0.5)] border border-white/15 bg-[#101822]/92">
        {/* Cobalt Side */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#163161]/90">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5">
              <FlagIconSvg color="#38BDF8" status={hud.cobaltFlag} />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#93C5FD]">
                Cobalt
              </span>
            </div>
            <span className="text-[11px] font-medium text-[#CBD5E1]">
              Flag: {flagStatusLabel(hud.cobaltFlag)}
            </span>
          </div>
          <span
            data-testid="cobalt-score"
            className="font-display font-extrabold text-4xl leading-none text-white font-mono-num hud-text-stroke"
          >
            {hud.cobaltScore}
          </span>
        </div>

        {/* Center Match Clock & Dynamic Weather Readout */}
        <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-[#0D131B] border-x border-white/10 min-w-[96px]">
          <span className="font-mono-num text-lg font-bold text-[#F8FAFC] leading-tight">
            {formatClock(hud.matchTimeRemaining)}
          </span>
          <div
            data-testid="weather-indicator"
            className="flex items-center gap-1 mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#CBD5E1]"
          >
            <WeatherIconSvg weather={hud.weather} />
            <span>{weatherShortLabel(hud.weather)}</span>
          </div>
        </div>

        {/* Crimson Side */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#5E1D15]/90">
          <span
            data-testid="crimson-score"
            className="font-display font-extrabold text-4xl leading-none text-white font-mono-num hud-text-stroke"
          >
            {hud.crimsonScore}
          </span>
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#FDBA74]">
                Crimson
              </span>
              <FlagIconSvg color="#FB923C" status={hud.crimsonFlag} />
            </div>
            <span className="text-[11px] font-medium text-[#CBD5E1]">
              Flag: {flagStatusLabel(hud.crimsonFlag)}
            </span>
          </div>
        </div>
      </div>

      {/* TOP-RIGHT: Room Badge (if multiplayer) + Compact Square Utility Controls */}
      <div className="fixed top-4 right-4 flex items-center gap-2 pointer-events-auto">
        {hud.isMultiplayer && hud.roomCode && (
          <div
            data-testid="hud-room-badge"
            className="h-10 px-3 rounded-lg bg-[#101822]/92 border border-white/15 flex items-center gap-2 text-xs font-bold text-[#E2E8F0]"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: teamAccentLight }}
            />
            <span className="font-mono-num tracking-wider text-[#FEF08A]">{hud.roomCode}</span>
            <span className="text-[#94A3B8] font-mono-num">{hud.connectedPlayers}P</span>
          </div>
        )}

        <button
          type="button"
          tabIndex={-1}
          aria-label={hud.muted ? 'Unmute audio' : 'Mute audio'}
          title={hud.muted ? 'Unmute (M)' : 'Mute (M)'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#101822]/90 hover:bg-[#1C2838] border border-white/15 text-[#E2E8F0] transition-colors cursor-pointer"
        >
          {hud.muted ? (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <line x1="22" y1="9" x2="16" y2="15" />
              <line x1="16" y1="9" x2="22" y2="15" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          )}
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label={hud.isMultiplayer ? 'Match menu' : 'Pause match'}
          title={hud.isMultiplayer ? 'Match Menu (Esc)' : 'Pause (P)'}
          onClick={(e) => {
            e.currentTarget.blur();
            onTogglePause();
          }}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#101822]/90 hover:bg-[#1C2838] border border-white/15 text-[#E2E8F0] transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <rect x="6" y="5" width="4.5" height="14" rx="1" />
            <rect x="13.5" y="5" width="4.5" height="14" rx="1" />
          </svg>
        </button>

        {!hud.isMultiplayer && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Restart match"
            title="Restart Match"
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#101822]/90 hover:bg-[#1C2838] border border-white/15 text-[#E2E8F0] transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="3 3 3 8 8 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* TRANSIENT MATCH EVENT CALLOUT BANNER */}
      {hud.banner && (
        <div
          key={hud.banner.id}
          className="fixed top-24 left-1/2 animate-callout pointer-events-none text-center px-6 py-2.5 rounded-lg border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          style={{
            backgroundColor:
              hud.banner.team === 'cobalt'
                ? 'rgba(18, 45, 98, 0.94)'
                : hud.banner.team === 'crimson'
                  ? 'rgba(104, 28, 20, 0.94)'
                  : 'rgba(16, 24, 34, 0.94)',
            borderColor:
              hud.banner.team === 'cobalt'
                ? 'rgba(56, 189, 248, 0.55)'
                : hud.banner.team === 'crimson'
                  ? 'rgba(251, 146, 60, 0.55)'
                  : 'rgba(255, 255, 255, 0.2)',
          }}
        >
          <div className="font-display font-extrabold text-2xl tracking-wide text-white leading-tight">
            {hud.banner.text}
          </div>
          <div className="text-xs font-medium text-[#E2E8F0]">{hud.banner.subtext}</div>
        </div>
      )}

      {/* CARRYING FLAG OBJECTIVE ALERT (Top-Left Quiet Strip) */}
      {hud.playerCarryingFlag && (
        <div
          className={`fixed top-4 left-4 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2.5 border ${
            isCrimsonLocal
              ? 'bg-[#173A7A]/94 border-[#93C5FD]/60'
              : 'bg-[#9A281A]/94 border-[#FDBA74]/60'
          }`}
        >
          <FlagIconSvg color={isCrimsonLocal ? '#38BDF8' : '#FB923C'} status="home" />
          <div>
            <div className="font-display font-bold text-lg leading-none text-white tracking-wide">
              CARRYING {enemyFlagLabel}
            </div>
            <div className={`text-[11px] ${isCrimsonLocal ? 'text-[#BFDBFE]' : 'text-[#FED7AA]'}`}>
              Return to {homeBaseLabel} to score
            </div>
          </div>
        </div>
      )}

      {/* TAGGED OUT RESPAWN COUNTDOWN */}
      {!hud.playerAlive && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-xl bg-[#101822]/92 border border-[#FB923C]/45 text-center shadow-2xl">
          <div className="font-display font-extrabold text-3xl text-[#FB923C] tracking-wide">
            TAGGED OUT
          </div>
          <div className="text-sm text-[#E2E8F0] mt-1 font-mono-num">
            Respawning at {homeBaseLabel} in {hud.playerRespawnTimer.toFixed(1)}s
          </div>
        </div>
      )}

      {/* STUNNED STATUS ALERT (No Movement / No Shooting) */}
      {hud.playerAlive && hud.playerStunTimer > 0 && (
        <div
          data-testid="stunned-alert"
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-3.5 rounded-xl bg-[#0B1726]/95 border border-[#38BDF8]/75 text-center shadow-[0_12px_32px_rgba(8,24,44,0.65)]"
        >
          <div className="font-display font-extrabold text-3xl text-[#38BDF8] tracking-wider leading-none">
            STUNNED
          </div>
          <div className="text-xs font-semibold text-[#E0F2FE] mt-1.5 font-mono-num">
            Movement &amp; shooting locked · {hud.playerStunTimer.toFixed(1)}s
          </div>
        </div>
      )}

      {/* BOTTOM-LEFT: Active Powerup Buffs + Vitality Shields, Paintball Hopper & Tactical Cooldowns */}
      <div className="fixed bottom-4 left-4 flex flex-col items-start gap-2.5">
        {hud.playerBuffs.length > 0 && (
          <div data-testid="active-buffs" className="flex flex-wrap items-center gap-2">
            {hud.playerBuffs.map((buff) => {
              const meta = POWERUP_META[buff.kind];
              const pct = Math.max(0.03, Math.min(1, buff.remaining / buff.duration));
              return (
                <div
                  key={buff.kind}
                  className="px-3 py-1.5 rounded-lg bg-[#0E1620]/94 border shadow-[0_6px_18px_rgba(7,12,18,0.5)] min-w-[146px]"
                  style={{ borderColor: `${meta.accentCss}88` }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <PowerupIconSvg kind={buff.kind} color={meta.accentCss} />
                      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-white">
                        {meta.label}
                      </span>
                    </div>
                    <span className="font-mono-num text-[10px] font-bold text-[#CBD5E1]">
                      {buff.remaining.toFixed(1)}s
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/12 overflow-hidden">
                    <div
                      className="h-full rounded-full origin-left transition-transform duration-75"
                      style={{
                        transform: `scaleX(${pct})`,
                        backgroundColor: meta.accentCss,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-3">
        <div className="relative overflow-hidden px-4 py-3 rounded-lg bg-[#0E1620]/94 border border-white/15 shadow-[0_10px_28px_rgba(7,12,18,0.55)] min-w-[272px]">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ backgroundColor: teamAccentPrimary }}
          />
          {/* Armor Shield Pips Row */}
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${teamLabelText}`}>
              Armor · {hud.localTeam}
            </span>
            <span className="font-mono-num text-xs font-bold text-[#F1F5F9]">
              {hud.playerHp} / {hud.playerMaxHp}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-3">
            {pips.map((st, idx) => (
              <ShieldPipSvg key={idx} state={st} />
            ))}
          </div>

          {/* Ability Cooldowns: Dash [Shift] & Tri-Burst [E] */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between text-[10px] font-semibold text-[#CBD5E1] mb-1">
                <span>Dash</span>
                <span className="px-1 py-0.5 rounded bg-white/8 text-[9px] text-[#CBD5E1] font-mono-num">
                  SHIFT
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/12 overflow-hidden">
                <div
                  className="h-full rounded-full transition-transform duration-75 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0.02, hud.playerDashReady)})`,
                    backgroundColor: hud.playerDashReady >= 0.99 ? '#38BDF8' : '#64748B',
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[10px] font-semibold text-[#CBD5E1] mb-1">
                <span>Tri-Burst</span>
                <span className="px-1 py-0.5 rounded bg-white/8 text-[9px] text-[#CBD5E1] font-mono-num">
                  E
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/12 overflow-hidden">
                <div
                  className="h-full rounded-full transition-transform duration-75 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0.02, hud.playerBurstReady)})`,
                    backgroundColor: hud.playerBurstReady >= 0.99 ? '#FACC15' : '#64748B',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Kill-Earned Stun Shockwave [Q] (Carries Across Respawn · Radius Grows Per Use) */}
          <div
            data-testid="stun-wave-hud"
            className={`mt-3 pt-2.5 border-t ${
              hud.playerStunReady ? 'border-[#38BDF8]/45' : 'border-white/10'
            }`}
          >
            <div className="flex items-center justify-between text-[10px] font-semibold mb-1.5">
              <div className="flex items-center gap-1.5">
                <svg
                  viewBox="0 0 24 24"
                  className={`w-3.5 h-3.5 shrink-0 ${
                    hud.playerStunReady ? 'text-[#38BDF8]' : 'text-[#94A3B8]'
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                </svg>
                <span className={hud.playerStunReady ? 'text-[#7DD3FC] font-extrabold tracking-wide' : 'text-[#CBD5E1]'}>
                  {hud.playerStunReady ? 'STUN WAVE READY' : 'Stun Wave'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono-num">
                <span
                  data-testid="stun-wave-radius"
                  className="text-[10px] text-[#94A3B8]"
                  title="Shockwave radius increases every time you activate it"
                >
                  Lv.{hud.playerStunTier} · {hud.playerStunRadius.toFixed(1)}m
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    hud.playerStunReady
                      ? 'bg-[#38BDF8] text-[#081320]'
                      : 'bg-white/8 text-[#CBD5E1]'
                  }`}
                >
                  Q
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {Array.from({ length: hud.playerStunKillsRequired }).map((_, idx) => {
                const filled = idx < hud.playerStunKills;
                return (
                  <div
                    key={idx}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      filled
                        ? hud.playerStunReady
                          ? 'bg-[#38BDF8] shadow-[0_0_8px_rgba(56,189,248,0.85)]'
                          : 'bg-[#FACC15]'
                        : 'bg-white/12'
                    }`}
                  />
                );
              })}
              <span
                data-testid="stun-wave-kills"
                className={`ml-1 text-[10px] font-mono-num font-bold ${
                  hud.playerStunReady ? 'text-[#38BDF8]' : 'text-[#94A3B8]'
                }`}
              >
                {hud.playerStunKills}/{hud.playerStunKillsRequired}
              </span>
            </div>
          </div>
        </div>

        {/* Paintball Hopper Readout */}
        <div className="relative overflow-hidden px-4 py-3 rounded-lg bg-[#0E1620]/94 border border-white/15 shadow-[0_10px_28px_rgba(7,12,18,0.55)] min-w-[132px]">
          <div
            className="absolute top-0 left-0 right-0 h-[3px]"
            style={{ backgroundColor: teamAccentLight }}
          />
          <div className={`flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] ${teamLabelText} mb-1`}>
            <span>Hopper</span>
            <span className="px-1 py-0.5 rounded bg-white/8 text-[9px] text-[#CBD5E1] font-mono-num">
              R
            </span>
          </div>
          {hud.playerReloading ? (
            <div>
              <div className="font-display font-bold text-xl text-[#FACC15] leading-tight">
                RELOADING
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/12 overflow-hidden mt-1.5">
                <div
                  className="h-full bg-[#FACC15] origin-left"
                  style={{ transform: `scaleX(${Math.max(0.05, hud.playerReloadProgress)})` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <span
                data-testid="player-ammo"
                className={`font-display font-extrabold text-3xl leading-none font-mono-num ${
                  hud.playerAmmo <= 5 ? 'text-[#FB923C]' : 'text-white'
                }`}
              >
                {hud.playerAmmo}
              </span>
              <span className="text-xs font-mono-num text-[#94A3B8]">/ {hud.playerMaxAmmo}</span>
            </div>
          )}
          <div className="text-[11px] text-[#94A3B8] mt-1 font-mono-num">
            Tags: <span className="text-[#F1F5F9] font-semibold">{hud.playerTags}</span>
          </div>
        </div>
        </div>
      </div>

      {/* BOTTOM-RIGHT: Real Geometry Tactical Arena Minimap */}
      <div className="fixed bottom-4 right-4 p-2 rounded-lg bg-[#101822]/92 border border-white/15 shadow-[0_8px_24px_rgba(7,12,18,0.5)]">
        <svg
          viewBox="0 0 170 110"
          className="w-[176px] h-[114px] block rounded"
          aria-label="Arena tactical minimap"
        >
          {/* Turf field background */}
          <rect x="0" y="0" width="170" height="110" fill="#293B25" />
          {/* Midfield chalk line & circle */}
          <line x1="85" y1="0" x2="85" y2="110" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
          <circle cx="85" cy="55" r="11" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />

          {/* Base capture zones */}
          <circle
            cx={mapX(BASE_POSITIONS.cobalt.x)}
            cy={mapY(BASE_POSITIONS.cobalt.z)}
            r="8"
            fill="rgba(37, 99, 235, 0.32)"
            stroke="#38BDF8"
            strokeWidth="1"
          />
          <circle
            cx={mapX(BASE_POSITIONS.crimson.x)}
            cy={mapY(BASE_POSITIONS.crimson.z)}
            r="8"
            fill="rgba(230, 69, 46, 0.32)"
            stroke="#FB923C"
            strokeWidth="1"
          />

          {/* Real arena bunkers & walls */}
          {ARENA_OBSTACLES.map((ob) => {
            const w = (ob.width / (ARENA_HALF_W * 2)) * 170;
            const h = (ob.depth / (ARENA_HALF_D * 2)) * 110;
            return (
              <rect
                key={ob.id}
                x={mapX(ob.x) - w * 0.5}
                y={mapY(ob.z) - h * 0.5}
                width={w}
                height={h}
                rx="1"
                fill={
                  ob.accent === 'cobalt'
                    ? '#4B6B9B'
                    : ob.accent === 'crimson'
                      ? '#9A574B'
                      : '#8D8675'
                }
              />
            );
          })}

          {/* Live Actors */}
          {hud.minimapActors
            .filter((a) => a.alive)
            .map((a) => (
              <g key={a.id} transform={`translate(${mapX(a.x)}, ${mapY(a.z)})`}>
                {a.carryingFlag && (
                  <circle r="5.5" fill="none" stroke="#FACC15" strokeWidth="1.5" />
                )}
                <circle
                  r={a.isPlayer ? 3.8 : 2.8}
                  fill={a.isPlayer ? '#FEF08A' : a.team === 'cobalt' ? '#38BDF8' : '#FB7185'}
                  stroke="#0B111A"
                  strokeWidth="1"
                />
              </g>
            ))}

          {/* Field Powerup Drop Markers */}
          {hud.minimapPowerups.map((pw) => {
            const color = POWERUP_META[pw.kind].accentCss;
            const px = mapX(pw.x);
            const py = mapY(pw.z);
            return (
              <g key={pw.id} transform={`translate(${px}, ${py})`}>
                <circle r={pw.landed ? 4.2 : 5.2} fill="none" stroke={color} strokeWidth="0.9" opacity="0.7" />
                <polygon
                  points="0,-3.2 3.2,0 0,3.2 -3.2,0"
                  fill={color}
                  stroke="#0B111A"
                  strokeWidth="0.9"
                />
              </g>
            );
          })}

          {/* Live Flag Markers */}
          <polygon
            points={`${mapX(hud.cobaltFlagPos.x)},${mapY(hud.cobaltFlagPos.z) - 5} ${mapX(hud.cobaltFlagPos.x) + 4.5},${mapY(hud.cobaltFlagPos.z)} ${mapX(hud.cobaltFlagPos.x)},${mapY(hud.cobaltFlagPos.z) + 5} ${mapX(hud.cobaltFlagPos.x) - 4.5},${mapY(hud.cobaltFlagPos.z)}`}
            fill="#2563EB"
            stroke="#F8FAFC"
            strokeWidth="1.2"
          />
          <polygon
            points={`${mapX(hud.crimsonFlagPos.x)},${mapY(hud.crimsonFlagPos.z) - 5} ${mapX(hud.crimsonFlagPos.x) + 4.5},${mapY(hud.crimsonFlagPos.z)} ${mapX(hud.crimsonFlagPos.x)},${mapY(hud.crimsonFlagPos.z) + 5} ${mapX(hud.crimsonFlagPos.x) - 4.5},${mapY(hud.crimsonFlagPos.z)}`}
            fill="#E6452E"
            stroke="#F8FAFC"
            strokeWidth="1.2"
          />
        </svg>
      </div>
    </div>
  );
};
