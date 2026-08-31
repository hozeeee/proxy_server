import type { PairSession } from './pair_registry';
import { STAGE_LABELS } from './protocol';
import type { StageEvent } from './stage_log';

/** 状态页上的一个在线客户端及其最新上报阶段 */
export interface ClientView {
  id: string;
  /** 该客户端最后一次上报的阶段，未上报过则为 null */
  latestStage: StageEvent | null;
}

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

/** 状态页上的一个客户端下载入口 */
export interface ClientDownload {
  /** HTTP 路径，如 /client.js */
  path: string;
  /** 该版本的用途说明 */
  label: string;
  /** 脚本字节数，0 表示构建时未嵌入 */
  bytes: number;
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

/** 渲染在线客户端列表，并标出各自最后上报的阶段（一眼看出谁卡住了） */
function renderClientList(clients: ClientView[]): string {
  if (clients.length === 0) return '<p class="empty">暂无客户端连接</p>';
  return `<ul class="list">${clients
    .map(({ id, latestStage }) => {
      const stage = latestStage
        ? `<span class="tag">${escapeHtml(STAGE_LABELS[latestStage.stage] ?? latestStage.stage)}</span>` +
          `<span class="hint">${formatClock(latestStage.at)}${
            latestStage.detail ? ` · ${escapeHtml(latestStage.detail)}` : ''
          }</span>`
        : '<span class="hint">无阶段上报</span>';
      return `<li>${escapeHtml(id)}${stage}</li>`;
    })
    .join('')}</ul>`;
}

/** 只取时分秒：状态页面向排查场景，日期信息意义不大 */
function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 渲染客户端阶段上报的时间线（新 → 旧）。
 * 双方的推进过程在同一张表里对齐，卡在哪一步、谁先掉队一目了然。
 */
function renderStageList(stages: StageEvent[]): string {
  if (stages.length === 0) {
    return '<p class="empty">暂无阶段上报（客户端可能为旧版本，或已用 --no-report 关闭上报）</p>';
  }
  return `<ul class="list">${stages
    .map((e) => {
      const target = e.peerId ? ` <span class="arrow">→</span> ${escapeHtml(e.peerId)}` : '';
      const round = e.session ? `<span class="tag">#${e.session}</span>` : '';
      const detail = e.detail ? `<span class="hint">${escapeHtml(e.detail)}</span>` : '';
      return (
        `<li><span class="time">${formatClock(e.at)}</span> ${escapeHtml(e.clientId)}${target}` +
        `<span class="stage">${escapeHtml(STAGE_LABELS[e.stage] ?? e.stage)}</span>${round}${detail}</li>`
      );
    })
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

/** 人类可读的体积，方便判断下载的是哪一版（免安装版明显更大） */
function formatBytes(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 渲染客户端下载入口。
 * 两版并列展示，使用者按自己机器有没有编译环境自行取用。
 */
function renderDownloadList(downloads: ClientDownload[]): string {
  if (downloads.length === 0) return '<p class="empty">无可下载的客户端脚本</p>';
  return `<ul class="list">${downloads
    .map(({ path, label, bytes }) =>
      bytes > 0
        ? `<li><a href="${escapeHtml(path)}">${escapeHtml(path)}</a>` +
          `<span class="tag">${formatBytes(bytes)}</span>` +
          `<span class="hint">${escapeHtml(label)}</span></li>`
        : `<li>${escapeHtml(path)}<span class="hint">未嵌入（构建时缺少该产物）</span></li>`
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
  clients: ClientView[];
  pairs: PairSession[];
  stages: StageEvent[];
  /** 可下载的客户端脚本；缺省则不渲染该区块 */
  downloads?: ClientDownload[];
}): string {
  const { status, wsEndpoint, clients, pairs, stages, downloads = [] } = opts;
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
    .list li a { color: #0b5ed7; text-decoration: none; }
    .list li a:hover { text-decoration: underline; }
    .arrow { color: #0a7; margin: 0 6px; }
    .tag { background: #e7f1ff; color: #0b5ed7; border-radius: 3px; padding: 1px 5px; margin-left: 8px; font-size: 11px; }
    .stage { background: #eef7ee; color: #17692a; border-radius: 3px; padding: 1px 5px; margin-left: 8px; font-size: 11px; }
    .time { color: #888; margin-right: 8px; }
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
    ${renderClientList(clients)}
  </div>

  <div class="section">
    <h3>配对状态</h3>
    ${renderPairList(pairs)}
  </div>

  <div class="section">
    <h3>阶段上报时间线（最近 ${stages.length} 条）</h3>
    ${renderStageList(stages)}
  </div>

  ${
    downloads.length > 0
      ? `<div class="section">
    <h3>客户端下载</h3>
    ${renderDownloadList(downloads)}
  </div>`
      : ''
  }

  <div class="footer">
    <p>API: <code>GET /health</code> 返回 JSON 状态</p>
    <p>排查: <code>GET /stages</code> 返回完整阶段上报时间线（JSON）</p>
    <p>最后更新: ${status.timestamp}</p>
  </div>

  <script>
    // 每 5 秒自动刷新
    setTimeout(() => location.reload(), 5000);
  </script>
</body>
</html>`;
}
