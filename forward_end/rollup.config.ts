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
    input: './src/controller.ts',
    output: {
      file: 'dist/controller.js',
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