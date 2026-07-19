# Market Risk Models for macOS

The desktop edition is developed on the `codex/macos-app` branch so the hosted
web edition remains unchanged.

## What runs locally

- A native Swift/WebKit window.
- The existing React interface at `127.0.0.1:3000`.
- The Python FastAPI risk engine at `127.0.0.1:8000`.
- A private SQLite database at
  `~/Library/Application Support/MarketRiskModels/market_risk.db`.

Internet access is used for Yahoo Finance price/history requests and the
official U.S. Treasury yield curve. Portfolio data and calculation audit data
remain on the Mac.

The interest-rate pane supports both Hull–White one factor and G2++ two factor.
Each model keeps its own latest saved calibration in SQLite. G2++ adds a second
mean-reverting factor and negative factor correlation so level and slope curve
movements can be represented separately.

## Build

```bash
./desktop/build-macos-app.sh
```

The build creates:

- `artifacts/Market Risk Models.app`
- `artifacts/Market-Risk-Models-macOS-arm64.zip`

The current package targets Apple Silicon and uses the Node and Python
environments already installed for this project. Keep the project folder in
place after building. Rebuild the app if the project folder or Node
installation is moved.

## Run

Double-click `Market Risk Models.app`. The first window waits while the local
services start, then loads the workbench. Quitting the app stops both services.

Runtime logs are written to:

`~/Library/Application Support/MarketRiskModels/desktop.log`
