import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// @ts-ignore - 虚拟模块，由 Rollup 插件注入
import clientScript from 'virtual:client-script';

import {
  PROTOCOL_VERSION,
  isHandshakeMessage,
  parseMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type UnpairReason,
} from './protocol';
import { PairRegistry, type PairSession } from './pair_registry';
import { buildStatus, renderStatusPage } from './status_page';

/** 单条 WebSocket 连接的上下文 */
interface ClientConnection {
  ws: WebSocket;
  /** 注册成功后才有值；为 null 时除 `register` 外的消息一律拒绝 */
  id: string | null;
}

/**
 * WebRTC 信令服务器
 *
 * 职责边界：只做客户端注册、配对撮合与信令转发（SDP / ICE），
 * 不参与任何数据传输 —— 数据流量完全走客户端之间的 P2P 直连。
 *
 * 服务端是连接流程的唯一推进者，负责强制两个阶段的先后顺序
 * （协议细节见 protocol.ts 顶部注释）：
 *
 *   阶段一 · 注册与配对：register → pair → (pair_invite / pair_waiting) → paired
 *   阶段二 · 建连：      offer → answer → candidate
 *
 * 未注册的连接、以及未完成配对的 SDP / ICE 消息都会被拒绝，
 * 因此「配对成功前不会交换任何 WebRTC 信息」由服务端保证，而非依赖客户端自觉。
 *
 * HTTP 端点:
 *   GET /          - 浏览器访问返回状态页面，API 访问返回 JSON
 *   GET /health    - 健康检查，始终返回 JSON
 *   GET /client.js - 下载客户端脚本（构建时嵌入）
 */
export class SignalingServer {
  private _port: number;
  private _host: string;
  private _httpServer: http.Server;
  private _wss: WebSocketServer;

  /** 已注册客户端：id → WebSocket */
  private _clients: Map<string, WebSocket> = new Map();

  /** 配对意向与配对轮次的状态机 */
  private _registry = new PairRegistry();

  constructor(opts: { port?: number; host?: string; server?: http.Server } = {}) {
    this._port = opts.port ?? 9876;
    this._host = opts.host ?? '0.0.0.0';

    this._httpServer =
      opts.server || http.createServer((req, res) => this._handleHttpRequest(req, res));

    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on('connection', (ws) => this._handleConnection(ws));
  }

  /* ==================== 公开 API ==================== */

