/**
 * 客户端独立运行入口
 * 打包后为单文件 dist/client-bin.js
 *
 * 用法:
 *   node dist/client-bin.js --id <my-id> [--connect <peer-id>] [--signaling <url>] [选项]
 *
 * 选项:
 *   --no-reconnect           禁用自动重连
 *   --reconnect-interval <ms>  重连间隔 (默认 5000)
 *   --max-reconnect <n>        最大重连次数 (默认 0=无限)
 */

import { WebRTCTunnelClient } from '../lib/client';
import type { Tunnel } from '../lib/tunnel';

/* ========== 解析命令行参数 ========== */
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const myId = getArg('id');
const connectTo = getArg('connect');
const signalingUrl = getArg('signaling') || 'ws://127.0.0.1:9876';
const noReconnect = hasFlag('no-reconnect');
const reconnectInterval = Number(getArg('reconnect-interval')) || 5000;
const maxReconnect = Number(getArg('max-reconnect')) || 0;

if (!myId) {
  console.error('错误: 必须指定 --id');
  console.error('用法: node client-bin.js --id <my-id> [--connect <peer-id>] [--signaling <url>]');
  process.exit(1);
}

/* ========== 主逻辑 ========== */
async function main(): Promise<void> {
  const client = new WebRTCTunnelClient({
    id: myId!,
    signalingUrl,
    reconnect: {
      signalingReconnect: !noReconnect,
      tunnelReconnect: !noReconnect,
      tunnelReconnectInterval: reconnectInterval,
      maxReconnectAttempts: maxReconnect,
    },
  });

  client.on('error', (err: Error) => {
    console.error(`[${myId}] 错误:`, err.message);
  });

  client.on('connection', (tunnel: Tunnel, peerId: string) => {
    console.log(`\n✅ [${myId}] 收到来自 "${peerId}" 的 P2P 隧道连接`);
    // 被动接收的连接也启用自动重连
    client.setAutoReconnect(peerId, true);
    setupTunnel(tunnel, peerId);
  });

  client.on('connected', (tunnel: Tunnel, peerId: string) => {
    // 主动连接成功后启用自动重连
    client.setAutoReconnect(peerId, true);
  });

  client.on('registered', () => {
    console.log(`[${myId}] 已在信令服务器注册`);
  });

  client.on('disconnected', () => {
    console.log(`[${myId}] 与信令服务器断开连接`);
  });

  client.on('reconnecting', (attempt: number) => {
    console.log(`[${myId}] 正在重连信令服务器 (第 ${attempt} 次)...`);
  });

  client.on('reconnected', () => {
    console.log(`[${myId}] 信令服务器重连成功`);
  });

  client.on('tunnel-reconnecting', (peerId: string, attempt: number) => {
    console.log(`[${myId}] 正在重连隧道 → "${peerId}" (第 ${attempt} 次)...`);
  });

  client.on('tunnel-reconnected', (peerId: string) => {
    console.log(`[${myId}] 隧道重连成功 → "${peerId}"`);
  });

  console.log(`[${myId}] 正在连接信令服务器 ${signalingUrl} ...`);
  await client.connectSignaling();

  if (connectTo) {
    console.log(`[${myId}] 正在主动连接 "${connectTo}" ...`);
    try {
      const tunnel = await client.connect(connectTo);
      console.log(`\n✅ [${myId}] P2P 隧道已建立 → "${connectTo}"`);
      setupTunnel(tunnel, connectTo);
    } catch (err: any) {
      console.error(`[${myId}] 连接 "${connectTo}" 失败:`, err.message);
    }
  }

  process.on('SIGINT', () => {
    console.log(`\n[${myId}] 正在关闭...`);
    client.close();
    process.exit(0);
  });
}

/* ========== 隧道交互 ========== */
function setupTunnel(tunnel: Tunnel, peerId: string): void {
  tunnel.on('data', (buf: Buffer) => {
    console.log(`[${myId}] ← 收到来自 "${peerId}" 的数据 (${buf.length} bytes): ${buf.toString('utf8')}`);
  });

  tunnel.on('close', () => {
    console.log(`[${myId}] 与 "${peerId}" 的隧道已关闭`);
  });

  if (process.stdin.isTTY) {
    console.log(`\n输入消息发送给 "${peerId}"（Ctrl+C 退出）:`);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (!text) return;
      try {
        tunnel.send(Buffer.from(text));
        console.log(`[${myId}] → 已发送 "${text}"`);
      } catch (err: any) {
        console.error(`发送失败:`, err.message);
      }
    });
  } else {
    let count = 0;
    const timer = setInterval(() => {
      if (tunnel.isClosed()) { clearInterval(timer); return; }
      count++;
      const payload = Buffer.from(`ping-${count}-${Date.now()}`);
      tunnel.send(payload);
      console.log(`[${myId}] → 已发送 #${count}`);
    }, 3000);
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
