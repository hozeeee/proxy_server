import { Body, Controller, Get, Post } from '@midwayjs/core';
import { proxyRequestAxios } from '../common/proxy_methods';
import { NoticeService } from '../service/notice.service';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { DEVICE_LIST, type IDeviceId } from '../common/device_config';

/**
 * 说明，
 * 用于通过 API 的方式使用代理的能力。
 *
 * 注意！
 * 其实不建议这么用，可能会导致请求数太大量导致服务器拥堵。
 */


@Controller('/api/proxy')
export class ProxyController {

  @Post('/request_axios')
  async handleRequestAxios(@Body('deviceId') deviceId: IDeviceId, @Body('config') config: AxiosRequestConfig) {
    return await proxyRequestAxios(deviceId, config);
  }

}
