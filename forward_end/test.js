const http = require('http');
const { URL } = require('url');

const url = new URL('http://ipv6.fhz920p.seeseeyou.cn:8100/appoint_script_list')

// http.request(url, {
//     method: 'GET',
//     headers: {
//         host: 'ipv6.fhz920p.seeseeyou.cn:8100',
//         'proxy-connection': 'keep-alive',
//         pragma: 'no-cache',
//         'cache-control': 'no-cache',
//         'upgrade-insecure-requests': '1',
//         'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
//         accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
//         'accept-encoding': 'gzip, deflate',
//         'accept-language': 'zh-CN,zh;q=0.9',
//         cookie: 'BD_HOME=1; _pk_id.1.9987=25f7302144e6ca77.1717254843.; cvf=4JECgFBKvUt02AwCQgWBOXYwIESgHBKvVtEy'
//     }
// }, (res) => {
//     console.log('====', res)
// })


const req = http.request(
    'http://www.baidu.com',
    {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        }
    },
    (res) => {
        console.log('====', res)
    }
)
req.end()