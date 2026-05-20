const LIVE_JSON_BASE_URL = "https://schedule.scutbot.cn/api/live_json";
const FEED_URL = "https://rm-static.djicdn.com/live_json/live_game_info.json";
const SCHEDULE_FEED_URL = `${LIVE_JSON_BASE_URL}/schedule.json`;
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
const PREVIEW_MODES = [
  { id: "live", label: "实时预览" },
  { id: "smart", label: "智能省流" },
  { id: "poster", label: "头像占位" },
];
const FOCUS_SIDES = [
  { id: "all", label: "全部视角优先" },
  { id: "red", label: "红方优先" },
  { id: "blue", label: "蓝方优先" },
];

// ---- Danmaku Client (Leancloud IM) ----

const LEANCLOUD_APP_ID = "UqaoAgYDPakCHxtDiMXVy2Sw-gzGzoHsz";
const LEANCLOUD_APP_KEY = "xYO2wtjhri9dJR7Vor8kDFl4";
const LEANCLOUD_SERVER_URL = "https://uqaoagyd.lc-cn-n1-shared.com";

function generateClientId() {
  let id = localStorage.getItem("rm-danmaku-client-id");
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("rm-danmaku-client-id", id);
  }
  return id;
}

class DanmakuClient {
  constructor() {
    this.roomId = null;
    this.clientId = generateClientId();
    this.listeners = new Set();
    this.connected = false;
    this.rt = null;
    this.conv = null;
    this.sdkAvailable = false;
  }

  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _emit(msg) { for (const fn of this.listeners) fn(msg); }

  async connect(roomId) {
    if (this.roomId === roomId && this.connected) return;
    await this.disconnect();

    // Check if Leancloud SDK is available
    if (typeof window.AV === "undefined") {
      console.warn("[Danmaku] Leancloud SDK not loaded — using local-only mode");
      this.sdkAvailable = false;
      this.roomId = roomId;
      return;
    }

    try {
      const AV = window.AV;
      if (typeof AV.init === "function") {
        AV.init({
          appId: LEANCLOUD_APP_ID,
          appKey: LEANCLOUD_APP_KEY,
          serverURL: LEANCLOUD_SERVER_URL,
        });
      }

      const Realtime = AV.Realtime || AV.realtime;
      if (!Realtime) {
        console.warn("[Danmaku] AV.Realtime not available — using local-only mode");
        this.sdkAvailable = false;
        this.roomId = roomId;
        return;
      }

      const client = typeof Realtime.createClient === "function"
        ? await Realtime.createClient({ clientId: this.clientId })
        : await new Realtime({
          appId: LEANCLOUD_APP_ID,
          appKey: LEANCLOUD_APP_KEY,
          serverURL: LEANCLOUD_SERVER_URL,
          server: {
            RTMRouter: "https://router-g0-push.leancloud.cn",
            api: "https://api.leancloud.cn",
          },
          }).createIMClient(this.clientId);
      this.rt = client;
      this.sdkAvailable = true;

      const messageEvent = AV.Event?.MESSAGE || "message";
      client.on(messageEvent, (msg) => {
        const text = typeof msg.getText === "function" ? msg.getText() : (msg.text || msg.content?._lctext || "");
        if (text && msg.from !== this.clientId) {
          const attrs = typeof msg.getAttributes === "function" ? msg.getAttributes() : (msg.attrs || msg.attributes || {});
          this._emit({
            id: msg.id || `msg-${Date.now()}`,
            text,
            timestamp: msg.timestamp || Date.now(),
            username: msg.from || "unknown",
            nickname: attrs.nickname || msg.from || "",
            schoolName: attrs.schoolName || "",
            source: "live",
          });
        }
      });

      if (typeof client.login === "function") await client.login();
      let conv = null;
      try {
        conv = await client.getChatRoomQuery?.().equalTo("objectId", roomId).compact(true).limit(1).first();
      } catch (e) { /* fall back to getConversation */ }
      if (!conv) conv = await client.getConversation(roomId, true);
      await conv.join();
      this.conv = conv;
      this.roomId = roomId;
      this.connected = true;
    } catch (e) {
      console.warn("[Danmaku] Connection failed, using local-only mode:", e.message || e);
      this.connected = false;
      this.sdkAvailable = false;
      this.roomId = roomId;
    }
  }

  async sendMessage(text, attrs = {}) {
    if (!this.connected || !this.conv) return false;
    try {
      const AV = window.AV;
      const TextMessage = AV.TextMessage || AV.Text;
      if (!TextMessage) return false;
      const message = new TextMessage(text);
      if (typeof message.setAttributes === "function") {
        message.setAttributes(attrs);
      } else {
        message.attrs = attrs;
      }
      await this.conv.send(message);
      return true;
    } catch (e) {
      console.warn("[Danmaku] Send failed:", e.message || e);
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.conv) { await this.conv.leave().catch(() => {}); this.conv = null; }
      if (this.rt) { await this.rt.close().catch(() => {}); this.rt = null; }
    } catch (e) { /* ignore */ }
    this.roomId = null;
    this.connected = false;
    this.sdkAvailable = false;
  }
}
const state = {
  zones: [],
  eventName: "赛事多视角监看系统",
  selectedZoneId: "",
  selectedStreamId: "",
  mainStreamIds: [],
  filter: "",
  lastUpdatedAt: null,
  mainHls: new Map(),
  thumbHls: new Map(),
  mainMutedBySlot: [],
  isLoading: false,
  layout: "one-plus",
  mainResolution: "high",
  previewMode: "smart",
  focusSide: "all",
  cleanMode: false,
  thumbObserver: null,
  danmakuEnabled: false,
  danmakuClient: new DanmakuClient(),
  danmakuMessages: [],
  danmakuMaxMessages: 120,
  activeTab: "streams",
  currentMatch: null,
  scheduleData: [],
  scheduleLastLoadedAt: null,
  followedMatchIds: new Set(),
  danmakuRendererId: null,
  scheduleZoneData: {},
};

document.addEventListener("DOMContentLoaded", () => {
  bindRefs();
  bindEvents();
  renderLayoutOptions();
  renderResolutionOptions();
  renderPreviewModeOptions();
  renderFocusSideOptions();
  applyLayoutConfig(false);
  renderIcons();
  loadFeed();
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
    "previewModeSelect",
    "focusSideSelect",
    "cleanModeButton",
    "cleanExitButton",
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
    "matchScoreBar",
    "redTeamName",
    "redTeamSchool",
    "redTeamAvatar",
    "blueTeamName",
    "blueTeamSchool",
    "blueTeamAvatar",
    "redScore",
    "blueScore",
    "matchStatusBadge",
    "matchStageLabel",
    "matchBOLabel",
    "matchTimeLabel",
    "danmakuLayer",
    "danmakuInputBar",
    "danmakuInput",
    "danmakuSendBtn",
    "danmakuToggle",
    "tabStreams",
    "tabSchedule",
    "schedulePanel",
    "scheduleList",
    "scheduleEmpty",
  ].forEach((id) => {
    refs[id] = document.getElementById(id);
  });
  // Load followed matches from storage
  loadFollowedMatches();
}

