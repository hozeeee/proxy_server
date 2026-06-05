/**
 * MCP Server 工厂模块
 *
 * 创建并注册所有 tools，供 stdio / HTTP 两种传输模式共用。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDeviceTools } from './tools/device';
import { registerClashTools } from './tools/clash';
import { registerSystemTools } from './tools/system';
import { registerConfigTools } from './tools/config';


export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'proxy-server-mcp',
    version: '1.0.0',
  });

  registerDeviceTools(server);
  registerClashTools(server);
  registerSystemTools(server);
  registerConfigTools(server);

  return server;
}
