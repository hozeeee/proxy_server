import { App, Inject, Provide } from '@midwayjs/core';
import type { IDeviceId } from '../socket/forward_end.controller';
import { DEVICE_LIST } from '../socket/forward_end.controller';
import { EmailService } from './email.service';


/**
 * 说明:
 * 此服务用于发送通知，包括：
 *   1. 发送邮件
 *   2. 发送到微信
 *   3. 发送到链接此服务的其他服务器
 *   4. 提供订阅功能
 */


@Provide()
export class NoticeService {
  @Inject()
  emailService: EmailService;

  /**
   * 代理设备上线
   */
  onDeviceOnline(deviceId: IDeviceId) {
    const device = DEVICE_LIST.find(i => i.id === deviceId);
    // TODO:

    // 邮件
    // this.emailService.send(
    //   `[预约系统] 代理设备接入系统(${device?.name})`,
    //   ` <h1>日志内容：</h1></br>${''}`
    // );
  }

  /**
   * 代理设备离线
   */
  onDeviceOffline(deviceId: IDeviceId) {
    // TODO:
  }

  /**
   * 普通的错误通知
   */
  onNormalError(msg: string) {
    // 邮件
    this.emailService.send(
      `[预约系统] 普通错误日志`,
      ` <h1>日志内容：</h1></br>${msg}`
    );
  }



}

