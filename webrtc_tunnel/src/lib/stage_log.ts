import { STAGE_LABELS, type ClientStage } from './protocol';

/** 一条已落库的阶段上报记录 */
export interface StageEvent {
  /** 上报方 */
  clientId: string;
  /** 该阶段针对的对端，与对端无关时为 null */
  peerId: string | null;
  stage: ClientStage;
  /** 所处配对轮次，未配对时为 null */
  session: number | null;
  detail: string | null;
  /** 服务端收到的时间戳（不采信客户端时钟，避免两台机器时钟不同步导致时间线错乱） */
  at: number;
}

/** 新增记录时的入参，时间戳由本类填充 */
export type StageReport = Omit<StageEvent, 'at'>;

/** 全局保留的上报条数上限 */
const DEFAULT_CAPACITY = 500;

/**
 * 客户端阶段上报的服务端存档。
 *
 * 用环形缓冲（超出容量即丢弃最旧记录）而非无界数组，保证长期运行时内存有上界；
 * 排查连接问题只需要最近一段时间的时间线，历史越久价值越低。
 *
 * 记录**不随客户端断开而清除** —— 客户端掉线后的最后几条上报往往正是关键线索。
 *
 * 与 PairRegistry 一样是纯状态容器，不涉及任何网络逻辑。
 */
export class StageLog {
  private _capacity: number;

  /** 按时间顺序排列的全部上报（旧 → 新） */
  private _events: StageEvent[] = [];

  /** 每个客户端的最新一条上报：clientId → StageEvent */
  private _latest: Map<string, StageEvent> = new Map();

  constructor(opts: { capacity?: number } = {}) {
    this._capacity = opts.capacity ?? DEFAULT_CAPACITY;
  }

  /** 记录一条上报，返回补齐时间戳后的完整记录 */
  record(report: StageReport): StageEvent {
    const event: StageEvent = { ...report, at: Date.now() };
    this._events.push(event);
    if (this._events.length > this._capacity) {
      this._events.splice(0, this._events.length - this._capacity);
    }
    this._latest.set(event.clientId, event);
    return event;
  }

  /** 最近 limit 条上报（新 → 旧） */
  recent(limit = 50): StageEvent[] {
    return this._events.slice(-limit).reverse();
  }

  /** 某客户端最近 limit 条上报（新 → 旧） */
  recentOf(clientId: string, limit = 20): StageEvent[] {
    const result: StageEvent[] = [];
    for (let i = this._events.length - 1; i >= 0 && result.length < limit; i--) {
      if (this._events[i].clientId === clientId) result.push(this._events[i]);
    }
    return result;
  }

  /** 某客户端当前所处阶段（最后一条上报），无上报则为 null */
  latestOf(clientId: string): StageEvent | null {
    return this._latest.get(clientId) ?? null;
  }

  /** 已产生过上报的客户端 id 列表 */
  get reporterIds(): string[] {
    return Array.from(this._latest.keys());
  }

  get size(): number {
    return this._events.length;
  }

  clear(): void {
    this._events.length = 0;
    this._latest.clear();
  }
}

/** 把一条上报格式化为单行中文日志，服务端控制台与状态页共用 */
export function formatStageEvent(event: StageEvent): string {
  const target = event.peerId ? ` → "${event.peerId}"` : '';
  const round = event.session ? ` 轮次 #${event.session}` : '';
  const detail = event.detail ? `: ${event.detail}` : '';
  return `${event.clientId}${target}  ${STAGE_LABELS[event.stage] ?? event.stage}${round}${detail}`;
}
