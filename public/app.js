const sendForm = document.getElementById("send-form");
const sendResult = document.getElementById("send-result");
const templateForm = document.getElementById("template-form");
const trackForm = document.getElementById("track-form");
const trackResult = document.getElementById("track-result");
const templateResult = document.getElementById("template-result");
const webhookButton = document.getElementById("webhook-test");
const webhookResult = document.getElementById("webhook-result");
const phoneButton = document.getElementById("phone-numbers");
const phoneResult = document.getElementById("phone-result");
const profilePhotoForm = document.getElementById("profile-photo-form");
const profilePhotoResult = document.getElementById("profile-photo-result");
const audioUploadForm = document.getElementById("audio-upload-form");
const audioUploadResult = document.getElementById("audio-upload-result");
const audioRefreshButton = document.getElementById("audio-refresh");
const audioLibraryList = document.getElementById("audio-library-list");
const audioLibraryEmpty = document.getElementById("audio-library-empty");
const logoutButton = document.getElementById("logout");
const convButton = document.getElementById("refresh-conversations");
const convList = document.getElementById("conversation-list");
const convEmpty = document.getElementById("conversation-empty");
const chatHeader = document.getElementById("chat-header");
const chatSubtitle = document.getElementById("chat-subtitle");
const chatAvatar = document.getElementById("chat-avatar");
const chatHistory = document.getElementById("chat-history");
const chatEmpty = document.getElementById("chat-empty");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatError = document.getElementById("chat-error");
const searchInput = document.getElementById("conversation-search");

const pretty = (data) => JSON.stringify(data, null, 2);
function formatUnknownError(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "data" in err) {
    try {
      return JSON.stringify(err.data);
    } catch {
      // ignore
    }
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err || "Erro desconhecido");
  }
}
let currentConversationId = null;
let currentConversationName = null;
let allConversations = [];
const autoRefreshBaseIntervalMs = 10000;
const autoRefreshFastIntervalMs = 2000;
const autoRefreshBurstDurationMs = 20000;
let autoRefreshTimer = null;
let autoRefreshBurstUntil = 0;
let lastConversationSignature = "";
function startBurstRefresh(durationMs = autoRefreshBurstDurationMs) {
  autoRefreshBurstUntil = Math.max(autoRefreshBurstUntil, Date.now() + durationMs);
}

function currentRefreshInterval() {
  return Date.now() < autoRefreshBurstUntil
    ? autoRefreshFastIntervalMs
    : autoRefreshBaseIntervalMs;
}

function buildConversationSignature(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return list
    .map((item) => {
      const wa = item.wa_id || "";
      const ts = item.last_timestamp || "";
      const msg = item.last_message || "";
      const status = item.last_status || "";
      return `${wa}|${ts}|${msg}|${status}`;
    })
    .join("||");
}

async function ensureSession() {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (!res.ok) {
      window.location.href = "/";
      return false;
    }
    const data = await res.json();
    if (!data || !data.ok) {
      window.location.href = "/";
      return false;
    }
    return true;
  } catch {
    window.location.href = "/";
    return false;
  }
}

function initials(value) {
  if (!value) return "?";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  const chars = parts.map((p) => p[0]).join("");
  return chars.toUpperCase();
}

