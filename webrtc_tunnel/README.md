# WebRTC Tunnel - P2P NAT 穿透隧道

基于 WebRTC DataChannel 的内网穿透工具。信令服务器仅负责 SDP/ICE 交换，**数据流量完全走 P2P 直连**，不经过服务器带宽。

## 架构

```
信令服务器 (ws://)
    │
    ├── 客户端 A ──STUN──▶ 获取公网地址
    ├── 客户端 B ──STUN──▶ 获取公网地址
    │
    └── 交换 SDP Offer/Answer + ICE Candidates
              │
              ▼
        A ◀═══ P2P 直连 (DataChannel) ═══▶ B
```

## 目录结构

```
webrtc_tunnel/
├── src/                          # TypeScript 源码
│   ├── lib/
│   │   ├── tunnel.ts             # 隧道连接封装（含心跳）
│   │   ├── signaling_server.ts   # 信令服务器
│   │   └── client.ts             # 客户端 SDK
│   ├── bin/
│   │   ├── server.ts             # 信令服务器独立入口
│   │   └── client.ts             # 客户端独立入口
│   └── examples/
│       └── test_e2e.ts           # 端到端测试
├── dist/                         # 构建产物（打包后的单文件）
│   ├── server.js                 # 信令服务器单文件（~132KB）
│   └── client-bin.js             # 客户端单文件（~125KB）
├── rollup.config.mjs             # Rollup 打包配置
├── tsconfig.json                 # TypeScript 配置
└── package.json
```

## 安装

```bash
cd webrtc_tunnel
npm install
```

> **注意**: `node-datachannel` 是原生模块，安装时需要编译环境（Python 3、make、g++）。

## 构建

```bash
# 构建 server + client
npm run build

# 仅构建信令服务器
npm run build:server

# 仅构建客户端
npm run build:client
```

构建产物在 `dist/` 目录下，为单文件 JS，可直接用 `node` 运行。

## 使用方式

### 1. 启动信令服务器

```bash
# 使用打包后的单文件
node dist/server.js [端口]

# 默认端口 9876
node dist/server.js

# 或使用 npm script
npm run server
```

**HTTP 端点**（用于健康检查、状态查看和客户端下载）：

| 端点 | 说明 |
|------|------|
| `GET /` | 浏览器访问返回 HTML 状态页面（含在线客户端列表，每 5 秒自动刷新）；API 访问（`Accept: application/json`）返回 JSON |
| `GET /health` | 健康检查，始终返回 JSON |
| `GET /client.js` | 下载客户端脚本（构建时自动嵌入） |

```bash
# 健康检查
curl http://localhost:9876/health
# {"status": "ok", "clients": 0, "uptime": 123, "timestamp": "..."}

# 下载客户端脚本
curl -O http://localhost:9876/client.js
```

### 2. 启动客户端

**本地开发/测试**：

```bash
# 客户端 B（被动等待连接）
node dist/client-bin.js --id client-b

# 客户端 A（主动连接 B）
node dist/client-bin.js --id client-a --connect client-b

# 指定信令服务器地址
node dist/client-bin.js --id client-a --connect client-b --signaling ws://1.2.3.4:9876
```

**远程机器部署**：

```bash
# 1. 在远程机器上安装依赖（需要 Node.js 和编译环境）
./install-client.sh

# 2. 从信令服务器下载客户端脚本
curl -O http://<服务器地址>:9876/client.js

# 3. 运行
node client.js --id remote-node --connect peer-id
```

> **注意**: `node-datachannel` 是原生模块，安装时需要 Python 3、make、g++ 编译环境。

**命令行参数**:

| 参数 | 必填 | 说明 |
|------|------|------|
| `--id <string>` | 是 | 本客户端唯一标识 |
| `--connect <string>` | 否 | 启动后立即连接的目标客户端 id |
| `--signaling <url>` | 否 | 信令服务器地址，默认 `ws://127.0.0.1:9876` |
| `--no-reconnect` | 否 | 禁用自动重连 |
| `--reconnect-interval <ms>` | 否 | 重连间隔，默认 5000ms |
| `--max-reconnect <n>` | 否 | 最大重连次数，0=无限（默认） |

**自动重连**：

客户端默认启用自动重连功能：
- 信令服务器断开后自动重连
- P2P 隧道断开后自动重连

```bash
# 禁用自动重连
node client.js --id my-node --no-reconnect

# 自定义重连间隔（10 秒）
node client.js --id my-node --reconnect-interval 10000

# 最多重连 5 次
node client.js --id my-node --max-reconnect 5
```

### 3. 作为模块集成

