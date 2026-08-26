/**
 * 客户端独立运行入口
 * 打包后为单文件 dist/client-bin.js
 *
 * 用法:
 *   node dist/client-bin.js --id <my-id> [--connect <peer-id>] [--signaling <url>] [选项]
 *
 * 选项:
 *   --no-reconnect             禁用自动重连
 *   --reconnect-interval <ms>  重连间隔 (默认 5000)
 *   --max-reconnect <n>        最大重连次数 (默认 0=无限)
 *   --quiet                    不输出阶段流转日志
 *
 * 说明: 双方都可以指定 --connect 指向对方，角色由信令服务器分配，不会冲突。
 */

import { WebRTCTunnelClient } from '../lib/client';
import type { Tunnel } from '../lib/tunnel';

interface CliOptions {
  id: string;
  connectTo?: string;
  signalingUrl: string;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnect: number;
  verbose: boolean;
}

const USAGE =
  '用法: node client-bin.js --id <my-id> [--connect <peer-id>] [--signaling <url>] [--no-reconnect] [--quiet]';

/* ==================== 命令行参数 ==================== */

function parseArgs(argv: string[]): CliOptions {
  const getArg = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  const id = getArg('id');
  if (!id) {
    console.error('错误: 必须指定 --id');
    console.error(USAGE);
    process.exit(1);
  }

  return {
    id,
    connectTo: getArg('connect'),
    signalingUrl: getArg('signaling') || 'ws://127.0.0.1:9876',
    reconnect: !hasFlag('no-reconnect'),
    reconnectInterval: Number(getArg('reconnect-interval')) || 5000,
    maxReconnect: Number(getArg('max-reconnect')) || 0,
    verbose: !hasFlag('quiet'),
  };
}

/* ==================== 事件日志 ==================== */

/** 打印客户端各阶段的状态流转，便于观察「注册 → 配对 → 建连」的推进过程 */
function bindLogging(client: WebRTCTunnelClient, opts: CliOptions): void {
  const tag = `[${opts.id}]`;

  client.on('error', (err: Error) => console.error(`${tag} 错误:`, err.message));

  // --- 阶段一：注册与配对 ---
  client.on('registered', () => console.log(`${tag} ① 已在信令服务器注册`));
  client.on('pair-invite', (peerId: string) =>
    console.log(`${tag} ② 收到 "${peerId}" 的配对邀请，已确认`)
  );
  client.on('pair-waiting', (peerId: string, reason: string) =>
    console.log(`${tag} ② 等待与 "${peerId}" 配对 (${reason})，将无限等待...`)
  );
  client.on('paired', (peerId: string, role: string) =>
    console.log(`${tag} ③ 与 "${peerId}" 配对成功，本方角色: ${role}，开始交换 WebRTC 信令`)
  );
  client.on('unpaired', (peerId: string, reason: string) =>
    console.log(`${tag} ✖ 与 "${peerId}" 的配对已解除 (${reason})`)
  );

  // --- 信令连接状态 ---
  client.on('disconnected', () => console.log(`${tag} 与信令服务器断开连接`));
  client.on('reconnecting', (attempt: number) =>
    console.log(`${tag} 正在重连信令服务器 (第 ${attempt} 次)...`)
  );
  client.on('reconnected', () => console.log(`${tag} 信令服务器重连成功`));

  // --- 隧道重连 ---
  client.on('tunnel-reconnecting', (peerId: string, attempt: number) =>
    console.log(`${tag} 正在重新配对 → "${peerId}" (第 ${attempt} 次)...`)
  );
  client.on('tunnel-reconnected', (peerId: string) =>
    console.log(`${tag} 隧道重连成功 → "${peerId}"`)
  );
}

/* ==================== 隧道交互 ==================== */

/** 交互模式：从 stdin 读取文本发送给对端 */
function startInteractiveInput(tunnel: Tunnel, peerId: string, tag: string): void {
  console.log(`\n输入消息发送给 "${peerId}"（Ctrl+C 退出）:`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    const text = chunk.trim();
    if (!text) return;
    try {
      tunnel.send(Buffer.from(text));
      console.log(`${tag} → 已发送 "${text}"`);
    } catch (err: any) {
      console.error('发送失败:', err.message);
    }
  });
}

/** 非交互模式（如后台运行）：定时发送探测数据，便于观察链路是否通畅 */
function startPeriodicProbe(tunnel: Tunnel, tag: string): void {
  let count = 0;
  const timer = setInterval(() => {
    if (tunnel.isClosed()) {
      clearInterval(timer);
      return;
    }
    count++;
    tunnel.send(Buffer.from(`probe-${count}-${Date.now()}`));
    console.log(`${tag} → 已发送 #${count}`);
  }, 3000);
}

function setupTunnel(tunnel: Tunnel, peerId: string, tag: string): void {
  tunnel.on('data', (buf: Buffer) => {
    console.log(`${tag} ← 来自 "${peerId}" 的数据 (${buf.length} bytes): ${buf.toString('utf8')}`);
  });
  tunnel.on('close', () => console.log(`${tag} 与 "${peerId}" 的隧道已关闭`));

  if (process.stdin.isTTY) startInteractiveInput(tunnel, peerId, tag);
  else startPeriodicProbe(tunnel, tag);
}

/* ==================== 主逻辑 ==================== */

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const tag = `[${opts.id}]`;

  const client = new WebRTCTunnelClient({
    id: opts.id,
    signalingUrl: opts.signalingUrl,
    verbose: opts.verbose,
    reconnect: {
      signalingReconnect: opts.reconnect,
      tunnelReconnect: opts.reconnect,
      tunnelReconnectInterval: opts.reconnectInterval,
      maxReconnectAttempts: opts.maxReconnect,
    },
  });

  bindLogging(client, opts);

  // 被动接受的连接（对端指定了 --connect 指向本方）
  client.on('connection', (tunnel: Tunnel, peerId: string) => {
    console.log(`\n✅ ${tag} P2P 隧道已建立 ← "${peerId}"`);
    setupTunnel(tunnel, peerId, tag);
  });

  process.on('SIGINT', () => {
    console.log(`\n${tag} 正在关闭...`);
    client.close();
    process.exit(0);
  });

  // 阶段一：注册
  console.log(`${tag} 正在连接信令服务器 ${opts.signalingUrl} ...`);
  await client.connectSignaling();

  // 阶段一 → 阶段二：声明配对意向。对端未上线时会无限等待，不会超时退出
  if (opts.connectTo) {
    console.log(`${tag} 正在等待与 "${opts.connectTo}" 配对 ...`);
    const tunnel = await client.connect(opts.connectTo);
    console.log(`\n✅ ${tag} P2P 隧道已建立 → "${opts.connectTo}"`);
    setupTunnel(tunnel, opts.connectTo, tag);
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
