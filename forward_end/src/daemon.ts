import { startClient } from './base/start_client';
import { sendTestSuccessOrder, startDaemon, TEST_CHILD_ENV_KEY } from './base/daemon_base';
import { UpdateClientBridge } from './bridge/update_client.bridge';


const SERVER_HOST = process.env.SERVER_HOST;
const SOCKET_PATH = process.env.DEVICE_ID;


if (!SERVER_HOST) throw `SERVER_HOST(${SERVER_HOST}) 不能为空`;
if (!SOCKET_PATH) throw `SOCKET_PATH(${SOCKET_PATH}) 不能为空`;

startDaemon(
    () => startClient({
        serverHost: SERVER_HOST,
        socketPath: SOCKET_PATH,
        onInit: (socket) => {
            // 注入指令事件
            const commandUseBridge = new UpdateClientBridge();
            commandUseBridge.useSocketIo(socket);
        },
        onConnect: () => {
            // console.log('TEST_CHILD_ENV_KEY: ', process.env[TEST_CHILD_ENV_KEY]) // TODO:debug
            // 当判定是测试的子进程，就发送成功启动的指令
            if (process.env[TEST_CHILD_ENV_KEY]) sendTestSuccessOrder();
        }
    })
);

