import type {
  ClientToServerMessage,
  NetGameEvent,
  NetMatchSnapshot,
  PlayerInputPacket,
  RoomConfig,
  RoomLobbyState,
  ServerToClientMessage,
} from './netTypes';
import type { TeamId } from './types';

export interface MultiplayerCallbacks {
  onConnectionChange: (status: 'disconnected' | 'connecting' | 'connected') => void;
  onRoomJoined: (playerId: string, room: RoomLobbyState, snapshot?: NetMatchSnapshot) => void;
  onRoomState: (room: RoomLobbyState) => void;
  onMatchStarted: (room: RoomLobbyState, snapshot: NetMatchSnapshot) => void;
  onState: (snapshot: NetMatchSnapshot, events: NetGameEvent[]) => void;
  onReturnedToLobby: (room: RoomLobbyState) => void;
  onError: (message: string) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private callbacks: MultiplayerCallbacks;
  private pendingMessages: ClientToServerMessage[] = [];
  private disposed = false;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public connect(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    this.callbacks.onConnectionChange('connecting');

    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.onopen = () => {
      if (this.disposed) {
        socket.close();
        return;
      }
      this.callbacks.onConnectionChange('connected');
      while (this.pendingMessages.length > 0 && socket.readyState === WebSocket.OPEN) {
        const next = this.pendingMessages.shift()!;
        socket.send(JSON.stringify(next));
      }
    };

    socket.onmessage = (event) => {
      if (this.disposed) return;
      let msg: ServerToClientMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerToClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'room_joined') {
        this.callbacks.onRoomJoined(msg.playerId, msg.room, msg.snapshot);
      } else if (msg.type === 'room_state') {
        this.callbacks.onRoomState(msg.room);
      } else if (msg.type === 'match_started') {
        this.callbacks.onMatchStarted(msg.room, msg.snapshot);
      } else if (msg.type === 'state') {
        this.callbacks.onState(msg.snapshot, msg.events);
      } else if (msg.type === 'returned_to_lobby') {
        this.callbacks.onReturnedToLobby(msg.room);
      } else if (msg.type === 'error') {
        this.callbacks.onError(msg.message);
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.ws = null;
      }
      if (!this.disposed) {
        this.callbacks.onConnectionChange('disconnected');
      }
    };

    socket.onerror = () => {
      if (!this.disposed) {
        this.callbacks.onError('Could not connect to the multiplayer server.');
      }
    };
  }

  private send(msg: ClientToServerMessage): void {
    if (this.disposed) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.pendingMessages.push(msg);
      this.connect();
      return;
    }
    if (this.ws.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(msg);
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public createRoom(name: string): void {
    this.send({ type: 'create_room', name });
  }

  public joinRoom(code: string, name: string): void {
    this.send({ type: 'join_room', code, name });
  }

  public switchTeam(team: TeamId): void {
    this.send({ type: 'switch_team', team });
  }

  public updateConfig(config: Partial<RoomConfig>): void {
    this.send({ type: 'update_config', config });
  }

  public startMatch(): void {
    this.send({ type: 'start_match' });
  }

  public returnToLobby(): void {
    this.send({ type: 'return_to_lobby' });
  }

  public leaveRoom(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave_room' }));
    }
  }

  public sendInput(input: PlayerInputPacket): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', input }));
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.pendingMessages = [];
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
