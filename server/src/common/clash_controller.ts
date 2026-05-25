import { execSync } from 'child_process';
import { join } from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { stringify } from 'query-string';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import configGroups from '../config/clash.config.json';


/**
 * 类型定义：分组后的配置结构
 */
export interface IClashChildConfig {
  name: string;
  port: number;
  'socks-port': number;
  'redir-port': number;
  'external-controller': number;
}

export interface IClashGroupConfig {
  groupId: string;
  group: string;
  configUrl: string;
  children: IClashChildConfig[];
}

// 类型断言：JSON 导入的数据转为分组结构类型
const CLASH_GROUPS = configGroups as IClashGroupConfig[];

const CLASH_DIR = join(process.cwd(), 'clash');
const SERVER_DIR = process.cwd();
const CLASH_RUN_FILENAME = 'mihomo-linux-amd64-v3-alpha-dede56f'; // 'clash-linux-amd64-v1.18.0';
const CLASH_LOG_FILENAME = 'clash.log';
const DEFAULT_DELAY_TEST_URL = 'https://lubansms.com'; // 'http://www.gstatic.com/generate_204';


// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 获取所有子节点配置（展平后的扁平数组），供外部按 port 查找等场景使用。
 */
export function getFlatClashConfigList(): IClashChildConfig[] {
  return CLASH_GROUPS.flatMap(g => g.children);
}

/**
 * 根据 port 查找所属的 group 配置。
 */
export function findGroupByPort(port: number): IClashGroupConfig | undefined {
  return CLASH_GROUPS.find(g => g.children.some(c => c.port === port));
}

/**
 * 根据 port 查找子节点配置。
 */
export function findChildByPort(port: number): IClashChildConfig | undefined {
  for (const group of CLASH_GROUPS) {
    const child = group.children.find(c => c.port === port);
    if (child) return child;
  }
  return undefined;
}

/**
 * group 基础配置文件路径（下载的原始订阅配置）。
 * 例如：ccave_clash_config.yaml
 */
function getGroupBaseConfigPath(groupId: string) {
  return join(CLASH_DIR, `${groupId}_clash_config.yaml`);
}

/**
 * group 下某端口的衍生配置文件路径。
 * 例如：ccave_clash_config_8630.yaml
 */
function getGroupPortConfigPath(groupId: string, port: number) {
  return join(CLASH_DIR, `${groupId}_clash_config_${port}.yaml`);
}

/**
 * 判断 configUrl 是否为本地路径（非 http/https 协议）。
 */
function isLocalPath(configUrl: string): boolean {
  return !configUrl.startsWith('http://') && !configUrl.startsWith('https://');
}

/**
 * 将本地配置文件拷贝到 clash 目录作为基础配置。
 */
function copyLocalConfig(configUrl: string, destPath: string) {
  const srcPath = join(SERVER_DIR, configUrl);
  console.log(`clash 本地配置: ${srcPath}  ->  ${destPath}`);
  fs.copySync(srcPath, destPath);
}


// ─────────────────────────────────────────────────────────────────────────────
// 配置下载
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 并行启动时的配置文件下载锁，避免同一 group 多个实例同时下载同一份配置。
 * key: groupId
 */
const _configDownloadPromises = new Map<string, Promise<void>>();

/**
 * 确保指定 group 的配置文件已下载（带 Promise 去重锁）。
 * 支持本地路径（相对于 server 目录）和远程 URL。
 */
async function ensureConfigDownloaded(groupId: string, configUrl: string) {
  const exists = await isConfigFileExists(groupId);
  if (exists) {
    console.log(`clash 配置文件已存在: ${groupId}`);
    return;
  }
  if (!_configDownloadPromises.has(groupId)) {
    const filePath = getGroupBaseConfigPath(groupId);
    if (isLocalPath(configUrl)) {
      _configDownloadPromises.set(groupId, Promise.resolve(copyLocalConfig(configUrl, filePath)));
    } else {
      _configDownloadPromises.set(groupId, downloadConfig(configUrl, filePath));
    }
  }
  await _configDownloadPromises.get(groupId);
}


/**
 * 下载配置文件到指定路径。
 *
 * 踩坑记录:
 *   1. 这里可能会在容器下载失败(网络环境不一样)
 *   2. 也要注意清理 server/clash 目录下的衍生 .yaml 文件
 */
export function downloadConfig(url: string, filePath: string) {
  console.log(`clash 配置地址: ${url}  ->  ${filePath}`);
  return axios({ method: 'get', url })
    .then((res) => {
      const fileContent: string = res.data;
      fs.writeFileSync(filePath, fileContent);
    })
    .catch((err) => {
      console.error(`clash 配置文件下载失败: ${err}`);
      throw err;
    });
}


