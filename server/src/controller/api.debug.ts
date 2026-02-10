import { Inject, Controller, Post, Query, Get, App } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import axios from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { io } from 'socket.io-client';
import fs from 'fs-extra';
import { join } from 'path';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Socket as SocketIoClient } from 'socket.io-client';
import { createConnectSocket } from '../test_demo/socket_connect_to_here';
import { DEVICE_LIST } from '../common/device_config';
import { HttpProxyEntranceService, startWhistleProxyServer } from '../service/http_proxy_entrance.service';
import { checkClashNode } from '../common/clash_controller';




@Controller('/api/debug')
export class APIDebugController {
  @Inject()
  ctx: Context;
  @Inject()
  httpProxyEntranceService: HttpProxyEntranceService;


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


  @Get('/start_whistle')
  async startWhistleProxyServer() {
    startWhistleProxyServer();
  }


  /**
   * 测试通过"通知指令"来更新脚本代码。
   */
  @Get('/script/upgrade_code')
  async upgrade_script_code() {
    const device = DEVICE_LIST.find(i => i.id === 'local_test');
    const filename = join(process.cwd(), 'publish/forward_end/daemon.js'); // TODO:
    const fileBuff = fs.readFileSync(filename);
    const res = await device.updateClientBridge.sendClientCode(fileBuff);
    return JSON.stringify(res);
  }


  /**
   * 测试单个 clash 。
   */
  @Get('/test/clash_node')
  async test_clash_node(@Query('port') port: number) {
    console.log('测试 clash 节点: ', port);
    const res = await checkClashNode(port);
    return res;
  }

}
