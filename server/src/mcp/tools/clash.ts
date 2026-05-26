import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  checkClashNode,
  getClashInfo,
  isRunningClash,
} from '../../common/clash_controller';
import configGroups from '../../config/clash.config.json';


export function registerClashTools(server: McpServer) {

  // ── list_clash_configs ────────────────────────────────────────────────────
  server.registerTool(
    'list_clash_configs',
    {
      description: '获取所有 clash 分组配置及各子节点的端口、名称等信息。',
    },
    async () => {
      const result = configGroups.map(group => ({
        groupId: group.groupId,
        group: group.group,
        configUrl: group.configUrl,
        children: group.children.map(c => ({
          name: c.name,
          port: c.port,
          'socks-port': c['socks-port'],
          running: isRunningClash(c.port),
        })),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );


  // ── check_clash_node ──────────────────────────────────────────────────────
  server.registerTool(
    'check_clash_node',
    {
      description: '测试指定 clash 节点的延迟（需要该 clash 实例正在运行）。',
      inputSchema: {
        port: z.number().describe('clash 实例的 HTTP 代理端口，如 8630、8650 等'),
        targetUrl: z.string().optional().describe('测试目标 URL，默认使用内置地址'),
      },
    },
    async ({ port, targetUrl }) => {
      const res = await checkClashNode(port, targetUrl);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  );


  // ── get_clash_info ────────────────────────────────────────────────────────
  server.registerTool(
    'get_clash_info',
    {
      description: '查询 clash 实例的运行时信息，可选类型：version（版本）、configs（配置）、proxies（代理节点列表）、rules（规则）、connections（连接）、dns/query（DNS 查询）。注意：logs 和 traffic 为流式接口，此处不支持。',
      inputSchema: {
        port: z.number().describe('clash 实例的 HTTP 代理端口'),
        type: z.enum(['version', 'configs', 'proxies', 'rules', 'connections', 'dns/query']).describe('查询的信息类型'),
        dnsName: z.string().optional().describe('DNS 查询的域名（仅 type 为 dns/query 时需要）'),
        dnsType: z.enum(['A', 'AAAA', 'CNAME']).optional().describe('DNS 记录类型（仅 type 为 dns/query 时使用，默认 A）'),
      },
    },
    async ({ port, type, dnsName, dnsType }) => {
      const res = await getClashInfo(port, type as any, dnsName, dnsType as any);
      if (res === null) {
        return { content: [{ type: 'text', text: `clash 实例 (port=${port}) 未运行或查询失败` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    },
  );


  // ── is_clash_running ──────────────────────────────────────────────────────
  server.registerTool(
    'is_clash_running',
    {
      description: '查询指定端口的 clash 实例是否正在运行（通过 pm2 检测）。',
      inputSchema: { port: z.number().describe('clash 实例的 HTTP 代理端口') },
    },
    async ({ port }) => {
      const running = isRunningClash(port);
      return { content: [{ type: 'text', text: `clash (port=${port}) 运行状态: ${running}` }] };
    },
  );

}
