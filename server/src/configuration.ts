import { App, Configuration, ILifeCycle, IMidwayContainer } from '@midwayjs/core';
import { join } from 'path';
import * as egg from '@midwayjs/web';
import * as staticFile from '@midwayjs/static-file';
import { ProxyEntranceService } from './service/proxy_entrance.service';
import { NativeWsService } from './service/native_ws.service';
import * as socketio from '@midwayjs/socketio';
import { downloadConfig, startClash } from './common/clash_controller';


@Configuration({
  imports: [egg, staticFile, socketio],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration implements ILifeCycle {
  @App('egg')
  app: egg.Application;

  async onReady() {

  }


  async onServerReady(container: IMidwayContainer) {
    const proxyEntranceService = await container.getAsync(ProxyEntranceService);
    proxyEntranceService.startServer();

    const nativeWsService = await container.getAsync(NativeWsService);
    nativeWsService.startServer();



    // TODO:下载地址弄成配置文件
    // await downloadConfig('https://a9255d35-f774-3cfe-9a91-abaadf3318f4.nginxcave.xyz/link/ZWwakjF4eVPCHwcg?clash=1');
    startClash();

    if (this.app.config.env === 'local') return; /******** 调试分割线(下面正式代码，本地调试不会执行) ********/

  }
}
