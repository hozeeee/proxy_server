
import { Inject, Controller, Post, Query, Get, Body } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { WhistleReqLogService } from '../service/whistle_req_log.service';
import { IncomingHttpHeaders } from 'http';




@Controller('/api/whistle_log')
export class APIDeviceController {
  @Inject()
  ctx: Context;
  @Inject()
  whistleReqLogService: WhistleReqLogService;


  // 下载证书
  @Get('/ca')
  async getCa(): Promise<any> {
    return await this.whistleReqLogService.getWhistleCa();
  }


  // 插件接入专用！
  @Post('/req_log')
  async req_log(@Body() body): Promise<any> {
    return this.whistleReqLogService.uploadLog(body);
  }


}
