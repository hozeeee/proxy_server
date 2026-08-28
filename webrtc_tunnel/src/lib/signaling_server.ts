import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// @ts-ignore - 虚拟模块，由 Rollup 插件注入
import clientScript from 'virtual:client-script';

import {
  PROTOCOL_VERSION,
  SIGNALING_PING_INTERVAL,
  STAGE_LABELS,
  isHandshakeMessage,
  parseMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type UnpairReason,
} from './protocol';
import { PairRegistry, type PairSession } from './pair_registry';
import { StageLog, formatStageEvent, type StageEvent } from './stage_log';
import { buildStatus, renderStatusPage } from './status_page';

/** 单条 WebSocket 连接的上下文 */
interface ClientConnection {
  ws: WebSocket;
  /** 注册成功后才有值；为 null 时除 `register` 外的消息一律拒绝 */
  id: string | null;
  /**
   * 上一轮 ping 之后是否收到过对端的任何帧（pong / 消息）。
   * 巡检时若仍为 false，即判定该连接已死。
   */
  alive: boolean;
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
 * 连接存活性由 WebSocket 层的 ping / pong 巡检保证：无响应的连接会被强制关闭，
 * 否则半开的死连接会被一直当成在线客户端参与撮合（详见 `_sweepDeadConnections`）。
 * 与之配套，`paired` 的投递结果会被校验，任一方投递失败即回滚本轮配对，
 * 避免出现「一方在阶段二、另一方还在阶段一」的永久错位。
 *
 * HTTP 端点:
 *   GET /          - 浏览器访问返回状态页面，API 访问返回 JSON
 *   GET /health    - 健康检查，始终返回 JSON
 *   GET /stages    - 客户端阶段上报的时间线（JSON），用于排查建连问题
 *   GET /client.js - 下载客户端脚本（构建时嵌入）
 */
export class SignalingServer {
  private _port: number;
  private _host: string;
  private _httpServer: http.Server;
  private _wss: WebSocketServer;

  /** 已注册客户端：id → WebSocket */
  private _clients: Map<string, WebSocket> = new Map();

  /** 所有 WebSocket 连接（含未注册），用于存活巡检 */
  private _connections: Set<ClientConnection> = new Set();

  /** 配对意向与配对轮次的状态机 */
  private _registry = new PairRegistry();

  /** 客户端上报的建连阶段存档 */
  private _stageLog: StageLog;

  /** 存活巡检间隔 (ms)，<=0 表示关闭巡检 */
  private _pingInterval: number;

  private _keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否把客户端阶段上报打印到控制台 */
  private _logStageReports: boolean;

  constructor(
    opts: {
      port?: number;
      host?: string;
      server?: http.Server;
      /** 存活巡检间隔 (ms)，默认 20000；设为 0 可关闭（不建议） */
      pingInterval?: number;
      /** 阶段上报的保留条数，默认 500 */
      stageLogCapacity?: number;
      /** 是否把阶段上报打印到控制台，默认 true */
      logStageReports?: boolean;
    } = {}
  ) {
    this._port = opts.port ?? 9876;
    this._host = opts.host ?? '0.0.0.0';
    this._pingInterval = opts.pingInterval ?? SIGNALING_PING_INTERVAL;
    this._logStageReports = opts.logStageReports ?? true;
    this._stageLog = new StageLog({ capacity: opts.stageLogCapacity });

    this._httpServer =
      opts.server || http.createServer((req, res) => this._handleHttpRequest(req, res));

    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on('connection', (ws) => this._handleConnection(ws));

    this._startKeepalive();
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
      if (this._keepaliveTimer) {
        clearInterval(this._keepaliveTimer);
        this._keepaliveTimer = null;
      }
      this._clients.forEach((ws) => ws.close());
      this._clients.clear();
      this._connections.clear();
      this._registry.clear();
      this._stageLog.clear();
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

  /** 客户端阶段上报的时间线（新 → 旧），供嵌入方自行展示或转存 */
  stageEvents(limit = 50): StageEvent[] {
    return this._stageLog.recent(limit);
  }

  /* ==================== 连接存活巡检 ==================== */

  /**
   * 启动僵尸连接巡检：每轮先判定上一轮是否有回应，再对存活连接发一次 ping。
   *
   * 这是「假死」故障的根治点。配对等待期两端都不发业务消息，静默的 TCP 连接
   * 一旦被 NAT / 防火墙回收就会变成半开死连接，且双方都收不到 close 事件：
   * 服务端会把它当成在线客户端继续撮合，`paired` 与 SDP 全部转发进黑洞，
   * 对端则陷入「配对成功 → 建连超时 → 重试」的死循环，直到操作系统级 TCP
   * 超时（可能十几分钟）才恢复。有了 ping / pong，最多两个巡检周期即可发现。
   */
  private _startKeepalive(): void {
    if (this._pingInterval <= 0 || this._keepaliveTimer) return;
    this._keepaliveTimer = setInterval(() => this._sweepDeadConnections(), this._pingInterval);
    // 巡检不应阻止进程退出：连接本身由 http server 维持
    this._keepaliveTimer.unref();
  }

  private _sweepDeadConnections(): void {
    for (const conn of Array.from(this._connections)) {
      if (!conn.alive) {
        this._log(
          `连接 ${this._describe(conn)} 超过 ${this._pingInterval}ms 无任何响应，判定为僵尸连接并强制关闭`
        );
        this._connections.delete(conn);
        try { conn.ws.terminate(); } catch { /* ignore */ }
        // terminate 后仍会触发 close，_handleDisconnect 幂等；
        // 这里提前清理，避免同一轮巡检结束前又被撮合到这条死连接上
        this._handleDisconnect(conn);
        continue;
      }
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* ignore，下一轮巡检会判死 */ }
    }
  }

