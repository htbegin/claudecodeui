import { WebSocket } from 'ws';

// Unified registry for realtime clients across WebSocket and SSE transports
const realtimeClients = new Set();

function formatSsePayload(message) {
  const eventName = message?.type || 'message';
  const data = JSON.stringify(message);
  return `event: ${eventName}\ndata: ${data}\n\n`;
}

function sendToClient(client, message) {
  if (!client) return;

  if (client.type === 'ws') {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
    return;
  }

  if (client.type === 'sse') {
    try {
      client.res.write(formatSsePayload(message));
    } catch (error) {
      console.error('[ERROR] Failed to write SSE payload:', error);
    }
  }
}

function broadcastRealtime(message, { userId } = {}) {
  realtimeClients.forEach((client) => {
    if (userId && client.userId !== userId) return;
    sendToClient(client, message);
  });
}

function registerWebSocketClient(ws, user) {
  const client = { type: 'ws', socket: ws, userId: user?.userId };
  realtimeClients.add(client);

  ws.on('close', () => {
    realtimeClients.delete(client);
  });

  return client;
}

function registerSseClient(res, user) {
  const client = { type: 'sse', res, userId: user?.userId };
  realtimeClients.add(client);

  res.on('close', () => {
    realtimeClients.delete(client);
  });

  return client;
}

function getClientForUser(userId) {
  for (const client of realtimeClients) {
    if (client.userId === userId) {
      return client;
    }
  }
  return null;
}

export {
  broadcastRealtime,
  registerWebSocketClient,
  registerSseClient,
  getClientForUser,
};
