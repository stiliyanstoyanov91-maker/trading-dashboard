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

  const state = {
    inFlight: false,
    serialized: null,
    data: null,
  };

  let gradientSeq = 0;

  function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  function dataUrl() {
    const root = directoryHref(document.baseURI || location.href);
    const url = new URL("data/dashboard.json", root);
    url.searchParams.set("t", String(Date.now()));
    return url.href;
  }

  function freshness(iso, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    if (!iso) return { level: "missing" };
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return { level: "invalid" };
    if (now - ms > STALE_MS) return { level: "old" };
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

  function $(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
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
    const known = EXIT_ORDER.find(([key]) => key === reason);
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
    rows.forEach((row) => {
      const article = document.createElement("article");
      article.className = "note";
      const heading = document.createElement("h3");
      heading.textContent = row.title || "Анализ";
      const time = document.createElement("time");
      if (row.t) time.dateTime = row.t;
      time.textContent = row.t ? (formatWhen(row.t) || "—") : "—";
      const paragraph = document.createElement("p");
      paragraph.textContent = row.text || "—";
      article.append(heading, time, paragraph);
      host.append(article);
    });
  }

  function renderExits(reasons) {
    const host = $("exits");
    host.replaceChildren();
    const entries = EXIT_ORDER.map(([key, label, color]) => ({
      key,
      label,
      color,
      n: reasons ? asNumber(reasons[key]) : null,
    }));
    if (reasons) {
      Object.entries(reasons).forEach(([key, value]) => {
        if (EXIT_ORDER.some(([known]) => known === key)) return;
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
      count.textContent = entry.n == null ? "—" : formatInt(entry.n);
      row.append(name, count);
      list.append(row);
    });
    host.append(list);
  }

  function applyFreshness(data) {
    const info = freshness(data.updatedAt);
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
        ? "Данните са по-стари от 15 минути"
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
    document.title = data.pair ? `${data.pair} · Хартиена търговия` : "Хартиена търговия";
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

    const hasPrice = [data.price.last, data.price.rsi, data.price.tema, data.price.bbMid].some((value) => value != null);
    const indicators = $("indicators");
    if (indicators) indicators.hidden = !hasPrice;
    text("price-last", formatQuote(data.price.last));
    text("price-rsi", formatQuote(data.price.rsi));
    text("price-tema", formatQuote(data.price.tema));
    text("price-bb", formatQuote(data.price.bbMid));

    const hasBalance = data.balance.quote != null || data.balance.base != null;
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
    const button = $("refresh");
    if (button) button.disabled = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeout = setTimeout(() => {
      if (controller) controller.abort();
    }, 20000);
    try {
      const response = await fetch(dataUrl(), {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!asObject(json)) throw new Error("shape");
      const serialized = JSON.stringify(json);
      const data = normalize(json);
      state.data = data;
      if (serialized !== state.serialized) {
        state.serialized = serialized;
        render(data);
      } else {
        applyFreshness(data);
      }
      clearError();
    } catch (error) {
      showError(state.data != null);
    } finally {
      clearTimeout(timeout);
      state.inFlight = false;
      if (button) button.disabled = false;
    }
  }

  function boot() {
    const button = $("refresh");
    if (button) button.addEventListener("click", () => { load(); });
    load();
    setInterval(() => { load(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load();
    });
  }

  globalThis.PaperDash = {
    STALE_MS,
    REFRESH_MS,
    normalize,
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
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
