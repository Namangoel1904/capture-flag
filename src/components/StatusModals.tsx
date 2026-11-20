import React from 'react';
import type { HudSnapshot } from '../game/types';

interface StatusModalsProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
  onReturnToLobby?: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const StatusModals: React.FC<StatusModalsProps> = ({
  hud,
  onResume,
  onRestart,
  onReturnTitle,
  onReturnToLobby,
}) => {
  if (hud.phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090F17]/74">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-heading"
          className="w-full max-w-[400px] mx-4 rounded-xl bg-[#111924] border border-white/15 p-7 shadow-[0_24px_60px_rgba(0,0,0,0.65)]"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94A3B8] mb-1">
            {hud.isMultiplayer ? `Online Match · Room ${hud.roomCode ?? ''}` : 'Match Paused'}
          </div>
          <h2 id="pause-heading" className="font-display font-extrabold text-4xl text-white mb-5">
            CANYON RIDGE
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-lg bg-[#0C121B] border border-white/10 p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#93C5FD]">
                Cobalt
              </div>
              <div className="font-display font-extrabold text-3xl text-white font-mono-num">
                {hud.cobaltScore}
              </div>
            </div>
            <div className="rounded-lg bg-[#0C121B] border border-white/10 p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#FDBA74]">
                Crimson
              </div>
              <div className="font-display font-extrabold text-3xl text-white font-mono-num">
                {hud.crimsonScore}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-display font-bold text-xl tracking-wide transition-colors cursor-pointer"
            >
              RESUME MATCH
            </button>

            {hud.isMultiplayer ? (
              hud.isHost && onReturnToLobby && (
                <button
                  type="button"
                  onClick={onReturnToLobby}
                  className="w-full py-2.5 rounded-lg bg-[#1A2535] hover:bg-[#233146] text-[#E2E8F0] font-semibold text-sm transition-colors cursor-pointer"
                >
                  Back to Squad Lobby (Swap Teams)
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={onRestart}
                className="w-full py-2.5 rounded-lg bg-[#1A2535] hover:bg-[#233146] text-[#E2E8F0] font-semibold text-sm transition-colors cursor-pointer"
              >
                Restart Match
              </button>
            )}

            <button
              type="button"
              onClick={onReturnTitle}
              className="w-full py-2.5 rounded-lg bg-transparent hover:bg-white/6 text-[#94A3B8] hover:text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              {hud.isMultiplayer ? 'Leave Room' : 'Main Menu'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hud.phase === 'gameover' && hud.endStats) {
    const { winner, cobaltScore, crimsonScore, elapsedSeconds, playerTags, playerCaptures, playerReturns } =
      hud.endStats;
    const isDraw = winner === 'draw';
    const isVictory = winner === hud.localTeam;
    const winnerHeadline = isDraw
      ? 'DRAW MATCH'
      : winner === 'cobalt'
        ? isVictory
          ? 'COBALT VICTORY'
          : 'COBALT WINS'
        : isVictory
          ? 'CRIMSON VICTORY'
          : 'CRIMSON WINS';

    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090F17]/78">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gameover-heading"
          className="w-full max-w-[460px] mx-4 rounded-xl bg-[#111924] border border-white/15 p-8 shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
        >
          <div
            className={`text-xs font-bold uppercase tracking-[0.16em] mb-1 ${
              isVictory ? 'text-[#38BDF8]' : isDraw ? 'text-[#FACC15]' : 'text-[#FB923C]'
            }`}
          >
            {isVictory ? 'Victory · Match Complete' : isDraw ? 'Time Expired' : 'Match Complete'}
          </div>
          <h2 id="gameover-heading" className="font-display font-extrabold text-5xl text-white mb-2">
            {winnerHeadline}
          </h2>
          <p className="text-sm text-[#94A3B8] mb-6">
            Final Score:{' '}
            <span className="text-[#93C5FD] font-bold font-mono-num">{cobaltScore}</span>
            {' – '}
            <span className="text-[#FDBA74] font-bold font-mono-num">{crimsonScore}</span>
            {' · '}
            Match Time <span className="text-white font-mono-num">{formatDuration(elapsedSeconds)}</span>
          </p>

          <div className="grid grid-cols-3 gap-3 mb-7">
            <div className="rounded-lg bg-[#0C121B] border border-white/10 p-3.5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">
                Captures
              </div>
              <div className="font-display font-extrabold text-3xl text-[#38BDF8] font-mono-num">
                {playerCaptures}
              </div>
            </div>
            <div className="rounded-lg bg-[#0C121B] border border-white/10 p-3.5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">
                Tags
              </div>
              <div className="font-display font-extrabold text-3xl text-white font-mono-num">
                {playerTags}
              </div>
            </div>
            <div className="rounded-lg bg-[#0C121B] border border-white/10 p-3.5 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">
                Returns
              </div>
              <div className="font-display font-extrabold text-3xl text-[#FACC15] font-mono-num">
                {playerReturns}
              </div>
            </div>
          </div>

          {hud.isMultiplayer ? (
            <div className="flex flex-col gap-2.5">
              {hud.isHost ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    data-start="true"
                    onClick={onRestart}
                    className="flex-1 py-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-display font-bold text-2xl tracking-wide transition-colors cursor-pointer"
                  >
                    PLAY AGAIN
                  </button>
                  {onReturnToLobby && (
                    <button
                      type="button"
                      onClick={onReturnToLobby}
                      className="px-4 py-3.5 rounded-lg bg-[#1A2535] hover:bg-[#233146] text-[#E2E8F0] font-semibold text-sm transition-colors cursor-pointer"
                    >
                      Squad Lobby
                    </button>
                  )}
                </div>
              ) : (
                <div className="w-full py-3 rounded-lg bg-[#162131] border border-white/10 text-center text-xs font-bold text-[#93C5FD]">
                  Waiting for Host to start rematch or return to lobby...
                </div>
              )}
              <button
                type="button"
                onClick={onReturnTitle}
                className="w-full py-2.5 rounded-lg bg-transparent hover:bg-white/6 text-[#94A3B8] hover:text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Leave Room
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-start="true"
                onClick={onRestart}
                className="flex-1 py-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-display font-bold text-2xl tracking-wide transition-colors cursor-pointer"
              >
                PLAY AGAIN
              </button>
              <button
                type="button"
                onClick={onReturnTitle}
                className="px-5 py-3.5 rounded-lg bg-[#1A2535] hover:bg-[#233146] text-[#E2E8F0] font-semibold text-sm transition-colors cursor-pointer"
              >
                Main Menu
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
