import { Context, Inject, Provide } from '@midwayjs/core';
import http from 'http';
import fs from 'fs-extra';
import { join, resolve } from 'path';
import { proxyServerPort, serverPort, whistleProxyPort } from '../config/port_config.json';
import { ProxyHubService } from './proxy_hub.service';
import { type IDeviceId, DEVICE_LIST } from '../common/device_config';
import { ILogger } from '@midwayjs/logger';
import { execSync } from 'child_process';


/**
 * 说明:
 *   http 代理服务的入口。
 *   这里会启动多个服务，每个代理设备映射到单独的端口上。
 */


/**
 * 防止重复启动.
 */
const _httpServerMap = new Map<IDeviceId, http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>>();

@Provide()
export class HttpProxyEntranceService {
  @Inject()
  proxyHubService: ProxyHubService;
  @Inject()
  logger: ILogger;

  private httpServerMap = _httpServerMap;


  /**
   * 项目启动时，启动所有服务。
   */
  startServers() {
    for (const { id: deviceId } of DEVICE_LIST) {
      this.startSingleServer(deviceId);
    }
    this.startSingleServer('server_local');
  }


  /**
   * 重启单个服务。
   */
  restartServer(deviceId: IDeviceId) {
    this.startSingleServer(deviceId, true);
  }


  /**
   * 启动单个服务。
   */
  private startSingleServer(deviceId: IDeviceId, restart = false) {
    try {
      let _port = DEVICE_LIST.find(i => i.id === deviceId)?.port;
      if (deviceId === 'server_local') _port = proxyServerPort;
      if (!_port) return;

      const oldServer = this.httpServerMap.get(deviceId);
      if (oldServer) {
        if (!restart) return;
        else {
          oldServer.close();
          this.httpServerMap.delete(deviceId);
        }
      }
      /**
       * http 代理。
       */
      const _httpServer = http.createServer((clientReq, clientRes) => {
        try {
          /**
           * 转发到内部 web 服务端口。
           */
          if (deviceId === 'server_local') {
            const gotoWebServer = clientReq.url.startsWith('/');
            if (gotoWebServer) {
              const webProxyReq = http.request(
                `http://127.0.0.1:${serverPort}${clientReq.url}`,
                { ...clientReq, },
                (proxyResp) => {
                  clientRes.writeHead(proxyResp.statusCode, proxyResp.headers);
                  proxyResp.pipe(clientRes);
                });
              clientReq.pipe(webProxyReq);
              webProxyReq.on('error', (err) => {
                clientRes.writeHead(500);
                clientRes.end(`服务器错误: ${err.message}`);
              });
              return;
            }
          }

          this.proxyHubService.dispenseHttp(deviceId, clientReq, clientRes);
        } catch (_) { }
      });

      /**
       * https 代理。
       */
      _httpServer.on('connect', (req, clientSocket, head) => {
        try {
          this.proxyHubService.dispenseHttps(deviceId, req, clientSocket, head);
        } catch (_) { }
      });

      /**
       * 端口绑定。
       */
      _httpServer.listen(_port, '0.0.0.0', () => {
        console.log(`http-proxy-server(${deviceId}):    http://127.0.0.1:${_port}`);
        this.httpServerMap.set(deviceId, _httpServer);
      });

    } catch (_) { }

  }


  /**
   * 启动 whistle 代理。
   */
  async startWhistleProxyServer() {
    // 先停止
    try {
      const command = `w2 stop`;
      execSync(command);
    } catch (_) { }
    console.log('[startWhistleProxyServer] 已停止旧 whistle 进程(如有)');
    await new Promise(resolve => setTimeout(resolve, 1000));
    // 启动，让他生成配置文件
    try {
      const command = `w2 start -p ${whistleProxyPort}`;
      execSync(command);
      console.log(`[startWhistleProxyServer] 启动 whistle 成功:  http://127.0.0.1:${whistleProxyPort}`);
    } catch (err) { console.log(`[startWhistleProxyServer] 启动 whistle 失败: ${err?.message || err}`); }
    /**
     * 检测文件是否存在 (文件不存在就加属性会导致被覆盖)。
     * 踩坑记录:
     *   1. fs 的文件操作不能写 "~/.WhistleAppData/.whistle/properties" 这样的路径，"~"无法正确获取到该路径。
     */
    const dir = '/root/.WhistleAppData/.whistle/properties';
    const filename = join(dir, 'properties');
    let isExist = false;
    while (!isExist) {
      isExist = fs.existsSync(filename);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    // 修改配置文件，默认开启 https 抓包
    try {
      let data: Record<string, any> = {};
      try {
        const json = fs.readFileSync(filename, { encoding: 'utf-8' }) || '{}';
        data = JSON.parse(json);
      } catch (_) { }
      data.interceptHttpsConnects = true;
      fs.writeFileSync(filename, JSON.stringify(data));
    } catch (__) { }
    // 重启
    try {
      const command = `w2 restart`;
      execSync(command);
      console.log(`[startWhistleProxyServer] 重启 whistle 成功`); // TODO:del
    } catch (err) { console.log(`[startWhistleProxyServer] 重启 whistle 失败: ${err?.message || err}`); }
  }

}
