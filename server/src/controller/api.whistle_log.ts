
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


}
