import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import type { IncomingMessage, RequestOptions, ServerResponse, ClientRequest } from 'http';
import type { Readable, Stream } from 'stream';
import { nanoid as uuidCreator } from 'nanoid/non-secure';
import type { Socket as ISocketClient } from 'socket.io-client';
import type { Duplex } from 'stream';
import type { Socket as INetSocket } from 'net';



/**
 * 说明，
 * 接受来自对端的 http 服务的请求数据，例如 on('data') ，
 * 在此处创建 http(s) 请求，
 * 同样的把 on('data') 的数据返回给对端。
 * 
 * 
 * 对于前端的使用:
 *   1. 前端通过 api 发送 connect 的指令，数据包含 port, deviceId 的信息。
 *   2. 服务端收到接口信息，发送通知被控制端连接 vnc 服务。
 *   3. 数据转发规则设定好后，服务端给前端一个信息，让其知道可以连接服务端的 socket 。
 *   4. 前端知道可以开始连接了，就对 websocket 的端口进行连接。(用的是 midway 的 websocket，而非 socket.io，原因是 RFB 用的是 websocket 的连接。有必要的话，可以研究源码进行改动)
 *   5. 服务端收到前端的 socket 连接，开始数据转发。
 * 使用细节:
 *   1. 在"前端发送 api 通知"到"socket 连接服务器"的两个操作之间，可能会存在边界情况。
 *   2. 假设发送了 api ，服务端也把指令发送到被控制端，但前端后面没有发起到服务端 socket 连接。这种问题应该增加一个超时设定。
 *   3. 如果被控制端主动断开，服务端如何处理？
 */




/**
 * 获取 vnc 的端口。
 * 说明，
 *   1. 目前的设定是只启动一个 vnc 服务，具体怎么获取端口号在下面补充逻辑。
 *   2. 代码上兼容后续的多 vnc 服务，通过 type 为 'connect' 的数据中带上 port 参数连接。
 *   3. 后面应该需要扩充事件，支持创建 vnc 服务。 TODO:
 */




/**
 * TODO:
 * 测试列表：
 *   [√] 1. 前端页面关闭，后端&终端是否会收到断开指令。
 *   [√] 2. 前端重复对相同设备的 vnc 服务发送连接，需要禁止。
 *   [√] 3. 前端手动发送 close ，是否生效。
 *   [√] 4. 服务器意外关闭，终端是否会收到断开指令。
 *   [√] 5. 服务器意外关闭，终端是否会清空对 vnc 服务的连接。
 * // TODO: 需要真实的机器把网线测试
 *   [ ] 6. 终端断开连接，机器没有重启，是否会重连。
 *   [ ] 7. 终端断开连接，机器没有重启，此时服务器&前端两个 socket 会断开吗。
 *   [ ] 8. 终端断开连接，机器没有重启，对 vnc 服务器的连接是否有断开。
 */




const SOCKET_EVENT_NAME = '__tigervnc_forward';


type ISocketCallback = (socketResp: ISocketDataToTigervncServer) => void;

/**
 * 用来接管 socket 的数据。
 * 无论是服务端还是代理端，都只有一个实例，用于对接 socket 即可。
 */
export class TigervncForwardController {
  static get socketEventName() { return SOCKET_EVENT_NAME; }


  /**
   * 记录之前的 socket 和 on 回调。
   * 当重复调用 useSocketIo 时，需要把旧的删除。
   */
  private serverToEndSocket: ISocketClient | undefined = undefined;
  private serverToEndSocketListener: ((...args: any[]) => void) | undefined = undefined;

