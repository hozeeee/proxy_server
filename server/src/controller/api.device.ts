import { Inject, Controller, Post, Query, Get } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { DeviceManageService } from '../service/device_manage.service';
import { type IDeviceId, } from '../common/device_config';




@Controller('/api/device')
export class APIDeviceController {
  @Inject()
  ctx: Context;
  @Inject()
  deviceManageService: DeviceManageService;



  @Get('/list')
  async getList(): Promise<any[]> {
    return this.deviceManageService.getList();
  }


  @Get('/usable')
  async checkDeviceUsable(@Query('device_id') device_id: string): Promise<boolean> {
    return !!this.deviceManageService.getDevicePort(device_id as IDeviceId);
  }


  @Get('/port')
  async getDevicePort(@Query('device_id') device_id: string): Promise<number> {
    return this.deviceManageService.getDevicePort(device_id as IDeviceId);
  }


}
