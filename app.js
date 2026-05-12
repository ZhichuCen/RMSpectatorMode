const FEED_URL = "https://rm-static.djicdn.com/live_json/live_game_info.json";
const REFRESH_INTERVAL_MS = 15000;

const refs = {};
const state = {
  zones: [],
  eventName: "多视角直播",
  selectedZoneId: "",
  selectedStreamId: "",
  filter: "",
  lastUpdatedAt: null,
  mainHls: null,
  mainLoadedUrl: "",
  thumbHls: new Map(),
  refreshTimer: null,
  mainMuted: true,
  isLoading: false,
};

const RESOLUTION_RANK = {
  low: 1,
  middle: 2,
  medium: 2,
  high: 3,
};

document.addEventListener("DOMContentLoaded", () => {
  bindRefs();
  bindEvents();
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
    "lastUpdated",
    "sourceCount",
    "mainVideo",
    "mainZone",
    "mainTitle",
    "mainQuality",
    "mainError",
    "retryMainButton",
    "muteButton",
    "thumbGrid",
    "emptyState",
  ].forEach((id) => {
    refs[id] = document.getElementById(id);
  });
}

function bindEvents() {
  refs.refreshButton.addEventListener("click", loadFeed);
  refs.retryMainButton.addEventListener("click", () => {
    state.mainLoadedUrl = "";
    updateMainPlayer();
  });
  refs.zoneSelect.addEventListener("change", (event) => {
    state.selectedZoneId = event.target.value;
    state.selectedStreamId = "";
    render();
  });
  refs.viewFilter.addEventListener("input", (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderThumbs();
  });
  refs.muteButton.addEventListener("click", () => {
    state.mainMuted = !state.mainMuted;
    refs.mainVideo.muted = state.mainMuted;
    refs.muteButton.innerHTML = state.mainMuted
      ? '<i data-lucide="volume-x" aria-hidden="true"></i>'
      : '<i data-lucide="volume-2" aria-hidden="true"></i>';
    renderIcons();
  });
}

