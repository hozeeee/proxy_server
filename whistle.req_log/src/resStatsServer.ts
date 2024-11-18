import axios from 'axios';

export default (server: Whistle.PluginServer, options: Whistle.PluginOptions) => {
  server.on('request', (req: Whistle.PluginRequest, res: Whistle.PluginResponse) => {

    /**
     * 踩坑记录:
     *   1. 不能通过 req.headers 或者 req.rawHeaders 拿到请求头，都是不准确的。
     */
    req.getSession((session) => {
      try {
        if (typeof session === 'string') return;
        const url = session.url;
        const reqHeaders = session.req.headers;
        const resHeader = session.res.headers;

        // 上报 (注意端口号配置)
        const logServerHref = `http://127.0.0.1:${8600}/api/whistle/req_log`;
        axios.post(logServerHref, { url, reqHeaders, });
      } catch (_) { }
    });

  });
};
