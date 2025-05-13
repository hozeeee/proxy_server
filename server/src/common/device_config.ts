import {
  HttpProxyBridge,
  AxiosRequestBridge,
  TigervncForwardBridge,
  CommandUseBridge,
  UpdateClientBridge
} from 'forward_end';
import deviceList from '../config/device_list.json';


interface IDeviceItem<T extends string> {
  id: T;
  name: string;
  forwardHttpController?: HttpProxyBridge;
  axiosRequestController?: AxiosRequestBridge;
  tigervncForwardController?: TigervncForwardBridge;
  commandUseBridge?: CommandUseBridge;
  updateClientBridge?: UpdateClientBridge;
  // 挂载的端口
  port: number;
  /**
   * 记录设备状态变化的情况，
   * 现在只有上线和离线，主要作用是避免网络波动导致的"偶断情况"。
   */
  statusList?: { type: 'offline' | 'online'; time: number; timeText: string; }[];
}

export type IDeviceId =
  // 使用本服务发起请求
  'server_local'
  // 使用 clash 发起请求
  | 'clash'
  // 更新客户端代码发起的连接专用
  | 'update_test'
  /**
   * 普通的代理设备.
   */
  | 'local_test'
  | 'n2840';


/**
 * 为了避免网络波动导致的"快速触发上线/离线提醒"，
 * 设备离线后等待若干时间再发送提醒，
 * 如果期间设备重新连接，则不发送提醒。
 * 增加定期发送所有设备状态的通知。
 */
export const OFFLINE_NOTIFICATION_TIMEOUT = 3 * 1000;
export const offlineNotificationTimerMap = new Map<IDeviceId, NodeJS.Timer>();


/**
 * 已有设备需要在这里提前配置。
 * 配置中包含"控制器"，控制器的代码是"控制端"与"被控制端"使用同一份，通过参数判断实例后的类型，好处是方便管理代码。
 *
 * 注意！
 *   1. 端口的改动需要谨慎，参考 port_config.json ，默认的规则是从 **10 开始。
 *   2. 第一个必须是调试设备，以它为模版，在 server/src/socket/device.controller.ts 的配置必须是它。
 */
export const DEVICE_LIST = [
  ...(deviceList as IDeviceItem<IDeviceId>[]),
];
for (const item of DEVICE_LIST) {
  item.forwardHttpController = new HttpProxyBridge();
  item.axiosRequestController = new AxiosRequestBridge();
  item.tigervncForwardController = new TigervncForwardBridge();
  item.commandUseBridge = new CommandUseBridge();
  item.updateClientBridge = new UpdateClientBridge();
}
