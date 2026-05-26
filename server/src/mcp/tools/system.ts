import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { isRunningClash, getFlatClashConfigList } from '../../common/clash_controller';
import { serverPort, proxyServerPort, nativeWsPort, chiiPort, whistleProxyPort, mcpHttpPort } from '../../config/port_config.json';
import deviceList from '../../config/device_list.json';
import configGroups from '../../config/clash.config.json';


const BASE_URL = `http://127.0.0.1:${serverPort}`;


export function registerSystemTools(server: McpServer) {

  // ── get_port_config ───────────────────────────────────────────────────────
  server.registerTool(
    'get_port_config',
    {
      description: '获取服务各端口的配置信息，包括主服务端口、代理端口、WebSocket 端口等。',
    },
    async () => {
      const config = {
        serverPort,
        proxyServerPort,
        nativeWsPort,
        chiiPort,
        whistleProxyPort,
        mcpHttpPort,
      };
      return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
    },
  );


  // ── get_server_status ─────────────────────────────────────────────────────
  server.registerTool(
    'get_server_status',
    {
      description: '获取服务整体状态概览：各代理设备在线情况、clash 实例运行情况等汇总信息。',
    },
    async () => {
      // 设备列表（通过 HTTP API 获取实时状态）
      let devices: any[] = [];
      try {
        const res = await axios.get(`${BASE_URL}/api/device/list`);
        devices = res.data;
      } catch (_) {
        // Midway 服务未启动时忽略
      }

      // clash 实例运行状态
      const clashNodes = getFlatClashConfigList().map(c => ({
        name: c.name,
        port: c.port,
        running: isRunningClash(c.port),
      }));
      const clashRunningCount = clashNodes.filter(n => n.running).length;

      // 设备在线数（不含 server_local 和 clash）
      const onlineDeviceCount = devices.filter(d =>
        d.id !== 'server_local' && !d.id.startsWith('clash_') && d.usable
      ).length;
      const totalDeviceCount = deviceList.length;

      const summary = {
        serverPort,
        devices: {
          total: totalDeviceCount,
          online: onlineDeviceCount,
        },
        clash: {
          total: clashNodes.length,
          running: clashRunningCount,
          groups: configGroups.map(g => ({
            groupId: g.groupId,
            children: g.children.map(c => ({
              name: c.name,
              port: c.port,
              running: clashNodes.find(n => n.port === c.port)?.running ?? false,
            })),
          })),
        },
        deviceList: devices,
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

}
