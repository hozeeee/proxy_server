/**
 * 健康检查控制器（Watch Tower 接入契约）
 *
 * - GET /__watch/health   返回约定格式的 JSON 健康状态
 *
 * 契约要点：
 * - HTTP 状态码固定 200，业务是否健康由 status 字段表达，
 *   这样监控端才能区分「服务挂了」和「服务活着但依赖有问题」。
 * - 子项聚合：任一子项 down 则整体 down，有 degraded 则整体 degraded。
 * - checks 参与状态判定；metrics 供机器读取；extras 是给人看的展示信息，
 *   label 用中文，extras 里的 status 只给单条着色，不影响整体状态。
 * - 接口不做鉴权，仅暴露运行状态，不返回任何配置或业务数据。
 */

import { Controller, Get, Inject, App } from '@midwayjs/core';
import { Context } from '@midwayjs/web';
import { Application as SocketApplication } from '@midwayjs/socketio';
import path from 'path';
import fs from 'fs';
import { sqlite } from '../db';
import { DEVICE_LIST } from '../common/device_config';
import { HttpProxyEntranceService } from '../service/http_proxy_entrance.service';

type IHealthStatus = 'up' | 'degraded' | 'down';

interface IHealthCheck {
  name: string;
  status: IHealthStatus;
  message?: string;
  latencyMs?: number;
}

/**
 * 自定义展示信息，在监控端的服务详情页以卡片形式呈现。
 * 监控端会做清洗：label 必填且最长 40 字，value 只接受
 * string / number / boolean / null（对象或数组会导致整条被丢弃），
 * unit 最长 12 字，hint 最长 200 字，group 最长 20 字，单次最多 50 条。
 */
interface IHealthExtra {
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  hint?: string;
  status?: IHealthStatus;
  group?: string;
}

interface IHealthPayload {
  service: string;
  status: IHealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  checks: IHealthCheck[];
  metrics: Record<string, number>;
  extras: IHealthExtra[];
}

/** 运行状态快照，metrics 与 extras 都由它派生，避免两处各算一遍。 */
interface IRuntimeSnapshot {
  deviceTotal: number;
  deviceOnline: number;
  /** 读取失败时为 null */
  proxyServersRunning: number | null;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
}

/** 服务标识，与 Watch Tower 上登记的名称保持一致即可。 */
const SERVICE_NAME = 'proxy-server';

/**
 * 读取 package.json 中的版本号。
 * 只在模块加载时读一次，避免每次探测都碰磁盘。
 */
const SERVICE_VERSION = (() => {
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
})();

/**
 * 期望处于监听状态的代理端口数量：
 * device_list.json 中的每个设备各占一个，另加 server_local 自身。
 */
const EXPECTED_PROXY_SERVERS = DEVICE_LIST.length + 1;

/**
 * 按契约聚合子项状态。
 */
