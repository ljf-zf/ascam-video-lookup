const $ = id => document.getElementById(id);
const HISTORY = "avl-history-v1";
const BOOKMARKS = "avl-bookmarks-v1";
let selectedOrder = null;
let selectedSession = null;
let selectedSessions = [];
let lastShare = null;
// The ASCAM share API exposes documented roles: main (primary), sub (secondary), merged.
let selectedPlaybackMode = "merged";

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}
function statusLabel(value) {
  return ({ completed: "Đã đóng gói", recording: "Đang ghi hình", cancelled: "Đã hủy" })[value] || value || "Không rõ";
}
function note(message, error = false) {
  const element = $("notice");
  element.textContent = message;
  element.classList.remove("hidden", "error");
  if (error) element.classList.add("error");
}
function clearNote() { $("notice").classList.add("hidden"); }
function setAuthStatus(connected) {
  const element = $("authStatus");
  element.innerHTML = `<i></i>${connected ? "Đã đăng nhập" : "Chưa đăng nhập"}`;
  element.classList.toggle("is-online", connected);
}
function setAscamStatus(state, message) {
  const element = $("ascamStatus");
  const labels = { connected: "ASCAM đang kết nối", unavailable: "ASCAM ngoại tuyến", not_configured: "ASCAM chưa cấu hình", checking: "Đang kiểm tra ASCAM", unknown: "ASCAM chưa kiểm tra" };
  element.innerHTML = `<i></i><span>${esc(message || labels[state] || labels.unknown)}</span>`;
  element.classList.remove("is-online", "is-offline", "is-error", "status-unknown");
  element.classList.add(state === "connected" ? "is-online" : state === "unavailable" ? "is-offline" : state === "not_configured" ? "is-error" : "status-unknown");
  element.title = message || labels[state] || "";
  const top = $("ascamStatusTop");
  if (top) { top.innerHTML = `<i></i><span>${esc(message || labels[state] || labels.unknown)}</span>`; top.className = element.className; top.title = element.title; }
}
function loginView() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logout").classList.add("hidden");
  setAuthStatus(false);
  setAscamStatus("unknown");
}
function appView() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  setAuthStatus(true);
}
async function api(path, options = {}) {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = fetchOptions.signal ? AbortSignal.any([fetchOptions.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch("/api/" + path, {
    credentials: "same-origin",
    ...fetchOptions,
    signal,
    headers: { ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}), ...(fetchOptions.headers || {}) },
  });
  const data = await response.json().catch(() => ({ error: "Phản hồi máy chủ không hợp lệ." }));
  if (response.status === 401 && path !== "login") {
    loginView();
    throw new Error(data.error || "Phiên đăng nhập hết hạn.");
  }
  if (!response.ok) throw new Error(data.error || `Lỗi ${response.status}`);
  return data;
}
async function refreshAscamStatus() {
  setAscamStatus("checking");
  try {
    const result = await api("status");
    setAscamStatus(result.ascam || "unknown", result.message);
    return result;
  } catch (error) {
    setAscamStatus("unavailable", error.message);
    return { ascam: "unavailable", message: error.message };
  }
}
function historyItems() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function saveHistory(code) {
  try {
    localStorage.setItem(HISTORY, JSON.stringify([{ code, at: new Date().toISOString() }, ...historyItems().filter(item => item.code !== code)].slice(0, 8)));
  } catch { /* Private browsing/storage restrictions should not break lookup. */ }
  renderHistory();
}
function renderHistory() {
  const items = historyItems();
  $("historyList").innerHTML = items.length
    ? items.map(item => `<button class="history-item" data-code="${esc(item.code)}"><b>${esc(item.code)}</b><small>${date(item.at)} ↗</small></button>`).join("")
    : '<span class="empty-history">Chưa có lịch sử tìm kiếm.</span>';
  $("historyList").querySelectorAll("[data-code]").forEach(button => button.addEventListener("click", () => { showView("home"); loadOrder(button.dataset.code); }));
  const home = $("homeHistory");
  if (home) { home.innerHTML = items.slice(0,4).map(item => `<button class="history-item" data-home-code="${esc(item.code)}"><span><b>${esc(item.code)}</b><small>${date(item.at)}</small></span><span>↗</span></button>`).join("") || '<span class="empty-history">Chưa có lịch sử tìm kiếm.</span>'; home.querySelectorAll("[data-home-code]").forEach(button => button.addEventListener("click", () => loadOrder(button.dataset.homeCode))); }
  const badge = $("historyBadge"); if (badge) badge.textContent = items.length;
}
function itemsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items;
  return [];
}
function sessionsOf(data) {
  if (Array.isArray(data?.sessions)) return data.sessions;
  if (Array.isArray(data?.order?.sessions)) return data.order.sessions;
  if (Array.isArray(data?.data?.sessions)) return data.data.sessions;
  return [];
}
function resultCard(order, index) {
  const code = order.orderCode || order.OrderCode || order.rawCode || "Chưa có mã đơn";
  const station = order.stationName || order.stationId || "Chưa rõ bàn";
  const when = order.packedAt || order.startedAt || order.createdAt;
  const cameras = order.cameraCount ?? "—";
  return `<button class="result-card" data-index="${index}"><span class="result-primary"><b class="order-code">${esc(code)}</b><span class="result-meta"><span>${esc(station)}</span><span>${date(when)}</span><span>${esc(cameras)} camera</span></span></span><span class="state-tag ${order.status === "completed" ? "good" : order.status === "recording" ? "warn" : ""}">${esc(statusLabel(order.status))}</span></button>`;
}
async function search(query) {
  clearNote();
  const normalized = query.trim();
  if (normalized.length < 4) return note("Nhập mã đơn đầy đủ hoặc ít nhất 4 số cuối.", true);
  const button = $("searchForm").querySelector("button");
  button.disabled = true;
  button.innerHTML = "Đang tìm…";
  $("detailSection").classList.add("hidden");
  try {
    const data = await api("search?q=" + encodeURIComponent(normalized));
    let items = itemsOf(data);
    if (/^\d{4}$/.test(normalized)) items = items.filter(item => String(item.orderCode || item.OrderCode || "").includes(normalized));
    $("resultsSection").classList.remove("hidden");
    $("resultCount").textContent = `${items.length} kết quả`;
    $("results").innerHTML = items.length ? items.map(resultCard).join("") : '<div class="notice">Không tìm thấy đơn phù hợp trong kết quả ASCAM trả về.</div>';
    $("results").querySelectorAll("[data-index]").forEach(element => {
      element.addEventListener("click", () => {
        const item = items[Number(element.dataset.index)];
        loadOrder(item.orderCode || item.OrderCode || item.rawCode || "");
      });
    });
    if (!items.length) note("Không tìm thấy đơn. Thử mã đầy đủ hoặc kiểm tra lại 4 số cuối.");
    else if (data.limitedToFirstPage) note("Đang hiển thị dữ liệu từ trang đầu ASCAM (tối đa 500 bản ghi). Nếu đơn cũ hơn không xuất hiện, cần bổ sung phân trang theo API ASCAM.");
  } catch (error) {
    note(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Tìm kiếm <span>→</span>';
  }
}
function shareRoleForPlayback(mode = selectedPlaybackMode) {
  // ASCAM docs: main = primary angle (configured first: Overview); sub = secondary angle (Waybill).
  return mode === "overview" ? "main" : mode === "waybill" ? "sub" : "merged";
}
function updateShareButton() {
  const button = $("createShare");
  if (!button) return;
  const labels = {
    overview: "Xem ngay P2P · Toàn cảnh",
    waybill: "Xem ngay P2P · Vận đơn",
    merged: "Tạo video ghép ASC-Cloud",
  };
  button.innerHTML = `${labels[selectedPlaybackMode] || labels.merged} <span>↗</span>`;
}
function resetVideo() {
  lastShare = null;
  selectedPlaybackMode = "merged";
  $("videoPlaceholder").classList.remove("hidden");
  $("videoFrameWrap").classList.add("hidden");
  $("videoLinks").classList.add("hidden");
  $("openShare").classList.add("hidden");
  $("shareResult").classList.add("hidden");
  $("videoPanelTitle").textContent = "Xem video đóng gói";
  const player = $("videoPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
  const frame = $("shareFrame"); if (frame) { frame.src = "about:blank"; frame.classList.add("hidden"); }
  player.classList.remove("hidden");
  $("downloadVideo").classList.remove("hidden");
  document.querySelectorAll("[data-play-camera]").forEach(button => button.classList.remove("is-playing"));
  updateShareButton();
}
function selectedCameraEntries() {
  const sessionId = String(selectedSession?.sessionId || selectedSession?.id || "");
  const orderSessions = Array.isArray(selectedOrder?.sessions) ? selectedOrder.sessions : [];
  const matchingOrderSession = orderSessions.find(item => String(item?.sessionId || item?.id || "") === sessionId);
  const candidates = [
    selectedSession?.cameras, selectedSession?.Cameras,
    matchingOrderSession?.cameras, matchingOrderSession?.Cameras,
    selectedOrder?.cameras, selectedOrder?.Cameras,
  ];
  return candidates.find(items => Array.isArray(items) && items.length) || [];
}
function normalizedCameraRole(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function cameraIdFromEntry(camera) {
  const direct = camera?.cameraId ?? camera?.camId ?? camera?.id;
  if (direct !== undefined && direct !== null && /^\d{1,10}$/.test(String(direct))) return String(direct);
  const urlValue = camera?.downloadUrl || camera?.downloadURL || camera?.url || "";
  if (urlValue) {
    try {
      const parsed = new URL(urlValue, location.origin);
      const fromUrl = parsed.searchParams.get("camId");
      if (fromUrl && /^\d{1,10}$/.test(fromUrl)) return fromUrl;
    } catch { /* URL field may be relative or omitted. */ }
  }
  return "";
}
function cameraDetailsForMode(mode) {
  if (mode === "merged") return null;
  const entries = selectedCameraEntries();
  const roles = mode === "overview"
    ? new Set(["overview", "main", "primary", "toancanh"])
    : new Set(["waybill", "scanner", "sub", "secondary", "soima", "vandon"]);
  let chosen = entries.find(camera => roles.has(normalizedCameraRole(camera?.role || camera?.cameraRole || camera?.type)));
  if (!chosen && entries.length >= 2) chosen = entries[mode === "overview" ? 0 : 1];
  const fromApi = chosen ? cameraIdFromEntry(chosen) : "";
  if (fromApi) {
    return {
      id: fromApi,
      name: chosen?.cameraName || chosen?.name || (mode === "overview" ? "Toàn cảnh" : "Soi mã vận đơn"),
      role: chosen?.role || "",
      source: "ASCAM cameras[]",
    };
  }
  // ASCAM Open API documentation example 4.2 shows cameras[].cameraId=1 (overview)
  // and cameraId=2 (scanner/waybill), with downloadUrl using ?camId=1 / ?camId=2.
  return {
    id: mode === "overview" ? "1" : "2",
    name: mode === "overview" ? "Toàn cảnh" : "Soi mã vận đơn",
    role: mode === "overview" ? "overview" : "scanner/waybill",
    source: "API sample fallback (1/2)",
  };
}
function cameraIdForMode(mode) {
  return mode === "merged" ? "" : cameraDetailsForMode(mode).id;
}
function playbackUrl(mode, download = false) {
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  if (!sessionId || !/^\d{6,30}$/.test(String(sessionId))) throw new Error("Phiên đang chọn không có Session ID hợp lệ.");
  const params = new URLSearchParams({ sessionId: String(sessionId) });
  if (mode !== "merged") params.set("camId", cameraIdForMode(mode));
  return `/api/${download ? "download" : "stream"}?${params.toString()}`;
}
async function playVideo(mode, button = null) {
  if (!selectedSession) return note("Hãy chọn phiên đóng gói trước.", true);
  if (selectedSession.status === "recording") return note("Phiên đang ghi hình. Hãy đợi ASCAM hoàn tất.", true);
  if (!["overview", "waybill", "merged"].includes(mode)) return;
  const player = $("videoPlayer"), frame = $("shareFrame");
  const label = mode === "overview" ? "Camera Overview" : mode === "waybill" ? "Camera Waybill" : "Video ghép";
  selectedPlaybackMode = mode; updateShareButton();
  if (button) button.disabled = true;
  try {
    if (mode === "overview" || mode === "waybill") {
      // Never call the observed hanging /videos/{id}/download?camId=... route.
      // Use ASCAM's order-level P2P role API instead.
      const role = mode === "overview" ? "main" : "sub";
      const data = await api("share", { method: "POST", timeoutMs: 15000,
        body: JSON.stringify({ orderCode: currentOrderCode(), role, mode: "p2p" }) });
      const shareUrl = data.shareUrl || data.shareURL || data.p2pUrl || data.url;
      if (!shareUrl) throw new Error("ASCAM không trả URL P2P cho góc camera này.");
      lastShare = data;
      player.pause(); player.removeAttribute("src"); player.load(); player.classList.add("hidden");
      frame.src = shareUrl; frame.classList.remove("hidden");
      $("videoPlaceholder").classList.add("hidden"); $("videoFrameWrap").classList.remove("hidden");
      $("videoLinks").classList.remove("hidden"); $("videoPanelTitle").textContent = label;
      $("openShare").href = shareUrl; $("openShare").textContent = "Mở video trực tiếp ↗"; $("openShare").classList.remove("hidden");
      $("downloadVideo").classList.add("hidden");
      const multiSession = selectedSessions.length > 1 ? " Lưu ý: API chia sẻ xác nhận ở cấp đơn hàng, chưa có sessionId; đơn nhiều phiên có thể mở phiên khác." : "";
      $("videoFootnote").textContent = `P2P role=${role}; không tạo MP4 ghép/không upload ASC-Cloud trước.${multiSession}`;
      $("shareResult").innerHTML = `<b>✓ Đã cấp link P2P · ${esc(label)}</b><br><a href="${esc(shareUrl)}" target="_blank" rel="noopener">Mở video trong tab mới ↗</a><small>Không gọi endpoint tải video theo camId để tránh làm treo ASCAM.</small>`;
      $("shareResult").classList.remove("hidden");
      document.querySelectorAll("[data-play-camera]").forEach(item => item.classList.toggle("is-playing", item.dataset.playCamera === mode));
      note(`Đã nhận link P2P ${label}. Nếu khung xem không hiển thị do ASCAM chặn nhúng, bấm “Mở video trực tiếp”.`);
      return;
    }
    frame.src = "about:blank"; frame.classList.add("hidden"); player.classList.remove("hidden");
    player.pause(); player.src = playbackUrl("merged"); player.load();
    $("videoPlaceholder").classList.add("hidden"); $("videoFrameWrap").classList.remove("hidden");
    $("videoLinks").classList.remove("hidden"); $("videoPanelTitle").textContent = label;
    $("videoFootnote").textContent = "Đang phát video ghép ASCAM. Đây có thể là luồng cần xử lý lâu hơn; dùng Overview/Waybill P2P để kiểm tra nhanh.";
    $("downloadVideo").href = playbackUrl("merged", true);
    $("downloadVideo").download = `ASCAM-${selectedSession.sessionId || selectedSession.id}-merged.mp4`;
    $("downloadVideo").classList.remove("hidden"); $("openShare").classList.add("hidden");
    document.querySelectorAll("[data-play-camera]").forEach(item => item.classList.toggle("is-playing", item.dataset.playCamera === mode));
    const playPromise = player.play(); if (playPromise?.catch) await playPromise.catch(() => {});
    note("Đã gửi yêu cầu phát video ghép.");
  } catch (error) { note(error.message || "Không thể mở video.", true); }
  finally { if (button) button.disabled = false; }
}
function renderOrder(data, requestedCode) {
  selectedOrder = data?.order || data?.data?.order || data;
  selectedSessions = sessionsOf(data);
  if (!selectedSessions.length) selectedSessions = [selectedOrder];
  selectedSession = selectedSessions[0] || null;
  if ($("cameraProbeResults")) $("cameraProbeResults").textContent = "Chưa chạy kiểm tra.";
  const latest = selectedSessions[0] || {};
  const code = selectedOrder.orderCode || selectedOrder.OrderCode || requestedCode;
  $("detailCode").textContent = code || "Đơn hàng";
  $("detailStatus").textContent = statusLabel(latest.status || selectedOrder.status);
  $("detailStatus").className = "state-tag " + ((latest.status || selectedOrder.status) === "completed" ? "good" : (latest.status || selectedOrder.status) === "recording" ? "warn" : "");
  const meta = [
    ["Bàn đóng gói", latest.stationName || latest.stationId || "—"],
    ["Nhân viên", latest.packerName || latest.packer || "—"],
    ["Thời gian", date(latest.packedAt || latest.startedAt || latest.createdAt)],
    ["Số camera", latest.cameraCount ?? selectedOrder.cameraCount ?? "—"],
    ["Số phiên", selectedSessions.length],
  ];
  $("orderMeta").innerHTML = meta.map(([label, value]) => `<div class="meta-cell"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("");
  $("sessionCount").textContent = `${selectedSessions.length} phiên`;
  $("sessions").innerHTML = selectedSessions.map((session, index) => {
    const id = session.sessionId || session.id || "—";
    return `<button class="session-card ${index === 0 ? "selected" : ""}" data-session-index="${index}"><span class="session-primary"><b class="session-id">SESSION ${esc(id)}</b><span class="session-meta"><span>${date(session.packedAt || session.startedAt || session.createdAt)}</span><span>${esc(session.durationSec ?? "—")} giây</span><span>${esc(session.cameraCount ?? "—")} camera</span></span></span><span class="state-tag ${session.status === "completed" ? "good" : session.status === "recording" ? "warn" : ""}">${esc(statusLabel(session.status))}</span></button>`;
  }).join("");
  $("sessions").querySelectorAll("[data-session-index]").forEach(button => button.addEventListener("click", () => {
    $("sessions").querySelectorAll(".session-card").forEach(item => item.classList.remove("selected"));
    button.classList.add("selected");
    selectedSession = selectedSessions[Number(button.dataset.sessionIndex)];
    $("cameraProbeResults").textContent = "Chưa chạy kiểm tra.";
    resetVideo();
    updateSessionHint();
  }));
  updateSessionHint();
  $("detailSection").classList.remove("hidden");
  resetVideo();
  saveHistory(code);
  updateBookmarkButton();
}
function renderCameraProbeResult(result) {
  const ok = result.ok === true && result.httpStatus === 206 && result.sampleBytes > 0;
  const status = result.httpStatus ? `HTTP ${result.httpStatus}` : (result.result || "Lỗi");
  const details = [
    result.camId ? `camId: ${result.camId}` : result.mode === "merged" ? "mode: merged=1" : "",
    result.requestedRange || "",
    result.contentRange ? `Content-Range: ${result.contentRange}` : "",
    result.cacheMode ? `Cache: ${result.cacheMode}` : "",
    result.upstreamCacheStatus ? `CDN: ${result.upstreamCacheStatus}` : "",
    result.upstreamAge ? `Age: ${result.upstreamAge}` : "",
    result.upstreamCacheControl ? `Cache-Control: ${result.upstreamCacheControl}` : "",
    result.contentType ? `Content-Type: ${result.contentType}` : "",
    Number.isFinite(result.sampleBytes) ? `Đã đọc: ${result.sampleBytes}/${result.expectedBytes ?? "?"} byte` : "",
    result.sampleSha256 ? `SHA-256: ${result.sampleSha256}` : "",
    result.etag ? `ETag: ${result.etag}` : "",
    Number.isFinite(result.redirectCount) ? `Redirect: ${result.redirectCount}` : "",
    result.finalUrl?.origin && result.finalUrl?.pathname ? `Đích cuối: ${result.finalUrl.origin}${result.finalUrl.pathname}` : "",
    result.finalUrl?.safeQuery?.camId ? `camId cuối: ${result.finalUrl.safeQuery.camId}` : "",
    result.finalUrl?.safeQuery?.merged ? `merged cuối: ${result.finalUrl.safeQuery.merged}` : "",
    result.redirectedToMerged ? "BỊ CHUYỂN SANG VIDEO GHÉP" : "",
    Number.isFinite(result.responseMs) ? `${result.responseMs} ms` : "",
  ].filter(Boolean).join(" · ");
  const redirects = Array.isArray(result.redirectChain) && result.redirectChain.length
    ? result.redirectChain.map((hop, index) => `#${index + 1} HTTP ${hop.status} → ${hop.target?.origin || ""}${hop.target?.pathname || ""}${hop.target?.safeQuery?.camId ? `?camId=${hop.target.safeQuery.camId}` : hop.target?.safeQuery?.merged ? `?merged=${hop.target.safeQuery.merged}` : ""}`).join(" | ")
    : "";
  return `<div class="camera-probe-row ${ok ? "probe-good" : "probe-bad"}"><div><b>${esc(result.camId || (result.mode === "merged" ? "merged=1" : "Nguồn video"))}</b><span>${esc(status)}</span></div><p>${esc(result.message || "Không có thông tin.")}</p>${redirects ? `<small>${esc(redirects)}</small>` : ""}${details ? `<small>${esc(details)}</small>` : ""}</div>`;
}
let probeBusy = false;
async function diagnoseVideoSource(mode, buttonId) {
  if (probeBusy) return note("Đang chẩn đoán nguồn video khác. Vui lòng đợi hoàn tất.", true);
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  if (!sessionId || !/^\d{6,30}$/.test(String(sessionId))) return note("Phiên đang chọn không có Session ID hợp lệ.", true);
  if (selectedSession?.status === "recording") return note("Không kiểm tra video của phiên đang ghi hình. Hãy chọn phiên đã hoàn tất.", true);
  if (!["overview", "waybill", "merged"].includes(mode)) return;
  const cameraInfo = mode === "merged" ? null : cameraDetailsForMode(mode);
  const button = $(buttonId);
  const output = $("cameraProbeResults");
  const modeLabel = mode === "overview" ? "Overview" : mode === "waybill" ? "Waybill" : "Video ghép";
  const camId = cameraInfo?.id || "";
  probeBusy = true;
  document.querySelectorAll("#probeOverview,#probeWaybill,#probeMerged,#probeAll").forEach(item => { item.disabled = true; });
  const originalText = button.textContent;
  button.textContent = "Đang lấy mẫu…";
  output.insertAdjacentHTML("afterbegin", `<div class="camera-probe-row probe-pending"><b>${esc(camId || "merged=1")}</b><p>Đang yêu cầu tối đa 64 KB từ nguồn ${esc(modeLabel)}…</p></div>`);
  try {
    const params = new URLSearchParams({ sessionId: String(sessionId), mode });
    if (cameraInfo) params.set("cameraId", cameraInfo.id);
    const result = await api(`camera-diagnose?${params.toString()}`, { timeoutMs: 25000 });
    const pending = [...output.querySelectorAll(".camera-probe-row")].find(row => row.classList.contains("probe-pending"));
    if (pending) pending.outerHTML = renderCameraProbeResult(result);
    else output.insertAdjacentHTML("afterbegin", renderCameraProbeResult(result));
  } catch (error) {
    const pending = [...output.querySelectorAll(".camera-probe-row")].find(row => row.classList.contains("probe-pending"));
    const failed = `<div class="camera-probe-row probe-bad"><b>${esc(camId || "merged=1")}</b><p>${esc(error.message || "Không thể chẩn đoán nguồn video.")}</p></div>`;
    if (pending) pending.outerHTML = failed;
    else output.insertAdjacentHTML("afterbegin", failed);
  } finally {
    button.textContent = originalText;
    document.querySelectorAll("#probeOverview,#probeWaybill,#probeMerged,#probeAll").forEach(item => { item.disabled = false; });
    probeBusy = false;
  }
}


async function diagnoseAllVideoSources(button = null) {
  if (probeBusy) return note("Đang có phép chẩn đoán khác chạy.", true);
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  if (!sessionId || !/^\d{6,30}$/.test(String(sessionId))) return note("Phiên đang chọn không có Session ID hợp lệ.", true);
  if (selectedSession?.status === "recording") return note("Không kiểm tra video khi phiên vẫn đang ghi hình.", true);

  const overviewCamera = cameraDetailsForMode("overview");
  const waybillCamera = cameraDetailsForMode("waybill");
  const output = $("cameraProbeResults");
  const modes = [
    { mode: "overview", title: "Overview", camId: overviewCamera.id, cameraInfo: overviewCamera },
    { mode: "waybill", title: "Waybill", camId: waybillCamera.id, cameraInfo: waybillCamera },
    { mode: "merged", title: "Video ghép", camId: "merged=1", cameraInfo: null },
  ];
  const buttons = [...document.querySelectorAll("#probeOverview,#probeWaybill,#probeMerged,#probeAll")];
  probeBusy = true;
  buttons.forEach(item => { item.disabled = true; });
  if (button) button.textContent = "Đang đối chiếu 1/3…";
  output.innerHTML = "";
  const results = [];

  try {
    for (let i = 0; i < modes.length; i++) {
      const item = modes[i];
      if (button) button.textContent = `Đang đối chiếu ${i + 1}/3…`;
      const pendingId = `probe-pending-${i}`;
      output.insertAdjacentHTML("beforeend", `<div id="${pendingId}">${renderPendingProbe(item.camId, item.title)}</div>`);
      try {
        const params = new URLSearchParams({ sessionId: String(sessionId), mode: item.mode });
        if (item.cameraInfo) params.set("cameraId", item.cameraInfo.id);
        const result = await api(`camera-diagnose?${params.toString()}`, { timeoutMs: 25000 });
        results.push({ ...result, requestedMode: item.mode });
        const pending = $(pendingId);
        if (pending) pending.outerHTML = renderCameraProbeResult(result);
      } catch (error) {
        const failed = `<div class="camera-probe-row probe-bad"><div><b>${esc(item.camId)}</b><span>Lỗi</span></div><p>${esc(error?.message || "Không thể chẩn đoán nguồn video.")}</p></div>`;
        const pending = $(pendingId);
        if (pending) pending.outerHTML = failed;
      }
    }

    const complete = results.filter(item => item.sampleComplete && item.sampleSha256);
    const cameraRedirectedToMerged = results.some(item =>
      ["overview", "waybill"].includes(item.mode) &&
      (item.redirectedToMerged || item.redirectChain?.some(hop => hop.target?.safeQuery?.merged === "1"))
    );
    let comparison = "";
    if (cameraRedirectedToMerged) {
      comparison = "KẾT LUẬN: Có request camera riêng bị redirect sang merged=1. Đây là bằng chứng đường API đang đổi yêu cầu camera thành video ghép.";
    } else if (complete.length === 3) {
      const hashes = new Set(complete.map(item => item.sampleSha256));
      comparison = hashes.size === 1
        ? "KẾT LUẬN: Cả ba mẫu tại byte 1 MB giống nhau. Nếu không có redirect, endpoint đang trả cùng nội dung cho ba tham số; cần xác nhận cách ASCAM định nghĩa camId."
        : "KẾT LUẬN: Ba mẫu tại byte 1 MB khác nhau. API có dữ liệu khác nhau; nếu player vẫn hiện hai góc, cần kiểm tra URL/Range thực tế của thẻ video.";
    } else if (results.length) {
      comparison = "Chưa đủ ba mẫu hợp lệ để kết luận. Xem HTTP, redirect và Content-Range ở từng kết quả.";
    }
    if (comparison) output.insertAdjacentHTML("beforeend", `<div class="camera-probe-row ${comparison.startsWith("KẾT LUẬN: Có") ? "probe-warn" : "probe-good"}"><b>Đối chiếu tự động</b><p>${esc(comparison)}</p></div>`);
  } finally {
    buttons.forEach(item => { item.disabled = false; });
    if (button) button.textContent = "Đối chiếu cả 3 nguồn";
    probeBusy = false;
  }
}
function renderPendingProbe(camId, title) {
  return `<div class="camera-probe-row probe-pending"><div><b>${esc(camId)}</b><span>Đang kiểm tra</span></div><p>Đang lấy mẫu tối đa 64 KB cho ${esc(title)}…</p></div>`;
}

function updateSessionHint() {
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  const recording = selectedSession?.status === "recording";
  $("sessionNotice").textContent = recording
    ? "Phiên này đang ghi hình. Hãy đợi ASCAM hoàn tất trước khi tạo link."
    : sessionId
      ? "Phát riêng camera bằng cameraId số của ASCAM (cameras[].cameraId); nút xem nhanh dùng P2P Mesh, không upload video trước."
      : "Không tìm thấy sessionId trong dữ liệu phiên; chưa thể phát hoặc tải MP4 trực tiếp.";
  $("createShare").disabled = recording;
}
async function loadOrder(code) {
  if (!code) return note("Không xác định được mã đơn trong kết quả ASCAM.", true);
  clearNote();
  note("Đang tải chi tiết và lịch sử đóng gói…");
  try {
    const data = await api("order?code=" + encodeURIComponent(code));
    clearNote();
    renderOrder(data, code);
    $("detailSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { note(error.message, true); }
}
async function share() {
  if (!selectedOrder) return;
  if (selectedSession?.status === "recording") return note("Phiên đang ghi hình. Hãy đợi ASCAM hoàn tất.", true);
  const button = $("createShare");
  button.disabled = true;
  const requestedRole = shareRoleForPlayback();
  const isQuickP2P = requestedRole !== "merged";
  const requestedMode = isQuickP2P ? "p2p" : "cloud";
  const roleLabel = requestedRole === "main" ? "Toàn cảnh" : requestedRole === "sub" ? "Vận đơn" : "Video ghép";
  button.textContent = isQuickP2P ? `Đang cấp link P2P ${roleLabel}…` : "Đang tạo video ghép ASC-Cloud…";
  try {
    const code = currentOrderCode();
    const data = await api("share", {
      method: "POST",
      body: JSON.stringify({ orderCode: code, role: requestedRole, mode: requestedMode })
    });
    const shareUrl = data.shareUrl || data.shareURL || data.p2pUrl || data.url;
    if (!shareUrl) throw new Error("ASCAM không trả URL xem video.");
    lastShare = data;
    const expiry = data.expiresAt ? `Hết hạn: ${date(data.expiresAt)}.` : "";
    const scopeNote = "API share hoạt động ở cấp đơn hàng; tài liệu chưa công bố tham số sessionId. Đơn có nhiều phiên cần kiểm tra đúng phiên.";
    const modeLabel = isQuickP2P ? "P2P Mesh tức thì · không upload trước" : "ASC-Cloud · có thể cần thời gian ghép/tải lên";
    $("shareResult").innerHTML = `<b>✓ Đã yêu cầu ${esc(modeLabel)} · ${esc(roleLabel)}</b><br><a href="${esc(shareUrl)}" target="_blank" rel="noopener">${esc(shareUrl)}</a><small>${esc(expiry)} ${esc(isQuickP2P ? "Peer ASCAM tại kho cần đang online. " : "")}${esc(scopeNote)}</small>`;
    $("shareResult").classList.remove("hidden");
    $("openShare").href = shareUrl;
    $("openShare").textContent = isQuickP2P ? `Mở xem ngay · ${roleLabel} ↗` : `Mở ASC-Cloud · ${roleLabel} ↗`;
    $("openShare").classList.remove("hidden");
    $("videoLinks").classList.remove("hidden");
    $("videoFootnote").textContent = isQuickP2P
      ? `Đã yêu cầu P2P Mesh role=${requestedRole}; không tải MP4 lên ASC-Cloud trước. Máy ASCAM/peer tại kho phải online.`
      : `Đã yêu cầu ASC-Cloud role=${requestedRole}; nhánh này có thể cần ghép/xuất video trước khi link sẵn sàng.`;
    note(isQuickP2P ? `Đã yêu cầu link P2P ${roleLabel}. Mở link để xem ngay.` : "Đã yêu cầu tạo video ghép và lưu ASC-Cloud.");
  } catch (error) { note(error.message, true); }
  finally { updateShareButton(); button.disabled = selectedSession?.status === "recording"; }
}


function bookmarkItems() {
  try { const value = JSON.parse(localStorage.getItem(BOOKMARKS) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function currentOrderCode() { return selectedOrder?.orderCode || selectedOrder?.OrderCode || selectedOrder?.code || $("detailCode")?.textContent || ""; }
function isBookmarked(code = currentOrderCode()) { return bookmarkItems().some(item => item.code === code); }
function updateBookmarkButton() {
  const button = $("toggleBookmark"); if (!button) return;
  const saved = isBookmarked(); button.textContent = saved ? "★ Đã đánh dấu · Bỏ đánh dấu" : "☆ Đánh dấu kiểm tra";
  button.classList.toggle("is-saved", saved);
}
function renderBookmarks() {
  const items = bookmarkItems();
  $("bookmarkBadge").textContent = items.length; $("bookmarkCount").textContent = `${items.length} đơn`;
  $("bookmarkList").innerHTML = items.length ? items.map(item => `<div class="bookmark-item"><button class="bookmark-open" data-open-code="${esc(item.code)}"><b>${esc(item.code)}</b><small>Đánh dấu ${date(item.at)}</small></button><button class="bookmark-remove" data-remove-code="${esc(item.code)}" aria-label="Bỏ đánh dấu">×</button></div>`).join("") : '<span class="empty-history">Chưa có đơn nào được đánh dấu.</span>';
  $("bookmarkList").querySelectorAll("[data-open-code]").forEach(button => button.addEventListener("click", () => { showView("home"); loadOrder(button.dataset.openCode); }));
  $("bookmarkList").querySelectorAll("[data-remove-code]").forEach(button => button.addEventListener("click", () => { localStorage.setItem(BOOKMARKS, JSON.stringify(bookmarkItems().filter(item => item.code !== button.dataset.removeCode))); renderBookmarks(); updateBookmarkButton(); }));
}
function toggleBookmark() {
  const code = currentOrderCode(); if (!code || code === "Đơn hàng") return;
  const items = bookmarkItems();
  const next = isBookmarked(code) ? items.filter(item => item.code !== code) : [{ code, at: new Date().toISOString() }, ...items].slice(0,100);
  try { localStorage.setItem(BOOKMARKS, JSON.stringify(next)); } catch { note("Trình duyệt không cho phép lưu danh sách đánh dấu.", true); return; }
  renderBookmarks(); updateBookmarkButton(); note(isBookmarked(code) ? "Đã thêm đơn vào danh sách cần kiểm tra." : "Đã bỏ đánh dấu đơn hàng.");
}
function showView(view) {
  const names = { home: "Tổng quan", history: "Lịch sử tìm kiếm", bookmarks: "Đơn cần kiểm tra" };
  ["home", "history", "bookmarks"].forEach(key => $(key + "View").classList.toggle("hidden", key !== view));
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $("pageTitle").textContent = names[view] || names.home;
  $("sidebar").classList.remove("open"); $("sidebarScrim").classList.remove("show");
  if (view === "history") renderHistory(); if (view === "bookmarks") renderBookmarks();
}
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => showView(button.dataset.goto)));
$("toggleBookmark").addEventListener("click", toggleBookmark);
$("menuToggle").addEventListener("click", () => { $("sidebar").classList.toggle("open"); $("sidebarScrim").classList.toggle("show"); });
$("sidebarScrim").addEventListener("click", () => { $("sidebar").classList.remove("open"); $("sidebarScrim").classList.remove("show"); });
$("logoutDesktop").addEventListener("click", () => $("logout").click());

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    appView();
    renderHistory();
    renderBookmarks();
    await refreshAscamStatus();
  } catch (error) { $("loginError").textContent = error.message; }
  finally { button.disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("logout", { method: "POST", body: "{}" }); } catch { /* Always return to login locally. */ }
  loginView();
});
$("searchForm").addEventListener("submit", event => { event.preventDefault(); search($("query").value); });
$("createShare").addEventListener("click", share);
$("videoPlayer").addEventListener("error", () => {
  const code = $("videoPlayer").error?.code;
  const reasons = { 2: "Lỗi mạng khi nhận video từ ASCAM.", 3: "Trình duyệt không giải mã được video MP4.", 4: "Nguồn video không khả dụng hoặc định dạng không được hỗ trợ." };
  note(reasons[code] || "Không thể phát video. Kiểm tra kết nối ASCAM và thử lại.", true);
});
document.querySelectorAll("[data-play-camera]").forEach(button => button.addEventListener("click", () => playVideo(button.dataset.playCamera, button)));
$("clearHistory").addEventListener("click", () => { localStorage.removeItem(HISTORY); renderHistory(); });

(async () => {
  try {
    await api("me");
    appView();
    renderHistory();
    renderBookmarks();
    await refreshAscamStatus();
  } catch { loginView(); }
})();
