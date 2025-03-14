import { startClient } from './base/start_client';


const SERVER_HOST = process.env.SERVER_HOST;
const SOCKET_PATH = process.env.DEVICE_ID;


if (!SERVER_HOST) throw `SERVER_HOST(${SERVER_HOST}) 不能为空`;
if (!SOCKET_PATH) throw `SOCKET_PATH(${SOCKET_PATH}) 不能为空`;

startClient({
    serverHost: SERVER_HOST,
    socketPath: SOCKET_PATH,
});
