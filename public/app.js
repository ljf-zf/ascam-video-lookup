<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ASCAM Video Lookup</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <!-- Màn hình đăng nhập -->
  <main id="loginView">
    <form id="loginForm">
      <div style="font-size:32px">📦</div>
      <h2 style="font-size:18px;font-weight:700">ASCAM Lookup</h2>
      <input id="password" type="password" placeholder="Nhập mật khẩu…" required autocomplete="current-password" />
      <button type="submit" style="background:#2563eb;color:#fff">Đăng nhập</button>
      <p id="loginError" style="color:#dc2626;font-size:13px"></p>
    </form>
  </main>

  <!-- Giao diện chính tối giản -->
  <div id="appView" class="hidden">
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:10px">
        <span id="ascamStatusTop" class="status-chip status-unknown"><i></i><span>…</span></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button type="button" class="nav-item active" data-view="home" title="Tra cứu">🔍</button>
        <button type="button" class="nav-item" data-view="history" title="Lịch sử">🕘 <small id="historyBadge">0</small></button>
        <button type="button" class="nav-item" data-view="bookmarks" title="Đã lưu">🔖 <small id="bookmarkBadge">0</small></button>
        <button type="button" id="logoutDesktop" title="Đăng xuất">🚪</button>
      </div>
    </header>

    <div id="notice" class="hidden"></div>

    <!-- Tab Tra cứu chính -->
    <section id="homeView">
      <form id="searchForm">
        <input id="query" type="search" placeholder="Nhập mã vận đơn hoặc 4 số cuối…" autocomplete="off" required />
        <button id="searchBtn" type="submit">🔍 Tìm</button>
      </form>

      <div id="homeHistory"></div>

      <div id="resultsSection" class="hidden">
        <div id="results"></div>
      </div>

      <div id="detailSection" class="hidden">
        <div class="detail-header">
          <div style="display:flex;align-items:center;gap:10px">
            <h2 id="detailCode" style="font-size:20px;font-weight:800">—</h2>
            <span id="detailStatus" class="state-tag">—</span>
          </div>
          <button type="button" id="toggleBookmark" style="background:#f8fafc;border:1px solid #e2e8f0">☆ Lưu đơn</button>
        </div>

        <div id="orderMeta"></div>
        <div id="sessions" class="hidden" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"></div>

        <div id="videoPlaceholder" class="hidden"></div>

        <div id="videoFrameWrap" class="hidden">
          <video id="videoPlayer" controls playsinline preload="metadata" class="hidden"></video>
          <iframe id="shareFrame" class="hidden" allow="autoplay; fullscreen"></iframe>
        </div>

        <div class="camera-controls">
          <button type="button" data-play-camera="overview" class="is-playing">⛶ Toàn cảnh</button>
          <button type="button" data-play-camera="waybill">📄 Vận đơn</button>
          <button type="button" data-play-camera="merged">🎞️ 2 Góc</button>
          <button type="button" id="createShare" title="Mở trình phát P2P/CDN trên tab riêng">↗ P2P</button>
        </div>

        <div id="videoLinks" class="hidden">
          <a id="downloadVideo" class="hidden" href="#">⬇ Tải MP4</a>
          <a id="openShare" class="hidden" href="#" target="_blank" rel="noopener">🌐 Link Share gốc</a>
        </div>
      </div>
    </section>

    <!-- Tab Lịch sử -->
    <section id="historyView" class="hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3>Lịch sử tra cứu</h3>
        <button type="button" id="clearHistory" style="background:#fee2e2;color:#dc2626">🗑 Xóa</button>
      </div>
      <div id="historyList" style="display:flex;flex-wrap:wrap;gap:8px"></div>
    </section>

    <!-- Tab Đã lưu -->
    <section id="bookmarksView" class="hidden">
      <h3 style="margin-bottom:12px">Đơn đã lưu (<span id="bookmarkCount">0</span>)</h3>
      <div id="bookmarkList" style="display:flex;flex-wrap:wrap;gap:8px"></div>
    </section>
  </div>

  <script src="/app.js"></script>
</body>
</html>
