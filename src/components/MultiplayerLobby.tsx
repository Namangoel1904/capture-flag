import React, { useEffect, useState } from 'react';
import type { NetworkInfoResponse, RoomConfig, RoomLobbyState } from '../game/netTypes';
import type { DifficultyMode, TeamId } from '../game/types';

interface MultiplayerLobbyProps {
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  localPlayerId: string | null;
  room: RoomLobbyState | null;
  error: string | null;
  initialJoinCode: string;
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (code: string, playerName: string) => void;
  onSwitchTeam: (team: TeamId) => void;
  onUpdateConfig: (partial: Partial<RoomConfig>) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onClose: () => void;
}

const STORAGE_NAME_KEY = 'ctf_paintball_player_name';

export const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({
  connectionStatus,
  localPlayerId,
  room,
  error,
  initialJoinCode,
  onCreateRoom,
  onJoinRoom,
  onSwitchTeam,
  onUpdateConfig,
  onStartMatch,
  onLeaveRoom,
  onClose,
}) => {
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_NAME_KEY) || '';
    } catch {
      return '';
    }
  });
  const [joinCode, setJoinCode] = useState<string>(initialJoinCode);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'link' | 'wifi' | 'code' | null>(null);

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode);
    }
  }, [initialJoinCode]);

  useEffect(() => {
    let active = true;
    fetch('/api/network-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: NetworkInfoResponse | null) => {
        if (active && data) setNetworkInfo(data);
      })
      .catch(() => {
        // Ignore if network info is unavailable
      });
    return () => {
      active = false;
    };
  }, [room?.code]);

  const persistName = (val: string) => {
    setPlayerName(val);
    try {
      localStorage.setItem(STORAGE_NAME_KEY, val);
    } catch {
      // Ignore storage failures
    }
  };

  const resolvedName = playerName.trim() || 'Player';

  const copyText = (text: string, target: 'link' | 'wifi' | 'code') => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedTarget(target);
    window.setTimeout(() => {
      setCopiedTarget((prev) => (prev === target ? null : prev));
    }, 1800);
  };

  const isHost = Boolean(room && localPlayerId && room.hostId === localPlayerId);
  const localPlayer = room?.players.find((p) => p.id === localPlayerId) ?? null;
  const cobaltPlayers = room ? room.players.filter((p) => p.team === 'cobalt') : [];
  const crimsonPlayers = room ? room.players.filter((p) => p.team === 'crimson') : [];

  const isClientPrivateDev =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-dev-');
  const isPrivateDevPreview = isClientPrivateDev || Boolean(networkInfo?.isPrivateDevPreview);

  const shareUrl = room
    ? `${window.location.origin}${window.location.pathname}?room=${room.code}`
    : '';
  const primaryLanUrl =
    room && networkInfo && networkInfo.lanUrls.length > 0
      ? `${networkInfo.lanUrls[0]}/?room=${room.code}`
      : null;

  // Determine live squad pairing label (Co-op vs V/S)
  const pairingBadge = (() => {
    if (!room) return null;
    if (room.players.length <= 1) {
      return { text: 'Waiting for friends to join', tone: 'text-[#94A3B8]' };
    }
    if (cobaltPlayers.length > 0 && crimsonPlayers.length > 0) {
      return {
        text: `V/S Mode Active (${cobaltPlayers.length} vs ${crimsonPlayers.length} players)`,
        tone: 'text-[#FDBA74]',
      };
    }
    return {
      text: `Play Along Co-op Active (${room.players.length} friends on same squad)`,
      tone: 'text-[#7DD3FC]',
    };
  })();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#080E16]/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mp-lobby-heading"
        className="w-full max-w-[680px] rounded-xl bg-[#101823] border border-white/15 shadow-[0_28px_72px_rgba(0,0,0,0.75)] overflow-hidden"
      >
        {/* Top Split Cobalt/Crimson Accent Bar */}
        <div className="h-1 w-full flex">
          <div className="flex-1 bg-[#2563EB]" />
          <div className="flex-1 bg-[#E6452E]" />
        </div>

        <div className="p-6 md:p-7">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#38BDF8] mb-1">
                Online &amp; Same Wi-Fi Multiplayer
              </div>
              <h2
                id="mp-lobby-heading"
                className="font-display font-extrabold text-3xl md:text-4xl text-white leading-none"
              >
                {room ? `SQUAD ROOM · ${room.code}` : 'PLAY WITH FRIENDS'}
              </h2>
            </div>

            <button
              type="button"
              onClick={room ? onLeaveRoom : onClose}
              className="px-3.5 py-2 rounded-lg bg-[#1A2535] hover:bg-[#24344A] text-xs font-semibold text-[#CBD5E1] hover:text-white transition-colors cursor-pointer shrink-0"
            >
              {room ? 'Leave Room' : 'Back'}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 px-4 py-2.5 rounded-lg bg-[#5E1D15]/90 border border-[#FB923C]/50 text-xs font-semibold text-[#FED7AA]"
            >
              {error}
            </div>
          )}

          {isPrivateDevPreview && (
            <div
              data-testid="private-dev-preview-notice"
              className="mb-4 px-4 py-3 rounded-lg bg-[#2A1F0D] border border-[#F59E0B]/55 text-xs text-[#FDE68A] space-y-1.5"
            >
              <div className="font-bold text-[#FBBF24]">
                Private Editor Preview (How to Invite Friends Without 403)
              </div>
              <p className="text-[#FEF3C7]/90 leading-relaxed">
                This <span className="font-mono-num font-semibold">ais-dev</span> editor preview is
                restricted to your Google account, so friends opening it get{' '}
                <strong className="text-white">403 Forbidden</strong>. To play together:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-[#FEF3C7]/90 leading-relaxed">
                <li>
                  Click <strong className="text-white">Share</strong> or{' '}
                  <strong className="text-white">Deploy App</strong> in the top-right toolbar to
                  publish a public link — then both you and your friend open that published link and
                  create/join the room there.
                </li>
                <li>
                  Or download the project and run{' '}
                  <span className="font-mono-num text-white">npm install &amp;&amp; npm run dev</span>{' '}
                  on your computer so anyone on your same Wi-Fi joins directly via{' '}
                  <span className="font-mono-num text-white">http://&lt;your-wifi-ip&gt;:3000</span>.
                </li>
              </ol>
            </div>
          )}

          {/* STEP 1: CONNECT / CREATE OR JOIN ROOM */}
          {!room ? (
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="mp-player-name"
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8] mb-1.5"
                >
                  Your Callsign
                </label>
                <input
                  id="mp-player-name"
                  data-testid="mp-name-input"
                  type="text"
                  maxLength={16}
                  placeholder="Enter your name (e.g. Alex)"
                  value={playerName}
                  onChange={(e) => persistName(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-[#0A1018] border border-white/15 text-white placeholder-[#64748B] text-sm font-medium focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Host a New Room */}
                <div className="rounded-lg bg-[#0C131D] border border-white/12 p-4 flex flex-col justify-between">
                  <div>
                    <div className="text-sm font-bold text-white mb-1">Host a Squad Room</div>
                    <p className="text-xs text-[#94A3B8] leading-relaxed mb-4">
                      Start a private room and share your 4-letter code or Wi-Fi link. Pick the same
                      team to play along, or split sides for V/S.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="mp-create-room"
                    onClick={() => onCreateRoom(resolvedName)}
                    className="w-full py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-display font-bold text-xl tracking-wide transition-colors cursor-pointer"
                  >
                    CREATE ROOM
                  </button>
                </div>

                {/* Join Existing Room */}
                <div className="rounded-lg bg-[#0C131D] border border-white/12 p-4 flex flex-col justify-between">
                  <div>
                    <div className="text-sm font-bold text-white mb-1">Join a Friend&apos;s Room</div>
                    <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">
                      Enter the 4-letter room code from your friend on the same Wi-Fi or online.
                    </p>
                    <input
                      data-testid="mp-code-input"
                      type="text"
                      maxLength={4}
                      placeholder="CODE (e.g. K7M4)"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && joinCode.trim().length >= 4) {
                          onJoinRoom(joinCode.trim(), resolvedName);
                        }
                      }}
                      className="w-full px-3.5 py-2.5 mb-3 rounded-lg bg-[#070C12] border border-white/15 text-white font-mono-num font-bold tracking-[0.22em] text-center text-lg uppercase placeholder:tracking-normal placeholder:font-normal placeholder:text-xs placeholder-[#64748B] focus:outline-none focus:border-[#FB923C]"
                    />
                  </div>
                  <button
                    type="button"
                    data-testid="mp-join-room"
                    disabled={joinCode.trim().length < 4}
                    onClick={() => onJoinRoom(joinCode.trim(), resolvedName)}
                    className="w-full py-3 rounded-lg bg-[#E6452E] hover:bg-[#DC2626] disabled:bg-[#2A3342] disabled:text-[#64748B] text-white font-display font-bold text-xl tracking-wide transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    JOIN ROOM
                  </button>
                </div>
              </div>

              {/* Same Wi-Fi Direct Address Hint */}
              {networkInfo && networkInfo.lanUrls.length > 0 && (
                <div className="rounded-lg bg-[#0A1018] border border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[#CBD5E1]">
                    <span className="font-bold text-[#38BDF8]">Same Wi-Fi URL:</span>{' '}
                    <span className="font-mono-num text-white">{networkInfo.lanUrls[0]}</span>
                  </div>
                  <span className="text-[11px] text-[#94A3B8]">
                    {connectionStatus === 'connected' ? 'Server Ready' : 'Connecting...'}
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* STEP 2: ACTIVE SQUAD LOBBY */
            <div className="space-y-4">
              {/* Invite & Wi-Fi Share Bar */}
              <div className="rounded-lg bg-[#0B121B] border border-white/12 p-3.5 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                      Room Code
                    </span>
                    <span
                      data-testid="mp-room-code"
                      className="px-3 py-1 rounded-md bg-[#162233] border border-[#38BDF8]/40 font-mono-num font-extrabold text-xl tracking-[0.18em] text-[#FEF08A]"
                    >
                      {room.code}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyText(room.code, 'code')}
                      className="px-3 py-1.5 rounded-md bg-[#1A2535] hover:bg-[#26364D] text-xs font-semibold text-[#E2E8F0] transition-colors cursor-pointer"
                    >
                      {copiedTarget === 'code' ? 'Copied Code!' : 'Copy Code'}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(shareUrl, 'link')}
                      className="px-3 py-1.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-xs font-semibold text-white transition-colors cursor-pointer"
                    >
                      {copiedTarget === 'link' ? 'Link Copied!' : 'Copy Invite Link'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8 text-xs">
                  <div className="text-[#CBD5E1] truncate max-w-[460px]">
                    <span className="font-bold text-[#10B981]">
                      {primaryLanUrl ? 'Same Wi-Fi Link:' : 'Invite Link:'}
                    </span>{' '}
                    <span className="font-mono-num text-[#E2E8F0]">
                      {primaryLanUrl ?? shareUrl}
                    </span>
                  </div>
                  {primaryLanUrl && (
                    <button
                      type="button"
                      onClick={() => copyText(primaryLanUrl, 'wifi')}
                      className="px-2.5 py-1 rounded bg-[#142923] hover:bg-[#1A382F] border border-[#10B981]/40 text-[11px] font-semibold text-[#6EE7B7] cursor-pointer shrink-0"
                    >
                      {copiedTarget === 'wifi' ? 'Wi-Fi URL Copied!' : 'Copy Wi-Fi URL'}
                    </button>
                  )}
                </div>
              </div>

              {/* Co-op vs V/S Guidance Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
                <span className="text-[#CBD5E1]">
                  Pick the <strong className="text-white">same team</strong> to play along (Co-op) or{' '}
                  <strong className="text-white">opposite teams</strong> for V/S.
                </span>
                {pairingBadge && (
                  <span data-testid="mp-pairing-mode" className={`font-bold ${pairingBadge.tone}`}>
                    {pairingBadge.text}
                  </span>
                )}
              </div>

              {/* Two-Column Team Roster & 1-Click Team Switcher */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* TEAM COBALT */}
                <div className="rounded-lg bg-[#0D1A2D] border border-[#2563EB]/45 p-3.5 flex flex-col">
                  <div className="flex items-center justify-between mb-2.5">
                    <div>
                      <div className="font-display font-extrabold text-xl text-[#93C5FD] leading-none">
                        TEAM COBALT
                      </div>
                      <div className="text-[11px] text-[#94A3B8]">West Fort · Blue Paint</div>
                    </div>
                    <button
                      type="button"
                      data-testid="mp-join-cobalt"
                      disabled={localPlayer?.team === 'cobalt'}
                      onClick={() => onSwitchTeam('cobalt')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        localPlayer?.team === 'cobalt'
                          ? 'bg-[#2563EB] text-white cursor-default'
                          : 'bg-[#172C4D] hover:bg-[#2563EB] text-[#BFDBFE] hover:text-white'
                      }`}
                    >
                      {localPlayer?.team === 'cobalt' ? 'Your Team' : 'Join Cobalt'}
                    </button>
                  </div>

                  <div className="space-y-1.5 min-h-[96px]">
                    {cobaltPlayers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-1.5 rounded bg-[#0A1322] border border-white/10 text-xs"
                      >
                        <span className="font-semibold text-white">
                          {p.name}
                          {p.id === localPlayerId && (
                            <span className="ml-1.5 text-[10px] font-bold text-[#FEF08A]">(YOU)</span>
                          )}
                        </span>
                        {p.isHost && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#38BDF8]">
                            HOST
                          </span>
                        )}
                      </div>
                    ))}
                    {room.config.fillBots &&
                      Array.from({ length: Math.max(0, room.config.teamSize - cobaltPlayers.length) }).map(
                        (_, i) => (
                          <div
                            key={`c-bot-${i}`}
                            className="flex items-center justify-between px-3 py-1.5 rounded bg-[#0A1322]/45 border border-dashed border-white/8 text-xs text-[#64748B]"
                          >
                            <span>AI Teammate</span>
                            <span className="text-[10px] uppercase">BOT</span>
                          </div>
                        ),
                      )}
                  </div>
                </div>

                {/* TEAM CRIMSON */}
                <div className="rounded-lg bg-[#271312] border border-[#E6452E]/45 p-3.5 flex flex-col">
                  <div className="flex items-center justify-between mb-2.5">
                    <div>
                      <div className="font-display font-extrabold text-xl text-[#FDBA74] leading-none">
                        TEAM CRIMSON
                      </div>
                      <div className="text-[11px] text-[#94A3B8]">East Fort · Coral Paint</div>
                    </div>
                    <button
                      type="button"
                      data-testid="mp-join-crimson"
                      disabled={localPlayer?.team === 'crimson'}
                      onClick={() => onSwitchTeam('crimson')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        localPlayer?.team === 'crimson'
                          ? 'bg-[#E6452E] text-white cursor-default'
                          : 'bg-[#471D18] hover:bg-[#E6452E] text-[#FED7AA] hover:text-white'
                      }`}
                    >
                      {localPlayer?.team === 'crimson' ? 'Your Team' : 'Join Crimson'}
                    </button>
                  </div>

                  <div className="space-y-1.5 min-h-[96px]">
                    {crimsonPlayers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-1.5 rounded bg-[#1B0D0C] border border-white/10 text-xs"
                      >
                        <span className="font-semibold text-white">
                          {p.name}
                          {p.id === localPlayerId && (
                            <span className="ml-1.5 text-[10px] font-bold text-[#FEF08A]">(YOU)</span>
                          )}
                        </span>
                        {p.isHost && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#FB923C]">
                            HOST
                          </span>
                        )}
                      </div>
                    ))}
                    {room.config.fillBots &&
                      Array.from({ length: Math.max(0, room.config.teamSize - crimsonPlayers.length) }).map(
                        (_, i) => (
                          <div
                            key={`r-bot-${i}`}
                            className="flex items-center justify-between px-3 py-1.5 rounded bg-[#1B0D0C]/45 border border-dashed border-white/8 text-xs text-[#64748B]"
                          >
                            <span>AI Opponent</span>
                            <span className="text-[10px] uppercase">BOT</span>
                          </div>
                        ),
                      )}
                  </div>
                </div>
              </div>

              {/* Match Settings Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#0B121B] border border-white/10 px-4 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                      AI Bots
                    </span>
                    <button
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateConfig({ fillBots: !room.config.fillBots })}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                        room.config.fillBots
                          ? 'bg-[#10B981]/20 text-[#6EE7B7] border border-[#10B981]/40'
                          : 'bg-[#1E293B] text-[#94A3B8] border border-white/10'
                      } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                    >
                      {room.config.fillBots ? 'Fill Squads' : 'Humans Only'}
                    </button>
                  </div>

                  {room.config.fillBots && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                          Size
                        </span>
                        {([3, 4] as const).map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            disabled={!isHost}
                            onClick={() => onUpdateConfig({ teamSize: sz })}
                            className={`px-2 py-1 rounded text-xs font-bold ${
                              room.config.teamSize === sz
                                ? 'bg-[#2563EB] text-white'
                                : 'bg-[#172130] text-[#94A3B8]'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            {sz}v{sz}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                          AI
                        </span>
                        {(['standard', 'veteran'] as DifficultyMode[]).map((d) => (
                          <button
                            key={d}
                            type="button"
                            disabled={!isHost}
                            onClick={() => onUpdateConfig({ difficulty: d })}
                            className={`px-2 py-1 rounded text-xs font-bold capitalize ${
                              room.config.difficulty === d
                                ? 'bg-[#E6452E] text-white'
                                : 'bg-[#172130] text-[#94A3B8]'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Start Match / Waiting Footer */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-[#94A3B8]">
                  {room.players.length} {room.players.length === 1 ? 'player' : 'players'} connected · First to 3 captures
                </span>
                {isHost ? (
                  <button
                    type="button"
                    data-testid="mp-start-match"
                    onClick={onStartMatch}
                    className="px-7 py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-display font-bold text-2xl tracking-wide shadow-[0_8px_24px_rgba(37,99,235,0.4)] border border-[#60A5FA]/50 transition-all cursor-pointer"
                  >
                    START MATCH
                  </button>
                ) : (
                  <div className="px-5 py-2.5 rounded-lg bg-[#162131] border border-white/10 text-xs font-bold text-[#93C5FD]">
                    Waiting for Host to start...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
