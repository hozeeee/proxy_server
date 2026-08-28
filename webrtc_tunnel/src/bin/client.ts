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
 *   --no-report                不向服务端上报建连阶段状态
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
  /** 是否把各阶段状态上报到信令服务端（便于在服务端一处排查双方进度） */
  reportStatus: boolean;
  verbose: boolean;
}

const USAGE =
  '用法: node client-bin.js --id <my-id> [--connect <peer-id>] [--signaling <url>] [--no-reconnect] [--no-report] [--quiet]';

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
    reportStatus: !hasFlag('no-report'),
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

/**
 * 交互模式：从 stdin 读取文本发送给对端。
 *
 * 监听器只能注册一次（而非每条隧道注册一次）：重连会换出新的 Tunnel 对象，
 * 按隧道绑定会造成监听器逐次叠加（每重连一次就多发一份），且旧监听器手持的
 * 是已失效的隧道。因此这里每次发送前向 client 查当前活跃隧道。
 */
function startInteractiveInput(client: WebRTCTunnelClient, tag: string): void {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    const text = chunk.trim();
    if (!text) return;

    const tunnels = client.tunnels;
    if (tunnels.size === 0) {
      console.error(`${tag} 当前没有可用隧道，消息未发送`);
      return;
    }
    for (const [peerId, tunnel] of tunnels) {
      try {
        tunnel.send(Buffer.from(text));
        console.log(`${tag} → 已发送给 "${peerId}": "${text}"`);
      } catch (err: any) {
        console.error(`${tag} 发送给 "${peerId}" 失败: ${err.message}`);
      }
    }
  });
}

/** 非交互模式（如后台运行）：定时发送探测数据，便于观察链路是否通畅 */
function startPeriodicProbe(tunnel: Tunnel, peerId: string, tag: string): void {
  let count = 0;
  const timer = setInterval(() => {
    // 隧道已换新（重连）或已关闭：本定时器退场，新隧道由 'tunnel' 事件另起一个
    if (tunnel.isClosed()) {
      clearInterval(timer);
      return;
    }
    count++;
    try {
      tunnel.send(Buffer.from(`probe-${count}-${Date.now()}`));
      console.log(`${tag} → 已发送 #${count} → "${peerId}"`);
    } catch (err: any) {
      console.error(`${tag} 探测发送失败: ${err.message}`);
    }
  }, 3000);
}

/**
 * 接管每一条建立起来的隧道（含每一次重连）。
 *
 * 必须订阅 'tunnel'，而不能只拿 `await client.connect()` 的返回值：
 * 隧道掉线重连后库会换出一个全新的 Tunnel 对象，而 connect() 的 promise 只会结算一次。
 * 只绑首条隧道的话，重连后本端既不会再发数据、也收不到 'data'，
 * 而两端与信令服务端都仍显示「隧道已建立」—— 表现为通道假成功。
 */
function bindTunnels(client: WebRTCTunnelClient, tag: string): void {
  client.on(
    'tunnel',
    (tunnel: Tunnel, peerId: string, info: { role: string; reconnected: boolean }) => {
      const suffix = info?.reconnected ? '（重连）' : '';
      console.log(`\n✅ ${tag} P2P 隧道已建立 ⇄ "${peerId}" [${info?.role}]${suffix}`);

      tunnel.on('data', (buf: Buffer) => {
        console.log(
          `${tag} ← 来自 "${peerId}" 的数据 (${buf.length} bytes): ${buf.toString('utf8')}`
        );
      });
      tunnel.on('close', () => console.log(`${tag} 与 "${peerId}" 的隧道已关闭`));

      if (process.stdin.isTTY) console.log(`输入消息发送给 "${peerId}"（Ctrl+C 退出）:`);
      else startPeriodicProbe(tunnel, peerId, tag);
    }
  );
}

/* ==================== 主逻辑 ==================== */

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const tag = `[${opts.id}]`;

  const client = new WebRTCTunnelClient({
    id: opts.id,
    signalingUrl: opts.signalingUrl,
    verbose: opts.verbose,
    reportStatus: opts.reportStatus,
    reconnect: {
      signalingReconnect: opts.reconnect,
      tunnelReconnect: opts.reconnect,
      tunnelReconnectInterval: opts.reconnectInterval,
      maxReconnectAttempts: opts.maxReconnect,
    },
  });

  bindLogging(client, opts);

  // 所有隧道（主动 / 被动、首次 / 重连）统一由 'tunnel' 事件接管
  bindTunnels(client, tag);
  if (process.stdin.isTTY) startInteractiveInput(client, tag);

  process.on('SIGINT', () => {
    console.log(`\n${tag} 正在关闭...`);
    client.close();
    process.exit(0);
  });

  // 阶段一：注册
  console.log(`${tag} 正在连接信令服务器 ${opts.signalingUrl} ...`);
  await client.connectSignaling();

  // 阶段一 → 阶段二：声明配对意向。对端未上线时会无限等待，不会超时退出。
  // 这里只用于等待首次建连（便于启动时报错），隧道本身不在此处绑定。
  if (opts.connectTo) {
    console.log(`${tag} 正在等待与 "${opts.connectTo}" 配对 ...`);
    await client.connect(opts.connectTo);
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
