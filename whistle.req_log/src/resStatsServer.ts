
export default (server: Whistle.PluginServer, options: Whistle.PluginOptions) => {
  server.on('request', (req: Whistle.PluginRequest, res: Whistle.PluginResponse) => {
    // do something

    const url = req.fullUrl;
    const reqHeaders = req.headers;

  });
};
