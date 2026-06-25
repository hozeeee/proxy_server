/**
 * 信令服务器独立运行入口
 * 打包后为单文件 dist/server.js，仅需 node-datachannel 之外的依赖即可运行
 */

import { SignalingServer } from '../lib/signaling_server';

const port = Number(process.argv[2]) || 9876;

const server = new SignalingServer({ port });
server.start().then(() => {
  console.log('按 Ctrl+C 停止服务器');
});

process.on('SIGINT', () => {
  console.log('\n正在关闭...');
  server.stop().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.stop().then(() => process.exit(0));
});
