import { Provide } from '@midwayjs/core';
import fs from 'fs-extra';
import { join, resolve } from 'path';
import { chiiPort, serverPort } from '../config/port_config.json';
import { exec, execSync } from 'child_process';

export const CACHE_FILE_DIR = join(process.cwd(), 'cache_files');
fs.ensureDirSync(CACHE_FILE_DIR);


/**
 * 说明:
 *   用于获取当前服务挂载的域名，
 *   只需要检测一次。
 *
 * TODO: 这功能实际不太可用，在容器中运行可能存在网络问题，类似于 通过域名访问 whistle 不可达。
 *
 * 完整链路:
 *   1. 终端设备通过本项目的 whistle 服务代理；
 *   2. 被代理的目标页面会注入 script 脚本 (chii)；
 *   3. chii 脚本会连接到本项目的 chii 服务上，但一般都是 https 服务；
 *   4. 但 chii 服务默认只有 http ，所以需要通过 whistle 额外代理 https 的 chii 脚本访问 (下面的代码)；
 *   5. 访问 chii 服务即可远程调试页面。
 *
 *
 *
 * TODO: ~/proxy_server/WhistleAppData/.whistle/values/files/0.chii_target.js 文件是直接拷贝的，可以考虑直接调用 chii 服务来下载文件。
 */


const isLocalEnv = process.env.NODE_ENV === 'local';

const WHISTLE_RULES_FILE = !isLocalEnv ? join('/root', './.WhistleAppData/.whistle/rules/properties')
  : join(process.cwd(), '../', 'WhistleAppData/.whistle/rules/properties');   // 本地测试
fs.ensureFile(WHISTLE_RULES_FILE);

const WHISTLE_VALUES_FILES_DIR = !isLocalEnv ? join('/root', './.WhistleAppData/.whistle/values/files')
  : join(process.cwd(), '../', 'WhistleAppData/.whistle/values/files');   // 本地测试
fs.ensureDir(WHISTLE_VALUES_FILES_DIR);


// 服务挂载的域名
const _domains: string[] = [];
export const getDomains = () => [..._domains];
export const addDomain = (host: string) => {
  if (!host || typeof host !== 'string') return false;
  const [domain, port] = host.split(':');
  if (!_domains.includes(domain)) {
    _domains.push(domain);
    updateChiiConfigToCacheFile();
    return true;
  }
  return false;
}


/**
 * 注入 chii 脚本的网站。
 *   格式: [<href>, <local_domain>]
 *   例如: ['https://www.baidu.com/s', '192.168.3.101']
 */
const _chiiInjectionList: string[][] = [];
export const getChiiInjectionList = () => _chiiInjectionList.map(l => [...l]);
export const addChiiInjection = (href: string, domain: string) => {
  if (!href || !domain || typeof href !== 'string' || typeof domain !== 'string') return false;
  const index = _chiiInjectionList.findIndex(l => l[0] === href);
  if (index === -1) {
    _chiiInjectionList.push([href, domain]);
  }
  else {
    const isSame = _chiiInjectionList[index][1] === domain;
    if (isSame) return false;
    _chiiInjectionList[index][1] = domain;
  }
  updateChiiConfigToCacheFile();
  return true;
}
export const delChiiInjection = (href: string) => {
  if (!href) return false;
  const index = _chiiInjectionList.findIndex(l => l[0] === href);
  if (index !== -1) _chiiInjectionList.splice(index, 1);
  return true;
}



@Provide()
export class ChiiManagerService {

}


/**
 * 写入 chii 配置文件。
 * @param reg 匹配 defalutRules 替换的正则
 * @param partContent 被替换进去的内容
 */
