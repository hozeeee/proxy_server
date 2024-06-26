import { MidwayConfig, MidwayAppInfo } from '@midwayjs/core';
import { webServerPort as port } from './port.config';

export default (appInfo: MidwayAppInfo) => {
  return {
    // use for cookie sign key, should change to your own and keep security
    keys: appInfo.name + '_1716906401826_9976',
    egg: {
      port,
    },
    // security: {
    //   csrf: false,
    // },


    socketIO: {
      cors: {
        origin: ['http://127.0.0.1:5173'],
        methods: ['GET', 'POST'],
      }
    }
  } as MidwayConfig;
};
