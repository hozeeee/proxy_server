import { defineConfig, } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import fs from 'fs-extra';
import { join } from 'path';


const getDistFilename = (srcFilename = '') => srcFilename.replace('.ts', '.js').replace('./src', 'dist');


export default () => {

  const dir = join(__dirname, 'src/controller');
  const bridgeFilenames = fs.readdirSync(dir);

  /**
   * index.ts 文件生成后再运行构建。
   */
  const indexJsExternal = bridgeFilenames.map(filename => `./controller/${filename}`.replace('.ts', ''));
  const fileContent = `
    /**
     * 其他程序通过 SDK 的方式引入。
     */
    ${indexJsExternal.map(path => `export * from '${path}';`).join('\n')}
  `;
  const indexFilename = './src/index.ts';
  fs.writeFileSync(join(__dirname, indexFilename), fileContent);

  /**
   * bridge 打包配置。
   */
  const bridgeConfigs = bridgeFilenames.map(filename => ({
    input: `./src/controller/${filename}`,
    output: {
      file: `dist/controller/${filename.replace('.ts', '.js')}`,
      format: 'cjs',
    },
    plugins: [
      typescript(),
      resolve(),
      json(),
      commonjs(),
    ],
    // external: ['wrtc', 'imap'],
    treeshake: true,
  }));


  return defineConfig([
    {
      input: indexFilename,
      output: {
        file: getDistFilename(indexFilename), // 'dist/index.js',
        format: 'cjs'
      },
      plugins: [],
      external: indexJsExternal,
      treeshake: true,
    },
    ...bridgeConfigs,

    {
      input: './src/end_manager.ts',
      output: {
        file: 'dist/end_manager.js',
        format: 'cjs'
      },
      plugins: [
        typescript(),
        resolve(),
        json(),
        commonjs(),
      ],
      // external: ['wrtc', 'imap'],
      treeshake: true,
    },

    {
      input: 'on_build_end.ts',
      output: {
        file: 'dist/on_build_end.js',
        format: 'cjs'
      },
      plugins: [
        typescript(),
      ],
    }
  ]);
}
