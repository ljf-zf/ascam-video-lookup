const $ = id => document.getElementById(id);
const HISTORY = "avl-history-v1";
const BOOKMARKS = "avl-bookmarks-v1";

let selectedOrder = null;
let selectedSession = null;
let selectedSessions = [];
let selectedPlaybackMode = "overview";

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
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden", "error");
  if (error) element.classList.add("error");
}

function clearNote() {
  $("notice")?.classList.add("hidden");
}

function setAuthStatus(connected) {
  const element = $("authStatus");
  if (!element) return;
  element.textContent = connected ? "Đã đăng nhập" : "Chưa đăng nhập";
  element.closest(".connection-card")?.classList.toggle("is-online", connected);
}

function setAscamStatus(state, message) {
  const element = $("ascamStatus");
  const labels = {
    connected: "ASCAM đang kết nối",
    unavailable: "ASCAM ngoại tuyến",
    not_configured: "ASCAM chưa cấu hình",
    checking: "Đang kiểm tra ASCAM",
    unknown: "ASCAM chưa kiểm tra"
  };
  const text = message || labels[state] || labels.unknown;
  if (element) {
    element.textContent = text;
    element.title = text;
  }
  const top = $("ascamStatusTop");
  if (top) {
    top.innerHTML = `<i></i><span>${esc(text)}</span>`;
    top.className = "status-chip " + (state === "connected" ? "is-online" : state === "unavailable" ? "is-offline" : state === "not_configured" ? "is-error" : "status-unknown");
    top.title = text;
  }
}

function loginView() {
  $("loginView")?.classList.remove("hidden");
  $("appView")?.classList.add("hidden");
  setAuthStatus(false);
  setAscamStatus("unknown");
}

function appView() {
  $("loginView")?.classList.add("hidden");
  $("appView")?.classList.remove("hidden");
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

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  $("sidebarScrim")?.classList.remove("visible");
}

