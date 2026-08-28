import { EventEmitter } from 'events';
import WebSocket from 'ws';
import nodeDataChannel, { type DataChannel, type PeerConnection } from 'node-datachannel';

import {
  PROTOCOL_VERSION,
  SIGNALING_IDLE_TIMEOUT,
  SIGNALING_PING_INTERVAL,
  parseMessage,
  type ClientStage,
  type ClientToServerMessage,
  type PairWaitingReason,
  type PeerRole,
  type ServerToClientMessage,
  type UnpairReason,
} from './protocol';
import { Tunnel } from './tunnel';

/**
 * DescriptionType 枚举兼容处理。
 * node-datachannel 部分版本并不导出该枚举，退化为其底层使用的字符串字面量。
 */
const DescriptionType: { Offer: string; Answer: string } =
  (nodeDataChannel as any).DescriptionType || { Offer: 'offer', Answer: 'answer' };

/** DataChannel 标签，双方需一致 */
const DATA_CHANNEL_LABEL = 'tunnel';

/**
 * 单个对端的会话阶段，与 protocol.ts 中定义的协议阶段一一对应。
 *
 *   pairing    → 阶段一：已声明配对意向，正在等待对端接入并确认（无限等待，不设超时）
 *   connecting → 阶段二：配对成功，正在交换 SDP / ICE（受 connectTimeout 保护）
 *   connected  → 隧道已建立，信令通道不再参与
 */
type SessionPhase = 'pairing' | 'connecting' | 'connected';

/** 远端 SDP 就绪前暂存的 ICE candidate */
interface PendingCandidate {
  candidate: string;
  mid: string;
}

/** connect() 的等待者 */
interface Waiter {
  resolve: (tunnel: Tunnel) => void;
  reject: (err: Error) => void;
}

/**
 * 每个对端唯一的会话记录，聚合了该对端相关的全部状态。
 * 把状态集中在一个对象里（而非散落在多个 Map 中）可以保证阶段切换时不会漏清理。
 */
interface PeerSession {
  readonly peerId: string;
  phase: SessionPhase;
  /** true = 本方被动接受对端邀请；false = 本方主动 connect() */
  passive: boolean;
  /** 服务端分配的角色，仅在阶段二及之后有值 */
  role: PeerRole | null;
  /** 服务端分配的配对轮次编号，0 表示尚未配对；用于丢弃上一轮的迟到信令 */
  session: number;
  /** 隧道断开后是否自动重新配对 */
  autoReconnect: boolean;
  pc: PeerConnection | null;
  tunnel: Tunnel | null;
  /** 阶段二的超时保护定时器（阶段一无限等待，不设超时） */
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  /** 重新配对的延迟定时器 */
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempts: number;
  pendingCandidates: PendingCandidate[];
  /** 本轮已发出的本地候选数，仅用于阶段上报 */
  localCandidates: number;
  /** 本轮已收到的远端候选数，仅用于阶段上报 */
  remoteCandidates: number;
  waiters: Waiter[];
}

/** 自动重连配置 */
export interface ReconnectOptions {
  /** 是否启用信令服务器自动重连 */
  signalingReconnect?: boolean;
  /** 信令重连间隔 (ms) */
  signalingReconnectInterval?: number;
  /** 是否启用隧道自动重连（掉线后退回配对阶段重新配对） */
  tunnelReconnect?: boolean;
  /** 隧道重连间隔 (ms) */
  tunnelReconnectInterval?: number;
  /** 最大重连次数，0 = 无限 */
  maxReconnectAttempts?: number;
}

export interface WebRTCTunnelClientOptions {
  /** 本客户端唯一标识 */
  id: string;
  /** 信令服务器地址，如 ws://127.0.0.1:9876 */
  signalingUrl: string;
  iceServers?: string[];
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  /** 阶段二（SDP/ICE 交换）超时，不影响阶段一的无限等待 */
  connectTimeout?: number;
  /** 信令通道 ping 间隔 (ms)，0 = 关闭保活（不建议） */
  signalingPingInterval?: number;
  /** 信令通道静默超时 (ms)：超过该时长未收到服务端任何帧即判定连接已死并重连 */
  signalingIdleTimeout?: number;
  /** 是否向服务端上报建连各阶段状态（仅供排查，不影响连接） */
  reportStatus?: boolean;
  reconnect?: ReconnectOptions;
  /** 是否输出阶段流转日志 */
  verbose?: boolean;
  /** 收到配对邀请时的准入判断，返回 false 则拒绝该对端 */
  acceptPeer?: (peerId: string) => boolean;
}

