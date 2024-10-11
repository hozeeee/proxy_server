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

type IErrorMessage = string;
type IRequestFn<T = any, D = any> = (config: AxiosRequestConfig<D>) => Promise<AxiosResponse<T> | IErrorMessage | null>;
type ISocketCallback = (socketResp: ISocketDataToAxios_Res) => void;


export class AxiosRequestBridge {
    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private _socket: Socket | undefined = undefined;
    private _socketCallback: ((...args: any[]) => void) | undefined = undefined;


    /**
     * 发送 axios 配置到代理设备，
     * 返回 Promise ，数据有三种可能: AxiosResponse<T> | IErrorMessage | null  (IErrorMessage = string)
     *   1. 如果是 AxiosResponse ，那就是 axios 正常处理的响应内容。
     *   2. 如果是 IErrorMessage ，那就是错误信息。
     *   3. 如果是 null ，正常不会触发，只是兼容一些边界情况的发生。
     */
    request: IRequestFn = () => Promise.reject('unset request function');


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
        const socketCallback = async (rawData: ISocketDataToAxios_Req, callback: ISocketCallback) => {
            try {
                const { type, config } = rawData;
                if (type !== 'request') return;
                const res = await axios.request(config);
                delete res.request; // 不删除会导致报错(循环引用)
                callback({
                    type: 'response',
                    data: res,
                    success: true,
                    message: '',
                });
            } catch (err: any) {
                callback({
                    type: 'response',
                    data: null,
                    success: false,
                    message: `axios.request 执行异常: ${err?.message || err}`,
                });
            }
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);

        this.request = (config) => {
            return new Promise((resolve) => {
                try {
                    // 避免 axios 的 timeout 参数不生效，这里补一个处理(增加 500ms)
                    if (config.timeout && typeof config.timeout === 'number') setTimeout(resolve.bind(undefined, '请求超时(axios 没触发，手动设置的代码)'), config.timeout + 500);

                    const respListener: ISocketCallback = (socketResp) => {
                        const { type, data, success, message } = socketResp || {};
                        // 通常不会执行到这
                        if (type !== 'response') {
                            resolve(null);
                            return;
                        }
                        if (success) resolve(data);
                        else resolve(message);
                    }
                    const data: ISocketDataToAxios_Req = {
                        type: 'request',
                        config,
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