async function loadFeed() {
  if (state.isLoading) return;
  state.isLoading = true;
  setFeedStatus("warn", "正在更新");

  try {
    const response = await fetch(`${FEED_URL}?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const parsed = parseLiveInfo(payload);
    state.zones = parsed.zones;
    state.eventName = parsed.eventName || "多视角直播";
    state.lastUpdatedAt = new Date();
    reconcileSelection();
    render();
    setFeedStatus("ok", "已连接实时源");
  } catch (error) {
    console.error(error);
    setFeedStatus("error", "实时源更新失败");
    refs.mainError.hidden = false;
  } finally {
    state.isLoading = false;
  }
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
            headimg: zone.image || "",
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
              headimg: item.headimg || "",
              sources: normalizeSources(item.sources),
            });
          });
        }

        return {
          zoneId,
          zoneName,
          zoneDate: zone.zoneDate || [],
          liveState: Number(zone.liveState ?? 0),
          matchState: Number(zone.matchState ?? 0),
          streams: streams.filter((stream) => stream.sources.length > 0),
        };
      })
    : [];

  return {
    eventId: payload?.eventId || "",
    eventName: payload?.eventName || "多视角直播",
    zones,
  };
}

function normalizeSources(sources = []) {
  return sources
    .filter((source) => source && source.src)
    .map((source) => ({
      label: source.label || labelFromRes(source.res),
      type: source.type || "application/vnd.apple.mpegurl",
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
  if (value.includes("540") || value.includes("480") || value.includes("360")) {
    return "low";
  }
  return "";
}

function rankSource(source) {
  const byRes = RESOLUTION_RANK[String(source.res || "").toLowerCase()];
  if (byRes) return byRes;
  const label = String(source.label || "").toLowerCase();
  if (label.includes("1080")) return 3;
  if (label.includes("720")) return 2;
  if (label.includes("540") || label.includes("480") || label.includes("360")) {
    return 1;
  }
  return 0;
}

function pickSource(stream, mode) {
  if (!stream?.sources?.length) return null;
  const ranks = mode === "thumb" ? [1, 2, 3, 0] : [3, 2, 1, 0];
  for (const rank of ranks) {
    const source = stream.sources.find((candidate) => candidate.rank === rank);
    if (source) return source;
  }
  return mode === "thumb"
    ? stream.sources[stream.sources.length - 1]
    : stream.sources[0];
}

function reconcileSelection() {
  if (!state.zones.length) {
    state.selectedZoneId = "";
    state.selectedStreamId = "";
    return;
  }

  const zoneExists = state.zones.some((zone) => zone.zoneId === state.selectedZoneId);
  if (!zoneExists) {
    const firstWithStreams = state.zones.find((zone) => zone.streams.length > 0);
    state.selectedZoneId = (firstWithStreams || state.zones[0]).zoneId;
  }

  const zone = getSelectedZone();
  const streamExists = zone?.streams.some((stream) => stream.id === state.selectedStreamId);
  if (!streamExists) {
    state.selectedStreamId =
      zone?.streams.find((stream) => stream.kind === "main")?.id ||
      zone?.streams[0]?.id ||
      "";
  }
}

function render() {
  refs.eventTitle.textContent = state.eventName;
  renderZones();
  renderMeta();
  updateMainPlayer();
  renderThumbs();
  renderIcons();
}

function renderZones() {
  const selected = state.selectedZoneId;
  refs.zoneSelect.innerHTML = state.zones
    .map((zone) => {
      const selectedAttr = zone.zoneId === selected ? "selected" : "";
      const count = zone.streams.length;
      return `<option value="${escapeAttr(zone.zoneId)}" ${selectedAttr}>${escapeHtml(
        zone.zoneName,
      )} (${count})</option>`;
    })
    .join("");
  refs.zoneSelect.disabled = state.zones.length === 0;
}

function renderMeta() {
  const zone = getSelectedZone();
  const count = zone?.streams.length || 0;
  refs.sourceCount.textContent = `${count} 路信号`;
  refs.lastUpdated.textContent = state.lastUpdatedAt
    ? `更新于 ${state.lastUpdatedAt.toLocaleTimeString()}`
    : "尚未更新";
}

function updateMainPlayer() {
  const stream = getSelectedStream();
  destroyMissingThumbPlayers(new Set(getThumbStreams().map((item) => item.id)));

  if (!stream) {
    destroyMainPlayer();
    refs.mainTitle.textContent = "没有可播放的直播源";
    refs.mainZone.textContent = "等待更新";
    refs.mainQuality.textContent = "--";
    refs.mainError.hidden = false;
    return;
  }

  const source = pickSource(stream, "main");
  refs.mainTitle.textContent = stream.title;
  refs.mainZone.textContent = stream.zoneName;
  refs.mainQuality.textContent = source?.label || "--";

  if (!source) {
    refs.mainError.hidden = false;
    return;
  }

  if (state.mainLoadedUrl === source.src) {
    refs.mainError.hidden = true;
    return;
  }

  refs.mainError.hidden = true;
  state.mainLoadedUrl = source.src;
  refs.mainVideo.muted = state.mainMuted;
  attachHls(refs.mainVideo, source.src, "main");
}

function renderThumbs() {
  const thumbStreams = getThumbStreams();
  const allowedIds = new Set(thumbStreams.map((stream) => stream.id));
  destroyMissingThumbPlayers(allowedIds);

  refs.emptyState.hidden = thumbStreams.length > 0;
  refs.thumbGrid.innerHTML = thumbStreams
    .map((stream) => {
      const source = pickSource(stream, "thumb");
      return `
        <button class="thumb-card" type="button" data-stream-id="${escapeAttr(stream.id)}">
          <div class="video-frame thumb-video">
            <video muted autoplay playsinline preload="metadata" data-video-id="${escapeAttr(
              stream.id,
            )}"></video>
          </div>
          <span class="thumb-title">${escapeHtml(stream.shortTitle)}</span>
          <span class="thumb-meta">
            <span>${escapeHtml(stream.kind === "main" ? "主视角" : "第一视角")}</span>
            <span>${escapeHtml(source?.label || "--")}</span>
          </span>
        </button>
      `;
    })
    .join("");

  refs.thumbGrid.querySelectorAll(".thumb-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStreamId = button.dataset.streamId || "";
      render();
    });
  });

  thumbStreams.forEach((stream) => {
    const source = pickSource(stream, "thumb");
    const video = refs.thumbGrid.querySelector(
      `video[data-video-id="${cssEscape(stream.id)}"]`,
    );
    if (video && source) {
      attachHls(video, source.src, stream.id);
    }
  });

  if (!thumbStreams.length) {
    const zone = getSelectedZone();
    const hasStreams = Boolean(zone?.streams.length);
    refs.emptyState.querySelector("p").textContent = hasStreams
      ? "没有符合筛选条件的其他视角。"
      : "当前赛区还没有可用直播源。";
  }
}

function getSelectedZone() {
  return state.zones.find((zone) => zone.zoneId === state.selectedZoneId) || null;
}

function getSelectedStream() {
  const zone = getSelectedZone();
  return zone?.streams.find((stream) => stream.id === state.selectedStreamId) || null;
}

function getThumbStreams() {
  const zone = getSelectedZone();
  if (!zone) return [];
  return zone.streams.filter((stream) => {
    if (stream.id === state.selectedStreamId) return false;
    if (!state.filter) return true;
    return `${stream.title} ${stream.zoneName}`.toLowerCase().includes(state.filter);
  });
}

function attachHls(video, src, key) {
  if (!video || !src) return;

  const previous = key === "main" ? state.mainHls : state.thumbHls.get(key);
  if (previous) {
    previous.destroy();
  }

  video.pause();
  video.removeAttribute("src");
  video.load();

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    video.play().catch(() => {});
    if (key === "main") state.mainHls = null;
    return;
  }

  if (!window.Hls?.isSupported()) {
    if (key === "main") refs.mainError.hidden = false;
    return;
  }

  const hls = new window.Hls({
    lowLatencyMode: true,
    liveSyncDurationCount: 3,
    maxBufferLength: key === "main" ? 30 : 8,
    maxMaxBufferLength: key === "main" ? 45 : 12,
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      if (key === "main") refs.mainError.hidden = false;
      hls.destroy();
    }
  });

  hls.loadSource(src);
  hls.attachMedia(video);
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {});
  });

  if (key === "main") {
    state.mainHls = hls;
  } else {
    state.thumbHls.set(key, hls);
  }
}

function destroyMainPlayer() {
  if (state.mainHls) {
    state.mainHls.destroy();
    state.mainHls = null;
  }
  state.mainLoadedUrl = "";
  refs.mainVideo.pause();
  refs.mainVideo.removeAttribute("src");
  refs.mainVideo.load();
}

function destroyMissingThumbPlayers(allowedIds) {
  for (const [id, hls] of state.thumbHls.entries()) {
    if (!allowedIds.has(id)) {
      hls.destroy();
      state.thumbHls.delete(id);
    }
  }
}

function setFeedStatus(kind, message) {
  refs.feedStatus.className = `status-pill ${kind}`;
  refs.feedStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(
    message,
  )}</span>`;
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

window.RMViewer = {
  parseLiveInfo,
  normalizeSources,
  pickSource,
};
