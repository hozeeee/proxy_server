/**
 * MCP Server 入口 —— Streamable HTTP 传输模式
 *
 * 监听 HTTP 端口，供容器外部 AI 客户端远程调用。
 * 启动方式：
 *   构建后:  node dist/mcp/http.js
 *   开发时:  npx ts-node src/mcp/http.ts
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { mcpHttpPort } from '../config/port_config.json';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';


/**
 * 会话管理：每个 sessionId 对应一组 server + transport。
 * 容器重启后会话丢失，对只读查询服务无影响。
 */
interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}
const sessions = new Map<string, SessionEntry>();


function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}


async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let entry: SessionEntry | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // 复用已有会话
    entry = sessions.get(sessionId);
  } else if (req.method === 'POST') {
    // 创建新会话（initialize 请求时触发）
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    entry = { server, transport };

    await server.connect(transport);

    // sessionId 在首次 handleRequest 后才可用，通过拦截 writeHead 捕获
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function (...args: any[]) {
      if (transport.sessionId && !sessions.has(transport.sessionId)) {
        sessions.set(transport.sessionId, entry!);
      }
      return origWriteHead(...args);
    } as any;

    // 会话清理
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Request', hint: 'POST /mcp with JSON-RPC body to initialize' }));
    return;
  }

  await entry!.transport.handleRequest(req, res);
}


const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/mcp') {
    try {
      await handleMcpRequest(req, res);
    } catch (err: any) {
      console.error('[MCP-HTTP] 请求处理异常:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'proxy-server-mcp' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', hint: 'MCP endpoint: POST /mcp' }));
});


httpServer.listen(mcpHttpPort, '0.0.0.0', () => {
  console.log(`[MCP-HTTP] proxy-server-mcp 已启动，监听端口 ${mcpHttpPort}`);
  console.log(`[MCP-HTTP] MCP 端点: http://0.0.0.0:${mcpHttpPort}/mcp`);
});
