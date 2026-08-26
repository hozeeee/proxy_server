import { EventEmitter } from 'events';
import type { DataChannel } from 'node-datachannel';

/**
 * 心跳协议常量。
 * 心跳完全走 P2P DataChannel，不经过信令服务器，因此隧道健康状态与信令通道解耦。
 */
const PING = 'PING';
const PONG = 'PONG';

export interface TunnelOptions {
  /** 是否为心跳发起方。仅由一方定时发 PING，避免双向心跳互相干扰 */
  isInitiator?: boolean;
  /** PING 发送间隔 (ms) */
  heartbeatInterval?: number;
  /** 超过该时长未收到任何消息即判定断线 (ms) */
  heartbeatTimeout?: number;
}

/**
 * 单条 P2P 隧道连接（封装 DataChannel）
 *
 * 在 DataChannel 之上提供两件事：
 *   1. 心跳保活与断线检测 —— PING/PONG 为内部协议，不会派发给上层；
 *   2. 统一的数据事件 —— 二进制与文本消息都以 Buffer 形式派发。
 *
 * 事件:
 *   'data'  (Buffer) - 收到业务数据
 *   'close' ()       - 连接关闭
 *   'error' (Error)  - 发生错误（心跳超时也归入此类，随后会自动 close）
 */
export class Tunnel extends EventEmitter {
  private _dc: DataChannel;
  private _isInitiator: boolean;
  private _heartbeatInterval: number;
  private _heartbeatTimeout: number;
  private _closed = false;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dc: DataChannel, opts: TunnelOptions = {}) {
    super();
    this._dc = dc;
    this._isInitiator = opts.isInitiator ?? false;
    this._heartbeatInterval = opts.heartbeatInterval ?? 5000;
    this._heartbeatTimeout = opts.heartbeatTimeout ?? 15000;

    this._bindDataChannel();
    this._startHeartbeat();
  }

  /* ==================== 公开 API ==================== */

  /** 发送数据（支持 Buffer / Uint8Array / string） */
  send(data: Buffer | Uint8Array | string): void {
    if (this._closed) throw new Error('Tunnel is closed');
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      this._dc.sendMessageBinary(data as Uint8Array);
    } else {
      this._dc.sendMessage(String(data));
    }
  }

  /** 关闭隧道（幂等） */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._stopHeartbeat();
    try { this._dc.close(); } catch { /* ignore */ }
    this.emit('close');
  }

  /** 隧道是否已关闭 */
  isClosed(): boolean {
    return this._closed;
  }

  /* ==================== DataChannel 事件 ==================== */

  private _bindDataChannel(): void {
    this._dc.onMessage((msg: string | Buffer | ArrayBuffer) => this._handleMessage(msg));
    this._dc.onClosed(() => this.close());
    this._dc.onError((err: string) => {
      this.emit('error', new Error(String(err)));
      this.close();
    });
  }

  /** 统一消息入口：先做心跳协议处理，其余作为业务数据派发 */
  private _handleMessage(msg: string | Buffer | ArrayBuffer): void {
    if (this._closed) return;

    // 收到任何消息都说明链路存活，重置断线计时
    this._resetTimeout();

    // 二进制消息一定是业务数据（心跳只走文本）
    if (msg instanceof ArrayBuffer) {
      this.emit('data', Buffer.from(msg));
      return;
    }
    if (Buffer.isBuffer(msg)) {
      this.emit('data', msg);
      return;
    }

    const text = String(msg);
    if (this._handleHeartbeat(text)) return;
    this.emit('data', Buffer.from(text));
  }

  /** 处理心跳消息，返回 true 表示该消息已被心跳协议消费，不再向上派发 */
  private _handleHeartbeat(text: string): boolean {
    if (text === PING) {
      try { this._dc.sendMessage(PONG); } catch { /* ignore */ }
      return true;
    }
    return text === PONG;
  }

  /* ==================== 心跳 ==================== */

  private _startHeartbeat(): void {
    if (this._isInitiator) {
      this._heartbeatTimer = setInterval(() => {
        if (this._closed) return;
        try { this._dc.sendMessage(PING); } catch { this.close(); }
      }, this._heartbeatInterval);
    }

    // 双方都做超时检测：超时未收到任何消息即判定断线
    this._resetTimeout();
  }

  private _resetTimeout(): void {
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    this._timeoutTimer = setTimeout(() => {
      if (this._closed) return;
      this.emit('error', new Error(`心跳超时 (${this._heartbeatTimeout}ms 未收到任何消息)`));
      this.close();
    }, this._heartbeatTimeout);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }
}
