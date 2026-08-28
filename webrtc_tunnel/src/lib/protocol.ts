/**
 * 信令协议定义（服务端 / 客户端共用）
 *
 * 整个连接过程被拆成两个 **严格有序** 的阶段，服务端是唯一的阶段推进者：
 *
 * ┌─ 阶段一 · 注册与配对 ───────────────────────────────────────────────┐
 * │  register     客户端声明自身 id                                      │
 * │  registered   注册成功，此后才允许发送任何其它消息                     │
 * │  pair         声明「我想和 peerId 建立隧道」的配对意向                 │
 * │  pair_waiting 对端尚未就绪（未上线 / 未确认），无限等待，不设超时        │
 * │  pair_invite  服务端向对端征求确认（对端 SDK 自动或按钩子确认）          │
 * │  paired       双方均在线且互相确认 → 配对成功，服务端下发角色与轮次      │
 * └────────────────────────────────────────────────────────────────────┘
 * ┌─ 阶段二 · 建连（仅在收到 paired 之后允许）──────────────────────────┐
 * │  offer / answer / candidate   服务端原样转发，不解析内容               │
 * │  unpair / unpaired            本轮配对作废，退回阶段一重新配对         │
 * └────────────────────────────────────────────────────────────────────┘
 * ┌─ 旁路 · 观测（贯穿两个阶段，随时可发）───────────────────────────────┐
 * │  status       客户端上报自身所处的建连阶段，服务端只记录不参与推进      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * 两个关键约束由服务端强制执行，客户端无需自行防御：
 *
 *   1. 未注册的连接除 `register` 外的消息全部拒绝；
 *   2. 未进入阶段二（未 `paired`）的 SDP / ICE 消息全部拒绝转发，
 *      从协议层面保证「配对成功前双方都不会开始 WebRTC 信息交换」。
 *
 * 此外每次进入阶段二时服务端会分配一个自增的 **轮次编号** `session`，
 * 双方后续所有 SDP / ICE 消息都必须携带它。轮次不匹配的消息会被丢弃，
 * 从而避免重连后上一轮的迟到 candidate 污染新的 PeerConnection。
 *
 * 连接存活性由 WebSocket 层的 ping / pong 保证（双向）：任何一端在
 * `SIGNALING_IDLE_TIMEOUT` 内收不到对端的任何帧，就判定该连接已死并强制关闭。
 * 这条规则不可省略 —— 配对等待期两端都不发业务消息，静默的 TCP 连接一旦被
 * NAT / 防火墙回收就会变成「半开」死连接，双方都无法察觉（服务端会把它当成
 * 在线客户端继续撮合，对端则永远等不到 paired）。
 */

/** 协议版本：服务端与客户端必须一致，否则拒绝注册（避免新旧混用时诡异卡死） */
export const PROTOCOL_VERSION = 3;

/** 信令通道 ping 间隔 (ms)：两端都按此周期主动探测对方是否还活着 */
export const SIGNALING_PING_INTERVAL = 20000;

/** 信令通道静默超时 (ms)：超过该时长未收到对端任何帧即判定连接已死 */
export const SIGNALING_IDLE_TIMEOUT = 60000;

/**
 * 建连阶段的角色，由服务端在配对成功时分配（字典序较小的一方为 initiator）。
 * 由服务端统一指派可彻底消除双方同时创建 offer 的 glare 问题。
 */
export type PeerRole = 'initiator' | 'answerer';

/** 配对等待原因 */
export type PairWaitingReason =
  /** 对端还没有连上信令服务器 */
  | 'peer_offline'
  /** 对端在线，但尚未确认配对意向 */
  | 'awaiting_peer';

/**
 * 客户端上报的建连阶段标识（`status` 消息）。
 *
 * 上报是**单向、纯观测**的：服务端只记录与展示，不参与任何状态机推进，
 * 丢失或缺失都不影响连接。目的是在服务端一处就能看清双方各自卡在哪一步 ——
 * 排查时不必再去两台机器上对着各自的终端日志猜时间线。
 */
export type ClientStage =
  /** 阶段一：已在信令服务器注册 */
  | 'registered'
  /** 阶段一：已向对端声明配对意向 */
  | 'pair_declared'
  /** 阶段一：对端尚未就绪，正在等待（无限等待） */
  | 'pair_waiting'
  /** 阶段一：已确认对端发来的配对邀请 */
  | 'pair_confirmed'
  /** 阶段二：配对成功，开始交换 WebRTC 信令 */
  | 'paired'
  /** 阶段二：已发出本地 offer */
  | 'offer_sent'
  /** 阶段二：已收到对端 offer */
  | 'offer_received'
  /** 阶段二：已发出本地 answer */
  | 'answer_sent'
  /** 阶段二：已收到对端 answer */
  | 'answer_received'
  /** 阶段二：本地 ICE 候选收集状态变化 */
  | 'ice_gathering'
  /** 阶段二：PeerConnection 连接状态变化（connecting / connected / failed ...） */
  | 'pc_state'
  /** 隧道已建立 */
  | 'tunnel_open'
  /** 隧道已断开 */
  | 'tunnel_closed'
  /** 阶段二失败（超时 / DataChannel 错误） */
  | 'handshake_failed'
  /** 配对被解除 */
  | 'unpaired'
  /** 正在重新配对 */
  | 'repairing';