function writeChiiConfig(reg: RegExp, partContent: string) {
  const FALLBACK_CONTENT = `{"filesOrder":[],"selectedList":[],"disabledDefalutRules":false,"defalutRules":""}`;
  try {
    // 兼容文件不存在
    if (!fs.existsSync(WHISTLE_RULES_FILE)) {
      fs.writeFileSync(WHISTLE_RULES_FILE, FALLBACK_CONTENT);
      console.log(`${WHISTLE_RULES_FILE} 文件不存在，写入一个新的`);
    }
    // 兼容内容格式有问题
    let preContent = fs.readFileSync(WHISTLE_RULES_FILE, { encoding: 'utf-8' });
    let isJson = false;
    try {
      JSON.parse(preContent);
      isJson = true;
    } catch (_) { }
    if (!isJson) {
      preContent = FALLBACK_CONTENT;
      fs.writeFileSync(WHISTLE_RULES_FILE, FALLBACK_CONTENT);
      console.log(`${WHISTLE_RULES_FILE} 文件不是 json ，重新复写`);
    }

    const includeTpl = preContent.match(reg);
    // 不存在模版内容，直接写入
    if (!includeTpl) {
      try {
        const record = JSON.parse(preContent);
        record.defalutRules += partContent.replaceAll('\\n', '\n');
        preContent = JSON.stringify(record);
        console.log(`不存在模版内容，直接写入`);
        fs.writeFileSync(WHISTLE_RULES_FILE, preContent);
        return true;
      } catch (_) { }
    }
    // 内容替换写入
    else {
      const content = preContent.replaceAll(reg, partContent);
      fs.writeFileSync(WHISTLE_RULES_FILE, content);
      return true;
    }
  } catch (_) { }
  return false;
}


/**
 * 针对 https 的 target.js 文件的代理。
 */
export function writeChiiConfigForTargetJs() {
  const PRE_TEXT = '#chii_target_js_scoped__start';
  const END_TEXT = '#chii_target_js_scoped__end';
  try {
    const reg = new RegExp(`${PRE_TEXT}.+?${END_TEXT}`, 'g');
    const partContent = `\\n${PRE_TEXT}\\n${_domains.map(d =>
      `$https://${d}:${chiiPort}/target.js resBody://{chii_target.js}`
    ).join('\\n')}\\n${END_TEXT}\\n`;
    return writeChiiConfig(reg, partContent);
  } catch (_) { }
  return false;
}
/**
 * 对所有域名都生成 chii 注入文件。
 */
export function writeChiiInjectionHtml() {
  const TARGET_JS_FILENAME = '0.chii_target.js';
  try {
    // 删除所有旧文件，除了 0.chii_target.js
    const oldFiles = fs.readdirSync(WHISTLE_VALUES_FILES_DIR);
    for (const filename of oldFiles) {
      if (filename === TARGET_JS_FILENAME) continue;
      fs.rmSync(join(WHISTLE_VALUES_FILES_DIR, filename));
    }
    // 重新写入新的
    const filesOrder: string[] = [TARGET_JS_FILENAME];
    for (let index = 0; index < _domains.length; index++) {
      const domain = _domains[index];
      const injectionFilename = `${index + 1}.chii_injection.${getDomainBase64(domain)}.html`;
      filesOrder.push(injectionFilename);
      const content = `
