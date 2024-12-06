import { App, Configuration, ILifeCycle, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import * as egg from '@midwayjs/web';
import * as staticFile from '@midwayjs/static-file';
import { HttpProxyEntranceService, startWhistleProxyServer } from './service/http_proxy_entrance.service';
import { NativeWsService } from './service/native_ws.service';
import * as socketio from '@midwayjs/socketio';
import { downloadConfig, startClash } from './common/clash_controller';

// TODO: 关于 chii 脚本注入的功能，暂时不可用
// import { GetDomainMiddleware } from './middleware/get_domain.middleware';
// import { copyErudaToPublish, restoreChiiConfigFromCacheFile, startChiiServer } from './service/chii_manager.service';


@Configuration({
  imports: [egg, staticFile, socketio],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration implements ILifeCycle {
  @App('egg')
  app: egg.Application;

  async onReady() {
    // this.app.useMiddleware(GetDomainMiddleware);
  }


  async onServerReady(container: IMidwayContainer) {
    const proxyEntranceService = await container.getAsync(HttpProxyEntranceService);
    proxyEntranceService.startServers();
    // startWhistleProxyServer();

    const nativeWsService = await container.getAsync(NativeWsService);
    nativeWsService.startServer();


    if (this.app.config.env === 'local') return; /******** 调试分割线(下面正式代码，本地调试不会执行) ********/

    startClash();
    // restoreChiiConfigFromCacheFile();
    // startChiiServer();
    // copyErudaToPublish();
    startWhistleProxyServer();


  }
}
