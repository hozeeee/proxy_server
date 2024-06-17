import { io } from 'socket.io-client';
import { ForwardHttpController, } from './forward_http_controller';
import { AxiosRequestController, } from './axios_request_controller';


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


    const httpController = new ForwardHttpController();
    httpController.useSocketIo(socket);

    const axiosController = new AxiosRequestController();
    axiosController.useSocketIo(socket);


}


// TODO:debug
start()
