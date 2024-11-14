import { App, Context, Inject, Provide } from '@midwayjs/core';
import axios from 'axios';
import { ServerToServerSocketController } from '../socket/s2s.controller';
import { whistleProxyPort } from '../config/port_config.json';


/**
 * 说明:
 *   1. 此服务用于 whistle.req_log 拦截后的上报。
 */


interface ILogItem {
  url: string;
  reqHeaders: Record<string, string>;
  createAt: number;
}

// const _logList: ILogItem[] = [];

@Provide()
export class WhistleReqLogService {
  // @App('socketIO')
  // socketApp: SocketApplication;
  @Inject()
  s2sSocketController: ServerToServerSocketController;

  // private logList = _logList;


  /**
   * 踩坑记录:
   *   1. 由于服务会被多次转发，可能是 ipv6 的原因，外网不能访问 whistle 的 html 页面(包括证书下载)。但内网可以访问。
   *   2. 使用代理服务的方式，注意该 wifi 网络是否是"需要安装"证书，如果是带有证书的，拦截信息会解析不到。
   */


  async getWhistleCa(type?: 'cer' | 'pem' | 'crt') {
    try {
      let search = '';
      switch (type) {
        case 'pem':
        case 'cer': search = `?type=${type}`;
      }
      const res = await axios.get(`http://127.0.0.1:${whistleProxyPort}/cgi-bin/rootca${search}`, { responseType: 'stream' });
      return res.data;
    } catch (_) { }
    return 'error...';
  }


  uploadLog(data: ILogItem) {
    if (typeof data === 'object') data.createAt = Date.now();
    try {
      // 发送给订阅的服务
      const socketList = Array.from(this.s2sSocketController.subscribe_whistle_map.values());
      for (const { ctx: socket, urlRegexpRaw } of socketList) {
        // 过滤 url
        if (urlRegexpRaw && typeof urlRegexpRaw.source === 'string') {
          try {
            const regexp = new RegExp(urlRegexpRaw.source, urlRegexpRaw.flags);
            const isMatch = data.url.match(regexp);
            if (!isMatch) continue;
          } catch (_) { }
        }
        socket.emit('on_subscribe_whistle_data', data);
      }
    } catch (_) { }
  }

}
