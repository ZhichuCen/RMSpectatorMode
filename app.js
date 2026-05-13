const FEED_URL = "https://rm-static.djicdn.com/live_json/live_game_info.json";
const REFRESH_INTERVAL_MS = 15000;

const refs = {};
const LAYOUTS = [
  { id: "one-plus", label: "1 大 + 右侧 N 小", mainCount: 1, defaultRes: "high" },
  { id: "two-main", label: "2 大并排 + 下方 N 小", mainCount: 2, defaultRes: "high" },
  { id: "four-main", label: "4 大四宫格 + 下方 N 小", mainCount: 4, defaultRes: "middle" },
  { id: "grid-4x4", label: "4x4 全小视角", mainCount: 0, defaultRes: "low" },
];

const RESOLUTION_RANK = { low: 1, middle: 2, medium: 2, high: 3 };
const RESOLUTION_OPTIONS = [
  { id: "high", label: "1080p" },
  { id: "middle", label: "720p" },
  { id: "low", label: "540p" },
];

const state = {
  zones: [],
  eventName: "赛事多视角监看系统",
  selectedZoneId: "",
  selectedStreamId: "",
  filter: "",
  lastUpdatedAt: null,
  mainHls: new Map(),
  thumbHls: new Map(),
  refreshTimer: null,
  mainMuted: true,
  isLoading: false,
  layout: "one-plus",
  mainResolution: "high",
};

document.addEventListener("DOMContentLoaded", () => {
  bindRefs();
  bindEvents();
  renderLayoutOptions();
  renderResolutionOptions();
  applyLayoutConfig(false);
  renderIcons();
  loadFeed();
  state.refreshTimer = window.setInterval(loadFeed, REFRESH_INTERVAL_MS);
});

function bindRefs() {
  [
    "eventTitle",
    "feedStatus",
    "refreshButton",
    "zoneSelect",
    "viewFilter",
    "layoutSelect",
    "mainResolutionSelect",
    "viewerLayout",
    "mainGrid",
    "mainEmpty",
    "sidePanel",
    "smallPanelTitle",
    "smallPanelHint",
    "lastUpdated",
    "sourceCount",
    "thumbGrid",
    "emptyState",
  ].forEach((id) => {
    refs[id] = document.getElementById(id);
  });
}

function bindEvents() {
  refs.refreshButton.addEventListener("click", loadFeed);
  refs.zoneSelect.addEventListener("change", (event) => {
    state.selectedZoneId = event.target.value;
    state.selectedStreamId = "";
    render();
  });
  refs.viewFilter.addEventListener("input", (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    render();
  });
  refs.layoutSelect.addEventListener("change", (event) => {
    state.layout = event.target.value;
    applyLayoutConfig(true);
    render();
  });
  refs.mainResolutionSelect.addEventListener("change", (event) => {
    state.mainResolution = event.target.value;
    renderMainPlayers();
  });
  refs.mainGrid.addEventListener("click", (event) => {
    const retryButton = event.target.closest("[data-action='retry-main']");
    if (retryButton) {
      renderMainPlayers();
      return;
    }

    const muteButton = event.target.closest("[data-action='toggle-mute']");
    if (muteButton) {
      state.mainMuted = !state.mainMuted;
      refs.mainGrid.querySelectorAll("video").forEach((video) => {
        video.muted = state.mainMuted;
      });
      renderMainPlayers();
    }
  });
}

function renderLayoutOptions() {
  refs.layoutSelect.innerHTML = LAYOUTS.map(
    (layout) => `<option value="${layout.id}">${layout.label}</option>`,
  ).join("");
  refs.layoutSelect.value = state.layout;
}

function renderResolutionOptions() {
  refs.mainResolutionSelect.innerHTML = RESOLUTION_OPTIONS.map(
    (item) => `<option value="${item.id}">${item.label}</option>`,
  ).join("");
  refs.mainResolutionSelect.value = state.mainResolution;
}

function applyLayoutConfig(resetResolution) {
  const layout = getCurrentLayout();
  if (resetResolution) {
    state.mainResolution = layout.defaultRes;
  }
  refs.viewerLayout.dataset.layout = layout.id;
  refs.mainResolutionSelect.value = state.mainResolution;
  refs.mainResolutionSelect.disabled = layout.mainCount === 0;
  refs.smallPanelTitle.textContent = layout.mainCount === 0 ? "全部视角" : "可切换视角";
  refs.smallPanelHint.textContent = layout.mainCount === 0 ? "4x4 低清预览" : "小窗优先低清";
}

