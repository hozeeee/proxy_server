import { join } from 'path';
import { MidwayConfig, MidwayAppInfo } from '@midwayjs/core';
import { serverPort as port } from './port_config.json';

export default (appInfo: MidwayAppInfo) => {
  return {
    // use for cookie sign key, should change to your own and keep security
    keys: appInfo.name + '_1716906401826_9976',
    egg: {
      port,
    },
    security: {
      csrf: false,
    },

    staticFile: {
      dirs: {
        default: {
          prefix: '/',
          dir: join(__dirname, '../../publish'),
        },
      },
    },

    socketIO: {
      cors: {
        // TODO: 可能需要加上"爬虫系统"
        origin: ['http://127.0.0.1:5173'],
        methods: ['GET', 'POST'],
      }
    }
  } as MidwayConfig;
};
