import { App, } from '@midwayjs/decorator';
import { Middleware, IMiddleware, NextFunction, } from '@midwayjs/core';
import { Context, Application } from 'egg';
import http from 'http';
import https from 'https';
import { URL } from 'url';


@Middleware()
export class ProxyMiddleware implements IMiddleware<Context, NextFunction> {
  @App()
  app: Application;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {


      const { req, res } = ctx;
      console.log('===', req, res)


      let option = new URL(req.url) as any;
      console.log('option: ', option)
      option.headers = req.headers;

      if (option.hostname === 'ipv6.fhz920p.seeseeyou.cn') option = {
        protocol: 'http:',
        slashes: true,
        auth: null,
        host: 'www.baidu.com',
        port: '80',
        hostname: 'www.baidu.com',
        hash: null,
        search: null,
        query: null,
        // pathname: '/favicon.ico',
        // path: '/favicon.ico',
        href: `http://www.baidu.com/`
      }

      const proxyRequest = http.request(option, (proxyResponse) => {


        proxyResponse.on("data", (chunk) => {
          console.log("proxyResponse length", chunk.length);
          res.write(chunk, 'binary')
        });
        proxyResponse.on("end", () => {
          console.log("proxyed request ended");
          res.end();
        })

        res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
      });


      req.on("data", (chunk) => {
        console.log("in request length:", chunk.length);
        proxyRequest.write(chunk, "binary");
      })

      req.on("end", () => {
        console.log("original request ended");
        proxyRequest.end();
      })



      const nextResult = await next();
      return nextResult;
    };
  }

  // 这里的静态 getName 方法，用来指定中间件的名字，方便排查问题。
  static getName(): string {
    return 'ProxyMiddleware';
  }
}
