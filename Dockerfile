FROM node:18.16.1-bullseye
# FROM node:latest
ENV TZ="Asia/Shanghai"

# clash 配置下载地址
ENV CLASH_CONFIG_URL="https://a9255d35-f774-3cfe-9a91-abaadf3318f4.nginxcave.xyz/link/ZWwakjF4eVPCHwcg?clash=1"

# # 拷贝中文字体包
# RUN if [ ! -d "/usr/share/fonts/zh_CN" ]; then mkdir /usr/share/fonts/zh_CN; fi
# COPY *.TTC /usr/share/fonts/zh_CN/

# # 解决 vim 打开"中文乱码"的问题
# COPY --chmod=777 .vimrc /root/.vimrc

# 复制项目代码
RUN mkdir my_project
WORKDIR /my_project
# COPY --chmod=777 . /my_project/
COPY . /my_project/

RUN npm i pm2 -g


# npm 镜像源更换
# 腾讯: http://mirrors.cloud.tencent.com/npm
# 华为: https://mirrors.huaweicloud.com/repository/npm
# 阿里: https://registry.npmmirror.com
# 官方: https://registry.npmjs.org
RUN npm config set registry=https://registry.npm.taobao.org


# 安装项目依赖
RUN npm i \
  && npm run build

EXPOSE 8600-8699

# 健康检测  (参数说明 https://www.51cto.com/article/716923.html )
# 健康检查并不会自动重启，官方并未支持，可以暂时使用此镜像 willfarrell/autoheal (https://hub.docker.com/r/willfarrell/autoheal)
# 注意， autoheal 镜像的使用，和此镜像启动参数 --restart 无关。
# HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
#   CMD curl -fs "http://127.0.0.1:8100/" || exit 1

ENTRYPOINT [ "bash", "/my_project/start.sh" ]
# CMD [ "bash" ]
