import { Inject, Controller, Post, Query, Get } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { getClashInfo, switchClashProxy } from '../common/clash_controller';
import axios from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { io } from 'socket.io-client';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Socket as SocketIoClient } from 'socket.io-client';
import { createConnectSocket } from '../test_demo/socket_connect_to_here';
import { CLASH_HTTP_PROXY_PORT } from '../config/port_config.json';
import { DEVICE_LIST } from '../common/device_config';




@Controller('/api/debug')
export class APIDebugController {
  @Inject()
  ctx: Context;


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
    return typeof res
  }



  /**
   * 测试 axios 发起请求，
   * 使用本地服务作为代理。
   */
  @Get('/test/local_axios_req')
  async testLocalAxiosReq(): Promise<any> {
    const proxyURL = `http://127.0.0.1:${CLASH_HTTP_PROXY_PORT}`;  // 测试用 clash 代理
    // const proxyURL = `http://192.168.3.107:${CLASH_HTTP_PROXY_PORT}`;  // 测试用 clash 代理
    // const proxyURL = `http://127.0.0.1:${8600}`;  // 测试用本服务代理
    const httpAgent = new HttpProxyAgent(proxyURL);
    const httpsAgent = new HttpsProxyAgent(proxyURL);
    const axiosInstance = axios.create();
    axiosInstance.defaults.httpAgent = httpAgent;
    axiosInstance.defaults.httpsAgent = httpsAgent;
    const targetUrl = 'https://www.google.com';
    // const targetUrl = 'https://www.baidu.com';
    const res = await axiosInstance.get(targetUrl,
      {
        // 没用，如果是 https 请求，中间代理是拿不到任何有用信息
        headers: { 'proxy-device-id': 'local_test' },
        params: { 'proxy-device-id': 'local_test_2' },
      }
    ).then(response => {
      return response;
    }).catch(error => {
      console.error('HTTP Error:', error.message);
    });
    if (res) delete res.request;
    return res || 'err';
  }



  /**
   * 测试使用远端设备的 axios 发起请求，
   */
  @Get('/test/device_axios_req')
  async testDeviceAxiosReq(): Promise<any> {
    const device = DEVICE_LIST.find(I => I.id === 'local_test');
    if (!device) return 'null';
    const config = {
      method: 'GET',
      // url: 'https://4.ipw.cn',
      url: 'https://www.baidu.com',
    }
    const res = await device.axiosRequestController.request(config);
    const res2 = await axios.request(config);
    delete res2.request;
    return {
      deviceRes: res,
      normalRes: res2,
    };
  }


  /**
   * 测试查询 clash 的信息。
   */
  @Get('/test/get_clash_info')
  async testGetClashInfo(): Promise<any> {
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

  /**
   * 测试 socket 连接发起请求。
   * this.socket.emit('request_axios', ...) 返回的是 AxiosResponse ，
   * 即使是自定义的错误也封装一样的结构，目前自定义的错误也用 500。
   */
  @Get('/test/socket_req')
  async test_socket_req(): Promise<any> {
    const config: AxiosRequestConfig = {
      url: 'https://6.ipw.cn/'
    }
    if (!this.socket)
      this.socket = io(`ws://127.0.0.1:8600/proxy_socket`, { autoConnect: true });
    const res: AxiosResponse<any, any> = await new Promise((resolve) => {
      this.socket.emit('request_axios', 'local_test', config, (res: AxiosResponse<any, any>) => {
        resolve(res)
      });
    });
    return res;
  }
  private socket: SocketIoClient;


}
