/**
 * 端到端测试
 *
 * 在同一进程内启动信令服务器与多个客户端，覆盖协议的关键约束：
 *   1. 注册/配对阶段先行：对端未接入时无限等待，且不产生任何 WebRTC 交换
 *   2. 对端接入后自动撮合 → 建连 → P2P 双向数据传输
 *   3. 双方同时 connect() 不会因角色冲突而死锁（glare 回归）
 *   4. 未完成配对时，服务端拒绝转发 SDP
 *   5. 协议版本不匹配时拒绝注册
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

import { SignalingServer } from '../lib/signaling_server';
import { WebRTCTunnelClient } from '../lib/client';
import type { Tunnel } from '../lib/tunnel';
import { PROTOCOL_VERSION } from '../lib/protocol';

const SIGNALING_PORT = 19876;
const SIGNALING_URL = `ws://127.0.0.1:${SIGNALING_PORT}`;
const HANDSHAKE_TIMEOUT = 20000;

/* ==================== 测试工具 ==================== */

let passed = 0;
let failed = 0;

function check(ok: boolean, label: string): void {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等待一次事件 */
function once<T extends unknown[]>(emitter: EventEmitter, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args as T)));
}

/** 给 promise 套上超时，避免测试挂死 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms)),
  ]);
}

function newClient(id: string): WebRTCTunnelClient {
  const client = new WebRTCTunnelClient({ id, signalingUrl: SIGNALING_URL });
  // 测试中的错误不应导致 EventEmitter 抛出未捕获异常
  client.on('error', () => { /* 由各测试自行断言 */ });
  return client;
}

/** 等待隧道上的下一条数据 */
function nextData(tunnel: Tunnel): Promise<Buffer> {
  return new Promise((resolve) => tunnel.once('data', resolve));
}

/* ==================== 测试 1 & 2 ==================== */

/**
 * 配对阶段必须先于建连阶段完成。
 * A 先声明配对意向（此时 B 尚未接入），验证 A 会无限等待且不开始 WebRTC 交换；
 * B 接入后应自动撮合并完成建连。
 */
async function testPairingPrecedesHandshake(): Promise<void> {
  console.log('\n[测试 1] 注册/配对阶段先行，对端未接入时无限等待');

  const a = newClient('t1-node-a');
  await a.connectSignaling();

  let pairedRole = '';
  let waitingReason = '';
  a.on('paired', (_peerId: string, role: string) => { pairedRole = role; });
  a.on('pair-waiting', (_peerId: string, reason: string) => { waitingReason = reason; });

  // B 还没上线就声明意向
  const pendingTunnel = a.connect('t1-node-b');
  let settled = false;
  pendingTunnel.then(() => { settled = true; }, () => { settled = true; });

  await sleep(800);
  check(waitingReason === 'peer_offline', '对端未接入 → 收到 pair_waiting(peer_offline)');
  check(pairedRole === '', '对端未接入前不会配对成功，也不会交换 WebRTC 信令');
  check(!settled, 'connect() 保持等待而非超时失败（配对阶段无超时）');

  console.log('\n[测试 2] 对端接入后自动撮合并建立 P2P 隧道');

  const b = newClient('t1-node-b');
  const inbound = once<[Tunnel, string]>(b, 'connection');
  await b.connectSignaling();

  const tunnelA = await withTimeout(pendingTunnel, HANDSHAKE_TIMEOUT, 'A 侧建连超时');
  const [tunnelB, peerIdOnB] = await withTimeout(inbound, HANDSHAKE_TIMEOUT, 'B 侧建连超时');

  check(pairedRole === 'initiator', `A 由服务端指派为 initiator（实际: ${pairedRole}）`);
  check(peerIdOnB === 't1-node-a', 'B 侧 connection 事件带回正确的 peerId');
  check(!tunnelA.isClosed() && !tunnelB.isClosed(), '双方隧道均处于打开状态');

  // A → B 文本
  const recvOnB = nextData(tunnelB);
  tunnelA.send(Buffer.from('hello from A'));
  check((await withTimeout(recvOnB, 5000, 'A→B 数据超时')).toString() === 'hello from A',
    'A → B 文本数据传输');

  // B → A 文本
  const recvOnA = nextData(tunnelA);
  tunnelB.send(Buffer.from('hello from B'));
  check((await withTimeout(recvOnA, 5000, 'B→A 数据超时')).toString() === 'hello from B',
    'B → A 文本数据传输');

  // A → B 二进制（含 0x00 与高位字节，验证未被当作文本处理）
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
  const recvBinary = nextData(tunnelB);
  tunnelA.send(binary);
  check((await withTimeout(recvBinary, 5000, '二进制数据超时')).equals(binary),
    'A → B 二进制数据完整传输');

  a.close();
  b.close();
}

/* ==================== 测试 3 ==================== */

