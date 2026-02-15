/**
 * server.js — TGJU Fetcher (Express)
 * - Fetches https://call2.tgju.org/ajax.json
 * - Normalizes TGJU keys to clean codes (e.g. price_dollar_rl -> usd)
 * - Classifies into: fiat / crypto / gold
 * - Ensures label/name are NEVER numeric (so WP "نام" never shows amount)
 * - Adds flag emoji + country code for fiat
 *
 * Endpoints:
 *   GET /health
 *   GET /rates?group=fiat|crypto|gold|all&symbols=usd,eur,aed&force=1
 *   GET /codes?group=fiat|crypto|gold&force=1
 *   GET /debug/sample?group=fiat&n=20&force=1
 *
 * Works on Node 18+ (uses global fetch)
 */

"use strict";

const VERSION = "2026-02-15-2";

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
  dollar_rl: "usd", // ✅ USD free market
  dollar_ex: "usd_official",
  dollar_dt: "usd_dt",
  dollar_sm: "usd_sm",
  eur_ex: "eur_official",
};

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
  aud: "دلار استرالیا",
  nzd: "دلار نیوزیلند",
  sek: "کرون سوئد",
  nok: "کرون نروژ",
  dkk: "کرون دانمارک",
  inr: "روپیه هند",
  krw: "وون کره جنوبی",
  myr: "رینگیت مالزی",
  thb: "بات تایلند",
  php: "پزوی فیلیپین",
  mxn: "پزو مکزیک",
  brl: "رئال برزیل",
  zar: "رند آفریقای جنوبی",

  // from your TGJU list (ISO codes)
  all: "لک آلبانی",
  bbd: "دلار باربادوس",
  bdt: "تاکا بنگلادش",
  bgn: "لو بلغارستان",
  bif: "فرانک بوروندی",
  bnd: "دلار برونئی",
  bsd: "دلار باهاماس",
  bwp: "پوله بوتسوانا",
  byn: "روبل بلاروس",
  bzd: "دلار بلیز",
  cup: "پزوی کوبا",
  czk: "کرون چک",
  djf: "فرانک جیبوتی",
  dop: "پزوی دومنیکن",
  dzd: "دینار الجزایر",
  etb: "بیر اتیوپی",
  gnf: "فرانک گینه",
  gtq: "گواتزال گواتمالا",
  gyd: "دلار گویان",
  hnl: "لمپیرا هندوراس",
  hrk: "کونا کرواسی",
  htg: "گورده هایتی",
  isk: "کرونا ایسلند",
  jmd: "دلار جامایکا",
  kes: "شیلینگ کنیا",
  khr: "ریل کامبوج",
  kmf: "فرانک کومور",
  kzt: "تنگه قزاقستان",
  lak: "کیپ لائوس",
  lbp: "پوند لبنان",
  lkr: "روپیه سریلانکا",
  lrd: "دلار لیبریا",
  lsl: "لوتی لسوتو",
  lyd: "دینار لیبی",
  mad: "درهم مراکش",
  mdl: "لئو مولداوی",
  mga: "آریاری ماداگاسکار",
  mkd: "دینار مقدونیه",
  mmk: "کیات میانمار",
  mop: "پاتاکا ماکائو",
  mur: "روپیه موریس",
  mvr: "روفیا مالدیو",
  mwk: "کواچا مالاوی",
  mzn: "متیکال موزامبیک",
  nad: "دلار نامبیا",
  ngn: "نیرا نیجریه",
  npr: "روپیه نپال",
  pab: "بولبوئا پاناما",
  pgk: "کینا پاپوا گینه نو",
  ron: "لئو رومانی",
  rsd: "دینار صربستان",
  rwf: "فرانک رواندا",
  scr: "روپیه سیشل",
  sdg: "پوند سودان",
  shp: "پوند سینت هلنا",
  sos: "شیلینگ سومالی",
  svc: "کولون السالوادور",
  szl: "لیلانگی سوازیلند",
  tjs: "سامانی تاجیکستان",
  tmt: "منات ترکمنستان",
  tnd: "دینار تونس",
  ttd: "دلار ترینیداد و توباگو",
  tzs: "شیلینگ تانزانیا",
  ugx: "شیلینگ اوگاندا",
  yer: "ریال یمن",
  zmw: "کواچا زامبیا",
  ghs: "سدی غنا",
  pen: "سول پرو",
  clp: "پزوی شیلی",
  egp: "پوند مصر",
  jod: "دینار اردن",
  uyu: "پزوی اروگوئه",
  cop: "پزوی کلمبیا",
  pln: "زلوتی لهستان",
  ars: "پزوی آرژانتین",
  kyd: "دلار جزایر کیمن",
  huf: "فورینت مجارستان",
  pyg: "گورانی پاراگوئه",
  uah: "هریونیا اوکراین",
  nio: "کوردوبا نیکاراگوئه",
  fjd: "دلار فیجی",
  twd: "دلار تایوان",
  uzs: "سوم ازبکستان",
  idr: "روپیه اندونزی",
  xof: "فرانک آفریقای غربی",
  xpf: "فرانک اقیانوسیه",
  vnd: "دونگ ویتنام",
  gmd: "دلاسی گامبیا",
  xaf: "فرانک آفریقا",
  vuv: "وانواتو واتو",
  kgs: "سوم قرقیزستان",
  mru: "اوگویا موریتانا",
  ang: "آنتیل گیلدر هلند",
  stn: "دوبرا سائوتومه و پرنسیپ",
  xcd: "دلار کارائیب شرقی",
};