  private _describe(conn: ClientConnection): string {
    return conn.id ? `"${conn.id}"` : '(未注册)';
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
      case '/stages':
        this._serveStageLog(res);
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
      clients: Array.from(this._clients.keys()).map((id) => ({
        id,
        latestStage: this._stageLog.latestOf(id),
      })),
      pairs: this._registry.snapshot(),
      stages: this._stageLog.recent(30),
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /** 阶段上报时间线（JSON），排查时可直接 `curl http://<server>/stages` */
  private _serveStageLog(res: http.ServerResponse): void {
    const events = this._stageLog.recent(200).map((event) => ({
      at: new Date(event.at).toISOString(),
      clientId: event.clientId,
      peerId: event.peerId,
      stage: event.stage,
      label: STAGE_LABELS[event.stage] ?? event.stage,
      session: event.session,
      detail: event.detail,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: events.length, events }, null, 2));
  }

  /* ==================== WebSocket 生命周期 ==================== */

  private _handleConnection(ws: WebSocket): void {
    const conn: ClientConnection = { ws, id: null, alive: true };
    this._connections.add(conn);

    ws.on('message', (raw) => {
      conn.alive = true; // 收到任何消息同样证明连接还活着
      const msg = parseMessage<ClientToServerMessage>(raw.toString());
      if (msg) this._routeMessage(conn, msg);
    });
    // pong 是存活判定的主要依据：配对等待期客户端不会发送任何业务消息
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => {
      this._connections.delete(conn);
      this._handleDisconnect(conn);
    });
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
      case 'status':
        this._handleStatusReport(conn, msg);
        break;
      default:
        this._log(`未知消息类型: ${(msg as { type: string }).type}`);
    }
  }

  /**
   * 记录客户端上报的建连阶段。纯观测：不改变任何状态，也不回复。
   *
   * 有了它，服务端一处就能看清双方各自的推进过程 —— 例如一方长期停在
   * `pair_waiting`，另一方却在反复 `paired → handshake_failed`，
   * 就是典型的单边视图错位（对端连接已死但服务端尚未发现）。
   */
  private _handleStatusReport(
    conn: ClientConnection,
    msg: Extract<ClientToServerMessage, { type: 'status' }>
  ): void {
    if (!msg.stage) return;

    const event = this._stageLog.record({
      clientId: conn.id!,
      peerId: msg.peerId ?? null,
      stage: msg.stage,
      session: typeof msg.session === 'number' ? msg.session : null,
      detail: msg.detail ?? null,
    });

    if (this._logStageReports) this._log(`阶段上报: ${formatStageEvent(event)}`);
  }

  /** 客户端下线：作废其所有配对并通知对端，随后从在线表移除 */
  private _handleDisconnect(conn: ClientConnection): void {
    if (!conn.id) return;
    this._cleanupClient(conn.id, conn.ws);
  }

  /**
   * 把某个 id 从在线表摘除并作废其全部配对。
   * 对同一 (id, ws) 重复调用是幂等的 —— 强制 terminate 与随后的 close
   * 事件会先后走到这里。
   */
  private _cleanupClient(clientId: string, ws: WebSocket): void {
    // 该 id 已被新连接顶替时，旧连接的关闭不应清理新连接的状态
    if (this._clients.get(clientId) !== ws) return;

    const { affectedPeers } = this._registry.removeClient(clientId);
    this._clients.delete(clientId);

    for (const peerId of affectedPeers) {
      this._notifyUnpaired(peerId, clientId, 'peer_disconnected');
    }
    this._log(`客户端断开: ${clientId}  (在线: ${this._clients.size})`);
  }

  /**
   * 向某客户端投递失败 → 判定其连接已失效，强制关闭并走正常断开清理。
   *
   * 注意这里只清理连接与配对轮次，**不会**撤销别人对它的配对意向，
   * 因此它重连后仍会被自动重新撮合。
   */
  private _reapUnreachable(clientId: string): void {
    const ws = this._clients.get(clientId);
    if (!ws) return;
    this._log(`向 "${clientId}" 投递失败，判定其连接已失效`);
    this._cleanupClient(clientId, ws);
    try { ws.terminate(); } catch { /* ignore */ }
  }

