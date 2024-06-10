import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, App, } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { ForwardHttpController } from 'forward_end';
/* 勿删! 用于匹配头部生成新 controller 文件 */


interface IDeviceItem<T extends string> {
  id: T;
  name: string;
  forwardHttpController?: ForwardHttpController;
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
}


// 写正则就报错，其他由自制脚本生成 (create_my_controller.js)
@WSController('/local_test')
export class ForwardEndDeviceSocketController {
  @Inject()
  ctx: Context;
  @App('socketIO')
  socketApp: SocketApplication;

  @OnWSConnection()
  async onConnectionMethod() {
    // TODO:
    console.log('onConnectionMethod', this.ctx.id);

    const deviceId = 'local_test'; // TODO:debug
    const ws = Array.from(this.socketApp.of(`/${deviceId}`).sockets.values())[0];
    console.log('=====(ws === this.ctx): ', ws === this.ctx)
    if (!ws) return console.log('.....TODO:')
    const forwardHttpController = DEVICE_LIST.find(i => i.id === 'local_test').forwardHttpController;
    forwardHttpController.useSocketIo(ws as any);
  }
  @OnWSDisConnection()
  async onDisConnectionMethod() {
    // TODO:
    console.log('onDisConnectionMethod', this.ctx.id);
  }
}

