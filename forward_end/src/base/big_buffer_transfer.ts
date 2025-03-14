

type ITransferStartData = {
    type: 'start';
    // 这轮发送的唯一标识
    uuid: string;
    // 发送包的总数量
    total: number;
    // 超过传输时间视为失败。
    timeout: number;
}
type ITransferContentData = {
    type: 'content';
    uuid: string;
    index: number;
    chunk: Buffer;
}
export type ITransferData = ITransferStartData | ITransferContentData

type IReceiveChunksOnEnd = (res: { success: false, msg: string } | { success: true, data: Buffer }) => void;
type ISendChunksOnSend = (transferData: ITransferData) => void;


const CHUNK_SIZE = 1024 * 1024; // 每个块1MB
const TRANSFER_INTERVAL = 500; // 发送数据的间隔
export const DEF_TRANSFER_TIMEOUT = 30 * 1000;

// key 是写入时的时间戳
const transferDataMap: Map<string, ITransferStartData & {
    createAt: number;
    chunks: Buffer[];
    onEnd: IReceiveChunksOnEnd;
}> = new Map();


/**
 * 发送数据的方法。
 */
export async function sendChunks(buff: Buffer, onSend: ISendChunksOnSend, timeout?: number) {
    const chunkTotal = Math.ceil(buff.length / CHUNK_SIZE);
    // 数据切割
    const chunks: Buffer[] = [];
    for (let idx = 0; idx < chunkTotal; idx++) {
        const chunk = buff.subarray(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
        chunks.push(chunk);
    }
    // 封装一层，避免报错导致错误抛到外层
    const _onSend: typeof onSend = (...args) => {
        try { onSend(...args); } catch (_) { }
    }
    // 发送开始标识
    if (typeof timeout !== 'number' || timeout <= 0) timeout = DEF_TRANSFER_TIMEOUT;
    const uuid = `${Date.now()}__${Math.random()}`;
    _onSend({ type: 'start', uuid, total: chunkTotal, timeout, });
    // 分批发送数据
    await new Promise((resolve) => setTimeout(resolve, TRANSFER_INTERVAL));
    for (let index = 0; index < chunkTotal; index++) {
        const chunk = chunks[index];
        _onSend({ type: 'content', uuid, index, chunk, });
    }
}


/**
 * 接收数据的方法。
 */
export function receiveChunks(rawData: ITransferData, onEnd: IReceiveChunksOnEnd) {
    try {
        const { type, uuid } = rawData;
        switch (type) {
            case 'start': {
                const { total } = rawData;
                const createAt = Date.now();
                transferDataMap.set(uuid, {
                    ...rawData,
                    createAt,
                    chunks: Array(total).fill(null),
                    onEnd,
                });
                // 超时清理数据
                let { timeout, } = rawData;
                if (typeof timeout !== 'number' || timeout <= 0) timeout = DEF_TRANSFER_TIMEOUT;
                setTimeout(() => transferDataMap.delete(uuid), timeout);
                break;
            }
            case 'content': {
                const { chunk, index } = rawData;
                // 可能超时了被清理掉
                const transferData = transferDataMap.get(uuid);
                if (!transferData) return;
                // 数据存放
                const { chunks, total, onEnd } = transferData;
                chunks[index] = chunk;
                // 满了执行回调
                if (chunks.filter(i => i).length === total) {
                    const data = Buffer.concat(chunks);
                    try {
                        onEnd({ success: true, data });
                    } catch (__) { }
                    transferDataMap.delete(uuid);
                }
            }
        }
    } catch (_) { }
}