async function loadFeed() {
  if (state.isLoading) return;
  state.isLoading = true;
  setFeedStatus("warn", "正在更新");

  try {
    const response = await fetch(`${FEED_URL}?_=${Date.now()}`, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const parsed = parseLiveInfo(payload);
    state.zones = parsed.zones;
    state.eventName = parsed.eventName || "赛事多视角监看系统";
    state.lastUpdatedAt = new Date();
    reconcileSelection();
    render();
    setFeedStatus("ok", "已连接实时源");
  } catch (error) {
    console.error(error);
    setFeedStatus("error", feedErrorMessage(error));
    render();
  } finally {
    state.isLoading = false;
  }
}

function feedErrorMessage(error) {
  const status = String(error?.message || "").match(/^HTTP (\d{3})$/)?.[1];
  return status ? `实时源更新失败 (${status})` : "实时源更新失败";
}

function parseLiveInfo(payload) {
  const zones = Array.isArray(payload?.eventData)
    ? payload.eventData.map((zone, zoneIndex) => {
        const zoneId = String(zone.zoneId ?? zoneIndex);
        const zoneName = zone.zoneName || `赛区 ${zoneIndex + 1}`;
        const streams = [];

        if (Array.isArray(zone.zoneLiveString) && zone.zoneLiveString.length > 0) {
          streams.push({
            id: `${zoneId}:main`,
            kind: "main",
            zoneId,
            zoneName,
            title: `${zoneName} 主视角`,
            shortTitle: "主视角",
            sources: normalizeSources(zone.zoneLiveString),
          });
        }

        if (Array.isArray(zone.fpvData)) {
          zone.fpvData.forEach((item, streamIndex) => {
            const role = item.role || `第一视角 ${streamIndex + 1}`;
            streams.push({
              id: `${zoneId}:fpv:${streamIndex}`,
              kind: "fpv",
              zoneId,
              zoneName,
              title: role,
              shortTitle: role,
              sources: normalizeSources(item.sources),
            });
          });
        }

        return { zoneId, zoneName, streams: streams.filter((stream) => stream.sources.length > 0) };
      })
    : [];

  return { eventName: payload?.eventName || "赛事多视角监看系统", zones };
}

function normalizeSources(sources = []) {
  return sources
    .filter((source) => source && source.src)
    .map((source) => ({
      label: source.label || labelFromRes(source.res),
      src: source.src,
      res: source.res || resFromLabel(source.label),
      rank: rankSource(source),
    }))
    .sort((a, b) => b.rank - a.rank);
}

function labelFromRes(res) {
  if (res === "high") return "1080p";
  if (res === "middle" || res === "medium") return "720p";
  if (res === "low") return "540p";
  return "HLS";
}

function resFromLabel(label = "") {
  const value = String(label).toLowerCase();
  if (value.includes("1080")) return "high";
  if (value.includes("720")) return "middle";
  if (/540|480|360/.test(value)) return "low";
  return "";
}

function rankSource(source) {
  const byRes = RESOLUTION_RANK[String(source.res || "").toLowerCase()];
  if (byRes) return byRes;
  return RESOLUTION_RANK[resFromLabel(source.label)] || 0;
}

function pickSource(stream, mode) {
  if (!stream?.sources?.length) return null;
  if (mode === "thumb") {
    return stream.sources.find((source) => source.rank === 1) || stream.sources[stream.sources.length - 1];
  }

  const prefer = RESOLUTION_RANK[state.mainResolution] || 3;
  return (
    stream.sources.find((source) => source.rank === prefer) ||
    stream.sources.find((source) => source.rank < prefer) ||
    stream.sources[0]
  );
}

function reconcileSelection() {
  if (!state.zones.length) {
    state.selectedZoneId = "";
    state.selectedStreamId = "";
    return;
  }

  if (!state.zones.some((zone) => zone.zoneId === state.selectedZoneId)) {
    state.selectedZoneId = (state.zones.find((zone) => zone.streams.length > 0) || state.zones[0]).zoneId;
  }

  const zone = getSelectedZone();
  if (!zone?.streams.some((stream) => stream.id === state.selectedStreamId)) {
    state.selectedStreamId = zone?.streams.find((stream) => stream.kind === "main")?.id || zone?.streams[0]?.id || "";
  }
}

function render() {
  applyLayoutConfig(false);
  refs.eventTitle.textContent = state.eventName;
  renderZones();
  renderMeta();
  renderMainPlayers();
  renderThumbs();
  renderIcons();
}

function renderZones() {
  refs.zoneSelect.innerHTML = state.zones
    .map((zone) => {
      const selected = zone.zoneId === state.selectedZoneId ? "selected" : "";
      return `<option value="${escapeAttr(zone.zoneId)}" ${selected}>${escapeHtml(zone.zoneName)} (${zone.streams.length})</option>`;
    })
    .join("");
  refs.zoneSelect.disabled = state.zones.length === 0;
}

function renderMeta() {
  const count = getSelectedZone()?.streams.length || 0;
  refs.sourceCount.textContent = `${count} 路信号`;
  refs.lastUpdated.textContent = state.lastUpdatedAt ? `更新于 ${state.lastUpdatedAt.toLocaleTimeString()}` : "尚未更新";
}

function renderMainPlayers() {
  const layout = getCurrentLayout();
  if (layout.mainCount === 0) {
    destroyMissingMainPlayers(new Set());
    refs.mainGrid.innerHTML = "";
    refs.mainEmpty.hidden = true;
    return;
  }

  const streams = getMainStreams();
  destroyMissingMainPlayers(new Set(streams.map((stream) => mainKey(stream.id))));

  if (!streams.length) {
    refs.mainGrid.innerHTML = "";
    refs.mainEmpty.hidden = false;
    refs.mainEmpty.querySelector("p").textContent = state.zones.length ? "没有符合条件的直播源。" : "等待直播源。";
    return;
  }

  refs.mainEmpty.hidden = true;
  refs.mainGrid.innerHTML = streams.map(renderMainCard).join("");
  streams.forEach((stream) => {
    const source = pickSource(stream, "main");
    const key = mainKey(stream.id);
    const video = refs.mainGrid.querySelector(`video[data-player-key="${cssEscape(key)}"]`);
    if (video && source) attachHls(video, source.src, key, "main");
  });
}

function renderMainCard(stream) {
  const source = pickSource(stream, "main");
  return `
    <div class="video-frame main-frame" data-stream-id="${escapeAttr(stream.id)}">
      <video controls autoplay muted playsinline preload="metadata" data-player-key="${escapeAttr(mainKey(stream.id))}"></video>
      <div class="video-overlay">
        <div>
          <p class="video-kicker">${escapeHtml(stream.zoneName)}</p>
          <h2>${escapeHtml(stream.title)}</h2>
        </div>
        <div class="overlay-actions">
          <span class="quality-badge">${escapeHtml(source?.label || "--")}</span>
          <button class="icon-button" data-action="toggle-mute" type="button" aria-label="切换静音">
            <i data-lucide="${state.mainMuted ? "volume-x" : "volume-2"}" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="video-error" hidden>
        <p>当前视角加载失败。</p>
        <button class="text-button" data-action="retry-main" type="button">重试</button>
      </div>
    </div>
  `;
}

function renderThumbs() {
  const streams = getThumbStreams();
  destroyMissingThumbPlayers(new Set(streams.map((stream) => thumbKey(stream.id))));

  refs.emptyState.hidden = streams.length > 0;
  refs.thumbGrid.innerHTML = streams.map(renderThumbCard).join("");
  refs.thumbGrid.querySelectorAll(".thumb-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStreamId = button.dataset.streamId || "";
      render();
    });
  });

  streams.forEach((stream) => {
    const source = pickSource(stream, "thumb");
    const key = thumbKey(stream.id);
    const video = refs.thumbGrid.querySelector(`video[data-player-key="${cssEscape(key)}"]`);
    if (video && source) attachHls(video, source.src, key, "thumb");
  });

  if (!streams.length) {
    const zone = getSelectedZone();
    refs.emptyState.querySelector("p").textContent = zone?.streams.length
      ? "没有符合筛选条件的其他视角。"
      : "当前赛区还没有可用直播源。";
  }
}

