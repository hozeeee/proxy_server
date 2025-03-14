
import { fork } from 'child_process';


/**
 * 其他脚本可以随意复制此文件来用。
 * 
 * 使用说明: (假设执行文件是 app.ts)
 *   1. 脚本先定义好一个 main 函数，里面包含对参数的读取，但不能立即启动。
 *   2. 在执行文件中，引入此文件的 startDaemon 方法。
 *   3. 在执行文件中，运行 startDaemon(main) 即可。
 *   4. 是否重启子进程由 main 决定，通过使用此文件的 sendRestartOrder 方法实现。
 */



const RESTART_ORDER = 'restart';
const RUN_CHILD_ENV_KEY = '__RUN_CHILD';



/**
 * 检查参数中是否包含启动守护进程的参数。
 */
function isStartChild() {
    try {
        return !!process.env[RUN_CHILD_ENV_KEY];
    } catch (_) { }
    return false;
}


/**
 * 启动守护进程。
 */
function startChild(childMainFunc: IChildMainFunc) {

    /**
     * 参数透传 & 加上启动服务的标记。
     */
    const CURRENT_FILENAME = process.argv[1];
    const args = Array.from(process.argv);
    args.shift();
    args.shift();
    const child = fork(CURRENT_FILENAME, [...args], { env: { ...process.env, [RUN_CHILD_ENV_KEY]: '1' } });

    /**
     * 接收重启指令。
     * 先杀死当前子进程 & 重启子进程。
     */
    child.on('message', (message) => {
        if (message === RESTART_ORDER) {
            child.kill();
            startDaemon(childMainFunc);
        }
    });

    /**
     * 子进程的标准输出 & 错误输出。
     */
    child.stdout?.on('data', (data) => {
        // console.log(`子进程输出: ${data}`);
    });
    child.stderr?.on('data', (data) => {
        // console.error(`子进程错误输出: ${data}`);
    });

    /**
     * 子进程异常退出。
     */
    child.on('exit', (code) => {
        // // 如果子进程非正常退出，选择是否重启
        // if (code !== 0) {
        //     console.log('子进程异常退出，正在重启...');
        //     startChildProcess();
        // }
    });

}


/**
 * 执行文件使用。
 * 传入目标方法，根据参数判断是启动守护进程还是启动主进程。
 */
export function startDaemon(childMainFunc: IChildMainFunc) {
    if (isStartChild()) childMainFunc();
    else startChild(childMainFunc);
}
type IChildMainFunc = () => void;



/**
 * 子进程使用。
 * 通知父进程重启服务。
 * 父进程使用 fork 来启动子进程。
 */
export function sendRestartOrder() {
    process.send?.(RESTART_ORDER);
    process.exit(1);
}





const TEST_SEND_ORDER = 'healthy';
export const TEST_CHILD_ENV_KEY = '__TEST_CHILD';
/**
 * 测试子进程。
 * 
 * 使用方法:
 *   子进程必须手动调用 sendTestSuccessOrder 方法来发送指令。
 *   判断是否是测试，有两种方案:
 *     - 这里启动会注入变量 TEST_CHILD_ENV_KEY ，可以用它来判断。
 *     - 直接无脑调用 sendTestSuccessOrder 方法，非测试场景多发送也不影响。
 */
export async function testChild(params: ITestChildParams): Promise<boolean> {
    const timeout = (typeof params.timeout !== 'number' || params.timeout <= 0) ? 10 * 1000 : params.timeout;
    try {
        const { createCommandData } = params;
        const { argv, env } = createCommandData(process.argv, {
            ...process.env,
            [RUN_CHILD_ENV_KEY]: '1',
            [TEST_CHILD_ENV_KEY]: '1',
        });
        const CURRENT_FILENAME = argv[1];
        const args = Array.from(argv);
        args.shift();
        args.shift();
        const child = fork(CURRENT_FILENAME, [...args], { env });
        const success = await new Promise<boolean>((resolve) => {
            // 等待指令
            child.on('message', (message) => {
                if (message === TEST_SEND_ORDER) {
                    child.kill();
                    resolve(true);
                }
            });
            // 超时处理
            setTimeout(() => {
                child.kill();
                resolve(false);
            }, timeout);
        });
        return success;
    } catch (_) { }
    console.error('testChild 非预期错误')
    return false;
}
interface ITestChildParams {
    /**
     * 定义命令的生成。
     * 不使用当前命令是因为，如启动服务这种，需要改动端口号再启动，不能占用当前端口。
     */
    createCommandData: (argv: typeof process.argv, env: typeof process.env) => { argv: typeof process.argv, env: typeof process.env };
    // 超时时间，超时判定为失败，单位 ms
    timeout?: number;
}

/**
 * 子进程使用。
 * 回复父进程测试成功。
 */
export function sendTestSuccessOrder() {
    process.send?.(TEST_SEND_ORDER);
    // process.exit(1);
}