function aggregateStatus(checks: IHealthCheck[]): IHealthStatus {
  if (checks.some(c => c.status === 'down')) return 'down';
  if (checks.some(c => c.status === 'degraded')) return 'degraded';
  return 'up';
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/**
 * 机器可读的指标，保持英文 key 与纯数字，方便后续做量化处理。
 */
function buildMetrics(snapshot: IRuntimeSnapshot): Record<string, number> {
  return {
    deviceTotal: snapshot.deviceTotal,
    deviceOnline: snapshot.deviceOnline,
    proxyServersRunning: snapshot.proxyServersRunning ?? 0,
    memoryRssMb: snapshot.memoryRssMb,
    memoryHeapUsedMb: snapshot.memoryHeapUsedMb,
  };
}

/**
 * 给人看的展示信息，label 一律用中文，监控端会原样渲染。
 *
 * 这里的 status 仅用于给单条着色，不会抬升为整体故障，
 * 所以「设备全部离线」这类常态在这里标黄即可，不会触发告警。
 */
function buildExtras(snapshot: IRuntimeSnapshot): IHealthExtra[] {
  const extras: IHealthExtra[] = [
    {
      label: '在线代理设备',
      value: snapshot.deviceOnline,
      unit: '台',
      hint: `共配置 ${snapshot.deviceTotal} 台，仅统计 socket.io 已连接的设备`,
      status: snapshot.deviceOnline > 0 ? 'up' : 'degraded',
      group: '代理设备',
    },
    {
      label: '配置设备总数',
      value: snapshot.deviceTotal,
      unit: '台',
      group: '代理设备',
    },
    {
      label: '代理端口监听数',
      value: snapshot.proxyServersRunning,
      unit: '个',
      hint: `预期 ${EXPECTED_PROXY_SERVERS} 个（设备各一个，外加 server_local）`,
      group: '代理端口',
    },
    {
      label: '内存占用',
      value: snapshot.memoryRssMb,
      unit: 'MB',
      hint: '进程 RSS',
      group: '进程信息',
    },
    {
      label: '堆内存已用',
      value: snapshot.memoryHeapUsedMb,
      unit: 'MB',
      group: '进程信息',
    },
    {
      label: 'Node 版本',
      value: process.version,
      group: '进程信息',
    },
    {
      label: '运行环境',
      value: process.env.NODE_ENV || 'unknown',
      group: '进程信息',
    },
  ];
  return extras;
}


@Controller('/')
export class HealthController {
  @Inject()
  ctx: Context;

  @Inject()
  httpProxyEntranceService: HttpProxyEntranceService;

  @App('socketIO')
  socketApp: SocketApplication;


  /**
   * Watch Tower 健康检查端点。
   */
  @Get('/__watch/health')
  async watchHealth(): Promise<IHealthPayload> {
    const snapshot = this.collectSnapshot();
    const checks: IHealthCheck[] = [
      this.checkDatabase(),
      this.checkProxyServers(snapshot.proxyServersRunning),
    ];

    // 探测本身出错也要返回 200，让监控端读 status 字段
    this.ctx.status = 200;

    return {
      service: SERVICE_NAME,
      status: aggregateStatus(checks),
      version: SERVICE_VERSION,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
      metrics: buildMetrics(snapshot),
      extras: buildExtras(snapshot),
    };
  }


  /**
   * SQLite 连通性：执行一次最轻量的查询并记录耗时。
   */
  private checkDatabase(): IHealthCheck {
    const start = Date.now();
    try {
      sqlite.prepare('SELECT 1').get();
      return { name: 'database', status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        name: 'database',
        status: 'down',
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }


  /**
   * 代理端口监听情况。
   * 全部未监听说明代理能力完全不可用，记为 down；
   * 少于预期数量说明部分端口没起来，记为 degraded。
   */
  private checkProxyServers(running: number | null): IHealthCheck {
    if (running === null) {
      return { name: 'proxy_servers', status: 'down', message: '无法读取代理服务状态' };
    }
    if (running === 0) {
      return { name: 'proxy_servers', status: 'down', message: '没有任何代理端口处于监听状态' };
    }
    if (running < EXPECTED_PROXY_SERVERS) {
      return {
        name: 'proxy_servers',
        status: 'degraded',
        message: `${running}/${EXPECTED_PROXY_SERVERS} 个代理端口在监听`,
      };
    }
    return { name: 'proxy_servers', status: 'up', message: `${running} 个代理端口在监听` };
  }


  /**
   * 采集运行状态快照。单项失败不影响整体，取不到就给保底值。
   */
  private collectSnapshot(): IRuntimeSnapshot {
    let deviceOnline = 0;
    try {
      for (const item of DEVICE_LIST) {
        if (this.socketApp.of(`/${item.id}`).sockets.size > 0) deviceOnline++;
      }
    } catch (_) { }

    let proxyServersRunning: number | null = null;
    try {
      proxyServersRunning = this.httpProxyEntranceService.getListeningDeviceIds().length;
    } catch (_) { }

    const memory = process.memoryUsage();
    return {
      deviceTotal: DEVICE_LIST.length,
      deviceOnline,
      proxyServersRunning,
      memoryRssMb: toMb(memory.rss),
      memoryHeapUsedMb: toMb(memory.heapUsed),
    };
  }
}
