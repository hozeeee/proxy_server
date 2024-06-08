'use strict';

var http = require('http');

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
         *
         */
        this.cacheMap = new Map();
        /**
         * 用于接管 socket.emit('__forward_end_data', ...)
         */
        this.send = () => { };
        /**
         * 用于接管 socket.on('__forward_end_data', ...)
         */
        this.receive = (_data) => {
            try {
                const { uuid, type: dataType, } = _data;
                if (dataType === 'connect') {
                    this.createReq(_data);
                    return;
                }
                const { target, clientReq } = this.cacheMap.get(uuid) || {};
                if (!target)
                    return;
                if (dataType === 'connect_ack') {
                    // 所有事件都发送过去
                    for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
                        clientReq.on(event, (...args) => {
                            const data = { type: 'event', uuid, event, args: args, };
                            this.send(data);
                        });
                        if (['close', 'error', 'end'].includes(event)) {
                            this.cacheMap.delete(uuid);
                        }
                    }
                }
                if (dataType === 'writeHead') {
                    const { data } = _data;
                    target.writeHead(data[0], data[1]);
                    return;
                }
                if (dataType === 'event') {
                    const { event, args } = _data;
                    console.log('=====', event, args);
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
        const { send, } = options;
        if (send)
            this.send = send;
    }
    /**
     * 第一步，
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardReq(params) {
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
        const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
        const option = {
            method: clientReq.method,
            headers: clientReq.headers,
        };
        this.send({ type: 'connect', uuid, protocol: 'http', option, url, });
        this.cacheMap.set(uuid, { type: 'server', target: clientRes, clientReq });
        /**
         * 记录，原本在这里写的代码，移到 'connect_ack' 中触发。
         */
    }
    /**
     * 第三步，
     * 代理端收到数据，创建 http 请求。
     * 在 receive 中触发。
     */
    createReq(_data) {
        // if (_data.type !== 'connect') return;
        const { uuid, url, option } = _data;
        const proxyReq = http.request(url, option, (proxyRes) => {
            // 发送自定义事件
            this.send({ type: 'connect_ack', uuid, });
            this.send({ type: 'writeHead', uuid, data: [proxyRes.statusCode, proxyRes.headers], });
            // 所有事件都发送过去
            for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
                proxyRes.on(event, (...args) => {
                    const data = { type: 'event', uuid, event, args: args, };
                    this.send(data);
                });
                if (['close', 'error', 'end'].includes(event)) {
                    this.cacheMap.delete(uuid);
                }
            }
        });
        this.cacheMap.set(uuid, { type: 'end', target: proxyReq });
    }
}

exports.ForwardHttpController = ForwardHttpController;
exports.SOCKET_EVENT_NAME = SOCKET_EVENT_NAME;
exports.getSingleton = getSingleton;
