
假设局域网内有两台机器，分别为 A 和 B 。
A 负责生产镜像、提供镜像服务；B 只是作为使用镜像的一方。


A 需要做的:
  1. 拉取作为"镜像服务"的镜像 `docker pull registry`
  2. 启动"镜像服务"的镜像 `docker run -d -p 5000:5000 --restart=always --name my-registry -v /root/docker_registry_data:/var/lib/registry registry`
  3. 构建私有镜像 `docker build -t hozeee/xxxx:0.0.1`
  4. 给私有镜像打标签 `docker tag hozeee/xxxx:0.0.1 127.0.0.1:5000/hozeee/xxxx:0.0.1`
  5. 推送私有镜像到当前"镜像服务" `docker push 127.0.0.1:5000/hozeee/xxxx:0.0.1`
  6. 查看上传成功的镜像 `curl http://127.0.0.1:5000/v2/_catalog`

B 需要做的:
  1. 在 `/etc/docker/daemon.json` 文件中增加配置(没有该文件就创建)，注意修改为 A 的 IP 地址:
    ``` json
    {
      "insecure-registries": ["192.168.3.107:5000"]
    }
    ```
  2. 重启 docker 服务 `systemctl restart docker`
  3. 拉取镜像 `docker pull 192.168.3.107:5000/hozeee/xxxx:0.0.1`
  4. 使用镜像 `docker run -d 192.168.3.107:5000/hozeee/xxxx:0.0.1`

