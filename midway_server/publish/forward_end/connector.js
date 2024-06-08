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

function getSingleton() {
    // return new ForwardHttpController();
}
/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
class ForwardHttpController {
    constructor(options) {
        /**
         * 外部调用此方法，将数据注入到这里。
         * 初始化的时候会声明此方法。
         */
        this.receive = () => { };
        const { send, } = options;
        this.options = Object.assign({}, options);
        this.send = send;
        const uuid = nanoid();
        this.uuid = uuid;
    }
    setSender(send) {
        if (this.send) {
            console.log('send 已设定，不能更改');
            return;
        }
        this.send = send;
    }
    startForward() {
        if (!this.send)
            throw new Error('send 未提供');
        const { type } = this.options;
        if (type === 'end')
            this.startEndForward();
        else if (type === 'server')
            this.startServerForward();
    }
    /**
     * 代理端发起请求。
     */
    startEndForward() {
        // if (type === 'connect') {
        // TODO: 不应该直接启动，应该是由 服务端 发送 'connect' 事件才执行。
        if (this.options.type !== 'end')
            return;
        const { url, option } = this.options.params;
        const uuid = this.uuid;
        /**
         * 创建 http 请求。
         */
        const proxyReq = http.request(url, option, (proxyRes) => {
            // 发送自定义事件
            this.send({
                type: 'writeHead',
                uuid,
                data: [proxyRes.statusCode, proxyRes.headers],
            });
            // 所有事件都发送过去
            for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
                proxyRes.on(event, (...args) => {
                    const data = {
                        type: 'event',
                        uuid,
                        event,
                        args: args,
                    };
                    this.send(data);
                });
            }
        });
        /**
         * 处理接收到的数据。
         */
        this.receive = (function (_data) {
            const { type: dataType, } = _data;
            if (dataType === 'event') {
                const { event, args } = _data;
                console.log('----', event, args);
                if (event === 'data') {
                    proxyReq.write(args[0]);
                    return;
                }
                if (event === 'end') {
                    proxyReq.end();
                    return;
                }
            }
        }).bind(this);
    }
    /**
     * 服务端接收请求数据。
     */
    startServerForward() {
        if (this.options.type !== 'server')
            return;
        const { req: clientReq, res: clientRes } = this.options.params;
        const uuid = this.uuid;
        /**
         * 发送自定义事件
         * 通知对方创建 http 请求。
         */
        const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
        const option = {
            method: clientReq.method,
            headers: clientReq.headers,
        };
        this.send({
            type: 'connect',
            uuid,
            protocol: 'http',
            option,
            url,
        });
        // 所有事件都发送过去
        for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
            clientReq.on(event, (...args) => {
                const data = {
                    type: 'event',
                    uuid,
                    event,
                    args: args,
                };
                this.send(data);
            });
        }
        /**
         * 处理接收到的数据。
         */
        this.receive = (function (_data) {
            const { type: dataType, } = _data;
            if (dataType === 'writeHead') {
                const { data } = _data;
                clientRes.writeHead(...data);
                return;
            }
            if (dataType === 'event') {
                const { event, args } = _data;
                console.log('=====', event, args);
                if (event === 'data') {
                    clientRes.write(args[0]);
                    return;
                }
                if (event === 'end') {
                    clientRes.end();
                    return;
                }
            }
        }).bind(this);
    }
}

exports.ForwardHttpController = ForwardHttpController;
exports.getSingleton = getSingleton;
