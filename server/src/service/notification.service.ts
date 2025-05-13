import { App, Inject, Provide, TaskLocal } from '@midwayjs/core';
import type { IDeviceId } from '../common/device_config';
import { DEVICE_LIST, OFFLINE_NOTIFICATION_TIMEOUT, offlineNotificationTimerMap } from '../common/device_config';
import axios from 'axios';
import dayjs from 'dayjs';
import nodemailer from 'nodemailer';
import { hostname, port, sendPath, backupEmail } from '../config/notification_server.config.json';


/**
 * 说明:
 * 此服务用于发送通知，包括：
 *   1. 发送邮件
 *   2. 发送到微信
 *   3. 发送到链接此服务的其他服务器
 *   4. 提供订阅功能
 */


type ISendMode = 'auto' | 'email' | 'wx_pc';

// 配置 notification 服务。
const NOTIFICATION_SERVER_HREF = `http://${hostname}:${port}${sendPath}`;

// 这里还是配置一下邮件发送，作为一个兜底行为。
const transporter = nodemailer.createTransport({
  host: 'smtp.126.com', // 第三方邮箱的主机地址
  // port: 587,
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: 'fhz920p@126.com', // 发送方邮箱的账号
    pass: 'RAXXXTTYZJBUECZF', // 邮箱授权密码
  },
});

@Provide()
export class NotificationService {

  /**
   * 自动重试，避免 notification 还没启动。
   */
  private async send(params: { mode?: ISendMode, content: string, subject?: string }, maxRetry = 5) {
    let success = false;
    try {
      success = await axios.post(NOTIFICATION_SERVER_HREF, params);
    } catch (_) { }
    if (success) return true;
    maxRetry--;
    // notification 服务不可用时，接收邮件的邮箱。
    if (maxRetry <= 0) {
      transporter.send({
        from: 'fhz920p@126.com', // 发送方邮箱的账号
        to: backupEmail, // 邮箱接受者的账号 (逗号分隔多个)
        subject: '[代理系统] notification 服务调用失败', // 标题
        text: '请检查 notification 服务是否正常可用',
        html: '', // 如果设置了html内容, 将忽略text内容
      });
      return false;
    }
    else {
      await new Promise(resolve => setTimeout(resolve, 1 * 1000));
      return await this.send(params, maxRetry);
    }
  }


  /**
   * 代理设备上线
   */
  onDeviceOnline(deviceId: IDeviceId) {
    const targetDevice = DEVICE_LIST.find(i => i.id === deviceId);
    const subject = `[代理系统] 代理设备接入系统(${targetDevice?.name})`;
    const content = [
      '当前所有设备情况：',
      ...DEVICE_LIST.map((item) => ` ${item.name} | ${item.commandUseBridge?.ping || 0} ${targetDevice.name === item.name ? '[爱心]' : ''}`),
      '---------------------------------',
      dayjs().format('YYYY-MM-DD HH:mm:ss')
    ].join('\n');
    // 记录状态
    if (!targetDevice.statusList) targetDevice.statusList = [];
    const now = Date.now();
    targetDevice.statusList.push({ type: 'online', time: now, timeText: dayjs(now).format('YYYY-MM-DD HH:mm:ss') });
    // 如果设备是偶发断线，不发送通知
    const timer = offlineNotificationTimerMap.get(deviceId);
    if (timer) {
      offlineNotificationTimerMap.delete(deviceId);
      clearTimeout(timer);
      return;
    }
    this.send({ subject, content });
  }

  /**
   * 代理设备离线
   */
  onDeviceOffline(deviceId: IDeviceId) {
    const targetDevice = DEVICE_LIST.find(i => i.id === deviceId);
    const subject = `[预约系统] 代理设备离线(${targetDevice?.name})`;
    const content = [
      '当前所有设备情况：',
      ...DEVICE_LIST.map((item) => ` ${item.name} | ${item.commandUseBridge?.ping || 0} ${targetDevice.name === item.name ? '[心碎]' : ''}`),
      '---------------------------------',
      dayjs().format('YYYY-MM-DD HH:mm:ss')
    ].join('\n');
    // 记录状态
    if (!targetDevice.statusList) targetDevice.statusList = [];
    const now = Date.now();
    targetDevice.statusList.push({ type: 'offline', time: now, timeText: dayjs(now).format('YYYY-MM-DD HH:mm:ss') });
    // 延迟发送，如果期间上线，则会被清掉
    const cb = () => {
      this.send({ subject, content });
      offlineNotificationTimerMap.delete(deviceId);
    }
    const timer = setTimeout(cb, OFFLINE_NOTIFICATION_TIMEOUT);
    offlineNotificationTimerMap.set(deviceId, timer);
  }

  /**
   * 定期发送所有设备的状态情况。
  */
  @TaskLocal('0 0 1 * * *')
  intervalSendDeviceStatus() {
    const subject = `[代理系统] 设备情况统计`;
    const content = [
      '当前所有设备情况：',
      ...DEVICE_LIST.map((item) => {
        item.statusList = []; // 清空
        return [
          '  ',
          item.name,
          ' | ',
          item.commandUseBridge?.ping || 0,
          item.statusList ? `\n      当天掉线次数(${item.statusList.filter(i => i.type === 'offline').length})` : '',
        ].join('');
      }),
      '---------------------------------',
      dayjs().format('YYYY-MM-DD HH:mm:ss')
    ].join('\n');
    this.send({ subject, content });
  }

  /**
   * 普通的错误通知
   */
  onNormalError(msg: string) {
    // TODO:
  }



}




// 参考示例：  '0 30 */1 * * *'
/**
Cron 表达式:
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    |
│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, optional)

注意！！！ 当前框架下，"/5" 需要在前面带上 "*"

每隔5秒执行一次：/5 * * * * *
每隔1分钟执行一次：0 /1 * * * *
每小时的20分执行一次：0 20 * * * *
每天 0 点执行一次：0 0 0 * * *
每天的两点35分执行一次：0 35 2 * * *

在线工具: https://cron.qqe2.com/
 */
