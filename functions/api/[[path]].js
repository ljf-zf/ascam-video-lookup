const COOKIE = "avl_session";
const SESSION_SECONDS = 36000;
const enc = new TextEncoder();

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
      const result = await asc(env, "/health", { timeoutMs: 5000 });
      if (result.error) return json({ website: "ok", ascam: "unavailable", message: result.error });
      return json({ website: "ok", ascam: "connected", message: "Online" });
    } catch {
      return json({ website: "ok", ascam: "unavailable", message: "Offline" });
    }
  }

  try {
    // 1. TÌM KIẾM ĐƠN HÀNG SIÊU TỐC (Hỗ trợ cả mã đầy đủ & 4 số cuối)
    if (path === "search" && method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 4 || query.length > 80) {
        return json({ error: "Nhập ít nhất 4 ký tự cuối hoặc mã vận đơn đầy đủ." }, 400);
      }

      // Nếu nhập mã đầy đủ (>= 10 ký tự), lấy trực tiếp đơn hàng trong 1 bước
      if (query.length >= 10 && safeCode(query)) {
        const direct = await asc(env, `/orders/${encodeURIComponent(query)}`, { timeoutMs: 4500 }).catch(() => ({ error: "skip" }));
        if (!direct.error && direct.data && (direct.data.orderCode || direct.data.OrderCode || direct.data.id)) {
          return json({
            items: [sanitizeOrderPayload(direct.data)],
            total: 1,
            scannedRecords: 1,
            totalRecords: 1,
          });
        }
      }

      const pageSize = 200;
      const first = await asc(env, `/orders?${new URLSearchParams({ q: query, page: "1", pageSize: String(pageSize) })}`, { timeoutMs: 7000 });
      if (first.error) return json({ error: first.error }, first.status);

      const firstItems = extractItems(first.data);
      const actualPageSize = Math.max(firstItems.length, 10);
      const totalRecords = Number(first.data?.total || first.data?.data?.total || firstItems.length);
      const totalPages = Math.max(1, Math.ceil(totalRecords / actualPageSize));

      const qUpper = query.toUpperCase();
      const isShort = query.length <= 6;
      const matchFn = item => {
        const code = String(item.orderCode || item.OrderCode || item.rawCode || "").toUpperCase();
        return isShort ? code.endsWith(qUpper) || code.includes(qUpper) : code.includes(qUpper);
      };

      let matched = firstItems.filter(matchFn);
      let scannedRecords = firstItems.length;

      // Quét theo lô 5 trang nếu tìm 4 số cuối chưa thấy ở trang 1, dừng ngay lập tức khi tìm thấy
      if (matched.length === 0 && totalPages > 1) {
        const maxPages = Math.min(totalPages, 25);
        const batchSize = 5;
        for (let start = 2; start <= maxPages; start += batchSize) {
          const end = Math.min(maxPages, start + batchSize - 1);
          const promises = [];
          for (let p = start; p <= end; p++) {
            promises.push(
              asc(env, `/orders?${new URLSearchParams({ page: String(p), pageSize: String(pageSize) })}`, { timeoutMs: 6000 })
                .catch(() => ({ error: "skip" }))
            );
          }
          const results = await Promise.all(promises);
          for (const res of results) {
            if (!res.error && res.data) {
              const pItems = extractItems(res.data);
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

      return json({
        items: uniqueItems,
        total: uniqueItems.length,
        scannedRecords: Math.min(totalRecords, scannedRecords),
        totalRecords,
      });
    }

    // 2. CHI TIẾT ĐƠN HÀNG
    if (path === "order" && method === "GET") {
      const code = (url.searchParams.get("code") || "").trim();
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);
      const result = await asc(env, `/orders/${encodeURIComponent(code)}`, { timeoutMs: 7000 });
      if (result.error) return json({ error: result.error }, result.status);
      return json(sanitizeOrderPayload(result.data));
    }

    // 3. CHẶN CỨNG CÁC ENDPOINT GÂY TREO ASCAM
    if (path === "camera-check" || path === "camera-diagnose") {
      return json({ error: "Endpoint đã khóa để bảo vệ ASCAM.", code: "UNSAFE_ENDPOINT_DISABLED" }, 410);
    }

    // 4. LẤY LINK CDN / P2P SHARE NHANH (1A)
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
        timeoutMs: 10000,
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

    // 5. LUỒNG VIDEO TRỰC TIẾP (/sessions/{id}/video) - HỖ TRỢ HTTP 206 & BỘ ĐỆM MƯỢT
    if ((path === "stream" || path === "download") && method === "GET") {
      if (url.searchParams.has("camId") || url.searchParams.has("cameraId")) {
        return json({ error: "Chặn tham số camId để bảo vệ ASCAM.", code: "CAMID_BLOCKED" }, 410);
      }
      const sessionId = url.searchParams.get("sessionId") || "";
      if (!safeSession(sessionId)) return json({ error: "Session ID không hợp lệ." }, 400);

      // Tuyệt đối dùng /sessions/{id}/video để xem trực tiếp, không gọi ?merged=1 khi stream
      const upstreamPath = `/sessions/${encodeURIComponent(sessionId)}/video`;

      const headers = new Headers({
        Authorization: `Bearer ${env.ASCAM_API_TOKEN}`,
        Accept: "video/mp4, video/*;q=0.9, application/octet-stream;q=0.8, */*;q=0.1",
      });
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);

      const connectController = new AbortController();
      const connectTimer = setTimeout(() => connectController.abort(), 30000);
      const streamSignal = request.signal ? AbortSignal.any([request.signal, connectController.signal]) : connectController.signal;

      let response;
      try {
        response = await fetch(base(env) + upstreamPath, {
          method: "GET",
          headers,
          signal: streamSignal,
          redirect: "follow",
        });
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
      outputHeaders.set("Cache-Control", "private, max-age=3600");
      outputHeaders.set("Content-Disposition", `${path === "stream" ? "inline" : "attachment"}; filename="ASCAM-${sessionId}.mp4"`);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    }

    return json({ error: "Không tìm thấy API." }, 404);
  } catch (error) {
    return json({ error: error.message || "Lỗi máy chủ." }, 500);
  }
}
