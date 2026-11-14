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
  } catch { return false; }
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
    throw new Error("ASCAM_API_BASE chưa được cấu hình bằng địa chỉ HTTPS Tunnel thật.");
  }
  return value.endsWith("/api/v1") ? value : value + "/api/v1";
}
async function asc(env, path, init = {}) {
  if (!env.ASCAM_API_TOKEN) throw new Error("Chưa cấu hình ASCAM_API_TOKEN.");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.ASCAM_API_TOKEN}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(base(env) + path, { ...init, headers });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }
  return response.ok
    ? { data, status: response.status }
    : { error: data.message || data.error || `ASCAM HTTP ${response.status}`, status: response.status };
}
const safeCode = value => typeof value === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(value);
const safeSession = value => /^\d{6,30}$/.test(String(value || ""));

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method.toUpperCase();

  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Thiếu APP_PASSWORD hoặc SESSION_SECRET trong Pages Secrets." }, 503);
  }

  if (path === "login" && method === "POST") {
    const input = await body(request);
    if (typeof input.password !== "string" || input.password.length > 256) return json({ error: "Mật khẩu không hợp lệ." }, 400);
    const [candidate, expected] = await Promise.all([
      crypto.subtle.digest("SHA-256", enc.encode(input.password)),
      crypto.subtle.digest("SHA-256", enc.encode(env.APP_PASSWORD)),
    ]);
    if (b64(new Uint8Array(candidate)) !== b64(new Uint8Array(expected))) return json({ error: "Mật khẩu không đúng." }, 401);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await makeCookie(env.SESSION_SECRET)) });
  }
  if (path === "logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });

  const authenticated = await authed(request, env.SESSION_SECRET);
  if (path === "me" && method === "GET") return authenticated ? json({ ok: true }) : json({ error: "Cần đăng nhập." }, 401);
  if (!authenticated) return json({ error: "Phiên đăng nhập hết hạn." }, 401);

  if (path === "status" && method === "GET") {
    if (!env.ASCAM_API_TOKEN) return json({ website: "ok", ascam: "not_configured", message: "Chưa cấu hình ASCAM_API_TOKEN." });
    let apiBase;
    try { apiBase = base(env); } catch (error) {
      return json({ website: "ok", ascam: "not_configured", message: error.message });
    }
    try {
      const result = await asc(env, "/health", { signal: AbortSignal.timeout(7000) });
      if (result.error) return json({ website: "ok", ascam: "unavailable", message: result.error, httpStatus: result.status });
      return json({ website: "ok", ascam: "connected", message: "ASCAM API phản hồi bình thường." });
    } catch (error) {
      return json({ website: "ok", ascam: "unavailable", message: error.name === "TimeoutError" ? "ASCAM không phản hồi trong 7 giây." : error.message });
    }
  }

  try {
    if (path === "search" && method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 4 || query.length > 80) return json({ error: "Nhập mã đơn đầy đủ hoặc ít nhất 4 số cuối." }, 400);
      const result = await asc(env, `/orders?${new URLSearchParams({ q: query, page: "1", pageSize: "500" })}`);
      if (result.error) return json({ error: result.error }, result.status);
      const data = result.data;
      let items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.data?.items) ? data.data.items : [];
      if (/^\d{4}$/.test(query)) items = items.filter(item => String(item.orderCode || item.OrderCode || "").includes(query));
      return json({ items, total: items.length, page: data.page || data.data?.page || 1, pageSize: data.pageSize || data.data?.pageSize || 500, limitedToFirstPage: true });
    }
    if (path === "order" && method === "GET") {
      const code = url.searchParams.get("code") || "";
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);
      const result = await asc(env, `/orders/${encodeURIComponent(code)}`);
      return result.error ? json({ error: result.error }, result.status) : json(result.data);
    }
    if (path === "camera-check" && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "";
      const camId = url.searchParams.get("camId") || "";
      if (!safeSession(sessionId)) return json({ error: "Session ID không hợp lệ." }, 400);
      // Only probe role names present in the ASCAM session payload. These are
      // candidates, not assumed camera IDs; the response tells us whether ASCAM accepts them.
      if (!["overview", "waybill"].includes(camId)) return json({ error: "Camera candidate không hợp lệ." }, 400);
      const headers = new Headers({
        Authorization: `Bearer ${env.ASCAM_API_TOKEN}`,
        Range: "bytes=0-0",
        Accept: "video/mp4, application/octet-stream;q=0.9, */*;q=0.1",
      });
      let upstream;
      try {
        upstream = await fetch(base(env) + `/videos/${encodeURIComponent(sessionId)}/download?camId=${encodeURIComponent(camId)}`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(9000),
          redirect: "follow",
        });
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        return json({
          ok: false,
          sessionId,
          camId,
          result: timedOut ? "timeout" : "network_error",
          message: timedOut ? "ASCAM không phản hồi trong 9 giây." : "Không kết nối được ASCAM qua Tunnel.",
        }, 502);
      }
      const result = {
        ok: upstream.status === 206 || upstream.status === 200,
        sessionId,
        camId,
        httpStatus: upstream.status,
        contentType: upstream.headers.get("Content-Type") || "",
        contentRange: upstream.headers.get("Content-Range") || "",
        acceptRanges: upstream.headers.get("Accept-Ranges") || "",
        contentLength: upstream.headers.get("Content-Length") || "",
        rangeHonored: upstream.status === 206,
        message: upstream.status === 206
          ? "ASCAM chấp nhận Range; ứng viên camId trả về một phần video."
          : upstream.status === 200
            ? "ASCAM trả HTTP 200. Máy chủ đã hủy body ngay sau khi nhận header; cần xác minh Range có được hỗ trợ không."
            : upstream.status === 400
              ? "ASCAM từ chối tham số camId hoặc yêu cầu."
              : upstream.status === 401 || upstream.status === 403
                ? "ASCAM từ chối xác thực API."
                : upstream.status === 404
                  ? "Không tìm thấy video hoặc camId này không được nhận diện."
                  : `ASCAM trả HTTP ${upstream.status}.`,
      };
      // Never read or buffer the MP4 response. Cancel immediately after headers.
      try { await upstream.body?.cancel(); } catch { /* stream may already be closed */ }
      return json(result, 200);
    }
    if (path === "share" && method === "POST") {
      const input = await body(request);
      const code = input.orderCode || "";
      if (!safeCode(code)) return json({ error: "Mã đơn không hợp lệ." }, 400);
      // ASCAM's verified share request is order-level. Do not claim session-specific
      // sharing until the API contract explicitly supports a sessionId parameter.
      const result = await asc(env, `/orders/${encodeURIComponent(code)}/share`, {
        method: "POST",
        body: JSON.stringify({ storage: "cloud", role: "merged", lang: "vi", theme: "dark" }),
      });
      if (result.error) return json({ error: result.error }, result.status);
      if (!result.data.shareUrl && !result.data.shareURL) return json({ error: "ASCAM không trả shareUrl." }, 502);
      return json({ ...result.data, shareScope: "order", note: "Link được tạo theo đơn hàng bằng API ASCAM đã xác minh; chưa xác nhận API hỗ trợ chọn session riêng." });
    }
    if ((path === "download" || path === "stream") && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "";
      if (!safeSession(sessionId)) return json({ error: "Session ID không hợp lệ." }, 400);
      const headers = new Headers({ Authorization: `Bearer ${env.ASCAM_API_TOKEN}` });
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);
      const response = await fetch(base(env) + `/videos/${sessionId}/download?merged=1`, { headers });
      if (!response.ok && response.status !== 206) return json({ error: `ASCAM trả HTTP ${response.status} khi tải video.` }, response.status);
      const outputHeaders = new Headers();
      for (const key of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"]) {
        if (response.headers.has(key)) outputHeaders.set(key, response.headers.get(key));
      }
      outputHeaders.set("Cache-Control", "private, no-store");
      outputHeaders.set("Content-Disposition", `${path === "stream" ? "inline" : "attachment"}; filename="ASCAM-${sessionId}.mp4"`);
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    }
    return json({ error: "Không tìm thấy API." }, 404);
  } catch (error) {
    return json({ error: error.message || "Lỗi máy chủ." }, 500);
  }
}
