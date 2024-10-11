import { io } from 'socket.io-client';
import { serverPort } from '../config/port_config.json';


export function createConnectSocket() {

  const socket = io(`ws://127.0.0.1:${serverPort}/proxy`);

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

  return socket;
}


