import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import net from 'net';
import { URL } from 'url';
import { proxyServerPort as port, webServerPort } from '../config/port.config';


/**
 * 这里才是整个服务的入口。
 * 因为 midway 框架不支持通过 middleware 做成代理服务。
 */



export function start() {

  // 创建代理服务器实例
  const proxy = httpProxy.createProxyServer({});

  // 处理错误事件
  proxy.on('error', (err, req, res) => {
    console.log('1======',)
    res.writeHead(500, {
      'Content-Type': 'text/plain'
    });
    res.end('An error occurred: ' + err.message);
  });

  // 创建 HTTP 服务器
  const httpServer = http.createServer((req, res) => {
    console.log('2======', req.url)
    // 将请求转发到目标服务器
    // proxy.web(req, res, { target: req.url });




    const parsedUrl = new URL(req.url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    // console.log('parsedUrl: ', parsedUrl) // TODO:del

    /**
     * (不做处理)
     * 转发代理。
     */
    const proxyReq = http.request({ ...req }, (proxyResp) => {
      res.writeHead(proxyResp.statusCode, proxyResp.headers);
      proxyResp.pipe(res);
    });
    req.pipe(proxyReq);
    proxyReq.on('error', (err) => {
      res.writeHead(500);
      res.end(`服务器错误: ${err.message}`);
    });
  });


  /**
   * 下面是有效的
   */

  httpServer.on('connect', (req, clientSocket, head) => {
    const { port, hostname } = new URL(`http://${req.url}`);

    // TODO:应该用 req.httpVersion

    console.log('3======', req.url, port, hostname, req.httpVersion)
    // 创建到目标服务器的连接
    const serverSocket = net.connect(+port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
        'Proxy-agent: Node.js-Proxy\r\n' +
        '\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      clientSocket.write(`HTTP/1.1 500 ${err.message}\r\n`);
      clientSocket.end();
    });
  });


  httpServer.listen(port, () => {
    console.log(`http 代理服务端口: ${port}`);
  });

}


export function start3() {

  const tcpServer = net.createServer((clientSocket: net.Socket) => {

    clientSocket.once('data', (buf) => {
      // 从连接的第一批数据中获取目标服务器信息
      const [headers] = buf.toString().split('\r\n\r\n');
      const [header] = headers.split('\r\n');
      const [method, url] = header.split(' ');


      console.log('====: ', method, url)

      if (method !== 'CONNECT') {
        // 如果不是 CONNECT 方法，那么不处理

        http.get(url, (res) => {
          res.pipe(clientSocket)
        })

        return;
      }
      const [host, port] = url.split(':');

      console.log('====2: ', host, port, parseInt(port, 10))

      // 建立到目标服务器的连接
      const serverSocket = net.createConnection({ host, port: parseInt(port, 10) }, () => {

        serverSocket.write(buf);
        // 管道方式连接两端的socket

        // clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Node-Proxy\r\n\r\n');
        // 将剩下的数据从客户端转发到目标服务器
        // serverSocket.write(buf);
      });

      clientSocket.pipe(serverSocket);
      serverSocket.pipe(clientSocket);

      // serverSocket.on('error', err => {
      //   console.error('Server socket error:', err.message);
      //   clientSocket.end(`HTTP/1.1 500 ${err.message}\r\n`);
      //   serverSocket.destroy();
      // });

      // clientSocket.on('error', err => {
      //   console.error('Client socket error:', err.message);
      //   clientSocket.destroy();
      //   serverSocket.end();
      // });
    });

  });

  tcpServer.on('error', err => {
    console.error('Proxy server error:', err.message);
  });

  tcpServer.listen(port, () => {
    console.log('info', `TCP server listening on port ${port}`);
  });

}




export function start2() {

  const server = http.createServer((req, res) => {
    console.log('req.url: ', req.url)
    try {

      /**
       * 转发到内部服务端口。
       */
      const gotoWebServer = req.url.startsWith('/');
      if (gotoWebServer) {
        const proxyReq = http.request({ ...req, port: webServerPort }, (proxyResp) => {
          res.writeHead(proxyResp.statusCode, proxyResp.headers);
          proxyResp.pipe(res);
        });
        req.pipe(proxyReq);
        proxyReq.on('error', (err) => {
          res.writeHead(500);
          res.end(`服务器错误: ${err.message}`);
        });
        return;
      }

      const parsedUrl = new URL(req.url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      console.log('parsedUrl: ', parsedUrl) // TODO:del

      /**
       * (不做处理)
       * 转发代理。
       */
      const proxyReq = protocol.request({ ...req }, (proxyResp) => {
        res.writeHead(proxyResp.statusCode, proxyResp.headers);
        proxyResp.pipe(res);
      });
      req.pipe(proxyReq);
      proxyReq.on('error', (err) => {
        res.writeHead(500);
        res.end(`服务器错误: ${err.message}`);
      });



      /**
       * (处理请求再转发，针对特定网站)
       * 转发代理。
       * TODO:
       */



    } catch (_) { }
  });


  server.on('connect', (req, cltSocket, head) => {
    console.log('req.url-2: ', req.url)
    // 解析传入的请求目标地址
    const parsedUrl = new URL(`https://${req.url}`);
    // 创建到目标地址的TCP连接
    const srvSocket = net.createConnection(Number(parsedUrl.port || '80'), parsedUrl.hostname, () => {
      // // 响应CONNECT请求，告诉客户端连接已经建立
      // cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
      //   'Proxy-agent: Node.js-Proxy\r\n' +
      //   '\r\n');
      // 将头信息转发给目标
      srvSocket.write(head);
      // 管道连接目标socket和客户端socket
      srvSocket.pipe(cltSocket);
      cltSocket.pipe(srvSocket);
    });

    // 监听错误事件
    srvSocket.on('error', (e) => {
      console.error('Proxy to target server error:', e);
      cltSocket.end();
    });
    srvSocket.on('end', () => { cltSocket.end() })
    cltSocket.on('end', () => { srvSocket.end() })

    cltSocket.on('error', (e) => {
      srvSocket.end();
      console.error('Client socket error:', e);
    });
  });

  server.listen(port, () => {
    console.log(`http 代理服务端口: ${port}`);
  });

}