/**
 * WebRTC NAT 穿透客户端
 *
 * 连接过程严格分为两个阶段（协议细节见 protocol.ts）：
 *
 *   阶段一 · 注册与配对：连接信令服务器并注册 → 声明配对意向 → 等待对端接入并确认
 *                        → 收到服务端下发的 `paired`（含角色与轮次）才算配对成功。
 *                        对端未上线时无限等待，不设超时。
 *   阶段二 · 建连：      按服务端分配的角色交换 SDP / ICE，DataChannel 打开后隧道建立。
 *
 * 角色（initiator / answerer）完全由服务端指派，客户端不做任何仲裁，
 * 因此双方同时 connect() 也不会产生 offer 冲突。
 *
 * 信令通道自带 ping / 静默超时检测（见 `_startSignalingKeepalive`）：配对等待期
 * 这条连接完全静默，若不主动探测，NAT 回收映射造成的半开死连接将无法被察觉，
 * 表现为「本端永久停在等待、对端反复建连超时」的假死。
 *
 * 各阶段状态会通过 `status` 消息上报到服务端（可用 `reportStatus: false` 关闭），
 * 便于在服务端一处对齐双方时间线来排查问题。
 *
 * 事件:
 *   'registered'    ()                      - 在信令服务器注册成功
 *   'pair-invite'   (peerId)                - 收到对端的配对邀请
 *   'pair-waiting'  (peerId, reason)        - 配对未完成，正在等待对端
 *   'paired'        (peerId, role)          - 配对成功，进入建连阶段
 *   'unpaired'      (peerId, reason)        - 配对被解除
 *   'tunnel'        (Tunnel, peerId, info)  - 隧道建立（含每一次重连），推荐订阅
 *   'connection'    (Tunnel, peerId)        - 【兼容】被动接受的连接建立成功
 *   'connected'     (Tunnel, peerId)        - 【兼容】主动 connect() 建立成功
 *   'disconnected'  ()                      - 与信令服务器断开
 *   'reconnecting'  (attempt)               - 正在重连信令服务器
 *   'reconnected'   ()                      - 信令服务器重连成功
 *   'tunnel-reconnecting' (peerId, attempt) - 隧道正在重连
 *   'tunnel-reconnected'  (peerId)          - 隧道重连成功
 *   'error'         (Error)                 - 全局错误
 */
export class WebRTCTunnelClient extends EventEmitter {
  readonly id: string;

  private _signalingUrl: string;
  private _iceServers: string[];
  private _heartbeatInterval: number;
  private _heartbeatTimeout: number;
  private _connectTimeout: number;
  private _signalingPingInterval: number;
  private _signalingIdleTimeout: number;
  private _reportStatus: boolean;
  private _verbose: boolean;
  private _acceptPeerHook?: (peerId: string) => boolean;
  private _reconnectOpts: Required<ReconnectOptions>;

  private _ws: WebSocket | null = null;
  private _registered = false;
  private _closed = false;

  /** 注册结果回调，用于结算 connectSignaling() 的 promise */
  private _registrationSettle: ((err?: Error) => void) | null = null;

  private _signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _signalingReconnectAttempts = 0;

  /** 信令通道保活定时器，仅在连接存续期间有效 */
  private _signalingKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

  /** 最近一次收到服务端任何帧（消息 / ping / pong）的时间，用于静默超时判定 */
  private _lastSignalingActivity = 0;

  /** 每个对端唯一的会话记录：peerId → PeerSession */
  private _peers: Map<string, PeerSession> = new Map();

  constructor(opts: WebRTCTunnelClientOptions) {
    super();
    if (!opts.id) throw new Error('缺少 opts.id');
    if (!opts.signalingUrl) throw new Error('缺少 opts.signalingUrl');

    this.id = opts.id;
    this._signalingUrl = opts.signalingUrl;
    this._iceServers = opts.iceServers ?? ['stun:stun.l.google.com:19302'];
    this._heartbeatInterval = opts.heartbeatInterval ?? 5000;
    this._heartbeatTimeout = opts.heartbeatTimeout ?? 15000;
    this._connectTimeout = opts.connectTimeout ?? 30000;
    this._signalingPingInterval = opts.signalingPingInterval ?? SIGNALING_PING_INTERVAL;
    this._signalingIdleTimeout = opts.signalingIdleTimeout ?? SIGNALING_IDLE_TIMEOUT;
    this._reportStatus = opts.reportStatus ?? true;
    this._verbose = opts.verbose ?? false;
    this._acceptPeerHook = opts.acceptPeer;

    this._reconnectOpts = {
      signalingReconnect: true,
      signalingReconnectInterval: 3000,
      tunnelReconnect: true,
      tunnelReconnectInterval: 5000,
      maxReconnectAttempts: 0, // 0 = 无限
      ...opts.reconnect,
    };
  }

  /* ==================== 公开 API ==================== */

  /** 是否已在信令服务器注册 */
  get isRegistered(): boolean {
    return this._registered;
  }

  /** 所有已建立的活跃隧道 */
  get tunnels(): Map<string, Tunnel> {
    const result = new Map<string, Tunnel>();
    for (const session of this._peers.values()) {
      if (session.tunnel && !session.tunnel.isClosed()) result.set(session.peerId, session.tunnel);
    }
    return result;
  }

  /** 【阶段一】连接信令服务器并完成注册 */
  async connectSignaling(): Promise<void> {
    this._closed = false;
    await this._openSignalingSocket();
  }

