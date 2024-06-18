import { ForwardHttpController, AxiosRequestController } from 'forward_end';


interface IDeviceItem<T extends string> {
  id: T;
  name: string;
  forwardHttpController?: ForwardHttpController;
  axiosRequestController?: AxiosRequestController;
}
export type IDeviceId =
  'local_test' |
  'n2840';


/**
 * 已有设备需要在这里提前配置
 */
export const DEVICE_LIST: IDeviceItem<IDeviceId>[] = [
  { id: 'local_test', name: '本地测试', forwardHttpController: undefined, },
  { id: 'n2840', name: '村工控机', forwardHttpController: undefined, },
];
for (const item of DEVICE_LIST) {
  item.forwardHttpController = new ForwardHttpController();
  item.axiosRequestController = new AxiosRequestController();
}
