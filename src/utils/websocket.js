import { useState, useEffect, useRef } from 'react';
import { authenticatedFetch } from './api';

export function useWebSocket() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const transportMode = (import.meta.env.VITE_REALTIME_TRANSPORT || 'sse').toLowerCase();
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    if (transportMode === 'websocket') {
      connectWebSocket();
    } else {
      connectSSE();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws && transportMode === 'websocket') {
        ws.close();
      }
      if (ws && transportMode === 'sse' && ws.close) {
        ws.close();
      }
    };
  }, [transportMode]); // Keep dependency array but add proper cleanup

  const connectSSE = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const url = new URL(`${protocol}//${window.location.host}/events`);

      if (token) {
        url.searchParams.set('token', token);
      }

      const eventSource = new EventSource(url.toString());

      eventSource.onopen = () => {
        setIsConnected(true);
        setWs(eventSource);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        setWs(null);
        eventSource.close();

        reconnectTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, 3000);
      };
    } catch (error) {
      console.error('Error creating SSE connection:', error);
    }
  };

  const connectWebSocket = async () => {
    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';

      // Construct WebSocket URL
      let wsUrl;

      if (isPlatform) {
        // Platform mode: Use same domain as the page (goes through proxy)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws`;
      } else {
        // OSS mode: Connect to same host:port that served the page
        const token = localStorage.getItem('auth-token');
        if (!token) {
          console.warn('No authentication token found for WebSocket connection');
          return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      }

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        setWs(websocket);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        setWs(null);
        
        // Attempt to reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  };

  const sendMessage = (message) => {
    if (transportMode === 'websocket') {
      if (ws && isConnected) {
        ws.send(JSON.stringify(message));
      } else {
        console.warn('WebSocket not connected');
      }
      return;
    }

    authenticatedFetch('/api/realtime/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    }).catch((error) => {
      console.error('Failed to send realtime message over HTTP:', error);
    });
  };

  return {
    ws,
    sendMessage,
    messages,
    isConnected
  };
}
