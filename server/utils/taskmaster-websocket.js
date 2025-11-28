/**
 * TASKMASTER WEBSOCKET UTILITIES
 * ==============================
 * 
 * Utilities for broadcasting TaskMaster state changes via WebSocket.
 * Integrates with the existing WebSocket system to provide real-time updates.
 */

/**
 * Broadcast TaskMaster project update to all connected clients
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} projectName - Name of the updated project
 * @param {Object} taskMasterData - Updated TaskMaster data
 */
export function broadcastTaskMasterProjectUpdate(broadcaster, projectName, taskMasterData) {
    if (!broadcaster || !projectName) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'taskmaster-project-updated',
        projectName,
        taskMasterData,
        timestamp: new Date().toISOString()
    };

    
    sendMessage(broadcaster, message);
}

/**
 * Broadcast TaskMaster tasks update for a specific project
 * @param {WebSocket.Server} wss - WebSocket server instance  
 * @param {string} projectName - Name of the project with updated tasks
 * @param {Object} tasksData - Updated tasks data
 */
export function broadcastTaskMasterTasksUpdate(broadcaster, projectName, tasksData) {
    if (!broadcaster || !projectName) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or projectName');
        return;
    }

    const message = {
        type: 'taskmaster-tasks-updated',
        projectName,
        tasksData,
        timestamp: new Date().toISOString()
    };

    
    sendMessage(broadcaster, message);
}

/**
 * Broadcast MCP server status change
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {Object} mcpStatus - Updated MCP server status
 */
export function broadcastMCPStatusChange(broadcaster, mcpStatus) {
    if (!broadcaster) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss');
        return;
    }

    const message = {
        type: 'taskmaster-mcp-status-changed',
        mcpStatus,
        timestamp: new Date().toISOString()
    };

    
    sendMessage(broadcaster, message);
}

/**
 * Broadcast general TaskMaster update notification
 * @param {WebSocket.Server} wss - WebSocket server instance
 * @param {string} updateType - Type of update (e.g., 'initialization', 'configuration')
 * @param {Object} data - Additional data about the update
 */
export function broadcastTaskMasterUpdate(broadcaster, updateType, data = {}) {
    if (!broadcaster || !updateType) {
        console.warn('TaskMaster WebSocket broadcast: Missing wss or updateType');
        return;
    }

    const message = {
        type: 'taskmaster-update',
        updateType,
        data,
        timestamp: new Date().toISOString()
    };

    
    sendMessage(broadcaster, message);
}

function sendMessage(broadcaster, message) {
    if (broadcaster.broadcast) {
        broadcaster.broadcast(message);
        return;
    }

    if (broadcaster.clients) {
        broadcaster.clients.forEach((client) => {
            if (client.readyState === 1) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending TaskMaster update:', error);
                }
            }
        });
    }
}