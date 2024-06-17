import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Socket } from 'socket.io-client';



/**
 * 说明，
 */



const SOCKET_EVENT_NAME = '__axios_req';

type IRequestFn<T = any, D = any> = (config: AxiosRequestConfig<D>) => Promise<null | AxiosResponse<T>>;
type ISocketCallback = (socketResp: ISocketDataToAxios_Res) => void;


export class AxiosRequestController {

    get socketEventName() {
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

        // 记录
        this.oldSocket = socket;
        this.oldSocketCallback = async (rawData: ISocketDataToAxios_Req, callback: ISocketCallback) => {
            const { type, config } = rawData;
            if (type !== 'request') return;
            const res = await axios.request(config);
            callback({ type: 'response', data: res });
        }

        // 配置
        this.request = (config) => {
            return new Promise((resolve) => {
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
            })
        }
        socket.on(SOCKET_EVENT_NAME, this.oldSocketCallback);
    }

    constructor() { }




}


