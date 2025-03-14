import { Provide, Inject, App } from '@midwayjs/decorator';
import { Context, Application as SocketApplication } from '@midwayjs/socketio';
import fs from 'fs-extra';
import { join } from 'path';
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
    // for (const item of list) {
    //   const { id } = item;
    //   //
    // }
    // 不在配置项的，手动加上
    list.unshift({
      id: 'server_local',
      name: '代理服务本地',
      usable: this.checkDeviceUsable('server_local'),
      port: proxyServerPort,
      ping: 0,
      pingUpdateAt: 0,
    });
    list.push({
      id: 'clash',
      name: 'clash (国外)代理',
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
    if (deviceId === 'update_test') return false; // 不给用
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
      if (!isRunningClash()) return 0;
      return CLASH_HTTP_PROXY_PORT;
    }
    const config = DEVICE_LIST.find(i => i.id === deviceId);
    const port = config?.port;
    const usable = !!port && !!this.socketApp.of(`/${deviceId}`).sockets.size;
    if (!usable) return 0;
    return port;
  }


  /**
   * 手动更新设备运行代码。
   */
  async upgradeDeviceScriptCode(deviceId: IDeviceId) {
    try {
      const usable = this.checkDeviceUsable(deviceId);
      if (!usable) return { success: false, msg: `设备(${deviceId})不在线` };
      const device = DEVICE_LIST.find(i => i.id === deviceId);
      // 注意目录是否发生变动
      const filename = join(process.cwd(), 'publish/forward_end/daemon.js');
      const fileBuff = fs.readFileSync(filename);
      const res = await device.updateClientBridge.sendClientCode(fileBuff);
      return { ...res };
    } catch (err) {
      return { success: false, msg: `非预期错误: ${err}` };
    }
  }

}