  start(): Promise<void> {
    return new Promise((resolve) => {
      this._httpServer.listen(this._port, this._host, () => {
        this._log(`信令服务器已启动 http://${this._host}:${this._port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this._clients.forEach((ws) => ws.close());
      this._clients.clear();
      this._registry.clear();
      this._wss.close();
      this._httpServer.close(() => resolve());
    });
  }

  /** 当前在线客户端数量 */
  get clientCount(): number {
    return this._clients.size;
  }

  /** 当前已配对（处于建连阶段或已建连）的数量 */
  get pairCount(): number {
    return this._registry.sessionCount;
  }

  /* ==================== HTTP ==================== */

  private _handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    switch (req.url) {
      case '/client.js':
        this._serveClientScript(res);
        return;
      case '/':
      case '/health':
        this._serveStatus(req, res);
        return;
      default:
        res.writeHead(404);
        res.end('Not Found');
    }
  }

  /** 提供客户端脚本下载（内容由 Rollup 在构建 server 时注入） */
  private _serveClientScript(res: http.ServerResponse): void {
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
  }

  /** `/health` 始终返回 JSON；`/` 按 Accept 头决定返回 JSON 还是 HTML 状态页 */
  private _serveStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
    const status = buildStatus(this._clients.size, this._registry.sessionCount);
    const wantsJson =
      req.url === '/health' || (req.headers.accept || '').includes('application/json');

    if (wantsJson) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    const html = renderStatusPage({
      status,
      wsEndpoint: `ws://${req.headers.host}`,
      clientIds: Array.from(this._clients.keys()),
      pairs: this._registry.snapshot(),
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /* ==================== WebSocket 生命周期 ==================== */

  private _handleConnection(ws: WebSocket): void {
    const conn: ClientConnection = { ws, id: null };

    ws.on('message', (raw) => {
      const msg = parseMessage<ClientToServerMessage>(raw.toString());
      if (msg) this._routeMessage(conn, msg);
    });
    ws.on('close', () => this._handleDisconnect(conn));
    ws.on('error', (err) => this._log(`WebSocket 错误 (${conn.id ?? '未注册'}): ${err.message}`));
  }

  /**
   * 消息路由。
   * 这里集中执行两条前置校验，各 handler 内部因此可以假定前置条件已满足：
   *   1. 除 `register` 外的所有消息都要求连接已完成注册；
   *   2. 阶段二消息（offer / answer / candidate）统一走 `_relayHandshake` 做配对校验。
   */
  private _routeMessage(conn: ClientConnection, msg: ClientToServerMessage): void {
    if (msg.type === 'register') {
      this._handleRegister(conn, msg);
      return;
    }

    // 阶段一未完成：拒绝一切后续消息，避免出现顺序错乱的状态
    if (!conn.id) {
      this._send(conn.ws, { type: 'error', reason: '尚未注册，请先发送 register' });
      return;
    }

    if (isHandshakeMessage(msg.type)) {
      this._relayHandshake(conn, msg as Extract<ClientToServerMessage, { session: number }>);
      return;
    }

    switch (msg.type) {
      case 'pair':
        this._handlePair(conn, msg.peerId);
        break;
      case 'unpair':
        this._handleUnpair(conn, msg.peerId, msg.retain === true);
        break;
      default:
        this._log(`未知消息类型: ${(msg as { type: string }).type}`);
    }
  }

  /** 客户端下线：作废其所有配对并通知对端，随后从在线表移除 */
  private _handleDisconnect(conn: ClientConnection): void {
    const clientId = conn.id;
    if (!clientId) return;

    // 该 id 已被新连接顶替时，旧连接的关闭不应清理新连接的状态
    if (this._clients.get(clientId) !== conn.ws) return;

    const { affectedPeers } = this._registry.removeClient(clientId);
    this._clients.delete(clientId);

    for (const peerId of affectedPeers) {
      this._notifyUnpaired(peerId, clientId, 'peer_disconnected');
    }
    this._log(`客户端断开: ${clientId}  (在线: ${this._clients.size})`);
  }

  /* ==================== 阶段一：注册与配对 ==================== */

  /**
   * 处理注册。
   *
   * 同 id 重复注册时采取「新连接顶替旧连接」而非拒绝：客户端网络闪断后
   * 服务端可能尚未感知旧连接已死（TCP 半开），此时拒绝注册会让客户端陷入
   * 「重连 → 被拒 → 重连」的死循环。
   */
  private _handleRegister(
    conn: ClientConnection,
    msg: Extract<ClientToServerMessage, { type: 'register' }>
  ): void {
    const { id, protocol, peerId } = msg;

    if (!id) {
      this._send(conn.ws, { type: 'register_failed', reason: '缺少 id 字段' });
      conn.ws.close();
      return;
    }
    if (protocol !== undefined && protocol !== PROTOCOL_VERSION) {
      this._send(conn.ws, {
        type: 'register_failed',
        reason: `协议版本不匹配：服务端 v${PROTOCOL_VERSION}，客户端 v${protocol}，请更新客户端`,
      });
      conn.ws.close();
      return;
    }

    const previous = this._clients.get(id);
    if (previous && previous !== conn.ws) {
      this._log(`客户端 ${id} 重复注册，新连接顶替旧连接`);
      // 先登记新连接，使旧连接的 close 处理器识别出自己已被顶替而跳过清理
      this._clients.set(id, conn.ws);
      try { previous.close(); } catch { /* ignore */ }
    } else {
      this._clients.set(id, conn.ws);
    }

    conn.id = id;
    this._send(conn.ws, { type: 'registered', id, protocol: PROTOCOL_VERSION });
    this._log(`客户端注册: ${id}  (在线: ${this._clients.size})`);

    // 注册时可顺带声明配对意向，等价于紧跟一条 pair
    if (peerId) this._handlePair(conn, peerId);

    // 补发邀请：此前声明过「想连接该 id」的客户端，现在对方上线了
    this._inviteWaitingSuitors(conn, id);
  }

  /**
   * 通知刚上线的客户端：有哪些对端正在等待与它配对。
   * 这是「配对阶段可无限等待对方接入」的落地方式 —— 意向由服务端长期保留，
   * 对方一上线立刻撮合，双方都无需设置等待超时。
   */
  private _inviteWaitingSuitors(conn: ClientConnection, clientId: string): void {
    for (const suitorId of this._registry.suitorsOf(clientId)) {
      if (!this._clients.has(suitorId)) continue;
      // 已经配对成功的无需再邀请
      if (this._registry.getSession(clientId, suitorId)) continue;
      this._send(conn.ws, { type: 'pair_invite', peerId: suitorId });
    }
  }

  /**
   * 处理配对意向。只有「双方都在线 且 互相声明了意向」才算配对成功，
   * 此时才下发 `paired` 让双方进入建连阶段。
   *
   * 对已配对的 peer 重复调用是幂等的：仅向请求方重发当前 `paired`，
   * 不推进轮次。若需要重新配对（如隧道掉线），客户端应先发 `unpair`。
   */
  private _handlePair(conn: ClientConnection, peerId: string): void {
    const selfId = conn.id!;

    if (!peerId) {
      this._send(conn.ws, { type: 'error', reason: '缺少 peerId 字段' });
      return;
    }
    if (peerId === selfId) {
      this._send(conn.ws, { type: 'error', reason: '不能与自己配对' });
      return;
    }

    this._registry.declareIntent(selfId, peerId);

    const existing = this._registry.getSession(selfId, peerId);
    if (existing) {
      this._sendPaired(selfId, existing);
      return;
    }

    const peerWs = this._clients.get(peerId);
    if (!peerWs) {
      // 对端未上线：意向已记录，其上线时会自动撮合
      this._send(conn.ws, { type: 'pair_waiting', peerId, reason: 'peer_offline' });
      return;
    }

    if (!this._registry.isMutual(selfId, peerId)) {
      // 对端在线但还没确认：向其发出邀请，等它回一条 pair 即可完成撮合
      this._send(conn.ws, { type: 'pair_waiting', peerId, reason: 'awaiting_peer' });
      this._send(peerWs, { type: 'pair_invite', peerId: selfId });
      return;
    }

    // 撮合成功 → 分配角色与轮次，双方同时进入阶段二
    const session = this._registry.openSession(selfId, peerId);
    this._sendPaired(session.initiatorId, session);
    this._sendPaired(session.answererId, session);
    this._log(
      `配对成功: ${session.initiatorId} (initiator) ⇄ ${session.answererId} (answerer)  轮次 #${session.session}`
    );
  }

  /**
   * 作废当前配对轮次。
   * `retain=true` 表示对端稍后还要重新配对（隧道掉线重连），保留意向；
   * `retain=false` 表示不再想连接对端，同时撤销意向。
   */
  private _handleUnpair(conn: ClientConnection, peerId: string, retain: boolean): void {
    const selfId = conn.id!;
    if (!peerId) return;

    const closed = this._registry.closeSession(selfId, peerId);
    if (!retain) this._registry.revokeIntent(selfId, peerId);

    if (closed) {
      const reason: UnpairReason = retain ? 'peer_repairing' : 'peer_unpaired';
      this._notifyUnpaired(peerId, selfId, reason);
      this._log(`配对解除: ${selfId} ⇄ ${peerId}  轮次 #${closed.session} (${reason})`);
    }
  }

  /* ==================== 阶段二：转发 SDP / ICE ==================== */

  /**
   * 转发建连阶段的信令。服务器不解析 SDP / candidate 内容，仅做三重校验：
   *   1. 双方必须已配对（否则拒绝，保证配对前不交换 WebRTC 信息）；
   *   2. 轮次编号必须匹配当前轮次（丢弃重连前遗留的迟到消息）；
   *   3. offer 只能由 initiator 发出，answer 只能由 answerer 发出。
   */
  private _relayHandshake(
    conn: ClientConnection,
    msg: Extract<ClientToServerMessage, { session: number }>
  ): void {
    const selfId = conn.id!;
    const session = this._registry.getSession(selfId, msg.peerId);

    if (!session) {
      this._send(conn.ws, {
        type: 'error',
        reason: `与 "${msg.peerId}" 尚未完成配对，禁止交换 WebRTC 信令`,
      });
      return;
    }
    // 上一轮的迟到信令：静默丢弃，避免污染新一轮的 PeerConnection
    if (session.session !== msg.session) return;

    if (msg.type === 'offer' && selfId !== session.initiatorId) {
      this._send(conn.ws, { type: 'error', reason: '本方角色为 answerer，不应发送 offer' });
      return;
    }
    if (msg.type === 'answer' && selfId !== session.answererId) {
      this._send(conn.ws, { type: 'error', reason: '本方角色为 initiator，不应发送 answer' });
      return;
    }

    const peerWs = this._clients.get(msg.peerId);
    if (!peerWs) return;

    // 原样转发，仅把 peerId 改写为发送方，让接收方知道来源
    this._send(peerWs, { ...msg, peerId: selfId } as ServerToClientMessage);
  }

  /* ==================== 发送辅助 ==================== */

  /** 向 recipientId 下发 paired，其中的 role / peerId 都是相对接收方的视角 */
  private _sendPaired(recipientId: string, session: PairSession): void {
    const ws = this._clients.get(recipientId);
    if (!ws) return;
    const isInitiator = recipientId === session.initiatorId;
    this._send(ws, {
      type: 'paired',
      peerId: isInitiator ? session.answererId : session.initiatorId,
      role: isInitiator ? 'initiator' : 'answerer',
      session: session.session,
    });
  }

  /** 通知 recipientId：它与 peerId 的配对已解除 */
  private _notifyUnpaired(recipientId: string, peerId: string, reason: UnpairReason): void {
    const ws = this._clients.get(recipientId);
    if (ws) this._send(ws, { type: 'unpaired', peerId, reason });
  }

  private _send(ws: WebSocket, msg: ServerToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private _log(message: string): void {
    console.log(`[SignalingServer] ${message}`);
  }
}
