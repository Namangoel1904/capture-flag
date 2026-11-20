import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { MultiplayerLobby } from './components/MultiplayerLobby';
import { StatusModals } from './components/StatusModals';
import { TitleOverlay } from './components/TitleOverlay';
import { BASE_POSITIONS, MATCH_DURATION_SEC, SCORE_LIMIT } from './game/arenaData';
import { CaptureTheFlagEngine } from './game/engine';
import { MultiplayerClient } from './game/multiplayerClient';
import type { RoomConfig, RoomLobbyState } from './game/netTypes';
import type { HudSnapshot, MatchConfig, TeamId } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  localTeam: 'cobalt',
  isMultiplayer: false,
  roomCode: null,
  isHost: false,
  connectedPlayers: 1,
  cobaltScore: 0,
  crimsonScore: 0,
  scoreLimit: SCORE_LIMIT,
  matchTimeRemaining: MATCH_DURATION_SEC,
  cobaltFlag: 'home',
  crimsonFlag: 'home',
  weather: 'clear',
  weatherTransitioning: false,
  playerHp: 125,
  playerMaxHp: 125,
  playerAlive: true,
  playerRespawnTimer: 0,
  playerAmmo: 24,
  playerMaxAmmo: 24,
  playerReloading: false,
  playerReloadProgress: 1,
  playerDashReady: 1,
  playerBurstReady: 1,
  playerStunTimer: 0,
  playerStunKills: 0,
  playerStunKillsRequired: 2,
  playerStunReady: false,
  playerStunRadius: 8.5,
  playerStunTier: 1,
  playerCarryingFlag: false,
  playerBuffs: [],
  playerTags: 0,
  playerCaptures: 0,
  muted: false,
  banner: null,
  minimapActors: [],
  minimapPowerups: [],
  cobaltFlagPos: BASE_POSITIONS.cobalt,
  crimsonFlagPos: BASE_POSITIONS.crimson,
  endStats: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CaptureTheFlagEngine | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const localPlayerIdRef = useRef<string | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [config, setConfig] = useState<MatchConfig>({
    teamSize: 4,
    difficulty: 'standard',
  });

  // Multiplayer Lobby State
  const [mpLobbyOpen, setMpLobbyOpen] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('room'));
  });
  const [initialJoinCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  const [mpConnection, setMpConnection] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomLobbyState | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new CaptureTheFlagEngine(mountEl, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    const mp = new MultiplayerClient({
      onConnectionChange: (status) => {
        setMpConnection(status);
      },
      onRoomJoined: (playerId, room, snapshot) => {
        localPlayerIdRef.current = playerId;
        setLocalPlayerId(playerId);
        setRoomState(room);
        setMpError(null);

        if (snapshot && room.status === 'playing') {
          const me = room.players.find((p) => p.id === playerId);
          setMpLobbyOpen(false);
          engine.setTitleHotkeysBlocked(false);
          engine.startMultiplayerMatch(
            playerId,
            me?.team ?? 'cobalt',
            room.code,
            room.hostId === playerId,
            room.players.length,
            snapshot,
          );
        }
      },
      onRoomState: (room) => {
        setRoomState(room);
        const pid = localPlayerIdRef.current;
        engine.updateMultiplayerMeta(room.code, room.hostId === pid, room.players.length);
      },
      onMatchStarted: (room, snapshot) => {
        setRoomState(room);
        setMpError(null);
        setMpLobbyOpen(false);
        engine.setTitleHotkeysBlocked(false);
        const pid = localPlayerIdRef.current;
        if (!pid) return;
        const me = room.players.find((p) => p.id === pid);
        engine.startMultiplayerMatch(
          pid,
          me?.team ?? 'cobalt',
          room.code,
          room.hostId === pid,
          room.players.length,
          snapshot,
        );
      },
      onState: (snapshot, events) => {
        engine.applyServerSnapshot(snapshot, events);
      },
      onReturnedToLobby: (room) => {
        setRoomState(room);
        engine.returnToTitle();
        setMpLobbyOpen(true);
        engine.setTitleHotkeysBlocked(true);
      },
      onError: (message) => {
        setMpError(message);
      },
    });
    mpClientRef.current = mp;
    engine.setInputSender((input) => mp.sendInput(input));

    const params = new URLSearchParams(window.location.search);
    if (params.get('room')) {
      engine.setTitleHotkeysBlocked(true);
      mp.connect();
      document.body.dataset.state = 'title';
    } else if (params.get('autostart') === '1') {
      engine.startMatch();
    } else {
      document.body.dataset.state = 'title';
    }

    return () => {
      mp.dispose();
      mpClientRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTitleHotkeysBlocked(mpLobbyOpen);
  }, [mpLobbyOpen]);

  const handleConfigChange = useCallback((partial: Partial<MatchConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      engineRef.current?.setConfig(next);
      return next;
    });
  }, []);

  const handleStartSolo = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMpLobbyOpen(false);
    engineRef.current?.startMatch();
  }, []);

  const handleOpenMultiplayer = useCallback(() => {
    setMpError(null);
    setMpLobbyOpen(true);
    mpClientRef.current?.connect();
  }, []);

  const handleCreateRoom = useCallback((playerName: string) => {
    setMpError(null);
    mpClientRef.current?.createRoom(playerName);
  }, []);

  const handleJoinRoom = useCallback((code: string, playerName: string) => {
    setMpError(null);
    mpClientRef.current?.joinRoom(code, playerName);
  }, []);

  const handleSwitchTeam = useCallback((team: TeamId) => {
    setMpError(null);
    mpClientRef.current?.switchTeam(team);
  }, []);

  const handleUpdateRoomConfig = useCallback((partial: Partial<RoomConfig>) => {
    setMpError(null);
    mpClientRef.current?.updateConfig(partial);
  }, []);

  const handleStartMultiplayer = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMpError(null);
    mpClientRef.current?.startMatch();
  }, []);

  const handleReturnToLobby = useCallback(() => {
    mpClientRef.current?.returnToLobby();
  }, []);

  const handleLeaveRoom = useCallback(() => {
    mpClientRef.current?.leaveRoom();
    localPlayerIdRef.current = null;
    setLocalPlayerId(null);
    setRoomState(null);
    setMpError(null);
    setMpLobbyOpen(false);
    engineRef.current?.returnToTitle();
  }, []);

  const handleRestartOrRematch = useCallback(() => {
    if (hud.isMultiplayer) {
      mpClientRef.current?.startMatch();
    } else {
      handleStartSolo();
    }
  }, [hud.isMultiplayer, handleStartSolo]);

  const handleReturnTitle = useCallback(() => {
    if (hud.isMultiplayer) {
      handleLeaveRoom();
    } else {
      engineRef.current?.returnToTitle();
    }
  }, [hud.isMultiplayer, handleLeaveRoom]);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#111820]">
      {/* Dedicated Isolated WebGL Canvas Mount Container */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-container"
        className="w-full h-full cursor-crosshair"
      />

      {hud.phase === 'title' && !mpLobbyOpen && (
        <TitleOverlay
          config={config}
          onConfigChange={handleConfigChange}
          onStart={handleStartSolo}
          onOpenMultiplayer={handleOpenMultiplayer}
        />
      )}

      {hud.phase === 'title' && mpLobbyOpen && (
        <MultiplayerLobby
          connectionStatus={mpConnection}
          localPlayerId={localPlayerId}
          room={roomState}
          error={mpError}
          initialJoinCode={initialJoinCode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onSwitchTeam={handleSwitchTeam}
          onUpdateConfig={handleUpdateRoomConfig}
          onStartMatch={handleStartMultiplayer}
          onLeaveRoom={handleLeaveRoom}
          onClose={() => setMpLobbyOpen(false)}
        />
      )}

      {(hud.phase === 'playing' || hud.phase === 'paused') && (
        <GameHud
          hud={hud}
          onTogglePause={handleTogglePause}
          onToggleMute={handleToggleMute}
          onRestart={handleRestartOrRematch}
        />
      )}

      {(hud.phase === 'paused' || hud.phase === 'gameover') && (
        <StatusModals
          hud={hud}
          onResume={handleTogglePause}
          onRestart={handleRestartOrRematch}
          onReturnTitle={handleReturnTitle}
          onReturnToLobby={hud.isMultiplayer ? handleReturnToLobby : undefined}
        />
      )}
    </main>
  );
}
