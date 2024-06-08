import { Provide } from '@midwayjs/core';
import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import net from 'net';
import { URL } from 'url';
import { nanoid as uuidCreator } from 'nanoid/non-secure';
import { proxyServerPort as port, webServerPort } from '../config/port.config';
import { mockRequest } from '../proxy_main/mockRemoteRequest'; // TODO:del
import type { ServerResponse, IncomingMessage, RequestOptions, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
// import { ForwardHttpController } from '../utils/forward_end';
// import { ForwardHttpController } from '../../forward_end'
import { ForwardHttpController } from 'forward_end';

/**
 * 说明:
 * 此服务的作用是用于将请求分发到不同的机器上。
 */


@Provide()
export class ProxyHubService {


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


    const uuid = uuidCreator();

    const dataSocket = this.choseForwardEnd();

    dataSocket({
      type: 'connect',
      uuid,
      protocol: 'https',
      httpVersion: req.httpVersion,
      headers: req.headers,
      port: Number(port || '443'),
      hostname,
      head,
    }, (cbData) => {
      const { type, } = cbData;

      if (type === 'data') {
        const { data } = cbData;
        clientSocket.write(data);
        return;
      }

      if (type === 'end') {
        clientSocket.end();
        return;
      }

    });

    for (const event of ['close', 'data', 'drain', 'end', 'error', 'finish', 'pause', 'pipe', 'readable', 'resume', 'unpipe']) {
      // TODO: type
      clientSocket.on(event, (...args) => { dataSocket({ type: 'event', uuid, event, args, } as ISocketData_ServerEvent); });
    }

    // clientSocket.on('data', (buf: Buffer) => {
    //   dataSocket({
    //     type: 'data',
    //     uuid,
    //     data: buf,
    //   });
    // });
    // clientSocket.on('end', () => {
    //   dataSocket({
    //     type: 'end',
    //     uuid,
    //   });
    // });

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

    // const { headers, } = clientReq;
    // const uuid = uuidCreator();
    // const dataSocket = this.choseForwardEnd();

    // const mockServer = new ForwardHttpController({
    //   type: 'server',
    //   params: { req: clientReq, res: clientRes },
    // });
    // const mockEnd = new ForwardHttpController({
    //   type: 'end',
    //   // params:
    // });
    // mockServer.setSender((data) => { mockEnd.receive(data); });
    // mockEnd.setSender((data) => { mockServer.receive(data); });
    // mockServer.startForward();
    // mockEnd.startForward();


    console.log('ForwardHttpController: ', ForwardHttpController)



    // dataSocket({
    //   type: 'connect',
    //   uuid,
    //   protocol: 'http',
    //   option,
    //   url,
    // }, (cbData) => {
    //   const { type, } = cbData;

    //   if (type === 'writeHead') {
    //     const { data } = cbData;
    //     clientRes.writeHead(...data)
    //     return;
    //   }

    //   if (type === 'data') {
    //     const { data } = cbData;
    //     clientRes.write(data);
    //     return;
    //   }

    //   if (type === 'end') {
    //     clientRes.end();
    //     return;
    //   }

    // });

    // clientReq.on('data', (buf: Buffer) => {
    //   dataSocket({
    //     type: 'data',
    //     uuid,
    //     data: buf,
    //   });
    // });
    // clientReq.on('end', (buf: Buffer) => {
    //   dataSocket({
    //     type: 'end',
    //     uuid,
    //   });
    // });

  }

  /**
   * 选择代理的客户端。
   * TODO: 参数待定，不确定通过什么方式确定客户端
   */
  choseForwardEnd() {
    return mockRequest;
  }


}