  /**
   * 【阶段一 → 阶段二】声明与指定对端配对，并等待 P2P 隧道建立。
   *
   * 配对阶段不设超时：对端未上线时服务端会保留意向，直到其接入后自动撮合。
   * 只有在配对成功（收到 `paired`）之后，才会开始交换 WebRTC 信令，
   * 且此时才启用 `connectTimeout` 超时保护。
   *
   * 双方同时调用本方法是安全的 —— 角色由服务端指派，不会产生 offer 冲突。
   */
  connect(peerId: string): Promise<Tunnel> {
    return new Promise((resolve, reject) => {
      if (!peerId) return reject(new Error('缺少 peerId'));
      if (peerId === this.id) return reject(new Error('不能连接自己'));

      const session = this._getOrCreateSession(peerId);

      // 隧道已就绪：直接复用
      if (session.tunnel && !session.tunnel.isClosed()) return resolve(session.tunnel);

      session.passive = false;
      session.waiters.push({ resolve, reject });

      // 仅在阶段一时发起配对请求。若已在阶段二（握手中），等待其自然完成即可；
      // 服务端对已配对 peer 的 pair 请求是幂等的，不会打断进行中的握手。
      if (session.phase === 'pairing' && !session.retryTimer) this._requestPair(peerId);
    });
  }

  /** 主动断开与指定对端的隧道，并撤销配对意向（不再自动重连） */
  disconnectPeer(peerId: string): void {
    const session = this._peers.get(peerId);
    if (!session) return;

    session.autoReconnect = false;
    this._send({ type: 'unpair', peerId, retain: false });
    this._destroySession(session, new Error(`已主动断开与 "${peerId}" 的连接`));
  }

  /** 设置指定对端在隧道掉线后是否自动重新配对 */
  setAutoReconnect(peerId: string, enable: boolean): void {
    const session = this._getOrCreateSession(peerId);
    session.autoReconnect = enable;
    if (!enable) this._cancelPairRetry(session);
  }

  /** 获取指定对端的隧道 */
  getTunnel(peerId: string): Tunnel | null {
    const tunnel = this._peers.get(peerId)?.tunnel;
    return tunnel && !tunnel.isClosed() ? tunnel : null;
  }

  /** 断开所有隧道并关闭信令连接 */
  close(): void {
    this._closed = true;

    this._stopSignalingKeepalive();

    if (this._signalingReconnectTimer) {
      clearTimeout(this._signalingReconnectTimer);
      this._signalingReconnectTimer = null;
    }

    for (const session of Array.from(this._peers.values())) {
      this._destroySession(session, new Error('客户端已关闭'));
    }
    this._peers.clear();

    if (this._ws) {
      try { this._ws.close(); } catch { /* ignore */ }
      this._ws = null;
    }
  }

  /* ==================== 阶段一：信令连接与注册 ==================== */

