/**
 * Gemini CLI SDK Integration
 * ==========================
 *
 * Provides streaming integration with the Gemini CLI SDK.
 * Exposes a similar interface to claude-sdk.js and openai-codex.js
 * for session management, abort handling, and realtime streaming.
 */

const activeGeminiSessions = new Map();

let sdkModulePromise = null;

async function loadGeminiSdk() {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@google/gemini-cli-sdk');
  }
  return sdkModulePromise;
}

function resolveGeminiClient(sdkModule) {
  if (sdkModule?.createClient) {
    return sdkModule.createClient;
  }
  const GeminiClient = sdkModule?.GeminiCLI
    || sdkModule?.GeminiCli
    || sdkModule?.GeminiClient
    || sdkModule?.default;
  if (GeminiClient) {
    return (options) => new GeminiClient(options);
  }
  return null;
}

function resolveSessionStarter(client) {
  if (client?.startSession) return client.startSession.bind(client);
  if (client?.createSession) return client.createSession.bind(client);
  if (client?.session) return client.session.bind(client);
  return null;
}

function resolveSessionResumer(client) {
  if (client?.resumeSession) return client.resumeSession.bind(client);
  if (client?.resume) return client.resume.bind(client);
  return null;
}

function resolveStreamRunner(session) {
  if (session?.sendMessageStream) return session.sendMessageStream.bind(session);
  if (session?.runStream) return session.runStream.bind(session);
  if (session?.stream) return session.stream.bind(session);
  if (session?.sendMessage) {
    return async (command, options) => {
      const result = await session.sendMessage(command, options);
      return [result];
    };
  }
  return null;
}

function extractText(event) {
  if (!event) return null;
  if (typeof event === 'string') return event;
  if (typeof event.text === 'string') return event.text;
  if (event.delta && typeof event.delta.text === 'string') return event.delta.text;
  if (typeof event.content === 'string') return event.content;
  if (event.message && typeof event.message.content === 'string') return event.message.content;
  if (event.candidates?.[0]?.content?.parts?.length) {
    return event.candidates[0].content.parts
      .map(part => part.text || '')
      .filter(Boolean)
      .join('');
  }
  return null;
}

function extractUsage(event) {
  if (!event) return null;
  const usage = event.usage || event.tokenUsage || event.usageMetadata;
  if (!usage) return null;
  const inputTokens = usage.promptTokenCount || usage.inputTokens || usage.prompt_tokens || 0;
  const outputTokens = usage.candidatesTokenCount || usage.outputTokens || usage.completion_tokens || 0;
  const totalTokens = usage.totalTokenCount || usage.total_tokens || inputTokens + outputTokens;
  return {
    used: totalTokens || (inputTokens + outputTokens),
    total: parseInt(process.env.GEMINI_CONTEXT_WINDOW, 10) || 200000
  };
}

function sendMessage(ws, data) {
  try {
    if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    } else if (typeof ws.write === 'function') {
      ws.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  } catch (error) {
    console.error('[Gemini] Error sending message:', error);
  }
}

