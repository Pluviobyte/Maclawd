#!/bin/bash
# 把官方 Node 运行时取到 mac/vendor/ 下，供 package.sh 打进 .app。
#
# **为什么必须用官方构建，不能拷本机的 node：**
# Homebrew 的 node 只有 65KB，真正的实现在 ~20 个 /opt/homebrew/opt/*.dylib 里
# （libnode、icu4c、openssl、libuv…）。把它拷进 .app，在没装 Homebrew 的机器上
# 一启动就找不到库。官方 macOS 构建是自包含的，只依赖 /usr/lib 与系统框架。
#
# **为什么要打包运行时：**
# 不打包的话，应用要求用户自己装 Node 20+。目标用户多半是装了的
# （Claude Code 本身就要 Node），但「多半」不是「一定」——nvm 装的 node
# 不在 login shell 之外的 PATH 里、版本过旧、只装了 x86 版本，
# 每一种都会让应用静默起不来，而用户只会看到「桌宠没出来」。
#
# 代价是 .app 从 1.3MB 涨到 ~110MB。Electron 应用普遍 150MB+，这是 JS 运行时的
# 正常价钱。真要瘦身得把运行时重写成 Swift，那是另一个量级的工作。
#
# 用法：./vendor-node.sh [版本]     默认取脚本里锁定的版本
set -euo pipefail
cd "$(dirname "$0")"

# 锁死版本：构建产物必须可复现，不能因为上游发新版就悄悄变了
VERSION="v24.18.1"
WANT=()
for arg in "$@"; do
  case "$arg" in
    --all) WANT=(arm64 x64) ;;
    v*) VERSION="$arg" ;;
  esac
done
if [ ${#WANT[@]} -eq 0 ]; then
  case "$(uname -m)" in
    arm64) WANT=(arm64) ;;
    x86_64) WANT=(x64) ;;
    *) echo "不支持的架构: $(uname -m)" >&2; exit 1 ;;
  esac
fi

for NODE_ARCH in "${WANT[@]}"; do
DEST="vendor/node-$NODE_ARCH"
if [ -x "$DEST/bin/node" ]; then
  HAVE="$("$DEST/bin/node" --version 2>/dev/null || echo unknown)"
  if [ "$HAVE" = "$VERSION" ]; then
    echo "已就绪: $DEST/bin/node $HAVE"
    continue
  fi
  echo "版本不符（本地 $HAVE，需要 $VERSION），重新取"
  rm -rf "$DEST"
fi

TARBALL="node-$VERSION-darwin-$NODE_ARCH.tar.gz"
URL="https://nodejs.org/dist/$VERSION/$TARBALL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> 下载 $URL"
curl -fL --retry 3 -o "$TMP/$TARBALL" "$URL"

echo "==> 校验 SHA256"
# 官方的 SHASUMS256.txt 是唯一可信来源；不校验等于把任意二进制打进用户的应用
curl -fsL --retry 3 -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/$VERSION/SHASUMS256.txt"
EXPECTED="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
ACTUAL="$(shasum -a 256 "$TMP/$TARBALL" | cut -d' ' -f1)"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "SHA256 不匹配！期望 ${EXPECTED:-（清单里没有该文件）}，实际 $ACTUAL" >&2
  exit 1
fi
echo "    ok $ACTUAL"

echo "==> 解包"
tar -xzf "$TMP/$TARBALL" -C "$TMP"
SRC="$TMP/node-$VERSION-darwin-$NODE_ARCH"
mkdir -p "$DEST/bin"
cp "$SRC/bin/node" "$DEST/bin/node"
chmod +x "$DEST/bin/node"

echo "==> 校验自包含（不许依赖 /opt/homebrew）"
if otool -L "$DEST/bin/node" | grep -q "/opt/homebrew\|/usr/local/opt"; then
  echo "取到的 node 依赖 Homebrew 库，不能分发：" >&2
  otool -L "$DEST/bin/node" | grep "/opt/homebrew\|/usr/local/opt" >&2
  exit 1
fi

# 交叉架构的 node 在本机跑不起来，不能用 --version 验；比对文件里的架构标记
echo "完成: $DEST/bin/node  $(lipo -archs "$DEST/bin/node")  $(du -h "$DEST/bin/node" | cut -f1)"
done
