import { defineConfig } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default defineConfig([
  {
    input: './src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs'
    },
    plugins: [],
    external: ['./controller/http_proxy.controller', './controller/axios_request.controller', './controller/tigervnc_forward.controller'],
    treeshake: true,
  },

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
    input: './src/controller/http_proxy.controller.ts',
    output: {
      file: 'dist/controller/http_proxy.controller.js',
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
    input: './src/controller/axios_request.controller.ts',
    output: {
      file: 'dist/controller/axios_request.controller.js',
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
    input: './src/controller/tigervnc_forward.controller.ts',
    output: {
      file: 'dist/controller/tigervnc_forward.controller.js',
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