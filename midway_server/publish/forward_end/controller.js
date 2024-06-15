'use strict';

var http = require('http');
var net = require('net');
var url = require('url');

let urlAlphabet =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
let nanoid = (size = 21) => {
  let id = '';
  let i = size;
  while (i--) {
    id += urlAlphabet[(Math.random() * 64) | 0];
  }
  return id
};

const SOCKET_EVENT_NAME = '__forward_end_data';
function getSingleton() {
    return new ForwardHttpController({});
}
/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
class ForwardHttpController {
    constructor(options) {
        /**
         * 请求缓存。
         * uuid 在服务端生成，后面的 uuid 都是它。
         *
         * type 说明:
         * 'server' 是服务器调用，接受客户端数据；
         * 'end' 是代理端调用，发起请求。
         */
        this.cacheMap = new Map();
        /**
         * 用于接管 socket.emit('__forward_end_data', ...)
         */
        this.send = () => { throw new Error('unset send function'); };
        /**
         * 用于接管 socket.on('__forward_end_data', ...)
         */
        this.receive = (_data) => {
            try {
                const { uuid, type: dataType, } = _data;
                // 这里是有 'end' 才有。
                if (dataType === 'connect') {
                    const { protocol } = _data;
                    if (protocol === 'http')
                        this.createHttpReq(_data);
                    else if (protocol === 'https')
                        this.createHttpsReq(_data);
                    return;
                }
                const { target, } = this.cacheMap.get(uuid) || {};
                if (!target)
                    return;
                // 这里是有 'server' 才有。
                if (dataType === 'writeHead') {
                    const { data } = _data;
                    target.writeHead(data[0], data[1]);
                    return;
                }
                // 两段都一样，数据交换
                if (dataType === 'event') {
                    const { event, args } = _data;
                    if (event === 'data') {
                        target.write(args[0]);
                        return;
                    }
                    if (event === 'end') {
                        target.end();
                        this.cacheMap.delete(uuid);
                        return;
                    }
                }
            }
            catch (_) { }
        };
        const { send, } = options || {};
        if (send)
            this.send = send;
    }
    /**
     * 清空数据
     */
    clear() {
        for (const [_, cacheData] of Array.from(this.cacheMap.entries())) {
            const { target } = cacheData;
            if (!target)
                continue;
            target.end();
        }
        this.cacheMap.clear();
    }
    /**
     * 直接使用 socket.io 的实例注入方法。
     */
    useSocketIo(socket) {
        this.send = (data) => {
            socket.emit(SOCKET_EVENT_NAME, data);
        };
        socket.on(SOCKET_EVENT_NAME, (data) => {
            this.receive(data);
        });
    }
    /**
     * 第一步，
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardHttpReq(params) {
        try {
            const { req: clientReq, res: clientRes } = params;
            if (!this.send)
                throw new Error('this.send is undefined');
            if (!clientReq.url)
                throw new Error('req.url is undefined');
            const uuid = nanoid();
            /**
             * 第二步，
             * 发送自定义事件，
             * 通知对方创建 http 请求。
             */
            const url$1 = new url.URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
            const option = {
                method: clientReq.method,
                headers: clientReq.headers,
            };
            this.send({ type: 'connect', uuid, protocol: 'http', option, url: url$1, });
            this.cacheMap.set(uuid, { type: 'server', target: clientRes, });
            /**
             * 将特定事件发送到代理端。
             *
             * 实测的坑: 不能把所有通过 for 循环注入所有事件。
             * 原因一，会不生效，具体情况不太清楚。
             * 原因二，有些事件之间是"互斥"，例如 'data' 和 'pause'、'readable'、'resume' 。
             */
            clientReq.on('data', (buf) => {
                const data = { type: 'event', uuid, event: 'data', args: [buf] };
                this.send(data);
            });
            clientReq.on('end', () => {
                const data = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data);
            });
        }
        catch (_) { }
    }
    /**
     * 第三步，
     * 代理端收到数据，创建 http 请求。
     * 在 receive 中触发。
     */
    createHttpReq(_data) {
        try {
            if (_data.type !== 'connect' || _data.protocol !== 'http')
                return;
            const { uuid, url, option } = _data;
            /**
             * 超时时间(不确定是否生效)
             */
            option.timeout = 10 * 1000;
            const proxyReq = http.request(url, option, (proxyRes) => {
                // 发送自定义事件
                this.send({ type: 'writeHead', uuid, data: [proxyRes.statusCode, proxyRes.headers], });
                /**
                 * 将特定事件发送到代理端。
                 * 实测的坑: 不能把所有通过 for 循环注入所有事件。理由上面写了。
                 */
                proxyRes.on('data', (buf) => {
                    const data = { type: 'event', uuid, event: 'data', args: [buf] };
                    this.send(data);
                });
                proxyRes.on('end', () => {
                    const data = { type: 'event', uuid, event: 'end', args: [] };
                    this.send(data);
                });
            });
            proxyReq.on('error', (err) => {
                const data1 = { type: 'writeHead', uuid, data: [500, `服务器错误: ${err.message}`] };
                this.send(data1);
                const data2 = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data2);
            });
            this.cacheMap.set(uuid, { type: 'end', target: proxyReq });
        }
        catch (_) { }
    }
    /**
     * 第一步， (HTTPS)
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardHttpsReq(params) {
        try {
            const { req: clientReq, socket: clientSocket, head } = params;
            if (!this.send)
                throw new Error('this.send is undefined');
            if (!clientReq.url)
                throw new Error('req.url is undefined');
            const { port: _port, hostname } = new url.URL(`http://${clientReq.url}`);
            const port = Number(_port || '443');
            const uuid = nanoid();
            const { httpVersion, headers } = clientReq;
            /**
             * 第二步，
             * 发送自定义事件，
             * 通知对方创建 https 连接。
             */
            this.send({ type: 'connect', uuid, protocol: 'https', head, port, hostname, httpVersion, headers });
            this.cacheMap.set(uuid, { type: 'server', target: clientSocket, });
            /**
             * 将特定事件发送到代理端。
             * 实测的坑: 不能把所有通过 for 循环注入所有事件。理由上面写了。
             */
            clientSocket.on('data', (buf) => {
                const data = { type: 'event', uuid, event: 'data', args: [buf] };
                this.send(data);
            });
            clientSocket.on('end', () => {
                const data = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data);
            });
        }
        catch (_) { }
    }
    /**
     * 第三步，
     * 代理端收到数据，创建 http 请求。
     * 在 receive 中触发。
     */
    createHttpsReq(_data) {
        try {
            if (_data.type !== 'connect' || _data.protocol !== 'https')
                return;
            const { uuid, head, port, hostname, httpVersion, headers } = _data;
            const pointSocket = net.connect(port, hostname, () => {
                /**
                 * 通知服务端给客户端写入头部。
                 */
                const resHead = `HTTP/${httpVersion} 200 Connection Established\r\n` +
                    // 'Proxy-agent: Node.js-Proxy\r\n' +
                    '\r\n';
                const _data = { type: 'event', uuid, event: 'data', args: [resHead] };
                this.send(_data);
                /**
                 * 写入来自客户端的头部 buffer 内容。
                 */
                pointSocket.write(head);
                /**
                 * 将特定事件发送到代理端。
                 * 实测的坑: 不能把所有通过 for 循环注入所有事件。理由上面写了。
                 */
                pointSocket.on('data', (buf) => {
                    const data = { type: 'event', uuid, event: 'data', args: [buf] };
                    this.send(data);
                });
                pointSocket.on('end', () => {
                    const data = { type: 'event', uuid, event: 'end', args: [] };
                    this.send(data);
                });
            });
            this.cacheMap.set(uuid, { type: 'end', target: pointSocket });
        }
        catch (_) { }
    }
}

exports.ForwardHttpController = ForwardHttpController;
exports.SOCKET_EVENT_NAME = SOCKET_EVENT_NAME;
exports.getSingleton = getSingleton;
