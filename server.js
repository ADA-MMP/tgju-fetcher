/**
 * server.js — TGJU Fetcher (Express)
 * - Fetches https://call2.tgju.org/ajax.json
 * - Normalizes TGJU keys to clean codes (e.g. DOLLAR_RL -> USD)
 * - Classifies into: fiat / crypto / gold
 * - Endpoints:
 *    GET /health
 *    GET /rates?group=fiat|crypto|gold|all&symbols=usd,eur,aed&force=1
 *    GET /codes?group=fiat|crypto|gold&force=1
 *
 * Works on Node 18+ (uses global fetch)
 */

"use strict";

const VERSION = "2026-02-15-1";

const express = require("express");
const app = express();

const PORT = Number(process.env.PORT || 3000);
const TGJU_JSON_URL = "https://call2.tgju.org/ajax.json";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);

// -----------------------------
// Normalization mappings
// -----------------------------
const SPECIAL_CODE_MAP = {
  // TGJU special fiat keys
  dollar_rl: "usd", // ✅ USD free market  (your requirement)
  dollar_ex: "usd_official",
  dollar_dt: "usd_dt",
  dollar_sm: "usd_sm",

  eur_ex: "eur_official",
};

// Optional Persian titles override (for nicer display in WP)
const FA_NAME_MAP = {
  usd: "دلار آمریکا",
  eur: "یورو",
  gbp: "پوند انگلیس",
  cad: "دلار کانادا",
  aed: "درهم امارات",
  try: "لیر ترکیه",
  sar: "ریال عربستان",
  qar: "ریال قطر",
  kwd: "دینار کویت",
  bhd: "دینار بحرین",
  iqd: "دینار عراق",
  cny: "یوان چین",
  jpy: "ین ژاپن",
  chf: "فرانک سوئیس",
  rub: "روبل روسیه",
};

// Currency -> country code (for flag emoji in WP)
const CURRENCY_TO_COUNTRY = {
  usd: "US",
  eur: "EU",
  gbp: "GB",
  cad: "CA",
  aed: "AE",
  try: "TR",
  sar: "SA",
  qar: "QA",
  kwd: "KW",
  bhd: "BH",
  iqd: "IQ",
  cny: "CN",
  jpy: "JP",
  chf: "CH",
  rub: "RU",
};

// -----------------------------
// Helpers
// -----------------------------
function nowMs() {
  return Date.now();
}

function safeString(v) {
  return typeof v === "string" ? v : "";
}

function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isNumericLike(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return false;
  return !Number.isNaN(Number(s));
}

function pickTs(item) {
  const ts =
    safeString(item?.dt) ||
    safeString(item?.ts) ||
    safeString(item?.date) ||
    safeString(item?.time) ||
    (typeof item?.last === "string" ? item.last : "") ||
    "";
  return ts.trim() !== "" ? ts.trim() : new Date().toISOString();
}

