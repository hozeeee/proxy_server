import { App, Configuration, ILifeCycle, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import * as egg from '@midwayjs/web';
// import { start as startHttpProxy } from './proxy_main';
import { ProxyEntranceService } from './service/proxy_entrance.service';
import * as socketio from '@midwayjs/socketio';


@Configuration({
  imports: [egg, socketio],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration implements ILifeCycle {
  @App('egg')
  app: egg.Application;

  async onReady() {
    // startHttpProxy();


  }


  async onServerReady(container: IMidwayContainer) {
    const proxyEntranceService = await container.getAsync(ProxyEntranceService);
    proxyEntranceService.startServer();

    if (this.app.config.env === 'local') return; /******** 调试分割线(下面正式代码，本地调试不会执行) ********/

  }
}
