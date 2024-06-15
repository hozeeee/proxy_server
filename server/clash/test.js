const { execFile } = require('child_process');
const path = require('path');


const clashPath = path.resolve(__dirname, 'clash-linux-amd64-v1.18.0'); // 替换为实际的clash路径
const configPath = path.resolve(__dirname, 'Clash_1718203306__0612.yaml'); // 替换为实际的配置文件路径

/**
 * 注意，
 *   1. 需要将内核权限修改成可执行:  chmod +x clash-darwin-amd64-v1.18.0
 *
 * 一些常用的参数包括：
 *   -f, --config: 指定配置文件路径。
 *   -t, --test: 测试配置文件的有效性。
 *   -d, --dir: 指定工作目录。
 *   --log-level: 指定日志级别（默认是info）。
 */
const clash = execFile(clashPath, ['-f', configPath], (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error}`);
    return;
  }
  console.log(`Output: ${stdout}`);
  console.error(`Error output: ${stderr}`);
});

clash.on('close', (code) => {
  console.log(`Clash process exited with code ${code}`);
});

/**
 * 守护进程启动:
 * pm2 start clash
 *
 *
 *
 * ai 回答记录：
 *
 * 代理列表:  curl -X GET http://localhost:9090/proxies
 * 切换代理:  curl -X PUT http://localhost:9090/proxies/{groupName} -d '{"name":"anotherProxy"}'
 * 查看单个代理:  curl -X GET http://localhost:9090/proxies/{groupName}
 * 获取日志:  curl -X GET http://localhost:9090/logs
 *
 * 获取当前使用的代理集模式:  curl -X GET http://localhost:9090/configs
 * 更新配置:  curl -X PATCH http://localhost:9090/configs -d '{ "port": 7890, "socks-port": 7891, "allow-lan": true, "mode": "Rule", "log-level": "info" }'
 *
 * 获取所有规则:  curl -X GET http://localhost:9090/rules
 *
 * 刷新 DNS 缓存:  curl -X PUT http://localhost:9090/traffic/dns
 *
 * 查看当前连接:  curl -X GET http://localhost:9090/connections
 * 关闭特定连接:  curl -X DELETE http://localhost:9090/connections/{connectionId}
 *
 */

