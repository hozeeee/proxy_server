import { Provide, Inject, App } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import { type IDeviceId, DEVICE_LIST } from '../common/device_config';
import { isRunningClash } from '../common/clash_controller';
import { CLASH_HTTP_PROXY_PORT, proxyServerPort } from '../config/port_config.json';


/**
 * 说明:
 *   1. 获取所有设备的当前状态。
 */


@Provide()
export class DeviceManageService {
  @App('socketIO')
  socketApp: SocketApplication;


  /**
   * 获取所有代理设备。
   */
  getList() {
    const list = DEVICE_LIST.map(item => ({
      id: item.id,
      name: item.name,
      usable: this.checkDeviceUsable(item.id),
      ping: item.commandUseBridge?.ping ?? 0,
      pingUpdateAt: item.commandUseBridge?.latestHeartbeatAt ?? 0,
      port: item.port,
    }));
    for (const item of list) {
      const { id } = item;
      //
    }
    // 不在配置项的，手动加上
    list.unshift({
      id: 'server_local',
      name: '代理服务本地',
      usable: this.checkDeviceUsable('server_local'),
      port: proxyServerPort,
      ping: 0,
      pingUpdateAt: 0,
    }, {
      id: 'clash',
      name: 'clash 代理',
      usable: this.checkDeviceUsable('clash'),
      port: CLASH_HTTP_PROXY_PORT,
      ping: 0,
      pingUpdateAt: 0,
    });
    return list;
  }


  /**
   * 查询单个设备是否可用。
   */
  checkDeviceUsable(deviceId: IDeviceId) {
    if (deviceId === 'server_local') return true;
    if (deviceId === 'clash') return isRunningClash();
    const config = DEVICE_LIST.find(i => i.id === deviceId);
    const usable = !!config?.port && !!this.socketApp.of(`/${deviceId}`).sockets.size;
    return usable;
  }


  /**
   * 查询单个设备的端口。
   * 如果不可用，返回 0 。
   */
  getDevicePort(deviceId: IDeviceId) {
    if (deviceId === 'server_local') return proxyServerPort;
    if (deviceId === 'clash') {
      if (isRunningClash()) return 0;
      return CLASH_HTTP_PROXY_PORT;
    }
    const config = DEVICE_LIST.find(i => i.id === deviceId);
    const port = config?.port;
    const usable = !!port && !!this.socketApp.of(`/${deviceId}`).sockets.size;
    if (!usable) return 0;
    return port;
  }

}
