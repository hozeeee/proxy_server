import { App, Provide } from '@midwayjs/core';
import { Application as SocketApplication } from '@midwayjs/socketio';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import type { ServerResponse, IncomingMessage, RequestOptions, } from 'http';
import type { Duplex } from 'stream';
import { DEVICE_LIST } from '../socket/forward_end.controller';

/**
 * 说明:
 * 此服务的作用是用于将请求分发到不同的机器上。
 */


@Provide()
export class ProxyHubService {
  @App('socketIO')
  socketApp: SocketApplication;


  dispenseHttps(req: InstanceType<typeof IncomingMessage>, clientSocket: Duplex, head: Buffer) {
    const { port: _port, hostname } = new URL(`http://${req.url}`);
    const port = Number(_port || '443');

    /**
     * 服务器直接代理。
     * TODO: 这里直接固定false，后面放开，也作为参考代码。
     */
    const isUseLocal = false;
    if (isUseLocal) {
      const serverSocket = net.connect(port, hostname, () => {
        clientSocket.write(`HTTP/${req.httpVersion} 200 Connection Established\r\n` +
          // 'Proxy-agent: Node.js-Proxy\r\n' +
          '\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      serverSocket.on('error', (err) => {
        clientSocket.write(`HTTP/${req.httpVersion} 500 ${err.message}\r\n`);
        clientSocket.end();
      });
      return;
    }

    // 通过 socket 发送到代理端
    const deviceId = 'local_test'; // TODO:debug
    const forwardHttpController = DEVICE_LIST.find(i => i.id === deviceId)?.forwardHttpController;
    if (!forwardHttpController) return console.log('.....TODO:')
    forwardHttpController.forwardHttpsReq({ req, socket: clientSocket, head });
  }

  /**
   * 调用此方法的必定是首次连接的。
   */
  dispenseHttp(clientReq: IncomingMessage, clientRes: ServerResponse) {
    const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
    const option: RequestOptions = {
      method: clientReq.method,
      headers: clientReq.headers,
    }

    /**
     * 服务器直接代理。
     * TODO: 这里直接固定false，后面放开，也作为参考代码。
     */
    const isUseLocal = false;
    if (isUseLocal) {
      const serverReq = http.request(url, option, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
      });
      clientReq.pipe(serverReq);
      // // 协议升级  TODO:好像不会触发
      // serverReq.on('upgrade', (clientReq, clientSocket, clientHead) => {
      //   console.log('=====upgrade')
      //   const { port: _port, hostname } = new URL(clientReq.url);
      //   const port = Number(_port || '80');
      //   const options = {
      //     hostname,
      //     port,
      //     headers: clientReq.headers
      //   };
      //   const serverReq = http.request(options);
      //   serverReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      //     clientSocket.write(`HTTP/1.1 101 ${proxyRes.statusMessage}\r\n` +
      //       Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      //       '\r\n');
      //     if (clientHead.length > 0) proxySocket.write(clientHead);
      //     proxySocket.pipe(clientSocket);
      //     clientSocket.pipe(proxySocket);
      //   });
      //   serverReq.on('error', (err) => {
      //     clientSocket.write(`HTTP/1.1 500 ${err.message}\r\n`);
      //     clientSocket.end();
      //   });
      //   serverReq.end();
      // });
      // 错误捕捉
      serverReq.on('error', (err) => {
        clientRes.writeHead(500);
        clientRes.end(`服务器错误: ${err.message}`);
      });
      return;
    }

    // 通过 socket 发送到代理端
    const deviceId = 'local_test'; // TODO:debug
    const forwardHttpController = DEVICE_LIST.find(i => i.id === deviceId)?.forwardHttpController;
    if (!forwardHttpController) return console.log('.....TODO:')
    forwardHttpController.forwardHttpReq({ req: clientReq, res: clientRes });

  }

}

