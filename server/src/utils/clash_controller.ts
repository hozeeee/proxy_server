import { execSync } from 'child_process';
import { join } from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { stringify } from 'query-string';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';


const CLASH_DIR = join(__dirname, '../../clash');
const CLASH_CONFIG_FILENAME = 'clash_config.yaml';
const CLASH_RUN_FILENAME = 'clash-linux-amd64-v1.18.0';

export const clashPort = 9090;
export const clashHttpProxyPort = 7890;
export const clashSocksProxyPort = 7891;

/**
 * 下载配置文件。
 */
export function downloadConfig(url: string) {
  return axios({ method: 'get', url, })
    .then((res) => {
      const fileContent: string = res.data;
      // 配置解析
      const config = yamlLoad(fileContent) as Record<string, any>;
      // 保证配置的端口是固定的
      config['external-controller'] = `0.0.0.0:${clashPort}`;
      config['port'] = clashHttpProxyPort;
      config['socks-port'] = clashSocksProxyPort;
      // 写入文件
      const yamlStr = yamlDump(config);
      const filePath = join(CLASH_DIR, CLASH_CONFIG_FILENAME)
      fs.writeFileSync(filePath, yamlStr);
    })
    .catch((err) => {
      console.error(`clash 配置文件下载失败: ${err}`);
    });
}


/**
 * 判断是否已经运行了 clash 服务。
 */
function isRunningClash() {
  try {
    const pm2ListRes = execSync('pm2 list', { encoding: 'utf8' });
    if (pm2ListRes.includes(CLASH_RUN_FILENAME)) return true;
  } catch (_) { }
  return false;
}

/**
 * 启动 clash 服务。
 */
export function startClash() {
  // TODO: 判断配置文件是否存在

  // 已经启动了
  const isRunning = isRunningClash();
  if (isRunning) return true;
  // 启动&错误捕抓
  try {
    execSync(`pm2 start ${join(CLASH_DIR, CLASH_RUN_FILENAME)} --name ${CLASH_RUN_FILENAME} -- -f ${join(CLASH_DIR, CLASH_CONFIG_FILENAME)}`);
    console.log('clash 启动成功')
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
  const url = `http://127.0.0.1:${clashPort}/${type}${dnsSearch}`;

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
  const url = `http://127.0.0.1:${clashPort}/proxies/${group}`;


  try {
    const res = await axios<Record<string, any>>({ method: 'get', url: `http://127.0.0.1:${clashPort}/proxies/${encodeURIComponent('B美国 02')}/delay?url=https://www.google.com&timeout=5000`, });
    const json = res.data;
    console.log('delay: ', json)
  } catch (_) {
    console.log('delay-err: ', _)
  }

  try {
    const res = await axios.put<string>(url, { name });
    const json = res.data;
    console.log('switchClashProxy-success: ', typeof json, json)
    return json;
  } catch (_) {
    console.log('switchClashProxy-err: ', _)
    return null;
  }
}


/**
 * 关闭特定(或所有)连接。
 */
export async function closeClashConnection(id?: string) {
  const url = `http://127.0.0.1:${clashPort}/connections${id ? '/' + id : ''}`;

  try {
    const res = await axios<string>({ method: 'delete', url, });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}


