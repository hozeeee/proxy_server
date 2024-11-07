
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


  @Post('/req_log')
  async req_log(@Body('url') url: string, @Body('reqHeaders') reqHeaders: IncomingHttpHeaders): Promise<any> {
    return this.whistleReqLogService.uploadLog(url, reqHeaders);
  }


}