function bindEvents() {
  refs.refreshButton.addEventListener("click", loadFeed);
  refs.zoneSelect.addEventListener("change", (event) => {
    state.selectedZoneId = event.target.value;
    state.selectedStreamId = "";
    state.mainStreamIds = [];
    reconcileMainSlots();
    parseMatchFromFeed();
    render();
    // Reconnect danmaku to new zone's chat room
    if (state.danmakuEnabled) applyDanmakuState();
  });
  refs.viewFilter.addEventListener("input", (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    reconcileMainSlots();
    render();
  });
  refs.layoutSelect.addEventListener("change", (event) => {
    state.layout = event.target.value;
    applyLayoutConfig(true);
    reconcileMainSlots();
    render();
  });
  refs.mainResolutionSelect.addEventListener("change", (event) => {
    state.mainResolution = event.target.value;
    renderMainPlayers();
    renderIcons();
  });
  refs.previewModeSelect.addEventListener("change", (event) => {
    state.previewMode = event.target.value;
    renderThumbs();
    renderIcons();
  });
  refs.focusSideSelect.addEventListener("change", (event) => {
    state.focusSide = event.target.value;
    renderThumbs();
    renderIcons();
  });
  refs.cleanModeButton.addEventListener("click", () => {
    setCleanMode(!state.cleanMode);
  });
  refs.cleanExitButton.addEventListener("click", () => {
    setCleanMode(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.cleanMode) {
      setCleanMode(false);
    }
  });
  // Danmaku toggle
  refs.danmakuToggle.addEventListener("click", () => {
    state.danmakuEnabled = !state.danmakuEnabled;
    applyDanmakuState();
    renderIcons();
  });
  // Danmaku send
  refs.danmakuSendBtn.addEventListener("click", sendDanmaku);
  refs.danmakuInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendDanmaku();
  });
  // Tab switching
  refs.tabStreams.addEventListener("click", () => switchTab("streams"));
  refs.tabSchedule.addEventListener("click", () => switchTab("schedule"));
  // Danmaku message listener
  state.danmakuClient.onMessage((msg) => {
    state.danmakuMessages.push(msg);
    if (state.danmakuMessages.length > state.danmakuMaxMessages) {
      state.danmakuMessages.splice(0, state.danmakuMessages.length - state.danmakuMaxMessages);
    }
    if (state.danmakuEnabled) spawnDanmakuBullet(msg);
  });
  refs.mainGrid.addEventListener("click", (event) => {
    const retryButton = event.target.closest("[data-action='retry-main']");
    if (retryButton) {
      renderMainPlayers();
      return;
    }

    const muteButton = event.target.closest("[data-action='toggle-mute']");
    if (muteButton) {
      const frame = muteButton.closest(".main-frame");
      const slotIndex = getFrameSlotIndex(frame);
      if (slotIndex < 0) return;

      const muted = !isMainSlotMuted(slotIndex);
      setMainSlotMuted(slotIndex, muted);
      const video = frame.querySelector("video");
      if (video) {
        video.muted = muted;
        if (!muted) video.play().catch(() => {});
      }
      syncMuteButton(muteButton, muted);
      renderIcons();
      return;
    }

    const pipButton = event.target.closest("[data-action='toggle-pip']");
    if (pipButton) {
      const video = pipButton.closest(".video-frame")?.querySelector("video");
      togglePictureInPicture(video);
      return;
    }

    const fullscreenButton = event.target.closest("[data-action='toggle-fullscreen']");
    if (fullscreenButton) {
      const frame = fullscreenButton.closest(".video-frame");
      toggleFullscreen(frame);
    }
  });
  refs.thumbGrid.addEventListener("click", (event) => {
    const assignButton = event.target.closest("[data-action='assign-main']");
    if (assignButton) {
      assignMainStream(assignButton.dataset.streamId || "", Number(assignButton.dataset.slotIndex || 0));
      return;
    }

    const card = event.target.closest(".thumb-card");
    if (card && getCurrentLayout().mainCount === 1) {
      assignMainStream(card.dataset.streamId || "", 0);
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

function renderPreviewModeOptions() {
  refs.previewModeSelect.innerHTML = PREVIEW_MODES.map(
    (item) => `<option value="${item.id}">${item.label}</option>`,
  ).join("");
  refs.previewModeSelect.value = state.previewMode;
}

function renderFocusSideOptions() {
  refs.focusSideSelect.innerHTML = FOCUS_SIDES.map(
    (item) => `<option value="${item.id}">${item.label}</option>`,
  ).join("");
  refs.focusSideSelect.value = state.focusSide;
}

function applyLayoutConfig(resetResolution) {
  const layout = getCurrentLayout();
  if (resetResolution) {
    state.mainResolution = layout.defaultRes;
  }
  refs.viewerLayout.dataset.layout = layout.id;
  refs.mainResolutionSelect.value = state.mainResolution;
  refs.mainResolutionSelect.disabled = layout.mainCount === 0;
  refs.previewModeSelect.value = state.previewMode;
  refs.focusSideSelect.value = state.focusSide;
  if (refs.smallPanelTitle) refs.smallPanelTitle.textContent = layout.mainCount === 0 ? "全部视角" : "可切换视角";
  refs.smallPanelHint.textContent = state.previewMode === "poster"
    ? "停止小窗拉流"
    : layout.mainCount === 0
      ? "4x4 低清预览"
      : state.activeTab === "schedule"
        ? "点击关注比赛"
        : "可见小窗低清拉流";
}

function setCleanMode(enabled) {
  state.cleanMode = Boolean(enabled);
  document.body.classList.toggle("clean-mode", state.cleanMode);
  refs.cleanModeButton.setAttribute("aria-pressed", String(state.cleanMode));
  refs.cleanModeButton.classList.toggle("active", state.cleanMode);
  refs.cleanModeButton.querySelector("span").textContent = state.cleanMode ? "退出纯净" : "纯净";
  refs.cleanExitButton.hidden = !state.cleanMode;
  const icon = refs.cleanModeButton.querySelector("i");
  if (icon) icon.setAttribute("data-lucide", state.cleanMode ? "monitor-x" : "monitor-up");
  refs.viewerLayout.dataset.clean = state.cleanMode ? "true" : "false";

  // Hide score bar and danmaku in clean mode
  refs.matchScoreBar.hidden = state.cleanMode ? true : (state.currentMatch ? false : true);
  if (state.cleanMode && state.danmakuEnabled) {
    refs.danmakuLayer.hidden = true;
    refs.danmakuInputBar.hidden = true;
  } else if (!state.cleanMode && state.danmakuEnabled) {
    refs.danmakuLayer.hidden = false;
    refs.danmakuInputBar.hidden = false;
  }

  renderThumbs();
  syncVideoControls();
  renderIcons();
}

function syncVideoControls(root = document) {
  root.querySelectorAll(".main-frame video").forEach((video) => {
    video.controls = !state.cleanMode;
  });
}

async function loadFeed() {
  if (state.isLoading) return;
  state.isLoading = true;
  setFeedStatus("warn", "正在更新");

  try {
    const response = await fetchJsonWithFallback([FEED_URL], { timeoutMs: 6000 });

    const payload = response.data;
    const parsed = parseLiveInfo(payload);
    state.zones = parsed.zones;
    state.eventName = parsed.eventName || "赛事多视角监看系统";
    state.lastUpdatedAt = new Date();

    // Store raw zone data for schedule matching
    if (payload?.eventData) {
      for (const z of payload.eventData) {
        const zid = String(z.zoneId ?? "");
        parsed.zones.forEach(pz => {
          if (pz.zoneId === zid) pz._raw = z;
        });
      }
    }

    // Parse schedule data from feed
    const matches = parseAllMatchesFromFeed(payload);
    if (matches.length > 0) {
      state.scheduleData = matches;
    }
    fetchScheduleData().then(() => {
      parseMatchFromFeed();
      if (state.activeTab === "schedule") renderSchedule();
    });

    reconcileSelection();
    render();
    parseMatchFromFeed();
    setFeedStatus("ok", "已连接实时源");
  } catch (error) {
    console.error(error);
    setFeedStatus("error", feedErrorMessage(error));
    render();
  } finally {
    state.isLoading = false;
  }
}

async function fetchJsonWithFallback(urls, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8000;
  let lastError = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { data: await response.json(), url };
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError || new Error("fetch failed");
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
            side: "neutral",
            headimg: normalizeImageUrl(zone.headimg || zone.headImg || zone.logo || zone.icon),
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
              side: detectStreamSide(role, item),
              headimg: normalizeImageUrl(item.headimg || item.headImg || item.avatar || item.icon),
              sources: normalizeSources(item.sources),
            });
          });
        }

        return { zoneId, zoneName, streams: streams.filter((stream) => stream.sources.length > 0) };
      })
    : [];

  return { eventName: payload?.eventName || "赛事多视角监看系统", zones };
}