// Currency -> country code (for flag emoji)
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
  aud: "AU",
  nzd: "NZ",
  sek: "SE",
  nok: "NO",
  dkk: "DK",
  inr: "IN",
  krw: "KR",
  myr: "MY",
  thb: "TH",
  php: "PH",
  mxn: "MX",
  brl: "BR",
  zar: "ZA",

  all: "AL",
  bbd: "BB",
  bdt: "BD",
  bgn: "BG",
  bif: "BI",
  bnd: "BN",
  bsd: "BS",
  bwp: "BW",
  byn: "BY",
  bzd: "BZ",
  cup: "CU",
  czk: "CZ",
  djf: "DJ",
  dop: "DO",
  dzd: "DZ",
  etb: "ET",
  gnf: "GN",
  gtq: "GT",
  gyd: "GY",
  hnl: "HN",
  hrk: "HR",
  htg: "HT",
  isk: "IS",
  jmd: "JM",
  kes: "KE",
  khr: "KH",
  kmf: "KM",
  kzt: "KZ",
  lak: "LA",
  lbp: "LB",
  lkr: "LK",
  lrd: "LR",
  lsl: "LS",
  lyd: "LY",
  mad: "MA",
  mdl: "MD",
  mga: "MG",
  mkd: "MK",
  mmk: "MM",
  mop: "MO",
  mur: "MU",
  mvr: "MV",
  mwk: "MW",
  mzn: "MZ",
  nad: "NA",
  ngn: "NG",
  npr: "NP",
  pab: "PA",
  pgk: "PG",
  ron: "RO",
  rsd: "RS",
  rwf: "RW",
  scr: "SC",
  sdg: "SD",
  shp: "SH",
  sos: "SO",
  svc: "SV",
  szl: "SZ",
  tjs: "TJ",
  tmt: "TM",
  tnd: "TN",
  ttd: "TT",
  tzs: "TZ",
  ugx: "UG",
  yer: "YE",
  zmw: "ZM",
  ghs: "GH",
  pen: "PE",
  clp: "CL",
  egp: "EG",
  jod: "JO",
  uyu: "UY",
  cop: "CO",
  pln: "PL",
  ars: "AR",
  kyd: "KY",
  huf: "HU",
  pyg: "PY",
  uah: "UA",
  nio: "NI",
  fjd: "FJ",
  twd: "TW",
  uzs: "UZ",
  idr: "ID",
  vnd: "VN",
  gmd: "GM",
  vuv: "VU",
  kgs: "KG",
  mru: "MR",

  // best-effort (multi-country currencies / territories)
  ang: "CW",
  stn: "ST",
  xcd: "AG",
  xof: "SN",
  xaf: "CM",
  xpf: "PF",
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

function parseSymbolsParam(value) {
  if (!value) return null;
  const arr = String(value)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

function baseCurrency(code) {
  const c = String(code).toLowerCase().trim();
  return c.split("_")[0] || c;
}

function countryToFlagEmoji(cc) {
  if (!cc || typeof cc !== "string" || cc.length !== 2) return "";
  const codePoints = [...cc.toUpperCase()].map(
    (ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)
  );
  return String.fromCodePoint(...codePoints);
}

function flagForCurrency(code) {
  const base = baseCurrency(code);
  const cc = CURRENCY_TO_COUNTRY[base];
  return cc ? countryToFlagEmoji(cc) : "";
}

function tgjuKeyToCode(priceKey) {
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

  if (k.endsWith("-irr") || k.endsWith("_irr")) {
    return CRYPTO_KEYWORDS.some((c) => k.startsWith(c));
  }

  if (k.startsWith("price_")) {
    const sym = k.slice("price_".length);
    return CRYPTO_KEYWORDS.includes(sym);
  }

  return CRYPTO_KEYWORDS.some(
    (c) => k === c || k.includes(`${c}-`) || k.includes(`${c}_`)
  );
}

function isFiatKey(key) {
  const k = key.toLowerCase();
  if (!k.startsWith("price_")) return false;
  if (isCryptoKey(k)) return false;
  if (isGoldKey(k)) return false;
  return true;
}

// -----------------------------
// Normalizing TGJU entries
// -----------------------------
function normalizeEntry(priceKey, item) {
  const code = tgjuKeyToCode(priceKey);
  const base = baseCurrency(code);

  const price =
    num(item?.current) ?? num(item?.price) ?? num(item?.p) ?? num(item);

  const low =
    num(item?.tolerance_low) ?? num(item?.low) ?? num(item?.l) ?? null;

  const high =
    num(item?.tolerance_high) ?? num(item?.high) ?? num(item?.h) ?? null;

  const rawName =
    safeString(item?.name) ||
    safeString(item?.title) ||
    safeString(item?.n) ||
    "";

  const rawLabel =
    safeString(item?.label) ||
    safeString(item?.s) ||
    "";

  const safeRawName = isNumericLike(rawName) ? "" : rawName.trim();
  const safeRawLabel = isNumericLike(rawLabel) ? "" : rawLabel.trim();

  const fa = FA_NAME_MAP[code] || FA_NAME_MAP[base] || "";
  const name = fa || safeRawName || safeRawLabel || code.toUpperCase();

  return {
    code,
    name,
    label: name,
    flag: flagForCurrency(code),
    country: CURRENCY_TO_COUNTRY[base] || null,
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
