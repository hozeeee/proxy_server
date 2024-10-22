


linux:

``` bash
# 注意，修改全局变量
# 注意，需要在 root 用户下执行
export SERVER_HOST=ipv6.fhz920p.seeseeyou.cn:8601 && curl http://$SERVER_HOST/forward_end/shell/forward_manager.service_creator.sh | DEVICE_ID=XXXX bash
```


linux-vnc:

``` bash
# [注意] 修改变量配置
# [注意] 需要在 root 用户下执行
curl http://ipv6.fhz920p.seeseeyou.cn:8601/forward_end/shell/tiger_vnc.service_creator.sh | USERNAME=userrr PASSWD=123456 GEOMETRY=800x600 bash
```