// Parse "usd, eur, aed" -> Set(["usd","eur","aed"])
function parseSymbolsParam(value) {
  if (!value) return null;
  const arr = String(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

function tgjuKeyToCode(priceKey) {
  // price_dollar_rl -> dollar_rl -> usd
  const raw = String(priceKey).replace(/^price_/, "").toLowerCase();
  return SPECIAL_CODE_MAP[raw] || raw;
}

// -----------------------------
// Classification rules
// -----------------------------
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
];

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

function isGoldKey(key) {
  const k = key.toLowerCase();
  return GOLD_KEYWORDS.some((w) => k.includes(w));
}

function isCryptoKey(key) {
  const k = key.toLowerCase();

  // pairs like btc-irr, usdt-irr, btc_irr
  if (k.endsWith("-irr") || k.endsWith("_irr")) {
    return CRYPTO_KEYWORDS.some((c) => k.startsWith(c));
  }

  // price_btc / price_eth style
  if (k.startsWith("price_")) {
    const sym = k.slice("price_".length);
    return CRYPTO_KEYWORDS.includes(sym);
  }

  // contains known crypto tokens
  return CRYPTO_KEYWORDS.some(
    (c) => k === c || k.includes(`${c}-`) || k.includes(`${c}_`)
  );
}

function isFiatKey(key) {
  const k = key.toLowerCase();
  if (!k.startsWith("price_")) return false;

  // exclude crypto + gold
  if (isCryptoKey(k)) return false;
  if (isGoldKey(k)) return false;

  const after = k.slice("price_".length);

  // common special fiat keys
  if (
    after === "dollar_rl" ||
    after === "dollar_ex" ||
    after === "dollar_dt" ||
    after === "dollar_sm" ||
    after === "eur" ||
    after === "gbp"
  )
    return true;

  // Most fiat currencies are ISO codes (usd, eur, cad, ...)
  // If it's price_XXX and not crypto/gold, treat as fiat.
  // (TGJU includes lots of fiat codes: price_aud, price_sek, etc.)
  return true;
}

// -----------------------------
// Normalizing TGJU entries
// -----------------------------
function normalizeEntry(priceKey, item) {
  const code = tgjuKeyToCode(priceKey);

  // TGJU commonly uses current / tolerance_low / tolerance_high
  const price =
    num(item?.current) ?? num(item?.price) ?? num(item?.p) ?? num(item);

  const low =
    num(item?.tolerance_low) ?? num(item?.low) ?? num(item?.l) ?? null;

  const high =
    num(item?.tolerance_high) ?? num(item?.high) ?? num(item?.h) ?? null;

  // Best-effort human name:
  // Some TGJU fields can be confusing; we ensure "label" is NOT numeric.
  const rawName =
    safeString(item?.name) ||
    safeString(item?.title) ||
    safeString(item?.n) ||
    "";

  const rawLabel =
    safeString(item?.label) ||
    safeString(item?.p) ||
    safeString(item?.s) ||
    "";

  const name = FA_NAME_MAP[code] || rawName || (isNumericLike(rawLabel) ? "" : rawLabel) || code.toUpperCase();

  const label = name; // ✅ keep label as name (not amount)

  return {
    code,
    name,
    label,
    price: price ?? 0,
    change: safeString(item?.diff) || safeString(item?.change) || "0",
    low,
    high,
    ts: pickTs(item),
    source: TGJU_JSON_URL,
    raw_key: String(priceKey),
  };
}

function buildGroups(currentObj) {
  const fiat = {};
  const crypto = {};
  const gold = {};

  for (const key of Object.keys(currentObj || {})) {
    if (!key.startsWith("price_")) continue;

    const item = currentObj[key];
    const entry = normalizeEntry(key, item);
    const k = key.toLowerCase();

    if (isGoldKey(k)) {
      gold[entry.code] = entry;
      continue;
    }
    if (isCryptoKey(k)) {
      crypto[entry.code] = entry;
      continue;
    }
    if (isFiatKey(k)) {
      fiat[entry.code] = entry;
      continue;
    }
  }

  return { fiat, crypto, gold };
}

function filterBySymbols(obj, symbolsSet) {
  if (!symbolsSet) return obj;
  const out = {};
  for (const s of symbolsSet) {
    if (obj[s]) out[s] = obj[s];
  }
  return out;
}

// -----------------------------
// Fetch + cache
// -----------------------------
let cache = {
  ok: false,
  error: "Not fetched yet",
  http_code: null,
  fetched_at_ms: 0,
  groups: { fiat: {}, crypto: {}, gold: {} },
};

async function fetchTgjuJson() {
  const res = await fetch(TGJU_JSON_URL, {
    headers: {
      "User-Agent": "tgju-fetcher/2.1 (+contact: you)",
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

async function refreshCache(force = false) {
  const age = nowMs() - cache.fetched_at_ms;
  if (!force && cache.ok && age < CACHE_TTL_MS) return;

  try {
    const { http_code, json } = await fetchTgjuJson();
    cache.http_code = http_code;
    cache.fetched_at_ms = nowMs();

    const current = json?.current;
    if (!current || typeof current !== "object") {
      cache.ok = false;
      cache.error = "TGJU JSON missing 'current' object";
      cache.groups = { fiat: {}, crypto: {}, gold: {} };
      return;
    }

    const groups = buildGroups(current);

    cache.ok = true;
    cache.error = null;
    cache.groups = groups;
  } catch (e) {
    cache.ok = false;
    cache.error = e?.message || "Unknown fetch error";
    cache.http_code = null;
    cache.fetched_at_ms = nowMs();
    cache.groups = { fiat: {}, crypto: {}, gold: {} };
  }
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (_req, res) => {
  res.type("text/plain").send("TGJU Fetcher is running ✅");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, time: new Date().toISOString() });
});

/**
 * GET /rates
 * Query:
 *  - group=fiat|crypto|gold|all   (default: all)
 *  - symbols=usd,eur,aed          (optional filter)
 *  - force=1                      (force refresh)
 */
app.get("/rates", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const group = String(req.query.group || "all").toLowerCase();
  const symbolsSet = parseSymbolsParam(req.query.symbols);

  await refreshCache(force);

  if (!cache.ok) {
    return res.json({
      ok: false,
      version: VERSION,
      fetched_at: Math.floor(cache.fetched_at_ms / 1000),
      source: TGJU_JSON_URL,
      http_code: cache.http_code,
      error: cache.error,
      count: 0,
      rates: {},
    });
  }

  const base = {
    ok: true,
    version: VERSION,
    fetched_at: Math.floor(cache.fetched_at_ms / 1000),
    source: TGJU_JSON_URL,
    http_code: cache.http_code,
    error: null,
  };

  if (group === "fiat" || group === "crypto" || group === "gold") {
    const rates = filterBySymbols(cache.groups[group], symbolsSet);
    return res.json({
      ...base,
      group,
      count: Object.keys(rates).length,
      rates,
    });
  }

  // group=all
  const fiat = filterBySymbols(cache.groups.fiat, symbolsSet);
  const crypto = filterBySymbols(cache.groups.crypto, symbolsSet);
  const gold = filterBySymbols(cache.groups.gold, symbolsSet);

  return res.json({
    ...base,
    group: "all",
    count: {
      fiat: Object.keys(fiat).length,
      crypto: Object.keys(crypto).length,
      gold: Object.keys(gold).length,
    },
    rates: { fiat, crypto, gold },
  });
});

/**
 * GET /codes?group=fiat|crypto|gold&force=1
 * Returns only the list of codes for that group.
 */
app.get("/codes", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const group = String(req.query.group || "").toLowerCase();

  if (!["fiat", "crypto", "gold"].includes(group)) {
    return res.status(400).json({
      ok: false,
      version: VERSION,
      error: "Use ?group=fiat or ?group=crypto or ?group=gold",
    });
  }

  await refreshCache(force);

  if (!cache.ok) {
    return res.json({
      ok: false,
      version: VERSION,
      fetched_at: Math.floor(cache.fetched_at_ms / 1000),
      source: TGJU_JSON_URL,
      http_code: cache.http_code,
      error: cache.error,
      count: 0,
      codes: [],
    });
  }

  const codes = Object.keys(cache.groups[group]).sort();
  return res.json({
    ok: true,
    version: VERSION,
    fetched_at: Math.floor(cache.fetched_at_ms / 1000),
    source: TGJU_JSON_URL,
    http_code: cache.http_code,
    error: null,
    group,
    count: codes.length,
    codes,
  });
});

/**
 * Optional debug endpoint (first N items in a group)
 * GET /debug/sample?group=fiat&n=20
 */
app.get("/debug/sample", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const group = String(req.query.group || "fiat").toLowerCase();
  const n = Math.max(1, Math.min(200, Number(req.query.n || 20)));

  await refreshCache(force);

  const g = cache.groups[group] || {};
  const codes = Object.keys(g).sort().slice(0, n);
  const sample = {};
  for (const c of codes) sample[c] = g[c];

  res.json({
    ok: cache.ok,
    version: VERSION,
    group,
    n,
    fetched_at: Math.floor(cache.fetched_at_ms / 1000),
    http_code: cache.http_code,
    error: cache.error,
    sample,
  });
});

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => {
  console.log(`TGJU fetcher running on port ${PORT}`);
  console.log(`Try: http://localhost:${PORT}/rates?group=fiat&force=1`);
  console.log(`Try: http://localhost:${PORT}/codes?group=fiat&force=1`);
});
