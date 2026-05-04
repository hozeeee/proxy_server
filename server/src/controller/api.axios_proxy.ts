import { Inject, Controller, Post, Body } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { type IDeviceId } from '../common/device_config';
import { AxiosProxyEntranceService } from '../service/axios_proxy_entrance.service';


@Controller('/api/axios')
export class APIAxiosController {
  @Inject()
  ctx: Context;

  @Inject()
  axiosProxyEntranceService: AxiosProxyEntranceService;


  /**
   * 通过指定 deviceId 发起 axios 请求。
   * 请求 body 格式: { deviceId: string, config: AxiosRequestConfig }
   */
  @Post('/request')
  async request(@Body() body: { deviceId: IDeviceId; config: AxiosRequestConfig }) {
    const { deviceId, config } = body || {};
    if (!deviceId || !config) {
      this.ctx.status = 400;
      return {
        status: 400,
        statusText: '参数错误：缺少 deviceId 或 config',
      };
    }
    return await this.axiosProxyEntranceService.request(deviceId, config);
  }
}
