/**
 * 应用运行配置服务
 *
 * 提供对 app_config 表的 CRUD 操作，供业务层和 MCP 工具调用。
 */

import { sqlite } from '../db';


/**
 * 获取指定配置项的值（已反序列化）。
 * 返回 null 表示 key 不存在。
 */
export function getConfig(key: string): { value: any; desc: string; updatedAt: string } | null {
  const row = sqlite.prepare(
    'SELECT value, desc, updatedAt FROM app_config WHERE key = ?'
  ).get(key) as { value: string; desc: string; updatedAt: string } | undefined;

  if (!row) return null;

  return {
    value: safeJsonParse(row.value),
    desc: row.desc,
    updatedAt: row.updatedAt,
  };
}


/**
 * 设置指定配置项。
 * - 如果 key 已存在，则更新 value（和可选的 desc）
 * - 如果 key 不存在，则新增
 */
export function setConfig(key: string, value: any, desc?: string): {
  oldValue: any;
  newValue: any;
} {
  const serialized = JSON.stringify(value);
  const now = new Date().toISOString();

  // 读取旧值
  const existing = getConfig(key);
  const oldValue = existing?.value ?? null;

  if (existing && desc === undefined) {
    // 保留原有 desc
    desc = sqlite.prepare('SELECT desc FROM app_config WHERE key = ?').get(key) as any;
    desc = (desc as any)?.desc ?? '';
  }

  sqlite.prepare(`
    INSERT INTO app_config (key, value, desc, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      desc = COALESCE(excluded.desc, app_config.desc),
      updatedAt = excluded.updatedAt
  `).run(key, serialized, desc ?? '', now);

  return { oldValue, newValue: value };
}


/**
 * 获取所有配置项。
 */
export function getAllConfigs(): Record<string, { value: any; desc: string; updatedAt: string }> {
  const rows = sqlite.prepare('SELECT key, value, desc, updatedAt FROM app_config').all() as Array<{
    key: string;
    value: string;
    desc: string;
    updatedAt: string;
  }>;

  const result: Record<string, { value: any; desc: string; updatedAt: string }> = {};
  for (const row of rows) {
    result[row.key] = {
      value: safeJsonParse(row.value),
      desc: row.desc,
      updatedAt: row.updatedAt,
    };
  }
  return result;
}


/**
 * 判断 clash 代理异常通知是否已关闭。
 * 返回 true 表示已关闭通知（不发送）。
 */
export function isClashNotifyDisabled(): boolean {
  const cfg = getConfig('clash_notify_disabled');
  if (!cfg) return false;
  return cfg.value === true;
}


// ── 内部工具 ──────────────────────────────────────────────────────────────────

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