function formatTime(value) {
  if (!value) return "";
  const ts = Number(value);
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function windowStatus(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return { open: false, hoursLeft: 0 };
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  const windowMs = 24 * 60 * 60 * 1000;
  const remaining = windowMs - diff;
  const open = remaining > 0;
  const hoursLeft = open ? Math.max(1, Math.ceil(remaining / (60 * 60 * 1000))) : 0;
  return { open, hoursLeft };
}

function statusSymbol(status) {
  if (!status) return { text: "", cls: "" };
  if (status === "sending") return { text: "...", cls: "status-sending" };
  if (status === "failed") return { text: "!", cls: "status-failed" };
  if (status === "sent") return { text: "?", cls: "status-sent" };
  if (status === "delivered") return { text: "??", cls: "status-delivered" };
  if (status === "read") return { text: "??", cls: "status-read" };
  return { text: "", cls: "" };
}

function setChatHeader(name, waId, lastTimestamp) {
  if (!chatHeader || !chatSubtitle || !chatAvatar) return;
  if (!waId) {
    chatHeader.textContent = "Selecione uma conversa";
    chatSubtitle.textContent = "";
    chatAvatar.textContent = "?";
    return;
  }
  chatHeader.textContent = name || waId;
  chatSubtitle.innerHTML = "";
  const wa = document.createElement("span");
  wa.textContent = waId;
  const badgeHeader = document.createElement("span");
  const { open, hoursLeft } = windowStatus(lastTimestamp);
  badgeHeader.className = `window-badge${open ? "" : " closed"}`;
  badgeHeader.textContent = open ? `fecha em ${hoursLeft}h` : "24h fechada";
  chatSubtitle.appendChild(wa);
  chatSubtitle.appendChild(badgeHeader);
  chatAvatar.textContent = initials(name || waId);
}

function setComposerEnabled(enabled) {
  if (!chatInput || !chatSend) return;
  chatInput.disabled = !enabled;
  chatSend.disabled = !enabled;
  if (!enabled) {
    chatInput.value = "";
  }
}

function renderThread(items) {
  if (!chatHistory || !chatEmpty) return;
  chatHistory.innerHTML = "";

  if (!items || items.length === 0) {
    chatEmpty.textContent = "Nenhuma mensagem carregada.";
    return;
  }

  chatEmpty.textContent = "";
  items.forEach((item) => {
    const bubble = document.createElement("div");
    const isEvent = item.type === "event";
    const direction = item.direction === "out" ? "outgoing" : "incoming";
    bubble.className = `chat-bubble ${isEvent ? "event" : direction}`;
    if (isEvent) {
      const eventKind = String(item.event_kind || "").trim().toLowerCase();
      const eventState = String(item.event_state || "").trim().toLowerCase();
      if (eventKind) bubble.classList.add(`event-${eventKind}`);
      if (eventState) bubble.classList.add(`event-${eventState}`);
    }

    const mediaUrl = String(item.media_url || "").trim();
    const hasImageMedia = item.type === "image" && Boolean(mediaUrl);

    if (hasImageMedia) {
      const mediaWrap = document.createElement("div");
      mediaWrap.className = "chat-media";

      const mediaLink = document.createElement("a");
      mediaLink.className = "chat-media-link";
      mediaLink.href = mediaUrl;
      mediaLink.target = "_blank";
      mediaLink.rel = "noopener noreferrer";

      const img = document.createElement("img");
      img.className = "chat-media-img";
      img.src = mediaUrl;
      img.alt = "Imagem";
      mediaLink.appendChild(img);
      mediaWrap.appendChild(mediaLink);
      bubble.appendChild(mediaWrap);

      const captionText = String(item.caption || item.text || "").trim();
      if (captionText && captionText !== "[imagem]") {
        const caption = document.createElement("div");
        caption.className = "chat-media-caption";
        caption.textContent = captionText;
        bubble.appendChild(caption);
      }
    } else {
      const text = document.createElement("div");
      text.className = "chat-bubble-text";
      text.textContent = item.text || "(mensagem)";
      bubble.appendChild(text);
    }

    const meta = document.createElement("div");
    meta.className = `chat-bubble-meta${isEvent ? " event-meta" : ""}`;
    const time = formatTime(item.timestamp);

    if (direction === "outgoing") {
      const status = statusSymbol(item.status);
      if (status.text) {
        const span = document.createElement("span");
        span.className = `status ${status.cls}`;
        span.textContent = status.text;
        meta.appendChild(span);
      }
    }

    if (time) {
      const timeSpan = document.createElement("span");
      timeSpan.textContent = time;
      meta.appendChild(timeSpan);
    }

    bubble.appendChild(meta);
    chatHistory.appendChild(bubble);
  });

  chatHistory.scrollTop = chatHistory.scrollHeight;
}
async function loadThread(waId) {
  if (!waId) return;
  if (!chatHistory || !chatEmpty) return;
  chatEmpty.textContent = "Carregando...";
  try {
    const res = await fetch(`/api/conversation?wa_id=${encodeURIComponent(waId)}`, {
      credentials: "include",
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      renderThread([]);
      chatEmpty.textContent = "Erro ao carregar mensagens.";
      return;
    }
    renderThread(data.data || []);
  } catch {
    renderThread([]);
    chatEmpty.textContent = "Erro ao carregar mensagens.";
  }
}

function buildConversationItem(item, items) {
  const div = document.createElement("div");
  div.className = "conversation-item";
  div.dataset.waId = item.wa_id || "";

  if (currentConversationId && item.wa_id === currentConversationId) {
    div.classList.add("active");
  }

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials(item.name || item.wa_id);

  const body = document.createElement("div");
  body.className = "conversation-body";

  const row = document.createElement("div");
  row.className = "conversation-row";

  const title = document.createElement("div");
  title.textContent = item.name || item.wa_id || "Desconhecido";

  const time = document.createElement("div");
  time.className = "conversation-time";
  time.textContent = formatTime(item.last_timestamp);

  const badge = document.createElement("span");
  const { open, hoursLeft } = windowStatus(item.last_timestamp);
  badge.className = `window-badge${open ? "" : " closed"}`;
  badge.textContent = open ? `fecha em ${hoursLeft}h` : "24h fechada";

  row.appendChild(title);
  row.appendChild(time);
  row.appendChild(badge);

  const preview = document.createElement("div");
  preview.className = "conversation-preview";
  const prefix = item.last_direction === "out" ? "Voce: " : "";
  preview.textContent = `${prefix}${item.last_message || "(sem mensagem)"}`;

  if (item.last_direction === "out") {
    const status = statusSymbol(item.last_status);
    if (status.text) {
      const span = document.createElement("span");
      span.className = `status ${status.cls}`;
      span.textContent = status.text;
      preview.appendChild(span);
    }
  }

  body.appendChild(row);
  body.appendChild(preview);

  div.appendChild(avatar);
  div.appendChild(body);

  div.addEventListener("click", () => {
    currentConversationId = item.wa_id || null;
    currentConversationName = item.name || null;
    setChatHeader(currentConversationName, currentConversationId, item.last_timestamp);
    setComposerEnabled(Boolean(currentConversationId));
    renderConversations(items);
    loadThread(currentConversationId);
  });

  return div;
}

function renderConversations(items) {
  if (!convList || !convEmpty) return;
  convList.innerHTML = "";

  if (!items.length) {
    convEmpty.textContent = "Nenhuma conversa encontrada.";
    return;
  }

  convEmpty.textContent = "";
  items.forEach((item) => {
    convList.appendChild(buildConversationItem(item, items));
  });
}

function applySearch(list) {
  if (!searchInput) return list;
  const term = searchInput.value.trim().toLowerCase();
  if (!term) return list;
  return list.filter((item) => {
    const name = (item.name || "").toLowerCase();
    const waId = (item.wa_id || "").toLowerCase();
    return name.includes(term) || waId.includes(term);
  });
}

async function refreshConversations() {
  if (!convList) return;
  try {
    const res = await fetch("/api/conversations", { credentials: "include" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      convEmpty.textContent = "Erro ao carregar conversas.";
      return;
    }

    const nextAll = Array.isArray(data.data) ? data.data : [];
    const nextSignature = buildConversationSignature(nextAll);
    if (lastConversationSignature && nextSignature && nextSignature !== lastConversationSignature) {
      startBurstRefresh(12000);
    }
    lastConversationSignature = nextSignature;

    allConversations = nextAll;
    const list = applySearch(allConversations);
    renderConversations(list);
  } catch {
    convEmpty.textContent = "Erro ao carregar conversas.";
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
  }

  const loop = async () => {
    if (document.visibilityState === "visible") {
      await refreshConversations();
      if (currentConversationId) {
        await loadThread(currentConversationId);
      }
    }
    autoRefreshTimer = setTimeout(loop, currentRefreshInterval());
  };

  autoRefreshTimer = setTimeout(loop, currentRefreshInterval());
}

function refreshNow() {
  startBurstRefresh();
  refreshConversations();
  if (currentConversationId) {
    loadThread(currentConversationId);
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw { status: res.status, data };
  }
  return data;
}

const AUDIO_LIBRARY_ENDPOINT = "/api/audio-library";
const AUDIO_MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
let audioToolsCache = [];
let audioToolsFfmpeg = {
  ffmpeg: null,
  loading: null,
  logs: [],
};

function normalizeAudioDisplayName(raw, fallback = "Audio") {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  return value.replace(/[\r\n\t]+/g, " ").replace(/\.[^.]+$/, "").slice(0, 120);
}

function isVoiceReadyAudio(fileName, mimeType) {
  const name = String(fileName || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  return name.endsWith(".ogg") || mime.includes("ogg") || mime.includes("opus");
}

function setAudioUploadStatus(text) {
  if (!audioUploadResult) return;
  audioUploadResult.textContent = text || "";
}

async function audioRequestJson(url, method, payload) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
    credentials: "include",
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

async function ensureAudioToolsFfmpeg() {
  if (audioToolsFfmpeg.ffmpeg) return audioToolsFfmpeg;
  if (audioToolsFfmpeg.loading) return audioToolsFfmpeg.loading;

  const downloadAsBlobURL = async (urls, mimeType) => {
    const list = Array.isArray(urls) ? urls : [];
    let lastErr = null;
    for (const url of list) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const typedBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
        return URL.createObjectURL(typedBlob);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Falha ao baixar recurso FFmpeg: ${String(lastErr || "erro")}`);
  };

  audioToolsFfmpeg.loading = (async () => {
    const ffmpegMod = await import("/vendor/ffmpeg/esm/index.js");
    const FFmpegCtor = ffmpegMod.FFmpeg;
    const ffmpeg = new FFmpegCtor();
    const workerURL = `${window.location.origin}/vendor/ffmpeg/esm/worker.js`;

    ffmpeg.on("log", (entry) => {
      const msg = String(entry?.message || "").trim();
      if (!msg) return;
      audioToolsFfmpeg.logs.push(msg);
      if (audioToolsFfmpeg.logs.length > 80) {
        audioToolsFfmpeg.logs.splice(0, audioToolsFfmpeg.logs.length - 80);
      }
    });

    const coreURL = await downloadAsBlobURL([
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
    ], "text/javascript");

    const wasmURL = await downloadAsBlobURL([
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
      "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
    ], "application/wasm");

    await ffmpeg.load({ classWorkerURL: workerURL, coreURL, wasmURL });
    audioToolsFfmpeg.ffmpeg = ffmpeg;
    audioToolsFfmpeg.loading = null;
    return audioToolsFfmpeg;
  })().catch((err) => {
    audioToolsFfmpeg.loading = null;
    throw err;
  });

  return audioToolsFfmpeg.loading;
}

async function convertAudioToOggOpus(file) {
  if (!(file instanceof File)) {
    throw new Error("Arquivo invalido");
  }

  const originalName = String(file.name || "audio");
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  if (ext === "ogg" && mime.includes("ogg")) return file;

  const ctx = await ensureAudioToolsFfmpeg();
  const ffmpeg = ctx.ffmpeg;
  if (!ffmpeg) throw new Error("FFmpeg nao inicializado");
  audioToolsFfmpeg.logs = [];

  const safeExt = ext && /^[a-z0-9]+$/i.test(ext) ? ext : "mp3";
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const inName = `tool_input_${nonce}.${safeExt}`;
  const outName = `tool_output_${nonce}.ogg`;
  const baseName = normalizeAudioDisplayName(originalName, "audio");

  try {
    await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    const rc = await ffmpeg.exec([
      "-i", inName,
      "-map", "0:a:0",
      "-vn", "-sn", "-dn",
      "-c:a", "libopus",
      "-vbr", "on",
      "-application", "voip",
      "-b:a", "48k",
      "-ac", "1",
      "-ar", "48000",
      outName,
    ]);

    if (Number(rc) !== 0) {
      const tail = audioToolsFfmpeg.logs.slice(-8).join(" | ");
      throw new Error(`FFmpeg retornou codigo ${rc}${tail ? `: ${tail}` : ""}`);
    }

    const output = await ffmpeg.readFile(outName);
    const blob = new Blob([output], { type: "audio/ogg; codecs=opus" });
    return new File([blob], `${baseName}.ogg`, { type: "audio/ogg; codecs=opus" });
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err || "erro de conversao");
    const tail = audioToolsFfmpeg.logs.slice(-8).join(" | ");
    throw new Error(`${base}${tail ? ` | log: ${tail}` : ""}`);
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}

async function fetchAudioLibrary() {
  const res = await fetch(AUDIO_LIBRARY_ENDPOINT, { credentials: "include" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Falha ao carregar biblioteca (HTTP ${res.status})`);
  }
  audioToolsCache = Array.isArray(data.data) ? data.data : [];
  return data;
}

function renderAudioLibrary(items) {
  if (!audioLibraryList || !audioLibraryEmpty) return;
  audioLibraryList.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  audioLibraryEmpty.style.display = list.length ? "none" : "block";

  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "audio-item";

    const title = document.createElement("div");
    title.className = "audio-item-title";
    title.textContent = item.name || "Audio";

    const meta = document.createElement("div");
    meta.className = "audio-item-meta";
    meta.textContent = `${item.mime || "audio/*"} | ${(Number(item.size || 0) / 1024).toFixed(1)} KB`;

    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.src = item.url || "";

    const actions = document.createElement("div");
    actions.className = "audio-item-actions";

    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.value = item.name || "";
    renameInput.placeholder = "Nome do audio";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.textContent = "Renomear";
    renameBtn.addEventListener("click", async () => {
      try {
        const name = normalizeAudioDisplayName(renameInput.value, "Audio");
        await audioRequestJson(AUDIO_LIBRARY_ENDPOINT, "PATCH", { id: item.id, name });
        setAudioUploadStatus("Audio renomeado com sucesso.");
        await refreshAudioLibraryView();
      } catch (err) {
        setAudioUploadStatus(formatUnknownError(err));
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Apagar";
    deleteBtn.addEventListener("click", async () => {
      if (!window.confirm("Deseja apagar este audio da biblioteca?")) return;
      try {
        await audioRequestJson(AUDIO_LIBRARY_ENDPOINT, "DELETE", { id: item.id });
        setAudioUploadStatus("Audio apagado com sucesso.");
        await refreshAudioLibraryView();
      } catch (err) {
        setAudioUploadStatus(formatUnknownError(err));
      }
    });

    const openLink = document.createElement("a");
    openLink.href = item.url || "#";
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.textContent = "Abrir URL";
    openLink.className = "ghost link";

    actions.appendChild(renameInput);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(openLink);

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(player);
    row.appendChild(actions);

    audioLibraryList.appendChild(row);
  });
}

async function refreshAudioLibraryView() {
  try {
    const data = await fetchAudioLibrary();
    renderAudioLibrary(audioToolsCache);
    if (audioUploadResult && !audioUploadResult.textContent) {
      setAudioUploadStatus(pretty({ ok: true, total: audioToolsCache.length, env: data.env || null }));
    }
  } catch (err) {
    setAudioUploadStatus(formatUnknownError(err));
  }
}

async function uploadAudioToLibrary(file, name) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", normalizeAudioDisplayName(name, "Audio"));

  const res = await fetch(AUDIO_LIBRARY_ENDPOINT, {
    method: "POST",
    body: form,
    credentials: "include",
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Upload falhou (HTTP ${res.status})`);
  }
  return data.data;
}

function setupAudioTools() {
  if (!audioUploadForm && !audioRefreshButton) return;

  if (audioRefreshButton) {
    audioRefreshButton.addEventListener("click", () => {
      setAudioUploadStatus("Atualizando biblioteca...");
      refreshAudioLibraryView();
    });
  }

  if (audioUploadForm) {
    audioUploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(audioUploadForm);
      const file = form.get("audio_file");
      const customName = String(form.get("audio_name") || "").trim();

      if (!(file instanceof File)) {
        setAudioUploadStatus("Selecione um arquivo de audio.");
        return;
      }

      if (Number(file.size || 0) > AUDIO_MAX_UPLOAD_BYTES) {
        setAudioUploadStatus(`Arquivo muito grande. Limite: ${Math.floor(AUDIO_MAX_UPLOAD_BYTES / (1024 * 1024))}MB`);
        return;
      }

      try {
        setAudioUploadStatus("Convertendo para OGG/Opus...");
        const converted = await convertAudioToOggOpus(file);
        if (!isVoiceReadyAudio(converted.name, converted.type)) {
          throw new Error("Conversao nao gerou OGG/Opus valido.");
        }

        const finalName = customName || normalizeAudioDisplayName(file.name, "Audio");
        setAudioUploadStatus("Enviando audio convertido...");
        const saved = await uploadAudioToLibrary(converted, finalName);
        setAudioUploadStatus(pretty({ ok: true, uploaded: saved }));

        const fileInput = document.getElementById("audio-file");
        if (fileInput) fileInput.value = "";

        await refreshAudioLibraryView();
      } catch (err) {
        setAudioUploadStatus(`Conversao obrigatoria falhou: ${formatUnknownError(err)}`);
        console.error("[botzap-tools-audio-convert-required-error]", err);
      }
    });
  }

  refreshAudioLibraryView();
}
async function sendChatMessage() {
  if (!chatInput || !chatSend) return;
  if (!currentConversationId) {
    if (chatError) chatError.textContent = "Selecione uma conversa.";
    return;
  }
  const text = chatInput.value.trim();
  if (!text) return;

  if (chatError) chatError.textContent = "";
  chatSend.disabled = true;

  try {
    await postJson("/api/send-message", { to: currentConversationId, message: text });
    chatInput.value = "";
    await refreshConversations();
    await loadThread(currentConversationId);
  } catch {
    if (chatError) chatError.textContent = "Falha ao enviar.";
  } finally {
    chatSend.disabled = false;
  }
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await postJson("/api/logout", {});
    } finally {
      window.location.href = "/";
    }
  });
}

if (convButton) {
  convButton.addEventListener("click", () => {
    refreshNow();
  });
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    renderConversations(applySearch(allConversations));
  });
}

if (chatSend) {
  chatSend.addEventListener("click", () => {
    sendChatMessage();
  });
}

if (chatInput) {
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendChatMessage();
    }
  });
}

if (sendForm) {
  sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    sendResult.textContent = "Enviando...";
    const form = new FormData(sendForm);
    const payload = {
      to: form.get("to"),
      message: form.get("message"),
    };
    try {
      const data = await postJson("/api/send-message", payload);
      sendResult.textContent = pretty(data);
      refreshConversations();
    } catch (err) {
      sendResult.textContent = pretty(err);
    }
  });
}

if (templateForm) {
  templateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    templateResult.textContent = "Criando...";
    const form = new FormData(templateForm);
    const payload = {
      name: form.get("name"),
      category: form.get("category"),
      language: form.get("language"),
      body: form.get("body"),
    };
    try {
      const data = await postJson("/api/create-template", payload);
      templateResult.textContent = pretty(data);
    } catch (err) {
      templateResult.textContent = pretty(err);
    }
  });
}




if (profilePhotoForm && profilePhotoResult) {
  profilePhotoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    profilePhotoResult.textContent = "Enviando imagem...";

    try {
      const form = new FormData(profilePhotoForm);
      const file = form.get("photo_file");
      if (!(file instanceof File)) {
        profilePhotoResult.textContent = "Selecione uma imagem JPG ou PNG.";
        return;
      }

      const payload = new FormData();
      payload.append("file", file);

      const res = await fetch("/api/update-profile-photo", {
        method: "POST",
        body: payload,
        credentials: "include",
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        profilePhotoResult.textContent = pretty({ ok: false, status: res.status, data });
        return;
      }

      profilePhotoResult.textContent = pretty(data);
    } catch (err) {
      profilePhotoResult.textContent = pretty({ ok: false, error: formatUnknownError(err) });
    }
  });
}

if (webhookButton && webhookResult) {
  webhookButton.addEventListener("click", async () => {
    webhookResult.textContent = "Testando...";
    try {
      const data = await postJson("/api/test-webhook", {});
      webhookResult.textContent = pretty(data);
    } catch (err) {
      webhookResult.textContent = pretty(err);
    }
  });
}

if (phoneButton && phoneResult) {
  phoneButton.addEventListener("click", async () => {
    phoneResult.textContent = "Buscando...";
    try {
      const data = await postJson("/api/phone-numbers", {});
      phoneResult.textContent = pretty(data);
    } catch (err) {
      phoneResult.textContent = pretty(err);
    }
  });
}

ensureSession().then((ok) => {
  if (ok) {
    refreshNow();
    startAutoRefresh();
    setupAudioTools();
  }
});

window.addEventListener("focus", refreshNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshNow();
  }
});

if (trackForm && trackResult) {
  trackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    trackResult.textContent = "Enviando...";
    const form = new FormData(trackForm);
    const payload = {
      wa_id: form.get("wa_id"),
      short: form.get("short"),
      target: form.get("target"),
    };
    try {
      const data = await postJson("/api/track-test", payload);
      trackResult.textContent = pretty(data);
      refreshConversations();
      if (payload.wa_id) {
        loadThread(String(payload.wa_id));
      }
    } catch (err) {
      trackResult.textContent = pretty(err);
    }
  });
}