function detectStreamSide(role, item = {}) {
  const text = `${role || ""} ${item.name || ""} ${item.team || ""} ${item.color || ""}`.toLowerCase();
  if (/红|red/.test(text)) return "red";
  if (/蓝|blue/.test(text)) return "blue";
  return "neutral";
}

function normalizeImageUrl(value) {
  if (!value) return "";
  const url = String(value).trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
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
    state.mainStreamIds = [];
    return;
  }

  if (!state.zones.some((zone) => zone.zoneId === state.selectedZoneId)) {
    state.selectedZoneId = (state.zones.find((zone) => zone.streams.length > 0) || state.zones[0]).zoneId;
  }

  const zone = getSelectedZone();
  if (!zone?.streams.some((stream) => stream.id === state.selectedStreamId)) {
    state.selectedStreamId = zone?.streams.find((stream) => stream.kind === "main")?.id || zone?.streams[0]?.id || "";
  }
  reconcileMainSlots();
}

function reconcileMainSlots() {
  const layout = getCurrentLayout();
  if (layout.mainCount === 0) {
    state.mainStreamIds = [];
    state.mainMutedBySlot = [];
    return;
  }

  const streams = getFilteredStreams();
  const validIds = new Set(streams.map((stream) => stream.id));
  const nextIds = state.mainStreamIds
    .slice(0, layout.mainCount)
    .map((streamId) => (validIds.has(streamId) ? streamId : ""));

  for (const stream of streams) {
    if (nextIds.length >= layout.mainCount && nextIds.every(Boolean)) break;
    if (nextIds.includes(stream.id)) continue;

    const emptyIndex = nextIds.findIndex((streamId) => !streamId);
    if (emptyIndex >= 0) {
      nextIds[emptyIndex] = stream.id;
    } else if (nextIds.length < layout.mainCount) {
      nextIds.push(stream.id);
    }
  }

  state.mainStreamIds = Array.from({ length: layout.mainCount }, (_item, index) => nextIds[index] || "");
  state.mainMutedBySlot = Array.from(
    { length: layout.mainCount },
    (_item, index) => state.mainMutedBySlot[index] !== false,
  );
  if (!state.selectedStreamId || !validIds.has(state.selectedStreamId)) {
    state.selectedStreamId = state.mainStreamIds.find(Boolean) || streams[0]?.id || "";
  }
}

function assignMainStream(streamId, slotIndex) {
  const layout = getCurrentLayout();
  if (!streamId || layout.mainCount === 0) return;

  const boundedSlotIndex = Math.min(Math.max(slotIndex, 0), layout.mainCount - 1);
  reconcileMainSlots();
  state.mainStreamIds[boundedSlotIndex] = streamId;
  state.selectedStreamId = streamId;
  renderMainPlayers();
  renderThumbs();
  renderIcons();
}

function render() {
  applyLayoutConfig(false);
  refs.viewerLayout.dataset.clean = state.cleanMode ? "true" : "false";
  refs.eventTitle.textContent = state.eventName;
  renderZones();
  renderMeta();
  renderMainPlayers();
  if (state.activeTab === "schedule") {
    destroyMissingThumbPlayers(new Set());
    refs.thumbGrid.hidden = true;
    refs.schedulePanel.hidden = false;
    renderSchedule();
  } else {
    refs.thumbGrid.hidden = false;
    refs.schedulePanel.hidden = true;
    renderThumbs();
  }
  parseMatchFromFeed();
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

  reconcileMainSlots();
  const slots = getMainSlots();
  const populatedSlots = slots.filter((slot) => slot.stream);
  const desiredKeys = new Set(populatedSlots.map((slot) => mainKey(slot.slotIndex, slot.stream.id)));
  destroyMissingMainPlayers(desiredKeys);

  if (!populatedSlots.length) {
    refs.mainGrid.innerHTML = "";
    refs.mainEmpty.hidden = false;
    refs.mainEmpty.querySelector("p").textContent = state.zones.length ? "没有符合条件的直播源。" : "等待直播源。";
    return;
  }

  refs.mainEmpty.hidden = true;
  syncMainSlots(slots);
}

function syncMainSlots(slots) {
  const validSlotIndexes = new Set(slots.map((slot) => String(slot.slotIndex)));
  refs.mainGrid.querySelectorAll(".main-frame").forEach((frame) => {
    if (!validSlotIndexes.has(frame.dataset.slotIndex || "")) {
      destroyPlayerForFrame(frame, state.mainHls);
      frame.remove();
    }
  });

  slots.forEach((slot) => {
    const existing = refs.mainGrid.querySelector(`.main-frame[data-slot-index="${slot.slotIndex}"]`);
    if (!slot.stream) {
      const placeholder = elementFromHtml(renderMainSlot(slot));
      if (existing) {
        destroyPlayerForFrame(existing, state.mainHls);
        existing.replaceWith(placeholder);
      } else {
        refs.mainGrid.appendChild(placeholder);
      }
      return;
    }

    const source = pickSource(slot.stream, "main");
    const key = mainKey(slot.slotIndex, slot.stream.id);
    let frame = existing;
    if (!frame || frame.dataset.playerKey !== key) {
      const nextFrame = elementFromHtml(renderMainCard(slot.stream, slot.slotIndex));
      if (frame) {
        destroyPlayerForFrame(frame, state.mainHls);
        frame.replaceWith(nextFrame);
      } else {
        refs.mainGrid.appendChild(nextFrame);
      }
      frame = nextFrame;
    } else {
      updateMainCard(frame, slot.stream, slot.slotIndex, source);
    }

    const video = frame.querySelector(`video[data-player-key="${cssEscape(key)}"]`);
    if (video && source) attachHls(video, source.src, key, "main");
  });

}

