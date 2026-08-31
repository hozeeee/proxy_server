import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Rollup 配置
 *
 * 通过环境变量 TARGET 控制构建目标:
 *   TARGET=client      → 打包瘦身版客户端为单文件 dist/client-bin.js (node-datachannel 为外部依赖)
 *   TARGET=standalone  → 打包免安装版客户端为单文件 dist/client-standalone.js (内联 node-datachannel)
 *   TARGET=server      → 打包信令服务器为单文件 dist/server.js (内嵌上面两份客户端)
 *   TARGET=test        → 打包端到端测试为单文件 dist/test_e2e.js
 *   不指定              → 依次构建 client + standalone + server + test
 *
 * 两份客户端的差别只在 node-datachannel 的处理方式，业务代码完全共用同一份源码。
 */

/** 客户端产物 → 服务端用于注入的虚拟模块 id */
const CLIENT_SCRIPTS = {
  'virtual:client-script': 'dist/client-bin.js',
  'virtual:client-standalone-script': 'dist/client-standalone.js',
};

/**
 * 自定义插件：将客户端产物内容注入为字符串常量
 * 用于 server 构建，使 server 可以提供两份客户端脚本的下载
 *
 * @param embedStandalone 是否一并嵌入免安装版（约 3.8MB）。
 *        端到端测试只需信令能跑，没必要为下载能力背上这份体积。
 */
function injectClientScript({ embedStandalone = true } = {}) {
  return {
    name: 'inject-client-script',
    resolveId(source) {
      return source in CLIENT_SCRIPTS ? source : null;
    },
    load(id) {
      const relative = CLIENT_SCRIPTS[id];
      if (!relative) return null;
      if (!embedStandalone && id === 'virtual:client-standalone-script') {
        return 'export default "";';
      }

      const clientPath = path.resolve(relative);
      if (!fs.existsSync(clientPath)) {
        console.warn(`⚠️  ${relative} 不存在，跳过注入。请先构建对应的客户端产物`);
        return 'export default "";';
      }
      const content = fs.readFileSync(clientPath, 'utf-8');
      // 转义为 JS 字符串
      return `export default ${JSON.stringify(content)};`;
    }
  };
}

/**
 * 自定义插件：把 node-datachannel 连同其原生扩展一起打进客户端产物。
 *
 * 做两件事：
 *   1. 把 `node-datachannel` 的导入重定向到 src/lib/embedded_datachannel.ts，
 *      该模块只依赖原生扩展本身，绕开官方入口里那两处相对路径 require('*.node')；
 *   2. 把 node_datachannel.node 压缩成 base64 文本，通过虚拟模块内联进产物，
 *      由上面那个模块在运行时还原成磁盘文件再 dlopen。
 *
 * 原生扩展与「构建机的平台 + 架构」绑定。默认取本仓库 node_modules 里的那份，
 * 也可用环境变量覆盖，从而在一台机器上为别的平台打包：
 *   ND_NATIVE_PATH      指定 .node 文件路径
 *   ND_NATIVE_PLATFORM  该文件对应的 process.platform 值（默认当前平台）
 *   ND_NATIVE_ARCH      该文件对应的 process.arch 值（默认当前架构）
 */
function embedNodeDataChannel() {
  const NATIVE_ID = 'virtual:embedded-native';
  const shimPath = path.resolve('src/lib/embedded_datachannel.ts');

  return {
    name: 'embed-node-datachannel',
    resolveId(source) {
      if (source === 'node-datachannel') return shimPath;
      if (source === NATIVE_ID) return NATIVE_ID;
      return null;
    },
    load(id) {
      if (id !== NATIVE_ID) return null;

      const pkgDir = path.resolve('node_modules/node-datachannel');
      const binPath =
        process.env.ND_NATIVE_PATH || path.join(pkgDir, 'build/Release/node_datachannel.node');

      if (!fs.existsSync(binPath)) {
        // 不中断构建：产物依然可用（运行时会给出明确提示），便于在无原生扩展的环境下编译
        console.warn(
          `⚠️  未找到原生扩展 ${binPath}，client-standalone.js 将不含内置 node-datachannel。\n` +
            '    请先在本项目执行 npm install，或用 ND_NATIVE_PATH 指定 .node 文件路径'
        );
        return `export default ${JSON.stringify({
          version: 'unknown', platform: process.platform, arch: process.arch,
          bytes: 0, sha256: '', encoding: 'br', data: '',
        })};`;
      }

      const raw = fs.readFileSync(binPath);
      const compressed = zlib.brotliCompressSync(raw, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
      });
      const payload = {
        version: JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version,
        platform: process.env.ND_NATIVE_PLATFORM || process.platform,
        arch: process.env.ND_NATIVE_ARCH || process.arch,
        bytes: raw.length,
        sha256: crypto.createHash('sha256').update(raw).digest('hex'),
        encoding: 'br',
        data: compressed.toString('base64'),
      };

      console.log(
        `📦 内联原生扩展 node-datachannel@${payload.version} ${payload.platform}-${payload.arch}: ` +
          `${(raw.length / 1048576).toFixed(1)}MB → ${(payload.data.length / 1048576).toFixed(1)}MB (brotli+base64)`
      );
      return `export default ${JSON.stringify(payload)};`;
    },
  };
}

const serverConfig = {
  input: 'src/bin/server.ts',
  output: {
    file: 'dist/server.js',
    format: 'cjs',
    banner: '#!/usr/bin/env node',
  },
  external: ['node-datachannel'],
  plugins: [
    injectClientScript(),
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined }),
  ],
};

const clientConfig = {
  input: 'src/bin/client.ts',
  output: {
    file: 'dist/client-bin.js',
    format: 'cjs',
    banner: '#!/usr/bin/env node',
  },
  external: ['node-datachannel'],
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: './dist' }),
  ],
};

/**
 * 免安装版客户端：node-datachannel 的 JS 胶水与原生扩展一并内联，
 * 使用者拿到单个 .js 就能运行，无需 npm install、无需编译环境。
 * 代价是产物体积（多约 3.6MB）与平台绑定，详见 embedNodeDataChannel。
 */
const standaloneClientConfig = {
  input: 'src/bin/client.ts',
  output: {
    file: 'dist/client-standalone.js',
    format: 'cjs',
    banner: '#!/usr/bin/env node',
  },
  // 这里刻意不把 node-datachannel 列为 external —— 它要被打进产物
  external: [],
  plugins: [
    embedNodeDataChannel(),
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined }),
  ],
};

const testConfig = {
  input: 'src/examples/test_e2e.ts',
  output: {
    file: 'dist/test_e2e.js',
    format: 'cjs',
    banner: '#!/usr/bin/env node',
  },
  external: ['node-datachannel'],
  plugins: [
    // 测试会内联启动信令服务器，因此同样需要解析 virtual:client-script
    injectClientScript({ embedStandalone: false }),
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined }),
  ],
};

const target = process.env.TARGET;

let configs;
if (target === 'server') {
  configs = [serverConfig];
} else if (target === 'client') {
  configs = [clientConfig];
} else if (target === 'standalone') {
  configs = [standaloneClientConfig];
} else if (target === 'test') {
  configs = [testConfig];
} else {
  // 同时构建时，两份客户端都要排在 server 之前（确保产物存在以便注入）
  configs = [clientConfig, standaloneClientConfig, serverConfig, testConfig];
}

export default configs;
