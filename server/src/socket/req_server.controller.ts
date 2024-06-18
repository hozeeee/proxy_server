import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { NoticeService } from '../service/notice.service';
import type { AxiosRequestConfig } from 'axios';
import { DEVICE_LIST, type IDeviceId } from '../common/device_config';


/**
 * 说明，
 * 其他需要使用代理的服务，可以通过此路径连接到此服务。
 * 通过制定的数据格式，在此服务发起请求，再拿到响应的数据。
 */


@WSController('/req_server')
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
   *   *.emit('request', <device_id>, config);
   */
  @OnWSMessage('request')
  async handleRequest(deviceId: IDeviceId, config: AxiosRequestConfig) {
    const device = DEVICE_LIST.find(i => i.id === deviceId);
    if (!device?.axiosRequestController) return null;
    const res = await device.axiosRequestController.request(config);
    return res;

    /**
     * TODO: 制定数据格式、处理收到数据的行为
     */

    // const { script_id, success, fail } = data;
    // const res = await this.myRedisService.setScriptStatus(script_id, { success, fail });
    // return res;



  }

}