/**
 * 判断指定 group 的基础配置文件是否存在。
 */
async function isConfigFileExists(groupId: string) {
  try {
    return await fs.pathExists(getGroupBaseConfigPath(groupId));
  } catch (err) { }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// 配置生成
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 根据各 group 的基础配置文件，为每个子节点生成对应端口的配置文件。
 *
 * 文件命名规则：
 *   基础配置：{groupId}_clash_config.yaml（下载所得）
 *   端口配置：{groupId}_clash_config_{port}.yaml（由本函数生成）
 */
function generateMultiPortConfigFiles() {
  for (const groupConfig of CLASH_GROUPS) {
    const baseFilePath = getGroupBaseConfigPath(groupConfig.groupId);
    if (!fs.existsSync(baseFilePath)) {
      console.error(`group(${groupConfig.groupId}) 基础配置文件(${baseFilePath}) 不存在，跳过`);
      continue;
    }
    const fileContent = fs.readFileSync(baseFilePath, 'utf8');
    const baseConfig = yamlLoad(fileContent) as Record<string, any>;
    for (const portConfig of groupConfig.children) {
      const config = { ...baseConfig };
      // ── 裁剪配置：只保留当前子节点需要的 proxy ──
      // 大幅减少 mihomo 初始化负担（避免加载全部代理节点 + 健康检查）
      const targetProxy = findProxyByName(baseConfig, portConfig.name);
      config['proxies'] = targetProxy ? [targetProxy] : [];
      delete config['proxy-groups'];
      delete config['rules'];
      delete config['rule-providers'];
      delete config['proxy-providers'];
      // 开启持久化：记住上次选择的节点，重启后无需重新切换
      config['profile'] = {
        'store-selected': true,
        'store-fake-ip': false,
      };
      // 保证配置的端口是固定的
      config['external-controller'] = `0.0.0.0:${portConfig['external-controller']}`;
      config['port'] = portConfig.port;
      config['socks-port'] = portConfig['socks-port'];
      config['redir-port'] = portConfig['redir-port'];
      config['allow-lan'] = true; // 开放给其他机器
      config['log-level'] = 'debug'; // 日志等级: info / warning / error / debug / silent
      config['mode'] = 'global'; // 全局模式
      // 写入文件
      const yamlStr = yamlDump(config);
      const filePath = getGroupPortConfigPath(groupConfig.groupId, portConfig.port);
      fs.writeFileSync(filePath, yamlStr);
      console.log(`已生成精简配置: ${filePath} (proxy: ${portConfig.name})`);
    }
  }
}

/**
 * 从基础配置的 proxies 列表中，查找指定名称的代理节点。
 */
function findProxyByName(baseConfig: Record<string, any>, name: string): Record<string, any> | undefined {
  const proxies = baseConfig['proxies'];
  if (!Array.isArray(proxies)) return undefined;
  return proxies.find((p: any) => p.name === name);
}

/**
 * 轮询等待 mihomo 的 external-controller API 就绪。
 * pm2 start 只是通知 pm2 拉起进程，API 未必立即可用。
 */
async function waitForApiReady(port: number, timeoutMs = 30000): Promise<boolean> {
  const child = findChildByPort(port);
  if (!child) return false;
  const url = `http://127.0.0.1:${child['external-controller']}/version`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(url, { timeout: 2000 });
      if (res.status === 200) {
        console.log(`clash API 已就绪 (port=${port})`);
        return true;
      }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.error(`clash API 等待超时 (port=${port}, ${timeoutMs}ms)`);
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// Clash 进程管理
// ─────────────────────────────────────────────────────────────────────────────

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
export async function checkClashNode(port: number, targetUrl = DEFAULT_DELAY_TEST_URL): Promise<{ delay?: number; error?: string }> {
  try {
    const config = findChildByPort(port);
    if (!config) return { error: `未找到 port=${port} 对应的配置` };
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
 * 启动 clash 服务。
 */
export async function startClash(port: number, options?: { skipGenerateConfig?: boolean }) {
  try {
    const group = findGroupByPort(port);
    if (!group) {
      console.error(`未找到 port=${port} 所属的 group`);
      return false;
    }

    // 配置文件下载（按 group 隔离，同一 group 内通过 Promise 去重）
    await ensureConfigDownloaded(group.groupId, group.configUrl);
    if (!options?.skipGenerateConfig) {
      generateMultiPortConfigFiles();
    }

    // 启动
    const isRunning = isRunningClash(port);
    if (isRunning) {
      console.log(`clash 已启动: ${port}`);
    } else {
      const name = getClashPm2Name(port);
      const file = getGroupPortConfigPath(group.groupId, port);

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

    // 等待 API 就绪（pm2 start 只是拉起进程，external-controller 未必立即可用）
    await waitForApiReady(port, 30000);

    /**
     * 切换节点。
     * 配置了 profile.store-selected 后，mihomo 会从 cache.db 恢复上次选择的节点。
     * 如果是首次启动（无缓存），则需要手动切换。
     *
     * 踩坑记录:
     * time="2024-07-05T14:10:30+08:00" level=warning msg="[TCP] dial 🔰国外流量 (match DomainKeyword/google) 127.0.0.1:40428 --> www.google.com:443 error: 127.0.0.1:443 connect error: dial tcp4 127.0.0.1:443: connect: connection refused"
     * 上面是 clash 的运行日志，其中 "127.0.0.1:443" 说的是我们的请求被转发到本地的 443 端口上，其实就是命中了其中一条规则，就是转发到 443 导致。
     * 切换节点即可。
     */
    let _count = 10;
    const SWITCH_INTERVAL = 1 * 1000;
    const childConfig = findChildByPort(port);
    while (_count > 0 && childConfig) {
      _count--;
      try {
        const success = await switchClashProxy(port, childConfig.name, 'GLOBAL');
        if (success) {
          console.log(`clash 节点切换成功: ${childConfig.name}`);
          _count = -1;
          continue;
        }
      } catch (err: any) { }
      console.error(`clash 节点切换失败(${_count}): ${childConfig.name}`);
      await new Promise((resolve) => setTimeout(resolve, SWITCH_INTERVAL));
    }

    return isRunningClash(port);
  } catch (_) {
    return false;
  }
}

export async function startAllClashServers() {
  // 并行下载所有 group 的配置
  await Promise.allSettled(
    CLASH_GROUPS.map(g => ensureConfigDownloaded(g.groupId, g.configUrl))
  );

  // 生成所有端口的配置文件
  generateMultiPortConfigFiles();

  // 并行启动所有 clash 实例，大幅缩短总启动时间
  const allChildren = CLASH_GROUPS.flatMap(g => g.children);
  const results = await Promise.allSettled(
    allChildren.map((config) => startClash(config.port, { skipGenerateConfig: true }))
  );

  // 输出各实例启动结果
  for (let i = 0; i < allChildren.length; i++) {
    const result = results[i];
    const port = allChildren[i].port;
    if (result.status === 'rejected') {
      console.error(`clash 启动异常 (port=${port}): ${result.reason}`);
    }
  }
}


function getClashPm2Name(port: number) {
  return `${CLASH_RUN_FILENAME}__${port}`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Clash API 操作
// ─────────────────────────────────────────────────────────────────────────────

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
type IInfoType = 'logs' | 'traffic' | 'version' | 'configs' | 'proxies' | 'rules' | 'connections' | 'dns/query';
export async function getClashInfo(port: number, type: IInfoType, dnsName?: string, dnsType?: 'A' | 'AAAA' | 'CNAME') {
  const isRunning = isRunningClash(port);
  const config = findChildByPort(port);
  if (!isRunning || !config) return null;

  /**
   * TODO: 实测记录
   * 'traffic' 'logs' 会卡住， 'dns/query' 未测。
   * logs 的可能跟 "log-level": "silent", 有关。
   */

  const dnsSearch = type === 'dns/query' ? `?${stringify({ name: dnsName, type: dnsType })}` : '';
  const url = `http://127.0.0.1:${config['external-controller']}/${type}${dnsSearch}`;

  try {
    const res = await axios<Record<string, any>>({ method: 'get', url });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}


/**
 * 切换 Selector 中选中的节点。
 */
export async function switchClashProxy(port: number, name: string, proxyGroup = '🔰国外流量') {
  const config = findChildByPort(port);
  if (!config) return false;
  const encodedGroup = encodeURIComponent(proxyGroup);
  const url = `http://127.0.0.1:${config['external-controller']}/proxies/${encodedGroup}`;

  try {
    await axios.put<string>(url, { name });
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
  const config = findChildByPort(port);
  if (!config) return null;
  const url = `http://127.0.0.1:${config['external-controller']}/connections${id ? '/' + id : ''}`;

  try {
    const res = await axios<string>({ method: 'delete', url });
    const json = res.data;
    return json;
  } catch (_) {
    return null;
  }
}
