import { EventEmitter } from 'events';
import WebSocket from 'ws';
import nodeDataChannel, { type PeerConnection } from 'node-datachannel';

// DescriptionType 枚举兼容处理（不同版本导出方式不同）
const DescriptionType = (nodeDataChannel as any).DescriptionType || {
  Offer: 'offer',
  Answer: 'answer',
};
import { Tunnel } from './tunnel';

/** 信令消息 */
interface SignalingMessage {
  type: string;
  id?: string;
  from?: string;
  targetId?: string;
  peerId?: string;
  sdp?: string;
  candidate?: string;
  mid?: string;
  message?: string;
}

/** 等待中的连接请求 */
interface PendingConnection {
  resolve: (tunnel: Tunnel) => void;
  reject: (err: Error) => void;
  pc: PeerConnection;
  timer: ReturnType<typeof setTimeout>;
}

/** 暂存的 ICE candidate */
interface PendingCandidate {
  candidate: string;
  mid: string;
}

/** 自动重连配置 */
interface ReconnectOptions {
  /** 是否启用信令服务器自动重连 */
  signalingReconnect?: boolean;
  /** 信令重连间隔 (ms) */
  signalingReconnectInterval?: number;
  /** 是否启用隧道自动重连 */
  tunnelReconnect?: boolean;
  /** 隧道重连间隔 (ms) */
  tunnelReconnectInterval?: number;
  /** 最大重连次数，0 = 无限 */
  maxReconnectAttempts?: number;
}

/**
 * WebRTC NAT 穿透客户端
 *
 * 通过信令服务器完成 SDP/ICE 交换后，客户端之间建立 P2P 直连。
 * 信令服务器仅参与连接建立阶段，之后所有数据走 P2P 通道。
 *
 * 事件:
 *   'connection' (Tunnel, peerId)  - 收到对方发起的连接
 *   'connected'  (Tunnel, peerId)  - connect() 成功
 *   'error'      (Error)           - 全局错误
 *   'registered' ()                - 在信令服务器注册成功
 *   'disconnected' ()              - 与信令服务器断开
 *   'reconnecting' (attempt)       - 正在重连
 *   'reconnected' ()               - 重连成功
 *   'tunnel-reconnecting' (peerId, attempt) - 隧道正在重连
 *   'tunnel-reconnected' (peerId)  - 隧道重连成功
 */
export class WebRTCTunnelClient extends EventEmitter {
  readonly id: string;
  private _signalingUrl: string;
  private _iceServers: string[];
  private _heartbeatInterval: number;
  private _heartbeatTimeout: number;
  private _connectTimeout: number;

  // 自动重连配置
  private _reconnectOpts: Required<ReconnectOptions>;

  private _ws: WebSocket | null = null;
  private _registered = false;
  private _closed = false;

  // 重连状态
  private _signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _signalingReconnectAttempts = 0;
  private _reconnectResolve: (() => void) | null = null;

  /** 活跃隧道表  peerId → Tunnel */
  private _tunnels: Map<string, Tunnel> = new Map();

  /** 需要自动重连的 peer 列表 */
  private _autoReconnectPeers: Set<string> = new Set();

  /** 隧道重连定时器 */
  private _tunnelReconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** 隧道重连次数 */
  private _tunnelReconnectAttempts: Map<string, number> = new Map();

  /** 等待中的连接请求 */
  private _pendingConnections: Map<string, PendingConnection> = new Map();

  /** 暂存的远端 ICE candidate */
  private _pendingCandidates: Map<string, PendingCandidate[]> = new Map();

  constructor(opts: {
    id: string;
    signalingUrl: string;
    iceServers?: string[];
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
    connectTimeout?: number;
    reconnect?: ReconnectOptions;
  }) {
    super();
    if (!opts.id) throw new Error('缺少 opts.id');
    if (!opts.signalingUrl) throw new Error('缺少 opts.signalingUrl');

    this.id = opts.id;
    this._signalingUrl = opts.signalingUrl;
    this._iceServers = opts.iceServers ?? ['stun:stun.l.google.com:19302'];
    this._heartbeatInterval = opts.heartbeatInterval ?? 5000;
    this._heartbeatTimeout = opts.heartbeatTimeout ?? 15000;
    this._connectTimeout = opts.connectTimeout ?? 30000;

    // 默认启用自动重连
    this._reconnectOpts = {
      signalingReconnect: true,
      signalingReconnectInterval: 3000,
      tunnelReconnect: true,
      tunnelReconnectInterval: 5000,
      maxReconnectAttempts: 0, // 0 = 无限
      ...opts.reconnect,
    };
  }