/**
 * 双方同时 connect() 对方（glare）。
 * 角色由服务端指派，因此不会出现双方都创建 offer 或都等待对方的死锁。
 */
async function testSimultaneousConnect(): Promise<void> {
  console.log('\n[测试 3] 双方同时 connect() 不会死锁');

  const x = newClient('t3-node-x');
  const y = newClient('t3-node-y');

  const roles: Record<string, string> = {};
  x.on('paired', (_p: string, role: string) => { roles.x = role; });
  y.on('paired', (_p: string, role: string) => { roles.y = role; });

  await Promise.all([x.connectSignaling(), y.connectSignaling()]);

  // 不加任何延迟，让两侧的 pair 请求尽可能同时到达服务端
  const [tunnelX, tunnelY] = await withTimeout(
    Promise.all([x.connect('t3-node-y'), y.connect('t3-node-x')]),
    HANDSHAKE_TIMEOUT,
    '双向 connect 建连超时'
  );

  check(!tunnelX.isClosed() && !tunnelY.isClosed(), '双向 connect() 均成功返回隧道');
  check(
    (roles.x === 'initiator' && roles.y === 'answerer') ||
      (roles.x === 'answerer' && roles.y === 'initiator'),
    `服务端为双方指派了互补角色（x=${roles.x}, y=${roles.y}）`
  );

  const recv = nextData(tunnelY);
  tunnelX.send(Buffer.from('glare ok'));
  check((await withTimeout(recv, 5000, '数据超时')).toString() === 'glare ok',
    '双向 connect 建立的隧道可正常传输数据');

  x.close();
  y.close();
}

/* ==================== 测试 4 & 5 ==================== */

/** 用裸 WebSocket 直连信令服务器，收集收到的消息 */
async function rawSession(): Promise<{
  ws: WebSocket;
  send: (msg: object) => void;
  waitFor: (type: string, ms?: number) => Promise<any>;
}> {
  const ws = new WebSocket(SIGNALING_URL);
  const inbox: any[] = [];
  const listeners: Array<(msg: any) => void> = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    listeners.forEach((fn) => fn(msg));
  });
  await once(ws, 'open');

  const waitFor = (type: string, ms = 3000): Promise<any> =>
    new Promise((resolve, reject) => {
      const hit = inbox.find((m) => m.type === type);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error(`未收到 ${type} 消息`)), ms);
      listeners.push((msg) => {
        if (msg.type === type) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });

  return { ws, send: (msg: object) => ws.send(JSON.stringify(msg)), waitFor };
}

/** 未完成配对就发送 offer，服务端必须拒绝转发 */
async function testHandshakeRejectedBeforePairing(): Promise<void> {
  console.log('\n[测试 4] 未配对时服务端拒绝转发 WebRTC 信令');

  const session = await rawSession();
  session.send({ type: 'register', id: 't4-raw', protocol: PROTOCOL_VERSION });
  await session.waitFor('registered');

  session.send({ type: 'offer', peerId: 't4-peer', session: 1, sdp: 'v=0' });
  const err = await session.waitFor('error').catch(() => null);
  check(
    Boolean(err && String(err.reason).includes('尚未完成配对')),
    `未配对的 offer 被拒绝（服务端回复: ${err ? err.reason : '无响应'}）`
  );

  session.ws.close();
}

/** 未注册就发消息，以及协议版本不匹配，都应被拒绝 */
async function testRegistrationGuards(): Promise<void> {
  console.log('\n[测试 5] 注册前置校验');

  // 未注册就发 pair
  const unregistered = await rawSession();
  unregistered.send({ type: 'pair', peerId: 'whoever' });
  const err = await unregistered.waitFor('error').catch(() => null);
  check(
    Boolean(err && String(err.reason).includes('尚未注册')),
    '未注册的连接发送 pair 被拒绝'
  );
  unregistered.ws.close();

  // 协议版本不匹配
  const mismatched = await rawSession();
  mismatched.send({ type: 'register', id: 't5-old', protocol: PROTOCOL_VERSION + 1 });
  const failure = await mismatched.waitFor('register_failed').catch(() => null);
  check(
    Boolean(failure && String(failure.reason).includes('协议版本不匹配')),
    '协议版本不匹配时拒绝注册'
  );
  mismatched.ws.close();
}

/* ==================== 入口 ==================== */

async function main(): Promise<void> {
  console.log('=== WebRTC Tunnel 端到端测试 ===');

  const server = new SignalingServer({ port: SIGNALING_PORT });
  await server.start();

  try {
    await testPairingPrecedesHandshake();
    await testSimultaneousConnect();
    await testHandshakeRejectedBeforePairing();
    await testRegistrationGuards();
  } finally {
    await sleep(300);
    await server.stop();
  }

  console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n测试异常终止:', err);
  process.exit(1);
});
