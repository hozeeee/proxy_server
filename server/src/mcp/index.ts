/**
 * MCP Server 入口 —— stdio 传输模式
 *
 * 以 stdio 传输协议运行，供本地 AI 客户端（Claude Desktop / Cursor 等）调用。
 * 启动方式：
 *   构建后:  node dist/mcp/index.js
 *   开发时:  npx ts-node src/mcp/index.ts
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';


async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 输出到 stderr 以免干扰 stdio 协议
  console.error('[MCP] proxy-server-mcp 已启动 (stdio)');
}


main().catch((err) => {
  console.error('[MCP] 启动失败:', err);
  process.exit(1);
});
