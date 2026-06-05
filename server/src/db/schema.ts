import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 运行配置表 (key-value)
 *
 * 存储项目的运行时配置，value 为 JSON 序列化后的字符串。
 * 通过 initDatabase() 在首次启动时插入默认值。
 */
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),          // JSON 序列化后的值
  desc: text('desc').notNull().default(''),  // 配置说明（方便人类阅读）
  updatedAt: text('updatedAt').notNull(),   // ISO 时间戳
});
