import { HttpProxyBridge, AxiosRequestBridge, TigervncForwardBridge, CommandUseBridge } from 'forward_end';


interface IDeviceItem<T extends string> {
  id: T;
  name: string;
  forwardHttpController?: HttpProxyBridge;
  axiosRequestController?: AxiosRequestBridge;
  tigervncForwardController?: TigervncForwardBridge;
  commandUseBridge?: CommandUseBridge;
  // 挂载的端口
  port: number;
}

export type IDeviceId =
  // 使用本服务发起请求
  'server_local'
  // 使用 clash 发起请求
  | 'clash'
  /**
   * 普通的代理设备.
   */
  | 'local_test'
  | 'n2840'
  | 'xxxx';


/**
 * 已有设备需要在这里提前配置。
 * 配置中包含"控制器"，控制器的代码是"控制端"与"被控制端"使用同一份，通过参数判断实例后的类型，好处是方便管理代码。
 *
 * 注意！
 *   1. 下面的第一行别动，因为 create_my_controller.js 会通过正则读取到这里的代码内容。
 *   2. 下面的配置也不能有"计算"的逻辑。
 *   3. 端口的改动需要谨慎，参考 port_config.json ，默认的规则是从 **10 开始。
 *   4. 第一个必须是调试设备，以它为模版，在 server/src/socket/device.controller.ts 的配置必须是它。
 */
export const DEVICE_LIST: IDeviceItem<IDeviceId>[] = [
  { id: 'local_test', name: '本地测试', port: 8610, },
  { id: 'n2840', name: '村工控机', port: 8611, },
];
for (const item of DEVICE_LIST) {
  item.forwardHttpController = new HttpProxyBridge();
  item.axiosRequestController = new AxiosRequestBridge();
  item.tigervncForwardController = new TigervncForwardBridge();
  item.commandUseBridge = new CommandUseBridge();
}
