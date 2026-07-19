#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$ROOT/artifacts"
APP="$OUTPUT/Market Risk Models.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
NODE_BIN="$(dirname "$(command -v node)")"

NEXT_PUBLIC_RISK_API_URL=http://127.0.0.1:8000 npm run build
cd "$ROOT/backend"
.venv/bin/alembic upgrade head

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

swiftc \
  -O \
  -parse-as-library \
  -framework AppKit \
  -framework WebKit \
  "$ROOT/desktop/MarketRiskModelsApp.swift" \
  -o "$MACOS/MarketRiskModels"

cp "$ROOT/desktop/Info.plist" "$CONTENTS/Info.plist"

ICON_WORK="$(mktemp -d)"
ICONSET="$ICON_WORK/MarketRiskModels.iconset"
mkdir -p "$ICONSET"
for SPEC in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  SIZE="${SPEC%% *}"
  NAME="${SPEC#* }"
  sips -s format png -z "$SIZE" "$SIZE" "$ROOT/desktop/AppIcon.jpg" \
    --out "$ICONSET/$NAME" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/MarketRiskModels.icns"
rm -rf "$ICON_WORK"

cat > "$RESOURCES/launcher-config.json" <<JSON
{
  "projectRoot": "$ROOT",
  "nodeBin": "$NODE_BIN"
}
JSON

codesign --force --deep --sign - "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUTPUT/Market-Risk-Models-macOS-arm64.zip"

echo "$APP"
echo "$OUTPUT/Market-Risk-Models-macOS-arm64.zip"
