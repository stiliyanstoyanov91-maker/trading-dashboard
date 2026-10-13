import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const code = fs.readFileSync(new URL("app.js", root), "utf8");
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const css = fs.readFileSync(new URL("styles.css", root), "utf8");
const sample = JSON.parse(fs.readFileSync(new URL("data/dashboard.sample.json", root), "utf8"));

const sandbox = {
  URL,
  URLSearchParams,
  Intl,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Set,
  Map,
  isFinite,
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const dash = sandbox.PaperDash;

test("formatters use two decimals, BTC uses 6-8, Sofia clock", () => {
  assert.equal(dash.formatQuote(10122.26), new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(10122.26));
  assert.match(dash.formatQuote(98190.19), /98/);
  assert.match(dash.formatQuote(98190.19), /19/);
  assert.equal(dash.formatBtc(0.0265), new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  }).format(0.0265));
  assert.match(dash.formatBtc(0.0265), /026500/);
  assert.match(dash.formatBtc(0.02651234), /02651234/);
  assert.equal(dash.formatWhen("2026-10-08T09:23:00Z"), "08.10.2026, 12:23");
  assert.equal(dash.formatWhen("2026-01-15T22:05:00Z"), "16.01.2026, 00:05");
  assert.equal(dash.formatWhen("not-a-date"), null);
  assert.equal(dash.formatWinRate(0.6667), `${dash.formatQuote(66.67)}%`);
  assert.equal(dash.formatPctPoints(4), `${dash.formatQuote(4)}%`);
  assert.ok(dash.formatSignedQuote(14.58).startsWith("+"));
  assert.ok(dash.formatSignedQuote(-67.62).startsWith("−"));
  assert.equal(dash.formatAvgLoss(67.62), dash.formatAvgLoss(-67.62));
  assert.ok(dash.formatAvgLoss(-67.62).startsWith("−"));
  assert.equal(dash.formatDuration(84), "1 ч 24 мин");
  assert.equal(dash.formatDuration(11), "11 мин");
});

test("staleness is strict after 15 minutes and missing times are not fresh", () => {
  const now = Date.parse("2026-10-08T09:23:00Z");
  assert.equal(dash.freshness("2026-10-08T09:08:00Z", now).level, "ok");
  assert.equal(dash.freshness("2026-10-08T09:08:00.000Z", now).level, "ok");
  assert.equal(dash.freshness(new Date(now - dash.STALE_MS).toISOString(), now).level, "ok");
  assert.equal(dash.freshness(new Date(now - dash.STALE_MS - 1).toISOString(), now).level, "old");
  assert.equal(dash.freshness(null, now).level, "missing");
  assert.equal(dash.freshness("yesterday", now).level, "invalid");
  assert.equal(dash.REFRESH_MS, 60000);
});

test("normalize tolerates nulls and sorts trades newest first", () => {
  const empty = dash.normalize(null);
  assert.equal(empty.sample, false);
  assert.equal(empty.openPosition, null);
  assert.equal(empty.balance.equity, null);
  assert.equal(empty.stats.profitFactor, null);
  assert.equal(empty.trades.length, 0);
  assert.equal(empty.stats.exitReasons, null);

  const partial = dash.normalize({
    sample: "true",
    open_position: null,
    stats: { profit_factor: null, win_rate: 0.5 },
    trades: [
      null,
      { id: "old", exit_time: "2026-10-01T10:00:00+03:00", pnl: -2, analysis: "  " },
      { id: "new", exit_time: "2026-10-08T10:00:00+03:00", pnl: 3, analysis: "бележка" },
      { entry_time: "nope", pnl: "5" },
    ],
    equity_curve: [
      { t: "nope", equity: 1 },
      { equity: 2 },
      { t: "2026-10-02T00:00:00Z", equity: 10 },
      { t: "2026-09-01T00:00:00Z", equity: 9 },
    ],
    analyses: [{ title: "  ", text: "" }, { t: "2026-10-01T00:00:00Z", text: "втори" }, { t: "2026-10-08T00:00:00Z", title: "първи" }],
  });
  assert.equal(partial.sample, false);
  assert.equal(partial.openPosition, null);
  assert.equal(partial.stats.profitFactor, null);
  assert.equal(partial.stats.winRate, 0.5);
  assert.deepEqual(Array.from(partial.trades, (trade) => trade.id), ["new", "old"]);
  assert.equal(partial.trades[1].analysis, null);
  assert.deepEqual(Array.from(partial.equityCurve, (point) => point.equity), [9, 10]);
  assert.equal(partial.analyses[0].title, "първи");
  assert.equal(partial.analyses[1].text, "втори");
});

