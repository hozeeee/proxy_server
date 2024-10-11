import type { Socket } from 'socket.io-client';



/**
 * 说明，
 * 单个小的指令，或者心跳，可以在这里定义逻辑。
 * TODO:
 */



const SOCKET_EVENT_NAME = '__command_use';

type IErrorMessage = string;
type ISendHeartbeatFn = () => Promise<true | string | null>;
type ISocketCallback = (socketResp: ISocketDataToCommandUse_Res) => void;


export class CommandUseBridge {
    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private _socket: Socket | undefined = undefined;
    private _socketCallback: ((...args: any[]) => void) | undefined = undefined;


    /**
     * 发送单次心跳。
     * 此方法需要在 useSocketIo 生成，但下面的 *Interval 不需要，因为是循环调用此方法。
     */
    sendHeartbeat: ISendHeartbeatFn = () => Promise.reject('unset request function');
    private _ping = 0;
    private _latestHeartbeatAt = 0;
    private set ping(val) { this._ping = val }
    private set latestHeartbeatAt(val) { this._latestHeartbeatAt = val }
    // 外部能够访问
    get ping() { return this._ping }
    get latestHeartbeatAt() { return this._latestHeartbeatAt }
    /**
     * 循环发送心跳。
     */
    private heartbeatIntervalTimer: NodeJS.Timeout | undefined;
    heartbeatInterval(interval = 60 * 1000) {
        if (!interval || typeof interval! == 'number') return;
        if (this.heartbeatIntervalTimer) clearInterval(this.heartbeatIntervalTimer);
        this.sendHeartbeat();
        this.heartbeatIntervalTimer = setInterval(() => { this.sendHeartbeat(); }, interval);
    }


    /**
     * 直接使用 socket.io 的实例注入方法。
     */
    useSocketIo(socket: Socket) {
        // 清空旧的回调
        try {
            if (this._socket && this._socketCallback) {
                this._socket.off(SOCKET_EVENT_NAME, this._socketCallback);
                this._socket = undefined;
                this._socketCallback = undefined;
            }
        } catch (_) { }
        // 配置
        const socketCallback = async (rawData: ISocketDataToCommandUse_Req, callback: ISocketCallback) => {
            try {
                const { type, sendAt } = rawData;
                const ackAt = Date.now();
                this.ping = ackAt - sendAt;
                this.latestHeartbeatAt = ackAt;
                if (type !== 'heartbeat') return;
                callback({
                    type: 'heartbeat_ack',
                    ackAt,
                });
            } catch (err: any) { }
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);

        this.sendHeartbeat = () => {
            return new Promise((resolve) => {
                try {
                    const sendAt = Date.now();
                    const respListener: ISocketCallback = (socketResp) => {
                        const { type, ackAt } = socketResp || {};
                        // 通常不会执行到这
                        if (type !== 'heartbeat_ack') {
                            resolve(null);
                            return;
                        }
                        this.ping = (ackAt - sendAt) / 2;
                        this.latestHeartbeatAt = ackAt;
                        resolve(true);
                    }
                    const data: ISocketDataToCommandUse_Req = {
                        type: 'heartbeat',
                        sendAt,
                    }
                    socket.emit(SOCKET_EVENT_NAME, data, respListener);
                } catch (err: any) {
                    resolve(`${err?.message ?? err}`);
                }
            });
        }

        // 记录(用于清理)
        this._socket = socket;
        this._socketCallback = socketCallback;
    }

    constructor() { }




}