  /**
   * 建立信令 WebSocket 并注册。
   * 返回的 promise 在收到 `registered` 时 resolve，在注册失败或连接中断时 reject。
   */
  private _openSignalingSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._signalingUrl);
      this._ws = ws;

      // settle 只对本次连接有效；被后续连接覆盖后自动失效
      const settle = (err?: Error) => {
        if (this._registrationSettle !== settle) return;
        this._registrationSettle = null;
        if (err) reject(err);
        else resolve();
      };
      this._registrationSettle = settle;

      ws.on('open', () => {
        this._send({ type: 'register', id: this.id, protocol: PROTOCOL_VERSION });
        this._startSignalingKeepalive(ws);
      });

      ws.on('message', (raw) => {
        this._lastSignalingActivity = Date.now();
        const msg = parseMessage<ServerToClientMessage>(raw.toString());
        if (msg) this._handleServerMessage(msg);
      });

      // 服务端的 ping 与本方 ping 的 pong 回应，都算作「连接仍然可用」的证据
      ws.on('ping', () => { this._lastSignalingActivity = Date.now(); });
      ws.on('pong', () => { this._lastSignalingActivity = Date.now(); });

      ws.on('close', () => {
        settle(new Error('信令连接在注册完成前被关闭'));
        this._handleSignalingClose(ws);
      });

      ws.on('error', (err) => {
        settle(err as Error);
        // 注册完成后的错误通过事件抛出；紧随其后的 close 会触发重连
        if (this._registered) this._emitError(err as Error);
      });
    });
  }

  /** 信令连接断开。注意：这不会影响已建立的 P2P 隧道 */
  private _handleSignalingClose(ws: WebSocket): void {
    if (this._ws !== ws) return; // 已被新连接取代，忽略旧连接的关闭
    this._stopSignalingKeepalive();
    this._ws = null;
    this._registered = false;
    this.emit('disconnected');

    // P2P 隧道的健康完全由其自身心跳判定，与信令通道解耦，
    // 因此这里不关闭任何隧道，只重连信令通道。
    if (this._closed || !this._reconnectOpts.signalingReconnect) return;
    this._scheduleSignalingReconnect();
  }

  private _scheduleSignalingReconnect(): void {
    if (this._signalingReconnectTimer || this._closed) return;

    const max = this._reconnectOpts.maxReconnectAttempts;
    if (max > 0 && this._signalingReconnectAttempts >= max) {
      this._emitError(new Error(`信令服务器重连失败，已达最大次数 ${max}`));
      return;
    }

    this._signalingReconnectAttempts++;
    this.emit('reconnecting', this._signalingReconnectAttempts);

    this._signalingReconnectTimer = setTimeout(() => {
      this._signalingReconnectTimer = null;
      if (this._closed) return;
      this._openSignalingSocket()
        .then(() => this.emit('reconnected'))
        // 失败会伴随 ws 的 close 事件，由 _handleSignalingClose 再次排程，此处无需处理
        .catch(() => { /* ignore */ });
    }, this._reconnectOpts.signalingReconnectInterval);
  }

  /**
   * 启动信令通道保活。
   *
   * 配对等待期这条连接完全静默（本端只是等对方上线，不会发任何业务消息），
   * 一旦 NAT / 防火墙回收空闲映射，连接就会变成半开死连接：本端收不到 close，
   * 也就不会触发重连，永久停在「等待配对」。因此这里做两件事：
   *   1. 周期性主动 ping，让链路上的映射保持活跃，同时把死链暴露出来；
   *   2. 超过静默阈值仍未收到服务端任何帧，就 terminate 掉，交给既有重连逻辑。
   *
   * terminate 而非 close：死连接上的关闭握手永远发不出去，只有强制销毁才会立刻
   * 触发 close 事件。
   */
  private _startSignalingKeepalive(ws: WebSocket): void {
    this._stopSignalingKeepalive();
    if (this._signalingPingInterval <= 0) return;

    this._lastSignalingActivity = Date.now();
    this._signalingKeepaliveTimer = setInterval(() => {
      // 已被新连接取代：旧定时器立即退场
      if (this._ws !== ws) {
        this._stopSignalingKeepalive();
        return;
      }

      const idle = Date.now() - this._lastSignalingActivity;
      if (idle >= this._signalingIdleTimeout) {
        this._log(`信令连接已静默 ${idle}ms，判定为失效连接，强制重连`);
        this._stopSignalingKeepalive();
        this._emitError(new Error(`信令连接静默超时 (${this._signalingIdleTimeout}ms)`));
        try { ws.terminate(); } catch { try { ws.close(); } catch { /* ignore */ } }
        return;
      }

      try { ws.ping(); } catch { /* ignore，静默超时最终会兜住 */ }
    }, this._signalingPingInterval);
  }

  private _stopSignalingKeepalive(): void {
    if (this._signalingKeepaliveTimer) {
      clearInterval(this._signalingKeepaliveTimer);
      this._signalingKeepaliveTimer = null;
    }
  }

  private _onRegistered(): void {
    const afterReconnect = this._signalingReconnectAttempts > 0;
    this._registered = true;
    this._signalingReconnectAttempts = 0;
    this._registrationSettle?.();
    this._log('已在信令服务器注册');
    this.emit('registered');
    this._reportStage('registered', {
      detail: afterReconnect ? '信令重连后重新注册' : '首次注册',
    });

    // 重连后服务端已丢失配对状态，为所有未建立隧道的对端重新声明意向
    this._redeclareIntents();
  }

  private _onRegisterFailed(reason: string): void {
    const err = new Error(`注册失败: ${reason}`);
    // 注册失败属于配置性错误（如协议版本不匹配），重试没有意义
    this._reconnectOpts.signalingReconnect = false;
    this._registrationSettle?.(err);
    this._emitError(err);
  }

  /** 补发所有仍处于阶段一的配对意向（首次注册时通常为空） */
  private _redeclareIntents(): void {
    for (const session of this._peers.values()) {
      if (session.phase === 'connected') continue; // 隧道健康，不打断
      if (session.retryTimer) continue; // 已在退避排队中，等定时器到点再发
      this._send({ type: 'pair', peerId: session.peerId });
    }
  }

  /* ==================== 服务端消息分派 ==================== */

  private _handleServerMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      /* --- 阶段一 --- */
      case 'registered':
        this._onRegistered();
        break;
      case 'register_failed':
        this._onRegisterFailed(msg.reason);
        break;
      case 'pair_invite':
        this._onPairInvite(msg.peerId);
        break;
      case 'pair_waiting':
        this._onPairWaiting(msg.peerId, msg.reason);
        break;
      case 'paired':
        this._onPaired(msg.peerId, msg.role, msg.session);
        break;
      case 'unpaired':
        this._onUnpaired(msg.peerId, msg.reason);
        break;

      /* --- 阶段二 --- */
      case 'offer':
        this._onRemoteOffer(msg.peerId, msg.session, msg.sdp);
        break;
      case 'answer':
        this._onRemoteAnswer(msg.peerId, msg.session, msg.sdp);
        break;
      case 'candidate':
        this._onRemoteCandidate(msg.peerId, msg.session, msg.candidate, msg.mid);
        break;

      case 'error':
        this._emitError(new Error(msg.reason));
        break;
    }
  }

  /* ==================== 阶段一：配对 ==================== */

  /** 向服务端声明配对意向 */
  private _requestPair(peerId: string): void {
    if (!this._registered) {
      // 尚未注册：注册成功后 _redeclareIntents 会统一补发
      this._log(`等待注册完成后再向 "${peerId}" 发起配对`);
      return;
    }
    this._log(`向 "${peerId}" 声明配对意向`);
    this._send({ type: 'pair', peerId });
    this._reportStage('pair_declared', { peerId });
  }

  /**
   * 收到对端的配对邀请：确认意向以完成双向撮合。
   * 这是被动方进入流程的入口（例如未指定 --connect 的一端）。
   */
  private _onPairInvite(peerId: string): void {
    const existing = this._peers.get(peerId);

    // 隧道仍然健康：说明这是信令重连后服务端补发的邀请，忽略以免打断正常连接
    if (existing?.tunnel && !existing.tunnel.isClosed()) return;
    // 已在阶段二握手中：无需重复确认
    if (existing && existing.phase === 'connecting') return;

    if (!this._acceptPeer(peerId)) {
      this._log(`已拒绝来自 "${peerId}" 的配对邀请`);
      return;
    }

    const session = this._getOrCreateSession(peerId);
    // 仅当本方从未主动 connect() 过时才标记为被动方，以决定最终派发的事件类型
    if (session.waiters.length === 0 && session.session === 0) session.passive = true;

    this._log(`收到 "${peerId}" 的配对邀请，确认配对`);
    this.emit('pair-invite', peerId);
    this._send({ type: 'pair', peerId });
    this._reportStage('pair_confirmed', { peerId });
  }

  /** 对端尚未就绪。此处刻意不设超时：注册/配对阶段无限等待对方接入 */
  private _onPairWaiting(peerId: string, reason: PairWaitingReason): void {
    const hint = reason === 'peer_offline' ? '对端尚未接入信令服务器' : '等待对端确认配对';
    this._log(`与 "${peerId}" 的配对等待中：${hint}`);
    this.emit('pair-waiting', peerId, reason);
    this._reportStage('pair_waiting', { peerId, detail: `${hint} (${reason})` });
  }

  /**
   * 【配对成功】进入阶段二。
   * 服务端在此下发角色与轮次编号，双方据此开始交换 WebRTC 信令。
   */
  private _onPaired(peerId: string, role: PeerRole, sessionNo: number): void {
    const session = this._getOrCreateSession(peerId);

    // 服务端对重复的 pair 请求会重发 paired，同轮次的重复通知直接忽略
    if (session.phase !== 'pairing' && session.session === sessionNo) return;

    // 新一轮配对：先彻底丢弃上一轮的残留（旧隧道 / 旧 PeerConnection / 旧 candidate）
    this._discardTunnel(session);
    this._teardownHandshake(session);
    this._cancelPairRetry(session);

    session.phase = 'connecting';
    session.role = role;
    session.session = sessionNo;

    this._log(`与 "${peerId}" 配对成功：角色=${role}，轮次 #${sessionNo}`);
    this.emit('paired', peerId, role);
    this._reportStage('paired', { peerId, session: sessionNo, detail: `角色=${role}` });

    this._beginHandshake(session);
  }

  /** 配对被解除：退回阶段一，按需重新配对 */
  private _onUnpaired(peerId: string, reason: UnpairReason): void {
    const session = this._peers.get(peerId);
    if (!session) return;

    this._log(`与 "${peerId}" 的配对已解除 (${reason})`);
    this.emit('unpaired', peerId, reason);
    this._reportStage('unpaired', { peerId, detail: reason });

    // 对端已明确离开或重置，本轮连接不可能恢复
    this._discardTunnel(session);
    this._teardownHandshake(session);

    if (this._closed) return;

    if (reason === 'peer_unpaired') {
      // 对端明确不再需要该连接：停止重连并结算等待者
      session.autoReconnect = false;
      this._destroySession(session, new Error(`对端 "${peerId}" 已断开连接`));
      return;
    }

    // 对端离线或正在重新配对：保留意向，重新进入阶段一等待
    if (session.autoReconnect && this._reconnectOpts.tunnelReconnect) {
      this._schedulePairRetry(session);
    } else {
      this._destroySession(session, new Error(`对端 "${peerId}" 已断开连接`));
    }
  }

  /* ==================== 阶段二：SDP / ICE 交换 ==================== */

  /**
   * 开始建连。此时配对已完成，角色由服务端指定：
   *   initiator → 创建 DataChannel，进而触发本地 offer 生成
   *   answerer  → 注册 onDataChannel，等待对端 offer 到达
   */
  private _beginHandshake(session: PeerSession): void {
    const pc = new nodeDataChannel.PeerConnection(this.id, { iceServers: this._iceServers });
    session.pc = pc;
    // 候选计数按轮次统计：上一轮的数字对排查本轮没有意义
    session.localCandidates = 0;
    session.remoteCandidates = 0;

    // ⚠️ 必须在产生任何 SDP / candidate 之前注册回调，否则会丢事件
    pc.onLocalCandidate((candidate: string, mid: string) => {
      session.localCandidates++;
      this._send({
        type: 'candidate',
        peerId: session.peerId,
        session: session.session,
        candidate,
        mid,
      });
    });
    pc.onLocalDescription((sdp: string, type: string) => {
      this._sendLocalDescription(session, sdp, type);
    });
    this._observePeerConnection(session, pc);

    if (session.role === 'initiator') this._setupInitiator(session, pc);
    else this._setupAnswerer(session, pc);

    // 仅阶段二启用超时保护；阶段一（等待对端接入）是无限等待的
    this._startHandshakeTimer(session);
  }

  /** initiator：主动创建 DataChannel，node-datachannel 随即生成并回调 offer */
  private _setupInitiator(session: PeerSession, pc: PeerConnection): void {
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
    dc.onOpen(() => this._openTunnel(session, pc, dc));
    dc.onError((err: string) => {
      if (session.pc !== pc) return; // 已被新一轮取代的旧 pc，忽略其迟到回调
      this._failHandshake(session, new Error(`DataChannel 错误: ${String(err)}`));
    });
  }

  /** answerer：等待对端的 DataChannel。onDataChannel 必须在 setRemoteDescription 之前注册 */
  private _setupAnswerer(session: PeerSession, pc: PeerConnection): void {
    pc.onDataChannel((dc: DataChannel) => this._openTunnel(session, pc, dc));
  }

  private _sendLocalDescription(session: PeerSession, sdp: string, type: string): void {
    const { peerId, session: round } = session;
    if (type === DescriptionType.Offer) {
      this._send({ type: 'offer', peerId, session: round, sdp });
      this._reportStage('offer_sent', { peerId, session: round });
    } else if (type === DescriptionType.Answer) {
      this._send({ type: 'answer', peerId, session: round, sdp });
      this._reportStage('answer_sent', { peerId, session: round });
    }
  }

  private _onRemoteOffer(peerId: string, sessionNo: number, sdp: string): void {
    const session = this._requireHandshake(peerId, sessionNo, 'answerer');
    if (!session?.pc) return;
    this._reportStage('offer_received', { peerId, session: sessionNo });
    session.pc.setRemoteDescription(sdp, DescriptionType.Offer as any);
    this._flushPendingCandidates(session);
  }

  private _onRemoteAnswer(peerId: string, sessionNo: number, sdp: string): void {
    const session = this._requireHandshake(peerId, sessionNo, 'initiator');
    if (!session?.pc) return;
    this._reportStage('answer_received', { peerId, session: sessionNo });
    session.pc.setRemoteDescription(sdp, DescriptionType.Answer as any);
    this._flushPendingCandidates(session);
  }

  private _onRemoteCandidate(
    peerId: string,
    sessionNo: number,
    candidate: string,
    mid: string
  ): void {
    const session = this._peers.get(peerId);
    // 轮次不匹配说明是上一轮遗留的迟到 candidate，丢弃以免污染新的 PeerConnection
    if (!session || session.session !== sessionNo || !session.pc) return;

    // 候选逐条上报太吵，只累计条数，由 ICE 收集状态变化时一并带出
    session.remoteCandidates++;

    try {
      session.pc.addRemoteCandidate(candidate, mid);
    } catch {
      // 远端 SDP 尚未设置：暂存，待 setRemoteDescription 后统一补齐
      session.pendingCandidates.push({ candidate, mid });
    }
  }

  /**
   * 校验阶段二消息的前置条件：必须已配对、轮次匹配、且角色符合预期。
   * 不满足时返回 null，调用方直接丢弃该消息。
   */
  private _requireHandshake(
    peerId: string,
    sessionNo: number,
    expectedRole: PeerRole
  ): PeerSession | null {
    const session = this._peers.get(peerId);
    if (!session || session.phase !== 'connecting') return null;
    if (session.session !== sessionNo) return null;
    if (session.role !== expectedRole) return null;
    return session;
  }

  private _flushPendingCandidates(session: PeerSession): void {
    if (!session.pc || session.pendingCandidates.length === 0) return;
    for (const { candidate, mid } of session.pendingCandidates) {
      try { session.pc.addRemoteCandidate(candidate, mid); } catch { /* ignore */ }
    }
    session.pendingCandidates.length = 0;
  }

  private _startHandshakeTimer(session: PeerSession): void {
    this._clearHandshakeTimer(session);
    session.handshakeTimer = setTimeout(() => {
      session.handshakeTimer = null;
      this._failHandshake(
        session,
        new Error(`与 "${session.peerId}" 建连超时 (${this._connectTimeout}ms)`)
      );
    }, this._connectTimeout);
  }

  private _clearHandshakeTimer(session: PeerSession): void {
    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
      session.handshakeTimer = null;
    }
  }

  /** 建连失败：作废本轮配对，退回阶段一（按配置决定是否重试） */
  private _failHandshake(session: PeerSession, err: Error): void {
    if (session.phase !== 'connecting') return;
    // 轮次与候选数会被 _teardownHandshake 清零，先取出用于上报
    this._reportStage('handshake_failed', {
      peerId: session.peerId,
      session: session.session,
      detail: `${err.message}（本地候选 ${session.localCandidates} 条，远端候选 ${session.remoteCandidates} 条）`,
    });
    this._teardownHandshake(session);
    this._emitError(err);
    if (this._closed) return;

    const willRetry = session.autoReconnect && this._reconnectOpts.tunnelReconnect;
    this._send({ type: 'unpair', peerId: session.peerId, retain: willRetry });

    if (willRetry) this._schedulePairRetry(session);
    else this._destroySession(session, err);
  }

  /* ==================== 隧道生命周期 ==================== */

  /**
   * DataChannel 打开：封装为 Tunnel，会话进入 connected 阶段。
   *
   * `pc` 参数用于身份校验，不可省略：node-datachannel 的回调经由后台线程投递，
   * 上一轮 pc 关闭前排队的 onOpen / onDataChannel 仍可能在新一轮握手之后才到达。
   * 若不校验就放行，会用一条已废弃的 DataChannel 覆盖当前隧道，并顺手清掉本轮的
   * 超时保护 —— 两端与服务端都显示「隧道已建立」，而数据实际发进了黑洞。
   */
  private _openTunnel(session: PeerSession, pc: PeerConnection, dc: DataChannel): void {
    if (session.pc !== pc) {
      this._log(`忽略已废弃 PeerConnection 迟到的 DataChannel（对端 "${session.peerId}"）`);
      try { dc.close(); } catch { /* ignore */ }
      return;
    }

    this._clearHandshakeTimer(session);

    const tunnel = new Tunnel(dc, {
      // 由 initiator 单方面发送 PING，避免双向心跳互相干扰
      isInitiator: session.role === 'initiator',
      heartbeatInterval: this._heartbeatInterval,
      heartbeatTimeout: this._heartbeatTimeout,
    });

    session.tunnel = tunnel;
    session.phase = 'connected';
    session.pendingCandidates.length = 0;

    const isReconnect = session.retryAttempts > 0;
    session.retryAttempts = 0;

    this._bindTunnelLifecycle(session, tunnel);

    this._log(`与 "${session.peerId}" 的 P2P 隧道已建立 (${session.role})`);
    this._reportStage('tunnel_open', {
      peerId: session.peerId,
      session: session.session,
      detail: `角色=${session.role}，本地候选 ${session.localCandidates} 条，远端候选 ${session.remoteCandidates} 条`,
    });
    this._resolveWaiters(session, tunnel);

    if (isReconnect) this.emit('tunnel-reconnected', session.peerId);

    // 每次隧道建立（含每一次重连）都派发的稳定事件。
    //
    // 调用方必须订阅它，而不是只用 connect() 的返回值或 connected / connection：
    // 重连会换出一个**全新的 Tunnel 对象**，绑在旧对象上的 'data' 监听与发送逻辑
    // 会随之失效，本端既收不到也发不出，但两端与服务端都仍显示「隧道已建立」——
    // 这正是「通道假成功」的成因。connected / connection 按 passive 二选一派发，
    // 而 passive 会随首次 connect() / 配对邀请的到达时序变化，靠它们无法稳定接管重连。
    this.emit('tunnel', tunnel, session.peerId, {
      peerId: session.peerId,
      role: session.role,
      passive: session.passive,
      reconnected: isReconnect,
    });

    // 【兼容旧用法】主动方派发 'connected'，被动方派发 'connection'
    this.emit(session.passive ? 'connection' : 'connected', tunnel, session.peerId);
  }

  private _bindTunnelLifecycle(session: PeerSession, tunnel: Tunnel): void {
    const onDrop = () => {
      // 身份校验：已被新一轮连接取代的旧隧道，其关闭不应触发重连
      if (session.tunnel !== tunnel) return;
      session.tunnel = null;
      this._handleTunnelDrop(session);
    };
    tunnel.on('close', onDrop);
    tunnel.on('error', (err: Error) => {
      this._emitError(err);
      onDrop();
    });
  }

  /**
   * 隧道掉线：退回阶段一重新配对。
   *
   * 双方各自独立执行「作废本轮配对 → 延迟后重新声明意向」，
   * 由服务端负责撮合并同时下发新的 `paired`。
   * 因此客户端无需再用 id 字典序之类的手段自行仲裁谁来发起重连。
   */
  private _handleTunnelDrop(session: PeerSession): void {
    const { peerId } = session;
    this._reportStage('tunnel_closed', { peerId, session: session.session });
    session.phase = 'pairing';
    session.role = null;
    session.session = 0;
    this._teardownHandshake(session);

    if (this._closed) return;
    this._log(`与 "${peerId}" 的隧道已断开`);

    const willRetry = session.autoReconnect && this._reconnectOpts.tunnelReconnect;
    this._send({ type: 'unpair', peerId, retain: willRetry });

    if (willRetry) this._schedulePairRetry(session);
    else this._destroySession(session, new Error(`与 "${peerId}" 的隧道已断开`));
  }

  /** 丢弃隧道且不触发重连逻辑（用于被新一轮连接取代 / 对端明确离开） */
  private _discardTunnel(session: PeerSession): void {
    const tunnel = session.tunnel;
    if (!tunnel) return;
    session.tunnel = null; // 先摘除引用，使 close 事件被身份校验拦下
    tunnel.close();
  }

  /* ==================== 重新配对（隧道重连） ==================== */

  private _schedulePairRetry(session: PeerSession): void {
    if (this._closed || session.retryTimer) return;

    const max = this._reconnectOpts.maxReconnectAttempts;
    const attempt = session.retryAttempts + 1;
    if (max > 0 && attempt > max) {
      session.autoReconnect = false;
      const err = new Error(`隧道 "${session.peerId}" 重连失败，已达最大次数 ${max}`);
      this._emitError(err);
      this._destroySession(session, err);
      return;
    }

    session.retryAttempts = attempt;
    this.emit('tunnel-reconnecting', session.peerId, attempt);
    this._reportStage('repairing', {
      peerId: session.peerId,
      detail: `第 ${attempt} 次重新配对，${this._reconnectOpts.tunnelReconnectInterval}ms 后发起`,
    });

    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      if (this._closed) return;
      this._requestPair(session.peerId);
    }, this._reconnectOpts.tunnelReconnectInterval);
  }

  private _cancelPairRetry(session: PeerSession): void {
    if (session.retryTimer) {
      clearTimeout(session.retryTimer);
      session.retryTimer = null;
    }
  }

  /* ==================== 会话管理 ==================== */

  private _getOrCreateSession(peerId: string): PeerSession {
    let session = this._peers.get(peerId);
    if (!session) {
      session = {
        peerId,
        phase: 'pairing',
        passive: false,
        role: null,
        session: 0,
        autoReconnect: this._reconnectOpts.tunnelReconnect,
        pc: null,
        tunnel: null,
        handshakeTimer: null,
        retryTimer: null,
        retryAttempts: 0,
        pendingCandidates: [],
        localCandidates: 0,
        remoteCandidates: 0,
        waiters: [],
      };
      this._peers.set(peerId, session);
    }
    return session;
  }

  /** 清理阶段二的资源，把会话退回阶段一（保留 passive / autoReconnect 等长期属性） */
  private _teardownHandshake(session: PeerSession): void {
    this._clearHandshakeTimer(session);
    if (session.pc) {
      try { session.pc.close(); } catch { /* ignore */ }
      session.pc = null;
    }
    session.pendingCandidates.length = 0;
    session.role = null;
    session.session = 0;
    if (session.phase === 'connecting') session.phase = 'pairing';
  }

  /** 彻底销毁会话：关闭隧道、清理定时器、结算等待者并从表中移除 */
  private _destroySession(session: PeerSession, err: Error): void {
    this._cancelPairRetry(session);
    this._teardownHandshake(session);
    this._discardTunnel(session);
    session.phase = 'pairing';
    this._rejectWaiters(session, err);
    this._peers.delete(session.peerId);
  }

  private _resolveWaiters(session: PeerSession, tunnel: Tunnel): void {
    const waiters = session.waiters.splice(0);
    for (const { resolve } of waiters) resolve(tunnel);
  }

  private _rejectWaiters(session: PeerSession, err: Error): void {
    const waiters = session.waiters.splice(0);
    for (const { reject } of waiters) reject(err);
  }

  private _acceptPeer(peerId: string): boolean {
    if (!this._acceptPeerHook) return true;
    try {
      return this._acceptPeerHook(peerId) !== false;
    } catch {
      return false;
    }
  }

  /* ==================== 状态上报（旁路观测） ==================== */

  /**
   * 向服务端上报当前所处阶段。
   *
   * 纯旁路：不等待回复、失败也不重试，绝不影响连接流程本身。
   * 价值在于服务端能把双方的时间线对齐到一处 —— 单看某一端的日志时，
   * 「我以为配对成功了」和「对方根本没收到」是无法区分的。
   */
  private _reportStage(
    stage: ClientStage,
    opts: { peerId?: string; session?: number; detail?: string } = {}
  ): void {
    if (!this._reportStatus) return;
    this._send({
      type: 'status',
      stage,
      ...(opts.peerId ? { peerId: opts.peerId } : {}),
      ...(opts.session ? { session: opts.session } : {}),
      ...(opts.detail ? { detail: opts.detail } : {}),
    });
  }

  /**
   * 订阅 PeerConnection 的状态与 ICE 收集进展并上报。
   *
   * 这两个回调是判断「建连超时到底卡在哪」的关键：卡在 ICE 收集说明本端
   * 拿不到候选（STUN 不可达），收集完成但连接始终不 connected 说明候选
   * 交换或打洞失败。部分 node-datachannel 版本没有这些回调，缺失时静默跳过。
   */
  private _observePeerConnection(session: PeerSession, pc: PeerConnection): void {
    const pcAny = pc as any;

    if (typeof pcAny.onStateChange === 'function') {
      pcAny.onStateChange((state: string) => {
        if (session.pc !== pc) return; // 已被新一轮取代的旧 pc，忽略其迟到回调
        this._log(`与 "${session.peerId}" 的连接状态: ${state}`);
        this._reportStage('pc_state', {
          peerId: session.peerId,
          session: session.session,
          detail: state,
        });
      });
    }

    if (typeof pcAny.onGatheringStateChange === 'function') {
      pcAny.onGatheringStateChange((state: string) => {
        if (session.pc !== pc) return;
        this._reportStage('ice_gathering', {
          peerId: session.peerId,
          session: session.session,
          detail: `${state}（本地候选 ${session.localCandidates} 条）`,
        });
      });
    }
  }

  /* ==================== 工具 ==================== */

  private _send(msg: ClientToServerMessage): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  /** EventEmitter 在无 'error' 监听者时会抛出异常，这里做兜底 */
  private _emitError(err: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', err);
    else this._log(`未处理的错误: ${err.message}`);
  }

  private _log(message: string): void {
    if (this._verbose) console.log(`[${this.id}] ${message}`);
  }
}