  /* ========== 公开 API ========== */

  /** 连接信令服务器并注册 */
  connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._closed = false;
      this._ws = new WebSocket(this._signalingUrl);

      this._ws.once('open', () => {
        this._send({ type: 'register', id: this.id });
      });

      this._ws.on('message', (raw) => {
        const msg: SignalingMessage = JSON.parse(raw.toString());
        this._handleSignalingMessage(msg);
      });

      this._ws.on('close', () => {
        this._registered = false;
        this.emit('disconnected');

        // 自动重连信令服务器
        if (!this._closed && this._reconnectOpts.signalingReconnect) {
          this._scheduleSignalingReconnect();
        }
      });

      this._ws.on('error', (err) => {
        this.emit('error', err);
        if (!this._registered) reject(err);
      });

      const onRegistered = () => {
        this.removeListener('error', onError);
        // 重置重连计数
        this._signalingReconnectAttempts = 0;
        resolve();
      };
      const onError = (err: Error) => {
        this.removeListener('registered', onRegistered);
        reject(err);
      };
      this.once('registered', onRegistered);
      this.once('error', onError);
    });
  }

  /** 主动连接到指定 peer */
  connect(peerId: string): Promise<Tunnel> {
    return new Promise((resolve, reject) => {
      if (this._tunnels.has(peerId)) {
        return resolve(this._tunnels.get(peerId)!);
      }

      this._send({ type: 'offer_request', targetId: peerId });

      const pc = new nodeDataChannel.PeerConnection(this.id, {
        iceServers: this._iceServers,
      });

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._pendingConnections.delete(peerId);
          try { pc.close(); } catch { /* ignore */ }
          reject(new Error(`连接 ${peerId} 超时 (${this._connectTimeout}ms)`));
        }
      }, this._connectTimeout);

      this._pendingConnections.set(peerId, { resolve, reject, pc, timer });

      // ️ 必须先注册回调，再创建 DataChannel

      pc.onLocalCandidate((candidate: string, mid: string) => {
        this._send({ type: 'candidate', targetId: peerId, candidate, mid });
      });

      pc.onLocalDescription((sdp: string, type: string) => {
        if (type === DescriptionType.Offer) {
          this._send({ type: 'offer', targetId: peerId, sdp });
        }
      });

      const dc = pc.createDataChannel('tunnel');

      dc.onOpen(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._pendingConnections.delete(peerId);

        const tunnel = new Tunnel(dc, {
          isInitiator: true,
          heartbeatInterval: this._heartbeatInterval,
          heartbeatTimeout: this._heartbeatTimeout,
        });
        this._tunnels.set(peerId, tunnel);
        this._bindTunnelLifecycle(tunnel, peerId);
        this.emit('connected', tunnel, peerId);
        resolve(tunnel);
      });

      dc.onError((err: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._pendingConnections.delete(peerId);
        reject(new Error(String(err)));
      });
    });
  }

  /** 断开所有隧道并关闭信令连接 */
  close(): void {
    this._closed = true;

    // 清除所有重连定时器
    if (this._signalingReconnectTimer) {
      clearTimeout(this._signalingReconnectTimer);
      this._signalingReconnectTimer = null;
    }
    this._tunnelReconnectTimers.forEach((timer) => clearTimeout(timer));
    this._tunnelReconnectTimers.clear();

    this._tunnels.forEach((t) => t.close());
    this._tunnels.clear();
    this._autoReconnectPeers.clear();
    this._tunnelReconnectAttempts.clear();

    this._pendingConnections.forEach(({ pc, timer }) => {
      clearTimeout(timer);
      try { pc.close(); } catch { /* ignore */ }
    });
    this._pendingConnections.clear();

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /** 获取指定 peer 的隧道 */
  getTunnel(peerId: string): Tunnel | null {
    return this._tunnels.get(peerId) ?? null;
  }

  /** 所有活跃隧道 */
  get tunnels(): Map<string, Tunnel> {
    return new Map(this._tunnels);
  }

  /* ========== 信令消息处理 ========== */

  private _handleSignalingMessage(msg: SignalingMessage): void {
    switch (msg.type) {
      case 'registered':
        this._registered = true;
        this.emit('registered');
        break;

      case 'register_failed':
      case 'error':
        this.emit('error', new Error(msg.message));
        break;

      case 'incoming_connection':
        break;

      case 'offer':
        this._handleOffer(msg.from!, msg.sdp!);
        break;

      case 'answer':
        this._handleAnswer(msg.from!, msg.sdp!);
        break;

      case 'candidate':
        this._handleCandidate(msg.from!, msg.candidate!, msg.mid!);
        break;

      case 'peer_disconnected':
        // 对方已断开，清理本地隧道
        this._handlePeerDisconnected(msg.peerId!);
        break;
    }
  }

  /** 处理对方断开通知 */
  private _handlePeerDisconnected(peerId: string): void {
    const tunnel = this._tunnels.get(peerId);
    if (tunnel) {
      console.log(`[${this.id}] 收到信令服务器通知: "${peerId}" 已断开`);
      tunnel.close();
      this._tunnels.delete(peerId);
    }
    // 取消该 peer 的重连定时器（对方已断开，重连无意义）
    this._cancelTunnelReconnect(peerId);
    this._autoReconnectPeers.delete(peerId);
  }

  private _handleOffer(peerId: string, sdp: string): void {
    const pc = new nodeDataChannel.PeerConnection(this.id, {
      iceServers: this._iceServers,
    });

    // ⚠️ 必须先注册所有回调，再 setRemoteDescription

    pc.onDataChannel((dc) => {
      const tunnel = new Tunnel(dc, {
        isInitiator: false,
        heartbeatInterval: this._heartbeatInterval,
        heartbeatTimeout: this._heartbeatTimeout,
      });
      this._tunnels.set(peerId, tunnel);
      this._bindTunnelLifecycle(tunnel, peerId);
      this.emit('connection', tunnel, peerId);
    });

    pc.onLocalCandidate((candidate: string, mid: string) => {
      this._send({ type: 'candidate', targetId: peerId, candidate, mid });
    });

    pc.onLocalDescription((sdp: string, type: string) => {
      if (type === DescriptionType.Answer) {
        this._send({ type: 'answer', targetId: peerId, sdp });
      }
    });

    pc.setRemoteDescription(sdp, DescriptionType.Offer);
    this._flushPendingCandidates(peerId, pc);
  }

  private _handleAnswer(peerId: string, sdp: string): void {
    const pending = this._pendingConnections.get(peerId);
    if (!pending) return;
    pending.pc.setRemoteDescription(sdp, DescriptionType.Answer);
    this._flushPendingCandidates(peerId, pending.pc);
  }

  private _handleCandidate(peerId: string, candidate: string, mid: string): void {
    const pending = this._pendingConnections.get(peerId);
    if (pending?.pc) {
      try {
        pending.pc.addRemoteCandidate(candidate, mid);
      } catch {
        this._addPendingCandidate(peerId, { candidate, mid });
      }
    } else {
      this._addPendingCandidate(peerId, { candidate, mid });
    }
  }

  /* ========== 自动重连 ========== */

  /** 标记 peer 为自动重连（connect 成功后自动设置） */
  setAutoReconnect(peerId: string, enable: boolean): void {
    if (enable) {
      this._autoReconnectPeers.add(peerId);
    } else {
      this._autoReconnectPeers.delete(peerId);
      this._cancelTunnelReconnect(peerId);
    }
  }

  /** 信令服务器重连 */
  private _scheduleSignalingReconnect(): void {
    const maxAttempts = this._reconnectOpts.maxReconnectAttempts;
    if (maxAttempts > 0 && this._signalingReconnectAttempts >= maxAttempts) {
      this.emit('error', new Error(`信令服务器重连失败，已达最大次数 ${maxAttempts}`));
      return;
    }

    this._signalingReconnectAttempts++;
    this.emit('reconnecting', this._signalingReconnectAttempts);

    this._signalingReconnectTimer = setTimeout(() => {
      this.connectSignaling()
        .then(() => {
          this.emit('reconnected');
          // 重连后重新注册需要重连的隧道
          this._reconnectTunnels();
        })
        .catch((err) => {
          this.emit('error', err);
        });
    }, this._reconnectOpts.signalingReconnectInterval);
  }

  /** 重连所有需要自动重连的隧道 */
  private _reconnectTunnels(): void {
    for (const peerId of this._autoReconnectPeers) {
      if (!this._tunnels.has(peerId) && !this._tunnelReconnectTimers.has(peerId)) {
        this._scheduleTunnelReconnect(peerId);
      }
    }
  }

  /** 隧道重连 */
  private _scheduleTunnelReconnect(peerId: string): void {
    if (!this._reconnectOpts.tunnelReconnect) return;
    if (this._closed) return;

    const maxAttempts = this._reconnectOpts.maxReconnectAttempts;
    const attempts = this._tunnelReconnectAttempts.get(peerId) ?? 0;

    if (maxAttempts > 0 && attempts >= maxAttempts) {
      this.emit('error', new Error(`隧道 ${peerId} 重连失败，已达最大次数 ${maxAttempts}`));
      this._autoReconnectPeers.delete(peerId);
      return;
    }

    this._tunnelReconnectAttempts.set(peerId, attempts + 1);
    this.emit('tunnel-reconnecting', peerId, attempts + 1);

    const timer = setTimeout(() => {
      this._tunnelReconnectTimers.delete(peerId);
      this.connect(peerId)
        .then(() => {
          this._tunnelReconnectAttempts.delete(peerId);
          this.emit('tunnel-reconnected', peerId);
        })
        .catch((err) => {
          this.emit('error', err);
          // 继续重连
          if (this._autoReconnectPeers.has(peerId)) {
            this._scheduleTunnelReconnect(peerId);
          }
        });
    }, this._reconnectOpts.tunnelReconnectInterval);

    this._tunnelReconnectTimers.set(peerId, timer);
  }

  /** 取消隧道重连 */
  private _cancelTunnelReconnect(peerId: string): void {
    const timer = this._tunnelReconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this._tunnelReconnectTimers.delete(peerId);
    }
    this._tunnelReconnectAttempts.delete(peerId);
  }

  /* ========== ICE Candidate 缓冲 ========== */

  private _addPendingCandidate(peerId: string, entry: PendingCandidate): void {
    if (!this._pendingCandidates.has(peerId)) {
      this._pendingCandidates.set(peerId, []);
    }
    this._pendingCandidates.get(peerId)!.push(entry);
  }

  private _flushPendingCandidates(peerId: string, pc: PeerConnection): void {
    const list = this._pendingCandidates.get(peerId);
    if (!list?.length) return;
    for (const { candidate, mid } of list) {
      try { pc.addRemoteCandidate(candidate, mid); } catch { /* ignore */ }
    }
    this._pendingCandidates.delete(peerId);
  }

  /* ========== 生命周期绑定 ========== */

  private _bindTunnelLifecycle(tunnel: Tunnel, peerId: string): void {
    tunnel.on('close', () => {
      this._tunnels.delete(peerId);

      // 自动重连
      if (this._autoReconnectPeers.has(peerId) && !this._closed) {
        this._scheduleTunnelReconnect(peerId);
      }
    });
    tunnel.on('error', (err: Error) => {
      this.emit('error', err);
      this._tunnels.delete(peerId);

      // 自动重连
      if (this._autoReconnectPeers.has(peerId) && !this._closed) {
        this._scheduleTunnelReconnect(peerId);
      }
    });
  }

  /* ========== 工具 ========== */

  private _send(obj: object): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }
}
