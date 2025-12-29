const clients = new Map();

function formatSsePayload(data) {
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data);
}

function createClient(clientId, res) {
  let sessionId = null;

  const send = (data) => {
    if (res.writableEnded) {
      return;
    }
    const payload = formatSsePayload(data);
    res.write(`data: ${payload}\n\n`);
  };

  const end = () => {
    if (!res.writableEnded) {
      res.end();
    }
  };

  const setSessionId = (value) => {
    sessionId = value;
  };

  const getSessionId = () => sessionId;

  return {
    id: clientId,
    res,
    send,
    end,
    setSessionId,
    getSessionId
  };
}

export function registerSseClient(clientId, res) {
  const existing = clients.get(clientId);
  if (existing) {
    existing.end();
    clients.delete(clientId);
  }

  const client = createClient(clientId, res);
  clients.set(clientId, client);
  return client;
}

export function removeSseClient(clientId) {
  const client = clients.get(clientId);
  if (client) {
    client.end();
    clients.delete(clientId);
  }
}

export function getSseClient(clientId) {
  return clients.get(clientId);
}

export function broadcastSseMessage(message) {
  for (const client of clients.values()) {
    try {
      client.send(message);
    } catch (error) {
      console.error('Error sending SSE message:', error);
    }
  }
}

