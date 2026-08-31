/**
 * 内置版 node-datachannel —— 只在 standalone 客户端构建（dist/client-standalone.js）中生效。
 *
 * 原生扩展（.node）本质是一个动态链接库，无法真正「变成 JavaScript」：它只能由
 * process.dlopen 从磁盘上的真实文件加载。因此这里采用「内联 + 运行时解包」：
 * 打包时 Rollup 把 node_datachannel.node 压缩成 base64 文本内联进产物（见
 * rollup.config.mjs 的 embedNodeDataChannel 插件），运行时再还原成磁盘文件并加载。
 * 由此换来的是使用者无需 `npm install node-datachannel`、无需编译环境，
 * 拿到单个 .js 文件就能直接跑。
 *
 * 解包文件按 `版本-平台-架构-内容哈希` 命名并落在缓存目录，二次启动直接复用；
 * 内容哈希入名意味着换版本不会撞车，也不需要考虑旧文件清理。
 *
 * 代价是产物与「构建时那台机器的平台」绑定：平台不匹配时这里会直接抛出可读错误，
 * 引导使用者改用瘦身版客户端（dist/client-bin.js + npm install node-datachannel）。
 */

import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// @ts-ignore - 虚拟模块，由 Rollup 插件注入
import payload from 'virtual:embedded-native';

/** 内联原生扩展的元信息与数据体 */
interface NativePayload {
  /** node-datachannel 的包版本 */
  version: string;
  /** 构建时所在平台，与 process.platform 同义 */
  platform: string;
  /** 构建时所在架构，与 process.arch 同义 */
  arch: string;
  /** 解压后的字节数，用于快速判断缓存是否完整 */
  bytes: number;
  /** 解压后内容的 sha256，既做缓存键也做完整性校验 */
  sha256: string;
  /** 数据压缩方式，目前固定 brotli */
  encoding: 'br';
  /** base64 编码的压缩数据；构建时找不到二进制则为空串 */
  data: string;
}

const native: NativePayload = payload;

/**
 * 解包目录覆盖项。默认目录不可写（只读根文件系统）或挂了 noexec 时，
 * 使用者可用它指到一个可写可执行的目录。
 */
const CACHE_DIR_ENV = 'WEBRTC_TUNNEL_NATIVE_DIR';

/**
 * 供 createRequire 使用的基准路径。
 *
 * 只需是一个「绝对文件路径字符串」即可 —— 我们始终以绝对路径 require 解包后的 .node，
 * 基准路径并不参与相对解析。之所以不能直接用 __filename：当客户端以
 * `curl ... | node -` 从 stdin 运行时，__filename 会是字面量 '[stdin]'，
 * Node 20+ 的 createRequire 会因它不是绝对路径而抛 ERR_INVALID_ARG_VALUE。
 */
function requireBase(): string {
  if (typeof __filename === 'string' && path.isAbsolute(__filename)) return __filename;
  // stdin / eval 等场景下 __filename 不可用，退化到 cwd 下的占位文件名
  return path.join(process.cwd(), 'webrtc-tunnel-standalone.js');
}

const nativeRequire = createRequire(requireBase());

/** 缓存目录候选，按优先级排列；家目录优先是为了跨重启复用 */
function cacheDirCandidates(): string[] {
  const custom = process.env[CACHE_DIR_ENV];
  if (custom) return [custom];

  const dirs: string[] = [];
  try {
    const home = os.homedir();
    if (home) dirs.push(path.join(home, '.cache', 'webrtc-tunnel', 'native'));
  } catch {
    // homedir 在极端环境下会抛错，忽略即可，还有 tmpdir 兜底
  }
  dirs.push(path.join(os.tmpdir(), 'webrtc-tunnel-native'));
  return dirs;
}

/** 解包后的文件名：内容哈希入名，换版本 / 换内容都不会复用到旧文件 */
function binaryFileName(): string {
  return `node_datachannel-${native.version}-${native.platform}-${native.arch}-${native.sha256.slice(0, 12)}.node`;
}

