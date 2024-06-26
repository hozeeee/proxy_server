import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Socket } from 'socket.io-client';



/**
 * 说明，
 * 接受来自对端的 axios.request 配置，
 * 在此处发起请求，
 * 再将数据返回给对端。
 */



const SOCKET_EVENT_NAME = '__axios_req';

type IRequestFn<T = any, D = any> = (config: AxiosRequestConfig<D>) => Promise<null | AxiosResponse<T>>;
type ISocketCallback = (socketResp: ISocketDataToAxios_Res) => void;


export class AxiosRequestController {

    static get socketEventName() {
        return SOCKET_EVENT_NAME;
    }

    request: IRequestFn = () => Promise.reject('unset request function');


    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private oldSocket: Socket | undefined = undefined;
    private oldSocketCallback: ((...args: any[]) => void) | undefined = undefined;

    /**
     * 直接使用 socket.io 的实例注入方法。
     */
    useSocketIo(socket: Socket) {
        // 清空旧的回调
        try {
            if (this.oldSocket && this.oldSocketCallback) {
                this.oldSocket.off(SOCKET_EVENT_NAME, this.oldSocketCallback);
                this.oldSocket = undefined;
                this.oldSocketCallback = undefined;
            }
        } catch (_) { }

        // 记录(用于清理)
        this.oldSocket = socket;
        this.oldSocketCallback = async (rawData: ISocketDataToAxios_Req, callback: ISocketCallback) => {
            try {
                const { type, config } = rawData;
                if (type !== 'request') return;
                const res = await axios.request(config);
                delete res.request; // 不删除会导致报错(循环引用)
                callback({
                    type: 'response',
                    data: res
                });
            } catch (_) { }
        }

        // 配置
        this.request = (config) => {
            return new Promise((resolve) => {
                try {
                    // TODO: timeout
                    const respListener: ISocketCallback = (socketResp) => {
                        try {
                            const { type, data } = socketResp;
                            if (type !== 'response') {
                                resolve(null);
                                return;
                            }
                            resolve(data);
                        } catch (_) {
                            resolve(null);
                        }
                    }
                    const data: ISocketDataToAxios_Req = {
                        type: 'request',
                        config,
                    }
                    socket.emit(SOCKET_EVENT_NAME, data, respListener);

                } catch (err: any) {
                    console.log(err?.message ?? err);
                    resolve(null);
                }
            });
        }
        socket.on(SOCKET_EVENT_NAME, this.oldSocketCallback);
    }

    constructor() { }




}


