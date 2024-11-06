import { App, Inject, Provide } from '@midwayjs/core';
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
import { DeviceManageService } from './device_manage.service';


/**
 * 说明:
 *   此服务的作用是用于将请求分发到不同的机器上。
 */


@Provide()
export class ProxyHubService {
  @App('socketIO')
  socketApp: SocketApplication;
  @Inject()
  deviceManageService: DeviceManageService;


  dispenseHttps(deviceId: IDeviceId, req: InstanceType<typeof IncomingMessage>, clientSocket: Duplex, head: Buffer) {
    const { port: _port, hostname } = new URL(`http://${req.url}`);
    const port = Number(_port || '443');

    /**
     * 服务器直接代理。
     */
    const isUseLocal = deviceId === 'server_local';
    if (isUseLocal) {

      const { port: _port, hostname } = new URL(`http://${req.url}`);
      const port = Number(_port || '443');
      const { httpVersion, headers } = req;

      const serverSocket = net.connect(port, hostname, () => {
        try {
          /**
           * 踩坑记录:
           *   对于 readyState 的 socket ，它是无法调用 write 方法，
           *   否则会导致报错，错误也无法被外层的 try-catch 捕捉，导致整个程序崩溃。
           */
          if (serverSocket.readyState === 'readOnly') return;
          const resHead = `HTTP/${httpVersion} 200 Connection Established\r\n` + /* 'Proxy-agent: Node.js-Proxy\r\n' + */ '\r\n';
          clientSocket.write(resHead);
        } catch (err) { }
      });
      /**
       * 踩坑记录:
       *   error 事件的监听需要在外层(也就是这里)，否则内部不能捕捉到 ETIMEDOUT 的错误。
       *   无法通过监听 timeout 事件来捕获 ETIMEDOUT 的报错，应该不是同一个东西。
       *   pointSocket 的报错无法通过 try-catch 来捕获(也就是上面的 try-catch)，它的错误会直接给到最外层，导致程序崩溃。
       */
      serverSocket.on('error', (err) => { clientSocket.end(); });

      /**
       * 实测的坑: 不能把所有通过 for 循环注入所有事件。
       *   原因一，会不生效，具体情况不太清楚。
       *   原因二，有些事件之间是"互斥"，例如 'data' 和 'pause'、'readable'、'resume' 。
       */
      serverSocket.write(head);
      serverSocket.on('data', (buf: Buffer) => { clientSocket.write(buf); });
      serverSocket.on('end', () => {
        clientSocket.end();
      });

      clientSocket.on('data', (buf: Buffer) => { serverSocket.write(buf); });
      clientSocket.on('end', () => { serverSocket.end(); });
      clientSocket.on('error', (err) => {
        serverSocket.end();
      });

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

    /**
     * 通过 socket 发送到代理端。
     */
    const forwardHttpController = DEVICE_LIST.find(i => i.id === deviceId)?.forwardHttpController;
    const usable = !!this.deviceManageService.checkDeviceUsable(deviceId);
    if (!usable || !forwardHttpController?.forwardHttpsReq) return;
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
    const isUseLocal = deviceId === 'server_local';
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
    const usable = !!this.deviceManageService.checkDeviceUsable(deviceId);
    if (!usable || !forwardHttpController?.forwardHttpReq) return;
    forwardHttpController.forwardHttpReq({ req: clientReq, res: clientRes });

  }

}

