import { execSync } from 'child_process';
import { join } from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { stringify } from 'query-string';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import configList from '../config/clash.config.json';


const CLASH_CONFIG_URL = 'https://39056.subxiandan.top:9604/ssp/cave/link/ZWwakjF4eVPCHwcg?clash=1';
const CLASH_DIR = join(__dirname, '../../clash');
const CLASH_CONFIG_FILENAME = 'clash_config.yaml';
const CLASH_RUN_FILENAME = 'mihomo-linux-amd64-v3-alpha-dede56f'; // 'clash-linux-amd64-v1.18.0';
const CLASH_LOG_FILENAME = 'clash.log';

/**
 * 并行启动时的配置文件下载锁，避免多个实例同时下载同一份配置。
 */
let _configDownloadPromise: Promise<void> | null = null;
async function ensureConfigDownloaded() {
  const exists = await isConfigFileExists();
  if (exists) {
    console.log('clash 配置文件已存在');
    return;
  }
  if (!_configDownloadPromise) {
    _configDownloadPromise = downloadConfig(CLASH_CONFIG_URL || process.env.CLASH_CONFIG_URL);
  }
  await _configDownloadPromise;
}



/**
 * 下载配置文件。
 * 踩坑记录:
 *   1. 这里可能会在容器下载失败(网络环境不一样)
 *   2. 也要注意清理 server/clash 目录下的"衍生".yaml 文件
 */
export function downloadConfig(url: string) {
  console.log(`clash 配置地址: ${url}`);
  return axios({ method: 'get', url, })
    .then((res) => {
      const fileContent: string = res.data;
      // // 配置解析
      // const config = yamlLoad(fileContent) as Record<string, any>;
      // const yamlStr = yamlDump(config);
      const filePath = join(CLASH_DIR, CLASH_CONFIG_FILENAME);
      // fs.writeFileSync(filePath, yamlStr);
      fs.writeFileSync(filePath, fileContent);
    })
    .catch((err) => {
      console.error(`clash 配置文件下载失败: ${err}`);
      throw err;
    });
}



/**
 * 根据基础的配置文件，生成多个端口的配置文件。
 */
function generateMultiPortConfigFiles() {
  const baseFilePath = join(CLASH_DIR, CLASH_CONFIG_FILENAME);
  if (!fs.existsSync(baseFilePath)) {
    console.error(`基础配置文件(${baseFilePath}) 不存在，无法生成多端口配置文件`);
    return;
  }
  const fileContent = fs.readFileSync(baseFilePath, 'utf8');
  const baseConfig = yamlLoad(fileContent) as Record<string, any>;
  for (const portConfig of configList) {
    const config = { ...baseConfig };
    // 保证配置的端口是固定的
    config['external-controller'] = `0.0.0.0:${portConfig['external-controller']}`;
    config['port'] = portConfig.port;
    config['socks-port'] = portConfig['socks-port'];
    config['redirect-port'] = portConfig['redirect-port'];
    config['allow-lan'] = true; // 开放给其他机器
    config['log-level'] = 'debug'; // 日志等级: info / warning / error / debug / silent
    config['mode'] = 'global'; // 全局模式
    // 写入文件
    const yamlStr = yamlDump(config);
    const filePath = join(CLASH_DIR, CLASH_CONFIG_FILENAME.replace('.yaml', `_${portConfig.port}.yaml`));
    fs.writeFileSync(filePath, yamlStr);
  }
}

/**
 * 判断是否已经运行了 clash 服务。
 */
export function isRunningClash(port: number) {
  try {
    const pm2ListRes = execSync('pm2 list', { encoding: 'utf8' });
    const name = getClashPm2Name(port);
    if (pm2ListRes.includes(name)) {
      return true;
    }
  } catch (_) { }
  return false;
}

/**
 * 测试延迟。
 */
export async function checkClashNode(port: number, targetUrl = 'http://www.gstatic.com/generate_204'): Promise<{ delay?: number; error?: string }> {
  try {
    const config = configList.find(i => i.port === port);
    const res = await axios.get(
      `http://127.0.0.1:${config['external-controller']}/proxies/${encodeURIComponent(config.name)}/delay`,
      {
        params: { url: targetUrl, timeout: 5000 },
        timeout: 6000,
      }
    );
    return res.data;
  } catch (err) {
    return { error: `非预期错误: ${err}` };
  }
}


/**
 * 判断配置文件是否存在。
 */
async function isConfigFileExists() {
  try {
    const _path = join(CLASH_DIR, CLASH_CONFIG_FILENAME);
    const exists = await fs.pathExists(_path);
    return exists;
  } catch (err) { }
  return false;
}

/**
 * 启动 clash 服务。
 */
