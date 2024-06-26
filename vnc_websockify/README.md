
# 说明

来源于 [websockify-js](https://github.com/novnc/websockify-js) 项目。

noVNC 使用 websocket 来通信，但由于某些 vns-server 不使用 websocket 通信，需要 websockify 做转发。

noVNC 内置了 websockify ，从它的兄弟项目中找到了 websockify-js ，并从中提取了有效的单个文件，就是此文件夹的内容。

运行命令实例: `node websockify.js 127.0.0.1:6080 113.65.33.24:15901` ，前者是本地代理的 websocket 挂载的地址和端口，后者则是 vnc-server 的服务地址。

#### linux_service

``` bash
# [注意] 修改变量配置
# [注意] 需要在 root 用户下执行
curl http://ipv6.fhz920p.seeseeyou.cn:8200/vnc/tigervnc.service_creator.sh | USERNAME=userrr PASSWD=123456 GEOMETRY=800x600 bash
```



```ts
// vue
import RFB from '@novnc/novnc/core/rfb.js';
const xxx = ref()
// onMounted
const url = 'ws://127.0.0.1:6080'
const rfb = new RFB(xxx.value, url, {
  credentials: {
    password: '19931115',
  },
});
rfb.addEventListener('connect', () => {
  console.log('Connected to VNC server');
});
rfb.addEventListener('disconnect', (e) => {
  console.log('Disconnected from VNC server', e.detail);
});
rfb.addEventListener('credentialsrequired', () => {
  // rfb.sendCredentials({ password: '19931115', });
});
rfb.scaleViewport = true; // 启用视口缩放
```
