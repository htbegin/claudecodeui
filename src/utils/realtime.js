import { useState, useEffect, useRef, useCallback } from 'react';
import { authenticatedFetch } from './api';

const RECONNECT_DELAY_MS = 3000;

function parseSsePayload(payload) {
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    return { type: 'raw', data: payload };
  }
}

export function useRealtimeStream() {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const bufferRef = useRef('');
  const clientIdRef = useRef(null);

  if (!clientIdRef.current) {
    const existing = sessionStorage.getItem('realtime-client-id');
    if (existing) {
      clientIdRef.current = existing;
    } else {
      const generated = crypto?.randomUUID?.() || `realtime-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem('realtime-client-id', generated);
      clientIdRef.current = generated;
    }
  }

  const connect = useCallback(async () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
    const token = localStorage.getItem('auth-token');

    if (!isPlatform && !token) {
      console.warn('No authentication token found for realtime connection');
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, RECONNECT_DELAY_MS);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    bufferRef.current = '';

    try {
      const response = await authenticatedFetch(`/api/realtime/stream?clientId=${encodeURIComponent(clientIdRef.current)}`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream'
        },
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect realtime stream: ${response.status}`);
      }

      setIsConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        bufferRef.current += decoder.decode(value, { stream: true });
        const parts = bufferRef.current.split('\n\n');
        bufferRef.current = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          const dataLines = [];
          for (const line of lines) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }

          const payload = dataLines.join('\n');
          const parsed = parseSsePayload(payload);
          if (parsed) {
            setMessages(prev => [...prev, parsed]);
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Realtime connection error:', error);
      }
    } finally {
      setIsConnected(false);
      if (!controller.signal.aborted) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      }
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [connect]);

  const sendMessage = useCallback(async (message) => {
    if (!clientIdRef.current) {
      console.warn('Realtime clientId not ready');
      return;
    }

    try {
      await authenticatedFetch('/api/realtime/command', {
        method: 'POST',
        body: JSON.stringify({
          clientId: clientIdRef.current,
          ...message
        })
      });
    } catch (error) {
      console.error('Realtime command error:', error);
    }
  }, []);

  return {
    sendMessage,
    messages,
    isConnected,
    clientId: clientIdRef.current
  };
}
