import type { PairSession } from './pair_registry';

/** 状态页 / 健康检查所需的运行时快照 */
export interface ServerStatus {
  status: 'ok';
  /** 已注册的客户端数量 */
  clients: number;
  /** 已配对（处于建连阶段或已建连）的轮次数量 */
  pairs: number;
  /** 进程运行秒数 */
  uptime: number;
  timestamp: string;
}

/** 收集 JSON 形式的服务器状态，供 `GET /health` 与 `GET /` 复用 */
export function buildStatus(clientCount: number, pairCount: number): ServerStatus {
  return {
    status: 'ok',
    clients: clientCount,
    pairs: pairCount,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

/** 转义 HTML 特殊字符，防止客户端 id 注入状态页 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/** 渲染在线客户端列表 */
function renderClientList(clientIds: string[]): string {
  if (clientIds.length === 0) return '<p class="empty">暂无客户端连接</p>';
  return `<ul class="list">${clientIds
    .map((id) => `<li>${escapeHtml(id)}</li>`)
    .join('')}</ul>`;
}

/** 渲染配对列表，标注角色与轮次编号 */
function renderPairList(pairs: PairSession[]): string {
  if (pairs.length === 0) return '<p class="empty">暂无配对</p>';
  return `<ul class="list">${pairs
    .map(
      (p) =>
        `<li>${escapeHtml(p.initiatorId)} <span class="arrow">⇄</span> ${escapeHtml(p.answererId)}` +
        `<span class="tag">#${p.session}</span>` +
        `<span class="hint">initiator: ${escapeHtml(p.initiatorId)}</span></li>`
    )
    .join('')}</ul>`;
}

/**
 * 渲染浏览器可读的 HTML 状态页。
 * 与 `GET /health` 共用同一份 `ServerStatus`，避免两处数据口径不一致。
 */
export function renderStatusPage(opts: {
  status: ServerStatus;
  wsEndpoint: string;
  clientIds: string[];
  pairs: PairSession[];
}): string {
  const { status, wsEndpoint, clientIds, pairs } = opts;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebRTC 信令服务器</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #333; }
    h1 { color: #1a1a1a; }
    h3 { margin-bottom: 8px; color: #444; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 14px; font-weight: 500; background: #d4edda; color: #155724; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    td { padding: 12px 8px; border-bottom: 1px solid #eee; }
    td:first-child { color: #666; width: 160px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .list { list-style: none; padding: 0; }
    .list li { padding: 8px 12px; background: #f8f9fa; margin-bottom: 4px; border-radius: 4px; font-family: monospace; font-size: 13px; }
    .arrow { color: #0a7; margin: 0 6px; }
    .tag { background: #e7f1ff; color: #0b5ed7; border-radius: 3px; padding: 1px 5px; margin-left: 8px; font-size: 11px; }
    .hint { color: #999; margin-left: 8px; font-size: 11px; }
    .empty { color: #999; font-style: italic; }
    .section { margin-top: 24px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 13px; }
  </style>
</head>
<body>
  <h1>WebRTC 信令服务器</h1>
  <span class="status">运行中</span>

  <table>
    <tr><td>在线客户端</td><td><strong>${status.clients}</strong></td></tr>
    <tr><td>已配对</td><td><strong>${status.pairs}</strong></td></tr>
    <tr><td>运行时间</td><td>${status.uptime}s</td></tr>
    <tr><td>WebSocket 端点</td><td><code>${escapeHtml(wsEndpoint)}</code></td></tr>
  </table>

  <div class="section">
    <h3>已注册客户端</h3>
    ${renderClientList(clientIds)}
  </div>

  <div class="section">
    <h3>配对状态</h3>
    ${renderPairList(pairs)}
  </div>

  <div class="footer">
    <p>API: <code>GET /health</code> 返回 JSON 状态</p>
    <p>下载: <code>GET /client.js</code> 获取客户端脚本</p>
    <p>最后更新: ${status.timestamp}</p>
  </div>

  <script>
    // 每 5 秒自动刷新
    setTimeout(() => location.reload(), 5000);
  </script>
</body>
</html>`;
}
