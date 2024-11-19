
import { Inject, Controller, Post, Query, Get, Body } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { WhistleReqLogService } from '../service/whistle_req_log.service';
import { IncomingHttpHeaders } from 'http';




@Controller('/api/whistle')
export class APIDeviceController {
  @Inject()
  ctx: Context;
  @Inject()
  whistleReqLogService: WhistleReqLogService;


  // 下载证书
  @Get('/ca')
  async getCa(@Query('type') type: 'cer' | 'pem' | 'crt' = 'crt'): Promise<any> {
    type = ['cer', 'pem', 'crt'].includes(type) ? type : 'crt';
    const filename = `rootCA.${type}`;
    this.ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
    const body = await this.whistleReqLogService.getWhistleCa(type);
    this.ctx.body = body;
  }


  // 插件接入专用！
  @Post('/req_log')
  async req_log(@Body() body): Promise<any> {
    return this.whistleReqLogService.uploadLog(body);
  }


  /**
   * 下载 pac 文件。
   * 通过 /dynamic/proxy.pac 动态生成 pac 文件，示例: /dynamic/proxy.pac?host_matches=*.xxx.cn,*.yyy.com
   *
   * 踩坑记录:
   *   1. 安装代理通过 wifi 设置，但需要安装代理证书(通过上面的接口下载)，否则不会生效。
   */
  @Get('/proxy.pac')
  async getPacFile() {
    const pacContent = this.whistleReqLogService.getPacFile(['*.gov.cn'], 'DIRECT', true);
    this.ctx.set('Content-Type', 'application/x-ns-proxy-autoconfig');
    this.ctx.set('Content-Disposition', 'attachment; filename="proxy.pac"');
    this.ctx.body = pacContent;
  }
  @Get('/dynamic/proxy.pac')
  async dynamicGetPacFile(@Query('host_matches') host_matches: string) {
    let pacContent = this.whistleReqLogService.getPacFile([], 'DIRECT');
    try {
      const matchList = host_matches.split(',');
      pacContent = this.whistleReqLogService.getPacFile(
        matchList,
        `PROXY ${this.whistleReqLogService.THIS_SERVER_HREF}`,
        true
      );
    } catch (_) { }
    this.ctx.set('Content-Type', 'application/x-ns-proxy-autoconfig');
    this.ctx.set('Content-Disposition', 'attachment; filename="proxy.pac"');
    this.ctx.body = pacContent;
  }

  // 测试  TODO:del
  @Get('/proxy2.pac')
  async getPacFile2() {
    const pacContent = this.whistleReqLogService.getPacFile(
      [],
      `PROXY ${this.whistleReqLogService.THIS_SERVER_HREF}`,
    );
    this.ctx.set('Content-Type', 'application/x-ns-proxy-autoconfig');
    this.ctx.set('Content-Disposition', 'attachment; filename="proxy.pac"');
    this.ctx.body = pacContent;
  }

}
