#!/bin/bash
# WebRTC Tunnel 客户端安装脚本
# 用法: ./install-client.sh [安装目录名]
# 默认目录名: webrtc-client

set -e

INSTALL_DIR="${1:-webrtc-client}"

echo "=========================================="
echo "  WebRTC Tunnel 客户端安装"
echo "=========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo "   请先安装 Node.js (https://nodejs.org/)"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js 版本: $NODE_VERSION"

# 检查编译工具
if ! command -v make &> /dev/null || ! command -v g++ &> /dev/null; then
    echo "⚠️  警告: 缺少编译工具 (make/g++)"
    echo "   安装 node-datachannel 需要编译环境"
    echo "   Ubuntu/Debian: sudo apt install build-essential"
    echo "   CentOS/RHEL:   sudo yum groupinstall 'Development Tools'"
    read -p "   是否继续? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 检查目录是否存在
if [ -d "$INSTALL_DIR" ]; then
    echo "❌ 错误: 目录 '$INSTALL_DIR' 已存在"
    echo "   请删除后重试，或指定其他目录名: ./install-client.sh <目录名>"
    exit 1
fi

echo ""
echo "📁 创建安装目录: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 创建 package.json
echo "📝 创建 package.json..."
cat > package.json << 'EOF'
{
  "name": "webrtc-tunnel-client",
  "version": "1.0.0",
  "description": "WebRTC Tunnel 客户端",
  "private": true,
  "dependencies": {
    "node-datachannel": "^0.22.0"
  }
}
EOF

# 安装依赖
echo "📦 安装依赖 (node-datachannel)..."
echo "   这可能需要几分钟，请耐心等待编译..."
echo ""
npm install --production

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ 安装失败，请检查错误信息"
    exit 1
fi

echo ""
echo "=========================================="
echo "  ✅ 安装完成！"
echo "=========================================="
echo ""
echo "安装目录: $(pwd)"
echo ""
echo "📖 使用步骤:"
echo ""
echo "  1. 下载客户端脚本:"
echo "     curl -O http://<信令服务器地址>:9876/client.js"
echo ""
echo "  2. 运行客户端:"
echo "     node client.js --id <客户端ID> --connect <目标ID>"
echo ""
echo "  示例:"
echo "     curl -O http://192.168.1.100:9876/client.js"
echo "     node client.js --id my-node --signaling ws://192.168.1.100:9876"
echo ""