  /* ==================== 阶段一：注册与配对 ==================== */

  /**
   * 处理注册。
   *
   * 同 id 重复注册时采取「新连接顶替旧连接」的策略：客户端网络闪断后服务端
   * 可能尚未感知旧连接已死（TCP 半开），此时若把注册驳回，客户端会陷入
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

      // 顶替前必须先作废旧连接的全部配对轮次并通知对端。
      //
      // 新连接的 PeerConnection 是全新的，上一轮的 session 对它毫无意义；若留着，
      // 紧接着的 pair 会命中 _handlePair 的幂等分支，把上一轮的 session 号
      // 重新下发给新连接，而对端根本没收到新的 paired，也就不会重建
      // PeerConnection：新连接发出的 offer 会被对端的轮次 / 阶段校验丢弃，
      // 白白卡死一个 connectTimeout。
      const { affectedPeers } = this._registry.removeClient(id);

      // 先登记新连接，使旧连接的 close 处理器识别出自己已被顶替而跳过清理
      this._clients.set(id, conn.ws);
      try { previous.close(); } catch { /* ignore */ }

      // peer_repairing：告知对端本轮作废但意向仍在，让它退回阶段一重新配对
      for (const affectedId of affectedPeers) {
        this._notifyUnpaired(affectedId, id, 'peer_repairing');
      }
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

    // 撮合成功 → 分配角色与轮次，双方同时进入阶段二。
    // paired 必须两边都送达才算配对成立，否则回滚（见 _rollbackSession）
    const session = this._registry.openSession(selfId, peerId);
    const initiatorGotIt = this._sendPaired(session.initiatorId, session);
    const answererGotIt = this._sendPaired(session.answererId, session);

    if (!initiatorGotIt || !answererGotIt) {
      this._rollbackSession(session, initiatorGotIt ? session.answererId : session.initiatorId);
      return;
    }

    this._log(
      `配对成功: ${session.initiatorId} (initiator) ⇄ ${session.answererId} (answerer)  轮次 #${session.session}`
    );
  }

  /**
   * `paired` 未能送达某一方时回滚本轮配对。
   *
   * 不回滚就会出现「单边 paired」：一方进入阶段二开始发 offer，另一方还停在阶段一，
   * 服务端却认为配对已成立 —— 双方状态机永久错位，只能靠重启客户端恢复。
   * 回滚后存活的一方会收到 `pair_waiting`，退回阶段一继续等待，
   * 而不是对着一条死连接白等一整个 connectTimeout。
   */
  private _rollbackSession(session: PairSession, unreachableId: string): void {
    this._registry.closeSession(session.initiatorId, session.answererId);
    this._log(
      `配对回滚: 轮次 #${session.session} 的 paired 未能送达 "${unreachableId}"，本轮作废`
    );

    // 投递失败即判定该连接已失效；其配对意向仍保留，重连后会被自动重新撮合
    this._reapUnreachable(unreachableId);

    const aliveId =
      unreachableId === session.initiatorId ? session.answererId : session.initiatorId;
    const aliveWs = this._clients.get(aliveId);
    if (aliveWs) {
      this._send(aliveWs, { type: 'pair_waiting', peerId: unreachableId, reason: 'peer_offline' });
    }
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

    // 原样转发，仅把 peerId 改写为发送方，让接收方知道来源
    if (peerWs && this._send(peerWs, { ...msg, peerId: selfId } as ServerToClientMessage)) return;

    // 转发失败说明对端连接已死：立刻清理并让发送方退回阶段一。
    // 若放任不管，发送方会把整轮 SDP / ICE 都灌进黑洞，直到 connectTimeout 才发现。
    this._log(`转发 ${msg.type} 给 "${msg.peerId}" 失败（轮次 #${session.session}）`);
    if (peerWs) this._reapUnreachable(msg.peerId);
    else this._notifyUnpaired(selfId, msg.peerId, 'peer_disconnected');
  }

  /* ==================== 发送辅助 ==================== */

  /**
   * 向 recipientId 下发 paired，其中的 role / peerId 都是相对接收方的视角。
   * 返回是否成功投递 —— 调用方必须据此决定是否回滚本轮配对。
   */
  private _sendPaired(recipientId: string, session: PairSession): boolean {
    const ws = this._clients.get(recipientId);
    if (!ws) return false;
    const isInitiator = recipientId === session.initiatorId;
    return this._send(ws, {
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

  /** 发送消息，返回是否真的写出去了（连接不处于 OPEN 即视为投递失败） */
  private _send(ws: WebSocket, msg: ServerToClientMessage): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private _log(message: string): void {
    console.log(`[SignalingServer] ${message}`);
  }
}
