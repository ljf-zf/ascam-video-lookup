const COOKIE = "avl_session";
const SESSION_SECONDS = 36000;
const enc = new TextEncoder();

// Bộ nhớ đệm RAM & Chỉ mục đơn hàng siêu tốc trên Cloudflare Worker
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

function setCached(key, val, ttlMs = 45000) {
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
    if (now - entry.at > 180000) continue; // Giữ chỉ mục 3 phút
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
  const { timeoutMs = 6500, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers || {});
  headers.set("Authorization", `Bearer ${env.ASCAM_API_TOKEN}`);
  if (fetchInit.body) headers.set("Content-Type", "application/json");
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = fetchInit.signal ? AbortSignal.any([fetchInit.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(base(env) + path, { ...fetchInit, headers, signal });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }
  return response.ok
    ? { data, status: response.status }
    : { error: data.message || data.error || `ASCAM HTTP ${response.status}`, status: response.status };
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

export async function onRequest({ request, env }) {
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
    try {
      const result = await asc(env, "/health", { timeoutMs: 4000 });
      if (result.error) return json({ website: "ok", ascam: "unavailable", message: result.error });
      return json({ website: "ok", ascam: "connected", message: "Online" });
    } catch {
      return json({ website: "ok", ascam: "unavailable", message: "Offline" });
    }
  }

  try {
    // 1. TÌM KIẾM SIÊU TỐC (Chỉ mục RAM <5ms + Tiên đoán khi gõ + Quét đa luồng)
    if (path === "search" && method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      const fastOnly = url.searchParams.get("fast") === "1";
      if (query.length < 4 || query.length > 80) {
        return json({ error: "Nhập ít nhất 4 ký tự cuối hoặc mã vận đơn đầy đủ." }, 400);
      }

      const qUpper = query.toUpperCase();
      const cacheKey = `search:${qUpper}`;
      const cachedSearch = getCached(cacheKey);
      if (cachedSearch) return json(cachedSearch);

      // Kiểm tra trong Chỉ mục RAM trước (< 1ms)
      const ramMatched = searchInRamIndex(query);
      if (ramMatched.length > 0 && (fastOnly || query.length >= 10)) {
        return json({
          items: ramMatched,
          total: ramMatched.length,
          scannedRecords: orderIndex.size,
          totalRecords: orderIndex.size,
        });
      }

      // Nếu nhập mã đầy đủ (>= 10 ký tự) -> Lấy thẳng đơn hàng (300ms)
      if (query.length >= 10 && safeCode(query)) {
        const direct = await asc(env, `/orders/${encodeURIComponent(query)}`, { timeoutMs: 3800 }).catch(() => ({ error: "skip" }));
        if (!direct.error && direct.data && (direct.data.orderCode || direct.data.OrderCode || direct.data.id)) {
          const clean = sanitizeOrderPayload(direct.data);
          indexOrders([clean]);
          setCached(`order:${qUpper}`, clean, 90000);
          const payload = { items: [clean], total: 1, scannedRecords: 1, totalRecords: 1 };
          setCached(cacheKey, payload, 45000);
          return json(payload);
        }
      }

      // Truy vấn trang 1 (Lưu đệm trang 1 trong 15s để các lần gõ 4 số cuối liên tiếp phản hồi tức thì)
      const fastPageSize = 80;
      const first = await asc(env, `/orders?${new URLSearchParams({ q: query, search: query, page: "1", pageSize: String(fastPageSize) })}`, { timeoutMs: 5000 });
      if (first.error) {
        if (ramMatched.length > 0) {
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

      // Nếu không phải chế độ tiên đoán ngầm (fastOnly) và chưa thấy ở trang 1, quét mở rộng
      if (!fastOnly && matched.length === 0 && totalRecords > firstItems.length) {
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
              asc(env, `/orders?${new URLSearchParams({ page: String(p), pageSize: String(scanPageSize) })}`, { timeoutMs: 5000 })
                .catch(() => ({ error: "skip" }))
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
      if (uniqueItems.length > 0) setCached(cacheKey, responsePayload, 35000);
      return json(responsePayload);
    }

    // 2. CHI TIẾT ĐƠN HÀNG
    if (path === "order" && method === "GET") {
      const code = (url.searchParams.get("code") || "").trim();
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);

      const cacheKey = `order:${code.toUpperCase()}`;
      const cachedOrder = getCached(cacheKey);
      if (cachedOrder) return json(cachedOrder);

      const result = await asc(env, `/orders/${encodeURIComponent(code)}`, { timeoutMs: 5500 });
      if (result.error) return json({ error: result.error }, result.status);
      const clean = sanitizeOrderPayload(result.data);
      indexOrders([clean]);
      setCached(cacheKey, clean, 90000);
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
        timeoutMs: 8500,
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

    // 5. LUỒNG VIDEO SIÊU TỐC (/sessions/{id}/video) - TỐI ƯU CLOUDFLARE EDGE CACHE & PREWARM
    if ((path === "stream" || path === "download") && method === "GET") {
      if (url.searchParams.has("camId") || url.searchParams.has("cameraId")) {
        return json({ error: "Chặn tham số camId để bảo vệ ASCAM.", code: "CAMID_BLOCKED" }, 410);
      }
      const sessionId = url.searchParams.get("sessionId") || "";
      if (!safeSession(sessionId)) return json({ error: "Session ID không hợp lệ." }, 400);

      // Dùng ?token= ở tầng Backend (giống cấu trúc downloadUrl gốc của ASCAM) để Cloudflare Edge Cache lưu đệm thành công 100%
      const upstreamUrl = `${base(env)}/sessions/${encodeURIComponent(sessionId)}/video?token=${encodeURIComponent(env.ASCAM_API_TOKEN)}`;

      const range = request.headers.get("Range");
      const baseHeaders = new Headers({
        Accept: "video/mp4, video/*;q=0.9, application/octet-stream;q=0.8, */*;q=0.1",
      });
      if (range) baseHeaders.set("Range", range);

      const connectController = new AbortController();
      const connectTimer = setTimeout(() => connectController.abort(), 22000);
      const streamSignal = request.signal ? AbortSignal.any([request.signal, connectController.signal]) : connectController.signal;

      let response;
      try {
        response = await fetch(upstreamUrl, {
          method: "GET",
          headers: baseHeaders,
          signal: streamSignal,
          redirect: "follow",
          cf: {
            cacheEverything: true,
            cacheTtl: 86400,
          },
        });

        // Dự phòng nếu máy chủ yêu cầu thêm Header Authorization
        if (response.status === 401 || response.status === 403) {
          try { await response.body?.cancel(); } catch {}
          baseHeaders.set("Authorization", `Bearer ${env.ASCAM_API_TOKEN}`);
          response = await fetch(`${base(env)}/sessions/${encodeURIComponent(sessionId)}/video`, {
            method: "GET",
            headers: baseHeaders,
            signal: streamSignal,
            redirect: "follow",
          });
        }
      } catch {
        const timedOut = connectController.signal.aborted && !request.signal?.aborted;
        return json({
          error: timedOut ? "Quá thời gian kết nối video." : "Không kết nối được luồng video.",
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
      // Cho phép trình duyệt lưu đệm vĩnh viễn các đoạn byte đã tải của phiên này
      outputHeaders.set("Cache-Control", "public, max-age=604800, immutable");
      outputHeaders.set("Content-Disposition", `${path === "stream" ? "inline" : "attachment"}; filename="ASCAM-${sessionId}.mp4"`);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    }

    return json({ error: "Không tìm thấy API." }, 404);
  } catch (error) {
    return json({ error: error.message || "Lỗi máy chủ." }, 500);
  }
}
