const $ = id => document.getElementById(id);
const HISTORY = "avl-history-v1";
const BOOKMARKS = "avl-bookmarks-v1";
let selectedOrder = null;
let selectedSession = null;
let selectedSessions = [];
let lastShare = null;

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
  const response = await fetch("/api/" + path, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
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
function resetVideo() {
  lastShare = null;
  $("videoPlaceholder").classList.remove("hidden");
  $("videoFrameWrap").classList.add("hidden");
  $("videoLinks").classList.add("hidden");
  $("shareResult").classList.add("hidden");
  const player = $("videoPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
}
function renderOrder(data, requestedCode) {
  selectedOrder = data?.order || data?.data?.order || data;
  selectedSessions = sessionsOf(data);
  if (!selectedSessions.length) selectedSessions = [selectedOrder];
  selectedSession = selectedSessions[0] || null;
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
    resetVideo();
    updateSessionHint();
  }));
  updateSessionHint();
  $("detailSection").classList.remove("hidden");
  resetVideo();
  saveHistory(code);
  updateBookmarkButton();
}
function updateSessionHint() {
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  const recording = selectedSession?.status === "recording";
  $("sessionNotice").textContent = recording
    ? "Phiên này đang ghi hình. Hãy đợi ASCAM hoàn tất trước khi tạo link."
    : sessionId
      ? "Phiên đang chọn sẽ được dùng để phát/tải MP4 qua sessionId. Link ASC-Cloud được tạo ở cấp đơn hàng theo API hiện đã xác minh."
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
  button.textContent = "Đang tạo link…";
  try {
    const code = selectedOrder.orderCode || selectedOrder.OrderCode || selectedOrder.code || $("detailCode").textContent;
    const data = await api("share", { method: "POST", body: JSON.stringify({ orderCode: code }) });
    const shareUrl = data.shareUrl || data.shareURL;
    if (!shareUrl) throw new Error("ASCAM không trả shareUrl.");
    lastShare = data;
    $("shareResult").innerHTML = `<b>✓ Đã tạo link ASC-Cloud cho đơn ${esc(code)}</b><br><a href="${esc(shareUrl)}" target="_blank" rel="noopener">${esc(shareUrl)}</a><small>Hết hạn: ${date(data.expiresAt)}. Link được tạo theo đơn hàng, không khẳng định là link riêng của phiên đang chọn.</small>`;
    $("shareResult").classList.remove("hidden");
    $("openShare").href = shareUrl;
    const sessionId = data.sessionId || selectedSession?.sessionId || selectedSession?.id;
    if (sessionId && /^\d{6,30}$/.test(String(sessionId))) {
      $("videoPlayer").src = `/api/stream?sessionId=${encodeURIComponent(sessionId)}`;
      $("downloadVideo").href = `/api/download?sessionId=${encodeURIComponent(sessionId)}`;
      $("downloadVideo").classList.remove("disabled");
      $("videoPlaceholder").classList.add("hidden");
      $("videoFrameWrap").classList.remove("hidden");
      $("videoLinks").classList.remove("hidden");
    } else {
      $("videoPlaceholder").classList.remove("hidden");
      $("videoFrameWrap").classList.add("hidden");
      $("videoLinks").classList.remove("hidden");
      $("downloadVideo").href = "#";
      $("downloadVideo").onclick = event => { event.preventDefault(); note("Không có sessionId hợp lệ để tải video MP4.", true); };
    }
    note("Đã tạo link ASC-Cloud. Kiểm tra đúng phiên trước khi sử dụng video.");
  } catch (error) { note(error.message, true); }
  finally { button.innerHTML = 'Tạo link ASC-Cloud <span>↗</span>'; button.disabled = selectedSession?.status === "recording"; }
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
