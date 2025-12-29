/**
 * TASKMASTER EVENT UTILITIES
 * ==========================
 *
 * Utilities for broadcasting TaskMaster state changes via SSE.
 */

import { broadcastSseMessage } from './sse.js';

export function broadcastTaskMasterProjectUpdate(projectName, taskMasterData) {
  if (!projectName) {
    console.warn('TaskMaster event broadcast: Missing projectName');
    return;
  }

  broadcastSseMessage({
    type: 'taskmaster-project-updated',
    projectName,
    taskMasterData,
    timestamp: new Date().toISOString()
  });
}

export function broadcastTaskMasterTasksUpdate(projectName, tasksData) {
  if (!projectName) {
    console.warn('TaskMaster event broadcast: Missing projectName');
    return;
  }

  broadcastSseMessage({
    type: 'taskmaster-tasks-updated',
    projectName,
    tasksData,
    timestamp: new Date().toISOString()
  });
}

export function broadcastMCPStatusChange(mcpStatus) {
  broadcastSseMessage({
    type: 'taskmaster-mcp-status-changed',
    mcpStatus,
    timestamp: new Date().toISOString()
  });
}

export function broadcastTaskMasterUpdate(updateType, data = {}) {
  if (!updateType) {
    console.warn('TaskMaster event broadcast: Missing updateType');
    return;
  }

  broadcastSseMessage({
    type: 'taskmaster-update',
    updateType,
    data,
    timestamp: new Date().toISOString()
  });
}

