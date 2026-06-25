import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// @ts-ignore - 虚拟模块，由 Rollup 插件注入
import clientScript from 'virtual:client-script';

/** 信令消息类型 */
interface SignalingMessage {
  type: string;
  id?: string;
  targetId?: string;
  from?: string;
  sdp?: string;
  candidate?: string;
  mid?: string;
  message?: string;
}

/**
 * WebRTC 信令服务器
 *
 * 职责：仅负责客户端注册 + 信令消息转发（SDP / ICE），不参与任何数据传输。
 * 数据流量完全走客户端之间的 P2P 直连通道。
 *
 * HTTP 端点:
 *   GET /          - 浏览器访问返回状态页面，API 访问返回 JSON
 *   GET /health    - 健康检查，返回 JSON
 *   GET /client.js - 下载客户端脚本
 *
 * 可作为模块引入，也可直接 `node signaling_server.js` 运行。
 */
export class SignalingServer {
  private _port: number;
  private _host: string;
  private _httpServer: http.Server;
  private _wss: WebSocketServer;
  private _clients: Map<string, WebSocket> = new Map();
  /** 配对关系：clientId → 已配对的 peerId 集合 */
  private _pairings: Map<string, Set<string>> = new Map();

  constructor(opts: {
    port?: number;
    host?: string;
    server?: http.Server;
  } = {}) {
    this._port = opts.port ?? 9876;
    this._host = opts.host ?? '0.0.0.0';

    // 创建 HTTP 服务器（健康检查 + 状态页面 + 客户端下载）
    this._httpServer = opts.server || http.createServer((req, res) => {
      // 客户端脚本下载
      if (req.method === 'GET' && req.url === '/client.js') {
        if (!clientScript) {
          res.writeHead(404);
          res.end('客户端脚本未嵌入，请重新构建服务器');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Disposition': 'attachment; filename="client.js"',
          'Content-Length': Buffer.byteLength(clientScript),
        });
        res.end(clientScript);
        return;
      }

      // 仅处理 GET / 和 GET /health
      if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/health')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const data = {
        status: 'ok',
        clients: this._clients.size,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      };

      // /health 始终返回 JSON
      const isHealthEndpoint = req.url === '/health';
      const accept = req.headers.accept || '';
      const wantsJson = isHealthEndpoint || accept.includes('application/json');

      if (wantsJson) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data, null, 2));
        return;
      }

      // 浏览器访问返回 HTML 状态页面
      const clientList = Array.from(this._clients.keys());
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebRTC 信令服务器</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }
    h1 { color: #1a1a1a; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500; }
    .status.ok { background: #d4edda; color: #155724; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    td { padding: 12px 8px; border-bottom: 1px solid #eee; }
    td:first-child { color: #666; width: 140px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .clients { margin-top: 20px; }
    .clients h3 { margin-bottom: 8px; color: #444; }
    .client-list { list-style: none; padding: 0; }
    .client-list li { padding: 8px 12px; background: #f8f9fa; margin-bottom: 4px; border-radius: 4px; font-family: monospace; }
    .empty { color: #999; font-style: italic; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 13px; }
  </style>
</head>
<body>
  <h1>WebRTC 信令服务器</h1>
  <span class="status ok">运行中</span>

  <table>
    <tr><td>在线客户端</td><td><strong>${this._clients.size}</strong></td></tr>
    <tr><td>运行时间</td><td>${data.uptime}s</td></tr>
    <tr><td>WebSocket 端点</td><td><code>ws://${req.headers.host}</code></td></tr>
  </table>

  <div class="clients">
    <h3>已注册客户端</h3>
    ${clientList.length > 0
      ? `<ul class="client-list">${clientList.map(id => `<li>${id}</li>`).join('')}</ul>`
      : '<p class="empty">暂无客户端连接</p>'
    }
  </div>

  <div class="footer">
    <p>API: <code>GET /health</code> 返回 JSON 状态</p>
    <p>下载: <code>GET /client.js</code> 获取客户端脚本</p>
    <p>最后更新: ${data.timestamp}</p>
  </div>

  <script>
    // 每 5 秒自动刷新
    setTimeout(() => location.reload(), 5000);
  </script>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    // WebSocket 信令通道
    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on('connection', (ws) => this._handleConnection(ws));
  }

  /* ========== 公开 API ========== */

  start(): Promise<void> {
    return new Promise((resolve) => {
      this._httpServer.listen(this._port, this._host, () => {
        console.log(`[SignalingServer] 信令服务器已启动 http://${this._host}:${this._port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this._clients.forEach((ws) => ws.close());
      this._clients.clear();
      this._wss.close();
      this._httpServer.close(() => resolve());
    });
  }

  /** 当前在线客户端数量 */
  get clientCount(): number {
    return this._clients.size;
  }

  /* ========== 内部方法 ========== */

  private _handleConnection(ws: WebSocket): void {
    let clientId: string | null = null;

    ws.on('message', (raw) => {
      let msg: SignalingMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        /* ---------- 注册 ---------- */
        case 'register': {
          const { id } = msg;
          if (!id) {
            this._send(ws, { type: 'error', message: '缺少 id 字段' });
            return;
          }
          if (this._clients.has(id)) {
            this._send(ws, { type: 'register_failed', message: `id "${id}" 已被占用` });
            ws.close();
            return;
          }
          clientId = id;
          this._clients.set(id, ws);
          this._send(ws, { type: 'registered', id });
          console.log(`[SignalingServer] 客户端注册: ${id}  (在线: ${this._clients.size})`);
          break;
        }

        /* ---------- 发起连接请求 ---------- */
        case 'offer_request': {
          const { targetId } = msg;
          if (!targetId || !this._clients.has(targetId)) {
            this._send(ws, { type: 'error', message: `目标 "${targetId}" 不在线` });
            return;
          }
          // 记录配对关系
          this._addPairing(clientId!, targetId);
          this._send(this._clients.get(targetId)!, {
            type: 'incoming_connection',
            from: clientId,
          });
          break;
        }

        /* ---------- SDP Offer ---------- */
        case 'offer': {
          const { targetId, sdp } = msg;
          const target = this._clients.get(targetId!);
          if (target) {
            this._addPairing(clientId!, targetId!);
            this._send(target, { type: 'offer', from: clientId, sdp });
          }
          break;
        }

        /* ---------- SDP Answer ---------- */
        case 'answer': {
          const { targetId, sdp } = msg;
          const target = this._clients.get(targetId!);
          if (target) {
            this._addPairing(clientId!, targetId!);
            this._send(target, { type: 'answer', from: clientId, sdp });
          }
          break;
        }

        /* ---------- ICE Candidate (转发 candidate + mid) ---------- */
        case 'candidate': {
          const { targetId, candidate, mid } = msg;
          const target = this._clients.get(targetId!);
          if (target) {
            this._send(target, { type: 'candidate', from: clientId, candidate, mid });
          }
          break;
        }

        default:
          console.warn(`[SignalingServer] 未知消息类型: ${msg.type}`);
      }
    });

    ws.on('close', () => {
      if (clientId) {
        // 清理配对关系并通知对方
        const peers = this._pairings.get(clientId);
        if (peers) {
          for (const peerId of peers) {
            const peerWs = this._clients.get(peerId);
            if (peerWs) {
              this._send(peerWs, {
                type: 'peer_disconnected',
                peerId: clientId,
              });
            }
          }
        }
        this._removePairings(clientId);
        this._clients.delete(clientId);
        console.log(`[SignalingServer] 客户端断开: ${clientId}  (在线: ${this._clients.size})`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[SignalingServer] WebSocket 错误:`, err.message);
    });
  }

  private _send(ws: WebSocket, obj: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  /* ========== 配对管理 ========== */

  private _addPairing(clientId: string, peerId: string): void {
    if (!this._pairings.has(clientId)) {
      this._pairings.set(clientId, new Set());
    }
    this._pairings.get(clientId)!.add(peerId);

    // 双向记录
    if (!this._pairings.has(peerId)) {
      this._pairings.set(peerId, new Set());
    }
    this._pairings.get(peerId)!.add(clientId);
  }

  private _removePairings(clientId: string): void {
    const peers = this._pairings.get(clientId);
    if (peers) {
      for (const peerId of peers) {
        const peerPeers = this._pairings.get(peerId);
        if (peerPeers) {
          peerPeers.delete(clientId);
          if (peerPeers.size === 0) {
            this._pairings.delete(peerId);
          }
        }
      }
      this._pairings.delete(clientId);
    }
  }
}