export async function startClash(port: number, options?: { skipGenerateConfig?: boolean }) {
  try {
    // 配置文件下载（并行启动时通过 Promise 去重，避免多个实例同时下载）
    await ensureConfigDownloaded();
    if (!options?.skipGenerateConfig) {
      generateMultiPortConfigFiles();
    }

    // 启动
    const isRunning = isRunningClash(port);
    if (isRunning) console.log(`clash 已启动: ${port}`);
    else {
      const name = getClashPm2Name(port);
      const file = join(CLASH_DIR, CLASH_CONFIG_FILENAME.replace('.yaml', `_${port}.yaml`));

      let logFileName = CLASH_LOG_FILENAME.replace('.log', `_${port}.log`);
      // 日志文件不存在需要创建
      logFileName = join(CLASH_DIR, logFileName);
      if (!fs.existsSync(logFileName)) {
        console.log(`日志文件(${logFileName}) 不存在，正在创建...`);
        fs.createFileSync(logFileName);
        console.log(`日志文件(${logFileName}) 创建成功`);
      }

      const command = `pm2 start ${join(CLASH_DIR, CLASH_RUN_FILENAME)} --log ${logFileName} --name ${name} -- -f ${file}`;
      // console.log(`运行命令: ${command}`)
      execSync(command);
      console.log(`clash 启动成功: ${port}`);
    }

    /**
     * 切换节点。
     * 需要重试几次，因为上面的命令执行完后未必服务马上生效。
     *
     * 踩坑记录:
     * time="2024-07-05T14:10:30+08:00" level=warning msg="[TCP] dial 🔰国外流量 (match DomainKeyword/google) 127.0.0.1:40428 --> www.google.com:443 error: 127.0.0.1:443 connect error: dial tcp4 127.0.0.1:443: connect: connection refused"
     * 上面是 clash 的运行日志，其中 "127.0.0.1:443" 说的是我们的请求被转发到本地的 443 端口上，其实就是命中了其中一条规则，就是转发到 443 导致。
     * 切换节点即可。
     */
    let _count = 3;
    const SWITCH_INTERVAL = 1 * 1000;
    while (_count > 0) {
      _count--;
      const config = configList.find(i => i.port === port);
      try {
        const success = await switchClashProxy(port, config.name, 'GLOBAL');
        // const success = await switchClashProxy(port, config.name);
        if (success) {
          console.log(`clash 节点切换成功: ${config.name}`);
          _count = -1;
          continue;
        }
      } catch (err: any) { }
      console.error(`clash 节点切换失败(${_count}): ${config.name}`);
      await new Promise((resolve) => setTimeout(resolve, SWITCH_INTERVAL));
    }

    return isRunningClash(port);
  } catch (_) {
    return false;
  }
}
export async function startAllClashServers() {
  // 预先生成所有端口的配置文件，避免在循环中重复生成 (15×15=225次 → 仅15次)
  generateMultiPortConfigFiles();

  // 并行启动所有 clash 实例，大幅缩短总启动时间
  const results = await Promise.allSettled(
    configList.map((config) => startClash(config.port, { skipGenerateConfig: true }))
  );

  // 输出各实例启动结果
  for (let i = 0; i < configList.length; i++) {
    const result = results[i];
    const port = configList[i].port;
    if (result.status === 'rejected') {
      console.error(`clash 启动异常 (port=${port}): ${result.reason}`);
    }
  }
}


function getClashPm2Name(port: number) {
  return `${CLASH_RUN_FILENAME}__${port}`;
}


/**
 * 查询 clash 的一些状态。
 *   'logs' -> 获取实时日志
 *   'traffic' -> 获取实时流量数据
 *   'version' -> 获取 Clash 版本
 *   'configs' -> 获取基础配置   (PUT 重新加载; PATCH 增量修改)
 *   'proxies' -> 获取所有节点信息  (/proxies/:name 节点信息; /proxies/:name/delay 节点延迟信息)
 *   'rules' -> 获取规则信息
 *   'connections' -> 获取连接信息
 *   'proxies' -> 获取所有代理集的代理信息  (/providers/proxies/:name 指定信息; /providers/proxies/:name/healthcheck 指定健康信息)
 *   'dns/query?name={name}[&type={type}]' -> 获取指定域名和类型的 DNS 查询数据  (name: 域名; type: DNS 记录类型，如 A、MX、CNAME 等，可选，默认 A)
 *
 * DNS 类型:
 *   A     -> IPv4 域名解析
 *   AAAA  -> IPv6 域名解析
 *   CNAME -> 域名指向另一个域名
 *    (下面不常用，详见 https://browser.alibaba-inc.com/?Url=https://www.guokeyun.com/news/technology/detail/736.html?navId=22)
 *   NS    -> ...
 *   MX    -> ...
 *   TXT   -> ...
 *   SOA   -> ...
 *   SRV   -> ...
 *   URL   -> ...
 */
type IInfoType = 'logs' | 'traffic' | 'version' | 'configs' | 'proxies' | 'rules' | 'connections' | 'proxies' | 'dns/query';
export async function getClashInfo(port: number, type: IInfoType, dnsName?: string, dnsType?: 'A' | 'AAAA' | 'CNAME') {
  const isRunning = isRunningClash(port);
  const config = configList.find(i => i.port === port);
  if (!isRunning || !config) return null;

  /**
   * TODO: 实测记录
   * 'traffic' 'logs' 会卡住， 'dns/query' 未测。
   * logs 的可能跟 "log-level": "silent", 有关。
   */

  const dnsSearch = type === 'dns/query' ? `?${stringify({ name: dnsName, type: dnsType })}` : '';
  const url = `http://127.0.0.1:${config['external-controller']}/${type}${dnsSearch}`;

  try {
    const res = await axios<Record<string, any>>({ method: 'get', url, });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}


/**
 * 切换 Selector 中选中的节点。
 */
export async function switchClashProxy(port: number, name: string, group = '🔰国外流量') {
  const config = configList.find(i => i.port === port);
  group = encodeURIComponent(group);
  const url = `http://127.0.0.1:${config['external-controller']}/proxies/${group}`;

  try {
    const res = await axios.put<string>(url, { name });
    // const json = res.data; // 是空的，响应码是 204
    return true;
  } catch (_) {
    return false;
  }
}


/**
 * 关闭特定(或所有)连接。
 */
export async function closeClashConnection(port: number, id?: string) {
  const config = configList.find(i => i.port === port);
  const url = `http://127.0.0.1:${config['external-controller']}/connections${id ? '/' + id : ''}`;

  try {
    const res = await axios<string>({ method: 'delete', url, });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}


