import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { NotificationService } from '../service/notification.service';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { type IDeviceId } from '../common/device_config';
import { AxiosProxyEntranceService } from '../service/axios_proxy_entrance.service';


/**
 * 说明，
 *   1. 其他服务器与此服务对接，使用此路径。
 *   2. 功能包括，设备列表的查询、设备上/下线的通知订阅。
 *   3. 通过制定的数据格式，在此服务发起请求，再拿到响应的数据。
 */

const _subscribe_whistle_map = new Map<string, Context>();

@WSController('/s2s_socket')
export class ServerToServerSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;
  @Inject()
  notificationService: NotificationService;
  @Inject()
  axiosProxyEntranceService: AxiosProxyEntranceService;

  // 订阅 whistle 上报的信息。
  subscribe_whistle_map = _subscribe_whistle_map;

  @OnWSConnection()
  async onConnectionMethod() {

    /**
     * TODO:
     * 1. 订阅设备上/下线的通知
     */

  }


  @OnWSDisConnection()
  async onDisConnectionMethod() {
    this.subscribe_whistle_map.delete(this.ctx.id);

    /**
     * TODO:
     * 1. 销毁订阅设备上/下线的通知
     */

  }


  /**
   * 发送请求。
   * 示例:
   *   *.emit('request_axios', <device_id>, config);
   */
  @OnWSMessage('axios_request')
  async handleRequestAxios(deviceId: IDeviceId, config: AxiosRequestConfig) {
    return await this.axiosProxyEntranceService.request(deviceId, config);
  }



  /**
   * 发送订阅 whistle 上报数据。
   * 不需要参数。
   */
  @OnWSMessage('subscribe_whistle')
  async handleSubscribeWhistle() {
    this.subscribe_whistle_map.set(this.ctx.id, this.ctx);
  }

}

