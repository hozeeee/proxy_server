import { App, } from '@midwayjs/decorator';
import { Middleware, IMiddleware, NextFunction, } from '@midwayjs/core';
import { Context, Application } from 'egg';
import { addDomain, writeChiiConfigForTargetJs, writeChiiInjectionHtml } from '../service/chii_manager.service';



@Middleware()
export class GetDomainMiddleware implements IMiddleware<Context, NextFunction> {
  @App()
  app: Application;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const host = ctx.request.headers.host; // 192.168.3.107:8600
      // console.log('host: ', host);
      const successAdd = addDomain(host);
      if (successAdd) {
        writeChiiConfigForTargetJs();
        writeChiiInjectionHtml();
      }

      const nextResult = await next();
      return nextResult;
    };
  }

  // 这里的静态 getName 方法，用来指定中间件的名字，方便排查问题。
  static getName(): string {
    return 'GetDomainMiddleware';
  }
}
