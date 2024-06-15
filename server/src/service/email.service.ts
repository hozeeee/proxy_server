import type Mail from 'nodemailer/lib/mailer';
import { Provide, Inject } from '@midwayjs/decorator';
import nodemailer from 'nodemailer';



/**
 * 订阅的邮箱配置。
 */
const subscriptEmails = [
  '15820676504@139.com',
  '13560046845@139.com',
];
const emails = subscriptEmails.join(',');


@Provide()
export class EmailService {

  // 发送实例
  private transporter = nodemailer.createTransport({
    host: 'smtp.126.com', // 第三方邮箱的主机地址
    // port: 587,
    secure: true, // true for 465, false for other ports
    auth: {
      user: 'fhz920p@126.com', // 发送方邮箱的账号
      pass: 'RAXXXTTYZJBUECZF', // 邮箱授权密码
    },
  });

  // 普通邮件
  async sendMail(params: Mail.Options) {
    delete params.from;
    if (!params.to) return null;
    const info = await this.transporter.sendMail({
      from: 'fhz920p@126.com', // 发送方邮箱的账号
      to: '', // 邮箱接受者的账号 (逗号分隔多个)
      subject: '', // 标题
      text: '',
      html: '', // 如果设置了html内容, 将忽略text内容
      ...params,
    });
    return info;
  }


  /**
   * 固定格式发送内容
   */
  send(title: string, content: string) {
    return this.sendMail({
      to: emails,
      subject: title,
      html: content,
    });
  }

}
