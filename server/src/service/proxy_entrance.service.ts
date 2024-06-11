import { Inject, Provide } from '@midwayjs/core';
import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import net from 'net';
import { URL } from 'url';
import { proxyServerPort as port, webServerPort } from '../config/port.config';
import { ProxyHubService } from './proxy_hub.service';


// 防止重复启动
let httpServer: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;

@Provide()
export class ProxyEntranceService {

  @Inject()
  proxyHubService: ProxyHubService;


  startServer() {
    if (httpServer) return;

    /**
     * http 代理。
     */
    httpServer = http.createServer((clientReq, clientRes) => {
      try {
        /**
         * 转发到内部 web 服务端口。
         */
        const gotoWebServer = clientReq.url.startsWith('/');
        if (gotoWebServer) {
          const webProxyReq = http.request({ ...clientReq, port: webServerPort }, (proxyResp) => {
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

        this.proxyHubService.dispenseHttp(clientReq, clientRes);
      } catch (_) { }
    });

    /**
     * https 代理。
     */
    httpServer.on('connect', (req, clientSocket, head) => {
      try {
        this.proxyHubService.dispenseHttps(req, clientSocket, head);
      } catch (_) { }
    });

    /**
     * 端口绑定。
     */
    httpServer.listen(port, () => {
      console.log(`http 代理服务: http://127.0.0.1:${port}`);
    });
  }




}
