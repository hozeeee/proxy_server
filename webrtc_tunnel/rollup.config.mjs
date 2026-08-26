import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import fs from 'fs';
import path from 'path';

/**
 * Rollup 配置
 *
 * 通过环境变量 TARGET 控制构建目标:
 *   TARGET=server  → 打包信令服务器为单文件 dist/server.js
 *   TARGET=client  → 打包客户端为单文件 dist/client-bin.js (node-datachannel 为外部依赖)
 *   TARGET=test    → 打包端到端测试为单文件 dist/test_e2e.js
 *   不指定          → 同时构建 client + server + test
 */

/**
 * 自定义插件：将 client-bin.js 内容注入为字符串常量
 * 用于 server 构建，使 server 可以提供 client.js 下载
 */
function injectClientScript() {
  return {
    name: 'inject-client-script',
    resolveId(source) {
      if (source === 'virtual:client-script') {
        return source;
      }
      return null;
    },
    load(id) {
      if (id === 'virtual:client-script') {
        const clientPath = path.resolve('dist/client-bin.js');
        if (!fs.existsSync(clientPath)) {
          console.warn('⚠️  dist/client-bin.js 不存在，跳过注入。请先运行 npm run build:client');
          return 'export default "";';
        }
        const content = fs.readFileSync(clientPath, 'utf-8');
        // 转义为 JS 字符串
        return `export default ${JSON.stringify(content)};`;
      }
      return null;
    }
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
    injectClientScript(),
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
} else if (target === 'test') {
  configs = [testConfig];
} else {
  // 同时构建时，先构建 client，再构建 server（确保 client-bin.js 存在以便注入）
  configs = [clientConfig, serverConfig, testConfig];
}

export default configs;