/** 已存在的解包文件是否可信（大小与哈希都对得上） */
function isUsable(file: string): boolean {
  try {
    if (fs.statSync(file).size !== native.bytes) return false;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return hash === native.sha256;
  } catch {
    return false;
  }
}

/**
 * 把内联数据还原成磁盘文件，返回其路径。
 *
 * 先写临时文件再 rename：rename 在同目录内是原子操作，
 * 这样多个客户端进程同时首次启动也不会读到写了一半的 .node。
 */
function extractTo(dir: string): string {
  const target = path.join(dir, binaryFileName());
  if (isUsable(target)) return target;

  fs.mkdirSync(dir, { recursive: true });
  const buf = zlib.brotliDecompressSync(Buffer.from(native.data, 'base64'));
  if (buf.length !== native.bytes) {
    throw new Error(`内置原生扩展解压后大小异常: ${buf.length} != ${native.bytes}`);
  }

  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf, { mode: 0o755 });
  fs.renameSync(tmp, target);
  console.log(`[native] 已解包内置 node-datachannel@${native.version} → ${target}`);
  return target;
}

/** 依次尝试各候选目录，全部失败则汇总原因抛出 */
function ensureBinary(): string {
  const failures: string[] = [];
  for (const dir of cacheDirCandidates()) {
    try {
      return extractTo(dir);
    } catch (err: any) {
      failures.push(`${dir}: ${err.message}`);
    }
  }
  throw new Error(
    `无法解包内置的 node-datachannel 原生扩展：\n  ${failures.join('\n  ')}\n` +
      `可设置环境变量 ${CACHE_DIR_ENV}=<可写目录> 指定解包位置。`
  );
}

/** 校验当前运行环境与内联的二进制是否匹配，不匹配就别浪费时间解包了 */
function assertPlatformMatches(): void {
  if (!native.data) {
    throw new Error(
      '本客户端未内置 node-datachannel 原生扩展（构建时未找到二进制文件）。\n' +
        '请改用瘦身版客户端 client.js，并在本机执行 npm install node-datachannel。'
    );
  }
  if (process.platform !== native.platform || process.arch !== native.arch) {
    throw new Error(
      `内置的 node-datachannel 原生扩展平台不匹配：产物为 ${native.platform}-${native.arch}，` +
        `当前运行环境为 ${process.platform}-${process.arch}。\n` +
        '请在目标平台上重新构建 standalone 客户端，或改用瘦身版客户端 client.js ' +
        '（需自行 npm install node-datachannel）。'
    );
  }
}

/** 原生扩展的导出对象，与 require('node-datachannel') 的默认导出同构 */
function loadAddon(): any {
  assertPlatformMatches();
  const binPath = ensureBinary();
  try {
    return nativeRequire(binPath);
  } catch (err: any) {
    throw new Error(
      `加载内置 node-datachannel 原生扩展失败 (${binPath}): ${err.message}\n` +
        '常见原因：解包目录挂载了 noexec、或系统 C 库不兼容（如 musl / Alpine，' +
        `内置二进制基于 glibc 构建）。可设置 ${CACHE_DIR_ENV} 换个目录，` +
        '或改用瘦身版客户端 client.js。'
    );
  }
}

const addon = loadAddon();

/*
 * 以下导出对齐 node-datachannel 官方入口（dist/cjs/lib/index.cjs）的形状，
 * 使得「把 node-datachannel 的导入重定向到本模块」对业务代码完全透明。
 * 官方入口本身也只是把原生扩展的成员再导出一遍，没有额外逻辑。
 */

export const PeerConnection = addon.PeerConnection;
export const DataChannel = addon.DataChannel;
export const Audio = addon.Audio;
export const Video = addon.Video;
export const Track = addon.Track;
export const WebSocket = addon.WebSocket;
export const WebSocketServer = addon.WebSocketServer;

export function preload(): void {
  addon.preload();
}

export function cleanup(): void {
  addon.cleanup();
}

export function initLogger(level: string): void {
  addon.initLogger(level);
}

export function setSctpSettings(settings: unknown): void {
  addon.setSctpSettings(settings);
}

export default addon;
