import { Context, Inject, Provide } from '@midwayjs/core';
import http from 'http';
import fs from 'fs-extra';
import { join, resolve } from 'path';
import { proxyServerPort, serverPort, whistleProxyPort, chiiPort } from '../config/port_config.json';
import { ProxyHubService } from './proxy_hub.service';
import { type IDeviceId, DEVICE_LIST } from '../common/device_config';
import { ILogger } from '@midwayjs/logger';
import { execSync } from 'child_process';


/**
 * 说明:
 *   用于获取当前服务挂载的域名，
 *   只需要检测一次。
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


// export const WHISTLE_RULES_FILE = join(process.cwd(), '../', 'WhistleAppData/.whistle/rules/properties');   // 本地测试
export const WHISTLE_RULES_FILE = join('/root', './.WhistleAppData/.whistle/rules/properties');
fs.ensureFile(WHISTLE_RULES_FILE);

// export const WHISTLE_VALUES_FILES_DIR = join(process.cwd(), '../', 'WhistleAppData/.whistle/values/files');   // 本地测试
export const WHISTLE_VALUES_FILES_DIR = join('/root', './.WhistleAppData/.whistle/values/files');
fs.ensureDir(WHISTLE_VALUES_FILES_DIR);


// 服务挂载的域名
const _domains: string[] = [];
export const getDomains = () => [..._domains];
export const addDomain = (host: string) => {
  const [domain, port] = host.split(':');
  if (!_domains.includes(domain)) {
    _domains.push(domain);
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
  if (!href || !domain) return false;
  const index = _chiiInjectionList.findIndex(l => l[0] === href);
  if (index === -1) {
    _chiiInjectionList.push([href, domain]);
    return true;
  }
  else {
    const isSame = _chiiInjectionList[index][1] === domain;
    if (isSame) return false;
    _chiiInjectionList[index][1] = domain;
    return true;
  }
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
<div style="width: 100%; height: 10px; background-color: red;"></div>
<script src="//${domain}:${chiiPort}/target.js"></script>
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
