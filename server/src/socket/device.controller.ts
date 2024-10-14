import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { NoticeService } from '../service/notice.service';
import type { IDeviceId } from '../common/device_config';
import { DEVICE_LIST } from '../common/device_config';
/* 勿删! 勿改! 用于匹配头部生成新 controller 文件。上面内容都会被作用于新文件。 */


/**
 * 说明:
 *   1. 此文件会被 create_my_controller.js 读取，并通过正则解析，然后生成所有代理设备的路径接口。
 *   2. 设备会通过同名路径，使用 socket.io 连接到此服务。
 *   3. 使用 serverPort 接入到此服务。
 */


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
    deviceConfig.tigervncForwardController.useSocketIo(ws as any);
    deviceConfig.commandUseBridge.useSocketIo(ws as any);
    deviceConfig.commandUseBridge.heartbeatInterval();

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

