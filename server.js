// server.js (CommonJS) - works on Render Node
const express = require("express");

const VERSION = "2026-02-08-1";
const app = express();

const PORT = process.env.PORT || 3000;
const TGJU_JSON_URL = "https://call2.tgju.org/ajax.json";

// Cache
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 60);
let CACHE = null;
let CACHE_AT = 0;

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function digitsToEnglish(s) {
  // Persian + Arabic digits -> English digits
  const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  const ar = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  let out = String(s);
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(fa[i], String(i));
    out = out.replaceAll(ar[i], String(i));
  }
  return out;
}

function num(v) {
  if (v === null || v === undefined) return null;

  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  if (typeof v === "string") {
    let cleaned = v.trim();
    if (!cleaned) return null;

    cleaned = digitsToEnglish(cleaned);
    cleaned = cleaned.replace(/,/g, ""); // remove commas

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}


function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function pickTs(item) {
  const ts =
    safeStr(item?.dt) ||
    safeStr(item?.ts) ||
    safeStr(item?.date) ||
    safeStr(item?.time) ||
    safeStr(item?.last) ||
    "";
  return ts.trim() ? ts.trim() : "";
}

// -----------------------------
// Classification rules (strong)
// -----------------------------
const CRYPTO_TOKENS = new Set([
  "btc","eth","usdt","xrp","trx","ltc","bch","bnb","ada","doge","dot","sol",
  "matic","shib","avax","atom","link","xlm","eos","etc","omg","xaut","ton"
]);

function isCryptoKey(key) {
  const k = key.toLowerCase();

  // btc-irr, usdt-irr, xrp-irr...
  if (k.endsWith("-irr") || k.endsWith("_irr")) {
    const base = k.split(/[-_]/)[0];
    return CRYPTO_TOKENS.has(base);
  }

  // price_btc, price_eth...
  if (k.startsWith("price_")) {
    const sym = k.slice(6);
    return CRYPTO_TOKENS.has(sym);
  }

  return false;
}

function isGoldKey(key) {
  const k = key.toLowerCase();

  if (k.startsWith("tgju_gold")) return true;
  if (k.startsWith("silver")) return true;

  if (k.includes("sekee") || k.includes("sekeb") || k.includes("rob")) return true;
  if (k.includes("nim") || k.includes("gerami")) return true;

  if (k.includes("gold") || k.includes("xau")) return true;

  return false;
}

function isFiatKey(key) {
  const k = key.toLowerCase();
  if (!k.startsWith("price_")) return false;

  // exclude crypto + gold
  if (isCryptoKey(k)) return false;
  if (isGoldKey(k)) return false;

  const after = k.slice(6);

  // common special fiat keys
  if (
    after === "dollar_rl" ||
    after === "dollar_ex" ||
    after === "dollar_dt" ||
    after === "eur" ||
    after === "gbp"
  ) return true;

  // typical fiat codes: price_cad, price_try, price_aed ...
  if (/^[a-z]{3}$/.test(after)) return true;

  return false;
}

function normalizeEntry(key, item) {
  const price = num(item?.current) ?? num(item?.price) ?? num(item) ?? 0;
  const low = num(item?.tolerance_low) ?? null;
  const high = num(item?.tolerance_high) ?? null;

  return {
    code: key,
    name: item?.name || item?.title || "",
    label: item?.label || item?.p || item?.n || "",
    price,
    change: item?.diff ?? item?.change ?? "0",
    low,
    high,
    ts: pickTs(item),
    source: TGJU_JSON_URL,
    raw_key: key,
  };
}

function buildGroups(currentObj) {
  const fiat = {};
  const crypto = {};
  const gold = {};

  const keys = Object.keys(currentObj || {});
  for (const key of keys) {
    const item = currentObj[key];
    const entry = normalizeEntry(key, item);

    if (isGoldKey(key)) {
      gold[key] = entry;
      continue;
    }
    if (isCryptoKey(key)) {
      crypto[key] = entry;
      continue;
    }
    if (isFiatKey(key)) {
      fiat[key] = entry;
      continue;
    }
  }

  return { fiat, crypto, gold };
}

async function fetchTgju() {
  const res = await fetch(TGJU_JSON_URL, {
    headers: {
      "User-Agent": "tgju-fetcher/1.0",
      "Accept": "application/json",
      "Accept-Language": "fa,en;q=0.8",
    },
  });

  const http_code = res.status;
  const json = await res.json().catch(() => null);

  if (!res.ok || !isObj(json)) {
    return {
      version: VERSION,
      ok: false,
      fetched_at: Math.floor(Date.now() / 1000),
      source: TGJU_JSON_URL,
      http_code,
      error: "Failed to fetch TGJU JSON",
      groups: { fiat: {}, crypto: {}, gold: {} },
    };
  }

  const current = json.current;
  if (!isObj(current)) {
    return {
      version: VERSION,
      ok: false,
      fetched_at: Math.floor(Date.now() / 1000),
      source: TGJU_JSON_URL,
      http_code,
      error: "TGJU JSON missing 'current' object",
      debug_keys: Object.keys(json),
      groups: { fiat: {}, crypto: {}, gold: {} },
    };
  }

  const groups = buildGroups(current);

  return {
    version: VERSION,
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

async function getData(force) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && CACHE && now - CACHE_AT < CACHE_SECONDS) return CACHE;

  const data = await fetchTgju();
  CACHE = data;
  CACHE_AT = now;
  return data;
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (_req, res) => res.send("TGJU Fetcher is running ✅"));

app.get("/health", (_req, res) => {
  res.json({ version: VERSION, ok: true, time: new Date().toISOString() });
});

// Debug: shows sample keys so you SEE grouping is different
app.get("/debug/groups", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const data = await getData(force);

  const sample = (obj) => Object.keys(obj).slice(0, 40);

  res.json({
    version: VERSION,
    ok: data.ok,
    fetched_at: data.fetched_at,
    count: data.count,
    sampleKeys: data.ok
      ? {
          fiat: sample(data.groups.fiat),
          crypto: sample(data.groups.crypto),
          gold: sample(data.groups.gold),
        }
      : null,
    error: data.error || null,
  });
});

// Main rates endpoint
// /rates?group=fiat|crypto|gold&force=1
app.get("/rates", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  const group = typeof req.query.group === "string" ? req.query.group.toLowerCase() : "";

  const data = await getData(force);

  if (!data.ok) {
    return res.json({
      version: VERSION,
      ok: false,
      fetched_at: data.fetched_at,
      source: data.source,
      http_code: data.http_code,
      error: data.error,
      rates: {},
    });
  }

  // Return single group
  if (group === "fiat" || group === "crypto" || group === "gold") {
    return res.json({
      version: VERSION,
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

  // Return all groups
  return res.json({
    version: VERSION,
    ok: true,
    fetched_at: data.fetched_at,
    source: data.source,
    http_code: data.http_code,
    error: null,
    count: data.count,
    rates: data.groups, // { fiat, crypto, gold }
  });
});

app.listen(PORT, () => {
  console.log(`TGJU fetcher running: http://localhost:${PORT}`);
});
