# WebSocket Dependencies and Firewall-Friendly Alternatives

## Current WebSocket Usage

- **Shared chat/project channel (`/ws`)**
  - Frontend opens a WebSocket as soon as the app loads and pushes parsed JSON messages into a shared context for chat commands and project/task notifications. The client reconnects automatically and authenticates via query-token unless platform mode is enabled.【F:src/utils/websocket.js†L3-L94】
  - The backend exposes a single `WebSocketServer` with a connection gate and routes `/ws` traffic to `handleChatConnection`, where chat and session-control messages are parsed and dispatched to Claude or Cursor handlers. Connected clients are also tracked for file-system watcher broadcasts (`projects_updated`).【F:server/index.js†L172-L258】【F:server/index.js†L686-L808】

- **Shell terminal channel (`/shell`)**
  - The terminal component opens a dedicated WebSocket to `/shell`, authenticates with a token, sends an `init` payload describing the current project/session, and streams PTY output back to the browser. Connection errors clear the terminal UI.【F:src/components/Shell.jsx†L60-L146】
  - On the server, `/shell` connections are routed to `handleShellConnection`, which manages PTY sessions, buffering/replay, and provider-specific startup commands, streaming output over the WebSocket as JSON messages.【F:server/index.js†L810-L900】

- **TaskMaster realtime notifications**
  - Server utilities broadcast TaskMaster project/task/MCP status updates over the WebSocket server, and the TaskMaster context reacts to those message types to trigger targeted API refreshes.【F:server/utils/taskmaster-websocket.js†L9-L123】【F:src/contexts/TaskMasterContext.jsx†L240-L274】

## Why WebSockets Are Used

- **Low-latency streaming for conversations:** Chat requests send incremental results and control signals (abort, status, active sessions) over the `/ws` channel without repeated HTTP handshakes.【F:server/index.js†L705-L808】
- **Interactive shell I/O:** The embedded terminal requires near-real-time stdout/stderr delivery and user input forwarding, which is naturally supported by a duplex WebSocket stream.【F:src/components/Shell.jsx†L60-L142】【F:server/index.js†L810-L900】
- **Push-based project/task updates:** File-system watcher results and TaskMaster state changes are pushed immediately to all connected clients instead of polling APIs.【F:server/index.js†L172-L210】【F:server/index.js†L686-L808】【F:server/utils/taskmaster-websocket.js†L9-L123】【F:src/contexts/TaskMasterContext.jsx†L240-L274】

## Constraints in Firewall-Blocked Environments

The deployment target forbids WebSocket upgrades, but the chat experience must remain available. Other real-time features (shell, live project updates) can be disabled if necessary.

## Replacement Strategies

This section expands step two of the analysis with concrete adaptations that preserve the chat experience without WebSockets and
minimize divergence from upstream code.

### 1) Server-Sent Events (SSE) fallback for chat/project updates
- **Approach:** Add an `/events` endpoint that streams `text/event-stream` responses. Reuse existing message envelopes (e.g., `projects_updated`, `taskmaster-*`, chat streaming packets) by piping the same payloads into the SSE stream instead of `ws.send`.
- **Client:** Implement a transport abstraction in the WebSocket context so the app can choose `WebSocket` or `EventSource` based on capability/config. Messages continue to flow through the same context consumers (App, TaskMasterContext) with minimal changes.
- **Limitations:** SSE is one-way; client requests (e.g., `claude-command`, aborts) must be issued over HTTP endpoints. Introduce REST endpoints mirroring the existing WebSocket command types so chat control remains functional when SSE mode is active.
- **Delivery contract:** Prefix each SSE event with `event:<type>` matching the current WebSocket `type` field and send `data:<json>` so existing reducers can switch transports without schema changes.

### 2) Long-polling/HTTP streaming for chat commands
- **Approach:** For environments where SSE is also restricted, expose chat invocation endpoints that return streaming responses (chunked `text/plain`/`application/json`), or poll a message queue keyed by session ID. Client sends commands via `fetch` and polls for incremental results until completion.
- **Compatibility:** Keep the message format identical to WebSocket payloads so existing reducers/UI handlers can process them after minimal adaptation in the transport layer.
- **Trade-offs:** Higher latency and increased server load compared to SSE/WebSocket, but works over plain HTTPS with no upgrade requirements.
- **Timeout guidance:** Keep poll windows short (5–10s) and use `lastEventId`/cursor parameters to avoid re-delivery when the network is lossy.

### 3) Disable optional realtime features behind config flags
- **Shell:** Provide a configuration toggle to hide or disable the terminal UI when WebSockets are unavailable; offer a fallback "Run command" HTTP API if minimal execution support is required.
- **Project/TaskMaster push:** When SSE/WebSocket is disabled, fall back to periodic REST polling (`/api/projects`, `/api/taskmaster/...`) on a timer that respects the "active session" guard already used in `App.jsx`.
- **Noise control:** Make polling intervals configurable (e.g., 30–60s) and reuse existing context-level `isActive` guards to avoid redundant traffic in background tabs.

