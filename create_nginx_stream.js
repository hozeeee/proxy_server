const fs = require('fs');
const { join } = require('path');
const deviceList = require('./server/src/common/device_list.json');
const portConfig = require('./server/src/config/port_config.json');
const packageJson = require('./package.json');

const ports = Object.values(portConfig);
ports.push(...deviceList.map(i => i.port));

const projectName = packageJson.name;

const HOSTNAME = process.env.HOSTNAME || '192.168.3.101';


/**
 * 本文件会在当前目录生成 nginx 配置，
 * 实际使用还需要拷贝到 Linux 主机上，
 * 可以作为参考。
 * 
 * 在 stream 内添加 " include /etc/nginx/conf.d/_stream.proxy_server.conf; "
 * 
 * 注意！
 *   1. 改完配置后，先运行 `nginx -t` 测试一下配置，看到 "... test is successful" 才是可用的。
 *   2. 使用 `service nginx restart` 重启服务。
 */

const TEMPLATE = `
    upstream ${projectName}__<port> {
        server ${HOSTNAME}:<port>;
    }
    server {
        listen <port>;
        listen [::]:<port>;
        proxy_pass ${projectName}__<port>;
    }
`;

const content = `\n# _stream.${projectName}.conf\n\n`
    + ports.map(port => TEMPLATE.replace(/\<port\>/g, port)).join('\n');
const filename = join(__dirname, './nginx_stream.conf');

fs.writeFileSync(filename, content);

console.log(`finally create in: ${filename} \n\n`);

