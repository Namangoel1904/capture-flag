import React from 'react';
import type { DifficultyMode, MatchConfig } from '../game/types';

interface TitleOverlayProps {
  config: MatchConfig;
  onConfigChange: (partial: Partial<MatchConfig>) => void;
  onStart: () => void;
  onOpenMultiplayer: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  config,
  onConfigChange,
  onStart,
  onOpenMultiplayer,
}) => {
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none"
      style={{
        background:
          'linear-gradient(95deg, rgba(12, 18, 26, 0.86) 0%, rgba(12, 18, 26, 0.62) 34%, rgba(12, 18, 26, 0.14) 64%, rgba(12, 18, 26, 0.04) 100%)',
      }}
    >
      {/* Left-Third Asymmetric Title Lockup & Match Controls */}
      <div className="flex-1 flex items-center px-8 md:px-14 lg:px-20">
        <div className="w-full max-w-[460px] pointer-events-auto">
          {/* Custom Inline SVG Tournament Crest & Display Wordmark */}
          <div className="mb-7">
            <svg
              viewBox="0 0 420 156"
              className="w-full max-w-[400px] h-auto overflow-visible"
              role="img"
              aria-label="Capture the Flag — Paintball Arena"
            >
              {/* Subtle paint splatter silhouettes behind crest */}
              <g opacity="0.92">
                <circle cx="38" cy="36" r="14" fill="#2563EB" />
                <circle cx="57" cy="24" r="5" fill="#38BDF8" />
                <circle cx="22" cy="54" r="4" fill="#38BDF8" />
                <circle cx="372" cy="34" r="13" fill="#E6452E" />
                <circle cx="391" cy="48" r="5" fill="#FB923C" />
                <circle cx="354" cy="22" r="4" fill="#FB923C" />
              </g>

              {/* Crossed Pennant Flag Emblem */}
              <g transform="translate(182, 8)">
                {/* Left Cobalt Flag */}
                <line x1="12" y1="48" x2="36" y2="6" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
                <path d="M35 8 L10 2 L16 14 L8 22 L28 24 Z" fill="#2563EB" stroke="#0B121C" strokeWidth="2" />
                {/* Right Crimson Flag */}
                <line x1="44" y1="48" x2="20" y2="6" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
                <path d="M21 8 L46 2 L40 14 L48 22 L28 24 Z" fill="#E6452E" stroke="#0B121C" strokeWidth="2" />
                {/* Center Shield Rivet */}
                <polygon
                  points="28,16 36,24 28,36 20,24"
                  fill="#F8FAFC"
                  stroke="#0B121C"
                  strokeWidth="2.5"
                />
              </g>

              {/* Primary Display Title */}
              <text
                x="0"
                y="104"
                fill="#F8FAFC"
                stroke="#0B111A"
                strokeWidth="7"
                paintOrder="stroke fill"
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 800,
                  fontSize: '66px',
                  letterSpacing: '0.02em',
                }}
              >
                CAPTURE THE FLAG
              </text>

              {/* Accent Rule Split Cobalt / Crimson */}
              <rect x="2" y="118" width="194" height="5" rx="2.5" fill="#2563EB" />
              <rect x="202" y="118" width="194" height="5" rx="2.5" fill="#E6452E" />

              {/* Arena Subtitle */}
              <text
                x="2"
                y="144"
                fill="#CBD5E1"
                style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: '15px',
                  letterSpacing: '0.16em',
                }}
              >
                CANYON RIDGE PAINTBALL GROUNDS
              </text>
            </svg>
          </div>

          <p className="text-[15px] leading-relaxed text-[#D8E1EB] mb-6 max-w-[400px]">
            Lead your paintball squad across sunlit speedball bunkers, steal the enemy flag,
            and play solo or with friends on the same Wi-Fi in Co-op or V/S.
          </p>

          {/* Compact Match Setup Selectors */}
          <div className="flex flex-wrap items-center gap-4 mb-7">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#94A3B8] mb-1.5">
                Squad Size
              </span>
              <div className="inline-flex rounded-lg p-1 bg-[#111923] border border-white/12">
                {([3, 4] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onConfigChange({ teamSize: size })}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      config.teamSize === size
                        ? 'bg-[#2563EB] text-white'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {size}v{size}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#94A3B8] mb-1.5">
                AI Intensity
              </span>
              <div className="inline-flex rounded-lg p-1 bg-[#111923] border border-white/12">
                {(['standard', 'veteran'] as DifficultyMode[]).map((diff) => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => onConfigChange({ difficulty: diff })}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                      config.difficulty === diff
                        ? 'bg-[#E6452E] text-white'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Primary Start & Multiplayer CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-start="true"
              onClick={onStart}
              className="group inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-[0.99] text-white font-display font-bold text-2xl tracking-wide shadow-[0_10px_28px_rgba(29,99,237,0.42)] border border-[#60A5FA]/50 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38BDF8] whitespace-nowrap shrink-0"
            >
              <span>PLAY SOLO</span>
              <svg viewBox="0 0 20 20" className="w-5 h-5 fill-current transition-transform group-hover:translate-x-0.5">
                <polygon points="4,3 17,10 4,17" />
              </svg>
            </button>

            <button
              type="button"
              data-testid="open-multiplayer"
              onClick={onOpenMultiplayer}
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-lg bg-[#142030] hover:bg-[#1C2D42] active:scale-[0.99] text-[#F8FAFC] font-display font-bold text-2xl tracking-wide shadow-[0_10px_24px_rgba(8,14,22,0.45)] border border-[#FB923C]/55 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FB923C] whitespace-nowrap shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#FB923C] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              <span>ONLINE / WI-FI</span>
            </button>
          </div>
          <div className="mt-2.5 text-xs text-[#94A3B8] font-medium">
            First to 3 captures · Co-op or V/S with friends on same Wi-Fi
          </div>
        </div>
      </div>

      {/* Single Flat Borderless Bottom Control Hint Line */}
      <div className="px-8 md:px-14 lg:px-20 pb-6">
        <p className="text-xs md:text-[13px] text-[#CBD5E1]/90 tracking-wide hud-text-stroke">
          WASD Move <span className="mx-2 text-[#64748B]">·</span>
          Arrows Aim <span className="mx-2 text-[#64748B]">·</span>
          Space Shoot <span className="mx-2 text-[#64748B]">·</span>
          E Tri-Burst <span className="mx-2 text-[#64748B]">·</span>
          Q Stun Wave <span className="mx-2 text-[#64748B]">·</span>
          Shift Dash <span className="mx-2 text-[#64748B]">·</span>
          R Reload <span className="mx-2 text-[#64748B]">·</span>
          P Pause
        </p>
      </div>
    </div>
  );
};
