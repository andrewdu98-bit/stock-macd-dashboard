# MACD Signal Dashboard

Static GitHub Pages version of a MACD watchlist dashboard.

It also includes a daily synced `Sell The News` WSB tab pulled from `https://sellthenews.org/wsb?lang=zh&truthShowAll=1`.

## Historical strategy lab

The `策略回测` tab loads per-symbol history files from `data/history/<SYMBOL>.json` on demand, so the main dashboard does not download the full history archive. The daily data workflow runs `scripts/update-history-data.js`, which keeps a rolling ten-year daily OHLCV window and merges only new/overlapping rows after the first full backfill.

Currently supported simulations:
- EMA 8/21 cross: buy on EMA8 crossing above EMA21, sell on crossing below.
- MACD cross: buy on DIF crossing above DEA, sell on crossing below.
- Buy-and-hold baseline.

Backtests trade at same-day close and ignore fees, tax, slippage, and cash interest.

Privacy notes:
- No private watchlist is committed.
- Symbols and favorites are stored only in the browser's localStorage.
- The local Node server version can persist to a local watchlist file, but that file is not included here.

This is an informational dashboard, not investment advice.
