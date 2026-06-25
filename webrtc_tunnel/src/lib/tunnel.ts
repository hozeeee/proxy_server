import { EventEmitter } from 'events';
import type { DataChannel } from 'node-datachannel';

/**
 * 单条 P2P 隧道连接（封装 DataChannel）
 *
 * 事件:
 *   'data'    (Buffer)  - 收到数据
 *   'close'   ()        - 连接关闭
 *   'error'   (Error)   - 发生错误
 */
export class Tunnel extends EventEmitter {
  private _dc: DataChannel;
  private _isInitiator: boolean;
  private _heartbeatInterval: number;
  private _heartbeatTimeout: number;
  private _closed = false;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dc: DataChannel, opts: {
    isInitiator?: boolean;
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
  } = {}) {
    super();
    this._dc = dc;
    this._isInitiator = opts.isInitiator ?? false;
    this._heartbeatInterval = opts.heartbeatInterval ?? 5000;
    this._heartbeatTimeout = opts.heartbeatTimeout ?? 15000;

    this._setupDataChannel();
    this._startHeartbeat();
  }

  /* ========== 公开 API ========== */

  /** 发送数据（支持 Buffer / Uint8Array / string） */
  send(data: Buffer | Uint8Array | string): void {
    if (this._closed) throw new Error('Tunnel is closed');
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      this._dc.sendMessageBinary(data as Uint8Array);
    } else {
      this._dc.sendMessage(String(data));
    }
  }

  /** 关闭隧道 */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._stopHeartbeat();
    try { this._dc.close(); } catch { /* ignore */ }
    this.emit('close');
  }

  /** 隧道是否仍然可用 */
  isClosed(): boolean {
    return this._closed;
  }

  /* ========== 内部方法 ========== */

  private _setupDataChannel(): void {
    // 统一消息处理：心跳协议 + 业务数据
    this._dc.onMessage((msg: string | Buffer | ArrayBuffer) => {
      if (this._closed) return;
      this._resetTimeout(); // 收到任何消息都重置超时

      // --- 二进制数据 ---
      if (msg instanceof ArrayBuffer) {
        this.emit('data', Buffer.from(msg));
        return;
      }
      if (Buffer.isBuffer(msg)) {
        this.emit('data', msg);
        return;
      }

      // --- 字符串消息 ---
      const str = String(msg);

      // 心跳协议
      if (str === 'PING') {
        try { this._dc.sendMessage('PONG'); } catch { /* ignore */ }
        return;
      }
      if (str === 'PONG') return; // 心跳响应，吞掉

      this.emit('data', Buffer.from(str));
    });

    this._dc.onClosed(() => this.close());

    this._dc.onError((err: string) => {
      this.emit('error', new Error(String(err)));
      this.close();
    });
  }

  private _startHeartbeat(): void {
    // 发起方: 定时发送 PING
    if (this._isInitiator) {
      this._heartbeatTimer = setInterval(() => {
        if (this._closed) return;
        try { this._dc.sendMessage('PING'); } catch { this.close(); }
      }, this._heartbeatInterval);
    }

    // 双方: 超时未收到任何消息 → 判定断线
    this._resetTimeout();
  }

  private _resetTimeout(): void {
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    this._timeoutTimer = setTimeout(() => {
      if (!this._closed) {
        this.emit('error', new Error('Heartbeat timeout'));
        this.close();
      }
    }, this._heartbeatTimeout);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
  }
}
