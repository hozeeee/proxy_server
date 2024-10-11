import { Context, Inject, Provide } from '@midwayjs/core';
import http from 'http';
import { proxyServerPort, serverPort } from '../config/port_config.json';
import { ProxyHubService } from './proxy_hub.service';
import { type IDeviceId, DEVICE_LIST } from '../common/device_config';
import { ILogger } from '@midwayjs/logger';


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

}
