import type { Socket } from 'socket.io-client';
import { Logger } from '../utils/logger';

const logger = new Logger('[command_use.bridge]');



/**
 * 说明，
 * 单个小的指令，或者心跳，可以在这里定义逻辑。
 * 
 * TODO:继续补充功能
 */



const SOCKET_EVENT_NAME = '__command_use';

type IErrorMessage = string;
type ISendHeartbeatFn = () => void;
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
    private sendHeartbeat: ISendHeartbeatFn = () => { console.log('unset sendHeartbeat function') };
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
    heartbeatInterval(interval = 30 * 1000) {
        if (!interval || typeof interval !== 'number') return;
        if (this.heartbeatIntervalTimer) clearInterval(this.heartbeatIntervalTimer);
        this.sendHeartbeat();
        this.heartbeatIntervalTimer = setInterval(() => { this.sendHeartbeat(); }, interval);
    }


    /**
     * 直接使用 socket.io 的实例注入方法。
     */
    useSocketIo(socket: Socket) {
        /**
         * 清空旧的回调。
         */
        try {
            if (this._socket && this._socketCallback) {
                this._socket.off(SOCKET_EVENT_NAME, this._socketCallback);
                this._socket = undefined;
                this._socketCallback = undefined;
            }
        } catch (err) { logger.error(`清空旧数据异常: ${err}`); }

        /**
         * 配置"响应回调"。
         * 通常是在终端接收到指令后触发。
         */
        const socketCallback = async (rawData: ISocketDataToCommandUse_Req, callback: ISocketCallback) => {
            try {
                const { type, ping } = rawData;
                const ackAt = Date.now();
                this.ping = ping || this.ping;
                this.latestHeartbeatAt = ackAt;
                logger.debug(`发送心跳响应: ping(${this.ping})`);
                if (type !== 'heartbeat') return;
                callback({ type: 'heartbeat_ack', });
            } catch (err: any) { logger.error(`接收心跳异常: ${err}`); }
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);
        /**
         * 创建"主动调用"的方法。
         * 通常是在服务端调用。
         */
        this.sendHeartbeat = () => {
            try {
                const sendAt = Date.now();
                const respListener: ISocketCallback = (socketResp) => {
                    const { type, } = socketResp || {};
                    // 通常不会执行到这
                    if (type !== 'heartbeat_ack') return;
                    // 必须是当前服务计算，否则会因为对方时间不准确导致算出异常值
                    const ackAt = Date.now();
                    this.ping = (ackAt - sendAt) / 2;
                    this.latestHeartbeatAt = ackAt;
                    logger.debug(`发送心跳: ping(${this.ping})`);
                }
                const data: ISocketDataToCommandUse_Req = {
                    type: 'heartbeat',
                    ping: this.ping,
                }
                logger.debug(`发送心跳: sendAt(${sendAt})`);
                this._socket!.emit(SOCKET_EVENT_NAME, data, respListener);
            } catch (err: any) { logger.debug(`发送心跳异常: ${err}`); }
        }

        /**
         * 记录(用于清理旧数据)
         */
        this._socket = socket;
        this._socketCallback = socketCallback;
    }

    constructor() { }




}


