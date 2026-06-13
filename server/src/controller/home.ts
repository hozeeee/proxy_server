import { Controller, Get, Inject, ContentType } from '@midwayjs/core';
import { Context } from '@midwayjs/web';

/**
 * 调用说明页面（HTML）。
 */
const descriptionHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>代理服务器 - 使用说明</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.8; }
    h1 { border-bottom: 2px solid #4a90d9; padding-bottom: 10px; color: #2c3e50; }
    h2 { margin-top: 36px; color: #2c3e50; border-bottom: 1px solid #e1e4e8; padding-bottom: 6px; }
    ol li { margin-bottom: 16px; }
    ul li { margin-bottom: 10px; }
    a { color: #4a90d9; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: #f5f7fa; border: 1px solid #e1e4e8; border-radius: 6px; padding: 12px 16px; overflow-x: auto; font-size: 14px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>代理服务器 - 调用说明</h1>
  <ol>
    <li>
      代理设备运行的脚本下载：
      <a href="/forward_end/end_manager.js">/forward_end/end_manager.js</a>
    </li>
    <li>
      脚本使用示例：
      <pre>DEVICE_ID=&lt;设备ID&gt; SERVER_HOST=127.0.0.1:8600 node end_manager.js</pre>
    </li>
    <li>
      查询可用代理设备：
      <a href="/api/device/list">/api/device/list</a>
    </li>
    <li>
      如果单纯地执行 JS 脚本，可以增加 <code>OPEN_DEBUG=1</code> 参数，开启调试模式，能够将错误信息输出到控制台。
      <pre>DEVICE_ID=&lt;设备ID&gt; SERVER_HOST=127.0.0.1:8600 OPEN_DEBUG=1 node end_manager.js</pre>
    </li>
  </ol>

  <h2>Data Viewer - 数据查看器</h2>
  <p>提供 SQLite 数据库的在线浏览能力，支持查看表结构、汇总行数以及查询表数据。</p>
  <ul>
    <li>
      打开数据查看器页面：
      <a href="/data-viewer">/data-viewer</a>
    </li>
    <li>
      获取所有表名列表：
      <a href="/api/data/tables">/api/data/tables</a>
    </li>
    <li>
      汇总各表行数：
      <a href="/api/data/summary">/api/data/summary</a>
    </li>
    <li>
      查询指定表数据（支持 <code>?limit=N</code>，默认 50，最大 1000）：
      <pre>GET /api/data/table/:name?limit=100</pre>
    </li>
  </ul>
  <h2>MCP 服务配置</h2>
  <p>本服务提供 MCP（Model Context Protocol）接口，支持 <strong>stdio</strong> 与 <strong>Streamable HTTP</strong> 两种传输模式。</p>

  <h3>stdio 模式（本地客户端）</h3>
  <p>适用于 Claude Desktop、Cursor 等本地 AI 客户端，将以下内容加入客户端的 MCP 配置文件：</p>
  <pre>{
  "mcpServers": {
    "proxy-server": {
      "command": "node",
      "args": ["&lt;部署路径&gt;/server/dist/mcp/index.js"]
    }
  }
}</pre>

  <h3>Streamable HTTP 模式（远程客户端）</h3>
  <p>适用于容器外或远程 AI 客户端，将以下内容加入客户端的 MCP 配置文件（将 <code>&lt;HOST&gt;</code> 替换为服务器实际 IP 或域名）：</p>
  <pre>{
  "mcpServers": {
    "proxy-server": {
      "url": "http://&lt;HOST&gt;:8605/mcp"
    }
  }
}</pre>
  <p>健康检查接口：<a href="http://localhost:8605/health">http://&lt;HOST&gt;:8605/health</a></p>

  <h2>升级 Node.js</h2>
  <p>使用 nvm（Node Version Manager）管理和升级 Node.js 版本： (注意使用 root 权限)</p>
  <pre># 1. 安装 nvm（Node Version Manager）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 2. 重新加载 shell 配置，使 nvm 命令生效
source ~/.bashrc

# 3. 通过 nvm 安装最新的 LTS 版本 Node.js
nvm install --lts

# 4. 创建软链接，使系统全局可用 node 命令
#  先通过 which node 找到 nvm 安装的实际路径，再创建软链接到 /usr/bin/node
ln -s /home/username/.nvm/versions/node/v24.16.0/bin/node /usr/bin/node</pre>
</body>
</html>
`;

@Controller('/')
export class HomeController {
  @Inject()
  ctx: Context;

  @Get('/')
  @ContentType('text/html')
  async home() {
    return descriptionHtml;
  }
}
