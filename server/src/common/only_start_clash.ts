import { startClash } from './clash_controller';

/**
 * 由于目前没有解决 clash 在容器运行的问题。
 * 暂时先用这个脚本代替。
 * 直接在机器上运行 clash 内核。
 */


// 避免本地调试时也运行
if (process.env.NODE_ENV !== 'local') startClash();