function renderThumbCard(stream) {
  const source = pickSource(stream, "thumb");
  const active = stream.id === state.selectedStreamId ? " active" : "";
  return `
    <button class="thumb-card${active}" type="button" data-stream-id="${escapeAttr(stream.id)}">
      <div class="video-frame thumb-video">
        <video muted autoplay playsinline preload="metadata" data-player-key="${escapeAttr(thumbKey(stream.id))}"></video>
      </div>
      <span class="thumb-title">${escapeHtml(stream.shortTitle)}</span>
      <span class="thumb-meta">
        <span>${escapeHtml(stream.kind === "main" ? "主视角" : "第一视角")}</span>
        <span>${escapeHtml(source?.label || "--")}</span>
      </span>
    </button>
  `;
}

function getCurrentLayout() {
  return LAYOUTS.find((layout) => layout.id === state.layout) || LAYOUTS[0];
}

function getSelectedZone() {
  return state.zones.find((zone) => zone.zoneId === state.selectedZoneId) || null;
}

function getFilteredStreams() {
  const zone = getSelectedZone();
  if (!zone) return [];
  return zone.streams.filter((stream) => {
    if (!state.filter) return true;
    return `${stream.title} ${stream.zoneName}`.toLowerCase().includes(state.filter);
  });
}

