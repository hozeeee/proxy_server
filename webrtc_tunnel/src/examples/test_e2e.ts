/**
 * 端到端测试脚本
 * 在同一进程内模拟两个客户端通过信令服务器建立 P2P 隧道并互发数据
 */

import { SignalingServer } from '../lib/signaling_server';
import { WebRTCTunnelClient } from '../lib/client';
import type { Tunnel } from '../lib/tunnel';

const SIGNALING_PORT = 19876;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('=== WebRTC Tunnel 端到端测试 ===\n');

  // 1. 启动信令服务器
  const server = new SignalingServer({ port: SIGNALING_PORT });
  await server.start();

  // 2. 创建两个客户端
  const clientA = new WebRTCTunnelClient({
    id: 'node-a',
    signalingUrl: `ws://127.0.0.1:${SIGNALING_PORT}`,
  });

  const clientB = new WebRTCTunnelClient({
    id: 'node-b',
    signalingUrl: `ws://127.0.0.1:${SIGNALING_PORT}`,
  });

  // 3. 监听事件
  clientA.on('error', (err: Error) => console.error('[A] 错误:', err.message));
  clientB.on('error', (err: Error) => console.error('[B] 错误:', err.message));

  // B 监听入站连接
  const bGotConnection = new Promise<Tunnel>((resolve) => {
    clientB.on('connection', (tunnel: Tunnel, peerId: string) => {
      console.log(`[B] 收到来自 "${peerId}" 的隧道连接`);
      tunnel.on('data', (buf: Buffer) => {
        console.log(`[B] ← 收到数据 (${buf.length} bytes): ${buf.toString()}`);
      });
      resolve(tunnel);
    });
  });

  // 4. 连接信令服务器
  await clientA.connectSignaling();
  console.log('[A] 信令注册成功');
  await clientB.connectSignaling();
  console.log('[B] 信令注册成功\n');

  // 5. A 主动连接 B
  console.log('[A] 正在连接 B ...');
  const tunnelFromA = await clientA.connect('node-b');
  console.log('[A] P2P 隧道已建立!\n');

  const tunnelFromB = await bGotConnection;
  console.log('[B] P2P 隧道已建立!\n');

  // 6. 测试文本消息
  tunnelFromA.send(Buffer.from('Hello from A!'));
  await sleep(500);

  // 7. 测试二进制 Buffer
  const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
  tunnelFromA.send(binaryData);
  await sleep(500);

  // 8. B 回复 A
  tunnelFromB.send(Buffer.from('Hello from B!'));
  await sleep(500);

  // 9. 验证结果
  console.log('\n=== 测试结果 ===');
  console.log('A→B 隧道:', tunnelFromA.isClosed() ? '已关闭 ❌' : '正常 ✅');
  console.log('B→A 隧道:', tunnelFromB.isClosed() ? '已关闭 ❌' : '正常 ✅');

  // 10. 清理
  clientA.close();
  clientB.close();
  await server.stop();
  console.log('\n测试完成，已清理所有资源。');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
