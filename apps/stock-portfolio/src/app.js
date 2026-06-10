const STORAGE_KEY = "stock-pwa-holdings";
const REFRESH_INTERVAL_MS = 1_200;

const state = {
  holdings: [],
  quotes: new Map(),
  wakeLock: null,
  refreshTimer: null,
  isRefreshing: false,
};

const elements = {
  form: document.querySelector("#holdingForm"),
  symbolInput: document.querySelector("#symbolInput"),
  sharesInput: document.querySelector("#sharesInput"),
  costInput: document.querySelector("#costInput"),
  holdingsBody: document.querySelector("#holdingsBody"),
  emptyState: document.querySelector("#emptyState"),
  refreshButton: document.querySelector("#refreshButton"),
  wakeLockButton: document.querySelector("#wakeLockButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  statusText: document.querySelector("#statusText"),
  totalValue: document.querySelector("#totalValue"),
  totalCost: document.querySelector("#totalCost"),
  totalPnl: document.querySelector("#totalPnl"),
  dayChange: document.querySelector("#dayChange"),
};

function loadHoldings() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.holdings = [
      { symbol: "AAPL", shares: 1, cost: 150 },
      { symbol: "NVDA", shares: 1, cost: 100 },
    ];
    saveHoldings();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.holdings = Array.isArray(parsed)
      ? parsed.filter((item) => item.symbol && Number.isFinite(item.shares) && Number.isFinite(item.cost))
      : [];
  } catch (error) {
    console.error("读取本地持仓失败", error);
    state.holdings = [];
  }
}

function saveHoldings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.holdings));
}

function normalizeSymbol(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function quoteKey(symbol) {
  return `us${symbol.replace(/[^A-Z0-9]/g, "")}`;
}

function quoteGlobalName(symbol) {
  return `v_${quoteKey(symbol)}`;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "$--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}%`;
}

function signedClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function setStatus(message = "") {
  elements.statusText.textContent = message;
  elements.statusText.hidden = !message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function parseTencentQuote(symbol, raw) {
  const parts = raw.split("~");
  const price = Number(parts[3]);
  const previousClose = Number(parts[4]);
  const explicitChange = Number(parts[31]);
  const explicitPercent = Number(parts[32]);
  const change = Number.isFinite(explicitChange) ? explicitChange : price - previousClose;
  const percent = Number.isFinite(explicitPercent) ? explicitPercent : (change / previousClose) * 100;

  return {
    symbol,
    name: parts[46] || parts[1] || symbol,
    price,
    previousClose,
    change,
    percent,
    updatedAt: parts[30] || "",
  };
}

function loadTencentQuotes(symbols) {
  return new Promise((resolve, reject) => {
    const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
    if (uniqueSymbols.length === 0) {
      resolve([]);
      return;
    }

    const callbackId = `quoteScript-${Date.now()}`;
    const script = document.createElement("script");
    script.id = callbackId;
    script.src = `https://qt.gtimg.cn/q=${uniqueSymbols.map(quoteKey).join(",")}&_=${Date.now()}`;
    script.async = true;

    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("腾讯行情接口响应超时"));
    }, 12_000);

    script.onload = () => {
      window.clearTimeout(timeout);
      script.remove();

      const quotes = uniqueSymbols
        .map((symbol) => {
          const globalName = quoteGlobalName(symbol);
          const raw = window[globalName];
          delete window[globalName];
          if (!raw || typeof raw !== "string") return null;
          return parseTencentQuote(symbol, raw);
        })
        .filter((quote) => quote && Number.isFinite(quote.price));

      resolve(quotes);
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("腾讯行情接口加载失败"));
    };

    document.head.append(script);
  });
}

async function refreshQuotes() {
  if (state.isRefreshing) {
    return;
  }

  state.isRefreshing = true;
  window.clearTimeout(state.refreshTimer);
  elements.refreshButton.disabled = true;

  try {
    if (state.holdings.length === 0) {
      setStatus("请先添加持仓");
      return;
    }

    const quotes = await loadTencentQuotes(state.holdings.map((holding) => holding.symbol));
    quotes.forEach((quote) => state.quotes.set(quote.symbol, quote));
    setStatus(quotes.length ? "" : "未获取到行情，请检查股票代码");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  } finally {
    state.isRefreshing = false;
    elements.refreshButton.disabled = false;
    render();
    scheduleAutoRefresh();
  }
}

function upsertHolding(symbol, shares, cost) {
  const existing = state.holdings.find((holding) => holding.symbol === symbol);
  if (existing) {
    existing.shares = shares;
    existing.cost = cost;
  } else {
    state.holdings.push({ symbol, shares, cost });
  }

  state.holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  saveHoldings();
}

function removeHolding(symbol) {
  state.holdings = state.holdings.filter((holding) => holding.symbol !== symbol);
  state.quotes.delete(symbol);
  saveHoldings();
  render();
}

