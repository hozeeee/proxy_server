
#
# 仅适用于 Linux 系统。
# 此文件作用：
#   1. 安装 tigervnc 。
#   2. 在自启动服务添加相关脚本。
#



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


# 安装 vnc 服务   TODO:只测试了apt的安装
if ! [ -x "$(command -v vncserver)" ]; then
  source /etc/os-release
  case $ID in
  debian | ubuntu | devuan)
    sudo apt install tigervnc-standalone-server tigervnc-common -y
    ;;
  centos | fedora | rhel)
    yumdnf="yum"
    if test "$(echo "$VERSION_ID >= 22" | bc)" -ne 0; then
      yumdnf="dnf"
    fi
    sudo $yumdnf install tigervnc-standalone-server tigervnc-common -y
    ;;
  *)
    # exit 1
    ;;
  esac
fi


# 备忘内容：
# 如果需要用图形界面，还需要安装 apt install xfce4 xfce4-goodies
# xstartup 也需要使用 startxfce4 来启动，而非 xterm

# vncserver 命令记录:
# 启动服务:
#   vnvserver :1 -localhost no -geometry 800x600 -fg -listen 5900
# 查看已启动的服务:
#   vncserver --list


# 执行当前文件，需要如下参数：
# 1. USERNAME --> 用户名，但不能是 root
# 2. PASSWD --> 登录 vnc 的密码
# 3. GEOMETRY --> 显示尺寸，如 800x600


# 获取命令路径
SLEEP_COMMAND_PATH=$(which sleep)
ECHO_COMMAND_PATH=$(which echo)
MKDIR_COMMAND_PATH=$(which mkdir)
TOUCH_COMMAND_PATH=$(which touch)
CHMOD_COMMAND_PATH=$(which chmod)
VNCPASSWD_COMMAND_PATH=$(which vncpasswd)
VNCSERVER_COMMAND_PATH=$(which vncserver)

# service 文件内容
export MY_SERVICE_FILENAME=tiger-vnc.service
export MY_FILENAME_CONTENT="
# Unit 介绍本单元的基本信息（即元数据）
[Unit]
Description=$MY_SERVICE_FILENAME
# After=network.target

# Service 用来定制行为 (*.service 特有)
[Service]
Type=simple
User=$USERNAME
Group=$USERNAME
Restart=always
Environment=XSTARTUP_DIRNAME="/home/$USERNAME/.vnc"
Environment=VNC_PASSWD=$PASSWD
Environment=VNC_GEOMETRY=$GEOMETRY
ExecStartPre=$SLEEP_COMMAND_PATH 30s
WorkingDirectory=/etc/systemd/system
ExecStartPre=$ECHO_COMMAND_PATH -n \${VNC_PASSWD} | $VNCPASSWD_COMMAND_PATH -f > \${XSTARTUP_DIRNAME}/passwd
ExecStartPre=$MKDIR_COMMAND_PATH -p \${XSTARTUP_DIRNAME}
ExecStartPre=$TOUCH_COMMAND_PATH \${XSTARTUP_DIRNAME}/xstartup
ExecStartPre=$CHMOD_COMMAND_PATH 777 \${XSTARTUP_DIRNAME}/xstartup
ExecStartPre=$CHMOD_COMMAND_PATH +x \${XSTARTUP_DIRNAME}/xstartup
ExecStartPre=$ECHO_COMMAND_PATH -e '#!/bin/sh \n xterm -geometry \${VNC_GEOMETRY}' > \${XSTARTUP_DIRNAME}/xstartup
ExecStart=$VNCSERVER_COMMAND_PATH :1 -localhost no -geometry \${VNC_GEOMETRY} -fg
ExecStop=$VNCSERVER_COMMAND_PATH -kill :1

# Install 定义开机自启动(systemctl enable)和关闭开机自启动(systemctl disable)这个单元时，所要执行的命令
[Install]
# WantedBy=multi-user.target
WantedBy=network-online.target
"

# 配置系统级自启动
systemctl is-enabled $MY_SERVICE_FILENAME
if [ $? = 1 ] || [ $(systemctl is-enabled $MY_SERVICE_FILENAME) = "disabled" ]; then
  if [ -f "/etc/systemd/system/$MY_SERVICE_FILENAME" ]; then
    rm /etc/systemd/system/$MY_SERVICE_FILENAME
  fi
  touch /etc/systemd/system/$MY_SERVICE_FILENAME
  echo "$MY_FILENAME_CONTENT" > /etc/systemd/system/$MY_SERVICE_FILENAME

  # 启用服务
  chmod 755 /etc/systemd/system/$MY_SERVICE_FILENAME
  systemctl enable $MY_SERVICE_FILENAME
  systemctl restart $MY_SERVICE_FILENAME

else
  # 更新 service 内容
  >/etc/systemd/system/$MY_SERVICE_FILENAME
  echo "$MY_FILENAME_CONTENT" > /etc/systemd/system/$MY_SERVICE_FILENAME
fi
