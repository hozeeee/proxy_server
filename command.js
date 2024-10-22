const { execSync } = require('child_process');

// 端口
const deviceList = require('./server/src/config/device_list.json');
const portConfig = require('./server/src/config/port_config.json');
const ports = Object.values(portConfig)
ports.push(...deviceList.map(i => i.port));
const portArgs = ports.map(port => `-p ${port}:${port}`).join(' '); // `-p 8600:8600`

// package 参数读取
const packageJson = require('./package.json');
const version = packageJson.version;
const projectName = packageJson.name;


/**
 * 本地 docker 仓库。
 * 支持通过参数配置。
 */
const localDockerRegistry = process?.env?.LOCAL_DOCKER_REGISTRY || '192.168.3.107:5000';


const noDotVersion = version.replace(/\./g, '');
const imageName = `hozeee/${projectName}:${version}`;

// 构建镜像命令  (原始命令 "docker build --pull --rm -f \"Dockerfile\" -t hozeee/${projectName}:$npm_package_version \".\"" )
const buildCommand = `docker build --pull --rm -f "Dockerfile" -t ${imageName} "."`;
const tagCommand = `docker tag ${imageName} ${localDockerRegistry}/${imageName}`;
const pushCommand = `docker push ${localDockerRegistry}/${imageName}`;

// 运行镜像命令  (原始命令 "export no_dot_version=$(echo $npm_package_version | sed 's/\\.//g') && docker run -d --name ${projectName}_v$no_dot_version --restart=always -p 8600:8600 -p 8601:8601 -p 8602:8602 -p 8690:8690 -p 8691:8691 hozeee/${projectName}:$npm_package_version" )
const pullCommand = `docker pull ${localDockerRegistry}/${imageName}`;
const runCommand = `docker run -d --name ${projectName}_v${noDotVersion} --restart=always ${portArgs} ${localDockerRegistry}/${imageName}`;

// TODO: 生成 使用镜像的 Linux 主机配置 /etc/docker/daemon.json




/**
 * 生成 nginx 配置文件。
 * 
 * 本文件会在当前目录生成 nginx 配置，
 * 实际使用还需要拷贝到 Linux 主机上，
 * 可以作为参考。
 * 
 * 在 stream 内添加 " include /etc/nginx/conf.d/_stream.*.conf; "
 * 
 * 注意！
 *   1. 改完配置后，先运行 `nginx -t` 测试一下配置，看到 "... test is successful" 才是可用的。
 *   2. 使用 `service nginx restart` 重启服务。
 */
function createNginxStream() {
  const HOSTNAME = process.env.HOSTNAME || '192.168.3.101';

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
}



/**
 * 执行操作。
 * 通过参数来决定执行的命令。
 */
const type = process.env.__COMMAND_TYPE;
switch (type) {
  case 'build': {
    console.log(`[执行命令] ${buildCommand}`);
    const res1 = execSync(buildCommand, { encoding: 'utf8' });
    // console.log(res1);

    console.log(`[执行命令] ${tagCommand}`);
    const res2 = execSync(tagCommand, { encoding: 'utf8' });
    console.log(res2);

    console.log(`[执行命令] ${pushCommand}`);
    const res3 = execSync(pushCommand, { encoding: 'utf8' });
    console.log(res3);
    break;
  }

  case 'run': {
    console.log(`[执行命令] ${pullCommand}`);
    const res1 = execSync(pullCommand, { encoding: 'utf8' });

    console.log(`[执行命令] ${runCommand}`);
    const res2 = execSync(runCommand, { encoding: 'utf8' });
    break;
  }

  // 打印运行命令，方便拷贝到"部署主机"上执行
  case 'print-build': {
    console.log(`${buildCommand} && ${tagCommand} && ${pushCommand} \n`);
    break;
  }
  case 'print-run': {
    console.log(`${pullCommand} && ${runCommand} \n`);
    break;
  }

  case 'create-nginx-config': {
    createNginxStream();
    break;
  }
}

