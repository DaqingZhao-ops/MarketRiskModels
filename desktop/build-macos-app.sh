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
