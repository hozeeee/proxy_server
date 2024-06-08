import { Provide } from '@midwayjs/core';
import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import net from 'net';
import { URL } from 'url';
import { proxyServerPort as port, webServerPort } from '../config/port.config';


const requestMap: Record<string, {
  uuid: string;
  req?: http.ClientRequest | net.Socket;
}> = {}


function upgradeHandler(req, socket, head) {
  const targetUrl = new URL(req.url);
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    headers: req.headers
  };

  const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(options);

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(`HTTP/1.1 101 ${proxyRes.statusMessage}\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n');

    if (head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', (err) => {
    socket.write(`HTTP/1.1 500 ${err.message}\r\n`);
    socket.end();
  });

  proxyReq.end();
}




export function mockRequest(params: ISocketData, cb = ((_: ISocketData) => { })) {
  const { type, uuid, } = params;

  if (!requestMap[uuid]) requestMap[uuid] = { uuid, }


  if (type === 'connect') {
    const { uuid, protocol, } = params;

    if (protocol === 'https') {
      const { port, hostname, httpVersion, head } = params;
      // 创建到目标服务器的连接
      const pointSocket = net.connect(port, hostname, () => {
        // clientSocket.write(`HTTP${httpVersion} 200 Connection Established\r\n` +
        //   // 'Proxy-agent: Node.js-Proxy\r\n' +
        //   '\r\n');
        // serverSocket.write(head);
        // serverSocket.pipe(clientSocket);
        // clientSocket.pipe(serverSocket);

        cb({
          type: 'data',
          uuid,
          data: `HTTP/${httpVersion} 200 Connection Established\r\n` +
            // 'Proxy-agent: Node.js-Proxy\r\n' +
            '\r\n',
        });

        pointSocket.write(head);

        pointSocket.on('data', (buf: Buffer) => {
          cb({
            type: 'data',
            uuid,
            data: buf,
          });
        });
        pointSocket.on('end', () => {
          cb({
            type: 'end',
            uuid,
          });
        });

      });
      requestMap[uuid].req = pointSocket;

      pointSocket.on('error', (err) => {
        // clientSocket.write(`HTTP${httpVersion} 500 ${err.message}\r\n`);
        // clientSocket.end();

        cb({
          type: 'data',
          uuid,
          data: `HTTP/${httpVersion} 500 ${err.message}\r\n`,
        });
        cb({
          type: 'end',
          uuid,
        });
      });
      return;
    }


    // const pointSocket = net.connect(port, hostname, () => {
    // });

    // serverSocket.on('error', (err) => {
    //   clientSocket.write(`${req.httpVersion} 500 ${err.message}\r\n`);
    //   clientSocket.end();
    // });


    const { url, option } = params;
    console.log('======3: ', '代理端收到数据-准备发送请求', JSON.stringify(option)) // TODO:del

    const pointReq = http.request(url, option, (proxyResp) => {
      console.log('======4: ', '代理端发送请求-准备给服务器返回数据') // TODO:del
      // res.writeHead(proxyResp.statusCode, proxyResp.headers);
      // proxyResp.pipe(res);

      cb({
        type: 'writeHead',
        uuid,
        data: [proxyResp.statusCode, proxyResp.headers],
      });

      proxyResp.on('data', (buf: Buffer) => {
        console.log('======6: ', '代理端发送数据给服务器-data') // TODO:del
        cb({
          type: 'data',
          uuid,
          data: buf,
        });
      });
      proxyResp.on('end', () => {
        console.log('======8: ', '代理端发起结束') // TODO:del
        cb({
          type: 'end',
          uuid,
        });
      });


    });

    // pointReq.on('error', (err) => {
    //   // res.writeHead(500);
    //   // res.end(`服务器错误: ${err.message}`);
    //   cb({
    //     type: 'end',
    //     uuid,
    //   });
    // });

    requestMap[uuid].req = pointReq;

    // TODO: 实际应该是 socket.emit 返回数据
    // cb({
    //   uuid,
    // });

    return;
  }

  if (type === 'data') {
    console.log('====data:')
    const { data } = params;
    requestMap[uuid].req?.write(data);
    return;
  }

  if (type === 'end') {
    console.log('====end:')
    requestMap[uuid].req?.end();
    delete requestMap[uuid];
    return;
  }


  // const proxyReq = http.request({ ...req }, (proxyResp) => {
  //   res.writeHead(proxyResp.statusCode, proxyResp.headers);
  //   proxyResp.pipe(res);
  // });
  // req.pipe(proxyReq);

  // proxyReq.on('error', (err) => {
  //   res.writeHead(500);
  //   res.end(`服务器错误: ${err.message}`);
  // });

}