```typescript
import { WebRTCTunnelClient } from './lib/client';
import type { Tunnel } from './lib/tunnel';

const client = new WebRTCTunnelClient({
  id: 'my-node',
  signalingUrl: 'ws://signaling-server:9876',
});

// 连接信令服务器
await client.connectSignaling();

// 主动连接其他客户端
const tunnel = await client.connect('peer-id');
tunnel.send(Buffer.from('hello'));

// 接收数据
tunnel.on('data', (buf: Buffer) => {
  console.log('收到:', buf);
});

// 被动接收连接
client.on('connection', (tunnel: Tunnel, peerId: string) => {
  console.log(`${peerId} 连入`);
  tunnel.on('data', (buf: Buffer) => console.log(buf));
});
```

### 4. 运行测试

```bash
# 端到端测试（同进程内模拟两个客户端）
node dist/test_e2e.js

# 或使用 npm script
npm test
```

## API 参考

### `WebRTCTunnelClient`

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `connectSignaling()` | `Promise<void>` | 连接信令服务器并注册 |
| `connect(peerId)` | `Promise<Tunnel>` | 主动连接到指定 peer |
| `close()` | `void` | 断开所有隧道并关闭信令连接 |
| `getTunnel(peerId)` | `Tunnel \| null` | 获取指定 peer 的隧道 |
| `tunnels` (getter) | `Map<string, Tunnel>` | 所有活跃隧道 |
| `setAutoReconnect(peerId, enable)` | `void` | 设置 peer 是否自动重连 |

**构造参数**:

```typescript
new WebRTCTunnelClient({
  id: 'my-node',
  signalingUrl: 'ws://...',
  reconnect: {
    signalingReconnect: true,       // 信令服务器自动重连
    signalingReconnectInterval: 3000, // 信令重连间隔
    tunnelReconnect: true,           // 隧道自动重连
    tunnelReconnectInterval: 5000,   // 隧道重连间隔
    maxReconnectAttempts: 0,         // 0 = 无限
  },
});
```

**事件**:

| 事件 | 参数 | 说明 |
|------|------|------|
| `connection` | `(tunnel: Tunnel, peerId: string)` | 收到对方发起的连接 |
| `connected` | `(tunnel: Tunnel, peerId: string)` | `connect()` 成功 |
| `error` | `(err: Error)` | 全局错误 |
| `registered` | `()` | 在信令服务器注册成功 |
| `disconnected` | `()` | 与信令服务器断开 |
| `reconnecting` | `(attempt: number)` | 正在重连信令服务器 |
| `reconnected` | `()` | 信令服务器重连成功 |
| `tunnel-reconnecting` | `(peerId: string, attempt: number)` | 隧道正在重连 |
| `tunnel-reconnected` | `(peerId: string)` | 隧道重连成功 |

### `Tunnel`

| 方法 | 说明 |
|------|------|
| `send(data: Buffer \| Uint8Array \| string)` | 发送数据 |
| `close()` | 关闭隧道 |
| `isClosed()` | 是否已关闭 |

**事件**:

| 事件 | 参数 | 说明 |
|------|------|------|
| `data` | `(buf: Buffer)` | 收到数据 |
| `close` | `()` | 隧道关闭 |
| `error` | `(err: Error)` | 发生错误 |

### `SignalingServer`

```typescript
import { SignalingServer } from './lib/signaling_server';

const server = new SignalingServer({ port: 9876 });
await server.start();

// 查看在线数量
console.log(server.clientCount);

// 停止
await server.stop();
```

## 心跳机制

- 连接发起方每 **5 秒**发送 `PING`
- 接收方自动回复 `PONG`
- 双方 **15 秒**未收到任何消息则判定断线，自动关闭隧道并触发 `error` 事件

可通过构造参数自定义：

```typescript
new WebRTCTunnelClient({
  id: 'my-node',
  signalingUrl: 'ws://...',
  heartbeatInterval: 5000,  // 心跳间隔
  heartbeatTimeout: 15000,  // 超时时间
});
```

## 配对清理机制

信令服务器会跟踪客户端之间的配对关系：

- 当两个客户端开始建立连接时，服务器记录配对关系
- 当任一客户端断开时，服务器自动：
  1. 清理该客户端的所有配对记录
  2. 通知对方客户端已断开（`peer_disconnected` 消息）
  3. 对方收到通知后关闭隧道并取消重连

这确保了：
- 客户端重启使用相同 ID 可以正常重新配对
- 不会出现“幽灵”配对导致连接失败
- 双方都能及时感知对方断开

## 依赖说明

| 依赖 | 用途 | 打包情况 |
|------|------|----------|
| `ws` | WebSocket 信令通信 | ✅ 打包进单文件 |
| `node-datachannel` | WebRTC DataChannel | ❌ 保持外部依赖（原生模块） |

> 部署时，目标机器需安装 `node-datachannel`（`npm install` 即可），但 `ws` 已打包在内。
