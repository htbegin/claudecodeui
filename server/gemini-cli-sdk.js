/**
 * Gemini CLI SDK Integration
 * ==========================
 *
 * This module provides a Gemini CLI SDK-style integration that mirrors the
 * streaming interface used by other providers. It wraps the Gemini CLI process
 * and emits realtime events that the frontend can consume.
 */

import { spawn } from 'child_process';
import { buildProxyEnv } from './utils/proxyEnv.js';

const activeGeminiSessions = new Map();

function normalizeGeminiText(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (payload.text) return payload.text;
  if (payload.output?.text) return payload.output.text;
  if (payload.delta?.text) return payload.delta.text;
  if (payload.message?.content) return payload.message.content;
  return null;
}

function sendGeminiText(ws, text) {
  if (!text) return;
  ws.send({
    type: 'gemini-response',
    data: {
      type: 'text_delta',
      text
    }
  });
}

export async function queryGeminiSDK(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const currentSessionId = sessionId || `gemini-${Date.now()}`;

  const args = [];
  if (model) {
    args.push('--model', model);
  }
  if (permissionMode && permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }

  const proxyEnv = buildProxyEnv('GEMINI');

  const geminiProcess = spawn('gemini', args, {
    cwd: workingDirectory,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.keys(proxyEnv).length > 0 ? { ...process.env, ...proxyEnv } : process.env
  });

  activeGeminiSessions.set(currentSessionId, {
    process: geminiProcess,
    status: 'running',
    startedAt: new Date().toISOString()
  });

  ws.send({
    type: 'session-created',
    sessionId: currentSessionId,
    provider: 'gemini'
  });

  if (command && command.trim()) {
    geminiProcess.stdin.write(command.trim());
    geminiProcess.stdin.write('\n');
  }
  geminiProcess.stdin.end();

  geminiProcess.stdout.on('data', (data) => {
    const raw = data.toString();
    const lines = raw.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return;
    }

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const text = normalizeGeminiText(parsed);
        if (text) {
          sendGeminiText(ws, text);
        }
      } catch (error) {
        sendGeminiText(ws, line);
      }
    }
  });

  geminiProcess.stderr.on('data', (data) => {
    ws.send({
      type: 'gemini-error',
      error: data.toString()
    });
  });

  geminiProcess.on('close', (code) => {
    const session = activeGeminiSessions.get(currentSessionId);
    if (session) {
      session.status = 'completed';
    }

    ws.send({
      type: 'gemini-complete',
      sessionId: currentSessionId,
      exitCode: code
    });
  });
}

export function abortGeminiSession(sessionId) {
  const session = activeGeminiSessions.get(sessionId);
  if (!session || !session.process) {
    return false;
  }

  session.status = 'aborted';
  session.process.kill('SIGTERM');
  return true;
}

export function isGeminiSessionActive(sessionId) {
  const session = activeGeminiSessions.get(sessionId);
  return session?.status === 'running';
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
