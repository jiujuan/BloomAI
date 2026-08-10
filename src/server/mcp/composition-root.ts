import { MastraMcpAdapter } from './mastra-adapter'
import { McpConnectionManager } from './connection-manager'
import { McpCapabilityBroker } from './capability-broker'

/**
 * Process-level MCP dependencies shared by Mastra Agents and the management
 * HTTP facade. Construction is side-effect free: no provider connection is
 * created until a discovery or execution operation reaches the manager.
 */
export const mcpAdapter = new MastraMcpAdapter()
export const mcpConnectionManager = new McpConnectionManager({ adapter: mcpAdapter })
export const mcpCapabilityBroker = new McpCapabilityBroker({ connectionManager: mcpConnectionManager })
