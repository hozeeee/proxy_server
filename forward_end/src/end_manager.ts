import { io } from 'socket.io-client';
import { HttpProxyBridge, } from './controller/http_proxy.bridge';
import { AxiosRequestBridge, } from './controller/axios_request.bridge';
import { TigervncForwardBridge, } from './controller/tigervnc_forward.bridge';
import { CommandUseBridge, } from './controller/command_use.bridge';


const SOCKET_PATH = process.env.DEVICE_ID;
const SERVER_HOST = process.env.SERVER_HOST;


function start() {

    const socket = io(`ws://${SERVER_HOST}/${SOCKET_PATH}`, { autoConnect: true });

    socket.on('connect', () => {
        console.log('connect')
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


// TODO:debug
start()
