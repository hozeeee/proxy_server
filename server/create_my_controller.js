// 本脚本会读取 ./src/socket/forward_end.controller.ts 的信息，生成 _proxy.controller.ts 文件。

const fs = require('fs');

const srcDir = 'src/socket';
const srcFile = 'forward_end.controller.ts';

const baseFileContent = fs.readFileSync(`${srcDir}/${srcFile}`).toString();

// 匹配设备列表的配置
const deviceListReg = /export const DEVICE_LIST: IDeviceItem<IDeviceId>\[\] = (\[)([\s\S]+?)(\]);/gm;
const dlMatchRes = Array.from(baseFileContent.matchAll(deviceListReg));
const deviceList = eval(dlMatchRes[0][1] + dlMatchRes[0][2] + dlMatchRes[0][3]);

// 基础 controller 的配置
const controllerReg = /@WSController[\s\S]+/gm;
const ctMatchRes = Array.from(baseFileContent.matchAll(controllerReg));
const controllerTxt = ctMatchRes[0][0];
if (!dlMatchRes) throw '匹配错误: 2';

// 文件头部依赖
const headerReg = /([\s\S]+)\/\* 勿删! 用于匹配头部生成新 controller 文件 \*\//gm;
const hMatchRes = Array.from(baseFileContent.matchAll(headerReg));
const headerTxt = hMatchRes[0][1];

const devDeviceId = deviceList[0].id; // 第一个是调试设备
let res = `/* 此文件由 ${__filename} 生成 */\n\n`;
res += headerTxt;
res += `import { DEVICE_LIST } from './${srcFile.replace('.ts', '')}';\n`; // 源文件的部分内容
res += `import type { IDeviceId } from './${srcFile.replace('.ts', '')}';\n`; // 源文件的部分内容
res += '\n'
for (let idx = 1, len = deviceList.length; idx < len; idx++) {
  const device = deviceList[idx];
  res += controllerTxt.replace(devDeviceId, device.id).replace('ForwardEndDeviceSocketController', `ForwardEndDeviceSocketController${idx}`) + '\n';
}

fs.writeFileSync(`${srcDir}/__${srcFile}`, res, { flag: 'w' });
console.log('新 controller 文件生成成功!');
