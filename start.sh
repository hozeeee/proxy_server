# 将镜像构建时预下载的 GeoIP/GeoSite 数据库拷贝到 mihomo 配置目录
# 避免 mihomo 首次启动时自行下载（容器内可能无法访问 GitHub）
MIHOMO_CONFIG_DIR="/root/.config/mihomo"
if [ -d /mihomo_geodata ]; then
  mkdir -p "$MIHOMO_CONFIG_DIR"
  cp -n /mihomo_geodata/geoip.metadb "$MIHOMO_CONFIG_DIR/" 2>/dev/null
  cp -n /mihomo_geodata/geosite.dat "$MIHOMO_CONFIG_DIR/" 2>/dev/null
  echo "GeoIP/GeoSite 数据库已拷贝到 $MIHOMO_CONFIG_DIR"
  ls -lh "$MIHOMO_CONFIG_DIR/"
fi

# 服务
npm run start &

while :; do
  sleep 100000000
done
