import { App, Context, Inject, Provide } from '@midwayjs/core';
import { Application as SocketApplication } from '@midwayjs/socketio';
import http, { IncomingHttpHeaders } from 'http';
import { ServerToServerSocketController } from '../socket/s2s.controller';


/**
 * 说明:
 *   1. 此服务用于 whistle.req_log 拦截后的上报。
 */


interface ILogItem {
  url: string;
  reqHeaders: IncomingHttpHeaders;
  createAt: number;
}

// const _logList: ILogItem[] = [];

@Provide()
export class WhistleReqLogService {
  // @App('socketIO')
  // socketApp: SocketApplication;
  @Inject()
  s2sSocketController: ServerToServerSocketController;

  // private logList = _logList;

  uploadLog(url: string, reqHeaders: IncomingHttpHeaders) {
    const createAt = Date.now();
    const data = { url, reqHeaders, createAt, }
    // this.logList.unshift({ url, reqHeaders, createAt, });

    // 发送给订阅的服务
    const socketList = Array.from(this.s2sSocketController.subscribe_whistle_map.values());
    for (const socket of socketList) {
      socket.emit('on_subscribe_whistle_data', data);
    }
  }

}
