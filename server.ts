import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientToServerMessage, NetworkInfoResponse, ServerToClientMessage } from './src/game/netTypes.ts';
import { GameRoomManager, type GameRoom } from './src/server/roomManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD =
  process.env.NODE_ENV === 'production' ||
  (Boolean(process.env.K_SERVICE) && !(process.env.APP_URL || '').includes('://ais-dev-'));

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        urls.push(`http://${info.address}:${port}`);
      }
    }
  }
  return urls;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', true);

  // Open access with zero CORS or origin restrictions for LAN / Wi-Fi / online multiplayer
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const server = http.createServer(app);
  const roomManager = new GameRoomManager();
  const socketsByClientId = new Map<string, WebSocket>();
  let clientSeq = 1;

  const sendToClient = (clientId: string, msg: ServerToClientMessage) => {
    const ws = socketsByClientId.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const broadcastToRoom = (room: GameRoom, msg: ServerToClientMessage) => {
    const payload = JSON.stringify(msg);
    for (const clientId of room.players.keys()) {
      const ws = socketsByClientId.get(clientId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  };

  // REST endpoint exposing local Wi-Fi / LAN join URLs, active rooms, and shared URL info
  app.get('/api/network-info', (req, res) => {
    const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const appUrl = process.env.APP_URL || '';
    const isPrivateDevPreview =
      reqHost.startsWith('ais-dev-') ||
      ((reqHost.startsWith('localhost') || reqHost.startsWith('127.0.0.1')) &&
        appUrl.includes('://ais-dev-'));
    let sharedAppUrl: string | null = null;
    if (reqHost.startsWith('ais-dev-')) {
      sharedAppUrl = `https://${reqHost.replace(/^ais-dev-/, 'ais-pre-')}`;
    } else if (isPrivateDevPreview && appUrl.includes('://ais-dev-')) {
      sharedAppUrl = appUrl.replace('://ais-dev-', '://ais-pre-');
    }

    const body: NetworkInfoResponse = {
      port: PORT,
      lanUrls: getLanUrls(PORT),
      activeRooms: roomManager.getRoomCount(),
      isPrivateDevPreview,
      sharedAppUrl,
    };
    res.json(body);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: roomManager.getRoomCount() });
  });

  // WebSocket server mounted on /ws with zero origin/auth restrictions
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: () => true,
  });

  // Keepalive ping every 25s so Cloud Run proxies and Wi-Fi routers never drop idle lobby sockets
  const wsPingInterval = setInterval(() => {
    for (const ws of socketsByClientId.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }
  }, 25000);
  wss.on('close', () => clearInterval(wsPingInterval));

  wss.on('connection', (ws) => {
    const clientId = `ws-${clientSeq++}`;
    socketsByClientId.set(clientId, ws);

    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientToServerMessage;
      } catch {
        sendToClient(clientId, { type: 'error', message: 'Invalid message format.' });
        return;
      }

      if (msg.type === 'create_room') {
        const { room, player } = roomManager.createRoom(clientId, msg.name || 'Player');
        sendToClient(clientId, {
          type: 'room_joined',
          playerId: player.id,
          room: roomManager.serializeLobby(room),
        });
      } else if (msg.type === 'join_room') {
        const res = roomManager.joinRoom(clientId, msg.code || '', msg.name || 'Player');
        if (!res.ok) {
          sendToClient(clientId, { type: 'error', message: res.error });
          return;
        }
        const lobbyState = roomManager.serializeLobby(res.room);
        sendToClient(clientId, {
          type: 'room_joined',
          playerId: res.player.id,
          room: lobbyState,
          snapshot: res.snapshot,
        });
        // Notify other players in the room
        for (const otherId of res.room.players.keys()) {
          if (otherId !== clientId) {
            sendToClient(otherId, { type: 'room_state', room: lobbyState });
          }
        }
      } else if (msg.type === 'switch_team') {
        const res = roomManager.switchTeam(clientId, msg.team);
        if (!res.ok) {
          sendToClient(clientId, { type: 'error', message: res.error });
          return;
        }
        broadcastToRoom(res.room, {
          type: 'room_state',
          room: roomManager.serializeLobby(res.room),
        });
      } else if (msg.type === 'update_config') {
        const res = roomManager.updateConfig(clientId, msg.config);
        if (!res.ok) {
          sendToClient(clientId, { type: 'error', message: res.error });
          return;
        }
        broadcastToRoom(res.room, {
          type: 'room_state',
          room: roomManager.serializeLobby(res.room),
        });
      } else if (msg.type === 'start_match') {
        const res = roomManager.startMatch(clientId);
        if (!res.ok) {
          sendToClient(clientId, { type: 'error', message: res.error });
          return;
        }
        broadcastToRoom(res.room, {
          type: 'match_started',
          room: roomManager.serializeLobby(res.room),
          snapshot: res.snapshot,
        });
      } else if (msg.type === 'return_to_lobby') {
        const res = roomManager.returnToLobby(clientId);
        if (!res.ok) {
          sendToClient(clientId, { type: 'error', message: res.error });
          return;
        }
        broadcastToRoom(res.room, {
          type: 'returned_to_lobby',
          room: roomManager.serializeLobby(res.room),
        });
      } else if (msg.type === 'leave_room') {
        const { room } = roomManager.leaveRoom(clientId);
        if (room) {
          broadcastToRoom(room, {
            type: 'room_state',
            room: roomManager.serializeLobby(room),
          });
        }
      } else if (msg.type === 'input') {
        roomManager.handleInput(clientId, msg.input);
      }
    });

    ws.on('close', () => {
      socketsByClientId.delete(clientId);
      const { room } = roomManager.leaveRoom(clientId);
      if (room) {
        broadcastToRoom(room, {
          type: 'room_state',
          room: roomManager.serializeLobby(room),
        });
      }
    });
  });

  // Authoritative 30Hz simulation loop across active playing rooms
  const TICK_MS = 1000 / 30;
  let lastTickTime = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(Math.max((now - lastTickTime) / 1000, 0.005), 0.06);
    lastTickTime = now;

    for (const room of roomManager.getAllRooms()) {
      if (room.status !== 'playing') continue;
      const { snapshot, events } = roomManager.stepRoom(room, dt);
      broadcastToRoom(room, { type: 'state', snapshot, events });
    }
  }, TICK_MS);

  // Mount Vite dev middleware in dev, or serve static dist/ in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        cors: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    const lanUrls = getLanUrls(PORT);
    console.log(`Capture the Flag multiplayer server listening on http://0.0.0.0:${PORT}`);
    if (lanUrls.length > 0) {
      console.log(`Same Wi-Fi / LAN join URLs: ${lanUrls.join(', ')}`);
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start Capture the Flag server:', err);
  process.exit(1);
});
