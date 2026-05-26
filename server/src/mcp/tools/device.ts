import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';
import { serverPort } from '../../config/port_config.json';


const BASE_URL = `http://127.0.0.1:${serverPort}`;


export function registerDeviceTools(server: McpServer) {

  // ── list_devices ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_devices',
    {
      description: '获取所有代理设备列表，包括在线状态、端口、延迟等信息。可选是否测试 clash 节点延迟。',
      inputSchema: { withClashDelay: z.boolean().optional().describe('是否测试 clash 节点延迟，默认 false') },
    },
    async ({ withClashDelay }) => {
      const url = withClashDelay
        ? `${BASE_URL}/api/device/list_with_delay`
        : `${BASE_URL}/api/device/list`;
      const res = await axios.get(url);
      return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
    },
  );


  // ── check_device ──────────────────────────────────────────────────────────
  server.registerTool(
    'check_device',
    {
      description: '查询指定设备是否可用（在线且端口正常）。',
      inputSchema: { deviceId: z.string().describe('设备 ID，如 server_local / clash_8630 / local_test 等') },
    },
    async ({ deviceId }) => {
      const res = await axios.get(`${BASE_URL}/api/device/usable`, { params: { device_id: deviceId } });
      return { content: [{ type: 'text', text: `设备 ${deviceId} 可用状态: ${res.data}` }] };
    },
  );


  // ── get_device_port ───────────────────────────────────────────────────────
  server.registerTool(
    'get_device_port',
    {
      description: '查询指定设备的代理端口。如果设备不可用则返回 0。',
      inputSchema: { deviceId: z.string().describe('设备 ID，如 server_local / clash_8630 / local_test 等') },
    },
    async ({ deviceId }) => {
      const res = await axios.get(`${BASE_URL}/api/device/port`, { params: { device_id: deviceId } });
      return { content: [{ type: 'text', text: `设备 ${deviceId} 端口: ${res.data}` }] };
    },
  );

}
