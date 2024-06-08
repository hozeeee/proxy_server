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
    // const proxy = httpProxy.createProxyServer({});
    // proxy.on('error', (err, req, res) => {
    //   res.writeHead(500, { 'Content-Type': 'text/plain' });
    //   res.end('An error occurred: ' + err.message);
    // });
    httpServer = http.createServer((clientReq, clientRes) => {
      try {
        /**
         * 转发到内部服务端口。
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

        console.log('======clientReq.url: ', clientReq.url) // TODO:debug
        const parsedUrl = new URL(clientReq.url);

        this.proxyHubService.dispenseHttp(clientReq, clientRes);

        // const proxyReq = http.request({ ...clientReq }, (proxyResp) => {
        //   res.writeHead(proxyResp.statusCode, proxyResp.headers);
        //   proxyResp.pipe(res);

        //   // // 手动处理数据传输
        //   // clientSocket.on('data', (chunk) => {
        //   //   serverSocket.write(chunk);
        //   // });

        //   // clientSocket.on('end', () => {
        //   //   serverSocket.end();
        //   // });

        // });
        // clientReq.pipe(proxyReq);

        // proxyReq.on('error', (err) => {
        //   res.writeHead(500);
        //   res.end(`服务器错误: ${err.message}`);
        // });
      } catch (_) { }
    });

    /**
     * https 代理。
     */
    httpServer.on('connect', (req, clientSocket, head) => {
      try {
        const { port, hostname } = new URL(`http://${req.url}`);
        const version = `HTTP/${req.httpVersion}`


        this.proxyHubService.dispenseHttps(req, clientSocket, head);

        // // 创建到目标服务器的连接
        // const serverSocket = net.connect(+port, hostname, () => {
        //   clientSocket.write(`${version} 200 Connection Established\r\n` +
        //     // 'Proxy-agent: Node.js-Proxy\r\n' +
        //     '\r\n');
        //   serverSocket.write(head);
        //   serverSocket.pipe(clientSocket);
        //   clientSocket.pipe(serverSocket);
        // });

        // serverSocket.on('error', (err) => {
        //   clientSocket.write(`${version} 500 ${err.message}\r\n`);
        //   clientSocket.end();
        // });
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
