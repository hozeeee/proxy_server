import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import type { IncomingMessage, RequestOptions, ServerResponse, ClientRequest } from 'http';
import type { Readable, Stream } from 'stream';
import { nanoid as uuidCreator } from 'nanoid/non-secure';
import type { Socket } from 'socket.io-client';
import type { Duplex } from 'stream';
import { Logger } from '../utils/logger';

const logger = new Logger('[http_proxy.bridge]');



/**
 * 说明，
 * 接受来自对端的 http 服务的请求数据，例如 on('data') ，
 * 在此处创建 http(s) 请求，
 * 同样的把 on('data') 的数据返回给对端。
 */



const SOCKET_EVENT_NAME = '__forward_end_data';


/**
 * TODO: 超时情况未考虑。
 * 服务端超时、代理端超时 都需要考虑。
 */


type IListener = (data: ISocketData) => void;
type IOptions = {
    send?: IListener;
}
type ISocketCallback = ((...args: any[]) => void) | undefined;

/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
export class HttpProxyBridge {
    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private _socket: Socket | undefined = undefined;
    private _socketCallback: ISocketCallback = undefined;


    /**
     * 用于接管 socket.emit('__forward_end_data', ...)
     */
    send: IListener = () => { throw new Error('unset send function'); };
    /**
     * 用于接管 socket.on('__forward_end_data', ...)
     */
    readonly receive: IListener = (_data) => {
        try {
            const { uuid, type: dataType, } = _data;
            // 这里是有 'end' 才有。
            if (dataType === 'connect') {
                const { protocol } = _data;
                if (protocol === 'http') this.createHttpReq(_data);
                else if (protocol === 'https') this.createHttpsReq(_data);
                return;
            }
            const { target, } = this.cacheMap.get(uuid) || {};
            if (!target) return;
            // 这里是有 'server' 才有。
            if (dataType === 'writeHead') {
                const { data } = _data;
                (target as ServerResponse).writeHead(data[0], data[1]);
                return;
            }
            // 两段都一样，数据交换
            if (dataType === 'event') {
                const { event, args } = _data as ISocketData_ServerEvent<'data'>;
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
        } catch (err) { logger.debug(`receive-err: ${err}`); }
    };

    /**
     * 直接使用 socket.io 的实例注入方法。
     */
    useSocketIo(socket: Socket) {
        /**
         * 清空旧的回调。
         */
        try {
            if (this._socket && this._socketCallback) {
                this._socket.off(SOCKET_EVENT_NAME, this._socketCallback);
                this._socket = undefined;
                this._socketCallback = undefined;
            }
        } catch (_) { }

        /**
         * 配置"响应回调"。
         * 通常是在终端接收到指令后触发。
         */
        const socketCallback: ISocketCallback = (data) => {
            this.receive(data);
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);
        /**
         * 创建"主动调用"的方法。
         * 通常是在服务端调用。
         */
        this.send = (data) => {
            try {
                this._socket!.emit(SOCKET_EVENT_NAME, data);
            } catch (err) { logger.debug(`send-err: ${err}`); }
        }

        /**
         * 记录(用于清理旧数据)
         */
        this._socket = socket;
        this._socketCallback = socketCallback;
    }

    constructor(options?: IOptions) {
        const { send, } = options || {};
        if (send) this.send = send;
    }


    /**
     * 请求缓存。
     * uuid 在服务端生成，后面的 uuid 都是它。
     * 
     * type 说明:
     * 'server' 是服务器调用，接受客户端数据；
     * 'end' 是代理端调用，发起请求。
     */
    private cacheMap: Map<string, {
        type: 'server' | 'end';
        target?: ServerResponse | ClientRequest | Duplex;
    }> = new Map();

    /**
     * 清空数据
     */
    clear() {
        for (const [_, cacheData] of Array.from(this.cacheMap.entries())) {
            const { target } = cacheData;
            if (!target) continue;
            target.end();
        }
        this.cacheMap.clear();
    }




    /**
     * 第一步，
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardHttpReq(params: { req: IncomingMessage; res: ServerResponse; }) {
        try {
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
            this.cacheMap.set(uuid, { type: 'server', target: clientRes, });
            /**
             * 将特定事件发送到代理端。
             * 
             * 实测的坑: 不能把所有通过 for 循环注入所有事件。
             * 原因一，会不生效，具体情况不太清楚。
             * 原因二，有些事件之间是"互斥"，例如 'data' 和 'pause'、'readable'、'resume' 。
             */
            clientReq.on('data', (buf: Buffer) => {
                const data: ISocketData = { type: 'event', uuid, event: 'data', args: [buf] as any };
                this.send(data);
            });
            clientReq.on('end', () => {
                const data: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data);
            });
        } catch (err) { logger.debug(`forwardHttpReq-err: ${err}`); }
    }
    /**
     * 第三步，
     * 代理端收到数据，创建 http 请求。
     * 在 receive 中触发。
     */
    private createHttpReq(_data: ISocketData) {
        try {
            if (_data.type !== 'connect' || _data.protocol !== 'http') return;
            const { uuid, url, option } = _data;

            /**
             * 超时时间(不确定是否生效)
             */
            option.timeout = 10 * 1000;

            const proxyReq = http.request(url, option, (proxyRes) => {
                try {
                    // 发送自定义事件
                    this.send({ type: 'writeHead', uuid, data: [proxyRes.statusCode!, proxyRes.headers], });
                    /**
                     * 将特定事件发送到代理端。
                     * 实测的坑: 不能把所有通过 for 循环注入所有事件。理由上面写了。
                     */
                    proxyRes.on('data', (buf: Buffer) => {
                        const data: ISocketData = { type: 'event', uuid, event: 'data', args: [buf] as any };
                        this.send(data);
                    });
                    proxyRes.on('end', () => {
                        const data: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                        this.send(data);
                    });
                } catch (err) { logger.debug(`createHttpReq-http.request-err: ${err}`); }
            });

            proxyReq.on('error', (err) => {
                const data1: ISocketData = { type: 'writeHead', uuid, data: [500, `服务器错误: ${err.message}` as any] };
                this.send(data1);
                const data2: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data2);
            });

            this.cacheMap.set(uuid, { type: 'end', target: proxyReq });
        } catch (err) { logger.debug(`createHttpReq-err: ${err}`); }
    }




    /**
     * 第一步， (HTTPS)
     * 服务端收到客户端的请求，
     * 主动调用此方法，
     * 将请求的相关信息发送给代理端。
     */
    forwardHttpsReq(params: { req: InstanceType<typeof IncomingMessage>; socket: Duplex, head: Buffer }) {
        try {
            const { req: clientReq, socket: clientSocket, head } = params;
            if (!this.send) throw new Error('this.send is undefined');
            if (!clientReq.url) throw new Error('req.url is undefined');

            const { port: _port, hostname } = new URL(`http://${clientReq.url}`);
            const port = Number(_port || '443');
            const uuid = uuidCreator();
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
            clientSocket.on('data', (buf: Buffer) => {
                const data: ISocketData = { type: 'event', uuid, event: 'data', args: [buf] as any };
                this.send(data);
            });
            clientSocket.on('end', () => {
                const data: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data);
            });
        } catch (err) { logger.debug(`forwardHttpsReq-err: ${err}`); }
    }
    /**
     * 第三步，
     * 代理端收到数据，创建 http 请求。
     * 在 receive 中触发。
     */
    private createHttpsReq(_data: ISocketData) {
        try {
            logger.debug(`before createHttpsReq: _data.protocol(${_data.type})`);
            if (_data.type !== 'connect' || _data.protocol !== 'https') return;
            const { uuid, head, port, hostname, httpVersion, headers } = _data;
            const pointSocket = net.connect(port, hostname, () => {
                try {
                    logger.debug(`pointSocket.readyState: ${pointSocket.readyState}`);
                    /**
                     * 踩坑记录:
                     *   对于 readyState 的 socket ，它是无法调用 write 方法，
                     *   否则会导致报错，错误也无法被外层的 try-catch 捕捉，导致整个程序崩溃。
                     */
                    if (pointSocket.readyState === 'readOnly') return;

                    /**
                     * 通知服务端给客户端写入头部。
                     */
                    const resHead = `HTTP/${httpVersion} 200 Connection Established\r\n` +
                        // 'Proxy-agent: Node.js-Proxy\r\n' +
                        '\r\n';
                    const _data: ISocketData = { type: 'event', uuid, event: 'data', args: [resHead] as any };
                    this.send(_data);
                    /**
                     * 写入来自客户端的头部 buffer 内容。
                     */
                    pointSocket.write(head);
                    /**
                     * 将特定事件发送到代理端。
                     * 实测的坑: 不能把所有通过 for 循环注入所有事件。理由上面写了。
                     */
                    pointSocket.on('data', (buf: Buffer) => {
                        const data: ISocketData = { type: 'event', uuid, event: 'data', args: [buf] as any };
                        this.send(data);
                    });
                    pointSocket.on('end', () => {
                        const data: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                        this.send(data);
                    });
                } catch (err) { logger.debug(`createHttpsReq-net.connect-err: ${err}`); }
            });
            /**
             * 踩坑记录:
             *   error 事件的监听需要在外层(也就是这里)，否则内部不能捕捉到 ETIMEDOUT 的错误。
             *   无法通过监听 timeout 事件来捕获 ETIMEDOUT 的报错，应该不是同一个东西。
             *   pointSocket 的报错无法通过 try-catch 来捕获(也就是上面的 try-catch)，它的错误会直接给到最外层，导致程序崩溃。
             */
            pointSocket.on('error', (err) => {
                const data: ISocketData = { type: 'event', uuid, event: 'end', args: [] };
                this.send(data);
                logger.debug(`pointSocket-err: ${err}`);
            });

            this.cacheMap.set(uuid, { type: 'end', target: pointSocket });
        } catch (err) { logger.debug(`createHttpsReq-err: ${err}`); }
    }

}





