import axios from 'axios';
import { Agent } from 'https';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Socket } from 'socket.io-client';


const defaultHttpsAgent = new Agent({
    rejectUnauthorized: false, // 这里设置为 false 来忽略 SSL 错误
});


/**
 * 说明，
 * 将脚本当前的局域网内的特定设备的某个端口转发到服务器的特定端口上。
 */



const SOCKET_EVENT_NAME = '__port_forward';

type IErrorMessage = string;
type IRequestFn<T = any, D = any> = (config: AxiosRequestConfig<D>) => Promise<AxiosResponse<T> | IErrorMessage | null>;
type ISocketCallback = (socketResp: ISocketDataToAxios_Res) => void;


export class PortForwardBridge {
    /**
     * 记录之前的 socket 和 on 回调。
     * 当重复调用 useSocketIo 时，需要把旧的删除。
     */
    private _socket: Socket | undefined = undefined;
    private _socketCallback: ((...args: any[]) => void) | undefined = undefined;


    /**
     * 我描述一下本模块的设计思路，请你根据我的注释内容给我生成代码。
     * 
     * 1. 核心功能是将"客户端"其内网的某个端口数据转发到"转发端"的特定端口上，数据会经由"服务端"转发。
     * 2. 这个模块会被几个端调用，包括:
     *   - 客户端，与服务端保持连接，他会将其内网的某个端口的所有内容转发到服务端。
     *   - 服务端，与服务端和转发端保持连接，他只是一个"中转站"，不处理数据，只负责转发数据。
     *   - 转发端，与服务端保持连接，他负责接收来自服务端的数据，并转发到自己的某个端口上。
     * 3. 完整的流程:
     *   1. 
     * 
     * 3. 每个"端"都会创建自己的 socket ，也就是下面 useSocketIo 的参数。
     * 4. 每个"端"在下面都有自己的"专属方法"，在类中定义方法，在 useSocketIo 赋值生成，具体写法可以参考同目录的其他文件。
     * 5. 对于""
     * 
     */


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
        } catch (_) { }

        /**
         * 配置"响应回调"。
         * 内容必须对应所有的主动调用方法。
         * 如果"主动调用方法"在客户端，那处理的逻辑就在服务端发生；反之同理。
         */
        const socketCallback = async (rawData: ISocketDataToPortForward_Req, callback: ISocketCallback) => {
            try {
                const { type, data } = rawData;
                
                // TODO:

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
                    message: `${err}`,
                });
            }
        }
        socket.on(SOCKET_EVENT_NAME, socketCallback);

        /**
         * "客户端"主动调用。
         * 设置转发的内网主机和端口。
         */
        const forwardIntranetPort = (host: string, port: number) => {
            const role = 'source_end';
            // TODO:
        }

        /**
         * "转发端"主动调用。
         * 设置转发到本机的哪个端口。
         */
        const forwardTargetPort = (port: number) => {
            const role = 'forward_end';
            // TODO:
        }


        this.request = (config) => {
            return new Promise((resolve, reject) => {
                // 避免 axios 的 timeout 参数不生效，这里补一个处理(增加 500ms)
                if (config.timeout && typeof config.timeout === 'number') setTimeout(resolve.bind(undefined, '请求超时(axios 没触发，手动设置的代码)'), config.timeout + 500);

                const respListener: ISocketCallback = (socketResp) => {
                    const { type, data, success, message } = socketResp || {};
                    if (type !== 'response') reject(`非预期错误`); // 通常不会执行到这
                    else if (success) resolve(data);
                    else reject(message);
                }
                const data: ISocketDataToAxios_Req = {
                    type: 'request',
                    config,
                }
                this._socket!.emit(SOCKET_EVENT_NAME, data, respListener);
            });
        }

        /**
         * 记录(用于清理旧数据)
         */
        this._socket = socket;
        this._socketCallback = socketCallback;
    }

    constructor() { }




}


