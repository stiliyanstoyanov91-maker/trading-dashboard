# Paper trading dashboard

Static, mobile-first dashboard for a bot that paper-trades **BTC/USDC** on Kraken (simulated funds, 10,000 USDC start). The strategy is long-only on 5-minute candles: RSI 14 crosses above 30, TEMA 9 is rising and below the Bollinger 20 middle band, with a 2% stop and ROI targets of 4% / 2% / 1% at 0 / 30 / 60 minutes.

There is no build step. The page never hardcodes figures. It only fetches `data/dashboard.json`.

Expected GitHub Pages URL:

https://stiliyanstoyanov91-maker.github.io/trading-dashboard/

## Refresh

The bot overwrites `data/dashboard.json` and commits it to `main` every few minutes. `.github/workflows/pages.yml` deploys the repo to GitHub Pages on every push to `main`, so the published site picks up the new file.

The page requests `data/dashboard.json?t=<Date.now()>` with `cache: "no-store"` on load, again every 60 seconds, and when the tab becomes visible. The URL is resolved against the page directory, so the same file works locally and under `/trading-dashboard/`. If that file is missing (HTTP 404), the page loads `data/dashboard.sample.json` instead.

Times are shown in **Europe/Sofia**. If `updated_at` is missing, invalid, or older than 15 minutes, the timestamp and a warning turn amber.

When `"sample": true`, a sticky banner reads **Примерни данни · sample data**. `data/dashboard.sample.json` is a fake snapshot for preview and tests. The bot publishes the live file at `data/dashboard.json` and should set `"sample": false` there. Do not overwrite a live `data/dashboard.json` with the sample.

## Local preview

```bash
python3 -m http.server 8765
```

Open http://127.0.0.1:8765/ . Opening `index.html` as a file will not load the JSON.

```bash
node --test
```

## Missing data

Missing, `null`, or malformed fields do not blank the page. A missing number renders as "—". Empty arrays show a short empty state ("Няма сделки", "Няма данни за кривата", and so on). `open_position: null`, or a payload without that key, shows **Няма отворена позиция**. `profit_factor: null` shows "—". An unknown `bot.status` or `exit_reason` is shown as provided. A trade with `analysis: null` still expands, with the text "Няма записан анализ."

A failed fetch keeps the last good view and shows an error banner. The next attempt is on the 60-second timer.

The page does not recompute statistics. It formats, sorts, and draws what the file contains. Trades and analyses are shown newest first. The equity curve and daily bars are sorted ascending for the charts.

## Number format

| Kind | Format |
| --- | --- |
| USDC amounts, prices, RSI, TEMA, BB mid, fees | 2 fraction digits, `bg-BG` |
| BTC volume | 6 to 8 fraction digits |
| Trade counts | integers |
| `win_rate` | 0–1; the page displays it as a percent |
| Every other `*_pct` field | percentage points: `4` means 4%, `1.08` means 1.08% |
| Timestamps | ISO 8601 with a numeric offset, displayed in Europe/Sofia |

`avg_loss` is negative. A positive value is still displayed as a loss. `gross_loss`, `max_drawdown_pct`, and `daily_loss_limit` are positive magnitudes (`daily_loss_limit` is the USDC loss ceiling). `today_pnl` is the realized result for the bot's Sofia calendar day. Open-position `unrealized_pnl` is separate and is not added into `today_pnl` by the page.

Closed-trade `pnl` is net of that trade's `fees`. `fees_total` is the sum of closed-trade fees.

## Contract: `data/dashboard.json`

```json
{
  "sample": false,
  "updated_at": "2026-10-08T12:23:00+03:00",
  "pair": "BTC/USDC",
  "currency": "USDC",
  "starting_capital": 10000,
  "bot": {
    "status": "running",
    "last_cycle": "2026-10-08T12:21:00+03:00"
  },
  "price": { "last": 0, "rsi": 0, "tema": 0, "bb_mid": 0 },
  "balance": { "quote": 0, "base": 0, "equity": 0 },
  "open_position": null,
  "stats": {
    "total_trades": 0,
    "wins": 0,
    "losses": 0,
    "win_rate": 0,
    "net_pnl": 0,
    "net_pnl_pct": 0,
    "gross_profit": 0,
    "gross_loss": 0,
    "profit_factor": null,
    "avg_win": 0,
    "avg_loss": 0,
    "expectancy": 0,
    "fees_total": 0,
    "max_drawdown_pct": 0,
    "today_pnl": 0,
    "daily_loss_limit": 200,
    "exit_reasons": { "stop": 0, "roi_4": 0, "roi_2": 0, "roi_1": 0, "signal": 0 }
  },
  "equity_curve": [{ "t": "2026-10-08T12:23:00+03:00", "equity": 10000 }],
  "daily_pnl": [{ "date": "2026-10-08", "pnl": 0, "trades": 0 }],
  "trades": [{
    "id": "pt-1",
    "entry_time": "2026-10-08T09:40:00+03:00",
    "exit_time": "2026-10-08T09:51:00+03:00",
    "entry_price": 0,
    "exit_price": 0,
    "volume": 0,
    "pnl": 0,
    "pnl_pct": 0,
    "fees": 0,
    "duration_min": 0,
    "exit_reason": "roi_4",
    "analysis": null
  }],
  "analyses": [{ "t": "2026-10-08T12:21:00+03:00", "title": "", "text": "" }]
}
```

The fake snapshot is `data/dashboard.sample.json` (`"sample": true`). Zeros above are the shape, not live values. `data/dashboard.json` is the bot's file.

### Fields

- `sample` — `true` only while the file is the placeholder. Real paper snapshots should use `false`.
- `updated_at` — when the file was written, ISO 8601 with an offset.
- `pair` — `"BTC/USDC"`. The base and quote labels are split from this string.
- `currency` — `"USDC"`.
- `starting_capital` — starting quote balance.
- `bot.status` — `running`, `stopped`, `paused_daily_limit`, or `kill_switch`.
- `bot.last_cycle` — timestamp of the last bot cycle.
- `price.last`, `price.rsi`, `price.tema`, `price.bb_mid` — last price and the signal indicators.
- `balance.quote` — free quote. `balance.base` — base asset (BTC). `balance.equity` — quote plus base marked at `price.last`.
- `open_position` — `null`, or an object with `entry_time`, `entry_price`, `volume`, `cost`, `stop_price`, `current_target_pct` (`4`, `2`, or `1`), `unrealized_pnl`, and `unrealized_pct`.
- `stats.win_rate` — wins / trades, from 0 to 1.
- `stats.profit_factor` — gross profit / gross loss, or `null` when there is no gross loss.
- `stats.gross_loss` — sum of absolute losses, positive.
- `stats.avg_loss` — average losing trade, negative.
- `stats.max_drawdown_pct` — largest peak-to-later-trough drop on `equity_curve`, in percentage points, unsigned.
- `stats.exit_reasons` — counts for `stop`, `roi_4`, `roi_2`, `roi_1`, and `signal`.
- `equity_curve[].t` / `equity` — line-chart points.
- `daily_pnl[].date` — `YYYY-MM-DD` in the Sofia calendar, with `pnl` and `trades` for that day.
- `trades[]` — closed trades. `exit_reason` is one of the keys above. `analysis` is a string or `null`. Tap a row to expand the analysis.
- `analyses[]` — separate bot notes, newest first.

## Deploy

Pages is published by GitHub Actions (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`), not by Jekyll. The repository Pages source must be **GitHub Actions**. Each bot commit on `main` republishes the JSON with the site.
