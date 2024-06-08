import http from 'http';
import https from 'https';
import type { IncomingMessage, RequestOptions, ServerResponse, ClientRequest } from 'http';
import type { Readable, Stream } from 'stream';
import { nanoid as uuidCreator } from 'nanoid/non-secure';


export const SOCKET_EVENT_NAME = '__forward_end_data';

/**
 * 'server' 是服务器调用，接受客户端数据；
 * 'end' 是代理端调用，发起请求。
 */



/**
 * 说明，
 * 此组件是配合 socket.io 使用，数据结构也是按照它来定。
 * 
 */



type IListener = (data: ISocketData) => void;
type IOptions = {
    send?: IListener;
}



let _forwardHttpController: ForwardHttpController;
export function getSingleton() {
    if (_forwardHttpController) return _forwardHttpController;
    return new ForwardHttpController({});
}

/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
export class ForwardHttpController {

    /**
     * 
     */
    private cacheMap: Map<string, {
        type: 'server' | 'end';
        target?: ServerResponse | ClientRequest;
        /**
         * server 端才有。
         * 用于避免 connect 和 data 几乎同时发过去，导致 end 端没办法转发数据。
         */
        clientReq?: IncomingMessage;
    }> = new Map();

    /**
     * 用于接管 socket.emit('__forward_end_data', ...)
     */
    send: IListener = () => { };
    /**
     * 用于接管 socket.on('__forward_end_data', ...)
     */
    readonly receive: IListener = (_data) => {
        try {
            const { uuid, type: dataType, } = _data;

            if (dataType === 'connect') {
                this.createReq(_data);
                return;
            }

            const { target, clientReq } = this.cacheMap.get(uuid) || {};
            if (!target) return;
            if (dataType === 'connect_ack') {
                // 所有事件都发送过去
                for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
                    clientReq!.on(event, (...args) => {
                        const data: ISocketData = { type: 'event', uuid, event, args: args as any, }
                        this.send(data);
                    });
                    if (['close', 'error', 'end'].includes(event)) {
                        this.cacheMap.delete(uuid);
                    }
                }
            }
            if (dataType === 'writeHead') {
                const { data } = _data;
                (target as ServerResponse).writeHead(data[0], data[1]);

                return;
            }
            if (dataType === 'event') {
                const { event, args } = _data as ISocketData_ServerEvent<'data'>;
                console.log('=====', event, args)
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
        } catch (_) { }
    };

    constructor(options: IOptions) {
        const { send, } = options;
        if (send) this.send = send;
    }

    /**
     * 第一步，
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardReq(params: { req: IncomingMessage; res: ServerResponse; }) {
        const { req: clientReq, res: clientRes } = params;

        if (!this.send) throw new Error('this.send is undefined');
        if (!clientReq.url) throw new Error('req.url is undefined');

        const uuid = uuidCreator();
        /**
         * 第二步，
         * 发送自定义事件，
         * 通知对方创建 http 请求。
         */
        const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
        const option: RequestOptions = {
            method: clientReq.method,
            headers: clientReq.headers,
        }
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
    private createReq(_data: ISocketData) {
        // if (_data.type !== 'connect') return;
        const { uuid, url, option } = _data;

        const proxyReq = http.request(url, option, (proxyRes) => {
            // 发送自定义事件
            this.send({ type: 'connect_ack', uuid, });
            this.send({ type: 'writeHead', uuid, data: [proxyRes.statusCode, proxyRes.headers], });
            // 所有事件都发送过去
            for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
                proxyRes.on(event, (...args) => {
                    const data: ISocketData = { type: 'event', uuid, event, args: args as any, }
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