function renderMainSlot(slot) {
  if (!slot.stream) {
    return `
      <div class="video-frame main-frame main-placeholder" data-slot-index="${slot.slotIndex}">
        <div class="main-placeholder-content">
          <p>大屏 ${slot.slotIndex + 1}</p>
          <span>从下方小视角添加</span>
        </div>
      </div>
    `;
  }

  return renderMainCard(slot.stream, slot.slotIndex);
}

function renderMainCard(stream, slotIndex) {
  const source = pickSource(stream, "main");
  const controls = state.cleanMode ? "" : " controls";
  const muted = isMainSlotMuted(slotIndex);
  const mutedAttr = muted ? " muted" : "";
  return `
    <div class="video-frame main-frame" data-stream-id="${escapeAttr(stream.id)}" data-slot-index="${slotIndex}" data-player-key="${escapeAttr(mainKey(slotIndex, stream.id))}">
      <video${controls}${mutedAttr} autoplay playsinline preload="auto" data-player-key="${escapeAttr(mainKey(slotIndex, stream.id))}"></video>
      <div class="video-overlay">
        <div class="stream-identity">
          ${renderAvatar(stream, "main")}
          <div>
            <p class="video-kicker">${escapeHtml(stream.zoneName)}</p>
            <h2><span>大屏 ${slotIndex + 1}</span>${escapeHtml(stream.title)}</h2>
          </div>
        </div>
        <div class="overlay-actions">
          <span class="quality-badge">${escapeHtml(source?.label || "--")}</span>
          <button class="icon-button" data-action="toggle-pip" type="button" aria-label="画中画" title="画中画">
            <i data-lucide="picture-in-picture-2" aria-hidden="true"></i>
          </button>
          <button class="icon-button" data-action="toggle-fullscreen" type="button" aria-label="全屏" title="全屏">
            <i data-lucide="maximize" aria-hidden="true"></i>
          </button>
          <button class="icon-button" data-action="toggle-mute" type="button" aria-label="${muted ? "取消静音" : "静音"}" title="${muted ? "取消静音" : "静音"}" aria-pressed="${muted}">
            <i data-lucide="${muted ? "volume-x" : "volume-2"}" aria-hidden="true"></i>
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

function updateMainCard(frame, stream, slotIndex, source) {
  frame.dataset.streamId = stream.id;
  const identity = frame.querySelector(".stream-identity");
  if (identity) {
    identity.innerHTML = `
      ${renderAvatar(stream, "main")}
      <div>
        <p class="video-kicker">${escapeHtml(stream.zoneName)}</p>
        <h2><span>大屏 ${slotIndex + 1}</span>${escapeHtml(stream.title)}</h2>
      </div>
    `;
  }
  const quality = frame.querySelector(".quality-badge");
  if (quality) quality.textContent = source?.label || "--";
  const muteButton = frame.querySelector("[data-action='toggle-mute']");
  if (muteButton) syncMuteButton(muteButton, isMainSlotMuted(slotIndex));
  syncVideoControls(frame);
}

function renderThumbs() {
  const streams = getThumbStreams();
  syncCleanGridMetrics(streams.length);
  destroyMissingThumbPlayers(new Set(streams.map((stream) => thumbKey(stream.id))));

  refs.emptyState.hidden = streams.length > 0;
  syncThumbCards(streams);

  if (!streams.length) {
    const zone = getSelectedZone();
    refs.emptyState.querySelector("p").textContent = zone?.streams.length
      ? "没有符合筛选条件的其他视角。"
      : "当前赛区还没有可用直播源。";
  }
}

function syncCleanGridMetrics(thumbCount) {
  const layout = getCurrentLayout();
  const count = Math.max(thumbCount, 1);
  const cols = layout.id === "one-plus"
    ? Math.min(count, count > 8 ? 2 : 1)
    : Math.max(1, Math.ceil(Math.sqrt(count * 16 / 9)));
  const rows = Math.max(1, Math.ceil(count / cols));
  refs.thumbGrid.style.setProperty("--clean-thumb-cols", String(cols));
  refs.thumbGrid.style.setProperty("--clean-thumb-rows", String(rows));
}

function syncThumbCards(streams) {
  const allowedKeys = new Set(streams.map((stream) => thumbKey(stream.id)));
  refs.thumbGrid.querySelectorAll(".thumb-card").forEach((card) => {
    const key = card.dataset.playerKey || "";
    if (!allowedKeys.has(key)) {
      destroyPlayerForFrame(card, state.thumbHls);
      card.remove();
    }
  });

  streams.forEach((stream) => {
    const key = thumbKey(stream.id);
    const source = pickSource(stream, "thumb");
    let card = refs.thumbGrid.querySelector(`.thumb-card[data-player-key="${cssEscape(key)}"]`);
    if (!card) {
      card = elementFromHtml(renderThumbCard(stream));
    } else {
      updateThumbCard(card, stream, source);
    }
    refs.thumbGrid.appendChild(card);

    const video = card.querySelector(`video[data-player-key="${cssEscape(key)}"]`);
    if (!video || !source || (state.previewMode === "poster" && !state.cleanMode)) {
      destroyPlayer(key, state.thumbHls);
      return;
    }

    video.dataset.playerSrc = source.src;
    if (state.previewMode === "smart" && !state.cleanMode) {
      observeThumbVideo(video);
    } else {
      unobserveThumbVideo(video);
      attachHls(video, source.src, key, "thumb");
    }
  });
}

function renderThumbCard(stream) {
  const source = pickSource(stream, "thumb");
  const assignedSlots = getAssignedSlotIndexes(stream.id);
  const active = assignedSlots.length ? " active" : "";
  return `
    <article class="thumb-card${active}" data-stream-id="${escapeAttr(stream.id)}" data-player-key="${escapeAttr(thumbKey(stream.id))}">
      <div class="video-frame thumb-video">
        ${renderThumbMedia(stream)}
      </div>
      <div class="thumb-identity">
        ${renderAvatar(stream, "thumb")}
        <span class="thumb-title">${escapeHtml(stream.shortTitle)}</span>
      </div>
      <span class="thumb-meta">
        <span>${escapeHtml(stream.kind === "main" ? "主视角" : "第一视角")}</span>
        <span>${escapeHtml(source?.label || "--")}</span>
      </span>
      ${renderAssignControls(stream.id)}
    </article>
  `;
}

function renderThumbMedia(stream) {
  if (state.previewMode === "poster" && !state.cleanMode) {
    return `
      <div class="thumb-poster">
        ${renderAvatar(stream, "poster")}
      </div>
    `;
  }

  return `<video muted autoplay playsinline preload="none" data-player-key="${escapeAttr(thumbKey(stream.id))}"></video>`;
}

function updateThumbCard(card, stream, source) {
  const assignedSlots = getAssignedSlotIndexes(stream.id);
  card.classList.toggle("active", assignedSlots.length > 0);
  const media = card.querySelector(".thumb-video");
  if (media) {
    const wantsPoster = state.previewMode === "poster";
    const hasPoster = Boolean(media.querySelector(".thumb-poster"));
    if (wantsPoster !== hasPoster) {
      destroyPlayer(thumbKey(stream.id), state.thumbHls);
      media.innerHTML = renderThumbMedia(stream);
    }
  }
  const identity = card.querySelector(".thumb-identity");
  if (identity) {
    identity.innerHTML = `${renderAvatar(stream, "thumb")}<span class="thumb-title">${escapeHtml(stream.shortTitle)}</span>`;
  }
  const meta = card.querySelector(".thumb-meta");
  if (meta) {
    meta.innerHTML = `
      <span>${escapeHtml(stream.kind === "main" ? "主视角" : "第一视角")}</span>
      <span>${escapeHtml(source?.label || "--")}</span>
    `;
  }
  const controls = card.querySelector(".assign-controls, .assign-main-button");
  const nextControls = elementFromHtml(`<div>${renderAssignControls(stream.id)}</div>`);
  if (controls) {
    controls.replaceWith(...nextControls.childNodes);
  } else {
    card.append(...nextControls.childNodes);
  }
}

function renderAvatar(stream, size) {
  const initials = stream.shortTitle?.slice(0, 2) || "RM";
  const image = stream.headimg
    ? `<img src="${escapeAttr(stream.headimg)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true">`
    : "";
  return `
    <span class="stream-avatar stream-avatar-${size}" aria-hidden="true">
      ${image}
      <span>${escapeHtml(initials)}</span>
    </span>
  `;
}

function renderAssignControls(streamId) {
  const layout = getCurrentLayout();
  if (layout.mainCount === 0) return "";

  if (layout.mainCount === 1) {
    return `
      <button class="text-button assign-main-button" data-action="assign-main" data-stream-id="${escapeAttr(streamId)}" data-slot-index="0" type="button">
        添加到大屏
      </button>
    `;
  }

  const buttons = Array.from({ length: layout.mainCount }, (_item, index) => {
    const active = state.mainStreamIds[index] === streamId ? " active" : "";
    return `
      <button class="slot-button${active}" data-action="assign-main" data-stream-id="${escapeAttr(streamId)}" data-slot-index="${index}" type="button" aria-label="添加到大屏 ${index + 1}">
        ${index + 1}
      </button>
    `;
  }).join("");

  return `
    <div class="assign-controls" aria-label="添加到大屏">
      <span>添加到</span>
      <div class="slot-button-group">${buttons}</div>
    </div>
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

function getMainSlots() {
  const layout = getCurrentLayout();
  if (layout.mainCount === 0) return [];

  const streamsById = new Map(getFilteredStreams().map((stream) => [stream.id, stream]));
  return Array.from({ length: layout.mainCount }, (_item, slotIndex) => ({
    slotIndex,
    stream: streamsById.get(state.mainStreamIds[slotIndex]) || null,
  }));
}

function getThumbStreams() {
  const layout = getCurrentLayout();
  const streams = getFilteredStreams();
  if (layout.mainCount === 0) return sortStreamsForFocus(streams);

  reconcileMainSlots();
  return sortStreamsForFocus(streams);
}

function sortStreamsForFocus(streams) {
  if (state.focusSide === "all") return [...streams];
  const preferredSide = state.focusSide;
  return [...streams].sort((a, b) => {
    const aScore = focusRank(a, preferredSide);
    const bScore = focusRank(b, preferredSide);
    if (aScore !== bScore) return aScore - bScore;
    return 0;
  });
}

function focusRank(stream, preferredSide) {
  if (stream.side === preferredSide) return 0;
  if (stream.side === "neutral") return 1;
  return 2;
}

function getAssignedSlotIndexes(streamId) {
  return state.mainStreamIds
    .map((assignedStreamId, index) => (assignedStreamId === streamId ? index : -1))
    .filter((index) => index >= 0);
}

function getFrameSlotIndex(frame) {
  const slotIndex = Number(frame?.dataset?.slotIndex);
  return Number.isInteger(slotIndex) ? slotIndex : -1;
}

function isMainSlotMuted(slotIndex) {
  return state.mainMutedBySlot[slotIndex] !== false;
}

function setMainSlotMuted(slotIndex, muted) {
  state.mainMutedBySlot[slotIndex] = Boolean(muted);
}

function getVideoMuted(video, group) {
  if (group !== "main") return true;
  return isMainSlotMuted(getFrameSlotIndex(video.closest(".main-frame")));
}

function syncMuteButton(button, muted) {
  button.setAttribute("aria-label", muted ? "取消静音" : "静音");
  button.setAttribute("title", muted ? "取消静音" : "静音");
  button.setAttribute("aria-pressed", String(muted));
  button.querySelector("i")?.setAttribute("data-lucide", muted ? "volume-x" : "volume-2");
}

function attachHls(video, src, key, group) {
  if (!video || !src) return;
  const store = group === "main" ? state.mainHls : state.thumbHls;
  const previous = store.get(key);
  if (previous?.src === src && video.dataset.attachedSrc === src) {
    video.muted = getVideoMuted(video, group);
    video.play().catch(() => {});
    return;
  }
  if (previous?.src && video.dataset.attachedSrc && playbackResourceKey(previous.src) === playbackResourceKey(src)) {
    previous.src = src;
    video.muted = getVideoMuted(video, group);
    hideVideoError(video);
    video.play().catch(() => {});
    return;
  }

  destroyPlayer(key, store);

  video.pause();
  video.removeAttribute("src");
  video.load();
  video.muted = getVideoMuted(video, group);
  video.dataset.attachedSrc = src;
  hideVideoError(video);

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    video.play().catch(() => {});
    store.set(key, { hls: null, src });
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
  store.set(key, { hls, src });
}

function showVideoError(video) {
  const error = video.closest(".video-frame")?.querySelector(".video-error");
  if (error) error.hidden = false;
}

function hideVideoError(video) {
  const error = video.closest(".video-frame")?.querySelector(".video-error");
  if (error) error.hidden = true;
}

function destroyMissingMainPlayers(allowedKeys) {
  destroyMissingPlayers(state.mainHls, allowedKeys);
}

function destroyMissingThumbPlayers(allowedKeys) {
  destroyMissingPlayers(state.thumbHls, allowedKeys);
}

function destroyMissingPlayers(store, allowedKeys) {
  for (const [key] of store.entries()) {
    if (!allowedKeys.has(key)) {
      destroyPlayer(key, store);
    }
  }
}

function destroyPlayerForFrame(frame, store) {
  frame?.querySelectorAll?.("video").forEach(unobserveThumbVideo);
  const key = frame?.dataset?.playerKey || frame?.querySelector?.("video")?.dataset?.playerKey;
  if (key) destroyPlayer(key, store);
}

function destroyPlayer(key, store) {
  const player = store.get(key);
  if (player?.hls) player.hls.destroy();
  store.delete(key);
}

function playbackResourceKey(src) {
  try {
    const url = new URL(src, window.location.href);
    ["auth_key", "txSecret", "txTime", "sign", "expires"].forEach((param) => url.searchParams.delete(param));
    return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
  } catch (_error) {
    return String(src).replace(/([?&](auth_key|txSecret|txTime|sign|expires)=)[^&]+/g, "$1");
  }
}

function observeThumbVideo(video) {
  if (!("IntersectionObserver" in window)) {
    attachHls(video, video.dataset.playerSrc, video.dataset.playerKey, "thumb");
    return;
  }

  if (!state.thumbObserver) {
    state.thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const target = entry.target;
        const key = target.dataset.playerKey;
        const src = target.dataset.playerSrc;
        if (entry.isIntersecting) {
          attachHls(target, src, key, "thumb");
        } else if (key) {
          destroyPlayer(key, state.thumbHls);
          target.pause();
          target.removeAttribute("src");
          target.removeAttribute("data-attached-src");
          target.load();
        }
      });
    }, { root: refs.thumbGrid, rootMargin: "240px" });
  }

  state.thumbObserver.observe(video);
}

