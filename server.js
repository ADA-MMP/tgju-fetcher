const VERSION = "2026-02-08-1";
const express = require("express");
import express from "express";

const app = express();
const PORT = process.env.PORT || 8787;
const PORT = process.env.PORT || 3000;

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

// -----------------------------
// Helpers
// -----------------------------
function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeString(v) {
  return typeof v === "string" ? v : "";
  // remove commas
  const s = v.replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pickTs(item) {
  // TGJU sometimes has: "last" or "date"
  // normalize to string
  const ts =
    safeString(item?.dt) ||
    safeString(item?.ts) ||
    safeString(item?.date) ||
    safeString(item?.time) ||
    (typeof item?.last === "string" && item.last) ||
    (typeof item?.date === "string" && item.date) ||
    "";
  return ts.trim() !== "" ? ts : new Date().toISOString();
  return ts;
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
// -----------------------------
// Classification rules
// -----------------------------
// TGJU has MANY keys. We categorize by key name patterns.

// Gold/metals keywords
const GOLD_KEYWORDS = [
  "gold",
  "silver",
  "xau",
  "sekke",
  "sekee",
  "sekeb",
  "rob",
  "nim",
  "gerami",
  "emami",
  "bahar",
  "mesghal",
  "ons",
  "coin",
  "tala",
  "sime",
  "abshode",
  "tgju_gold",
];

// Crypto patterns / keywords (TGJU uses many styles)
const CRYPTO_KEYWORDS = [
  "btc",
  "eth",
  "usdt",
  "tether",
  "xrp",
  "trx",
  "ltc",
  "bch",
  "bnb",
  "ada",
  "doge",
  "dot",
  "sol",
  "matic",
  "shib",
  "avax",
  "atom",
  "link",
  "xlm",
  "eos",
  "etc",
  "omg",
  "xaut",
  "ton",
];

// key looks like "btc-irr" or "usdt-irr" etc.
function looksCryptoKey(key) {
  const k = key.toLowerCase();

  // Common TGJU crypto suffixes/pairs
  if (k.endsWith("-irr") || k.endsWith("_irr")) {
    // e.g. btc-irr, usdt-irr
    return CRYPTO_KEYWORDS.some((c) => k.startsWith(c));
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  // Some are like "price_btc" (inside current)
  if (k.startsWith("price_")) {
    const sym = k.slice("price_".length);
    return CRYPTO_KEYWORDS.includes(sym);
  }

  return { http_code, json };
  // or contains known crypto tokens
  return CRYPTO_KEYWORDS.some((c) => k === c || k.includes(`${c}-`) || k.includes(`${c}_`));
}

function tgjuKeyToCode(priceKey) {
  const raw = priceKey.replace(/^price_/, "");
  return SPECIAL_CODE_MAP[raw] || raw;
function looksGoldKey(key) {
  const k = key.toLowerCase();
  return GOLD_KEYWORDS.some((w) => k.includes(w));
}

function normalizeAllPrices(json) {
  const out = {};
  const current = json?.current;
// Fiat: price_* that is not crypto & not gold
function looksFiatKey(key) {
  const k = key.toLowerCase();
  if (!k.startsWith("price_")) return false;

  if (!current || typeof current !== "object") return out;
  // exclude gold/metals and crypto
  if (looksGoldKey(k)) return false;
  if (looksCryptoKey(k)) return false;

  for (const [key, item] of Object.entries(current)) {
    if (!key.startsWith("price_")) continue;
  return true;
}

    const code = tgjuKeyToCode(key);
    if (!code) continue;
// -----------------------------
// Parsing TGJU "current" object
// -----------------------------
function normalizeEntry(key, item) {
  // item might be:
  // { current: "...", tolerance_low: "...", tolerance_high: "...", last: "..." }
  // or sometimes a number/string
  const price =
    num(item?.current) ??
    num(item?.price) ??
    num(item);

  const low = num(item?.tolerance_low) ?? null;
  const high = num(item?.tolerance_high) ?? null;

  return {
    code: key,
    name: item?.name || item?.title || "",   // may be empty
    label: item?.label || item?.p || item?.n || "", // may be empty
    price: price ?? 0,
    change: item?.diff ?? item?.change ?? "0",
    low,
    high,
    ts: pickTs(item),
    source: TGJU_JSON_URL,
    raw_key: key,
  };
}

    const price =
      typeof item === "object" && item !== null
        ? toNumber(item.p ?? item.price ?? item.value ?? item.last)
        : toNumber(item);
function buildGroups(currentObj) {
  const fiat = {};
  const crypto = {};
  const gold = {};

    if (price == null) continue;
  const keys = Object.keys(currentObj || {});
  for (const key of keys) {
    const item = currentObj[key];

    const change =
      typeof item === "object" && item !== null
        ? String(item.d ?? item.change ?? "")
        : "";
    const entry = normalizeEntry(key, item);

    let low =
      typeof item === "object" && item !== null ? toNumber(item.low ?? item.l) : null;
    let high =
      typeof item === "object" && item !== null ? toNumber(item.high ?? item.h) : null;
    const k = key.toLowerCase();

    if (low != null && high != null && low > high) {
      const tmp = low; low = high; high = tmp;
    if (looksGoldKey(k)) {
      gold[entry.code] = entry;
      continue;
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
    if (looksCryptoKey(k)) {
      crypto[entry.code] = entry;
      continue;
    }

async function refreshCache(force = false) {
  const age = nowMs() - cache.fetched_at_ms;
  if (!force && cache.ok && age < CACHE_TTL_MS) return;
    if (looksFiatKey(k)) {
      fiat[entry.code] = entry;
      continue;
    }

  try {
    const { http_code, json } = await fetchTgjuJson();
    // ignore other keys (stocks, ratios, indices, etc.)
  }

    cache.http_code = http_code;
    cache.fetched_at_ms = nowMs();
  return { fiat, crypto, gold };
}

    if (http_code < 200 || http_code >= 300 || !json) {
      cache.ok = false;
      cache.error = `HTTP ${http_code} or invalid JSON`;
      cache.rates_all = {};
      cache.count_all = 0;
      return;
    }
// -----------------------------
// Fetch TGJU JSON
// -----------------------------
async function fetchTgju() {
  const res = await fetch(TGJU_JSON_URL, {
    headers: {
      "User-Agent": "tgju-fetcher/1.0",
      "Accept": "application/json",
      "Accept-Language": "fa,en;q=0.8",
    },
  });

    const all = normalizeAllPrices(json);
  const http_code = res.status;
  const json = await res.json().catch(() => null);

    if (!all || Object.keys(all).length === 0) {
      cache.ok = false;
      cache.error = "JSON fetched but no price_* items found.";
      cache.rates_all = {};
      cache.count_all = 0;
      return;
    }
  if (!res.ok || !isObj(json)) {
    return {
      ok: false,
      fetched_at: Math.floor(Date.now() / 1000),
      source: TGJU_JSON_URL,
      http_code,
      error: "Failed to fetch TGJU JSON",
      rates: {},
    };
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
  const current = json.current;
  if (!isObj(current)) {
    return {
      ok: false,
      fetched_at: Math.floor(Date.now() / 1000),
      source: TGJU_JSON_URL,
      http_code,
      error: "TGJU JSON missing 'current' object",
      rates: {},
      debug_keys: Object.keys(json),
    };
  }
}

// Parse symbols=usd,eur,aed -> Set(["usd","eur","aed"])
function parseSymbolsParam(value) {
  if (!value) return null;
  const raw = String(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const groups = buildGroups(current);

  if (raw.length === 0) return null;
  return new Set(raw);
  return {
    ok: true,
    fetched_at: Math.floor(Date.now() / 1000),
    source: TGJU_JSON_URL,
    http_code,
    error: null,
    count: {
      fiat: Object.keys(groups.fiat).length,
      crypto: Object.keys(groups.crypto).length,
      gold: Object.keys(groups.gold).length,
    },
    groups,
  };
}

// ===== Routes =====
// -----------------------------
// Cache (optional but helpful)
// -----------------------------
let CACHE = null;
let CACHE_AT = 0;
const CACHE_SECONDS = 60;

async function getData(force) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && CACHE && now - CACHE_AT < CACHE_SECONDS) return CACHE;

  const data = await fetchTgju();
  CACHE = data;
  CACHE_AT = now;
  return data;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => res.send("TGJU Fetcher is running ✅"));

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
  const force = req.query.force === "1" || req.query.force === "true";
  const group = typeof req.query.group === "string" ? req.query.group.toLowerCase() : "";

  const data = await getData(force);

  if (!data.ok) {
    return res.json({
      ok: false,
      fetched_at: data.fetched_at,
      source: data.source,
      http_code: data.http_code,
      error: data.error,
      rates: {},
    });
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
  // return only one group OR all groups
  if (group === "fiat" || group === "crypto" || group === "gold") {
    return res.json({
      ok: true,
      fetched_at: data.fetched_at,
      source: data.source,
      http_code: data.http_code,
      error: null,
      group,
      count: Object.keys(data.groups[group]).length,
      rates: data.groups[group],
    });
  }

  const codes = Object.keys(cache.rates_all).sort();
  res.json({
    ok: cache.ok,
    total: codes.length,
    sample: codes.slice(0, 300),
  return res.json({
    ok: true,
    fetched_at: data.fetched_at,
    source: data.source,
    http_code: data.http_code,
    error: null,
    count: data.count,
    rates: data.groups, // {fiat, crypto, gold}
  });
});

app.listen(PORT, () => {
  console.log(`TGJU fetcher running: http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/rates?symbols=usd,eur,aed,try&force=1`);
  console.log(`Server running on port ${PORT}`);
});

app.listen(PORT, () => {
  console.log(`TGJU fetcher running: http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/rates?symbols=usd,eur,aed,try&force=1`);
});
