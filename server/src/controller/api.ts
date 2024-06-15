import { Inject, Controller, Post, Query, Get } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { UserService } from '../service/user';
import { getClashInfo, switchClashProxy } from '../utils/clash_controller';
import axios from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { clashHttpProxyPort } from '../utils/clash_controller';


// 配置代理地址
const proxyURL = `http://127.0.0.1:${clashHttpProxyPort}`;
const httpAgent = new HttpProxyAgent(proxyURL);
const httpsAgent = new HttpsProxyAgent(proxyURL);
const axiosInstance = axios.create();
axiosInstance.defaults.httpAgent = httpAgent;
axiosInstance.defaults.httpsAgent = httpsAgent;


@Controller('/api')
export class APIController {
  @Inject()
  ctx: Context;

  @Inject()
  userService: UserService;

  @Get('/test1')
  async test1(): Promise<any> {
    const configs = await getClashInfo('configs');
    const version = await getClashInfo('version');
    const rules = await getClashInfo('rules');
    const proxies = await getClashInfo('proxies');
    const connections = await getClashInfo('connections');

    return {
      configs,
      version,
      rules,
      proxies,
      connections,
    }
  }
  @Get('/test11')
  async test11(): Promise<any> {
    const logs = await getClashInfo('logs');
    return {
      logs
    }
  }

  @Get('/test2')
  async test2(): Promise<any> {
    // const res = await switchClashProxy('B美国 02');
    const res = await switchClashProxy('B美国 02', 'GLOBAL');
    return res
  }

  @Get('/test3')
  async test3(): Promise<any> {
    await axios.get('https://www.baidu.com').then(response => {
      console.log('HTTP Response-3:', response.data);
      return response.data;
    }).catch(error => {
      console.error('HTTP Error:', error.message);
    });
    return 3
  }
  @Get('/test4')
  async test4(): Promise<any> {
    await axiosInstance.get('https://www.baidu.com').then(response => {
      console.log('HTTP Response-4:', response.data);
      return response.data;
    }).catch(error => {
      console.error('HTTP Error:', error.message);
    });
    return 4
  }

  @Get('/test5')
  async test5(): Promise<any> {
    await axiosInstance.get('https://www.google.com').then(response => {
      console.log('HTTP Response-5:', response.data);
      return response.data;
    }).catch(error => {
      console.error('HTTP Error:', error.message);
    });
    return 5
  }

}
