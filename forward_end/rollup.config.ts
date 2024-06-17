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
    external: ['./forward_http_controller', './axios_request_controller'],
    treeshake: true,
  },

  {
    input: './src/forward_main_programme.ts',
    output: {
      file: 'dist/forward_main_programme.js',
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
    input: './src/forward_http_controller.ts',
    output: {
      file: 'dist/forward_http_controller.js',
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
    input: './src/axios_request_controller.ts',
    output: {
      file: 'dist/axios_request_controller.js',
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