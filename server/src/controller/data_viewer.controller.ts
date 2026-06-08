/**
 * 数据查看器控制器
 *
 * 提供 /data-viewer 页面以及相关 API：
 * - GET /data-viewer              返回 HTML 页面
 * - GET /api/data/summary         汇总各表行数
 * - GET /api/data/tables          获取所有表名列表
 * - GET /api/data/table/:name     查询指定表数据（?limit=N）
 */

import { Controller, Get, Inject, ContentType, Param, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { sqlite } from '../db';
import path from 'path';
import fs from 'fs';

const DEFAULT_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, 1000);
}

/**
 * 获取数据库中所有用户表名。
 */
function getUserTableNames(): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}


@Controller('/')
export class DataViewerController {
  @Inject()
  ctx: Context;

  /**
   * 返回数据查看器 HTML 页面。
   */
  @Get('/data-viewer')
  @ContentType('text/html')
  async dataViewerPage() {
    const htmlPath = path.join(__dirname, '../../publish/data-viewer.html');
    return fs.readFileSync(htmlPath, 'utf-8');
  }

  /**
   * 获取所有表名。
   */
  @Get('/api/data/tables')
  async getTables(): Promise<{ tables: string[] }> {
    return { tables: getUserTableNames() };
  }

  /**
   * 汇总各表行数。
   */
  @Get('/api/data/summary')
  async getSummary(): Promise<Record<string, number>> {
    const tables = getUserTableNames();
    const summary: Record<string, number> = {};
    for (const table of tables) {
      const row = sqlite
        .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
        .get() as { count: number };
      summary[table] = row.count;
    }
    return summary;
  }

  /**
   * 查询指定表数据。
   */
  @Get('/api/data/table/:name')
  async getTableData(
    @Param('name') name: string,
    @Query('limit') limit?: string
  ): Promise<{ table: string; count: number; rows: any[] }> {
    const tables = getUserTableNames();
    if (!tables.includes(name)) {
      this.ctx.status = 404;
      return { table: name, count: 0, rows: [] };
    }

    const parsedLimit = parseLimit(limit);
    const rows = sqlite
      .prepare(`SELECT * FROM "${name}" LIMIT ?`)
      .all(parsedLimit);

    return { table: name, count: rows.length, rows };
  }
}
