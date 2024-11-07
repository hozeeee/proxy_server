import axios from 'axios';

export default (server: Whistle.PluginServer, options: Whistle.PluginOptions) => {
  server.on('request', (req: Whistle.PluginRequest, res: Whistle.PluginResponse) => {

    const url = req.fullUrl;
    const reqHeaders = req.headers;

    // 上报 (注意端口号配置)
    const logServerHref = `http://127.0.0.1:${8600}/api/whistle_log/req_log`;
    axios.post(logServerHref, { url, reqHeaders });

  });
};
