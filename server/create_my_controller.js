// 本脚本会读取 ./src/socket/device.controller.ts 的信息，生成 __device.controller.ts 文件。

const fs = require('fs');
const deviceList = require('./src/common/device_list.json');

const srcDir = 'src/socket';
const srcFile = 'device.controller.ts';

const baseFileContent = fs.readFileSync(`${srcDir}/${srcFile}`).toString();

// 基础 controller 的配置
const controllerReg = /@WSController[\s\S]+/gm;
const ctMatchRes = Array.from(baseFileContent.matchAll(controllerReg));
const controllerTxt = ctMatchRes[0][0];

// 文件头部依赖
const headerReg = /([\s\S]+)\/\* 勿删! 勿改! 用于匹配头部生成新 controller 文件。上面内容都会被作用于新文件。 \*\//gm;
const hMatchRes = Array.from(baseFileContent.matchAll(headerReg));
const headerTxt = hMatchRes[0][1];

const devDeviceId = deviceList[0].id; // 第一个是调试设备
let res = `/* 此文件由 ${__filename} 生成 */\n\n`;
res += headerTxt;
res += '\n'
for (let idx = 1, len = deviceList.length; idx < len; idx++) {
  const device = deviceList[idx];
  res += controllerTxt.replaceAll(devDeviceId, device.id).replace('ForwardEndDeviceSocketController', `ForwardEndDeviceSocketController${idx}`) + '\n';
}

fs.writeFileSync(`${srcDir}/__${srcFile}`, res, { flag: 'w' });
console.log('新 controller 文件生成成功!');
