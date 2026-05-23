# 将镜像构建时已包含的 GeoIP/GeoSite 数据库拷贝到 mihomo 配置目录
# 避免 mihomo 首次启动时自行下载（容器内可能无法访问 GitHub）
MIHOMO_CONFIG_DIR="/root/.config/mihomo"
GEODATA_DIR="/my_project/mihomo_geodata"
if [ -d "$GEODATA_DIR" ]; then
  mkdir -p "$MIHOMO_CONFIG_DIR"
  cp -n "$GEODATA_DIR/geoip.metadb" "$MIHOMO_CONFIG_DIR/" 2>/dev/null
  cp -n "$GEODATA_DIR/geosite.dat" "$MIHOMO_CONFIG_DIR/" 2>/dev/null
  echo "GeoIP/GeoSite 数据库已拷贝到 $MIHOMO_CONFIG_DIR"
  ls -lh "$MIHOMO_CONFIG_DIR/"
fi

# 服务
npm run start &

while :; do
  sleep 100000000
done
