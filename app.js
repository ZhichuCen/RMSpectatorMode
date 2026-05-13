const FEED_URL = "https://rm-static.djicdn.com/live_json/live_game_info.json";
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
  mainMuted: true,
  isLoading: false,
  layout: "one-plus",
  mainResolution: "high",
  previewMode: "smart",
  thumbObserver: null,
};

document.addEventListener("DOMContentLoaded", () => {
  bindRefs();
  bindEvents();
  renderLayoutOptions();
  renderResolutionOptions();
  renderPreviewModeOptions();
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
    state.mainStreamIds = [];
    reconcileMainSlots();
    render();
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

function applyLayoutConfig(resetResolution) {
  const layout = getCurrentLayout();
  if (resetResolution) {
    state.mainResolution = layout.defaultRes;
  }
  refs.viewerLayout.dataset.layout = layout.id;
  refs.mainResolutionSelect.value = state.mainResolution;
  refs.mainResolutionSelect.disabled = layout.mainCount === 0;
  refs.previewModeSelect.value = state.previewMode;
  refs.smallPanelTitle.textContent = layout.mainCount === 0 ? "全部视角" : "可切换视角";
  refs.smallPanelHint.textContent = state.previewMode === "poster"
    ? "停止小窗拉流"
    : layout.mainCount === 0
      ? "4x4 低清预览"
      : "可见小窗低清拉流";
}

async function loadFeed() {
  if (state.isLoading) return;
  state.isLoading = true;
  setFeedStatus("warn", "正在更新");

  try {
    const response = await fetch(FEED_URL, {
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
  return `
    <div class="video-frame main-frame" data-stream-id="${escapeAttr(stream.id)}" data-slot-index="${slotIndex}" data-player-key="${escapeAttr(mainKey(slotIndex, stream.id))}">
      <video controls autoplay muted playsinline preload="auto" data-player-key="${escapeAttr(mainKey(slotIndex, stream.id))}"></video>
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
  const muteIcon = frame.querySelector("[data-action='toggle-mute'] i");
  if (muteIcon) muteIcon.setAttribute("data-lucide", state.mainMuted ? "volume-x" : "volume-2");
}

function renderThumbs() {
  const streams = getThumbStreams();
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
    if (!video || !source || state.previewMode === "poster") {
      destroyPlayer(key, state.thumbHls);
      return;
    }

    video.dataset.playerSrc = source.src;
    if (state.previewMode === "smart") {
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
  if (state.previewMode === "poster") {
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
  if (layout.mainCount === 0) return streams;

  reconcileMainSlots();
  return streams;
}

function getAssignedSlotIndexes(streamId) {
  return state.mainStreamIds
    .map((assignedStreamId, index) => (assignedStreamId === streamId ? index : -1))
    .filter((index) => index >= 0);
}

function attachHls(video, src, key, group) {
  if (!video || !src) return;
  const store = group === "main" ? state.mainHls : state.thumbHls;
  const previous = store.get(key);
  if (previous?.src === src && video.dataset.attachedSrc === src) {
    video.muted = group === "main" ? state.mainMuted : true;
    video.play().catch(() => {});
    return;
  }
  if (previous?.src && video.dataset.attachedSrc && playbackResourceKey(previous.src) === playbackResourceKey(src)) {
    previous.src = src;
    video.muted = group === "main" ? state.mainMuted : true;
    hideVideoError(video);
    video.play().catch(() => {});
    return;
  }

  destroyPlayer(key, store);

  video.pause();
  video.removeAttribute("src");
  video.load();
  video.muted = group === "main" ? state.mainMuted : true;
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

window.RMViewer = {
  parseLiveInfo,
  normalizeSources,
  pickSource,
};
