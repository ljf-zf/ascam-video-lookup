const COOKIE = "avl_session";
const SESSION_SECONDS = 36000;
const FIRST_CHUNK_BYTES = 1048576; // 1 MB cho khúc khởi động đầu tiên (~0.15s)
const NEXT_CHUNK_BYTES = 2097152;  // 2 MB cho các khúc phát tiếp theo
const enc = new TextEncoder();

// Bộ nhớ đệm RAM trên Cloudflare Worker: Lưu thông tin đơn + Khúc 1MB đầu tiên của Video
const memCache = globalThis.__avlCache || (globalThis.__avlCache = new Map());
const orderIndex = globalThis.__avlOrderIndex || (globalThis.__avlOrderIndex = new Map());
const startupChunkCache = globalThis.__avlChunkCache || (globalThis.__avlChunkCache = new Map());
const inflightPrewarms = globalThis.__avlInflight || (globalThis.__avlInflight = new Map());

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

function getStartupChunk(sessionId) {
  const entry = startupChunkCache.get(String(sessionId));
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    startupChunkCache.delete(String(sessionId));
    return null;
  }
  return entry;
}

function setStartupChunk(sessionId, buffer, status, headersObj) {
  // Giới hạn tối đa 12 đơn trong RAM (~12MB) để luôn an toàn bộ nhớ Worker
  if (startupChunkCache.size >= 12) {
    const oldestKey = startupChunkCache.keys().next().value;
    if (oldestKey) startupChunkCache.delete(oldestKey);
  }
  startupChunkCache.set(String(sessionId), {
    buffer,
    status,
    headers: headersObj,
    exp: Date.now() + 300000, // Giữ sẵn trong RAM 5 phút
  });
}

