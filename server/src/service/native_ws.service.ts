import { Inject, Provide } from '@midwayjs/core';
import { App, } from '@midwayjs/decorator';
import { Application as SocketApplication } from '@midwayjs/socketio';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import { nativeWsPort as port } from '../config/port.config';
import { ProxyHubService } from './proxy_hub.service';
import { WebSocketServer } from 'ws';
import { DEVICE_LIST } from '../common/device_config';
import type { WebSocket as WsWebSocket, Server as WsServer } from 'ws';
import type { ServerResponse, IncomingMessage } from 'http';
import type { IDeviceId } from '../common/device_config';


/**
 * 说明，
 * 本服服务用于创建支持原生 WebSocket 的服务。
 * 目前主要是 RFB(前端连接 vnc 服务的库) 用的就是 WebSocket ，
 * 尝试过用 socket.io 转发，没有办法完全复刻该行为。
 */



// 防止重复启动
let _server: http.Server<typeof IncomingMessage, typeof ServerResponse> | undefined = undefined;

@Provide()
export class NativeWsService {
  // @Inject()
  // proxyHubService: ProxyHubService;
  @App('socketIO')
  socketApp: SocketApplication;

  /**
   * 根据路径再创建 Websocket 服务器。
   */
  private wssMap = new Map<string, WsServer<typeof WsWebSocket, typeof IncomingMessage>>();

  startServer() {
    if (_server) return;
    const server = http.createServer();
    server.on('upgrade', (request, socket, head) => {
      /**
       * 解析设备号和 vnc 端口号   (格式: /to_vnc/<device_id>/<vnc_port>)
       * 通过此方式，能够使用"路径"作为传参的方式，
       * 便于给不同的服务和端口发送连接数据。
       */
      const { pathname } = new URL(request.url, `ws://127.0.0.1:${port}`);
      const matchRes = pathname.match(/^\/to_vnc\/(\w+)\/(\d+)$/);
      if (!matchRes) {
        socket.destroy();
        return;
      }
      // 参数解析
      const deviceId = matchRes[1] as IDeviceId;
      const deviceConfig = DEVICE_LIST.find(i => i.id === deviceId);
      const vncPort = Number(matchRes[2]);
      if (!vncPort || !deviceConfig) {
        socket.destroy();
        return;
      }
      // const toEndWs = Array.from(this.socketApp.of(`/${deviceId}`).sockets.values())[0];
      // if (!toEndWs) {
      //   socket.destroy();
      //   return;
      // }
      // 创建 Websocket 服务 & 配置转发
      const wss = new WebSocketServer({ noServer: true });
      wss.on('connection', async (clientWs) => {
        const connectRes = await deviceConfig.tigervncForwardController.connect(vncPort);
        if (!connectRes.success) {
          console.error(`vnc-connect-error: ${connectRes.message}`); // TODO:给前端？
          return;
        }
        /**
         * 心跳检测 (不写不会触发 close 事件)
         * 如果前端直接关页面，且不配置心跳，就会导致服务器无法知道它断开了。
         */
        (clientWs as any).isAlive = true;
        clientWs.on('error', console.error);
        clientWs.on('pong', () => (clientWs as any).isAlive = true);
        /**
         * 将 clientWs 交给内部库处理。
         * 主要是用于数据的接收和发送。
         */
        deviceConfig.tigervncForwardController.setReceiveWebsocket(clientWs as unknown as WebSocket, vncPort);
        // 中断处理
        clientWs.on('error', (err) => {
          console.error(err);
        });
        clientWs.on('close', () => {
          console.log('ws-disconnected'); // TODO:del
          deviceConfig.tigervncForwardController.disconnect(port);
        });
      });
      wss.handleUpgrade(request, socket, head, (_clientWs) => {
        wss.emit('connection', _clientWs, request);
      });
      /**
       * 服务器定期对所有连接发送心跳。
       * 与上面的心跳配置配套。
       */
      const interval = setInterval(() => {
        for (const _clientWs of wss.clients) {
          if ((_clientWs as any).isAlive === false) {
            _clientWs.terminate();
            continue;
          }
          (_clientWs as any).isAlive = false;
          _clientWs.ping();
        }
      }, 5 * 1000);
      wss.on('close', () => {
        console.log('wss--disconnected'); // TODO:del
        clearInterval(interval);
      });

    });
    _server = server;
    server.listen(port, () => {
      console.log(`native-websocket-server:    http://127.0.0.1:${port}/`);
    });

  }




}
