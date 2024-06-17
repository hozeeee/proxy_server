import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { ForwardHttpController, AxiosRequestController } from 'forward_end';
import { NoticeService } from '../service/notice.service';
/* 勿删! 用于匹配头部生成新 controller 文件 */


interface IDeviceItem<T extends string> {
  id: T;
  name: string;
  forwardHttpController?: ForwardHttpController;
  axiosRequestController?: AxiosRequestController;
}
export type IDeviceId =
  'local_test' |
  'n2840';


/**
 * 已有设备需要在这里提前配置
 */
export const DEVICE_LIST: IDeviceItem<IDeviceId>[] = [
  { id: 'local_test', name: '本地测试', forwardHttpController: undefined, },
  { id: 'n2840', name: '村工控机', forwardHttpController: undefined, },
];
for (const item of DEVICE_LIST) {
  item.forwardHttpController = new ForwardHttpController();
  item.axiosRequestController = new AxiosRequestController();
}


// 写正则就报错，其他由自制脚本生成 (create_my_controller.js)
@WSController('/local_test')
export class ForwardEndDeviceSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;
  @Inject()
  noticeService: NoticeService;



  @OnWSConnection()
  async onConnectionMethod() {
    const deviceId: IDeviceId = 'local_test';
    const deviceConfig = DEVICE_LIST.find(i => i.id === deviceId);
    if (!deviceConfig) {
      this.noticeService.onNormalError(`在 onConnectionMethod 找不到 ${deviceId} 设备 ID 的配置`);
      return;
    }
    const ws = Array.from(this.socketApp.of(`/${deviceId}`).sockets.values())[0];
    if (!ws) {
      this.noticeService.onNormalError(`在 onConnectionMethod 找不到 ${deviceId} 设备 ID 的 socket`);
      return;
    }

    /**
     * 设备上线通知
     */
    this.noticeService.onDeviceOnline(deviceId);
    /**
     * "代理转发"绑定通道。
     */
    deviceConfig.forwardHttpController.useSocketIo(ws as any);
    deviceConfig.axiosRequestController.useSocketIo(ws as any);

    // TODO: 后续扩展其他，例如: 远程控制，命令行转发，端口转发等。
  }


  @OnWSDisConnection()
  async onDisConnectionMethod() {
    const deviceId: IDeviceId = 'local_test';
    const deviceConfig = DEVICE_LIST.find(i => i.id === deviceId);
    if (!deviceConfig) {
      this.noticeService.onNormalError(`在 onDisConnectionMethod 找不到 ${deviceId} 设备 ID 的配置`);
      return;
    }

    /**
     * 设备离线通知
     */
    this.noticeService.onDeviceOffline(deviceId);
    /**
     * "代理转发"销毁。
     */
    deviceConfig.forwardHttpController.clear();

  }

}

