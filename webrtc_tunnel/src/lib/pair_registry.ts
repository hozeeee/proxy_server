import { pairKey, resolveRole, type PeerRole } from './protocol';

/**
 * 一个已完成配对的轮次（即已进入「建连阶段」的一对客户端）。
 * 该对象存在 == 双方已配对成功，允许转发 SDP / ICE。
 */
export interface PairSession {
  /** 负责创建 offer 的一方（字典序较小者） */
  initiatorId: string;
  /** 负责创建 answer 的一方 */
  answererId: string;
  /** 自增轮次编号，用于识别并丢弃上一轮的迟到信令 */
  session: number;
  /** 进入建连阶段的时间戳，仅用于状态展示 */
  startedAt: number;
}

/**
 * 配对注册表：管理「谁想连谁」的意向，以及由意向撮合出的配对轮次。
 *
 * 之所以把意向（intent）与轮次（session）分开存放：
 *   - 意向是长期的、跨越对端上下线的（对端离线时保留，上线后自动重新撮合），
 *     这正是「注册阶段可以无限等待对方接入」的实现基础；
 *   - 轮次是短暂的，只在双方都在线且互相确认期间存在，隧道掉线即作废。
 *
 * 本类不涉及任何 WebSocket / 网络逻辑，纯状态机，便于单独推理与测试。
 */
export class PairRegistry {
  /** 配对意向：clientId → 它希望连接的 peerId 集合 */
  private _intents: Map<string, Set<string>> = new Map();

  /** 已配对轮次：pairKey → PairSession */
  private _sessions: Map<string, PairSession> = new Map();

  /** 全局自增轮次计数器 */
  private _sessionSeq = 0;

  /* ========== 配对意向 ========== */

  /** 记录 from 想连接 to 的意向 */
  declareIntent(from: string, to: string): void {
    let targets = this._intents.get(from);
    if (!targets) {
      targets = new Set();
      this._intents.set(from, targets);
    }
    targets.add(to);
  }

  /** 撤销 from 想连接 to 的意向 */
  revokeIntent(from: string, to: string): void {
    const targets = this._intents.get(from);
    if (!targets) return;
    targets.delete(to);
    if (targets.size === 0) this._intents.delete(from);
  }

  /** 双方是否都声明了连接对方的意向（互相确认即配对匹配成功） */
  isMutual(a: string, b: string): boolean {
    return Boolean(this._intents.get(a)?.has(b) && this._intents.get(b)?.has(a));
  }

  /** 列出所有声明了「想连接 targetId」的客户端，用于 targetId 上线时补发邀请 */
  suitorsOf(targetId: string): string[] {
    const suitors: string[] = [];
    for (const [clientId, targets] of this._intents) {
      if (targets.has(targetId)) suitors.push(clientId);
    }
    return suitors;
  }

  /** clientId 声明过的所有配对目标 */
  intentsOf(clientId: string): string[] {
    return Array.from(this._intents.get(clientId) ?? []);
  }

  /* ========== 配对轮次 ========== */

  /** 取双方当前的配对轮次；返回 null 表示尚未配对（仍处于注册/配对阶段） */
  getSession(a: string, b: string): PairSession | null {
    return this._sessions.get(pairKey(a, b)) ?? null;
  }

  /**
   * 开启新一轮配对（进入建连阶段）并分配角色与轮次编号。
   * 已存在轮次时会被替换，编号严格递增，保证旧轮次的迟到信令必然失配。
   */
  openSession(a: string, b: string): PairSession {
    const initiatorId = resolveRole(a, b) === 'initiator' ? a : b;
    const answererId = initiatorId === a ? b : a;
    const session: PairSession = {
      initiatorId,
      answererId,
      session: ++this._sessionSeq,
      startedAt: Date.now(),
    };
    this._sessions.set(pairKey(a, b), session);
    return session;
  }

  /** 作废双方当前的配对轮次，返回被作废的轮次（本就未配对则返回 null） */
  closeSession(a: string, b: string): PairSession | null {
    const key = pairKey(a, b);
    const session = this._sessions.get(key) ?? null;
    this._sessions.delete(key);
    return session;
  }

  /** 列出与 clientId 相关的所有已配对对端 */
  pairedPeersOf(clientId: string): string[] {
    const peers: string[] = [];
    for (const session of this._sessions.values()) {
      if (session.initiatorId === clientId) peers.push(session.answererId);
      else if (session.answererId === clientId) peers.push(session.initiatorId);
    }
    return peers;
  }

  /* ========== 客户端下线清理 ========== */

  /**
   * 客户端下线时的清理：
   *   - 作废其所有配对轮次，并返回需要收到 `unpaired` 通知的对端列表；
   *   - 清除它自己声明的意向（重新上线后会重新声明）；
   *   - **保留**别人对它的意向，这样它再次上线时能被自动重新撮合。
   */
  removeClient(clientId: string): { affectedPeers: string[] } {
    const affectedPeers = this.pairedPeersOf(clientId);
    for (const peerId of affectedPeers) {
      this.closeSession(clientId, peerId);
    }
    this._intents.delete(clientId);
    return { affectedPeers };
  }

  /** 彻底移除某客户端的全部痕迹（含别人对它的意向），用于服务器停止时清场 */
  purgeClient(clientId: string): void {
    this.removeClient(clientId);
    for (const suitor of this.suitorsOf(clientId)) {
      this.revokeIntent(suitor, clientId);
    }
  }

  /* ========== 状态观测 ========== */

  /** 当前已配对的轮次数量 */
  get sessionCount(): number {
    return this._sessions.size;
  }

  /** 当前所有配对轮次快照，用于状态页展示 */
  snapshot(): PairSession[] {
    return Array.from(this._sessions.values());
  }

  /** 清空全部状态 */
  clear(): void {
    this._intents.clear();
    this._sessions.clear();
  }
}

export type { PeerRole };