  /**
   * 直接使用 socket.io 的实例注入方法。
   */
  useSocketIo(socket: ISocketClient) {
    // 清空旧的回调
    try {
      if (this.serverToEndSocket && this.serverToEndSocketListener) {
        this.serverToEndSocket.off(SOCKET_EVENT_NAME, this.serverToEndSocketListener);
        this.serverToEndSocket = undefined;
        this.serverToEndSocketListener = undefined;
        this.disconnectAllVnc();
      }
    } catch (_) { }

    // 配置
    const listener = async (rawData: ISocketDataToTigervncServer, callback: ISocketCallback) => {
      try {
        const { type, port } = rawData;
        switch (type) {
          /**
           * [被控制端]
           * 被控制端收到"连接 vnc 服务"的信号。
           * 创建对本地端口的连接。
           * 将 vnc 服务的数据都转发过去。
           */
          case 'connect': {
            console.log('debug: ', 'connect') // TODO:del
            // 设置 vnc 服务 onData 的回调
            const vncServerDataListener = (_data: Buffer) => {
              const emitData: ISocketDataToTigervncServer_ToClientData = {
                type: 'to_client_data',
                port,
                data: _data,
              }
              socket.emit(SOCKET_EVENT_NAME, emitData);
            }
            const res = this.connectVnc(port, vncServerDataListener);
            // 返回操作结果
            const ackData: ISocketDataToTigervncServer_Ack = { type: 'connect_ack', port, data: res, }
            callback(ackData);
            break;
          }
          /**
           * [被控制端]
           * 当控制端关闭了连接，
           * 在被控制端与 vnc 服务的连接也需要断开。
           */
          case 'disconnect': {
            console.log('debug: ', 'disconnect') // TODO:del
            const res = this.disconnectVnc(port);
            // 返回操作结果
            const ackData: ISocketDataToTigervncServer_Ack = { type: 'connect_ack', port, data: res, }
            callback(ackData);
            break;
          }
          /**
           * [被控制端]
           * 接收到来自控制端的数据，
           * 把数据都转发到 vnc 服务。
           */
          case 'to_vnc_data': {
            const { data, } = rawData;
            const toVncSocket = this.portSocketMap.get(port);
            console.log('debug: ', 'to_vnc_data') // TODO:del
            if (!toVncSocket) {
              // 理论上不会走到这里，兼容特殊情况
              const clientEndData: ISocketDataToTigervncServer_ClientEnd = {
                type: 'client_end',
                port,
              }
              socket.emit(SOCKET_EVENT_NAME, clientEndData);
              break;
            }
            toVncSocket.write(data);
            break;
          }

          /**
           * [服务端]
           * 服务端收到被控制端的数据。
           */
          case 'to_client_data': {
            const { data, } = rawData;
            console.log('debug: ', 'to_client_data', !!this.clientSocket, data instanceof Uint8Array, data instanceof ArrayBuffer) // TODO:del
            if (!this.clientSocket) {
              // 收到数据，但前端已经断开连接。通知被控制端也断开长连接。
              this.disconnect(port);
              break;
            }
            this.clientSocket.send(data);
            break;
          }
          /**
           * [服务端]
           * 被控制端出现异常，需要把服务端对前端的连接关闭。
           */
          case 'client_end': {
            console.log('debug: ', 'client_end') // TODO:del
            if (!this.clientSocket) break;
            this.clientSocket.close();
            break;
          }

        }
      } catch (_) { }
    }
    socket.on(SOCKET_EVENT_NAME, listener);

    /**
     * [被控制端]
     * 断开了与服务器之间的连接，就把所有的 vnc 服务连接清空。
     * 虽然服务端也会触发，但也不影响。
     */
    socket.on('disconnect', () => {
      this.disconnectAllVnc();
    });

    // 记录(用于清理)
    this.serverToEndSocket = socket;
    this.serverToEndSocketListener = listener;
  }


  /**
   * [服务端]
   * 当前端通过 api 通知服务端时调用。
   */
  connect(port: number) {
    return this.connectOrDisconnect('connect', port);
  }
  disconnect(port: number) {
    return this.connectOrDisconnect('disconnect', port);
  }
  private async connectOrDisconnect(fnType: 'connect' | 'disconnect', port: number): Promise<ISocketDataToTigervncServer_Ack['data'] | null> {
    try {
      const connectData: ISocketDataToTigervncServer_Connect | ISocketDataToTigervncServer_Disconnect = {
        type: fnType,
        port,
      }
      const res = await new Promise<ISocketDataToTigervncServer_Ack['data'] | null>((resolve) => {
        if (!this.serverToEndSocket) {
          resolve({ success: false, message: '与被代理端连接的 socket 不存在' });
          return;
        }
        const respListener: ISocketCallback = (socketResp) => {
          try {
            const { type } = socketResp;
            if (type !== 'connect_ack' && type !== 'disconnect_ack') {
              resolve(null);
              return;
            }
            resolve(socketResp.data);
          } catch (_) {
            resolve(null);
          }
        }
        this.serverToEndSocket.emit(SOCKET_EVENT_NAME, connectData, respListener);
      });
      return res;
    } catch (err: any) {
      return { success: false, message: `执行 ${fnType} 时异常: ${err?.message || err}` }
    }
  }