function unobserveThumbVideo(video) {
  if (state.thumbObserver) state.thumbObserver.unobserve(video);
}

async function togglePictureInPicture(video) {
  if (!video || !document.pictureInPictureEnabled || video.disablePictureInPicture) return;
  try {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (error) {
    console.warn("Picture-in-picture failed", error);
  }
}

async function toggleFullscreen(frame) {
  if (!frame) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (frame.requestFullscreen) {
      await frame.requestFullscreen();
    } else {
      const video = frame.querySelector("video");
      video?.webkitEnterFullscreen?.();
    }
  } catch (error) {
    console.warn("Fullscreen failed", error);
  }
}

function setFeedStatus(kind, message) {
  refs.feedStatus.className = `status-pill ${kind}`;
  refs.feedStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(message)}</span>`;
}

function elementFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
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
const mainKey = (slotIndex, streamId) => `main:${slotIndex}:${streamId}`;
const thumbKey = (streamId) => `thumb:${streamId}`;
const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

// ===== Tab Switching =====

function switchTab(tab) {
  state.activeTab = tab;
  refs.tabStreams.classList.toggle("active", tab === "streams");
  refs.tabStreams.setAttribute("aria-selected", String(tab === "streams"));
  refs.tabSchedule.classList.toggle("active", tab === "schedule");
  refs.tabSchedule.setAttribute("aria-selected", String(tab === "schedule"));

  const scheduleActive = tab === "schedule";
  refs.thumbGrid.hidden = scheduleActive;
  refs.emptyState.hidden = scheduleActive || getFilteredStreams().length > 0;
  refs.schedulePanel.hidden = !scheduleActive;
  refs.smallPanelHint.hidden = scheduleActive;

  if (scheduleActive) {
    destroyMissingThumbPlayers(new Set());
    renderSchedule();
  }
  if (!scheduleActive) renderThumbs();

  renderIcons();
}

// ===== Match Data Parsing =====

function parseMatchFromFeed() {
  // Try DJI feed zone data first, then schedule API data
  const zone = getSelectedZone();
  if (!zone) { state.currentMatch = null; return; }

  // Try to find running match from schedule data
  const scheduleMatches = state.scheduleData || [];
  const zoneId = String(zone.zoneId ?? "");
  const zoneMatches = scheduleMatches.filter(
    (m) => String(m.zoneId) === zoneId || String(m.zoneName) === zone.zoneName
  );

  // Find currently live match or most recent
  const liveMatch = zoneMatches.find((m) => m.status === "live") ||
    zoneMatches.find((m) => m.status === "upcoming") || null;

  if (liveMatch) {
    state.currentMatch = liveMatch;
  } else if (state.scheduleZoneData[zoneId]) {
    state.currentMatch = state.scheduleZoneData[zoneId].currentMatch || null;
  } else {
    state.currentMatch = null;
  }

  updateScoreBar();
}

function parseAllMatchesFromFeed(rawData = null) {
  const matches = [];

  // Parse from DJI feed eventData (groupIdMatches + knockoutMatches)
  function extractMatches(zones) {
    const result = [];
    for (const zone of (Array.isArray(zones) ? zones : [])) {
      const zid = String(zone.zoneId ?? zone.id ?? "");
      const zname = zone.zoneName || zone.name || ("站点 " + zid);

      const groupNodes = zone.groupMatches?.nodes || zone.groupMatches || [];
      for (const gm of (Array.isArray(groupNodes) ? groupNodes : [])) {
        if (!gm) continue;
        result.push(normalizeMatchItem(gm, zid, zname));
      }

      const knockoutNodes = zone.knockoutMatches?.nodes || zone.knockoutMatches || [];
      for (const km of (Array.isArray(knockoutNodes) ? knockoutNodes : [])) {
        if (!km) continue;
        result.push(normalizeMatchItem(km, zid, zname));
      }
    }
    return result;
  }

  const scheduleZones = getScheduleZones(rawData);
  if (scheduleZones.length) {
    matches.push(...extractMatches(scheduleZones));
  }

  if (rawData?.eventData) {
    matches.push(...extractMatches(rawData.eventData));
  }

  // Parse from current zones
  if (state.zones.length && !matches.length) {
    const zoneData = state.zones.map(z => {
      const rawZone = z._raw || {};
      return {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        groupMatches: rawZone.groupMatches,
        knockoutMatches: rawZone.knockoutMatches,
      };
    });
    matches.push(...extractMatches(zoneData));
  }

  const eventTitle = firstText(rawData?.data?.event?.title, rawData?.current_event?.title, rawData?.currentEvent?.title, rawData?.eventName, "");
  const seenIds = new Set();
  return matches
    .map((match) => ({
      ...match,
      eventTitle: match.eventTitle || eventTitle,
    }))
    .filter((match) => {
      const key = `${match.zoneId}:${match.id}:${match.redTeam.teamName}:${match.blueTeam.teamName}`;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    })
    .sort((a, b) => (a.startedAtTs || Number.MAX_SAFE_INTEGER) - (b.startedAtTs || Number.MAX_SAFE_INTEGER));
}

function normalizeMatchItem(item, zoneId, zoneName) {
  const redSide = item.redSide || item.red_side || null;
  const blueSide = item.blueSide || item.blue_side || null;
  const redPlayer = redSide?.player || {};
  const bluePlayer = blueSide?.player || {};
  const redTeamObj = redPlayer.team || item.redTeam || item.red || {};
  const blueTeamObj = bluePlayer.team || item.blueTeam || item.blue || {};
  const redTeamName = firstText(
    redTeamObj.name,
    redTeamObj.teamName,
    item.redTeamName,
    item.redTeam,
    item.redName,
    item.loserPlaceholdName,
    "红方",
  );
  const blueTeamName = firstText(
    blueTeamObj.name,
    blueTeamObj.teamName,
    item.blueTeamName,
    item.blueTeam,
    item.blueName,
    item.winnerPlaceholdName,
    "蓝方",
  );
  const redCollege = firstText(item.redCollege, redTeamObj.collegeName, redTeamObj.schoolName, item.redCollegeName, "");
  const blueCollege = firstText(item.blueCollege, blueTeamObj.collegeName, blueTeamObj.schoolName, item.blueCollegeName, "");
  const redScore = item.redScore ?? item.redSideWinGameCount ?? redSide?.winGameCount ?? 0;
  const blueScore = item.blueScore ?? item.blueSideWinGameCount ?? blueSide?.winGameCount ?? 0;
  const score = String(item.score || `${redScore}:${blueScore}`);
  const statusRaw = String(item.status || item.statusRaw || item.matchStatus || "WAITING");
  const statusUpper = statusRaw.toUpperCase();
  const status = /LIVE|PLAYING|STARTED|RUNNING/.test(statusUpper) ? "live" :
    /END|FINISH|DONE/.test(statusUpper) ? "ended" : "upcoming";
  const startAt = firstText(item.planStartedAt, item.startAt, item.startTime, item.time, "");
  const parsedDate = parseDateValue(startAt);

  return {
    id: String(item.id || item.matchId || item.slug || `${zoneId}-${item.orderNumber || ""}`),
    slug: String(item.slug || ""),
    orderNumber: String(item.orderNumber || ""),
    zoneId,
    zoneName,
    eventTitle: String(item.eventTitle || item.eventName || ""),
    startAt: String(startAt),
    startedAtTs: parsedDate ? parsedDate.getTime() : 0,
    date: parsedDate ? formatDateKey(parsedDate) : "",
    stage: String(item.stage || item.matchType || item.round || ""),
    status,
    statusRaw,
    redTeam: { teamName: redTeamName, collegeName: redCollege, logo: firstText(item.redLogo, redTeamObj.collegeLogo, redTeamObj.logo, "") },
    blueTeam: { teamName: blueTeamName, collegeName: blueCollege, logo: firstText(item.blueLogo, blueTeamObj.collegeLogo, blueTeamObj.logo, "") },
    score,
    planGameCount: Number(item.planGameCount || item.gameCount || 0),
    replayVideo: item.replayVideo || item.replay || null,
  };
}

function getScheduleZones(data) {
  if (!data || typeof data !== "object") return [];
  const graphZones = data.data?.event?.zones?.nodes;
  if (Array.isArray(graphZones)) return graphZones;
  const currentEvent = data.current_event || data.currentEvent;
  if (Array.isArray(currentEvent?.zones?.nodes)) return currentEvent.zones.nodes;
  if (Array.isArray(data.zones)) return data.zones;
  return [];
}

function firstText(...values) {
  for (const value of values) {
    if (value == null || typeof value === "object") continue;
    const text = String(value).trim();
    if (text && text !== "-") return text;
  }
  return "";
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 100000000000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value || "").trim();
  if (!text || text === "-") return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ===== Score Bar =====

function updateScoreBar() {
  const match = state.currentMatch;
  if (!match || state.cleanMode) {
    refs.matchScoreBar.hidden = true;
    return;
  }

  refs.matchScoreBar.hidden = false;

  refs.redTeamName.textContent = match.redTeam.teamName || "红方";
  refs.redTeamSchool.textContent = match.redTeam.collegeName || "";
  refs.redTeamAvatar.textContent = (match.redTeam.teamName || "红").slice(0, 2);
  refs.blueTeamName.textContent = match.blueTeam.teamName || "蓝方";
  refs.blueTeamSchool.textContent = match.blueTeam.collegeName || "";
  refs.blueTeamAvatar.textContent = (match.blueTeam.teamName || "蓝").slice(0, 2);

  const scoreParts = parseScoreParts(match.score);
  const redSc = scoreParts[0] || 0;
  const blueSc = scoreParts[1] || 0;
  refs.redScore.textContent = redSc;
  refs.blueScore.textContent = blueSc;

  refs.redScore.classList.toggle("winner", match.status === "ended" && redSc > blueSc);
  refs.blueScore.classList.toggle("winner", match.status === "ended" && blueSc > redSc);

  // Status badge
  refs.matchStatusBadge.className = `match-status-badge ${match.status}`;
  const statusLabels = { live: "LIVE", upcoming: "即将开始", ended: "已结束" };
  refs.matchStatusBadge.textContent = statusLabels[match.status] || match.status.toUpperCase();

  // Stage label
  refs.matchStageLabel.textContent = match.stage ? `${match.stage}` : "";

  // BO label
  const pgc = match.planGameCount;
  refs.matchBOLabel.textContent = pgc > 0 ? `BO${pgc}` : "";

  // Time label
  refs.matchTimeLabel.textContent = match.startAt ? formatMatchTime(match.startAt) : "";
}

function formatMatchTime(timeStr) {
  try {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
  } catch (e) { /* ignore */ }
  return timeStr || "";
}

function parseScoreParts(score) {
  return String(score || "0:0").split(/\s*[:：-]\s*/).map(s => parseInt(s, 10) || 0);
}

// ===== Schedule Panel =====

function renderSchedule() {
  if (state.activeTab !== "schedule") return;

  const matches = state.scheduleData.filter(m => {
    if (!state.selectedZoneId) return true;
    return String(m.zoneId) === state.selectedZoneId;
  });

  if (!matches.length) {
    refs.scheduleList.innerHTML = "";
    refs.scheduleEmpty.hidden = false;
    return;
  }

  refs.scheduleEmpty.hidden = true;

  // Group by date
  const grouped = new Map();
  for (const m of matches) {
    const dateKey = m.date || (m.startAt ? m.startAt.slice(0, 10) : "未知日期");
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey).push(m);
  }

  let html = "";
  for (const [dateKey, groupMatches] of grouped) {
    html += `<div class="schedule-date-header">${dateKey}</div>`;
    for (const m of groupMatches) {
      html += renderScheduleCard(m);
    }
  }
  refs.scheduleList.innerHTML = html;

  // Bind follow button clicks and team clicks
  refs.scheduleList.querySelectorAll(".schedule-follow-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mid = btn.dataset.matchId;
      if (mid) toggleFollowMatch(mid);
    });
  });
  refs.scheduleList.querySelectorAll(".schedule-card").forEach(card => {
    card.addEventListener("click", () => {
      const mid = card.dataset.matchId;
      if (mid && state.followedMatchIds.has(mid)) toggleFollowMatch(mid);
    });
  });
}

function renderScheduleCard(m) {
  const scoreParts = parseScoreParts(m.score);
  const redSc = scoreParts[0] || 0;
  const blueSc = scoreParts[1] || 0;
  const followed = state.followedMatchIds.has(m.id);
  const followIcon = followed ? "bell-ring" : "bell";
  const statusLabels = { live: "LIVE", upcoming: "即将", ended: "已结束" };

  return `
    <div class="schedule-card" data-match-id="${escapeAttr(m.id)}">
      <div class="schedule-card-header">
        <span class="schedule-event-title">${escapeHtml(m.eventTitle || "赛事")}</span>
        <div class="schedule-card-badges">
          <span class="schedule-badge schedule-badge-match-status ${m.status}">${statusLabels[m.status] || m.status}</span>
          <span class="schedule-badge match-zone">${escapeHtml(m.zoneName)}</span>
          ${m.planGameCount > 0 ? `<span class="schedule-badge match-bo">BO${m.planGameCount}</span>` : ""}
        </div>
      </div>
      <div class="schedule-card-teams">
        <div class="schedule-team red">
          <div>
            <div class="schedule-team-name">${escapeHtml(m.redTeam.teamName)}</div>
            <div class="schedule-team-school">${escapeHtml(m.redTeam.collegeName)}</div>
          </div>
        </div>
        <div class="schedule-score-mini">
          <span>${redSc}</span>
          <span class="schedule-score-sep">:</span>
          <span>${blueSc}</span>
        </div>
        <div class="schedule-team blue">
          <div>
            <div class="schedule-team-name">${escapeHtml(m.blueTeam.teamName)}</div>
            <div class="schedule-team-school">${escapeHtml(m.blueTeam.collegeName)}</div>
          </div>
        </div>
      </div>
      <div class="schedule-card-footer">
        <span class="schedule-time">${formatMatchTime(m.startAt) || "时间待定"}</span>
        <button class="schedule-follow-btn ${followed ? "followed" : ""}" data-match-id="${escapeAttr(m.id)}" type="button">
          <i data-lucide="${followIcon}"></i>
          <span>${followed ? "已关注" : "关注"}</span>
        </button>
      </div>
    </div>
  `;
}

// ===== Follow System =====

function toggleFollowMatch(matchId) {
  if (state.followedMatchIds.has(matchId)) {
    state.followedMatchIds.delete(matchId);
  } else {
    state.followedMatchIds.add(matchId);
  }
  saveFollowedMatches();
  if (state.activeTab === "schedule") renderSchedule();
  renderIcons();
}

function loadFollowedMatches() {
  try {
    const raw = localStorage.getItem("rm-followed-matches");
    if (raw) {
      const arr = JSON.parse(raw);
      state.followedMatchIds = new Set(Array.isArray(arr) ? arr : []);
    }
  } catch (e) {
    state.followedMatchIds = new Set();
  }
}

function saveFollowedMatches() {
  try {
    localStorage.setItem("rm-followed-matches", JSON.stringify([...state.followedMatchIds]));
  } catch (e) { /* ignore */ }
}

// ===== Danmaku =====

async function applyDanmakuState() {
  const enabled = state.danmakuEnabled && !state.cleanMode;
  refs.danmakuToggle.setAttribute("aria-pressed", String(state.danmakuEnabled));
  refs.danmakuToggle.classList.toggle("active", state.danmakuEnabled);
  const icon = refs.danmakuToggle.querySelector("i");
  if (icon) icon.setAttribute("data-lucide", state.danmakuEnabled ? "message-square-text" : "message-square-off");
  refs.danmakuToggle.querySelector("span").textContent = state.danmakuEnabled ? "弹幕开" : "弹幕";
  refs.danmakuLayer.hidden = !enabled;
  refs.danmakuInputBar.hidden = !enabled;

  if (enabled) {
    // Connect to danmaku room
    const zone = getSelectedZone();
    const roomId = zone?._raw?.chatRoomId || "";
    if (roomId && state.danmakuClient) {
      state.danmakuClient.connect(roomId).catch(() => {});
    }
  } else {
    if (state.danmakuClient) state.danmakuClient.disconnect().catch(() => {});
  }
  renderIcons();
}

async function sendDanmaku() {
  const text = refs.danmakuInput.value.trim();
  if (!text) return;

  if (!state.danmakuClient?.connected) {
    // Local-only mode: add message locally
    const localMsg = {
      id: `local-${Date.now()}`,
      text,
      timestamp: Date.now(),
      username: "me",
      nickname: "我",
      schoolName: "",
      source: "local",
    };
    state.danmakuMessages.push(localMsg);
    if (state.danmakuMessages.length > state.danmakuMaxMessages) {
      state.danmakuMessages.splice(0, state.danmakuMessages.length - state.danmakuMaxMessages);
    }
    spawnDanmakuBullet(localMsg);
  } else {
    const sent = await state.danmakuClient.sendMessage(text, {
      nickname: "观众",
      schoolName: "",
    });
    if (!sent) {
      // Still show locally if send fails
      const localMsg = {
        id: `local-${Date.now()}`,
        text,
        timestamp: Date.now(),
        username: "me",
        nickname: "我",
        schoolName: "",
        source: "local",
      };
      spawnDanmakuBullet(localMsg);
    }
  }

  refs.danmakuInput.value = "";
}

function spawnDanmakuBullet(msg) {
  if (!state.danmakuEnabled || refs.danmakuLayer.hidden) return;

  const el = document.createElement("div");
  el.className = "danmaku-msg";
  el.textContent = msg.text;

  // Randomize vertical position
  const trackHeight = 28;
  const maxTracks = Math.floor(refs.danmakuLayer.clientHeight / trackHeight) || 6;
  const track = Math.floor(Math.random() * maxTracks);
  el.style.top = `${track * trackHeight}px`;

  // Set random fontSize for variety
  const fontSize = 16 + Math.floor(Math.random() * 6);
  el.style.fontSize = `${fontSize}px`;

  // Animation speed (slightly randomize)
  const duration = 8 + Math.random() * 4; // 8-12 seconds
  el.style.animationDuration = `${duration}s`;

  refs.danmakuLayer.appendChild(el);
  const distance = refs.danmakuLayer.clientWidth + el.offsetWidth + 32;
  el.style.setProperty("--danmaku-distance", `${distance}px`);

  // Remove after animation completes
  el.addEventListener("animationend", () => {
    el.remove();
  });
}

// ===== Schedule Data Fetching =====

async function fetchScheduleData() {
  try {
    const { data } = await fetchJsonWithFallback([SCHEDULE_FEED_URL], { timeoutMs: 30000 });
    const matches = parseAllMatchesFromFeed(data);
    if (matches.length > 0) {
      state.scheduleData = matches;
      state.scheduleLastLoadedAt = new Date();
      return;
    }
  } catch (e) {
    console.warn("[Schedule] schedule feed failed:", e);
  }
}

window.RMViewer = {
  parseLiveInfo,
  normalizeSources,
  parseAllMatchesFromFeed,
  pickSource,
  state,
};
