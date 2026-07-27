import { startClient } from './base/start_client';
import net from 'net';

/**
 * 开启后，同时尝试 IPv4 和 IPv6 的通道，那个先通用哪个。
 * 对于 node@20 及以上的版本，这个是默认开启的，
 * 但 18 是关的（只按 DNS 返回的第一个地址去连，通常是 IPv6），
 * 导致如果 IPv6 不通，就会卡死。
 */
try {
    net.setDefaultAutoSelectFamily(true);
} catch { }


const SERVER_HOST = process.env.SERVER_HOST;
const SOCKET_PATH = process.env.DEVICE_ID;


if (!SERVER_HOST) throw `SERVER_HOST(${SERVER_HOST}) 不能为空`;
if (!SOCKET_PATH) throw `SOCKET_PATH(${SOCKET_PATH}) 不能为空`;

startClient({
    serverHost: SERVER_HOST,
    socketPath: SOCKET_PATH,
});