## Maintainability & Upstream Sync Plan

To keep upstream WebSocket support intact while adding non-WebSocket transports:

1) **Introduce a transport interface** (e.g., `useRealtimeTransport`) that normalizes `connect`, `send`, and `onMessage` over WebSocket or SSE/long-polling implementations. Gate selection via environment flag or runtime detection so upstream WebSocket behavior stays the default.
2) **Factor shared message handling** (parsing, routing to contexts) into reusable utilities so both transports feed the same pipelines. This minimizes divergence when upstream changes message schemas.
3) **Feature flags per channel** (`enableShellRealtime`, `enableTaskmasterPush`) allow deployments to disable non-essential realtime paths without patching upstream code; defaults remain enabled for compatibility.
4) **Server shims**: wrap WebSocket handlers in thin adapters that can be called from HTTP/SSE code paths, so upstream modifications to chat/shell logic propagate automatically to the fallback transport.
5) **Config surface stability:** Centralize defaults in a single config module (`server/config.js`, `src/config/realtime.js`) so upstream rebases only need to preserve one file when toggling transports.
6) **Message schema linting:** Add a small check in CI that asserts parity between WebSocket message types and REST/SSE payloads (e.g., snapshot of allowed `type` strings) to catch upstream additions that need HTTP equivalents.

## Concrete compatibility plan (non-WebSocket mode)

### Server changes
- **SSE fan-out:** Add an Express route `GET /events` that attaches listeners to the existing WebSocket broadcaster hooks (e.g., `broadcastProjectsUpdated`, TaskMaster updates, chat streaming callbacks) and writes `event:`/`data:` frames to the response. Tie lifecycle to the same auth and "active session" gates used in `handleChatConnection` so authorization remains centralized.【F:server/index.js†L172-L258】【F:server/index.js†L686-L808】
- **HTTP equivalents for chat control:** Mirror each WebSocket chat command with REST endpoints so two-way flows remain possible:
  - `POST /api/chat/send` for `claude-command` payloads (body: {sessionId, message, projectId, files...}).
  - `POST /api/chat/abort` for `abort` frames.
  - `POST /api/chat/set-active-session` for `set_active_session` payloads.
  These routes should internally call the same handlers currently invoked from `handleChatConnection` to keep behavior in sync.【F:server/index.js†L686-L808】
- **Polling-friendly inbox:** For deployments where SSE is unavailable, expose `GET /api/chat/events?cursor=<lastId>` that returns pending message envelopes (identical to WebSocket payloads). A simple in-memory or persistent queue keyed by session ensures idempotent delivery.
- **Optional terminal execution:** If shell is required, wrap existing PTY orchestration (`handleShellConnection`) with an HTTP endpoint that accepts a command and streams stdout as chunked text; otherwise gate the terminal feature flag to hide the UI entirely.【F:server/index.js†L810-L900】
- **Diagnostics & monitoring:** Return transport mode headers (e.g., `X-Realtime-Transport: sse`) and log mode selection so operators can confirm firewall-safe paths are used. Add a minimal `/health/realtime` endpoint that reports which transports are enabled.

### Client changes
- **Transport adapter:** Extend `src/utils/websocket.js` (or a new `realtimeTransport.js`) with an adapter that exposes `connect`, `send`, `onMessage`, and `close` for both WebSocket and SSE/polling transports. Selection occurs via env flag (e.g., `VITE_TRANSPORT=sse`), query parameter, or runtime detection of failed WebSocket upgrade.【F:src/utils/websocket.js†L3-L94】
- **Command routing:** In non-WebSocket mode, chat command dispatchers issue `fetch` calls to the new REST endpoints while message consumers continue to subscribe to the unified transport stream. Minimal UI changes should be needed because envelopes remain unchanged.
- **Polling fallback:** If SSE fails, fall back to interval polling against `GET /api/chat/events` and the existing REST polling for projects/TaskMaster already used as a safety net in `App.jsx` and `TaskMasterContext`.【F:src/contexts/TaskMasterContext.jsx†L240-L274】
- **Feature flags:** Hide or disable the terminal UI via configuration when `enableShellRealtime=false`, and surface a tooltip noting that the enterprise deployment has command execution disabled.
- **Progressive enhancement UX:** Show a transient banner or console log when the app downgrades from WebSocket → SSE → polling, so troubleshooting is straightforward without impacting normal upstream users.

### Rollout and testing
- Provide a configuration matrix in deployment docs that lists `WEBSOCKET_ENABLED`, `SSE_ENABLED`, `POLLING_ENABLED`, `ENABLE_SHELL_REALTIME`, and `ENABLE_TASKMASTER_PUSH` with suggested values for corporate firewalls.
- Add integration smoke tests that run the chat flow over WebSocket (default), SSE (EventSource), and polling to ensure payload compatibility.
- Add regression tests that snapshot message envelopes from both transports to catch upstream schema drift and enforce handler parity.

These steps preserve WebSocket functionality for unrestricted environments while enabling a firewall-safe mode that relies on standard HTTPS requests and streaming responses.
