/**
 * 日志查看器控制器
 *
 * 提供 /log-viewer 页面以及相关 API：
 * - GET /log-viewer              返回 HTML 页面
 * - GET /api/logs/files          获取日志文件列表
 * - GET /api/logs/file           读取日志文件内容（?name=xxx&lines=500&offset=0）
 *
 * 安全说明：
 * - 只允许访问 LOG_BASE_DIR 目录下的文件，不允许路径穿越
 * - 只允许访问普通文件，不允许访问目录
 */

import { Controller, Get, Inject, ContentType, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import path from 'path';
import fs from 'fs';

/** 日志文件根目录（只允许访问此目录下的文件） */
const LOG_BASE_DIR = path.resolve(__dirname, '../../logs/my-midway-project');

/** 单次返回最大行数 */
const MAX_LINES = 5000;
const DEFAULT_LINES = 500;

interface LogFileInfo {
  name: string;
  size: number;
  sizeText: string;
  mtime: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 验证文件名是否安全（只允许访问 LOG_BASE_DIR 下的直接子文件）。
 */
function safeResolvePath(fileName: string): string | null {
  // 禁止包含路径分隔符或 .. 的文件名
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return null;
  }
  const resolved = path.resolve(LOG_BASE_DIR, fileName);
  // 二次校验：确保解析后的路径仍在 LOG_BASE_DIR 下
  if (!resolved.startsWith(LOG_BASE_DIR + path.sep) && resolved !== LOG_BASE_DIR) {
    return null;
  }
  return resolved;
}

@Controller('/')
export class LogViewerController {
  @Inject()
  ctx: Context;

  /**
   * 返回日志查看器 HTML 页面。
   */
  @Get('/log-viewer')
  @ContentType('text/html')
  async logViewerPage() {
    const htmlPath = path.join(__dirname, '../../publish/log-viewer.html');
    return fs.readFileSync(htmlPath, 'utf-8');
  }

  /**
   * 获取日志文件列表。
   */
  @Get('/api/logs/files')
  async getLogFiles(): Promise<{ files: LogFileInfo[]; logDir: string }> {
    if (!fs.existsSync(LOG_BASE_DIR)) {
      return { files: [], logDir: LOG_BASE_DIR };
    }
    const entries = fs.readdirSync(LOG_BASE_DIR, { withFileTypes: true });
    const files: LogFileInfo[] = entries
      .filter(e => e.isFile())
      .map(e => {
        const fullPath = path.join(LOG_BASE_DIR, e.name);
        const stat = fs.statSync(fullPath);
        return {
          name: e.name,
          size: stat.size,
          sizeText: formatSize(stat.size),
          mtime: stat.mtime.toISOString(),
        };
      })
      // 按修改时间倒序，最新的排前面
      .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

    return { files, logDir: path.basename(LOG_BASE_DIR) };
  }

  /**
   * 读取日志文件内容。
   * - name:   文件名（必填，不含路径分隔符）
   * - lines:  返回行数（默认 500，最大 5000），设为 -1 则返回全部内容
   * - offset: 起始行偏移（默认 0）
   * - tail:   是否从尾部读取（默认 true，即取最后 N 行）
   */
  @Get('/api/logs/file')
  async getLogFileContent(
    @Query('name') name: string,
    @Query('lines') lines?: string,
    @Query('offset') offset?: string,
    @Query('tail') tail?: string
  ): Promise<{
    name: string;
    totalLines: number;
    startLine: number;
    endLine: number;
    content: string;
    truncated: boolean;
    fileSize: number;
  }> {
    const filePath = safeResolvePath(name);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      this.ctx.status = 404;
      return {
        name: name || '',
        totalLines: 0,
        startLine: 0,
        endLine: 0,
        content: '',
        truncated: false,
        fileSize: 0,
      };
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const allLines = rawContent.split('\n');
    // 去掉末尾空行（文件末尾换行符导致的空元素）
    if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
      allLines.pop();
    }
    const totalLines = allLines.length;

    let parsedLines = parseInt(lines, 10);
    if (isNaN(parsedLines)) parsedLines = DEFAULT_LINES;
    const isTail = tail !== 'false'; // 默认从尾部读取
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    let startLine: number;
    let endLine: number;
    let truncated = false;

    if (parsedLines === -1) {
      // 返回全部
      startLine = 0;
      endLine = totalLines;
    } else if (isTail) {
      // 取最后 N 行
      const limit = Math.min(parsedLines, MAX_LINES);
      endLine = totalLines - parsedOffset;
      startLine = Math.max(0, endLine - limit);
      truncated = startLine > 0;
    } else {
      // 从头开始取 N 行
      const limit = Math.min(parsedLines, MAX_LINES);
      startLine = parsedOffset;
      endLine = Math.min(totalLines, startLine + limit);
      truncated = endLine < totalLines;
    }

    const content = allLines.slice(startLine, endLine).join('\n');

    return {
      name,
      totalLines,
      startLine: startLine + 1, // 1-based 展示
      endLine,
      content,
      truncated,
      fileSize,
    };
  }
}
