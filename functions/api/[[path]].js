const COOKIE = "avl_session";
const SESSION_SECONDS = 36000;
const enc = new TextEncoder();

// Bộ nhớ đệm RAM cho thông tin đơn hàng & link P2P (Tuyệt đối không gọi ghép MP4 ngầm)
const memCache = globalThis.__avlCache || (globalThis.__avlCache = new Map());
const orderIndex = globalThis.__avlOrderIndex || (globalThis.__avlOrderIndex = new Map());

function getCached(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    memCache.delete(key);
    return null;
  }
  return entry.val;
}

function setCached(key, val, ttlMs = 60000) {
  if (memCache.size > 400) memCache.clear();
  memCache.set(key, { val, exp: Date.now() + ttlMs });
}

function indexOrders(items) {
  if (!Array.isArray(items)) return;
  const now = Date.now();
  if (orderIndex.size > 1500) orderIndex.clear();
  for (const item of items) {
    const code = String(item?.orderCode || item?.OrderCode || item?.rawCode || "").toUpperCase();
    if (code) {
      orderIndex.set(code, { item: sanitizeOrderPayload(item), at: now });
    }
  }
}

function searchInRamIndex(query) {
  const qUpper = query.toUpperCase();
  const isShort = query.length <= 6;
  const now = Date.now();
  const matched = [];
  for (const [code, entry] of orderIndex.entries()) {
    if (now - entry.at > 300000) continue;
    if (isShort ? (code.endsWith(qUpper) || code.includes(qUpper)) : code.includes(qUpper)) {
      matched.push(entry.item);
    }
  }
  return matched;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))));
}

async function makeCookie(secret) {
  const payload = b64(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, n: crypto.randomUUID() })));
  return payload + "." + await sign(secret, payload);
}

async function authed(req, secret) {
  const value = (req.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  try {
    if (await sign(secret, payload) !== signature) return false;
    return JSON.parse(new TextDecoder().decode(unb64(payload))).exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function cookie(value, age = SESSION_SECONDS) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

function base(env) {
  const value = (env.ASCAM_API_BASE || "").replace(/\/+$/g, "");
  if (!value || !value.startsWith("https://") || value.includes("REPLACE-WITH-TUNNEL-URL")) {
    throw new Error("ASCAM_API_BASE chưa được cấu hình bằng địa chỉ HTTPS hợp lệ.");
  }
  return value.endsWith("/api/v1") ? value : value + "/api/v1";
}

function sanitizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    u.searchParams.delete("token");
    u.searchParams.delete("apiKey");
    u.searchParams.delete("access_token");
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeOrderPayload(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeOrderPayload);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (["downloadUrl", "mergedDownloadUrl", "downloadURL", "mergedDownloadURL"].includes(k)) {
      clean[k] = sanitizeUrl(v);
    } else if (k === "token" && typeof v === "string") {
      clean[k] = "***";
    } else if (v && typeof v === "object") {
      clean[k] = sanitizeOrderPayload(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

async function asc(env, path, init = {}) {
  if (!env.ASCAM_API_TOKEN) throw new Error("Chưa cấu hình ASCAM_API_TOKEN.");
  const { timeoutMs = 8000, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers || {});
  headers.set("Authorization", `Bearer ${env.ASCAM_API_TOKEN}`);
  if (fetchInit.body) headers.set("Content-Type", "application/json");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = fetchInit.signal ? AbortSignal.any([fetchInit.signal, ctrl.signal]) : ctrl.signal;

  try {
    const response = await fetch(base(env) + path, { ...fetchInit, headers, signal });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }
    return response.ok
      ? { data, status: response.status }
      : { error: data.message || data.error || `ASCAM HTTP ${response.status}`, status: response.status };
  } catch (err) {
    if (ctrl.signal.aborted) {
      return { error: "Máy chủ ASCAM phản hồi chậm, vui lòng thử lại.", status: 504 };
    }
    return { error: err.message || "Không thể kết nối tới ASCAM.", status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

const safeCode = value => typeof value === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(value);
const safeSession = value => /^\d{6,30}$/.test(String(value || ""));

function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  if (Array.isArray(data?.orders)) return data.orders;
  return [];
}

function normalizeRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (["overview", "main", "primary", "tc"].includes(r)) return "overview";
  if (["waybill", "sub", "secondary", "scanner", "vd"].includes(r)) return "waybill";
  if (r === "merged") return "merged";
  return "overview";
}

function isLinkValid(link) {
  if (!link?.shareUrl) return false;
  if (!link.expiresAt) return true;
  const exp = new Date(link.expiresAt).getTime();
  return Number.isNaN(exp) || exp > Date.now() + 30000;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method.toUpperCase();