function extractFirstSessionId(item) {
  if (!item) return "";
  if (item.sessionId || item.id) return String(item.sessionId || item.id);
  if (Array.isArray(item.sessions) && item.sessions[0]) {
    return String(item.sessions[0].sessionId || item.sessions[0].id || "");
  }
  return "";
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

// NẠP TRƯỚC KHÚC 1MB ĐẦU TIÊN CỦA VIDEO VÀO RAM WORKER (CHỐNG TRÙNG LẶP REQUEST)
async function warmStartupChunk(env, sessionId) {
  const sId = String(sessionId || "");
  if (!/^\d{6,30}$/.test(sId)) return null;

  const existing = getStartupChunk(sId);
  if (existing) return existing;

  if (inflightPrewarms.has(sId)) {
    return inflightPrewarms.get(sId);
  }

  const job = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const upstreamUrl = `${base(env)}/sessions/${encodeURIComponent(sId)}/video`;
      const res = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${env.ASCAM_API_TOKEN}`,
          Accept: "video/mp4, video/*;q=0.9, */*;q=0.1",
          Range: `bytes=0-${FIRST_CHUNK_BYTES - 1}`,
        },
        signal: ctrl.signal,
        redirect: "follow",
      });

      if (!res.ok && res.status !== 206) {
        try { await res.body?.cancel(); } catch {}
        return null;
      }

      const len = Number(res.headers.get("Content-Length") || 0);
      // Chỉ lưu vào RAM nếu máy cửa hàng trả đúng khúc cắt <= 1.5MB
      if (len > 0 && len <= FIRST_CHUNK_BYTES * 1.5) {
        const buf = await res.arrayBuffer();
        const hdrs = {};
        for (const k of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"]) {
          if (res.headers.has(k)) hdrs[k] = res.headers.get(k);
        }
        setStartupChunk(sId, buf, res.status, hdrs);
        return getStartupChunk(sId);
      } else {
        try { await res.body?.cancel(); } catch {}
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      inflightPrewarms.delete(sId);
    }
  })();

  inflightPrewarms.set(sId, job);
  return job;
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

  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Thiếu APP_PASSWORD hoặc SESSION_SECRET trong Cloudflare Pages." }, 503);
  }

  if (path === "login" && method === "POST") {
    const input = await body(request);
    if (typeof input.password !== "string" || input.password.length > 256) {
      return json({ error: "Mật khẩu không hợp lệ." }, 400);
    }
    const [candidate, expected] = await Promise.all([
      crypto.subtle.digest("SHA-256", enc.encode(input.password)),
      crypto.subtle.digest("SHA-256", enc.encode(env.APP_PASSWORD)),
    ]);
    if (b64(new Uint8Array(candidate)) !== b64(new Uint8Array(expected))) {
      return json({ error: "Mật khẩu không đúng." }, 401);
    }
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeCookie(env.SESSION_SECRET)) });
  }

  if (path === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }

  const authenticated = await authed(request, env.SESSION_SECRET);
  if (path === "me" && method === "GET") {
    return authenticated ? json({ ok: true }) : json({ error: "Cần đăng nhập." }, 401);
  }
  if (!authenticated) {
    return json({ error: "Phiên đăng nhập hết hạn." }, 401);
  }

  if (path === "status" && method === "GET") {
    if (!env.ASCAM_API_TOKEN) return json({ website: "ok", ascam: "not_configured", message: "Thiếu Token" });
    try { base(env); } catch (error) {
      return json({ website: "ok", ascam: "not_configured", message: error.message });
    }
    const result = await asc(env, "/health", { timeoutMs: 4500 });
    if (result.error) return json({ website: "ok", ascam: "unavailable", message: result.error });
    return json({ website: "ok", ascam: "connected", message: "Online" });
  }

  try {
    // 0. ENDPOINT NẠP TRƯỚC 1MB KHỞI ĐỘNG VÀO RAM WORKER KHI DI CHUỘT
    if (path === "prewarm" && method === "GET") {
      const sId = url.searchParams.get("sessionId") || "";
      if (safeSession(sId)) {
        context.waitUntil?.(warmStartupChunk(env, sId));
      }
      return json({ ok: true });
    }

    // 1. TÌM KIẾM ĐƠN HÀNG + TỰ ĐỘNG KÉO SẴN 1MB VIDEO ĐẦU TIÊN VÀO RAM WORKER
    if (path === "search" && method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 4 || query.length > 80) {
        return json({ error: "Nhập ít nhất 4 ký tự cuối hoặc mã vận đơn đầy đủ." }, 400);
      }

      const qUpper = query.toUpperCase();
      const cacheKey = `search:${qUpper}`;
      const cachedSearch = getCached(cacheKey);
      if (cachedSearch) {
        const topSid = extractFirstSessionId(cachedSearch.items?.[0]);
        if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
        return json(cachedSearch);
      }

      if (query.length >= 10 && safeCode(query)) {
        const ramHit = orderIndex.get(qUpper);
        if (ramHit && Date.now() - ramHit.at < 300000) {
          const topSid = extractFirstSessionId(ramHit.item);
          if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
          return json({ items: [ramHit.item], total: 1, scannedRecords: 1, totalRecords: 1 });
        }
        const direct = await asc(env, `/orders/${encodeURIComponent(query)}`, { timeoutMs: 5500 });
        if (!direct.error && direct.data && (direct.data.orderCode || direct.data.OrderCode || direct.data.id)) {
          const clean = sanitizeOrderPayload(direct.data);
          indexOrders([clean]);
          setCached(`order:${qUpper}`, clean, 120000);
          const payload = { items: [clean], total: 1, scannedRecords: 1, totalRecords: 1 };
          setCached(cacheKey, payload, 60000);
          // Kéo sẵn ngay 1MB video đầu tiên vào RAM trong lúc trả kết quả tìm kiếm về trình duyệt!
          const topSid = extractFirstSessionId(clean);
          if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
          return json(payload);
        }
      }

      const ramMatched = searchInRamIndex(query);

      const fastPageSize = 80;
      const first = await asc(env, `/orders?${new URLSearchParams({ q: query, search: query, page: "1", pageSize: String(fastPageSize) })}`, { timeoutMs: 6500 });
      if (first.error) {
        if (ramMatched.length > 0) {
          const topSid = extractFirstSessionId(ramMatched[0]);
          if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
          return json({ items: ramMatched, total: ramMatched.length, scannedRecords: orderIndex.size, totalRecords: orderIndex.size });
        }
        return json({ error: first.error }, first.status);
      }

      const firstItems = extractItems(first.data);
      indexOrders(firstItems);
      const totalRecords = Number(first.data?.total || first.data?.data?.total || firstItems.length);

      const isShort = query.length <= 6;
      const matchFn = item => {
        const code = String(item.orderCode || item.OrderCode || item.rawCode || "").toUpperCase();
        return isShort ? code.endsWith(qUpper) || code.includes(qUpper) : code.includes(qUpper);
      };

      let matched = [...firstItems.filter(matchFn), ...ramMatched];
      let scannedRecords = firstItems.length;

      if (matched.length === 0 && totalRecords > firstItems.length) {
        const scanPageSize = 200;
        const actualPageSize = Math.max(firstItems.length, 10);
        const totalPages = Math.max(1, Math.ceil(totalRecords / (actualPageSize >= 50 ? scanPageSize : actualPageSize)));
        const maxPages = Math.min(totalPages, 20);
        const batchSize = 5;

        for (let start = 1; start <= maxPages; start += batchSize) {
          const end = Math.min(maxPages, start + batchSize - 1);
          const promises = [];
          for (let p = start; p <= end; p++) {
            promises.push(
              asc(env, `/orders?${new URLSearchParams({ page: String(p), pageSize: String(scanPageSize) })}`, { timeoutMs: 6000 })
            );
          }
          const results = await Promise.all(promises);
          for (const res of results) {
            if (!res.error && res.data) {
              const pItems = extractItems(res.data);
              indexOrders(pItems);
              scannedRecords += pItems.length;
              matched.push(...pItems.filter(matchFn));
            }
          }
          if (matched.length > 0) break;
        }
      }

      const seen = new Set();
      const uniqueItems = [];
      for (const item of matched) {
        const code = item.orderCode || item.OrderCode || item.rawCode;
        if (code && !seen.has(code)) {
          seen.add(code);
          uniqueItems.push(sanitizeOrderPayload(item));
        }
      }

      const responsePayload = {
        items: uniqueItems,
        total: uniqueItems.length,
        scannedRecords: Math.min(totalRecords, scannedRecords),
        totalRecords,
      };
      if (uniqueItems.length > 0) {
        setCached(cacheKey, responsePayload, 45000);
        // Nạp trước ngay 1MB đầu tiên của kết quả số 1 vào RAM Worker
        const topSid = extractFirstSessionId(uniqueItems[0]);
        if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
      }
      return json(responsePayload);
    }

    // 2. CHI TIẾT ĐƠN HÀNG
    if (path === "order" && method === "GET") {
      const code = (url.searchParams.get("code") || "").trim();
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);

      const cacheKey = `order:${code.toUpperCase()}`;
      const cachedOrder = getCached(cacheKey);
      if (cachedOrder) return json(cachedOrder);

      const result = await asc(env, `/orders/${encodeURIComponent(code)}`, { timeoutMs: 6500 });
      if (result.error) return json({ error: result.error }, result.status);
      const clean = sanitizeOrderPayload(result.data);
      indexOrders([clean]);
      setCached(cacheKey, clean, 120000);
      const topSid = extractFirstSessionId(clean);
      if (topSid) context.waitUntil?.(warmStartupChunk(env, topSid));
      return json(clean);
    }

    // 3. CHẶN ENDPOINT NGUY HIỂM
    if (path === "camera-check" || path === "camera-diagnose") {
      return json({ error: "Endpoint đã khóa để bảo vệ ASCAM.", code: "UNSAFE_ENDPOINT_DISABLED" }, 410);
    }

    // 4. LẤY LINK CDN / P2P SHARE
    if (path === "share" && method === "POST") {
      const input = await body(request);
      const code = (input.orderCode || "").trim();
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);

      const role = normalizeRole(input.role || "overview");
      const sessionId = input.sessionId && safeSession(input.sessionId) ? Number(input.sessionId) : null;
      const storageMode = input.storage === "cloud" ? "cloud" : "p2p";

      const sharePayload = {
        ...(sessionId ? { sessionId } : {}),
        role,
        storage: storageMode,
        mode: storageMode,
        lang: "vi",
        theme: "dark",
      };

      const result = await asc(env, `/orders/${encodeURIComponent(code)}/share`, {
        method: "POST",
        body: JSON.stringify(sharePayload),
        timeoutMs: 12000,
      });

      if (result.error) return json({ error: result.error }, result.status);

      const data = result.data || {};
      const links = Array.isArray(data.shareLinks) ? data.shareLinks : [];

      const exactLink = links.find(l =>
        normalizeRole(l.role) === role &&
        (!sessionId || String(l.sessionId) === String(sessionId)) &&
        isLinkValid(l)
      ) || links.find(l => isLinkValid(l));

      const shareUrl = exactLink?.shareUrl || data.shareUrl || data.videoUrl || data.VideoUrl || data.url;
      if (!shareUrl) {
        return json({ error: "ASCAM chưa trả về link chia sẻ cho đơn này." }, 502);
      }

      return json({
        shareUrl,
        sessionId: exactLink?.sessionId || sessionId || null,
        expiresAt: exactLink?.expiresAt || data.shareExpiresAt || null,
        storage: exactLink?.storage || data.shareStorage || storageMode,
      });
    }

    // 5. STREAM VIDEO SIÊU TỐC: CẮT KHÚC BYTE-RANGE (1MB/2MB) & TRẢ TỨC THÌ TỪ RAM WORKER
    if ((path === "stream" || path === "download") && method === "GET") {
      if (url.searchParams.has("camId") || url.searchParams.has("cameraId")) {
        return json({ error: "Chặn tham số camId để bảo vệ ASCAM.", code: "CAMID_BLOCKED" }, 410);
      }
      const sessionId = url.searchParams.get("sessionId") || "";
      if (!safeSession(sessionId)) return json({ error: "Session ID không hợp lệ." }, 400);

      const rawRange = request.headers.get("Range") || "";
      const isStream = path === "stream";

      // Kiểm tra nếu trình duyệt đang xin khúc bắt đầu từ byte 0 (bytes=0-) và đã có sẵn trong RAM Worker -> Trả về trong 1ms!
      if (isStream && (!rawRange || rawRange === "bytes=0-" || rawRange === `bytes=0-${FIRST_CHUNK_BYTES - 1}`)) {
        let cachedChunk = getStartupChunk(sessionId);
        if (!cachedChunk && inflightPrewarms.has(sessionId)) {
          cachedChunk = await inflightPrewarms.get(sessionId);
        }
        if (cachedChunk) {
          const ramHeaders = new Headers(cachedChunk.headers);
          if (!ramHeaders.has("Content-Type")) ramHeaders.set("Content-Type", "video/mp4");
          if (!ramHeaders.has("Accept-Ranges")) ramHeaders.set("Accept-Ranges", "bytes");
          ramHeaders.set("Cache-Control", "private, max-age=86400");
          ramHeaders.set("X-AVL-Startup-Cache", "HIT");
          return new Response(cachedChunk.buffer, { status: cachedChunk.status, headers: ramHeaders });
        }
      }

      // CẮT KHÚC RANGE THÔNG MINH: Không để bytes=0- mở không giới hạn làm kẹt đường truyền máy cửa hàng!
      let effectiveRange = rawRange;
      let isRequestingStartupChunk = false;

      if (isStream) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rawRange);
        if (!rawRange) {
          effectiveRange = `bytes=0-${FIRST_CHUNK_BYTES - 1}`;
          isRequestingStartupChunk = true;
        } else if (match) {
          const start = Number(match[1]);
          const endStr = match[2];
          if (!endStr) {
            if (start === 0) {
              effectiveRange = `bytes=0-${FIRST_CHUNK_BYTES - 1}`;
              isRequestingStartupChunk = true;
            } else {
              effectiveRange = `bytes=${start}-${start + NEXT_CHUNK_BYTES - 1}`;
            }
          }
        }
      }

      // Nếu là khúc khởi động 0-1MB, dùng chung hàm warmStartupChunk để vừa chống trùng lặp vừa lưu RAM
      if (isRequestingStartupChunk) {
        const warmed = await warmStartupChunk(env, sessionId);
        if (warmed) {
          const ramHeaders = new Headers(warmed.headers);
          if (!ramHeaders.has("Content-Type")) ramHeaders.set("Content-Type", "video/mp4");
          if (!ramHeaders.has("Accept-Ranges")) ramHeaders.set("Accept-Ranges", "bytes");
          ramHeaders.set("Cache-Control", "private, max-age=86400");
          ramHeaders.set("X-AVL-Startup-Cache", "WARMED");
          return new Response(warmed.buffer, { status: warmed.status, headers: ramHeaders });
        }
      }

      const upstreamUrl = `${base(env)}/sessions/${encodeURIComponent(sessionId)}/video`;
      const headers = new Headers({
        Authorization: `Bearer ${env.ASCAM_API_TOKEN}`,
        Accept: "video/mp4, video/*;q=0.9, application/octet-stream;q=0.8, */*;q=0.1",
      });
      if (effectiveRange) headers.set("Range", effectiveRange);

      const connectController = new AbortController();
      const connectTimer = setTimeout(() => connectController.abort(), 45000);
      const streamSignal = request.signal ? AbortSignal.any([request.signal, connectController.signal]) : connectController.signal;

      let response;
      try {
        response = await fetch(upstreamUrl, {
          method: "GET",
          headers,
          signal: streamSignal,
          redirect: "follow",
        });
      } catch {
        const timedOut = connectController.signal.aborted && !request.signal?.aborted;
        return json({
          error: timedOut ? "Máy cửa hàng đang đóng gói video, đang tự động nối lại…" : "Không kết nối được luồng video.",
        }, timedOut ? 504 : 502);
      } finally {
        clearTimeout(connectTimer);
      }

      if (!response.ok && response.status !== 206) {
        try { await response.body?.cancel(); } catch {}
        return json({ error: `ASCAM HTTP ${response.status}` }, response.status);
      }

      const outputHeaders = new Headers();
      for (const key of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"]) {
        if (response.headers.has(key)) outputHeaders.set(key, response.headers.get(key));
      }
      if (!outputHeaders.has("Content-Type")) outputHeaders.set("Content-Type", "video/mp4");
      if (!outputHeaders.has("Accept-Ranges")) outputHeaders.set("Accept-Ranges", "bytes");
      outputHeaders.set("Cache-Control", "private, max-age=86400");
      outputHeaders.set("Content-Disposition", `${isStream ? "inline" : "attachment"}; filename="ASCAM-${sessionId}.mp4"`);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    }

    return json({ error: "Không tìm thấy API." }, 404);
  } catch (error) {
    return json({ error: error.message || "Lỗi máy chủ." }, 500);
  }
}
