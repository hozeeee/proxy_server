import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { NoticeService } from '../service/notice.service';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { DEVICE_LIST, type IDeviceId } from '../common/device_config';
import { proxyRequestAxios } from '../common/proxy_methods';


/**
 * 说明，
 * 其他需要使用代理的服务或程序，可以通过此路径连接到此服务。
 * 通过制定的数据格式，在此服务发起请求，再拿到响应的数据。
 */


@WSController('/proxy_socket')
export class ReqServerSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;
  @Inject()
  noticeService: NoticeService;


  @OnWSConnection()
  async onConnectionMethod() {

    /**
     * TODO:
     * 1. 订阅设备上/下线的通知
     */

  }


  @OnWSDisConnection()
  async onDisConnectionMethod() {

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
  @OnWSMessage('request_axios')
  async handleRequestAxios(deviceId: IDeviceId, config: AxiosRequestConfig) {
    return await proxyRequestAxios(deviceId, config);
  }

}

