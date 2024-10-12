import dayjs from 'dayjs';


export class Logger {
  private prefix: string;
  private dateFormat?: string;
  private timeMap: Map<string, number> = new Map();
  private get isDebug() {
    return process.env.NODE_ENV === 'local'
      || !!process.env.OPEN_DEBUG;
  }

  constructor(_prefix: string, _dateFormat?: string) {
    this.prefix = _prefix;
    this.dateFormat = _dateFormat;
  }

  private getTimeText() {
    if (!this.dateFormat) return '';
    return `[${dayjs().format(this.dateFormat)}] `;
  }

  debug(msg: string) {
    if (!this.isDebug) return;
    console.log(`${this.getTimeText()}${this.prefix} ${msg}`);
  }

  info(msg: string) {
    console.log(`${this.getTimeText()}${this.prefix} ${msg}`);
  }
  log(msg: string) {
    console.log(`${this.getTimeText()}${this.prefix} ${msg}`);
  }

  error(msg: string) {
    console.log(`${this.getTimeText()}${this.prefix} ${msg}`);
  }

  /**
   * 同样是输出日志。
   * 但可以增加时间的记录。
   */
  time(flag: string, msg: string) {
    if (!this.isDebug) return;
    const now = Date.now();
    const preTime = this.timeMap.get(flag);
    let deltaTime = 0;
    if (preTime) deltaTime = now - preTime;
    this.timeMap.set(flag, now);
    if (deltaTime) msg = `${msg} (${flag}|${deltaTime}ms)`;
    this.debug(msg);
  }
  timeEnd(flag: string, msg: string) {
    if (!this.isDebug) return;
    this.time(flag, msg);
    this.timeMap.delete(flag);
  }

}