test("project-page URLs resolve next to index.html", () => {
  assert.equal(
    dash.directoryHref("https://stiliyanstoyanov91-maker.github.io/trading-dashboard"),
    "https://stiliyanstoyanov91-maker.github.io/trading-dashboard/",
  );
  assert.equal(
    dash.directoryHref("https://stiliyanstoyanov91-maker.github.io/trading-dashboard/index.html"),
    "https://stiliyanstoyanov91-maker.github.io/trading-dashboard/",
  );
  assert.equal(
    dash.directoryHref("https://stiliyanstoyanov91-maker.github.io/trading-dashboard/"),
    "https://stiliyanstoyanov91-maker.github.io/trading-dashboard/",
  );
  assert.equal(dash.directoryHref("http://127.0.0.1:8765/"), "http://127.0.0.1:8765/");
});

test("sample file matches the contract and is not copied into the page", () => {
  const view = dash.normalize(sample);
  assert.equal(sample.sample, true);
  assert.equal(view.sample, true);
  assert.equal(view.pair, "BTC/USDC");
  assert.equal(view.balance.equity, sample.balance.equity);
  assert.equal(view.trades[0].id, "pt-1018");
  assert.equal(view.trades.at(-1).id, "pt-1001");
  assert.ok(view.trades[0].exitTime > view.trades[1].exitTime);
  assert.equal(view.openPosition.currentTargetPct, 4);
  assert.equal(view.stats.profitFactor, sample.stats.profit_factor);
  assert.equal(view.analyses[0].title, "Цикълът вижда вход");
  assert.equal(view.equityCurve.at(-1).equity, sample.balance.equity);
  for (const source of [html, code, css]) {
    assert.equal(source.includes("10122.26"), false);
    assert.equal(source.includes("98190.19"), false);
  }
  assert.match(code, /data\/dashboard\.json/);
  assert.match(code, /Date\.now\(\)/);
  assert.match(code, /Europe\/Sofia/);
  assert.match(code, /cache:\s*"no-store"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /theme-color/);
});

test("parseMarkdown handles headings, lists and paragraphs", () => {
  const b = dash.parseMarkdown("# Заглавие\n\n- **a:** b\n- c\n\nтекст\nоще");
  assert.equal(b[0].type, "h");
  assert.equal(b[1].type, "list");
  assert.equal(b[1].items.length, 2);
  assert.equal(b[2].type, "p");
  assert.equal(b[2].lines.length, 2);
});

test("daily MACD payload maps onto the shared view", () => {
  const raw = {
    bot: "daily-macd", pair: "BTC/USDC", updated: "2026-10-13T15:01:41+03:00", status: "running",
    strategy: { take_profit_pct: 10, stop_loss_pct: -4, stake_usdc: 1000 },
    last_price: 83234.26, starting_capital: 10000, balance: { USDC: 9000, BTC: 0.012 }, equity: 9990,
    equity_change_pct: -0.1, indicators: { macd: 1, macd_signal: 2, hist: -1, cross_up: false, candle_utc_day: "2026-10-12" },
    position: { entry_time: "2026-10-12T03:00:10+03:00", entry_price: 83000, volume: 0.012, cost_usdc: 996, stop_price: 79680, take_profit_price: 91300, unrealized_pct: 0.2, unrealized_usdc: 2 },
    stats: { trades: 2, wins: 1, total_pnl_usdc: 60, win_rate_pct: 50 },
    trades: [
      { trade_id: 1, entry_time: "2026-09-01T03:00:00+03:00", exit_time: "2026-09-05T10:00:00+03:00", entry_price: "80000", exit_price: "88000", volume: "0.0125", pnl_usdc: "100", pnl_pct: "10", duration_h: "103", exit_reason: "take_profit", fees_usdc: "1" },
      { trade_id: 2, entry_time: "2026-09-10T03:00:00+03:00", exit_time: "2026-09-11T10:00:00+03:00", entry_price: 90000, exit_price: 86400, volume: 0.011, pnl_usdc: -40, pnl_pct: -4, duration_h: 31, exit_reason: "stop" },
    ],
  };
  const v = dash.normalizeDailyMacd(raw);
  assert.equal(v.balance.equity, 9990);
  assert.equal(v.balance.quote, 9000);
  assert.equal(v.openPosition.cost, 996);
  assert.equal(v.stats.totalTrades, 2);
  assert.equal(v.stats.losses, 1);
  assert.equal(v.stats.winRate, 0.5);
  assert.equal(v.trades[0].id, "macd-2");
  assert.equal(v.trades[1].durationMin, 103 * 60);
  assert.equal(v.stats.exitReasons.take_profit, 1);
  assert.equal(v.equityCurve.at(-1).equity, 9990);
  const empty = dash.normalizeDailyMacd({});
  assert.equal(empty.openPosition, null);
  assert.equal(empty.balance.equity, null);
  assert.equal(dash.resolveBot("?bot=daily_macd", "rsi"), "daily_macd");
  assert.equal(dash.resolveBot("", "daily_macd"), "daily_macd");
  assert.equal(dash.resolveBot("?bot=nope", null), "rsi");
  assert.match(html, /Бот:/);
  assert.match(html, /Дневен MACD/);
});
