import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import axios, { type AxiosInstance } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { DEVICE_LIST, type IDeviceId } from '../common/device_config';
import { CLASH_HTTP_PROXY_PORT } from '../config/port.config';



let clashAxios: AxiosInstance;

export async function proxyRequestAxios(deviceId: IDeviceId, config: AxiosRequestConfig) {
  const errRes: Omit<AxiosResponse, 'data' | 'headers' | 'config' | 'request'> = {
    status: 500,
    statusText: '',
  }

  // 使用本服务的"本地请求"
  if (deviceId === 'server_local') {
    try {
      const res = await axios.request(config);
      return res;
    } catch (err) {
      const errMsg = `axios.request 执行异常: ${err?.message || err}`;
      errRes.statusText = `代理端请求异常: ${errMsg}`;
      return errRes;
    }
  }

  // 使用 clash 代理
  if (deviceId === 'clash') {
    if (!clashAxios) {
      const proxyURL = `http://127.0.0.1:${CLASH_HTTP_PROXY_PORT}`;  // 测试用本服务代理
      const httpAgent = new HttpProxyAgent(proxyURL);
      const httpsAgent = new HttpsProxyAgent(proxyURL);
      clashAxios = axios.create();
      clashAxios.defaults.httpAgent = httpAgent;
      clashAxios.defaults.httpsAgent = httpsAgent;
    }
    try {
      const res = await clashAxios.request(config);
      return res;
    } catch (err) {
      const errMsg = `axios.request 执行异常: ${err?.message || err}`;
      errRes.statusText = `代理端请求异常: ${errMsg}`;
      return errRes;
    }
  }

  // 使用设备代理
  const device = DEVICE_LIST.find(i => i.id === deviceId);
  if (!device?.axiosRequestController) {
    errRes.statusText = `未找到该代理设备(${deviceId})的配置`;
    return errRes;
  }
  const res = await device.axiosRequestController.request(config);
  if (typeof res === 'string') {
    errRes.statusText = `代理端请求异常: ${res}`;
    return errRes;
  }
  if (res === null) {
    errRes.statusText = `代理端请求异常，返回信息为 null ，需要查看代码`;
    return errRes;
  }
  return res;
}
