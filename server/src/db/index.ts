import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'fs';
import path from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';
import dbConfig from '../config/config.json';


// 确保 db-data 目录存在
const dbDir = path.dirname(dbConfig.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建 SQLite 连接
const sqlite: DatabaseType = new Database(dbConfig.database.path);

// PRAGMA 性能优化
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -64000');  // 64MB
sqlite.pragma('temp_store = MEMORY');

// 创建 Drizzle ORM 实例
export const db = drizzle(sqlite, { schema });


/**
 * 默认配置项。
 * key: 配置键
 * value: JSON 序列化后的默认值
 * desc: 说明
 */
const DEFAULT_CONFIGS: Array<{ key: string; value: string; desc: string }> = [
  {
    key: 'clash_notify_disabled',
    value: JSON.stringify(false),
    desc: '关闭 clash 代理异常通知。false=开启通知，true=关闭通知',
  },
];


/**
 * 初始化数据库表结构和默认数据。
 * 使用事务确保原子性——要么全部成功，要么全部回滚。
 */
export function initDatabase() {
  console.log('正在初始化数据库...');

  const migrate = sqlite.transaction(() => {
    // 1. 创建 app_config 表
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        desc TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL
      )
    `);
    console.log('✓ app_config 表已就绪');

    // 2. 插入默认配置（仅当 key 不存在时）
    const insertStmt = sqlite.prepare(`
      INSERT OR IGNORE INTO app_config (key, value, desc, updatedAt)
      VALUES (@key, @value, @desc, @updatedAt)
    `);

    const now = new Date().toISOString();
    for (const item of DEFAULT_CONFIGS) {
      insertStmt.run({ ...item, updatedAt: now });
    }
    console.log('✓ 默认配置已写入');
  });

  try {
    migrate();
    console.log('✓ 数据库初始化完成');
  } catch (error) {
    console.error('✗ 数据库初始化失败:', error);
    throw new Error(`数据库初始化失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}


export { sqlite };
