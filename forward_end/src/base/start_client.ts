

import { io, Socket } from 'socket.io-client';
import { HttpProxyBridge, } from '../bridge/http_proxy.bridge';
import { AxiosRequestBridge, } from '../bridge/axios_request.bridge';
import { TigervncForwardBridge, } from '../bridge/tigervnc_forward.bridge';
import { CommandUseBridge, } from '../bridge/command_use.bridge';


interface IStartClientParams {
    // 如 "127.0.0.1:8000"
    serverHost: string;
    // 对接 socket.io 的路径
    socketPath: string;
    /**
     * socket.io 的事件监听。
     */
    onInit?: (socket: Socket) => void;
    onConnect?: (socket: Socket) => void;
}
export function startClient(params: IStartClientParams) {
    const {
        serverHost,
        socketPath,
        onInit,
        onConnect,
    } = params;

    const socket = io(`ws://${serverHost}/${socketPath}`, { autoConnect: true });
    onInit?.(socket);

    socket.on('connect', () => {
        console.log('connect')
        onConnect?.(socket);
    });
    // 未创建通道就已经断开 socket ，需要重新执行
    socket.on('disconnect', () => {
        console.log('disconnect')
    });
    socket.on('connect_error', () => {
        console.log('connect_error')
    });


    const httpController = new HttpProxyBridge();
    httpController.useSocketIo(socket);

    const axiosController = new AxiosRequestBridge();
    axiosController.useSocketIo(socket);

    const tigervncController = new TigervncForwardBridge();
    tigervncController.useSocketIo(socket);

    const commandUseBridge = new CommandUseBridge();
    commandUseBridge.useSocketIo(socket);

}