function showView(viewName) {
  const titles = { home: "Tổng quan", history: "Lịch sử tìm kiếm", bookmarks: "Đơn cần kiểm tra" };
  ["home", "history", "bookmarks"].forEach(name => {
    $(`${name}View`)?.classList.toggle("hidden", name !== viewName);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  if ($("pageTitle")) $("pageTitle").textContent = titles[viewName] || "Tổng quan";
  closeSidebar();
}

function historyItems() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function saveHistory(code) {
  if (!code) return;
  try {
    localStorage.setItem(HISTORY, JSON.stringify([{ code, at: new Date().toISOString() }, ...historyItems().filter(item => item.code !== code)].slice(0, 20)));
  } catch {}
  renderHistory();
}

function renderHistory() {
  const items = historyItems();
  const list = $("historyList");
  if (list) {
    list.innerHTML = items.length
      ? items.map(item => `<button class="history-item" data-code="${esc(item.code)}"><b>${esc(item.code)}</b><small>${date(item.at)} ↗</small></button>`).join("")
      : '<span class="empty-history">Chưa có lịch sử tìm kiếm.</span>';
    list.querySelectorAll("[data-code]").forEach(button => button.addEventListener("click", () => {
      showView("home");
      loadOrder(button.dataset.code);
    }));
  }
  const home = $("homeHistory");
  if (home) {
    home.innerHTML = items.slice(0, 4).map(item => `<button class="history-item" data-home-code="${esc(item.code)}"><span><b>${esc(item.code)}</b><small>${date(item.at)}</small></span><span>↗</span></button>`).join("") || '<span class="empty-history">Chưa có lịch sử tìm kiếm.</span>';
    home.querySelectorAll("[data-home-code]").forEach(button => button.addEventListener("click", () => loadOrder(button.dataset.homeCode)));
  }
  const badge = $("historyBadge");
  if (badge) badge.textContent = items.length;
}

function bookmarkItems() {
  try {
    const value = JSON.parse(localStorage.getItem(BOOKMARKS) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function currentOrderCode() {
  return selectedOrder?.orderCode || selectedOrder?.OrderCode || selectedOrder?.rawCode || $("detailCode")?.textContent || "";
}

function isBookmarked(code = currentOrderCode()) {
  return bookmarkItems().some(item => item.code === code);
}

function updateBookmarkButton() {
  const button = $("toggleBookmark");
  if (!button) return;
  const saved = isBookmarked();
  button.textContent = saved ? "★ Đã đánh dấu · Bỏ đánh dấu" : "☆ Đánh dấu kiểm tra";
  button.classList.toggle("is-saved", saved);
}

function toggleBookmark() {
  const code = currentOrderCode();
  if (!code) return;
  const items = bookmarkItems();
  const next = isBookmarked(code)
    ? items.filter(item => item.code !== code)
    : [{ code, at: new Date().toISOString(), station: selectedSession?.stationName || "" }, ...items];
  try { localStorage.setItem(BOOKMARKS, JSON.stringify(next)); } catch {}
  updateBookmarkButton();
  renderBookmarks();
}

function renderBookmarks() {
  const items = bookmarkItems();
  const badge = $("bookmarkBadge");
  if (badge) badge.textContent = items.length;
  const count = $("bookmarkCount");
  if (count) count.textContent = `${items.length} đơn`;
  const list = $("bookmarkList");
  if (!list) return;
  list.innerHTML = items.length
    ? items.map(item => `<button class="history-item" data-bm-code="${esc(item.code)}"><b>${esc(item.code)}</b><small>${esc(item.station || "")} · ${date(item.at)} ↗</small></button>`).join("")
    : '<span class="empty-history">Chưa có đơn hàng nào được đánh dấu.</span>';
  list.querySelectorAll("[data-bm-code]").forEach(btn => btn.addEventListener("click", () => {
    showView("home");
    loadOrder(btn.dataset.bmCode);
  }));
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
  const button = $("searchForm")?.querySelector("button");
  if (button) {
    button.disabled = true;
    button.innerHTML = "Đang tìm…";
  }
  $("detailSection")?.classList.add("hidden");
  try {
    const data = await api("search?q=" + encodeURIComponent(normalized), { timeoutMs: 30000 });
    const items = itemsOf(data);
    $("resultsSection")?.classList.remove("hidden");
    if ($("resultCount")) $("resultCount").textContent = `${items.length} kết quả`;
    if ($("results")) {
      $("results").innerHTML = items.length
        ? items.map(resultCard).join("")
        : '<div class="notice">Không tìm thấy đơn phù hợp trong dữ liệu ASCAM.</div>';
      $("results").querySelectorAll("[data-index]").forEach(element => {
        element.addEventListener("click", () => {
          const item = items[Number(element.dataset.index)];
          loadOrder(item.orderCode || item.OrderCode || item.rawCode || "");
        });
      });
    }
    if (!items.length) {
      note(`Không tìm thấy đơn khớp "${normalized}" (đã quét ${data.scannedRecords || 0}/${data.totalRecords || 0} bản ghi).`);
    } else if (items.length === 1) {
      const only = items[0];
      loadOrder(only.orderCode || only.OrderCode || only.rawCode || "");
    }
  } catch (error) {
    note(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = 'Tìm kiếm <span>→</span>';
    }
  }
}

function findCachedP2PLink(session, role) {
  const sessionId = String(session?.sessionId || session?.id || "");
  const allLinks = [
    ...(Array.isArray(session?.shareLinks) ? session.shareLinks : []),
    ...(Array.isArray(selectedOrder?.shareLinks) ? selectedOrder.shareLinks : []),
  ];
  return allLinks.find(link => {
    const linkRole = String(link?.role || "").toLowerCase();
    const linkSession = String(link?.sessionId || "");
    const validTime = !link?.expiresAt || new Date(link.expiresAt).getTime() > Date.now() + 30000;
    return link?.shareUrl && linkRole === role && (!sessionId || !linkSession || linkSession === sessionId) && validTime;
  }) || null;
}

function updateShareButton() {
  const button = $("createShare");
  if (!button) return;
  const labels = {
    overview: "Mở trình phát CDN / P2P · Toàn cảnh",
    waybill: "Mở trình phát CDN / P2P · Vận đơn",
    merged: "Tải / Ghép file MP4",
  };
  button.innerHTML = `${labels[selectedPlaybackMode] || labels.overview} <span>↗</span>`;
}

function resetVideo() {
  selectedPlaybackMode = "overview";
  $("videoPlaceholder")?.classList.remove("hidden");
  $("videoFrameWrap")?.classList.add("hidden");
  $("videoLinks")?.classList.add("hidden");
  $("openShare")?.classList.add("hidden");
  $("shareResult")?.classList.add("hidden");
  if ($("videoPanelTitle")) $("videoPanelTitle").textContent = "Xem video đóng gói";

  const player = $("videoPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.classList.add("hidden");
  }
  const frame = $("shareFrame");
  if (frame) {
    frame.src = "about:blank";
    frame.classList.add("hidden");
  }
  $("downloadVideo")?.classList.add("hidden");
  document.querySelectorAll("[data-play-camera]").forEach(button => button.classList.remove("is-playing"));
  updateShareButton();
}

function renderP2PPlayer(shareUrl, mode, sourceNote = "") {
  const label = mode === "overview" ? "Camera Toàn cảnh (Overview)" : "Camera Vận đơn (Waybill)";
  const player = $("videoPlayer");
  const frame = $("shareFrame");

  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.classList.add("hidden");
  }
  if (frame) {
    frame.src = shareUrl;
    frame.classList.remove("hidden");
  }

  $("videoPlaceholder")?.classList.add("hidden");
  $("videoFrameWrap")?.classList.remove("hidden");
  $("videoLinks")?.classList.remove("hidden");
  if ($("videoPanelTitle")) $("videoPanelTitle").textContent = label;

  if ($("openShare")) {
    $("openShare").href = shareUrl;
    $("openShare").textContent = `Mở tab riêng · ${label} ↗`;
    $("openShare").classList.remove("hidden");
  }
  $("downloadVideo")?.classList.add("hidden");

  if ($("videoFootnote")) {
    $("videoFootnote").textContent = sourceNote || `Đang phát qua CDN / P2P (${mode}) · Không chờ ghép MP4.`;
  }
  if ($("shareResult")) {
    $("shareResult").innerHTML = `<b>✓ ${esc(label)}</b> · <a href="${esc(shareUrl)}" target="_blank" rel="noopener">Mở toàn màn hình ở tab mới ↗</a>`;
    $("shareResult").classList.remove("hidden");
  }
  document.querySelectorAll("[data-play-camera]").forEach(item => {
    item.classList.toggle("is-playing", item.dataset.playCamera === mode);
  });
}

async function openShareStream(mode, button = null) {
  if (!selectedSession) return;
  const sessionId = selectedSession.sessionId || selectedSession.id;
  const label = mode === "overview" ? "Toàn cảnh (Overview)" : "Vận đơn (Waybill)";

  const cached = findCachedP2PLink(selectedSession, mode);
  if (cached) {
    renderP2PPlayer(cached.shareUrl, mode, `Phát trực tiếp qua CDN / P2P (${mode}) cho phiên ${sessionId}.`);
    clearNote();
    return;
  }

  if (button) button.disabled = true;
  note(`Đang mở luồng CDN / P2P cho ${label}…`);
  try {
    const data = await api("share", {
      method: "POST",
      timeoutMs: 15000,
      body: JSON.stringify({
        orderCode: currentOrderCode(),
        sessionId,
        role: mode,
        mode: "p2p",
      }),
    });

    if (!data.shareUrl) throw new Error(`ASCAM không trả URL phát cho ${label}.`);

    // Chỉ lưu vào cache nếu đúng role để không ghi đè nhầm link Overview sang Waybill
    if (data.roleMatched) {
      if (!Array.isArray(selectedSession.shareLinks)) selectedSession.shareLinks = [];
      selectedSession.shareLinks.push({
        shareUrl: data.shareUrl,
        role: data.actualRole || mode,
        sessionId,
      });
    }

    renderP2PPlayer(
      data.shareUrl,
      mode,
      data.roleMatched
        ? `Luồng CDN / P2P · Phiên ${sessionId} · Góc ${label}.`
        : `Phát luồng phiên ${sessionId} (ASCAM xuất chung luồng ghép cho cả 2 góc camera).`
    );
    clearNote();
  } catch (error) {
    note(error.message || `Không thể mở luồng ${label}.`, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function playVideo(mode, button = null, forceShareIframe = false) {
  if (!selectedSession) return note("Hãy chọn phiên đóng gói trước.", true);
  if (selectedSession.status === "recording") return note("Phiên đang ghi hình. Hãy đợi ASCAM hoàn tất.", true);
  if (!["overview", "waybill", "merged"].includes(mode)) return;

  selectedPlaybackMode = mode;
  updateShareButton();
  const sessionId = selectedSession.sessionId || selectedSession.id;

  // Nếu người dùng bấm trực tiếp nút "Mở trình phát CDN / P2P" ở dưới
  if (forceShareIframe && (mode === "overview" || mode === "waybill")) {
    await openShareStream(mode, button);
    return;
  }

  // Luồng 1: Phát trực tiếp trên thẻ <video> HTML5 sạch sẽ qua endpoint /api/stream (không ghép lại file)
  if (mode === "overview" || mode === "waybill") {
    const label = mode === "overview" ? "Camera Toàn cảnh (Overview)" : "Camera Vận đơn (Waybill)";
    const player = $("videoPlayer");
    const frame = $("shareFrame");

    if (!player) {
      await openShareStream(mode, button);
      return;
    }

    if (button) button.disabled = true;
    clearNote();

    if (frame) {
      frame.src = "about:blank";
      frame.classList.add("hidden");
    }

    const streamUrl = `/api/stream?sessionId=${encodeURIComponent(sessionId)}&role=${encodeURIComponent(mode)}`;
    player.classList.remove("hidden");
    player.pause();
    player.src = streamUrl;
    player.load();

    $("videoPlaceholder")?.classList.add("hidden");
    $("videoFrameWrap")?.classList.remove("hidden");
    $("videoLinks")?.classList.remove("hidden");
    if ($("videoPanelTitle")) $("videoPanelTitle").textContent = label;
    if ($("videoFootnote")) {
      $("videoFootnote").textContent = `Đang phát trực tiếp trên HTML5 Player (Phiên ${sessionId}) · Nếu muốn mở giao diện gốc của ASCAM, bấm nút CDN / P2P bên dưới.`;
    }
    if ($("downloadVideo")) {
      $("downloadVideo").href = `/api/download?sessionId=${encodeURIComponent(sessionId)}`;
      $("downloadVideo").download = `ASCAM-${sessionId}.mp4`;
      $("downloadVideo").classList.remove("hidden");
    }

    const existingShare = selectedSession.shareUrl || selectedOrder?.shareUrl;
    if ($("openShare") && existingShare) {
      $("openShare").href = existingShare;
      $("openShare").textContent = `Mở trang Share ASCAM ↗`;
      $("openShare").classList.remove("hidden");
    }

    document.querySelectorAll("[data-play-camera]").forEach(item => {
      item.classList.toggle("is-playing", item.dataset.playCamera === mode);
    });

    try {
      // Nếu luồng trực tiếp gặp lỗi (ví dụ ASCAM yêu cầu qua P2P cho phiên này), tự động chuyển sang P2P/CDN
      player.onerror = () => {
        player.onerror = null;
        openShareStream(mode, button);
      };
      const playPromise = player.play();
      if (playPromise?.catch) {
        await playPromise.catch(() => {});
      }
    } finally {
      if (button) button.disabled = false;
    }
    return;
  }

  // Luồng 2: Nút Video ghép MP4 (/api/stream?mode=merged)
  if (button) button.disabled = true;
  try {
    const player = $("videoPlayer");
    const frame = $("shareFrame");
    if (frame) { frame.src = "about:blank"; frame.classList.add("hidden"); }
    if (player) {
      player.onerror = null;
      player.classList.remove("hidden");
      player.pause();
      player.src = `/api/stream?sessionId=${encodeURIComponent(sessionId)}&mode=merged`;
      player.load();
    }
    $("videoPlaceholder")?.classList.add("hidden");
    $("videoFrameWrap")?.classList.remove("hidden");
    $("videoLinks")?.classList.remove("hidden");
    if ($("videoPanelTitle")) $("videoPanelTitle").textContent = "Video ghép MP4";
    if ($("videoFootnote")) {
      $("videoFootnote").textContent = "Đang tải luồng file MP4 ghép từ ASCAM.";
    }
    if ($("downloadVideo")) {
      $("downloadVideo").href = `/api/download?sessionId=${encodeURIComponent(sessionId)}`;
      $("downloadVideo").download = `ASCAM-${sessionId}-merged.mp4`;
      $("downloadVideo").classList.remove("hidden");
    }
    $("openShare")?.classList.add("hidden");
    document.querySelectorAll("[data-play-camera]").forEach(item => {
      item.classList.toggle("is-playing", item.dataset.playCamera === "merged");
    });
    const playPromise = player?.play();
    if (playPromise?.catch) await playPromise.catch(() => {});
    clearNote();
  } catch (error) {
    note(error.message || "Không thể phát video ghép.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

function updateSessionHint() {
  const sessionId = selectedSession?.sessionId || selectedSession?.id;
  const recording = selectedSession?.status === "recording";
  const roles = Array.isArray(selectedSession?.roles) ? selectedSession.roles.join(", ") : "overview, waybill";
  if ($("sessionNotice")) {
    $("sessionNotice").textContent = recording
      ? "Phiên này đang ghi hình. Hãy đợi nhân viên hoàn tất đóng gói."
      : sessionId
        ? `Sẵn sàng phát trực tiếp (Camera: ${roles}). Bấm Toàn cảnh hoặc Vận đơn để xem ngay.`
        : "Không tìm thấy Session ID hợp lệ.";
  }
  if ($("createShare")) $("createShare").disabled = recording;
}

function renderOrder(data, requestedCode) {
  selectedOrder = data?.order || data?.data?.order || data;
  selectedSessions = sessionsOf(data);
  if (!selectedSessions.length) selectedSessions = [selectedOrder];
  selectedSession = selectedSessions[0] || null;

  const latest = selectedSessions[0] || {};
  const code = selectedOrder.orderCode || selectedOrder.OrderCode || requestedCode;
  if ($("detailCode")) $("detailCode").textContent = code || "Đơn hàng";
  if ($("detailStatus")) {
    $("detailStatus").textContent = statusLabel(latest.status || selectedOrder.status);
    $("detailStatus").className = "state-tag " + ((latest.status || selectedOrder.status) === "completed" ? "good" : (latest.status || selectedOrder.status) === "recording" ? "warn" : "");
  }

  const meta = [
    ["Bàn đóng gói", latest.stationName || latest.stationId || "—"],
    ["Khu vực", latest.typeZone || selectedOrder.typeZone || "—"],
    ["Thời gian", date(latest.packedAt || latest.startedAt || latest.createdAt)],
    ["Thời lượng", latest.durationSec ? `${latest.durationSec} giây` : "—"],
    ["Số phiên", selectedSessions.length],
  ];
  if ($("orderMeta")) {
    $("orderMeta").innerHTML = meta.map(([label, value]) => `<div class="meta-cell"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("");
  }
  if ($("sessionCount")) $("sessionCount").textContent = `${selectedSessions.length} phiên`;
  if ($("sessions")) {
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
  }

  updateSessionHint();
  $("detailSection")?.classList.remove("hidden");
  resetVideo();
  saveHistory(code);
  updateBookmarkButton();
}

async function loadOrder(code) {
  if (!code) return note("Không xác định được mã đơn.", true);
  clearNote();
  note("Đang tải thông tin đóng gói…");
  try {
    const data = await api("order?code=" + encodeURIComponent(code));
    clearNote();
    renderOrder(data, code);
    $("detailSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    note(error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  renderHistory();
  renderBookmarks();

  $("loginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("loginError");
    if (errEl) errEl.textContent = "";
    const password = $("password")?.value || "";
    try {
      await api("login", { method: "POST", body: JSON.stringify({ password }) });
      if ($("password")) $("password").value = "";
      appView();
      refreshAscamStatus();
    } catch (error) {
      if (errEl) errEl.textContent = error.message;
      else note(error.message, true);
    }
  });

  const handleLogout = async () => {
    await api("logout", { method: "POST" }).catch(() => {});
    loginView();
  };
  $("logout")?.addEventListener("click", handleLogout);
  $("logoutDesktop")?.addEventListener("click", handleLogout);

  $("searchForm")?.addEventListener("submit", e => {
    e.preventDefault();
    search($("query")?.value || "");
  });

  document.querySelectorAll("[data-play-camera]").forEach(btn => {
    btn.addEventListener("click", () => playVideo(btn.dataset.playCamera, btn, false));
  });

  $("createShare")?.addEventListener("click", () => playVideo(selectedPlaybackMode, $("createShare"), true));
  $("toggleBookmark")?.addEventListener("click", toggleBookmark);

  $("clearHistory")?.addEventListener("click", () => {
    try { localStorage.removeItem(HISTORY); } catch {}
    renderHistory();
  });

  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.goto));
  });

  $("menuToggle")?.addEventListener("click", () => {
    $("sidebar")?.classList.toggle("open");
    $("sidebarScrim")?.classList.toggle("visible");
  });
  $("sidebarScrim")?.addEventListener("click", closeSidebar);

  try {
    await api("me");
    appView();
    refreshAscamStatus();
  } catch {
    loginView();
  }
});
