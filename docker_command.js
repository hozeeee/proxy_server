const { execSync } = require('child_process');
const deviceList = require('./server/src/common/device_list.json');
const portConfig = require('./server/src/config/port_config.json');
const packageJson = require('./package.json');


/**
 * 本地 docker 仓库。
 * 支持通过参数配置。
 */
const localDockerRegistry = process?.env?.LOCAL_DOCKER_REGISTRY || '192.168.3.107:5000';


const ports = Object.values(portConfig)
ports.push(...deviceList.map(i => i.port));
const portArgs = ports.map(port => `-p ${port}:${port}`).join(' '); // `-p 8600:8600`

const version = packageJson.version;
const noDotVersion = version.replace(/\./g, '');
const imageName = `hozeee/proxy_server:${version}`;


// 构建镜像命令  (原始命令 "docker build --pull --rm -f \"Dockerfile\" -t hozeee/proxy_server:$npm_package_version \".\"" )
const buildCommand = `docker build --pull --rm -f "Dockerfile" -t ${imageName} "."`;
const tagCommand = `docker tag ${imageName} ${localDockerRegistry}/${imageName}`;
const pushCommand = `docker push ${localDockerRegistry}/${imageName}`;

// 运行镜像命令  (原始命令 "export no_dot_version=$(echo $npm_package_version | sed 's/\\.//g') && docker run -d --name proxy_server_v$no_dot_version --restart=always -p 8600:8600 -p 8601:8601 -p 8602:8602 -p 8690:8690 -p 8691:8691 hozeee/proxy_server:$npm_package_version" )
const pullCommand = `docker pull ${localDockerRegistry}/${imageName}`;
const runCommand = `docker run -d --name proxy_server_v${noDotVersion} --restart=always ${portArgs} ${localDockerRegistry}/${imageName}`;

// TODO: 使用镜像的 Linux 主机配置 /etc/docker/daemon.json


/**
 * 执行操作。
 * 通过参数来决定执行的命令。
 */
const type = process.env.__COMMAND_TYPE;
switch (type) {
  case 'build': {
    const res1 = execSync(buildCommand, { encoding: 'utf8' });
    const res2 = execSync(tagCommand, { encoding: 'utf8' });
    const res3 = execSync(pushCommand, { encoding: 'utf8' });
    break;
  }
  case 'run': {
    const res1 = execSync(pullCommand, { encoding: 'utf8' });
    const res2 = execSync(runCommand, { encoding: 'utf8' });
    break;
  }
  // 打印运行命令，方便拷贝到"部署主机"上执行
  case 'print-run': {
    console.log(`${pullCommand} && ${runCommand}`);
    break;
  }
}

