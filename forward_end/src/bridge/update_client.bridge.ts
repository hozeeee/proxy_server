import type { Socket } from 'socket.io-client';
import { Logger } from '../utils/logger';
import { sendRestartOrder, testChild } from '../base/daemon_base';
import { DEF_TRANSFER_TIMEOUT, ITransferData, receiveChunks, sendChunks } from '../base/big_buffer_transfer';
import fs from 'fs-extra';
import { join } from 'path';

const logger = new Logger('[command_use.bridge]');



/**
 * 说明，
 * 用于更新代码，需要配合守护进程使用。
 */



const SOCKET_EVENT_NAME = '__update_client';

type IRespData = { success: boolean, msg: string }
type ISendHeartbeatFn = (fileBuff: Buffer) => Promise<IRespData | null>;
type ISocketCallback = (socketResp: IRespData) => void;


export class UpdateClientBridge {
    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private _socket: Socket | undefined = undefined;
    private _socketCallback: ((...args: any[]) => void) | undefined = undefined;


    /**
     * 服务端调用此方法发送运行代码文件的 Buffer 到终端。
     */
    sendClientCode: ISendHeartbeatFn = () => { console.log('unset sendClientCode function'); return Promise.resolve(null); };


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
        const socketCallback = async (rawData: ITransferData, callback: ISocketCallback) => {
            try {
                receiveChunks(rawData, async (res) => {
                    /**
                     * 回调函数已经获取到所有数据.
                     */
                    if (res.success) {
                        // 文件写入
                        try {
                            const [_, codeFilePath] = process.argv;
                            fs.writeFileSync(codeFilePath, res.data);
                        } catch (err) {
                            callback({ success: false, msg: `写入文件失败: ${err}` });
                            return;
                        }
                        // 用新代码运行测试
                        try {
                            const testSuccess = await testChild({
                                createCommandData: (argv, env) => ({
                                    argv,
                                    // 注意要与 proxy_server/server/src/config/device_list.json 的配置保持一致
                                    env: { ...env, DEVICE_ID: 'update_test' }
                                }),
                            });
                            if (!testSuccess) {
                                callback({ success: testSuccess, msg: `执行测试失败，请检查运行文件是否有效。` });
                                return;
                            }
                        } catch (err) {
                            callback({ success: false, msg: `测试异常结束: ${err}` });
                            return;
                        }
                        // 使用新文件重启子进程
                        callback({ success: true, msg: `成功，准备重启程序...` });
                        sendRestartOrder();
                    }
                    // 超时或异常情况
                    else {
                        callback({ success: false, msg: res.msg });
                    }
                });
            } catch (err: any) { logger.error(`接收客户端运行文件异常: ${err}`); }
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);
        /**
         * 创建"主动调用"的方法。
         * 通常是在服务端调用。
         */
        this.sendClientCode = (fileBuff: Buffer) => {
            return new Promise((resolve) => {
                try {
                    const respListener: ISocketCallback = (socketResp) => {
                        resolve(socketResp);
                    }

                    sendChunks(fileBuff, (transferData) => {
                        this._socket!.emit(SOCKET_EVENT_NAME, transferData, respListener);
                    });
                } catch (err: any) { logger.debug(`发送心跳异常: ${err}`); }
                setTimeout(() => resolve(null), DEF_TRANSFER_TIMEOUT + 10 * 1000);
            });
        }

        /**
         * 记录(用于清理旧数据)
         */
        this._socket = socket;
        this._socketCallback = socketCallback;
    }

    constructor() {

        // // TODO:debug
        // setInterval(() => {
        //     console.log('xxxxxx___1') // 改这里的数值看能不能有效
        // }, 5 * 1000)
    }

}


