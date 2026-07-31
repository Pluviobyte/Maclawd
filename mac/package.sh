#!/bin/bash
# 打包 Maclawd.app。
#
# 分发形态：Developer ID + DMG，**不启用 App Sandbox**。
# 原因见 design/token-tracking.md「连带约束」：要读 ~/.claude 等目录，
# 一旦沙盒化就必须让用户走文件选择授权，「默认开启」立刻不成立。
#
# 本脚本只做 ad-hoc 签名，够本机运行与自测。正式分发需要
#   codesign --force --options runtime --sign "Developer ID Application: ..." Maclawd.app
#   xcrun notarytool submit ...
set -euo pipefail

cd "$(dirname "$0")"
CONFIG="${CONFIG:-release}"
APP="Maclawd.app"
REPO_ROOT="$(cd .. && pwd)"

echo "==> 生成图标"
# 图标按角色几何合同程序化绘制，与桌宠本体必然同源，不会漂移
swift make-icon.swift

echo "==> 准备 Node 运行时"
# 必须打包：不打的话应用要求用户自己装 Node 20+，而 nvm 装的 node 不在
# login shell 之外的 PATH 里、版本过旧、或只有 x86 版——每一种都会让应用
# 静默起不来，用户只看到「桌宠没出来」。见 vendor-node.sh 顶部的说明。
./vendor-node.sh

echo "==> 编译 ($CONFIG)"
swift build -c "$CONFIG"
BIN="$(swift build -c "$CONFIG" --show-bin-path)/Maclawd"

echo "==> 组装 $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Maclawd"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Node 运行时随包携带：动画资产、解析器、面板页面都在里面。
# 只带运行必需的目录，不带 .git / build / previews 这些体积大头。
RUNTIME="$APP/Contents/Resources/runtime"
mkdir -p "$RUNTIME"
for item in bin src web design package.json; do
  cp -R "$REPO_ROOT/$item" "$RUNTIME/"
done
# 解析缓存与聚合数据是用户数据，绝不打进包里
rm -rf "$RUNTIME/node_modules"

# 自包含的 Node 运行时。放在 Resources/node 下，应用优先用它，
# 找不到才回落到系统 node（开发时方便，分发时用不到）。
ARCH="$(uname -m)"
case "$ARCH" in arm64) NODE_ARCH=arm64 ;; x86_64) NODE_ARCH=x64 ;; esac
mkdir -p "$APP/Contents/Resources/node/bin"
cp "vendor/node-$NODE_ARCH/bin/node" "$APP/Contents/Resources/node/bin/node"

VERSION="$(python3 -c "import json;print(json.load(open('$REPO_ROOT/package.json'))['version'])")"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Maclawd</string>
  <key>CFBundleDisplayName</key><string>Maclawd</string>
  <key>CFBundleIdentifier</key><string>ai.maclawd.desktop</string>
  <key>CFBundleExecutable</key><string>Maclawd</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <!-- 菜单栏应用：不占 Dock 图标 -->
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>Maclawd</string>
</dict>
</plist>
PLIST

# 签名。设了 MACLAWD_SIGN_ID 就走 Developer ID + 硬化运行时，否则 ad-hoc。
if [ -n "${MACLAWD_SIGN_ID:-}" ]; then
  echo "==> Developer ID 签名"
  codesign --force --deep --options runtime --timestamp \
    --sign "$MACLAWD_SIGN_ID" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  echo "    下一步公证："
  echo "      ditto -c -k --keepParent $APP Maclawd.zip"
  echo "      xcrun notarytool submit Maclawd.zip --keychain-profile <profile> --wait"
  echo "      xcrun stapler staple $APP"
else
  echo "==> ad-hoc 签名（仅本机可用，别人下载会被 Gatekeeper 拦）"
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "    （签名跳过）"
fi

echo "==> 完成: $(pwd)/$APP"
du -sh "$APP" | sed 's/^/    /'

if [ "${MACLAWD_DMG:-}" = "1" ]; then
  echo "==> 打包 DMG"
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  rm -f Maclawd.dmg
  hdiutil create -volname Maclawd -srcfolder "$STAGE" -ov -format UDZO Maclawd.dmg >/dev/null
  rm -rf "$STAGE"
  echo "    $(pwd)/Maclawd.dmg  $(du -h Maclawd.dmg | cut -f1)"
fi
