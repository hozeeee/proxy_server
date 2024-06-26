import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { NoticeService } from '../service/notice.service';
import type { IDeviceId } from '../common/device_config';
import { DEVICE_LIST } from '../common/device_config';
/* 勿删! 用于匹配头部生成新 controller 文件 */



// 写正则就报错，其他由自制脚本生成 (create_my_controller.js)
@WSController('/to_vnc/local_test')
export class ForwardEndDeviceSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;
  @Inject()
  noticeService: NoticeService;



  @OnWSConnection()
  async onConnectionMethod() {
    console.log('onConnectionMethod: ') // TODO:del
    const deviceId: IDeviceId = 'local_test';
    const deviceConfig = DEVICE_LIST.find(i => i.id === deviceId);
    if (!deviceConfig) {
      console.log('onConnectionMethod-no-deviceConfig') // TODO:del
      // this.noticeService.onNormalError(`在 onConnectionMethod 找不到 ${deviceId} 设备 ID 的配置`); // TODO: 恢复代码
      // TODO: 断开与前端的 ws 连接
      return;
    }
    const ws = Array.from(this.socketApp.of(`/${deviceId}`).sockets.values())[0];
    if (!ws) {
      console.log('onConnectionMethod-no-ws') // TODO:del
      // this.noticeService.onNormalError(`在 onConnectionMethod 找不到 ${deviceId} 设备 ID 的 socket`); // TODO: 恢复代码
      // TODO: 断开与前端的 ws 连接
      return;
    }

    // const port = 5901;
    // deviceConfig.tigervncForwardController.setReceiveSocketIo(this.ctx as any, port);
    // deviceConfig.tigervncForwardController.connect(port);

    // setInterval(() => {
    //   ws.emit('my-msg', 'xxxx-1');
    //   this.ctx.emit('my-msg', 'xxxx-2');
    // }, 5 * 1000)
  }


  @OnWSDisConnection()
  async onDisConnectionMethod() {
    console.log('onDisConnectionMethod: ') // TODO:del

    const deviceId: IDeviceId = 'local_test';
    const deviceConfig = DEVICE_LIST.find(i => i.id === deviceId);
    if (!deviceConfig) {
      console.log('onConnectionMethod-no-deviceConfig') // TODO:del
      // this.noticeService.onNormalError(`在 onDisConnectionMethod 找不到 ${deviceId} 设备 ID 的配置`); // TODO: 恢复代码
      return;
    }

    // const port = 5901;
    // deviceConfig.tigervncForwardController.disconnect(port);
  }



  // /**
  //  * 发送请求。
  //  * 保持和原生的 Websocket 相同的事件名。
  //  */
  // @OnWSMessage('message')
  // async handleRequest(data: any) {

  //   console.log('====', data, typeof data) // TODO:del

  // }

}

