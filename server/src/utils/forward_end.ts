import http from 'http';
import https from 'https';
import type { IncomingMessage, RequestOptions, ServerResponse } from 'http';
import type { Readable, Stream } from 'stream';
import { nanoid as uuidCreator } from 'nanoid/non-secure';



type IEndListener<E extends string = string> = (event: E, args: IGetServerListenerArgs<E, Readable>) => void;

export function createHttpProxy(params: ISocketData_HttpConnect, listener: IEndListener) {
  const { url, option } = params;
  const proxyReq = http.request(url, option, (proxyResp) => {
    for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
      proxyResp.on(event, (...args) => listener(event, args));
    }
  });
  return proxyReq;
}


/**
 * 将客户端请求的内容转发
 *
 * 参考 http.createServer 回调的参数。
 */
type IServerListener<E extends string = string> = (event: E, args: IGetServerListenerArgs<E, Readable>) => void;
export function createHttpForward(clientReq: IncomingMessage, clientRes: ServerResponse, listener: IServerListener) {

  for (const event of ['close', 'data', 'end', 'error', 'pause', 'readable', 'resume']) {
    clientReq.on(event, (...args) => {
      listener(event, args);
    });
  }

}

export function jointListener(serverListener: IServerListener, endListener: IEndListener) {

}



/**
 * 'server' 是服务器调用，接受客户端数据；
 * 'end' 是代理端调用，发起请求。
 */
type IOptions = {
  // 用于接收数据的方法
  send?: (data: ISocketData) => void;
  // // 用于发送数据的方法
  receive: (data: ISocketData) => void;
} & ({
  type: 'server';
  params: { req: IncomingMessage; res: ServerResponse; }
} |
{
  type: 'end';
  params: ISocketData_HttpConnect
});



let _forwardHttpController: ForwardHttpController;
export function getSingleton() {
  if (_forwardHttpController) return _forwardHttpController;
  // return new ForwardHttpController();
}

/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
export class ForwardHttpController {

  // TODO: 怎么销毁此对象?
  private uuid: string;
  private options: IOptions;
  private send: IOptions['send'];

  constructor(options: IOptions) {
    const { send,  } = options;
    this.options = { ...options };
    this.send = send;
    const uuid = uuidCreator();
    this.uuid = uuid;

  }

  /**
   * 外部调用此方法，将数据注入到这里。
   * 初始化的时候会声明此方法。
   */
  receive: (data: ISocketData) => void;

  setSender(send: IOptions['send']) {
    if (this.send) {
      console.log('send 已设定，不能更改')
      return;
    }
    this.send = send;
  }

  startForward() {
    if (!this.send)
      throw new Error('send 未提供');

    const { type } = this.options;
    if (type === 'end') this.startEndForward();
    else if (type === 'server') this.startServerForward();
  }

  /**
   * 代理端发起请求。
   */
  private startEndForward() {

    // if (type === 'connect') {
    // TODO: 不应该直接启动，应该是由 服务端 发送 'connect' 事件才执行。


    if (this.options.type !== 'end') return;
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
          const data: ISocketData = {
            type: 'event',
            uuid,
            event,
            args: args as any,
          }
          this.send(data);
        });
      }
    });
    /**
     * 处理接收到的数据。
     */
    this.receive = (function (_data: ISocketData<string>) {
      const { type: dataType, } = _data;
      if (dataType === 'event') {
        const { event, args } = _data as ISocketData_ServerEvent<'data'>;
        console.log('----', event, args)
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
  private startServerForward() {
    if (this.options.type !== 'server') return;
    const { req: clientReq, res: clientRes } = this.options.params;
    const uuid = this.uuid;
    /**
     * 发送自定义事件
     * 通知对方创建 http 请求。
     */
    const url = new URL(`http://${clientReq.url.replace('https://', '').replace('http://', '')}`);
    const option: RequestOptions = {
      method: clientReq.method,
      headers: clientReq.headers,
    }
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
        const data: ISocketData = {
          type: 'event',
          uuid,
          event,
          args: args as any,
        }
        this.send(data);
      });
    }
    /**
     * 处理接收到的数据。
     */
    this.receive = (function (_data: ISocketData<string>) {
      const { type: dataType, } = _data;
      if (dataType === 'writeHead') {
        const { data } = _data;
        clientRes.writeHead(...data)
        return;
      }
      if (dataType === 'event') {
        const { event, args } = _data as ISocketData_ServerEvent<'data'>;
        console.log('=====', event, args)
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





