import type { ServerResponse, RequestOptions, IncomingMessage, Server as HttpServer } from 'http';
import type { Socket as NetSocket } from 'net';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';


declare global {

  // 类型推断事件对应的回调的参数
  type IGetServerListenerArgs<E, T = HttpServer<typeof IncomingMessage, typeof ServerResponse>> = T extends { on(event: E, listener: (...args: infer A) => void): void; } ? A : any[];


  type ISocketData<E extends string = string> = ISocketData_HttpConnect | ISocketData_HttpsConnect |
    ISocketData_ServerEvent<E> | ISocketData_SocketEvent<E> | ISocketData_WriteHead;

  interface ISocketData_HttpConnect {
    type: 'connect';
    uuid: string;
    protocol: 'http';
    url: URL;
    option: RequestOptions;
  }
  interface ISocketData_HttpsConnect {
    type: 'connect';
    uuid: string;
    protocol: 'https';
    headers: RequestOptions['headers'];
    port: number;
    hostname: string;
    head: Buffer;
    httpVersion: string;
  }
  interface ISocketData_ServerEvent<E extends string = string> {
    type: 'event';
    uuid: string;
    event: E;
    args: IGetServerListenerArgs<E>;
  }
  interface ISocketData_SocketEvent<E extends string = string> {
    type: 'event';
    uuid: string;
    event: E;
    args: IGetServerListenerArgs<E, NetSocket>;
  }


  interface ISocketData_WriteHead {
    type: 'writeHead';
    uuid: string;
    data: Parameters<ServerResponse['writeHead']>
  }
  // // TODO:废弃
  // interface ISocketData_Data {
  //   type: 'data';
  //   uuid: string;
  //   data: Buffer | string;
  // }
  // interface ISocketData_End {
  //   type: 'end';
  //   uuid: string;
  // }




  /**
   * 转发 axios 的请求的相关类型。
   */
  type ISocketDataToAxios_Req<D = any> = {
    type: 'request';
    config: AxiosRequestConfig<D>;
  }
  type ISocketDataToAxios_Res<T = any, D = any> = {
    type: 'response';
    data: AxiosResponse<T, D>;
  }
  type ISocketDataToAxios = ISocketDataToAxios_Req | ISocketDataToAxios_Res;

}




