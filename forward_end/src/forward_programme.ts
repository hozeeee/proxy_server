import { io } from 'socket.io-client';
import { ForwardHttpController, SOCKET_EVENT_NAME } from './controller';


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


    const controller = new ForwardHttpController();
    controller.useSocketIo(socket);
    // controller.send = (data) => socket.emit(SOCKET_EVENT_NAME, data);
    // socket.on(SOCKET_EVENT_NAME, (data) => {
    //     console.log(SOCKET_EVENT_NAME)
    //     controller.receive(data);
    // });

}


// TODO:debug
start()
