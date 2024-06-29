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
    data: AxiosResponse<T, D> | null;
    success: boolean;
    message: string;
  }
  type ISocketDataToAxios = ISocketDataToAxios_Req | ISocketDataToAxios_Res;


  /**
   * 转发 tigervnc 服务的数据。
   * 控制的通道只有一条。
   * 提供 force_disconnect 来强制关闭原来的，应对特殊的边界情况。
   * port 作为唯一标识，即一个 vnc 服务职能有一个控制端连接。
   * 'client_end' 是被控制端通知控制端需要关闭连接，可能是被控制端出现问题导致的断开。
   */
  type ISocketDataToTigervncServer =
    ISocketDataToTigervncServer_Connect |
    ISocketDataToTigervncServer_Disconnect |
    ISocketDataToTigervncServer_Ack |
    ISocketDataToTigervncServer_ToVncData |
    ISocketDataToTigervncServer_ToClientData |
    ISocketDataToTigervncServer_ClientEnd;
  type ISocketDataToTigervncServer_Connect = {
    type: 'connect';
    port: number; // 15901
    // TODO: 弃用 force_disconnect ，增加参数，表示强制连接，删除旧的
  }
  type ISocketDataToTigervncServer_Disconnect = {
    type: 'disconnect';
    port: number;
  }
  type ISocketDataToTigervncServer_Ack = {
    type: 'connect_ack' | 'disconnect_ack';
    port: number;
    data: { success: boolean; message: string; }
  }
  type ISocketDataToTigervncServer_ForceDisconnect = {
    type: 'force_disconnect';
    port: number;
  }
  type ISocketDataToTigervncServer_ToVncData = {
    type: 'to_vnc_data';
    port: number;
    data: Buffer;
  }
  type ISocketDataToTigervncServer_ToClientData = {
    type: 'to_client_data';
    port: number;
    data: Uint8Array; // Buffer;
  }
  type ISocketDataToTigervncServer_ClientEnd = {
    type: 'client_end';
    port: number;
  }

}




