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

# 通用包（arm64 + x86_64）。分发必须开——只有 arm64 的话，
# Intel Mac 上应用根本起不来，而用户只会看到「打不开」。
# 本地自测默认关，省一半时间和一半体积。
UNIVERSAL="${MACLAWD_UNIVERSAL:-0}"
# DMG 是给别人下载的，不允许出单架构的
if [ "${MACLAWD_DMG:-}" = "1" ]; then UNIVERSAL=1; fi

echo "==> 准备 Node 运行时"
# 必须打包：不打的话应用要求用户自己装 Node 20+，而 nvm 装的 node 不在
# login shell 之外的 PATH 里、版本过旧、或只有 x86 版——每一种都会让应用
# 静默起不来，用户只看到「桌宠没出来」。见 vendor-node.sh 顶部的说明。
if [ "$UNIVERSAL" = "1" ]; then ./vendor-node.sh --all; else ./vendor-node.sh; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$UNIVERSAL" = "1" ]; then
  echo "==> 编译通用二进制 ($CONFIG, arm64 + x86_64)"
  # `swift build --arch a --arch b` 需要完整 Xcode 的 xcbuild，
  # 只装了命令行工具时它会直接报错。所以分别交叉编译再 lipo 拼起来。
  for triple in arm64-apple-macos13.0 x86_64-apple-macos13.0; do
    swift build -c "$CONFIG" -Xswiftc -target -Xswiftc "$triple" >/dev/null
    cp "$(swift build -c "$CONFIG" --show-bin-path)/Maclawd" "$WORK/${triple%%-*}"
  done
  lipo -create "$WORK/arm64" "$WORK/x86_64" -output "$WORK/Maclawd"
  BIN="$WORK/Maclawd"
else
  echo "==> 编译 ($CONFIG, 仅本机架构)"
  swift build -c "$CONFIG"
  BIN="$(swift build -c "$CONFIG" --show-bin-path)/Maclawd"
fi

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

# 自包含的 Node 运行时。按架构分目录，应用在运行时挑自己那一份
# （通用二进制里 #if arch 是按切片解析的，正好选对）。
# 应用优先用随包的，找不到才回落到系统 node（开发时方便，分发时用不到）。
if [ "$UNIVERSAL" = "1" ]; then NODE_ARCHES="arm64 x64"; else
  case "$(uname -m)" in arm64) NODE_ARCHES=arm64 ;; x86_64) NODE_ARCHES=x64 ;; esac
fi
for na in $NODE_ARCHES; do
  mkdir -p "$APP/Contents/Resources/node/$na/bin"
  cp "vendor/node-$na/bin/node" "$APP/Contents/Resources/node/$na/bin/node"
done

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
echo "    架构: $(lipo -archs "$APP/Contents/MacOS/Maclawd")"
if [ "$UNIVERSAL" != "1" ]; then
  echo "    ⚠️  仅本机架构，**不能分发**——换架构的机器上起不来。"
  echo "       出分发包：MACLAWD_UNIVERSAL=1 ./package.sh 或 MACLAWD_DMG=1 ./package.sh"
fi

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
