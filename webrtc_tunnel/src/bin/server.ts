/**
 * 信令服务器独立运行入口
 * 打包后为单文件 dist/server.js，除 node 内置模块外无需额外依赖即可运行
 * （node-datachannel 只有客户端才需要）。
 *
 * 用法:
 *   node dist/server.js [端口]      默认 9876
 */

import { SignalingServer } from '../lib/signaling_server';

const port = Number(process.argv[2]) || 9876;
const server = new SignalingServer({ port });

server.start().then(() => {
  console.log('按 Ctrl+C 停止服务器');
});

/** 优雅退出：关闭所有客户端连接后再结束进程 */
function shutdown(signal: string): void {
  console.log(`\n收到 ${signal}，正在关闭...`);
  server.stop().then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
