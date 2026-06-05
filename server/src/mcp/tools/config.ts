/**
 * MCP 配置管理工具
 *
 * 提供对 app_config 表的读写能力。
 *
 * 安全策略：
 *   - list / get 为只读操作，无限制
 *   - set 操作对"安全字段"直接执行，对"敏感字段"在返回值中提示 AI 向用户确认
 *
 * 安全字段列表在 SAFE_KEYS 中维护。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAllConfigs, getConfig, setConfig } from '../../service/app_config.service';


/**
 * 允许 MCP 直接修改的安全字段。
 * 不在此列表中的 key 修改时，tool 会返回提示，建议 AI 向用户确认后再调用。
 */
const SAFE_KEYS = new Set<string>([
  'clash_notify_disabled',
]);


export function registerConfigTools(server: McpServer) {

  // ── list_app_configs ──────────────────────────────────────────────────────
  server.registerTool(
    'list_app_configs',
    {
      description: '列出所有运行配置项（key、value、说明、更新时间）。只读操作，无副作用。',
    },
    async () => {
      const all = getAllConfigs();
      return { content: [{ type: 'text', text: JSON.stringify(all, null, 2) }] };
    },
  );


  // ── get_app_config ────────────────────────────────────────────────────────
  server.registerTool(
    'get_app_config',
    {
      description: '获取指定配置项的详细信息（value、desc、updatedAt）。只读操作，无副作用。',
      inputSchema: {
        key: z.string().describe('配置项的 key，如 clash_notify_disabled'),
      },
    },
    async ({ key }) => {
      const cfg = getConfig(key);
      if (!cfg) {
        return { content: [{ type: 'text', text: `配置项 "${key}" 不存在` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ key, ...cfg }, null, 2) }] };
    },
  );


  // ── set_app_config ────────────────────────────────────────────────────────
  server.registerTool(
    'set_app_config',
    {
      description: [
        '修改指定配置项的值。',
        '',
        '## 安全分级',
        '以下字段属于"安全字段"，可以直接修改：',
        [...SAFE_KEYS].map(k => `- ${k}`).join('\n'),
        '',
        '其他字段属于"敏感字段"，修改前**必须**先向用户展示将要修改的 key、旧值和新值，并获得用户明确确认后才能调用本 tool。',
        '',
        '## 注意事项',
        '- value 会经过 JSON.parse 反序列化，因此传入 JSON 兼容值即可（如 true/false/数字/字符串）。',
        '- 返回值包含 oldValue 和 newValue，方便对比。',
      ].join('\n'),
      inputSchema: {
        key: z.string().describe('配置项的 key'),
        value: z.any().describe('新的配置值（会被 JSON 序列化后存储）'),
        confirm: z.boolean().optional().describe(
          '是否已确认修改。对于敏感字段，必须先向用户确认后再传 true'
        ),
      },
    },
    async ({ key, value, confirm }) => {
      const isSafe = SAFE_KEYS.has(key);

      // 敏感字段需要确认
      if (!isSafe && confirm !== true) {
        const old = getConfig(key);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              warning: `"${key}" 是敏感字段，修改前请向用户确认`,
              key,
              oldValue: old?.value ?? '(不存在)',
              newValue: value,
              hint: '用户确认后，请重新调用 set_app_config 并传 confirm: true',
            }, null, 2),
          }],
        };
      }

      const result = setConfig(key, value);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            key,
            oldValue: result.oldValue,
            newValue: result.newValue,
          }, null, 2),
        }],
      };
    },
  );

}
