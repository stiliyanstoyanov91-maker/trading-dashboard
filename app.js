(function () {
  "use strict";

  const STALE_MS = 15 * 60 * 1000;
  const REFRESH_MS = 60 * 1000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const VB_W = 360;
  const VB_H = 210;

  const quoteFormat = new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const btcFormat = new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  });
  const intFormat = new Intl.NumberFormat("bg-BG", {
    maximumFractionDigits: 0,
  });
  const factorFormat = new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const STATUS = {
    running: "Работи",
    manual_publish: "Ръчно публикуване",
    starting: "Стартира",
    stopped: "Спрян",
    paused_daily_limit: "Пауза · дневен лимит",
    kill_switch: "Авариен стоп",
  };

  const EXIT_ORDER = [
    ["stop", "Стоп", "var(--bad)"],
    ["roi_4", "ROI 4%", "var(--good)"],
    ["roi_2", "ROI 2%", "#8ee0b5"],
    ["roi_1", "ROI 1%", "var(--info)"],
    ["signal", "Сигнал", "var(--gold)"],
  ];

  const EXIT_ORDER_MACD = [
    ["stop", "Стоп −4%", "var(--bad)"],
    ["take_profit", "Цел +10%", "var(--good)"],
  ];

  const NO_DATA = "няма данни";

  const BOTS = {
    rsi: {
      label: "RSI/TEMA (минутен)",
      file: "data/dashboard.json",
      sample: "data/dashboard.sample.json",
      analyses: "data/analyses.json",
      staleMs: STALE_MS,
      footer: "Само дълги · 5-минутна mean-reversion (RSI 14 / TEMA 9 / BB 20). Автообновяване на всеки 60 секунди от data/dashboard.json и data/analyses.json.",
    },
    daily_macd: {
      label: "Дневен MACD",
      file: "data/daily_macd.json",
      sample: null,
      analyses: "data/analyses_daily_macd.json",
      staleMs: 30 * 60 * 1000,
      footer: "Само дълги · дневни свещи · MACD(12,26,9) пресичане нагоре · цел +10% / стоп −4% · отделна хартиена сметка. Автообновяване на всеки 60 секунди от data/daily_macd.json и data/analyses_daily_macd.json.",
    },
  };

  function resolveBot(search, stored) {
    let fromUrl = null;
    try { fromUrl = new URLSearchParams(search || "").get("bot"); } catch (e) { fromUrl = null; }
    if (fromUrl && Object.prototype.hasOwnProperty.call(BOTS, fromUrl)) return fromUrl;
    if (stored && Object.prototype.hasOwnProperty.call(BOTS, stored)) return stored;
    return "rsi";
  }

  const state = {
    bot: "rsi",
    seq: 0,
    inFlight: false,
    serialized: null,
    data: null,
  };

  let gradientSeq = 0;

  function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function asNum(value) {
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return asNumber(value);
  }

  function asText(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function asTime(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    return Number.isFinite(Date.parse(value)) ? value : null;
  }

  function stamp(iso) {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  }

  function tone(value) {
    if (value == null || value === 0) return "flat";
    return value > 0 ? "positive" : "negative";
  }

  function formatQuote(value) {
    if (value == null) return "—";
    return quoteFormat.format(value);
  }

  function formatSignedQuote(value) {
    if (value == null) return "—";
    if (value === 0) return formatQuote(0);
    const body = formatQuote(Math.abs(value));
    return value > 0 ? `+${body}` : `−${body}`;
  }

  function formatBtc(value) {
    if (value == null) return "—";
    return btcFormat.format(value);
  }

  function formatPctPoints(value, options) {
    const signed = options && options.signed;
    if (value == null) return "—";
    const body = `${quoteFormat.format(Math.abs(value))}%`;
    if (value < 0) return `−${body}`;
    if (signed && value > 0) return `+${body}`;
    return body;
  }

  function formatWinRate(value) {
    if (value == null) return "—";
    return formatPctPoints(value * 100);
  }

  function formatInt(value) {
    if (value == null) return "—";
    return intFormat.format(value);
  }

  function formatFactor(value) {
    if (value == null) return "—";
    return factorFormat.format(value);
  }

  function formatAvgLoss(value) {
    if (value == null) return "—";
    return formatSignedQuote(value > 0 ? -value : value);
  }

  function formatMagnitude(value) {
    if (value == null) return "—";
    return formatQuote(Math.abs(value));
  }

  function formatWhen(iso) {
    if (typeof iso !== "string") return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("bg-BG", {
      timeZone: "Europe/Sofia",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const day = get("day");
    const month = get("month");
    const year = get("year");
    const hour = get("hour");
    const minute = get("minute");
    if (!day || !month || !year || !hour || !minute) return null;
    return `${day}.${month}.${year}, ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  function formatDayLabel(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    if (!match) return date || "—";
    return `${match[3]}.${match[2]}`;
  }

  function formatDuration(minutes) {
    if (minutes == null) return "—";
    const rounded = Math.round(minutes);
    if (Math.abs(rounded) < 60) return `${rounded} мин`;
    const sign = rounded < 0 ? "−" : "";
    const abs = Math.abs(rounded);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    return rest ? `${sign}${hours} ч ${rest} мин` : `${sign}${hours} ч`;
  }

  function formatAxis(value, span) {
    const digits = span >= 80 ? 0 : 2;
    return new Intl.NumberFormat("bg-BG", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function withCurrency(text, currency) {
    if (text === "—") return text;
    return currency ? `${text} ${currency}` : text;
  }

  function directoryHref(href) {
    const url = new URL(href);
    let path = url.pathname;
    if (!path.endsWith("/")) {
      if (/\.html?$/i.test(path)) path = path.slice(0, path.lastIndexOf("/") + 1) || "/";
      else path += "/";
    }
    return `${url.origin}${path}`;
  }

  function jsonUrl(fileName) {
    const root = directoryHref(document.baseURI || location.href);
    const url = new URL(fileName, root);
    url.searchParams.set("t", String(Date.now()));
    return url.href;
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function freshness(iso, nowMs, staleMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    if (!iso) return { level: "missing" };
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return { level: "invalid" };
    if (now - ms > (staleMs || STALE_MS)) return { level: "old" };
    return { level: "ok" };
  }

  function splitPair(pair) {
    if (!pair || !pair.includes("/")) return { base: null, quote: null };
    const [base, quote] = pair.split("/");
    return {
      base: base && base.trim() ? base.trim() : null,
      quote: quote && quote.trim() ? quote.trim() : null,
    };
  }

  function normalizePosition(value) {
    if (value == null) return null;
    const row = asObject(value);
    if (!row) return null;
    return {
      entryTime: asTime(row.entry_time),
      entryPrice: asNumber(row.entry_price),
      volume: asNumber(row.volume),
      cost: asNumber(row.cost),
      stopPrice: asNumber(row.stop_price),
      currentTargetPct: asNumber(row.current_target_pct),
      unrealizedPnl: asNumber(row.unrealized_pnl),
      unrealizedPct: asNumber(row.unrealized_pct),
    };
  }

  function normalizeStats(value) {
    const row = asObject(value) || {};
    return {
      totalTrades: asNumber(row.total_trades),
      wins: asNumber(row.wins),
      losses: asNumber(row.losses),
      winRate: asNumber(row.win_rate),
      netPnl: asNumber(row.net_pnl),
      netPnlPct: asNumber(row.net_pnl_pct),
      grossProfit: asNumber(row.gross_profit),
      grossLoss: asNumber(row.gross_loss),
      profitFactor: asNumber(row.profit_factor),
      avgWin: asNumber(row.avg_win),
      avgLoss: asNumber(row.avg_loss),
      expectancy: asNumber(row.expectancy),
      feesTotal: asNumber(row.fees_total),
      maxDrawdownPct: asNumber(row.max_drawdown_pct),
      todayPnl: asNumber(row.today_pnl),
      dailyLossLimit: asNumber(row.daily_loss_limit),
      exitReasons: asObject(row.exit_reasons),
    };
  }

  function normalizeTrades(value) {
    if (!Array.isArray(value)) return [];
    const trades = [];
    value.forEach((row, index) => {
      const item = asObject(row);
      if (!item) return;
      const exitTime = asTime(item.exit_time);
      const entryTime = asTime(item.entry_time);
      const pnl = asNumber(item.pnl);
      if (!asText(item.id) && !exitTime && !entryTime && pnl == null) return;
      trades.push({
        id: asText(item.id) || [entryTime, exitTime, pnl, index].join("|"),
        entryTime,
        exitTime,
        entryPrice: asNumber(item.entry_price),
        exitPrice: asNumber(item.exit_price),
        volume: asNumber(item.volume),
        pnl,
        pnlPct: asNumber(item.pnl_pct),
        fees: asNumber(item.fees),
        durationMin: asNumber(item.duration_min),
        exitReason: asText(item.exit_reason),
        analysis: asText(item.analysis),
      });
    });
    trades.sort((a, b) => {
      const aStamp = stamp(a.exitTime) ?? stamp(a.entryTime) ?? Number.NEGATIVE_INFINITY;
      const bStamp = stamp(b.exitTime) ?? stamp(b.entryTime) ?? Number.NEGATIVE_INFINITY;
      return bStamp - aStamp;
    });
    return trades;
  }

  function normalizeCurve(value) {
    if (!Array.isArray(value)) return [];
    const points = [];
    for (const row of value) {
      const item = asObject(row);
      if (!item) continue;
      const t = asTime(item.t);
      const equity = asNumber(item.equity);
      if (!t || equity == null) continue;
      points.push({ t, equity, ms: stamp(t) });
    }
    points.sort((a, b) => a.ms - b.ms);
    return points;
  }

  function normalizeDaily(value) {
    if (!Array.isArray(value)) return [];
    const rows = [];
    for (const row of value) {
      const item = asObject(row);
      if (!item) continue;
      const date = asText(item.date);
      const pnl = asNumber(item.pnl);
      if (!date || pnl == null) continue;
      rows.push({ date, pnl, trades: asNumber(item.trades) });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }

  function normalizeAnalyses(value) {
    if (!Array.isArray(value)) return [];
    const rows = [];
    for (const row of value) {
      const item = asObject(row);
      if (!item) continue;
      const title = asText(item.title);
      const text = asText(item.text);
      if (!title && !text) continue;
      const t = asTime(item.t);
      rows.push({
        t,
        title,
        text,
        ms: stamp(t) ?? Number.NEGATIVE_INFINITY,
      });
    }
    rows.sort((a, b) => b.ms - a.ms);
    return rows;
  }

  function mergeAnalyses(primary, fallback) {
    const seen = new Set();
    const rows = [];
    for (const row of [...primary, ...fallback]) {
      const key = (row.t || "") + "|" + (row.title || "");
      const tkey = "|" + (row.title || "");
      if (seen.has(key) || (row.title && seen.has(tkey))) continue;
      seen.add(key);
      if (row.title) seen.add(tkey);
      rows.push(row);
    }
    rows.sort((a, b) => b.ms - a.ms);
    return rows;
  }

  function normalize(raw) {
    const data = asObject(raw) || {};
    const bot = asObject(data.bot) || {};
    const price = asObject(data.price) || {};
    const balance = asObject(data.balance) || {};
    return {
      sample: data.sample === true,
      updatedAt: asTime(data.updated_at),
      pair: asText(data.pair),
      currency: asText(data.currency),
      startingCapital: asNumber(data.starting_capital),
      bot: {
        status: asText(bot.status),
        lastCycle: asTime(bot.last_cycle),
      },
      price: {
        last: asNumber(price.last),
        rsi: asNumber(price.rsi),
        tema: asNumber(price.tema),
        bbMid: asNumber(price.bb_mid),
      },
      balance: {
        quote: asNumber(balance.quote),
        base: asNumber(balance.base),
        equity: asNumber(balance.equity),
      },
      openPosition: Object.prototype.hasOwnProperty.call(data, "open_position")
        ? normalizePosition(data.open_position)
        : null,
      stats: normalizeStats(data.stats),
      equityCurve: normalizeCurve(data.equity_curve),
      dailyPnl: normalizeDaily(data.daily_pnl),
      trades: normalizeTrades(data.trades),
      analyses: normalizeAnalyses(data.analyses),
    };
  }

  function normalizeDailyMacd(raw) {
    const data = asObject(raw) || {};
    const bal = asObject(data.balance) || {};
    const ind = asObject(data.indicators) || {};
    const st = asObject(data.stats) || {};
    const strat = asObject(data.strategy) || {};
    const pos = asObject(data.position);
    const start = asNumber(data.starting_capital);
    const equity = asNumber(data.equity);
    const trades = [];
    (Array.isArray(data.trades) ? data.trades : []).forEach((row, index) => {
      const item = asObject(row);
      if (!item) return;
      const entryTime = asTime(item.entry_time);
      const exitTime = asTime(item.exit_time);
      const pnl = asNum(item.pnl_usdc);
      const dh = asNum(item.duration_h);
      const extra = [
        item.signal_candle ? `Сигнална свещ ${item.signal_candle}` : null,
        asNum(item.mfe_pct) != null ? `MFE ${formatPctPoints(asNum(item.mfe_pct), { signed: true })}` : null,
        asNum(item.mae_pct) != null ? `MAE ${formatPctPoints(asNum(item.mae_pct), { signed: true })}` : null,
      ].filter(Boolean).join(" · ");
      trades.push({
        id: item.trade_id != null ? `macd-${item.trade_id}` : [entryTime, exitTime, pnl, index].join("|"),
        entryTime,
        exitTime,
        entryPrice: asNum(item.entry_price),
        exitPrice: asNum(item.exit_price),
        volume: asNum(item.volume),
        pnl,
        pnlPct: asNum(item.pnl_pct),
        fees: asNum(item.fees_usdc),
        durationMin: dh == null ? null : dh * 60,
        exitReason: asText(item.exit_reason),
        analysis: extra || null,
      });
    });
    trades.sort((a, b) => (stamp(b.exitTime) ?? stamp(b.entryTime) ?? -Infinity) - (stamp(a.exitTime) ?? stamp(a.entryTime) ?? -Infinity));
    const pnls = trades.map((t) => t.pnl).filter((v) => v != null);
    const wins = pnls.filter((v) => v > 0);
    const losses = pnls.filter((v) => v <= 0);
    const gp = wins.reduce((a, b) => a + b, 0);
    const gl = losses.reduce((a, b) => a + b, 0);
    const reasons = {};
    trades.forEach((t) => { if (t.exitReason) reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1; });
    const fees = trades.map((t) => t.fees).filter((v) => v != null);
    // equity curve derived from closed trades (realized) + current equity
    const curve = [];
    const asc = trades.filter((t) => t.exitTime && t.pnl != null).slice().reverse();
    if (start != null) {
      let eq = start;
      const first = asc.length ? (asc[0].entryTime || asc[0].exitTime) : null;
      if (first) curve.push({ t: first, equity: eq, ms: stamp(first) });
      asc.forEach((t) => { eq += t.pnl; curve.push({ t: t.exitTime, equity: eq, ms: stamp(t.exitTime) }); });
    }
    const updated = asTime(data.updated);
    if (updated && equity != null) curve.push({ t: updated, equity, ms: stamp(updated) });
    curve.sort((a, b) => a.ms - b.ms);
    const dayMap = new Map();
    asc.forEach((t) => {
      const d = t.exitTime.slice(0, 10);
      const r = dayMap.get(d) || { date: d, pnl: 0, trades: 0 };
      r.pnl += t.pnl; r.trades += 1; dayMap.set(d, r);
    });
    let maxDd = null;
    if (curve.length > 1) {
      let peak = -Infinity; maxDd = 0;
      curve.forEach((p) => { peak = Math.max(peak, p.equity); maxDd = Math.max(maxDd, (peak - p.equity) / peak * 100); });
    }
    const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Sofia" });
    const netPnl = asNumber(st.total_pnl_usdc) ?? (pnls.length ? pnls.reduce((a, b) => a + b, 0) : null);
    const tradeCount = asNumber(st.trades) ?? (Array.isArray(data.trades) ? pnls.length : null);
    const winCount = asNumber(st.wins) ?? (pnls.length ? wins.length : null);
    const position = pos ? {
      entryTime: asTime(pos.entry_time),
      entryPrice: asNum(pos.entry_price),
      volume: asNum(pos.volume),
      cost: asNum(pos.cost_usdc),
      stopPrice: asNum(pos.stop_price),
      takeProfitPrice: asNum(pos.take_profit_price),
      currentTargetPct: asNumber(strat.take_profit_pct),
      unrealizedPnl: asNum(pos.unrealized_usdc),
      unrealizedPct: asNum(pos.unrealized_pct),
      signalCandle: asText(pos.signal_candle),
    } : null;
    return {
      kind: "daily_macd",
      sample: data.sample === true,
      updatedAt: updated,
      pair: asText(data.pair),
      currency: splitPair(asText(data.pair)).quote || "USDC",
      startingCapital: start,
      bot: { status: asText(data.status), lastCycle: updated, nextCheck: asTime(data.next_check) },
      price: {
        last: asNumber(data.last_price),
        macd: asNumber(ind.macd),
        macdSignal: asNumber(ind.macd_signal),
        hist: asNumber(ind.hist),
        candle: asText(ind.candle_utc_day),
        crossUp: typeof ind.cross_up === "boolean" ? ind.cross_up : null,
      },
      balance: { quote: asNumber(bal.USDC), base: asNumber(bal.BTC), equity },
      strategy: {
        stake: asNumber(strat.stake_usdc),
        tp: asNumber(strat.take_profit_pct),
        sl: asNumber(strat.stop_loss_pct),
      },
      openPosition: position,
      stats: {
        totalTrades: tradeCount,
        wins: winCount,
        losses: tradeCount != null && winCount != null ? tradeCount - winCount : null,
        winRate: asNumber(st.win_rate_pct) != null ? asNumber(st.win_rate_pct) / 100 : (pnls.length ? wins.length / pnls.length : null),
        netPnl,
        netPnlPct: asNumber(data.equity_change_pct) ?? (netPnl != null && start ? (netPnl / start) * 100 : null),
        grossProfit: pnls.length ? gp : null,
        grossLoss: pnls.length ? gl : null,
        profitFactor: gl < 0 ? gp / Math.abs(gl) : null,
        avgWin: wins.length ? gp / wins.length : null,
        avgLoss: losses.length ? gl / losses.length : null,
        expectancy: pnls.length ? (gp + gl) / pnls.length : null,
        feesTotal: fees.length ? fees.reduce((a, b) => a + b, 0) : null,
        maxDrawdownPct: maxDd,
        todayPnl: dayMap.has(todayKey) ? dayMap.get(todayKey).pnl : (pnls.length || Array.isArray(data.trades) ? 0 : null),
        dailyLossLimit: null,
        exitReasons: Object.keys(reasons).length ? reasons : (Array.isArray(data.trades) ? {} : null),
      },
      equityCurve: curve,
      dailyPnl: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      trades,
      analyses: [],
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    const node = $(id);
    if (!node) return;
    node.textContent = state.bot !== "rsi" && (value === "—" || value == null) ? NO_DATA : value;
  }

  function setTone(id, value) {
    const node = $(id);
    if (!node) return;
    node.classList.remove("positive", "negative", "flat");
    node.classList.add(tone(value));
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value != null) node.setAttribute(key, String(value));
    });
    return node;
  }

  function chartMessage(host, message) {
    host.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "empty";
    paragraph.textContent = message;
    host.append(paragraph);
  }

  function paddedExtent(values, includeZero) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (includeZero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (min === max) {
      const pad = Math.abs(min) * 0.02 || 1;
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }

  function makeSvg(label) {
    const svg = svgEl("svg", {
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      role: "img",
      "aria-label": label,
    });
    return svg;
  }

  function yMapper(min, max, top, height) {
    const span = max - min || 1;
    return (value) => top + (1 - (value - min) / span) * height;
  }

  function drawYAxis(svg, min, max, top, height) {
    const span = max - min;
    const y = yMapper(min, max, top, height);
    for (let i = 0; i < 4; i += 1) {
      const value = min + (span * i) / 3;
      const yPos = y(value);
      svg.append(svgEl("line", {
        x1: 52,
        x2: VB_W - 10,
        y1: yPos.toFixed(2),
        y2: yPos.toFixed(2),
        stroke: "rgba(244, 241, 234, 0.08)",
      }));
      const label = svgEl("text", {
        x: 46,
        y: (yPos + 3).toFixed(2),
        "text-anchor": "end",
        fill: "var(--faint)",
        "font-size": "10",
      });
      label.textContent = formatAxis(value, span);
      svg.append(label);
    }
  }

  function renderEquity(points, starting) {
    const host = $("equity-chart");
    if (!points.length) {
      chartMessage(host, "Няма данни за кривата");
      return;
    }
    const pad = { l: 52, r: 10, t: 14, b: 28 };
    const extent = paddedExtent(points.map((point) => point.equity).concat(starting == null ? [] : [starting]), false);
    const innerH = VB_H - pad.t - pad.b;
    const y = yMapper(extent.min, extent.max, pad.t, innerH);
    const minX = points[0].ms;
    const maxX = points[points.length - 1].ms;
    const xAt = (ms) => {
      const innerW = VB_W - pad.l - pad.r;
      if (maxX === minX) return pad.l + innerW / 2;
      return pad.l + ((ms - minX) / (maxX - minX)) * innerW;
    };
    const plotted = points.map((point) => ({ x: xAt(point.ms), y: y(point.equity), point }));
    const up = points[points.length - 1].equity >= points[0].equity;
    const color = up ? "var(--good)" : "var(--bad)";
    const svg = makeSvg(`Крива на капитала от ${formatQuote(points[0].equity)} до ${formatQuote(points[points.length - 1].equity)}`);
    drawYAxis(svg, extent.min, extent.max, pad.t, innerH);

    if (starting != null && starting >= extent.min && starting <= extent.max) {
      const yStart = y(starting);
      svg.append(svgEl("line", {
        x1: pad.l,
        x2: VB_W - pad.r,
        y1: yStart.toFixed(2),
        y2: yStart.toFixed(2),
        stroke: "var(--gold)",
        "stroke-dasharray": "3 4",
        "stroke-opacity": "0.7",
      }));
    }

    const line = plotted.map((item, index) => `${index === 0 ? "M" : "L"}${item.x.toFixed(2)} ${item.y.toFixed(2)}`).join(" ");
    if (plotted.length > 1) {
      const id = `eq-fill-${gradientSeq += 1}`;
      const defs = svgEl("defs");
      const gradient = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" });
      gradient.append(svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.35" }));
      gradient.append(svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
      defs.append(gradient);
      svg.append(defs);
      const baseY = (pad.t + innerH).toFixed(2);
      const area = `${line} L${plotted[plotted.length - 1].x.toFixed(2)} ${baseY} L${plotted[0].x.toFixed(2)} ${baseY} Z`;
      svg.append(svgEl("path", { d: area, fill: `url(#${id})` }));
    }
    svg.append(svgEl("path", {
      d: line,
      fill: "none",
      stroke: color,
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    }));
    const last = plotted[plotted.length - 1];
    svg.append(svgEl("circle", {
      cx: last.x.toFixed(2),
      cy: last.y.toFixed(2),
      r: "3.5",
      fill: color,
    }));
    const firstLabel = svgEl("text", {
      x: plotted[0].x.toFixed(2),
      y: VB_H - 8,
      "text-anchor": "start",
      fill: "var(--faint)",
      "font-size": "10",
    });
    firstLabel.textContent = (formatWhen(points[0].t) || "").split(",")[0];
    const lastLabel = svgEl("text", {
      x: last.x.toFixed(2),
      y: VB_H - 8,
      "text-anchor": "end",
      fill: "var(--faint)",
      "font-size": "10",
    });
    lastLabel.textContent = (formatWhen(points[points.length - 1].t) || "").split(",")[0];
    svg.append(firstLabel, lastLabel);
    host.replaceChildren(svg);
  }

  function renderDaily(points, currency) {
    const host = $("daily-chart");
    if (!points.length) {
      chartMessage(host, "Няма дневни данни");
      return;
    }
    const pad = { l: 52, r: 8, t: 12, b: 32 };
    const extent = paddedExtent(points.map((point) => point.pnl), true);
    const innerH = VB_H - pad.t - pad.b;
    const y = yMapper(extent.min, extent.max, pad.t, innerH);
    const svg = makeSvg(`Дневен резултат за ${points.length} дни`);
    drawYAxis(svg, extent.min, extent.max, pad.t, innerH);
    const zero = y(0);
    svg.append(svgEl("line", {
      x1: pad.l,
      x2: VB_W - pad.r,
      y1: zero.toFixed(2),
      y2: zero.toFixed(2),
      stroke: "rgba(244, 241, 234, 0.28)",
    }));
    const innerW = VB_W - pad.l - pad.r;
    const slot = innerW / points.length;
    const barW = Math.max(2, slot * 0.62);
    const step = points.length <= 12 ? 1 : Math.ceil(points.length / 8);
    points.forEach((point, index) => {
      const x = pad.l + slot * index + (slot - barW) / 2;
      const yVal = y(point.pnl);
      const top = Math.min(yVal, zero);
      const height = Math.max(1.5, Math.abs(yVal - zero));
      const rect = svgEl("rect", {
        x: x.toFixed(2),
        y: top.toFixed(2),
        width: barW.toFixed(2),
        height: height.toFixed(2),
        rx: "2",
        fill: point.pnl >= 0 ? "var(--good)" : "var(--bad)",
      });
      const title = svgEl("title");
      const trades = point.trades == null ? "" : ` · ${formatInt(point.trades)} сделки`;
      title.textContent = `${point.date}: ${withCurrency(formatSignedQuote(point.pnl), currency)}${trades}`;
      rect.append(title);
      svg.append(rect);
      if (index % step === 0 || index === points.length - 1) {
        const label = svgEl("text", {
          x: (pad.l + slot * index + slot / 2).toFixed(2),
          y: VB_H - 8,
          "text-anchor": "middle",
          fill: "var(--faint)",
          "font-size": "9",
        });
        label.textContent = formatDayLabel(point.date);
        svg.append(label);
      }
    });
    host.replaceChildren(svg);
  }

  function renderPosition(position, currency) {
    const pnl = $("position-pnl");
    const host = $("position-body");
    host.replaceChildren();
    if (!position) {
      pnl.hidden = true;
      pnl.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Няма отворена позиция";
      host.append(empty);
      return;
    }
    pnl.hidden = false;
    pnl.className = `pos-pnl ${tone(position.unrealizedPnl)}`;
    const strong = document.createElement("strong");
    strong.textContent = withCurrency(formatSignedQuote(position.unrealizedPnl), currency);
    const small = document.createElement("span");
    small.textContent = formatPctPoints(position.unrealizedPct, { signed: true });
    pnl.replaceChildren(strong, small);

    const kv = document.createElement("dl");
    kv.className = "kv";
    const rows = [
      ["Вход", position.entryTime ? (formatWhen(position.entryTime) || "—") : "—"],
      ["Цена", formatQuote(position.entryPrice)],
      ["Обем", position.volume == null ? "—" : `${formatBtc(position.volume)} BTC`],
      ["Стойност", withCurrency(formatQuote(position.cost), currency)],
      ["Стоп", formatQuote(position.stopPrice)],
      ["Цел", formatPctPoints(position.currentTargetPct)],
    ];
    if (position.takeProfitPrice != null) rows.push(["Цена за цел", formatQuote(position.takeProfitPrice)]);
    if (position.signalCandle) rows.push(["Сигнална свещ", position.signalCandle]);
    if (state.bot !== "rsi") rows.forEach((r) => { if (r[1] === "—") r[1] = NO_DATA; });
    rows.forEach(([label, value]) => {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      wrap.append(dt, dd);
      kv.append(wrap);
    });
    host.append(kv);
  }

  function exitLabel(reason) {
    if (!reason) return "—";
    const known = exitOrder().find(([key]) => key === reason);
    return known ? known[1] : reason;
  }

  function renderTrades(trades, currency) {
    const host = $("trades");
    const open = new Set([...host.querySelectorAll("details[open]")].map((node) => node.dataset.id));
    host.replaceChildren();
    if (!trades.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Няма сделки";
      host.append(empty);
      return;
    }
    trades.forEach((trade) => {
      const details = document.createElement("details");
      details.className = "trade";
      details.dataset.id = trade.id;
      if (open.has(trade.id)) details.open = true;
      const summary = document.createElement("summary");
      const time = document.createElement("span");
      time.className = "trade-time";
      time.textContent = formatWhen(trade.exitTime || trade.entryTime) || "—";
      const pnl = document.createElement("span");
      pnl.className = `trade-pnl ${tone(trade.pnl)}`;
      pnl.textContent = withCurrency(formatSignedQuote(trade.pnl), currency);
      const meta = document.createElement("span");
      meta.className = "trade-meta";
      meta.textContent = `${formatQuote(trade.entryPrice)} → ${formatQuote(trade.exitPrice)} · ${exitLabel(trade.exitReason)} · ${formatDuration(trade.durationMin)}`;
      summary.append(time, pnl, meta);
      const body = document.createElement("div");
      body.className = "trade-body";
      const facts = document.createElement("p");
      facts.className = "trade-facts";
      const bits = [
        trade.volume == null ? null : `Обем ${formatBtc(trade.volume)} BTC`,
        trade.fees == null ? null : `Такси ${formatQuote(trade.fees)}${currency ? ` ${currency}` : ""}`,
        trade.pnlPct == null ? null : `Резултат ${formatPctPoints(trade.pnlPct, { signed: true })}`,
      ].filter(Boolean);
      facts.textContent = bits.join(" · ") || "Няма допълнителни числа";
      const analysis = document.createElement("p");
      analysis.className = "trade-analysis";
      analysis.textContent = trade.analysis || "Няма записан анализ.";
      body.append(facts, analysis);
      details.append(summary, body);
      host.append(details);
    });
  }

  function mdInline(parent, src) {
    const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      if (m.index > last) parent.append(document.createTextNode(src.slice(last, m.index)));
      let node;
      if (m[2] != null || m[3] != null) { node = document.createElement("strong"); node.textContent = m[2] ?? m[3]; }
      else if (m[4] != null) { node = document.createElement("code"); node.textContent = m[4]; }
      else { node = document.createElement("em"); node.textContent = m[5]; }
      parent.append(node);
      last = re.lastIndex;
    }
    if (last < src.length) parent.append(document.createTextNode(src.slice(last)));
  }

  function parseMarkdown(src) {
    const blocks = [];
    let para = null;
    let list = null;
    const flush = () => { para = null; list = null; };
    for (const raw of String(src || "").replace(/\r/g, "").split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: "h", level: m[1].length, text: m[2] }); continue; }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flush(); blocks.push({ type: "hr" }); continue; }
      if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
        const ordered = /\d/.test(m[1]);
        para = null;
        if (!list || list.ordered !== ordered) { list = { type: "list", ordered, items: [] }; blocks.push(list); }
        list.items.push(m[2]);
        continue;
      }
      if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
      list = null;
      if (!para) { para = { type: "p", lines: [] }; blocks.push(para); }
      para.lines.push(line.trim());
    }
    return blocks;
  }

  function renderMarkdown(host, src, skipTitle) {
    let blocks = parseMarkdown(src);
    if (skipTitle && blocks[0] && blocks[0].type === "h" && blocks[0].text.trim() === skipTitle.trim()) blocks = blocks.slice(1);
    blocks.forEach((b) => {
      let node;
      if (b.type === "h") { node = document.createElement("h" + Math.min(6, b.level + 2)); mdInline(node, b.text); }
      else if (b.type === "hr") node = document.createElement("hr");
      else if (b.type === "list") {
        node = document.createElement(b.ordered ? "ol" : "ul");
        b.items.forEach((it) => { const li = document.createElement("li"); mdInline(li, it); node.append(li); });
      } else {
        node = document.createElement("p");
        b.lines.forEach((l, i) => { if (i) node.append(document.createElement("br")); mdInline(node, l); });
      }
      host.append(node);
    });
  }

  function analysisLabel(row) {
    const when = row.t ? formatWhen(row.t) : null;
    return when || row.title || "Анализ";
  }

  function buildAnalysis(row) {
    const article = document.createElement("article");
    article.className = "note analysis";
    const heading = document.createElement("h3");
    heading.textContent = row.title || "Анализ";
    const time = document.createElement("time");
    if (row.t) time.dateTime = row.t;
    time.textContent = row.t ? (formatWhen(row.t) || "—") : "—";
    const body = document.createElement("div");
    body.className = "md";
    if (row.text) renderMarkdown(body, row.text, row.title);
    else body.textContent = "—";
    article.append(heading, time, body);
    return article;
  }

  let analysesSelected = null;

  function renderAnalyses(rows) {
    const host = $("analyses");
    host.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Няма анализи";
      host.append(empty);
      return;
    }
    const keyOf = (row, i) => row.t || "idx-" + i;
    let idx = rows.findIndex((r, i) => keyOf(r, i) === analysesSelected);
    if (idx < 0) { idx = 0; analysesSelected = null; }
    const view = document.createElement("div");
    view.className = "analysis-view";
    if (rows.length > 1) {
      const bar = document.createElement("div");
      bar.className = "analysis-filter";
      const label = document.createElement("label");
      label.htmlFor = "analysis-select";
      label.textContent = "Анализ от:";
      const select = document.createElement("select");
      select.id = "analysis-select";
      rows.forEach((row, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = analysisLabel(row) + (i === 0 ? " (най-нов)" : "");
        select.append(opt);
      });
      select.value = String(idx);
      select.addEventListener("change", () => {
        const i = Number(select.value);
        analysesSelected = i === 0 ? null : keyOf(rows[i], i);
        view.replaceChildren(buildAnalysis(rows[i]));
      });
      bar.append(label, select);
      host.append(bar);
    }
    view.append(buildAnalysis(rows[idx]));
    host.append(view);
    if (rows.length > 1) {
      const older = document.createElement("details");
      older.className = "analysis-older";
      const summary = document.createElement("summary");
      summary.textContent = "По-стари анализи (" + (rows.length - 1) + ")";
      const list = document.createElement("ul");
      rows.slice(1).forEach((row, j) => {
        const i = j + 1;
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = analysisLabel(row);
        btn.addEventListener("click", () => {
          analysesSelected = keyOf(row, i);
          const sel = $("analysis-select");
          if (sel) sel.value = String(i);
          view.replaceChildren(buildAnalysis(row));
          view.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        li.append(btn);
        list.append(li);
      });
      older.append(summary, list);
      host.append(older);
    }
  }

  function exitOrder() {
    return state.bot === "daily_macd" ? EXIT_ORDER_MACD : EXIT_ORDER;
  }

  function renderExits(reasons) {
    const host = $("exits");
    host.replaceChildren();
    const order = exitOrder();
    const entries = order.map(([key, label, color]) => ({
      key,
      label,
      color,
      n: reasons ? asNumber(reasons[key]) : null,
    }));
    if (reasons) {
      Object.entries(reasons).forEach(([key, value]) => {
        if (order.some(([known]) => known === key)) return;
        entries.push({ key, label: key, color: "var(--faint)", n: asNumber(value) });
      });
    }
    const total = entries.reduce((sum, entry) => sum + (entry.n != null && entry.n > 0 ? entry.n : 0), 0);
    if (total > 0) {
      const bar = document.createElement("div");
      bar.className = "exit-bar";
      bar.setAttribute("aria-hidden", "true");
      entries.forEach((entry) => {
        if (entry.n == null || entry.n <= 0) return;
        const segment = document.createElement("span");
        segment.style.width = `${(entry.n / total) * 100}%`;
        segment.style.background = entry.color;
        bar.append(segment);
      });
      host.append(bar);
    }
    const list = document.createElement("div");
    list.className = "exit-list";
    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "exit-row";
      const name = document.createElement("span");
      name.className = "exit-name";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = entry.color;
      const label = document.createElement("span");
      label.textContent = entry.label;
      name.append(swatch, label);
      const count = document.createElement("strong");
      count.textContent = entry.n == null ? (state.bot !== "rsi" ? NO_DATA : "—") : formatInt(entry.n);
      row.append(name, count);
      list.append(row);
    });
    host.append(list);
  }

  function applyFreshness(data) {
    const staleMs = (BOTS[state.bot] || BOTS.rsi).staleMs;
    const info = freshness(data.updatedAt, null, staleMs);
    const line = $("freshness");
    const note = $("stale-note");
    const time = $("updated-at");
    const stale = info.level !== "ok";
    if (line) line.classList.toggle("is-stale", stale);
    if (time) {
      time.textContent = data.updatedAt ? (formatWhen(data.updatedAt) || "—") : "—";
      if (data.updatedAt) time.setAttribute("datetime", data.updatedAt);
      else time.removeAttribute("datetime");
    }
    if (note) {
      note.hidden = !stale;
      note.textContent = info.level === "old"
        ? `Данните са по-стари от ${Math.round(staleMs / 60000)} минути`
        : "Няма час на обновяване";
    }
  }

  function applyStatus(status) {
    const pill = $("status-pill");
    if (!pill) return;
    const known = status && Object.prototype.hasOwnProperty.call(STATUS, status);
    pill.dataset.status = known ? status : "unknown";
    pill.textContent = known ? STATUS[status] : (status || "Неизвестен");
  }

  function render(data) {
    const currency = data.currency || "";
    const assets = splitPair(data.pair);
    text("pair", data.pair || "—");
    const botLabel = (BOTS[state.bot] || BOTS.rsi).label;
    document.title = data.pair ? `${data.pair} · ${botLabel} · Хартиена търговия` : "Хартиена търговия";
    text("pair", data.pair ? `${data.pair} · ${botLabel}` : botLabel);
    const banner = $("sample-banner");
    if (banner) banner.hidden = !data.sample;
    text("equity", formatQuote(data.balance.equity));
    text("equity-unit", currency || "—");
    text("starting", withCurrency(formatQuote(data.startingCapital), currency));
    text("net-pnl", withCurrency(formatSignedQuote(data.stats.netPnl), currency));
    setTone("net-pnl", data.stats.netPnl);
    text("net-pnl-pct", formatPctPoints(data.stats.netPnlPct, { signed: true }));
    setTone("net-pnl-pct", data.stats.netPnlPct);
    text("today-pnl", withCurrency(formatSignedQuote(data.stats.todayPnl), currency));
    setTone("today-pnl", data.stats.todayPnl);
    text("daily-limit", withCurrency(formatQuote(data.stats.dailyLossLimit), currency));
    applyFreshness(data);
    const cycle = $("last-cycle");
    if (cycle) {
      cycle.textContent = data.bot.lastCycle ? (formatWhen(data.bot.lastCycle) || "—") : "—";
      if (data.bot.lastCycle) cycle.setAttribute("datetime", data.bot.lastCycle);
      else cycle.removeAttribute("datetime");
    }
    applyStatus(data.bot.status);

    const macd = data.kind === "daily_macd";
    text("lbl-today", macd ? "Днес (затворени)" : "Днес");
    text("lbl-limit", macd ? "Залог" : "Лимит");
    if (macd) text("daily-limit", withCurrency(formatQuote(data.strategy.stake), currency));
    text("lbl-cycle", macd ? "Следваща дневна проверка" : "Последен цикъл");
    if (macd && cycle) {
      cycle.textContent = data.bot.nextCheck ? (formatWhen(data.bot.nextCheck) || NO_DATA) : NO_DATA;
    }
    text("lbl-i1", "Цена");
    text("lbl-i2", macd ? "MACD" : "RSI 14");
    text("lbl-i3", macd ? "Сигнал" : "TEMA 9");
    text("lbl-i4", macd ? "Хистограма" : "BB среда");
    const vals = macd
      ? [data.price.last, data.price.macd, data.price.macdSignal, data.price.hist]
      : [data.price.last, data.price.rsi, data.price.tema, data.price.bbMid];
    const hasPrice = vals.some((value) => value != null);
    const indicators = $("indicators");
    if (indicators) indicators.hidden = !hasPrice && !macd;
    text("price-last", formatQuote(vals[0]));
    text("price-rsi", formatQuote(vals[1]));
    text("price-tema", formatQuote(vals[2]));
    text("price-bb", formatQuote(vals[3]));
    const note = $("indicator-note");
    if (note) {
      note.hidden = !macd;
      note.textContent = macd
        ? `Дневна свещ: ${data.price.candle || NO_DATA} · пресичане нагоре: ${data.price.crossUp == null ? NO_DATA : (data.price.crossUp ? "да" : "не")}`
        : "";
    }
    const foot = $("footer-note");
    if (foot) foot.textContent = (BOTS[state.bot] || BOTS.rsi).footer;

    const hasBalance = macd || data.balance.quote != null || data.balance.base != null;
    const balance = $("balance");
    if (balance) balance.hidden = !hasBalance;
    text("bal-quote-label", assets.quote || currency || "Котировка");
    text("bal-base-label", assets.base || "База");
    text("bal-quote", formatQuote(data.balance.quote));
    text("bal-base", formatBtc(data.balance.base));

    renderPosition(data.openPosition, currency);
    renderEquity(data.equityCurve, data.startingCapital);
    renderDaily(data.dailyPnl, currency);

    text("stat-trades", formatInt(data.stats.totalTrades));
    text("stat-winrate", formatWinRate(data.stats.winRate));
    text("stat-wins", formatInt(data.stats.wins));
    text("stat-losses", formatInt(data.stats.losses));
    text("stat-pf", formatFactor(data.stats.profitFactor));
    setTone("stat-pf", data.stats.profitFactor == null ? null : data.stats.profitFactor - 1);
    text("stat-exp", formatSignedQuote(data.stats.expectancy));
    setTone("stat-exp", data.stats.expectancy);
    text("stat-avg-win", formatSignedQuote(data.stats.avgWin));
    setTone("stat-avg-win", data.stats.avgWin);
    text("stat-avg-loss", formatAvgLoss(data.stats.avgLoss));
    setTone("stat-avg-loss", data.stats.avgLoss == null ? null : -Math.abs(data.stats.avgLoss));
    text("stat-gross-profit", formatQuote(data.stats.grossProfit));
    setTone("stat-gross-profit", data.stats.grossProfit);
    text("stat-gross-loss", formatMagnitude(data.stats.grossLoss));
    setTone("stat-gross-loss", data.stats.grossLoss == null ? null : -Math.abs(data.stats.grossLoss));
    text("stat-fees", formatQuote(data.stats.feesTotal));
    text("stat-dd", formatPctPoints(data.stats.maxDrawdownPct));
    renderExits(data.stats.exitReasons);
    renderTrades(data.trades, currency);
    renderAnalyses(data.analyses);
  }

  function showError(hadData) {
    const banner = $("error-banner");
    if (!banner) return;
    banner.hidden = false;
    banner.textContent = hadData
      ? "Данните не можаха да се обновят. Показани са последните успешни."
      : "Данните не можаха да се заредят. Нов опит след 60 секунди.";
  }

  function clearError() {
    const banner = $("error-banner");
    if (!banner) return;
    banner.hidden = true;
    banner.textContent = "";
  }

  async function load() {
    if (state.inFlight) return;
    state.inFlight = true;
    const bot = state.bot;
    const cfg = BOTS[bot] || BOTS.rsi;
    const seq = state.seq;
    const button = $("refresh");
    if (button) button.disabled = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeout = setTimeout(() => {
      if (controller) controller.abort();
    }, 20000);
    try {
      let json;
      try {
        json = await fetchJson(jsonUrl(cfg.file), controller ? controller.signal : undefined);
      } catch (error) {
        if (!error || error.status !== 404 || !cfg.sample) throw error;
        json = await fetchJson(jsonUrl(cfg.sample), controller ? controller.signal : undefined);
      }
      if (!asObject(json)) throw new Error("shape");
      const data = bot === "daily_macd" ? normalizeDailyMacd(json) : normalize(json);
      let extra = null;
      try {
        extra = await fetchJson(jsonUrl(cfg.analyses), controller ? controller.signal : undefined);
      } catch (e) { extra = null; }
      if (seq !== state.seq) return;
      data.analyses = mergeAnalyses(normalizeAnalyses(extra), data.analyses);
      const serialized = JSON.stringify([bot, json, extra]);
      state.data = data;
      if (serialized !== state.serialized) {
        state.serialized = serialized;
        render(data);
      } else {
        applyFreshness(data);
      }
      clearError();
    } catch (error) {
      if (seq === state.seq) showError(state.data != null);
    } finally {
      clearTimeout(timeout);
      state.inFlight = false;
      if (button) button.disabled = false;
      if (seq !== state.seq) load();
    }
  }

  function selectBot(bot, push) {
    if (!Object.prototype.hasOwnProperty.call(BOTS, bot)) bot = "rsi";
    state.bot = bot;
    state.seq += 1;
    state.serialized = null;
    state.data = null;
    analysesSelected = null;
    try { localStorage.setItem("dashBot", bot); } catch (e) { /* ignore */ }
    if (push) {
      try {
        const url = new URL(location.href);
        url.searchParams.set("bot", bot);
        history.replaceState(null, "", url.href);
      } catch (e) { /* ignore */ }
    }
    const sel = $("bot-select");
    if (sel && sel.value !== bot) sel.value = bot;
    document.documentElement.dataset.bot = bot;
    clearError();
    ["position-body", "trades", "analyses"].forEach((id) => {
      const host = $(id);
      if (host) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Зареждане…";
        host.replaceChildren(p);
      }
    });
    load();
  }

  function boot() {
    const button = $("refresh");
    if (button) button.addEventListener("click", () => { load(); });
    let stored = null;
    try { stored = localStorage.getItem("dashBot"); } catch (e) { stored = null; }
    const sel = $("bot-select");
    if (sel) sel.addEventListener("change", () => selectBot(sel.value, true));
    selectBot(resolveBot(location.search, stored), /[?&]bot=/.test(location.search));
    setInterval(() => { load(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load();
    });
  }

  globalThis.PaperDash = {
    STALE_MS,
    REFRESH_MS,
    normalize,
    normalizeDailyMacd,
    resolveBot,
    BOTS,
    freshness,
    formatQuote,
    formatSignedQuote,
    formatBtc,
    formatPctPoints,
    formatWinRate,
    formatWhen,
    formatDuration,
    formatAvgLoss,
    directoryHref,
    parseMarkdown,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