<div style="width: 100%; height: 10px; background-color: green;"></div>
<script src="//${domain}:${chiiPort}/target.js"></script>
<div style="width: 100%; height: 10px; background-color: red;"></div>
<!-- TODO: 在 https 网站也会存在 target.js 一样的访问问题，这个暂未解决。 -->
<script src="http://${domain}:${serverPort}/eruda.js"></script>
<script>eruda.init();</script>
`;
      fs.writeFileSync(join(WHISTLE_VALUES_FILES_DIR, injectionFilename), content);
      // 写入 properties 文件
      const propertiesContent = JSON.stringify({ filesOrder });
      fs.writeFileSync(join(WHISTLE_VALUES_FILES_DIR, '../properties'), propertiesContent);
    }
  } catch (_) { }
}


/**
 * 写入需要 chii 脚本注入的代理。
 */
export function writeChiiConfigForInjection() {
  const PRE_TEXT = '#chii_injection__start';
  const END_TEXT = '#chii_injection__end';
  try {
    const chiiInjectionFilename = fs.readdirSync(WHISTLE_VALUES_FILES_DIR).map(f => f.replace(/^(\d+\.)/, ''));
    const reg = new RegExp(`${PRE_TEXT}.+?${END_TEXT}`, 'g');
    const partContent = `\\n${PRE_TEXT}\\n${_chiiInjectionList.map(([href, domain]) => {
      const chiiFilename = chiiInjectionFilename.find(f => f.includes(getDomainBase64(domain)));
      if (!chiiFilename) return `####[error] href: ${href} ,  domain: ${domain}`;
      return `$${href} htmlAppend://{${chiiFilename}}`;
    }).join('\\n')}\\n${END_TEXT}\\n`;
    return writeChiiConfig(reg, partContent);
  } catch (_) { }
  return false;
}


function getDomainBase64(domain: string) {
  return Buffer.from(domain).toString('base64');
}




/**
 * 它的模版文件有问题，对于非本地启动的情况不可用。
 */
function fixChiiIndexTpl() {
  try {
    if (isLocalEnv) {
      console.log('本地调试不执行 fixChiiIndexTpl');
      return true;
    }
    const npmRootPath = execSync('npm root -g', { encoding: 'utf-8' }).replaceAll('\n', '');
    console.log('npmRootPath: ', npmRootPath) // TODO:del
    const tplPath = join(npmRootPath, 'chii/server/tpl/index.hbs');
    let srcTpl = fs.readFileSync(tplPath, { encoding: 'utf-8' });
    srcTpl = srcTpl.replace(`window.domain = '{{domain}}';`, `window.domain = '/';`);
    srcTpl = srcTpl.replace(`<script src="//{{domain}}{{basePath}}index.js"></script>`, `<script src="{{basePath}}index.js"></script>`);
    fs.writeFileSync(tplPath, srcTpl);
    return true;
  } catch (err) {
    console.log('fixChiiIndexTpl 执行异常: ', err);
  }
  return false;
}

/**
   * 启动 chii 调试服务。
   * TODO: 未验证 dev 阶段是否会重复执行，旧的是否会被关闭。
   *
   * 踩坑记录:
   *   "chii start" 是在前台启动，需要加上 "&" 转成后台运行。
   *   不能使用 execSync ，好像会导致整个容器服务都挂掉。
   */
export function startChiiServer() {
  try {
    fixChiiIndexTpl();
    const command = `chii start -p ${chiiPort} -h :: &`;
    // const res = execSync(command);
    // const res = spawnSync('chii', ['start', '-p', `${chiiPort}`, '&'], { encoding: 'utf-8' });
    const res = exec(command);
    console.log('chii-start-res: ', res) // TODO: 获取进程ID，方便后续关闭
    console.log(`[startChiiServer] 启动 chii 成功:  http://127.0.0.1:${chiiPort}`);
    return true;
  } catch (err) { console.log(`[startChiiServer] 启动 chii 失败: ${err?.message || err}`); }
  return false;
}



/**
 * 将 eruda 文件拷贝到 publish 目录下。 /root/proxy_server/server/node_modules/eruda/eruda.js
 */
export function copyErudaToPublish() {
  try {
    const filename = join(process.cwd(), 'node_modules/eruda/eruda.js');
    const targetFilename = join(process.cwd(), 'publish/eruda.js');
    fs.copyFileSync(filename, targetFilename);
    return true;
  } catch (err) {
    console.log('copyErudaToPublish 执行失败: ', err);
  }
  return false;
}



/**
 * 服务器重启后的数据恢复。
 */
const CHII_CONFIG_CACHE_FILENAME = join(CACHE_FILE_DIR, 'chii_config_cache.json');
let _writeChiiConfigCacheLock = false;
export function updateChiiConfigToCacheFile() {
  if (_writeChiiConfigCacheLock) {
    console.debug(`保存 chii 配置缓存失败: updateChiiConfigToCacheFile 执行中，无法写入`);
    return;
  }
  _writeChiiConfigCacheLock = true;
  try {
    const record = { domains: _domains, chiiInjectionList: _chiiInjectionList }
    const json = JSON.stringify(record, undefined, 2);
    fs.writeFileSync(CHII_CONFIG_CACHE_FILENAME, json);
  } catch (err: any) {
    console.info(`保存 chii 配置缓存失败: ${err?.message || err}`);
  }
  _writeChiiConfigCacheLock = false;
}
export function restoreChiiConfigFromCacheFile() {
  try {
    const json = fs.readFileSync(CHII_CONFIG_CACHE_FILENAME, { encoding: 'utf-8' });
    const { domains, chiiInjectionList } = JSON.parse(json);
    _domains.splice(0, _domains.length, ...domains);
    _chiiInjectionList.splice(0, _chiiInjectionList.length, ...chiiInjectionList);
    // 写入配置文件
    writeChiiConfigForTargetJs();
    writeChiiInjectionHtml();
    writeChiiConfigForInjection();
  } catch (err: any) {
    console.error(`从缓存中恢复 chii 配置失败: ${err?.message || err}`);
  }
}