/** 阶段标识的中文说明，服务端日志与状态页共用一份口径 */
export const STAGE_LABELS: Record<ClientStage, string> = {
  registered: '已注册',
  pair_declared: '已声明配对意向',
  pair_waiting: '等待对端配对',
  pair_confirmed: '已确认配对邀请',
  paired: '配对成功',
  offer_sent: '已发出 offer',
  offer_received: '已收到 offer',
  answer_sent: '已发出 answer',
  answer_received: '已收到 answer',
  ice_gathering: 'ICE 候选收集',
  pc_state: 'PeerConnection 状态',
  tunnel_open: '隧道已建立',
  tunnel_closed: '隧道已断开',
  handshake_failed: '建连失败',
  unpaired: '配对已解除',
  repairing: '正在重新配对',
};

/** 配对解除原因 */
export type UnpairReason =
  /** 对端与信令服务器断开 */
  | 'peer_disconnected'
  /** 对端主动放弃本次配对 */
  | 'peer_unpaired'
  /** 对端检测到隧道掉线，正在重新配对 */
  | 'peer_repairing';

/* ==================== 客户端 → 服务端 ==================== */

export type ClientToServerMessage =
  /** 阶段一：注册。`peerId` 可选，等价于注册成功后立即发送一条 pair */
  | { type: 'register'; id: string; protocol?: number; peerId?: string }
  /** 阶段一：声明配对意向。已配对时为幂等操作，服务端会重发当前 paired */
  | { type: 'pair'; peerId: string }
  /**
   * 作废当前配对轮次。
   * `retain: true`  → 保留配对意向，等待重新匹配（隧道掉线重连场景）
   * `retain: false` → 同时撤销配对意向（不再想连接该对端）
   */
  | { type: 'unpair'; peerId: string; retain?: boolean }
  /** 阶段二：SDP Offer，仅允许 initiator 发送 */
  | { type: 'offer'; peerId: string; session: number; sdp: string }
  /** 阶段二：SDP Answer，仅允许 answerer 发送 */
  | { type: 'answer'; peerId: string; session: number; sdp: string }
  /** 阶段二：ICE Candidate，双向并发 */
  | { type: 'candidate'; peerId: string; session: number; candidate: string; mid: string }
  /**
   * 旁路：上报自身所处的建连阶段，供服务端集中排查。
   * 服务端不会因此改变任何状态，也不会回复。
   */
  | {
      type: 'status';
      stage: ClientStage;
      /** 该阶段针对哪个对端，与对端无关的阶段（如 registered）可省略 */
      peerId?: string;
      /** 所处配对轮次，未配对时省略 */
      session?: number;
      /** 补充说明，如角色、错误原因、状态值 */
      detail?: string;
    };

/* ==================== 服务端 → 客户端 ==================== */

export type ServerToClientMessage =
  | { type: 'registered'; id: string; protocol: number }
  | { type: 'register_failed'; reason: string }
  | { type: 'pair_invite'; peerId: string }
  | { type: 'pair_waiting'; peerId: string; reason: PairWaitingReason }
  | { type: 'paired'; peerId: string; role: PeerRole; session: number }
  | { type: 'unpaired'; peerId: string; reason: UnpairReason }
  | { type: 'offer'; peerId: string; session: number; sdp: string }
  | { type: 'answer'; peerId: string; session: number; sdp: string }
  | { type: 'candidate'; peerId: string; session: number; candidate: string; mid: string }
  | { type: 'error'; reason: string };

/** 阶段二的信令消息类型：这些消息要求配对已完成，且必须携带正确的轮次编号 */
export const HANDSHAKE_MESSAGE_TYPES = ['offer', 'answer', 'candidate'] as const;

export type HandshakeMessageType = (typeof HANDSHAKE_MESSAGE_TYPES)[number];

/** 判断消息是否属于阶段二（需要配对前置条件） */
export function isHandshakeMessage(type: string): type is HandshakeMessageType {
  return (HANDSHAKE_MESSAGE_TYPES as readonly string[]).includes(type);
}

/**
 * 解析收到的 JSON 文本为信令消息。
 * 非法 JSON 或缺少 `type` 字段时返回 null，由调用方丢弃。
 */
export function parseMessage<T extends { type: string }>(raw: string): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof (parsed as { type?: unknown }).type !== 'string') return null;
  return parsed as T;
}

/**
 * 为一对客户端生成顺序无关的唯一键（配对是无向关系）。
 * 使用 \u0000 作为分隔符，避免 id 中含分隔符导致的键冲突。
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * 角色分配规则：字典序较小的一方为 initiator。
 * 纯函数且双方一致，服务端重启后也能得到相同结果。
 */
export function resolveRole(selfId: string, peerId: string): PeerRole {
  return selfId < peerId ? 'initiator' : 'answerer';
}
