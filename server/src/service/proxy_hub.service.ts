import { App, Provide } from '@midwayjs/core';
import { Application as SocketApplication } from '@midwayjs/socketio';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import type { ServerResponse, IncomingMessage, RequestOptions, } from 'http';
import type { Duplex } from 'stream';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { SocksClient } from 'socks';
import { DEVICE_LIST, type IDeviceId } from '../common/device_config';
import { CLASH_SOCKS_PROXY_PORT } from '../config/port_config.json';


/**
 * 说明:
 *   此服务的作用是用于将请求分发到不同的机器上。
 */


@Provide()
export class ProxyHubService {
  @App('socketIO')
  socketApp: SocketApplication;


  dispenseHttps(deviceId: IDeviceId, req: InstanceType<typeof IncomingMessage>, clientSocket: Duplex, head: Buffer) {
    const { port: _port, hostname } = new URL(`http://${req.url}`);
    const port = Number(_port || '443');

    /**
     * 服务器直接代理。
     */
    const isUseLocal = deviceId === 'server_local';
    if (isUseLocal) {
      const serverSocket = net.connect(port, hostname, () => {
        // 数据对接
        clientSocket.write(`HTTP/${req.httpVersion} 200 Connection Established\r\n\r\n`);
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
      // 错误处理
      serverSocket.on('error', (err) => {
        clientSocket.write(`HTTP/${req.httpVersion} 500 ${err.message}\r\n`);
        clientSocket.end();
      });
      clientSocket.on('error', (err) => { serverSocket.end(); });
      return;
    }


    /**
     * 使用 clash 代理。
     */
    const isUseClash = deviceId === 'clash';
    if (isUseClash) {
      SocksClient.createConnection({
        proxy: { host: '127.0.0.1', port: CLASH_SOCKS_PROXY_PORT, type: 5, /* SOCKS v5 */ },
        command: 'connect',
        destination: { host: hostname, port, },
      }, (err, info) => {
        if (err) {
          clientSocket.end(`HTTP/${req.httpVersion} 500 ${err.message}\r\n`);
          return;
        }
        // 数据对接
        clientSocket.write(`HTTP/${req.httpVersion} 200 Connection Established\r\n\r\n`);
        info.socket.write(head);
        info.socket.pipe(clientSocket);
        clientSocket.pipe(info.socket);
        // 错误处理
        info.socket.on('error', (err) => {
          clientSocket.end(`HTTP/${req.httpVersion} 500 ${err.message}\r\n`);
        });
        clientSocket.on('error', (err) => { info.socket.end(); });
      });
      return;
    }

    // 通过 socket 发送到代理端
    const forwardHttpController = DEVICE_LIST.find(i => i.id === deviceId)?.forwardHttpController;
    if (!forwardHttpController) return console.log('.....TODO:1')
    forwardHttpController.forwardHttpsReq({ req, socket: clientSocket, head });
  }

  /**
   * 调用此方法的必定是首次连接的。
   */
  dispenseHttp(deviceId: IDeviceId, clientReq: IncomingMessage, clientRes: ServerResponse) {
    const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
    const options: RequestOptions = {
      method: clientReq.method,
      headers: clientReq.headers,
    }

    /**
     * 服务器直接代理。
     */
    const isUseLocal = deviceId === 'local_test';
    if (isUseLocal) {
      const serverReq = http.request(url, options, (proxyRes) => {
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
      // 错误
      serverReq.on('error', (err) => {
        clientRes.writeHead(500);
        clientRes.end(`服务器错误: ${err.message}`);
      });
      return;
    }


    /**
     * 使用 clash 代理。
     */
    const isUseClash = deviceId === 'clash';
    if (isUseClash) {
      const _options: RequestOptions = {
        ...options,
        agent: new SocksProxyAgent(`socks5h://127.0.0.1:${CLASH_SOCKS_PROXY_PORT}`),
      };
      const serverReq = http.request(url, _options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
      });
      clientReq.pipe(serverReq);
      // 错误
      serverReq.on('error', (err) => {
        clientRes.writeHead(500);
        clientRes.end(`服务器错误: ${err.message}`);
      });
      clientReq.on('error', () => { serverReq.end(); });
      clientReq.on('end', () => { serverReq.end(); });
      return;
    }


    // 通过 socket 发送到代理端
    const forwardHttpController = DEVICE_LIST.find(i => i.id === deviceId)?.forwardHttpController;
    if (!forwardHttpController) return console.log('.....TODO:2')
    forwardHttpController.forwardHttpReq({ req: clientReq, res: clientRes });

  }

}

