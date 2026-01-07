import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { authenticatedFetch } from '../utils/api';

const xtermStyles = `
  .xterm .xterm-screen {
    outline: none !important;
  }
  .xterm:focus .xterm-screen {
    outline: none !important;
  }
  .xterm-screen:focus {
    outline: none !important;
  }
`;

if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = xtermStyles;
  document.head.appendChild(styleSheet);
}

function Shell({ selectedProject, selectedSession, initialCommand, isPlainShell = false, onProcessComplete, minimal = false, autoConnect = false }) {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const streamAbortControllerRef = useRef(null);
  const bufferRef = useRef('');
  const clientIdRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const onProcessCompleteRef = useRef(onProcessComplete);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    onProcessCompleteRef.current = onProcessComplete;
  });

  if (!clientIdRef.current) {
    const existing = sessionStorage.getItem('shell-client-id');
    if (existing) {
      clientIdRef.current = existing;
    } else {
      const generated = crypto?.randomUUID?.() || `shell-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem('shell-client-id', generated);
      clientIdRef.current = generated;
    }
  }

  const parseSsePayload = (payload) => {
    if (!payload) {
      return null;
    }
    try {
      return JSON.parse(payload);
    } catch (error) {
      return { type: 'raw', data: payload };
    }
  };

  const sendShellInput = useCallback((data) => {
    if (!clientIdRef.current) {
      return;
    }

    authenticatedFetch('/api/shell/input', {
      method: 'POST',
      body: JSON.stringify({
        clientId: clientIdRef.current,
        data
      })
    }).catch((error) => {
      console.error('[Shell] Error sending input:', error);
    });
  }, []);

  const sendShellResize = useCallback((cols, rows) => {
    if (!clientIdRef.current) {
      return;
    }

    authenticatedFetch('/api/shell/resize', {
      method: 'POST',
      body: JSON.stringify({
        clientId: clientIdRef.current,
        cols,
        rows
      })
    }).catch((error) => {
      console.error('[Shell] Error sending resize:', error);
    });
  }, []);

  const connectShellStream = useCallback(async () => {
    if (isConnecting || isConnected) return;

    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
      const token = localStorage.getItem('auth-token');
      if (!isPlatform && !token) {
        console.error('No authentication token found for Shell stream connection');
        setIsConnecting(false);
        return;
      }

      if (streamAbortControllerRef.current) {
        streamAbortControllerRef.current.abort();
      }

      const controller = new AbortController();
      streamAbortControllerRef.current = controller;
      bufferRef.current = '';

      const params = new URLSearchParams();
      params.set('clientId', clientIdRef.current);
      params.set('projectPath', selectedProjectRef.current.fullPath || selectedProjectRef.current.path);
      params.set('sessionId', isPlainShellRef.current ? '' : (selectedSessionRef.current?.id || ''));
      params.set('hasSession', isPlainShellRef.current ? 'false' : String(!!selectedSessionRef.current));
      params.set('provider', isPlainShellRef.current ? 'plain-shell' : (selectedSessionRef.current?.__provider || 'claude'));
      params.set('cols', terminal.current?.cols || 80);
      params.set('rows', terminal.current?.rows || 24);
      if (initialCommandRef.current) {
        params.set('initialCommand', initialCommandRef.current);
      }
      params.set('isPlainShell', String(isPlainShellRef.current));

      const response = await authenticatedFetch(`/api/shell/stream?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream'
        },
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect shell stream: ${response.status}`);
      }

      setIsConnected(true);
      setIsConnecting(false);

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
          const data = parseSsePayload(payload);
          if (!data) {
            continue;
          }

          if (data.type === 'output') {
            let output = data.data;

            if (isPlainShellRef.current && onProcessCompleteRef.current) {
              const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
              if (cleanOutput.includes('Process exited with code 0')) {
                onProcessCompleteRef.current(0);
              } else if (cleanOutput.match(/Process exited with code (\d+)/)) {
                const exitCode = parseInt(cleanOutput.match(/Process exited with code (\d+)/)[1]);
                if (exitCode !== 0) {
                  onProcessCompleteRef.current(exitCode);
                }
              }
            }

            if (terminal.current) {
              terminal.current.write(output);
            }
          } else if (data.type === 'url_open') {
            window.open(data.url, '_blank');
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Shell] Error handling shell stream:', error);
      }
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, [isConnecting, isConnected]);

  const connectToShell = useCallback(() => {
    if (!isInitialized || isConnected || isConnecting) return;
    setIsConnecting(true);
    connectShellStream();
  }, [isInitialized, isConnected, isConnecting, connectShellStream]);

  const disconnectFromShell = useCallback(() => {
    if (streamAbortControllerRef.current) {
      streamAbortControllerRef.current.abort();
      streamAbortControllerRef.current = null;
    }

    if (terminal.current) {
      terminal.current.clear();
      terminal.current.write('\x1b[2J\x1b[H');
    }

    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const sessionDisplayName = useMemo(() => {
    if (!selectedSession) return null;
    return selectedSession.__provider === 'cursor'
      ? (selectedSession.name || 'Untitled Session')
      : (selectedSession.summary || 'New Session');
  }, [selectedSession]);

  const sessionDisplayNameShort = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 30);
  }, [sessionDisplayName]);

  const sessionDisplayNameLong = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 50);
  }, [sessionDisplayName]);

  const restartShell = () => {
    setIsRestarting(true);

    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    if (terminal.current) {
      terminal.current.dispose();
      terminal.current = null;
      fitAddon.current = null;
    }

    setIsConnected(false);
    setIsInitialized(false);

    setTimeout(() => {
      setIsRestarting(false);
    }, 200);
  };

  useEffect(() => {
    const currentSessionId = selectedSession?.id || null;

    if (lastSessionId !== null && lastSessionId !== currentSessionId && isInitialized) {
      disconnectFromShell();
    }

    setLastSessionId(currentSessionId);
  }, [selectedSession?.id, isInitialized, disconnectFromShell]);

  useEffect(() => {
    if (!terminalRef.current || !selectedProject || isRestarting || terminal.current) {
      return;
    }


    terminal.current = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: true,
      scrollback: 10000,
      tabStopWidth: 4,
      windowsMode: false,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: false,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selection: '#264f78',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
        extendedAnsi: [
          '#000000', '#800000', '#008000', '#808000',
          '#000080', '#800080', '#008080', '#c0c0c0',
          '#808080', '#ff0000', '#00ff00', '#ffff00',
          '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
        ]
      }
    });

    fitAddon.current = new FitAddon();
    const webglAddon = new WebglAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(webLinksAddon);
    // Note: ClipboardAddon removed - we handle clipboard operations manually in attachCustomKeyEventHandler

    try {
      terminal.current.loadAddon(webglAddon);
    } catch (error) {
      console.warn('[Shell] WebGL renderer unavailable, using Canvas fallback');
    }

    terminal.current.open(terminalRef.current);

    terminal.current.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && terminal.current.hasSelection()) {
        document.execCommand('copy');
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        navigator.clipboard.readText().then(text => {
          sendShellInput(text);
        }).catch(() => {});
        return false;
      }

      return true;
    });

    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
        if (terminal.current) {
          sendShellResize(terminal.current.cols, terminal.current.rows);
        }
      }
    }, 100);

    setIsInitialized(true);
    terminal.current.onData((data) => {
      sendShellInput(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && terminal.current) {
        setTimeout(() => {
          fitAddon.current.fit();
          sendShellResize(terminal.current.cols, terminal.current.rows);
        }, 50);
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();

      if (streamAbortControllerRef.current) {
        streamAbortControllerRef.current.abort();
        streamAbortControllerRef.current = null;
      }

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    };
  }, [selectedProject?.path || selectedProject?.fullPath, isRestarting, sendShellInput, sendShellResize]);

  useEffect(() => {
    if (!autoConnect || !isInitialized || isConnecting || isConnected) return;
    connectToShell();
  }, [autoConnect, isInitialized, isConnecting, isConnected, connectToShell]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Select a Project</h3>
          <p>Choose a project to open an interactive shell in that directory</p>
        </div>
      </div>
    );
  }

  if (minimal) {
    return (
      <div className="h-full w-full bg-gray-900">
        <div ref={terminalRef} className="h-full w-full focus:outline-none" style={{ outline: 'none' }} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 w-full">
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {selectedSession && (
              <span className="text-xs text-blue-300">
                ({sessionDisplayNameShort}...)
              </span>
            )}
            {!selectedSession && (
              <span className="text-xs text-gray-400">(New Session)</span>
            )}
            {!isInitialized && (
              <span className="text-xs text-yellow-400">(Initializing...)</span>
            )}
            {isRestarting && (
              <span className="text-xs text-blue-400">(Restarting...)</span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {isConnected && (
              <button
                onClick={disconnectFromShell}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-1"
                title="Disconnect from shell"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Disconnect</span>
              </button>
            )}

            <button
              onClick={restartShell}
              disabled={isRestarting || isConnected}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
              title="Restart Shell (disconnect first)"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Restart</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-2 overflow-hidden relative">
        <div ref={terminalRef} className="h-full w-full focus:outline-none" style={{ outline: 'none' }} />

        {!isInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
            <div className="text-white">Loading terminal...</div>
          </div>
        )}

        {isInitialized && !isConnected && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <button
                onClick={connectToShell}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full sm:w-auto"
                title="Connect to shell"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Continue in Shell</span>
              </button>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `Run ${initialCommand || 'command'} in ${selectedProject.displayName}` :
                  selectedSession ?
                    `Resume session: ${sessionDisplayNameLong}...` :
                    'Start a new Claude session'
                }
              </p>
            </div>
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <div className="flex items-center justify-center space-x-3 text-yellow-400">
                <div className="w-6 h-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
                <span className="text-base font-medium">Connecting to shell...</span>
              </div>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `Running ${initialCommand || 'command'} in ${selectedProject.displayName}` :
                  `Starting Claude CLI in ${selectedProject.displayName}`
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Shell;