function getMainStreams() {
  const layout = getCurrentLayout();
  if (layout.mainCount === 0) return [];

  const streams = getFilteredStreams();
  if (!streams.length) return [];

  let selectedIndex = streams.findIndex((stream) => stream.id === state.selectedStreamId);
  if (selectedIndex < 0) selectedIndex = 0;
  state.selectedStreamId = streams[selectedIndex].id;

  const start = Math.min(selectedIndex, Math.max(0, streams.length - layout.mainCount));
  return streams.slice(start, start + layout.mainCount);
}

function getThumbStreams() {
  const layout = getCurrentLayout();
  const streams = getFilteredStreams();
  if (layout.mainCount === 0) return streams;

  const mainIds = new Set(getMainStreams().map((stream) => stream.id));
  return streams.filter((stream) => !mainIds.has(stream.id));
}

function attachHls(video, src, key, group) {
  if (!video || !src) return;
  const store = group === "main" ? state.mainHls : state.thumbHls;
  const previous = store.get(key);
  if (previous) previous.destroy();

  video.pause();
  video.removeAttribute("src");
  video.load();
  video.muted = group === "main" ? state.mainMuted : true;

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    video.play().catch(() => {});
    store.delete(key);
    return;
  }

  if (!window.Hls?.isSupported()) {
    showVideoError(video);
    return;
  }

  const hls = new window.Hls({
    lowLatencyMode: true,
    liveSyncDurationCount: 3,
    maxBufferLength: group === "main" ? 30 : 8,
    maxMaxBufferLength: group === "main" ? 45 : 12,
  });
  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      showVideoError(video);
      hls.destroy();
      store.delete(key);
    }
  });
  hls.loadSource(src);
  hls.attachMedia(video);
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  store.set(key, hls);
}

function showVideoError(video) {
  const error = video.closest(".video-frame")?.querySelector(".video-error");
  if (error) error.hidden = false;
}

function destroyMissingMainPlayers(allowedKeys) {
  destroyMissingPlayers(state.mainHls, allowedKeys);
}

function destroyMissingThumbPlayers(allowedKeys) {
  destroyMissingPlayers(state.thumbHls, allowedKeys);
}

function destroyMissingPlayers(store, allowedKeys) {
  for (const [key, hls] of store.entries()) {
    if (!allowedKeys.has(key)) {
      hls.destroy();
      store.delete(key);
    }
  }
}

function setFeedStatus(kind, message) {
  refs.feedStatus.className = `status-pill ${kind}`;
  refs.feedStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(message)}</span>`;
}

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const escapeAttr = escapeHtml;
const mainKey = (streamId) => `main:${streamId}`;
const thumbKey = (streamId) => `thumb:${streamId}`;
const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

window.RMViewer = {
  parseLiveInfo,
  normalizeSources,
  pickSource,
};