  /**
   * [服务端]
   * 控制端除了上面使用 useSocketIo 接收通用数据，
   * 还需要创建一个 socket 提供给 UI 界面访问。
   * 前端示例代码:
   *   const rfb = new RFB(dom, 'ws://127.0.0.1:6082', { credentials: { password: '19931115', }, });
   */
  setReceiveWebsocket(ws: WebSocket, port: number) {
    // 清理旧的
    if (this.clientSocket) {
      this.clientSocket.onmessage = () => { };
      this.clientSocket.onclose = () => { };
    }
    // 与被控制端的数据传输 socket 如果还没有，那就不用下面的步骤了。
    if (!this.serverToEndSocket) return;
    // 发送断开指令
    const handleEnd = () => {
      const endData: ISocketDataToTigervncServer_Disconnect = {
        type: 'disconnect',
        port,
      }
      this.serverToEndSocket?.emit(SOCKET_EVENT_NAME, endData);
    }
    ws.onclose = handleEnd;
    // 转发数据
    const handleMessage = (ev: MessageEvent) => {
      const { data } = ev;
      const emitData: ISocketDataToTigervncServer_ToVncData = {
        type: 'to_vnc_data',
        port,
        data,
      }
      this.serverToEndSocket?.emit(SOCKET_EVENT_NAME, emitData);
    }
    ws.onmessage = handleMessage;
    this.clientSocket = ws;
  }
  private clientSocket?: WebSocket = undefined;


  /**
   * [被控制端]
   * 已配置转发的端口需要记录起来。
   */
  private portSocketMap: Map<number, INetSocket> = new Map();
  /**
   * [被控制端]
   * 创建对 tigervnc 服务的数据转发。
   */
  private connectVnc(port: number, onData: (_data: Buffer) => void): ISocketDataToTigervncServer_Ack['data'] {
    try {
      const hasToVncSocket = this.portSocketMap.has(port);
      if (hasToVncSocket) return { success: false, message: `端口(${port})已创建了连接`, };

      const host = '127.0.0.1';
      const target = net.createConnection(port, host, () => {
        console.log('connected to target: ', host, port);
      });
      target.on('data', onData);
      target.on('end', () => {
        this.disconnectVnc(port);
      });
      target.on('error', (err) => {
        console.log('target connection error: ', err?.message);
        target.end();
      });
      this.portSocketMap.set(port, target);
      return { success: true, message: '' };
    } catch (err: any) {
      return { success: false, message: `执行 connectVnc 执行异常: ${err?.message || err}`, };
    }
  }
  /**
   * [被控制端]
   * 被控制端特有。
   * 停止对 tigervnc 服务的数据转发。
   */
  private disconnectVnc(port: number): ISocketDataToTigervncServer_Ack['data'] {
    try {
      const toVncSocket = this.portSocketMap.get(port);
      if (!toVncSocket) return { success: true, message: `端口(${port})对应的 socket 找不到`, };
      this.portSocketMap.delete(port);
      toVncSocket.end();
      return { success: true, message: '', };
    } catch (err: any) {
      return { success: false, message: `执行 disconnectVnc 执行异常: ${err?.message || err}`, };
    }
  }
  /**
   * [被控制端]
   * 清空操作。
   */
  private disconnectAllVnc() {
    try {
      const list = Array.from(this.portSocketMap.entries());
      for (const [_, socket] of list) {
        try {
          socket.end();
        } catch (_) { }
      }
      this.portSocketMap.clear();
    } catch (_) { }
  }

}





