/**
 * 下载 mihomo (clash) 所需的 GeoIP/GeoSite 数据库文件。
 * 下载到项目根目录的 mihomo_geodata/ 文件夹中。
 * 已存在的文件会跳过下载。
 *
 * 使用方式:
 *   node scripts/download_mihomo_geodata.js          # 跳过已存在的文件
 *   node scripts/download_mihomo_geodata.js --force   # 强制重新下载
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET_DIR = path.join(__dirname, '..', 'mihomo_geodata');
const FORCE = process.argv.includes('--force');

const FILES = [
  {
    name: 'geoip.metadb',
    url: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb',
  },
  {
    name: 'geosite.dat',
    url: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',
  },
];

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

let allSkipped = true;

for (const file of FILES) {
  const filePath = path.join(TARGET_DIR, file.name);
  if (fs.existsSync(filePath) && !FORCE) {
    const stat = fs.statSync(filePath);
    console.log(`[跳过] ${file.name} 已存在 (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
    continue;
  }

  allSkipped = false;
  console.log(`[下载] ${file.name} ...`);
  console.log(`       ${file.url}`);
  try {
    execSync(`curl -fSL -o "${filePath}" "${file.url}"`, { stdio: 'inherit' });
    const stat = fs.statSync(filePath);
    console.log(`[完成] ${file.name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)\n`);
  } catch (err) {
    console.error(`[失败] ${file.name}: ${err.message}`);
    // 删除可能产生的不完整文件
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    process.exitCode = 1;
  }
}

if (allSkipped) {
  console.log('所有文件已存在，无需下载。使用 --force 强制重新下载。');
}
