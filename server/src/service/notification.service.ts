import { App, Inject, Provide } from '@midwayjs/core';
import type { IDeviceId } from '../common/device_config';
import { DEVICE_LIST } from '../common/device_config';
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
      ...DEVICE_LIST.map((item) => ` ${item.name} | ${item.id} | ${item.commandUseBridge?.ping || 0} ${targetDevice.name === item.name ? '[爱心]' : ''}`),
      '---------------------------------',
      dayjs().format('YYYY-MM-DD HH:mm:ss')
    ].join('\n');
    // 邮件
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
      ...DEVICE_LIST.map((item) => ` ${item.name} | ${item.id} | ${item.commandUseBridge?.ping || 0} ${targetDevice.name === item.name ? '[心碎]' : ''}`),
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