function renderSummary(rows) {
  const summary = rows.reduce(
    (total, row) => {
      total.value += row.value;
      total.cost += row.totalCost;
      total.pnl += row.pnl;
      total.dayChange += row.dayChange;
      return total;
    },
    { value: 0, cost: 0, pnl: 0, dayChange: 0 },
  );

  elements.totalValue.textContent = formatMoney(summary.value);
  elements.totalCost.textContent = formatMoney(summary.cost);
  elements.totalPnl.textContent = `${summary.pnl >= 0 ? "+" : ""}${formatMoney(summary.pnl)}`;
  elements.totalPnl.className = signedClass(summary.pnl);
  elements.dayChange.textContent = `${summary.dayChange >= 0 ? "+" : ""}${formatMoney(summary.dayChange)}`;
  elements.dayChange.className = signedClass(summary.dayChange);
}

function render() {
  elements.emptyState.style.display = state.holdings.length ? "none" : "grid";

  const rows = state.holdings.map((holding) => {
    const quote = state.quotes.get(holding.symbol);
    const price = quote?.price ?? Number.NaN;
    const value = price * holding.shares;
    const totalCost = holding.cost * holding.shares;
    const pnl = value - totalCost;
    const dayChange = (quote?.change ?? 0) * holding.shares;
    return { holding, quote, price, value, totalCost, pnl, dayChange };
  });

  elements.holdingsBody.innerHTML = rows
    .map(({ holding, quote, price, value, pnl }) => {
      const changeText = quote ? `${quote.change >= 0 ? "+" : ""}${formatNumber(quote.change)} / ${formatPercent(quote.percent)}` : "--";
      const symbol = escapeHtml(holding.symbol);
      const name = escapeHtml(quote?.name ?? "等待行情");
      return `
        <article class="holding-card">
          <div class="holding-head">
            <div class="symbol">
              <strong>${symbol}</strong>
              <span>${name}</span>
            </div>
            <div class="price-block">
              <span>现价</span>
              <strong>${formatMoney(price)}</strong>
            </div>
          </div>
          <div class="day-line">
            <span>日内涨跌</span>
            <strong class="${signedClass(quote?.change)}">${changeText}</strong>
          </div>
          <div class="metric-grid">
            <div>
              <span>市值</span>
              <strong>${formatMoney(value)}</strong>
            </div>
            <div>
              <span>持仓盈亏</span>
              <strong class="${signedClass(pnl)}">${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}</strong>
            </div>
          </div>
          <button class="remove-button" type="button" data-remove="${symbol}">删除</button>
        </article>
      `;
    })
    .join("");

  renderSummary(rows);
}

async function toggleWakeLock() {
  if (!("wakeLock" in navigator)) {
    setStatus("当前浏览器不支持网页常亮，请使用系统常亮设置");
    return;
  }

  try {
    if (state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
      elements.wakeLockButton.textContent = "常亮";
      return;
    }

    state.wakeLock = await navigator.wakeLock.request("screen");
    elements.wakeLockButton.textContent = "已常亮";
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      elements.wakeLockButton.textContent = "常亮";
    });
  } catch (error) {
    console.error(error);
    setStatus("常亮开启失败，请确认浏览器权限或系统设置");
  }
}

function updateFullscreenButton() {
  elements.fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
}

async function toggleFullscreen() {
  if (!document.documentElement.requestFullscreen || !document.exitFullscreen) {
    setStatus("当前浏览器不支持网页全屏，请尝试添加到主屏幕使用");
    return;
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
    updateFullscreenButton();
  } catch (error) {
    console.error(error);
    setStatus("全屏切换失败，请确认浏览器权限或手动添加到主屏幕");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const symbol = normalizeSymbol(elements.symbolInput.value);
    const shares = Number(elements.sharesInput.value);
    const cost = Number(elements.costInput.value);

    if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost < 0) {
      setStatus("请填写有效的股票代码、数量和成本价");
      return;
    }

    upsertHolding(symbol, shares, cost);
    elements.form.reset();
    render();
    refreshQuotes();
  });

  elements.holdingsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (button) removeHolding(button.dataset.remove);
  });

  elements.refreshButton.addEventListener("click", refreshQuotes);
  elements.wakeLockButton.addEventListener("click", toggleWakeLock);
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    if (state.wakeLock) {
      state.wakeLock = null;
      await toggleWakeLock();
    }

    refreshQuotes();
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => {
      console.warn("Service Worker 注册失败", error);
    });
  }
}

function scheduleAutoRefresh(delay = REFRESH_INTERVAL_MS) {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(refreshQuotes, delay);
}

loadHoldings();
bindEvents();
render();
updateFullscreenButton();
refreshQuotes();
registerServiceWorker();
