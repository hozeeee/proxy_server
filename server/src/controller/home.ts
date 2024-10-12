import { Controller, Get } from '@midwayjs/core';


/**
 * 调用说明。
 */
const description = `
1. 代理设备运行的脚本下载: /forward_end/end_manager.js
2. 脚本使用示例:  DEVICE_ID=<设备ID> SERVER_HOST=127.0.0.1:8601 node end_manager.js
3. 查询可用代理设备: /api/device/list
4. 如果单纯的执行 js 脚本，可以增加 OPEN_DEBUG=1 参数，开启调试模式，能够输入错误信息到控制台。

`;


@Controller('/')
export class HomeController {
  @Get('/')
  async home() {
    return description;
  }
}
