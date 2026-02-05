const express = require("express");

const app = express();
const PORT = process.env.PORT || 8787;

const TGJU_JSON_URL = "https://call2.tgju.org/ajax.json";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60000);

// Normalize TGJU special keys -> your standard codes
const SPECIAL_CODE_MAP = {
  dollar_rl: "usd",        // free market USD
  dollar_ex: "usd_official",
  dollar_sm: "usd_sm",
  eur_ex: "eur_official",
};

// Optional labels
const LABELS = {
  usd: "دلار",
  eur: "یورو",
  gbp: "پوند",
  aed: "درهم",
  try: "لیر",
  cad: "دلار کانادا",
  sar: "ریال عربستان",
  qar: "ریال قطر",
  kwd: "دینار کویت",
  bhd: "دینار بحرین",
  iqd: "دینار عراق",
  cny: "یوان چین",
  jpy: "ین ژاپن",
  chf: "فرانک سوئیس",
  rub: "روبل روسیه",
  usd_official: "دلار رسمی",
};

let cache = {
  ok: false,
  error: "Not fetched yet",
  http_code: null,
  fetched_at_ms: 0,
  rates_all: {}, // all price_* normalized
  count_all: 0,
};

function nowMs() {
  return Date.now();
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeString(v) {
  return typeof v === "string" ? v : "";
}

function pickTs(item) {
  const ts =
    safeString(item?.dt) ||
    safeString(item?.ts) ||
    safeString(item?.date) ||
    safeString(item?.time) ||
    "";
  return ts.trim() !== "" ? ts : new Date().toISOString();
}

async function fetchTgjuJson() {
  const res = await fetch(TGJU_JSON_URL, {
    headers: {
      "User-Agent": "tgju-fetcher/1.0 (+contact: you)",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "fa,en;q=0.8",
      Connection: "keep-alive",
    },
  });

  const http_code = res.status;
  const text = await res.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { http_code, json };
}

function tgjuKeyToCode(priceKey) {
  const raw = priceKey.replace(/^price_/, "");
  return SPECIAL_CODE_MAP[raw] || raw;
}

function normalizeAllPrices(json) {
  const out = {};
  const current = json?.current;

  if (!current || typeof current !== "object") return out;

  for (const [key, item] of Object.entries(current)) {
    if (!key.startsWith("price_")) continue;

    const code = tgjuKeyToCode(key);
    if (!code) continue;

    const price =
      typeof item === "object" && item !== null
        ? toNumber(item.p ?? item.price ?? item.value ?? item.last)
        : toNumber(item);

    if (price == null) continue;

    const change =
      typeof item === "object" && item !== null
        ? String(item.d ?? item.change ?? "")
        : "";

    let low =
      typeof item === "object" && item !== null ? toNumber(item.low ?? item.l) : null;
    let high =
      typeof item === "object" && item !== null ? toNumber(item.high ?? item.h) : null;

    if (low != null && high != null && low > high) {
      const tmp = low; low = high; high = tmp;
    }

    const ts =
      typeof item === "object" && item !== null ? pickTs(item) : new Date().toISOString();

    out[code] = {
      code,
      label: LABELS[code] || code.toUpperCase(),
      price,
      change,
      low,
      high,
      ts,
      source: TGJU_JSON_URL,
      raw_key: key,
    };
  }

  return out;
}

async function refreshCache(force = false) {
  const age = nowMs() - cache.fetched_at_ms;
  if (!force && cache.ok && age < CACHE_TTL_MS) return;

  try {
    const { http_code, json } = await fetchTgjuJson();

    cache.http_code = http_code;
    cache.fetched_at_ms = nowMs();

    if (http_code < 200 || http_code >= 300 || !json) {
      cache.ok = false;
      cache.error = `HTTP ${http_code} or invalid JSON`;
      cache.rates_all = {};
      cache.count_all = 0;
      return;
    }

    const all = normalizeAllPrices(json);

    if (!all || Object.keys(all).length === 0) {
      cache.ok = false;
      cache.error = "JSON fetched but no price_* items found.";
      cache.rates_all = {};
      cache.count_all = 0;
      return;
    }

    cache.ok = true;
    cache.error = null;
    cache.rates_all = all;
    cache.count_all = Object.keys(all).length;
  } catch (e) {
    cache.ok = false;
    cache.error = e?.message || "Unknown fetch error";
    cache.http_code = null;
    cache.fetched_at_ms = nowMs();
    cache.rates_all = {};
    cache.count_all = 0;
  }
}

// Parse symbols=usd,eur,aed -> Set(["usd","eur","aed"])
function parseSymbolsParam(value) {
  if (!value) return null;
  const raw = String(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (raw.length === 0) return null;
  return new Set(raw);
}

// ===== Routes =====

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/**
 * /rates
 * Optional query:
 *   ?symbols=usd,eur,aed,try
 *   ?force=1  (refresh cache)
 *
 * Response always includes only requested symbols if symbols= is provided.
 */
app.get("/rates", async (req, res) => {
  const force = req.query.force === "1";
  await refreshCache(force);

  const symbolsSet = parseSymbolsParam(req.query.symbols);

  let rates = cache.rates_all;
  if (symbolsSet) {
    const filtered = {};
    for (const code of symbolsSet) {
      if (rates[code]) filtered[code] = rates[code];
    }
    rates = filtered;
  }

  res.json({
    ok: cache.ok,
    fetched_at: Math.floor(cache.fetched_at_ms / 1000),
    source: TGJU_JSON_URL,
    http_code: cache.http_code,
    error: cache.error,
    count: Object.keys(rates).length,
    rates,
  });
});

// Debug: show available codes (first 300)
app.get("/debug/codes", async (req, res) => {
  const force = req.query.force === "1";
  await refreshCache(force);

  const codes = Object.keys(cache.rates_all).sort();
  res.json({
    ok: cache.ok,
    total: codes.length,
    sample: codes.slice(0, 300),
  });
});

app.listen(PORT, () => {
  console.log(`TGJU fetcher running: http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/rates?symbols=usd,eur,aed,try&force=1`);
});