export async function queryGemini(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  let currentSessionId = sessionId;

  try {
    const sdkModule = await loadGeminiSdk();
    const createClient = resolveGeminiClient(sdkModule);
    if (!createClient) {
      throw new Error('Gemini CLI SDK not available. Install @google/gemini-cli-sdk to enable Gemini support.');
    }

    const client = createClient({
      workingDirectory,
      model,
      permissionMode
    });

    const startSession = resolveSessionStarter(client);
    const resumeSession = resolveSessionResumer(client);

    if (!startSession) {
      throw new Error('Gemini CLI SDK client does not support session creation.');
    }

    let session;
    if (sessionId && resumeSession) {
      session = await resumeSession(sessionId, { workingDirectory, model, permissionMode });
    } else {
      session = await startSession({ workingDirectory, model, permissionMode });
    }

    currentSessionId = session?.id || sessionId || `gemini-${Date.now()}`;

    activeGeminiSessions.set(currentSessionId, {
      session,
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd: workingDirectory,
      messages: [],
      lastActivity: Date.now(),
      model
    });

    sendMessage(ws, {
      type: 'session-created',
      sessionId: currentSessionId,
      provider: 'gemini'
    });

    const sessionRecord = activeGeminiSessions.get(currentSessionId);
    if (sessionRecord) {
      sessionRecord.messages.push({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: command }
      });
    }

    const runStream = resolveStreamRunner(session);
    if (!runStream) {
      throw new Error('Gemini CLI SDK session does not support streaming.');
    }

    const stream = await runStream(command, { model, permissionMode });

    let assistantBuffer = '';

    for await (const event of stream) {
      const sessionInfo = activeGeminiSessions.get(currentSessionId);
      if (!sessionInfo || sessionInfo.status === 'aborted') {
        break;
      }

      const textChunk = extractText(event);
      if (textChunk) {
        assistantBuffer += textChunk;
        sendMessage(ws, {
          type: 'gemini-response',
          data: { type: 'text', text: textChunk },
          sessionId: currentSessionId
        });
      }

      const usage = extractUsage(event);
      if (usage) {
        sendMessage(ws, {
          type: 'token-budget',
          data: usage
        });
      }
    }

    if (assistantBuffer && activeGeminiSessions.has(currentSessionId)) {
      const sessionInfo = activeGeminiSessions.get(currentSessionId);
      sessionInfo.messages.push({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { role: 'assistant', content: assistantBuffer }
      });
      sessionInfo.lastActivity = Date.now();
    }

    sendMessage(ws, {
      type: 'gemini-complete',
      sessionId: currentSessionId
    });
  } catch (error) {
    console.error('[Gemini] Error:', error);
    sendMessage(ws, {
      type: 'gemini-error',
      error: error.message,
      sessionId: currentSessionId
    });
  } finally {
    if (currentSessionId) {
      const sessionInfo = activeGeminiSessions.get(currentSessionId);
      if (sessionInfo) {
        sessionInfo.status = sessionInfo.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

export function abortGeminiSession(sessionId) {
  const sessionInfo = activeGeminiSessions.get(sessionId);
  if (!sessionInfo) {
    return false;
  }

  sessionInfo.status = 'aborted';

  const session = sessionInfo.session;
  if (session?.abort) {
    session.abort();
  } else if (session?.cancel) {
    session.cancel();
  }

  return true;
}

export function isGeminiSessionActive(sessionId) {
  const sessionInfo = activeGeminiSessions.get(sessionId);
  return sessionInfo?.status === 'running';
}

export function getActiveGeminiSessions() {
  const sessions = [];

  for (const [id, session] of activeGeminiSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

export function getGeminiSessions(projectPath) {
  const sessions = [];

  for (const [id, session] of activeGeminiSessions.entries()) {
    if (projectPath && session.cwd !== projectPath) {
      continue;
    }

    sessions.push({
      id,
      summary: session.messages?.find(msg => msg.type === 'user')?.message?.content?.slice(0, 50) || 'Gemini Session',
      messageCount: session.messages?.length || 0,
      lastActivity: session.lastActivity ? new Date(session.lastActivity).toISOString() : session.startedAt,
      cwd: session.cwd,
      model: session.model,
      provider: 'gemini'
    });
  }

  sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return sessions.slice(0, 5);
}

export function getGeminiSessionMessages(sessionId, limit = null, offset = 0) {
  const sessionInfo = activeGeminiSessions.get(sessionId);
  if (!sessionInfo) {
    return { messages: [], total: 0, hasMore: false };
  }

  const messages = sessionInfo.messages || [];
  const total = messages.length;

  if (limit !== null) {
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = messages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  }

  return { messages, total, hasMore: false };
}

export function deleteGeminiSession(sessionId) {
  if (activeGeminiSessions.has(sessionId)) {
    activeGeminiSessions.delete(sessionId);
    return true;
  }
  return false;
}

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;

  for (const [id, session] of activeGeminiSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeGeminiSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000);
