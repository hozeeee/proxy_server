import { WSController, OnWSConnection, Inject, OnWSMessage, OnWSDisConnection, } from '@midwayjs/decorator';
import { Context } from '@midwayjs/socketio';



// 写正则就报错，其他由自制脚本生成 (create_proxy_controller.js) // TODO:
@WSController('/local_test')
export class ProxyDeviceSocketController {
  @Inject()
  ctx: Context;

  @OnWSConnection()
  async onConnectionMethod() {
    // TODO:
    console.log('onConnectionMethod', this.ctx.id);
  }
  @OnWSDisConnection()
  async onDisConnectionMethod() {
    // TODO:
    console.log('onDisConnectionMethod', this.ctx.id);
  }
}

