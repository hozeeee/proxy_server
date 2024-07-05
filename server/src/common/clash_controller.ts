import { execSync } from 'child_process';
import { join } from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { stringify } from 'query-string';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { CLASH_HTTP_PROXY_PORT, CLASH_SOCKS_PROXY_PORT } from '../config/port.config';


const CLASH_DIR = join(__dirname, '../../clash');
const CLASH_CONFIG_FILENAME = 'clash_config.yaml';
const CLASH_RUN_FILENAME = 'clash-linux-amd64-v1.18.0';
const CLASH_LOG_FILENAME = 'clash.log';

// 日志文件不存在需要创建
const CLASH_LOG_FULL_FILENAME = join(CLASH_DIR, CLASH_LOG_FILENAME);
if (!fs.existsSync(CLASH_LOG_FULL_FILENAME)) {
  console.log(`日志文件(${CLASH_LOG_FULL_FILENAME}) 不存在，正在创建...`);
  fs.createFileSync(CLASH_LOG_FULL_FILENAME);
  console.log(`日志文件(${CLASH_LOG_FULL_FILENAME}) 创建成功`);
}

const clashControllerPort = 9090;
const clashHttpProxyPort = CLASH_HTTP_PROXY_PORT;
const clashSocksProxyPort = CLASH_SOCKS_PROXY_PORT;

/**
 * 下载配置文件。
 */
export function downloadConfig(url: string) {
  console.log(`clash 配置地址: ${url}`);
  return axios({ method: 'get', url, })
    .then((res) => {
      const fileContent: string = res.data;
      // 配置解析
      const config = yamlLoad(fileContent) as Record<string, any>;
      // 保证配置的端口是固定的
      config['external-controller'] = `0.0.0.0:${clashControllerPort}`;
      config['port'] = clashHttpProxyPort;
      config['socks-port'] = clashSocksProxyPort;
      config['allow-lan'] = true; // 开放给其他机器
      config['log-level'] = 'info'; // 日志等级: info / warning / error / debug / silent
      // 写入文件
      const yamlStr = yamlDump(config);
      const filePath = join(CLASH_DIR, CLASH_CONFIG_FILENAME)
      fs.writeFileSync(filePath, yamlStr);
    })
    .catch((err) => {
      console.error(`clash 配置文件下载失败: ${err}`);
      throw err;
    });
}


/**
 * 判断是否已经运行了 clash 服务。
 */
function isRunningClash() {
  try {
    const pm2ListRes = execSync('pm2 list', { encoding: 'utf8' });
    if (pm2ListRes.includes(CLASH_RUN_FILENAME)) {
      console.log('clash 已启动');
      return true;
    }
  } catch (err: any) {
    console.log(`clash 启动失败: ${err?.message || err}`);
    return false;
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
export async function startClash() {
  try {
    // 配置文件下载
    const exists = await isConfigFileExists();
    if (!exists)
      await downloadConfig(process.env.CLASH_CONFIG_URL);

    // 已经启动了
    const isRunning = isRunningClash();
    if (isRunning) return true;
    // 启动
    const command = `pm2 start ${join(CLASH_DIR, CLASH_RUN_FILENAME)} --log ${CLASH_LOG_FULL_FILENAME} --name ${CLASH_RUN_FILENAME} -- -f ${join(CLASH_DIR, CLASH_CONFIG_FILENAME)}`;
    console.log(`运行命令: ${command}`)
    execSync(command);
    console.log('clash 启动成功');
    return isRunningClash();
  } catch (_) {
    return false;
  }
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
export async function getClashInfo(type: IInfoType, dnsName?: string, dnsType?: 'A' | 'AAAA' | 'CNAME') {
  const isRunning = isRunningClash();
  if (!isRunning) return null;

  /**
   * TODO: 实测记录
   * 'traffic' 'logs' 会卡住， 'dns/query' 未测。
   * logs 的可能跟 "log-level": "silent", 有关。
   */

  const dnsSearch = type === 'dns/query' ? `?${stringify({ name: dnsName, type: dnsType })}` : '';
  const url = `http://127.0.0.1:${clashControllerPort}/${type}${dnsSearch}`;

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
export async function switchClashProxy(name: string, group = '🔰国外流量') {
  group = encodeURIComponent(group);
  const url = `http://127.0.0.1:${clashControllerPort}/proxies/${group}`;


  try {
    const res = await axios<Record<string, any>>({ method: 'get', url: `http://127.0.0.1:${clashControllerPort}/proxies/${encodeURIComponent('B美国 02')}/delay?url=https://www.google.com&timeout=5000`, });
    const json = res.data;
    console.log('delay: ', json) // TODO:del
  } catch (_) {
    console.log('delay-err: ', _) // TODO:del
  }

  try {
    const res = await axios.put<string>(url, { name });
    const json = res.data;
    console.log('switchClashProxy-success: ', typeof json, json) // TODO:del
    return json;
  } catch (_) {
    console.log('switchClashProxy-err: ', _) // TODO:del
    return null;
  }
}


/**
 * 关闭特定(或所有)连接。
 */
export async function closeClashConnection(id?: string) {
  const url = `http://127.0.0.1:${clashControllerPort}/connections${id ? '/' + id : ''}`;

  try {
    const res = await axios<string>({ method: 'delete', url, });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}


