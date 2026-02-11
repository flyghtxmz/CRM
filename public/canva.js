const logoutButton = document.getElementById("logout");
const saveButton = document.getElementById("save-flow");
const exportButton = document.getElementById("export-flow");
const resetButton = document.getElementById("reset-flow");
const surface = document.getElementById("flow-surface");
const flowCanvas = document.getElementById("flow-canvas");
const svg = document.getElementById("flow-links");
const flowNameInput = document.getElementById("flow-name");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const zoomResetButton = document.getElementById("zoom-reset");
const zoomValue = document.getElementById("zoom-value");
const blockPicker = document.getElementById("block-picker");
const minimap = document.getElementById("flow-minimap");
const minimapBody = document.getElementById("flow-minimap-body");
const minimapSvg = document.getElementById("flow-minimap-svg");
const minimapViewport = document.getElementById("flow-minimap-viewport");
const PAN_IGNORE_SELECTOR = ".flow-node, .flow-zoom, .block-picker, .flow-minimap, .condition-popup, .action-popup";
let panReady = false;
let minimapModel = null;
let minimapDrag = null;

const AUTO_SAVE_MS = 5000;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const SURFACE_WORLD_LIMIT = 24000;
const SURFACE_MIN_WIDTH = SURFACE_WORLD_LIMIT * 2;
const SURFACE_MIN_HEIGHT = SURFACE_WORLD_LIMIT * 2;
const SURFACE_PADDING = 2000;
const MINIMAP_NODE_PADDING = 360;

let state = {
  flowId: null,
  flowName: "",
  zoom: 1,
  cameraX: 80,
  cameraY: 80,
  nodes: [],
  edges: [],
  tags: [],
};

let linkFromId = null;
let linkFromBranch = null;
let autoSaveTimer = null;
let selectedNodeId = null;
let messageBlockOrderCache = new Map();
let audioLibraryCache = [];
let ffmpegContext = {
  ffmpeg: null,
  loading: null,
  logs: [],
};

const AUDIO_LIBRARY_ENDPOINT = "/api/audio-library";
const MAX_AUDIO_UPLOAD_BYTES = 16 * 1024 * 1024;
function formatUnknownError(err) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err || "Erro desconhecido");
  }
}

async function fetchAudioLibrary(force = false) {
  if (!force && Array.isArray(audioLibraryCache) && audioLibraryCache.length) {
    return audioLibraryCache;
  }
  const res = await fetch(AUDIO_LIBRARY_ENDPOINT, { credentials: "include" });
  if (!res.ok) {
    throw new Error("Nao foi possivel carregar a biblioteca de audio");
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.ok || !Array.isArray(data.data)) {
    throw new Error("Resposta invalida da biblioteca de audio");
  }
  audioLibraryCache = data.data;
  return audioLibraryCache;
}

async function ensureFfmpeg() {
  if (ffmpegContext.ffmpeg) {
    return ffmpegContext;
  }
  if (ffmpegContext.loading) {
    return ffmpegContext.loading;
  }

  const downloadAsBlobURL = async (urls, mimeType) => {
    const list = Array.isArray(urls) ? urls : [];
    let lastErr = null;
    for (const url of list) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const typedBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
        return URL.createObjectURL(typedBlob);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Falha ao baixar recurso FFmpeg: ${String(lastErr || "erro desconhecido")}`);
  };

  ffmpegContext.loading = (async () => {
    const ffmpegMod = await import("/vendor/ffmpeg/esm/index.js");
    const FFmpegCtor = ffmpegMod.FFmpeg;

    const ffmpeg = new FFmpegCtor();
    const workerURL = `${window.location.origin}/vendor/ffmpeg/esm/worker.js`;
    ffmpeg.on("log", (entry) => {
      const msg = String(entry?.message || "").trim();
      if (!msg) return;
      ffmpegContext.logs.push(msg);
      if (ffmpegContext.logs.length > 80) {
        ffmpegContext.logs.splice(0, ffmpegContext.logs.length - 80);
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

    await ffmpeg.load({
      classWorkerURL: workerURL,
      coreURL,
      wasmURL,
    });

    ffmpegContext.ffmpeg = ffmpeg;
    ffmpegContext.loading = null;
    return ffmpegContext;
  })().catch((err) => {
    ffmpegContext.loading = null;
    throw err;
  });

  return ffmpegContext.loading;
}

function sanitizeAudioName(name) {
  const value = String(name || "").trim();
  if (!value) return "audio";
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 120);
}

function isVoiceReadyAudio(fileName, mimeType) {
  const name = String(fileName || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  return name.endsWith(".ogg") || mime.includes("ogg") || mime.includes("opus");
}
async function convertToOggOpus(inputFile) {
  if (!(inputFile instanceof File)) {
    throw new Error("Arquivo invalido");
  }

  const originalName = String(inputFile.name || "audio");
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  const mime = String(inputFile.type || "").toLowerCase();

  if (ext === "ogg" && mime.includes("ogg")) {
    return inputFile;
  }

  const ctx = await ensureFfmpeg();
  const ffmpeg = ctx.ffmpeg;
  if (!ffmpeg) {
    throw new Error("FFmpeg nao inicializado");
  }
  ffmpegContext.logs = [];

  const safeExt = ext && /^[a-z0-9]+$/i.test(ext) ? ext : "mp3";
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const inName = `input_${nonce}.${safeExt}`;
  const outName = `output_${nonce}.ogg`;
  const baseName = sanitizeAudioName(originalName.replace(/\.[^.]+$/, ""));

  try {
    await ffmpeg.writeFile(inName, new Uint8Array(await inputFile.arrayBuffer()));
    const rc = await ffmpeg.exec([
      "-i",
      inName,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      "libopus",
      "-vbr",
      "on",
      "-application",
      "voip",
      "-b:a",
      "48k",
      "-ac",
      "1",
      "-ar",
      "48000",
      outName,
    ]);
    if (Number(rc) !== 0) {
      const tail = ffmpegContext.logs.slice(-8).join(" | ");
      throw new Error(`FFmpeg retornou codigo ${rc}${tail ? `: ${tail}` : ""}`);
    }

    const output = await ffmpeg.readFile(outName);
    const blob = new Blob([output], { type: "audio/ogg; codecs=opus" });
    return new File([blob], `${baseName}.ogg`, { type: "audio/ogg; codecs=opus" });
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err || "erro de conversao");
    const tail = ffmpegContext.logs.slice(-8).join(" | ");
    throw new Error(`${base}${tail ? ` | log: ${tail}` : ""}`);
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
  }
}

async function uploadAudioAsset(file, name) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", sanitizeAudioName(name || file.name || "Audio"));

  const res = await fetch(AUDIO_LIBRARY_ENDPOINT, {
    method: "POST",
    body: form,
    credentials: "include",
  });

  const rawText = await res.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!res.ok || !data || !data.ok || !data.data) {
    const backendError = data?.error ? String(data.error) : "";
    const fallbackText = rawText ? rawText.slice(0, 240) : "";
    const detail = backendError || fallbackText || "Nao foi possivel enviar audio";
    throw new Error(`Upload falhou (HTTP ${res.status}): ${detail}`);
  }

  const uploaded = data.data;
  audioLibraryCache = [uploaded, ...(audioLibraryCache || []).filter((item) => item.id !== uploaded.id)];
  return uploaded;
}

const blockPresets = {
  start: { title: "Quando", body: "" },
  message: { title: "Mensagem Normal", body: "Texto da mensagem" },
  message_link: { title: "Mensagem com link", body: "Texto da mensagem", url: "" },
  message_short: { title: "Mensagem com link curto", body: "Texto da mensagem", url: "" },
  message_image: { title: "Mensagem com imagem + link", body: "Legenda da imagem", url: "", image: "" },
  message_audio: { title: "Mensagem de audio", body: "", audio_source: "existing", audio_id: "", audio_url: "", audio_name: "", audio_voice: true },
  message_fast_reply: { title: "Mensagem Fast Reply", body: "Escolha uma opcao:", quick_replies: ["Quero saber mais", "Falar com atendente"] },
  human_service: { title: "Atendimento Humano", body: "Deseja falar com um atendente?" },
  delay: { title: "Delay", body: "Esperar" },
  condition: { title: "Condicao", body: "" },
  action: { title: "Acoes", body: "" },
};

const messageBlockOptions = [
  { type: "message", label: "Mensagem Normal" },
  { type: "message_link", label: "Mensagem com link" },
  { type: "message_short", label: "Mensagem com link curto" },
  { type: "message_image", label: "Mensagem com imagem + link" },
  { type: "message_audio", label: "Mensagem de audio" },
  { type: "message_fast_reply", label: "Mensagem Fast Reply" },
  { type: "human_service", label: "Atendimento Humano" },
];

const blockOptions = [
  { type: "message_types", label: "Tipos de Mensagens", kind: "group" },
  { type: "delay", label: "Delay" },
  { type: "condition", label: "Condicao" },
  { type: "action", label: "Acoes" },
];
const MESSAGE_NODE_TYPES = new Set(["message", "message_link", "message_short", "message_image", "message_audio", "message_fast_reply", "human_service"]);

function makeId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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

async function fetchFlow(flowId) {
  const res = await fetch(`/api/flows?id=${encodeURIComponent(flowId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.ok) return null;
  return data.data || null;
}

async function saveFlowToApi(payload) {
  const res = await fetch("/api/flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.ok) return null;
  return data.data || null;
}

function defaultData() {
  const startId = makeId("node");
  const messageId = makeId("node");
  return {
    tags: ["lead"],
    nodes: [
      {
        id: startId,
        type: "start",
        title: "Quando",
        body: "",
        trigger: "",
        x: 120,
        y: 120,
        tags: [],
      },
      {
        id: messageId,
        type: "message",
        title: "Mensagem",
        body: "Ola! Em que posso ajudar?",
        x: 420,
        y: 120,
        tags: ["lead"],
      },
    ],
    edges: [{ id: makeId("edge"), from: startId, to: messageId }],
  };
}
function ensureStartNode() {
  const startNodes = state.nodes.filter((node) => node.type === "start");
  if (!startNodes.length) {
    state.nodes.unshift({
      id: makeId("node"),
      type: "start",
      title: "Quando",
      body: "",
      trigger: "",
      x: 120,
      y: 120,
      tags: [],
    });
    return;
  }
  const keep = startNodes[0];
  state.nodes = state.nodes.filter((node) => node.type !== "start" || node === keep);
  keep.title = "Quando";
  if (typeof keep.trigger !== "string") keep.trigger = "";
}

function pruneEdges() {
  const ids = new Set(state.nodes.map((node) => node.id));
  state.edges = state.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
}

async function loadFlow() {
  const flowId = new URLSearchParams(window.location.search).get("id");
  if (!flowId) {
    window.location.href = "/flows.html";
    return false;
  }

  const flow = await fetchFlow(flowId);
  if (!flow) {
    window.location.href = "/flows.html";
    return false;
  }

  const data = flow.data || {};
  state = {
    flowId: flow.id,
    flowName: flow.name || "Fluxo sem nome",
    zoom: typeof data.zoom === "number" ? data.zoom : 1,
    cameraX: Number.isFinite(Number(data.cameraX)) ? Number(data.cameraX) : 80,
    cameraY: Number.isFinite(Number(data.cameraY)) ? Number(data.cameraY) : 80,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };

  state.nodes.forEach((node) => {
    if (node.type === "start" && typeof node.trigger !== "string") {
      node.trigger = "";
    }
    if (node.type === "tag") {
      const tagValue = String(node.body || node.action?.tag || "").trim();
      node.type = "action";
      node.title = "Acoes";
      node.body = "";
      node.action = { type: "tag", tag: tagValue };
    }
    if (node.type === "condition") {
      const rawRules = Array.isArray(node.rules) ? node.rules : [];
      const normalized = rawRules.map(normalizeRule).filter(Boolean);
      node.rules = normalized.length ? [normalized[0]] : [];
    }
    if (node.type === "delay") {
      node.delay_value = normalizeDelayValue(node.delay_value || node.delayValue || node.value || 1);
      node.delay_unit = normalizeDelayUnit(node.delay_unit || node.delayUnit || node.unit || "seconds");
      node.body = `Aguardar ${formatDelaySummary(node.delay_value, node.delay_unit)}`;
    }
    if ((node.type === "message_short" || node.type === "message_image") && typeof node.image !== "string") {
      node.image = "";
    }
    if ((node.type === "message_link" || node.type === "message_short" || node.type === "message_image") && typeof node.linkMode !== "string") {
      node.linkMode = "first";
    }
    if ((node.type === "message_short" || node.type === "message_image") && typeof node.linkFormat !== "string") {
      node.linkFormat = "default";
    }
    if (node.type === "message_audio") {
      node.audio_source = node.audio_source === "upload" ? "upload" : "existing";
      node.audio_id = typeof node.audio_id === "string" ? node.audio_id : "";
      node.audio_url = typeof node.audio_url === "string" ? node.audio_url : "";
      node.audio_name = typeof node.audio_name === "string" ? node.audio_name : "";
      node.audio_voice = node.audio_voice !== false;
      node.body = typeof node.body === "string" ? node.body : "";
    }
    if (node.type === "message_fast_reply") {
      node.body = typeof node.body === "string" && node.body.trim() ? node.body : "Escolha uma opcao:";
      node.quick_replies = normalizeFastReplyOptions(node.quick_replies);
      node.loop_until_match = node.loop_until_match === true;
    }
    if (node.type === "human_service") {
      node.body = typeof node.body === "string" && node.body.trim() ? node.body : "Deseja falar com um atendente?";
    }
    if (node.type === "action") {
      if (node.action && typeof node.action === "object") {
        if (node.action.type === "wait_click") {
          node.action.with_timeout = node.action.with_timeout !== false;
          node.action.timeout_value = normalizeWaitClickValue(node.action.timeout_value);
          node.action.timeout_unit = normalizeWaitClickUnit(node.action.timeout_unit);
        }
      } else if (typeof node.action === "string" && node.action.trim()) {
        node.action = { type: "text", label: node.action.trim() };
      } else {
        node.action = null;
      }
    }
  });
  state.tags = uniqueStrings([...(Array.isArray(state.tags) ? state.tags : []), ...collectTagsFromNodes(state.nodes)]);

  if (!state.nodes.length) {
    const seeded = defaultData();
    state.nodes = seeded.nodes;
    state.edges = seeded.edges;
    state.tags = seeded.tags;
  }

  ensureStartNode();
  pruneEdges();

  if (flowNameInput) {
    flowNameInput.value = state.flowName;
  }
  applyZoom();

  return true;
}

async function saveFlow() {
  if (!state.flowId) return;
  const current = await fetchFlow(state.flowId);
  const payload = {
    id: state.flowId,
    name: state.flowName || "Fluxo sem nome",
    enabled: current?.enabled ?? true,
    updatedAt: Date.now(),
    data: {
      nodes: state.nodes,
      edges: state.edges,
      tags: state.tags,
      zoom: state.zoom,
      cameraX: state.cameraX,
      cameraY: state.cameraY,
    },
  };
  const saved = await saveFlowToApi(payload);
  if (saved?.id) {
    state.flowId = saved.id;
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveFlow();
  }, AUTO_SAVE_MS);
}

function normalizeRule(rule) {
  if (!rule) return null;
  if (typeof rule === "string") {
    return { type: "text", label: rule };
  }
  if (rule.type === "tag") {
    return {
      type: "tag",
      op: rule.op === "is_not" ? "is_not" : "is",
      tag: rule.tag || "",
    };
  }
  if (rule.type === "message_contains") {
    const mergedKeywords = getMessageContainsKeywords(rule);
    return {
      type: "message_contains",
      keyword: mergedKeywords[0] || "",
      keywords: mergedKeywords,
    };
  }
  if (rule.label) {
    return { type: "text", label: rule.label };
  }
  return null;
}

function formatRule(rule) {
  if (!rule) return "";
  if (rule.type === "tag") {
    const opLabel = rule.op === "is_not" ? "nao e" : "esta";
    return `Tag ${opLabel} ${rule.tag || ""}`.trim();
  }
  if (rule.type === "message_contains") {
    const merged = getMessageContainsKeywords(rule);
    return merged.length ? `Mensagem contem: ${merged.join(" OU ")}` : "Mensagem contem";
  }
  return rule.label || "";
}

function formatAction(action) {
  if (!action) return "";
  if (action.type === "tag") {
    return `Adicionar tag: ${action.tag || ""}`.trim();
  }
  if (action.type === "tag_remove") {
    return `Remover tag: ${action.tag || ""}`.trim();
  }
  if (action.type === "wait_reply") {
    return "Aguardar resposta do usuario";
  }
  if (action.type === "wait_click") {
    const withTimeout = action.with_timeout !== false;
    if (!withTimeout) return "Aguardar click no link";
    const value = normalizeWaitClickValue(action.timeout_value);
    const unit = normalizeWaitClickUnit(action.timeout_unit);
    return `Aguardar click (${formatDelaySummary(value, unit)})`;
  }
  return action.label || "";
}

function uniqueStrings(list) {
  const seen = new Set();
  const output = [];
  list.forEach((value) => {
    const item = String(value || "").trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    output.push(item);
  });
  return output;
}

function getMessageContainsKeywords(rule) {
  if (!rule) return [];
  const keywords = Array.isArray(rule.keywords)
    ? uniqueStrings(rule.keywords.map((item) => String(item || "").trim()).filter(Boolean))
    : [];
  const fallback = String(rule.keyword || rule.value || "").trim();
  return uniqueStrings([...(keywords || []), ...(fallback ? [fallback] : [])]);
}

function collectTagsFromNodes(nodes) {
  const tags = [];
  nodes.forEach((node) => {
    if (node?.action?.type === "tag" || node?.action?.type === "tag_remove") {
      tags.push(node.action.tag);
    }
    if (node?.type === "condition" && Array.isArray(node.rules)) {
      node.rules.forEach((rule) => {
        if (rule?.type === "tag") {
          tags.push(rule.tag);
        }
      });
    }
  });
  return uniqueStrings(tags);
}

function normalizeDelayUnit(unit) {
  const raw = String(unit || "").toLowerCase();
  if (raw === "hours" || raw.startsWith("hora")) return "hours";
  if (raw === "minutes" || raw.startsWith("min")) return "minutes";
  return "seconds";
}

function normalizeDelayValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

function normalizeWaitClickUnit(unit) {
  return normalizeDelayUnit(unit || "minutes");
}

function normalizeWaitClickValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.floor(parsed));
}

function normalizeFastReplyOptions(value) {
  const source = Array.isArray(value) ? value : [];
  const cleaned = uniqueStrings(
    source.map((item) => String(item || "").trim()).filter(Boolean),
  ).slice(0, 3);
  if (cleaned.length) return cleaned;
  return ["Quero saber mais", "Falar com atendente"];
}

function formatDelaySummary(value, unit) {
  const amount = normalizeDelayValue(value);
  const normalizedUnit = normalizeDelayUnit(unit);
  if (normalizedUnit === "hours") return `${amount} hora${amount === 1 ? "" : "s"}`;
  if (normalizedUnit === "minutes") return `${amount} minuto${amount === 1 ? "" : "s"}`;
  return `${amount} segundo${amount === 1 ? "" : "s"}`;
}

function messageBlockNameForNode(nodeId) {
  const key = String(nodeId || "");
  let order = Number(messageBlockOrderCache.get(key) || 0);
  if (!order && key) {
    messageBlockOrderCache = computeMessageBlockOrderMap();
    order = Number(messageBlockOrderCache.get(key) || 0);
  }
  return order > 0 ? `Bloco ${order}` : "";
}

function nodePositionSort(a, b) {
  const ay = Number(a?.y || 0);
  const by = Number(b?.y || 0);
  if (ay !== by) return ay - by;
  const ax = Number(a?.x || 0);
  const bx = Number(b?.x || 0);
  if (ax !== bx) return ax - bx;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function edgeBranchPriority(edge) {
  const branch = String(edge?.branch || "default").toLowerCase();
  if (branch === "default") return 0;
  if (branch === "yes") return 1;
  if (branch === "no") return 2;
  return 3;
}

function computeMessageBlockOrderMap() {
  const order = new Map();
  const nodesById = new Map();
  state.nodes.forEach((node) => nodesById.set(String(node.id || ""), node));

  const outgoing = new Map();
  state.edges.forEach((edge) => {
    const from = String(edge?.from || "");
    if (!from) return;
    const list = outgoing.get(from) || [];
    list.push(edge);
    outgoing.set(from, list);
  });

  const startNodes = state.nodes
    .filter((node) => String(node?.type || "") === "start")
    .sort(nodePositionSort);

  const visiting = new Set();
  const visited = new Set();
  let counter = 0;

  const walk = (nodeId) => {
    const id = String(nodeId || "");
    if (!id || visiting.has(id) || visited.has(id)) return;
    const node = nodesById.get(id);
    if (!node) return;

    visiting.add(id);
    if (MESSAGE_NODE_TYPES.has(String(node.type || "")) && !order.has(id)) {
      counter += 1;
      order.set(id, counter);
    }

    const children = [...(outgoing.get(id) || [])].sort((a, b) => {
      const pa = edgeBranchPriority(a);
      const pb = edgeBranchPriority(b);
      if (pa !== pb) return pa - pb;
      const na = nodesById.get(String(a?.to || ""));
      const nb = nodesById.get(String(b?.to || ""));
      return nodePositionSort(na || { id: a?.to, x: 0, y: 0 }, nb || { id: b?.to, x: 0, y: 0 });
    });
    children.forEach((edge) => walk(String(edge?.to || "")));

    visiting.delete(id);
    visited.add(id);
  };

  if (startNodes.length) {
    startNodes.forEach((node) => walk(String(node.id || "")));
  }

  const remainingMessageNodes = state.nodes
    .filter((node) => MESSAGE_NODE_TYPES.has(String(node?.type || "")) && !order.has(String(node.id || "")))
    .sort(nodePositionSort);

  remainingMessageNodes.forEach((node) => {
    counter += 1;
    order.set(String(node.id || ""), counter);
  });

  return order;
}

function appendMessageHeaderTitle(header, node, fallbackTitle) {
  const titleWrap = document.createElement("div");
  titleWrap.className = "flow-node-title-wrap";

  const blockLabel = document.createElement("div");
  blockLabel.className = "flow-node-block-label";
  blockLabel.textContent = messageBlockNameForNode(node.id) || "Bloco";

  const title = document.createElement("input");
  title.type = "text";
  title.value = node.title || fallbackTitle;
  title.addEventListener("change", () => {
    node.title = title.value;
    scheduleAutoSave();
  });

  titleWrap.appendChild(blockLabel);
  titleWrap.appendChild(title);
  header.appendChild(titleWrap);
}

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function applyZoom() {
  if (!surface || !flowCanvas) return;
  const value = clampZoom(state.zoom || 1);
  state.zoom = value;
  const cameraX = Number(state.cameraX || 0);
  const cameraY = Number(state.cameraY || 0);
  surface.style.transform = `translate(${cameraX}px, ${cameraY}px) scale(${value})`;
  surface.dataset.zoom = String(value);

  const gridSize = Math.max(12, Math.round(28 * value));
  flowCanvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  flowCanvas.style.backgroundPosition = `${cameraX}px ${cameraY}px`;

  if (zoomValue) {
    zoomValue.textContent = `${Math.round(value * 100)}%`;
  }
  requestAnimationFrame(() => {
    renderEdges();
    renderMinimap();
  });
}

function ensureSurfaceSize() {
  if (!surface) return;
  let maxX = 0;
  let maxY = 0;
  let minX = 0;
  let minY = 0;
  state.nodes.forEach((node) => {
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  });
  const neededWidth = Math.max(
    SURFACE_MIN_WIDTH,
    maxX + SURFACE_PADDING,
    Math.abs(minX) + SURFACE_PADDING,
  );
  const neededHeight = Math.max(
    SURFACE_MIN_HEIGHT,
    maxY + SURFACE_PADDING,
    Math.abs(minY) + SURFACE_PADDING,
  );
  surface.style.minWidth = `${Math.ceil(neededWidth)}px`;
  surface.style.minHeight = `${Math.ceil(neededHeight)}px`;
}

function renderTags() {
  return;
}

function conditionNodeMinHeight(node) {
  const baseHeight = 230;
  const rules = Array.isArray(node?.rules) ? node.rules : [];
  if (!rules.length) return baseHeight;
  const rule = normalizeRule(rules[0]);
  if (!rule) return baseHeight;

  const labelText = formatRule(rule);
  const textLines = Math.max(1, Math.ceil(labelText.length / 30));

  let logicalLines = textLines;
  if (rule.type === "message_contains") {
    const keywords = getMessageContainsKeywords(rule);
    logicalLines = Math.max(logicalLines, keywords.length || 1);
  }

  const extraLines = Math.max(0, logicalLines - 1);
  return baseHeight + extraLines * 24;
}

function fastReplyNodeHeight(node) {
  const options = normalizeFastReplyOptions(node?.quick_replies);
  return 300 + Math.max(0, options.length - 2) * 34;
}

function nodeSize(node) {
  const type = String(node?.type || "");
  if (type === "start") return { width: 320, height: 210 };
  if (type === "condition") return { width: 300, height: conditionNodeMinHeight(node) };
  if (type === "action") return { width: 300, height: 220 };
  if (type === "delay") return { width: 320, height: 190 };
  if (type === "message_image") return { width: 300, height: 360 };
  if (type === "message_audio") return { width: 320, height: 320 };
  if (type === "message_fast_reply") return { width: 320, height: fastReplyNodeHeight(node) };
  if (type === "human_service") return { width: 320, height: 292 };
  if (type === "message_short" || type === "message_link") return { width: 300, height: 300 };
  return { width: 260, height: 220 };
}

function getViewportWorldRect() {
  const zoom = state.zoom || 1;
  const width = flowCanvas ? flowCanvas.clientWidth : 1;
  const height = flowCanvas ? flowCanvas.clientHeight : 1;
  return {
    x: (-Number(state.cameraX || 0)) / zoom,
    y: (-Number(state.cameraY || 0)) / zoom,
    width: width / zoom,
    height: height / zoom,
  };
}

function buildMinimapModel() {
  if (!minimapBody) return null;
  const rect = minimapBody.getBoundingClientRect();
  const mapWidth = Math.max(120, Math.floor(rect.width));
  const mapHeight = Math.max(90, Math.floor(rect.height));

  const viewport = getViewportWorldRect();
  let minX = viewport.x;
  let minY = viewport.y;
  let maxX = viewport.x + viewport.width;
  let maxY = viewport.y + viewport.height;

  state.nodes.forEach((node) => {
    const size = nodeSize(node);
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  });

  minX -= MINIMAP_NODE_PADDING;
  minY -= MINIMAP_NODE_PADDING;
  maxX += MINIMAP_NODE_PADDING;
  maxY += MINIMAP_NODE_PADDING;

  const worldWidth = Math.max(600, maxX - minX);
  const worldHeight = Math.max(500, maxY - minY);
  const scale = Math.min((mapWidth - 8) / worldWidth, (mapHeight - 8) / worldHeight);
  const offsetX = (mapWidth - worldWidth * scale) / 2;
  const offsetY = (mapHeight - worldHeight * scale) / 2;

  return {
    mapWidth,
    mapHeight,
    minX,
    minY,
    worldWidth,
    worldHeight,
    scale,
    offsetX,
    offsetY,
    viewport,
  };
}

function worldToMinimap(worldX, worldY, model) {
  return {
    x: model.offsetX + (worldX - model.minX) * model.scale,
    y: model.offsetY + (worldY - model.minY) * model.scale,
  };
}

function minimapToWorld(mapX, mapY, model) {
  return {
    x: model.minX + (mapX - model.offsetX) / model.scale,
    y: model.minY + (mapY - model.offsetY) / model.scale,
  };
}

function renderMinimap() {
  if (!minimap || !minimapBody || !minimapSvg || !minimapViewport || !flowCanvas) return;

  const model = buildMinimapModel();
  if (!model) return;
  minimapModel = model;

  minimapSvg.setAttribute("viewBox", `0 0 ${model.mapWidth} ${model.mapHeight}`);
  minimapSvg.setAttribute("width", String(model.mapWidth));
  minimapSvg.setAttribute("height", String(model.mapHeight));

  const nodeRects = state.nodes
    .map((node) => {
      const size = nodeSize(node);
      const p = worldToMinimap(Number(node.x || 0), Number(node.y || 0), model);
      return {
        id: node.id,
        x: p.x,
        y: p.y,
        w: Math.max(8, size.width * model.scale),
        h: Math.max(6, size.height * model.scale),
        type: node.type,
      };
    })
    .map((item) => {
      const active = item.id === selectedNodeId ? " active" : "";
      const start = item.type === "start" ? " start" : "";
      return `<rect class="minimap-node${active}${start}" x="${item.x.toFixed(2)}" y="${item.y.toFixed(2)}" width="${item.w.toFixed(2)}" height="${item.h.toFixed(2)}" rx="2.5" ry="2.5"></rect>`;
    })
    .join("");

  minimapSvg.innerHTML = nodeRects;

  const vTopLeft = worldToMinimap(model.viewport.x, model.viewport.y, model);
  const vWidth = Math.max(14, model.viewport.width * model.scale);
  const vHeight = Math.max(12, model.viewport.height * model.scale);

  minimapViewport.style.left = `${vTopLeft.x}px`;
  minimapViewport.style.top = `${vTopLeft.y}px`;
  minimapViewport.style.width = `${vWidth}px`;
  minimapViewport.style.height = `${vHeight}px`;
}

function moveCameraToWorld(worldX, worldY, center = true) {
  if (!flowCanvas) return;
  const zoom = state.zoom || 1;
  if (center) {
    state.cameraX = flowCanvas.clientWidth / 2 - worldX * zoom;
    state.cameraY = flowCanvas.clientHeight / 2 - worldY * zoom;
  } else {
    state.cameraX = -worldX * zoom;
    state.cameraY = -worldY * zoom;
  }
  applyZoom();
}

function initMinimapInteractions() {
  if (!minimapBody || !minimapViewport) return;
  if (minimapBody.dataset.bound === "1") return;
  minimapBody.dataset.bound = "1";

  minimapBody.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (!minimapModel) return;

    const rect = minimapBody.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    const onMove = (moveEvent) => {
      if (!minimapDrag || !minimapModel) return;
      const moveLocalX = moveEvent.clientX - rect.left;
      const moveLocalY = moveEvent.clientY - rect.top;
      const deltaMapX = moveLocalX - minimapDrag.startMapX;
      const deltaMapY = moveLocalY - minimapDrag.startMapY;
      const nextWorldX = minimapDrag.startWorldX + deltaMapX / minimapModel.scale;
      const nextWorldY = minimapDrag.startWorldY + deltaMapY / minimapModel.scale;
      moveCameraToWorld(nextWorldX, nextWorldY, false);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      minimapDrag = null;
      scheduleAutoSave();
    };

    if (event.target === minimapViewport || minimapViewport.contains(event.target)) {
      const viewport = getViewportWorldRect();
      minimapDrag = {
        startMapX: localX,
        startMapY: localY,
        startWorldX: viewport.x,
        startWorldY: viewport.y,
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const world = minimapToWorld(localX, localY, minimapModel);
    moveCameraToWorld(world.x, world.y, true);
    scheduleAutoSave();
    event.preventDefault();
    event.stopPropagation();
  });
}

function isNodeDeletable(node) {
  return Boolean(node && node.type !== "start");
}

function syncSelectedNodes() {
  if (!surface) return;
  const selected = selectedNodeId;
  surface.querySelectorAll(".flow-node").forEach((nodeEl) => {
    const isSelected = Boolean(selected && nodeEl.dataset.nodeId === selected);
    nodeEl.classList.toggle("selected", isSelected);
  });
}

function setSelectedNode(nodeId) {
  selectedNodeId = nodeId || null;
  if (selectedNodeId && !state.nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = null;
  }
  syncSelectedNodes();
  renderMinimap();
}

function removeNodeById(nodeId) {
  const target = state.nodes.find((node) => node.id === nodeId);
  if (!isNodeDeletable(target)) return;
  state.nodes = state.nodes.filter((node) => node.id !== nodeId);
  state.edges = state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  if (linkFromId === nodeId) {
    linkFromId = null;
    linkFromBranch = null;
    clearLinking();
  }
  if (selectedNodeId === nodeId) {
    selectedNodeId = null;
  }
  renderAll();
  scheduleAutoSave();
}

function createDeleteButton(node) {
  if (!isNodeDeletable(node)) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "node-trash";
  button.title = "Excluir bloco";
  button.setAttribute("aria-label", "Excluir bloco");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 11h12l1-13H5l1 13Z"/></svg>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeNodeById(node.id);
  });
  return button;
}

function attachNodeInteractions(element, node) {
  element.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".condition-popup, .action-popup")) return;
    setSelectedNode(node.id);
  });
}

function renderStartNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-start";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header flow-start-header";
  const icon = document.createElement("span");
  icon.className = "flow-start-icon";
  icon.textContent = "G";
  const title = document.createElement("span");
  title.className = "flow-start-title";
  title.textContent = "Quando...";
  header.appendChild(icon);
  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "flow-start-body";
  const desc = document.createElement("p");
  desc.textContent =
    "O gatilho e responsavel por acionar a automacao. Clique para adicionar um gatilho.";
  body.appendChild(desc);

  const triggerButton = document.createElement("button");
  triggerButton.type = "button";
  triggerButton.className = "trigger-button";
  triggerButton.textContent = node.trigger ? node.trigger : "+ Novo Gatilho";
  body.appendChild(triggerButton);

  const menu = document.createElement("div");
  menu.className = "trigger-menu";
  const option = document.createElement("button");
  option.type = "button";
  option.textContent = "Quando usuario enviar mensagem";
  option.addEventListener("click", () => {
    node.trigger = option.textContent;
    renderAll();
    scheduleAutoSave();
  });
  menu.appendChild(option);
  body.appendChild(menu);

  triggerButton.addEventListener("click", () => {
    menu.classList.toggle("open");
  });

  const footer = document.createElement("div");
  footer.className = "flow-start-footer";
  footer.textContent = "Entao";

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "default";
    clearLinking();
    el.classList.add("linking");
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(footer);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderConditionNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-condition";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.minHeight = `${conditionNodeMinHeight(node)}px`;
  const header = document.createElement("div");
  header.className = "flow-node-header flow-condition-header";
  const icon = document.createElement("span");
  icon.className = "flow-node-icon";
  icon.textContent = "C";
  const title = document.createElement("span");
  title.textContent = "Condicao";
  header.appendChild(icon);
  header.appendChild(title);
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body flow-condition-body";

  const list = document.createElement("div");
  list.className = "flow-condition-list";

  const rules = Array.isArray(node.rules) ? node.rules : [];
  const openPopup = (event) => {
    if (event) event.stopPropagation();
    popup.dataset.view = "root";
    popup.classList.add("open");
  };

  if (!rules.length) {
    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "flow-placeholder";
    placeholder.textContent = "Clique para escolher uma condicao";
    placeholder.addEventListener("click", openPopup);
    list.appendChild(placeholder);
  } else {
    const rule = rules[0];
    const item = document.createElement("div");
    item.className = "flow-condition-item";
    const text = document.createElement("button");
    text.type = "button";
    text.className = "flow-condition-edit";
    text.textContent = formatRule(rule);
    text.addEventListener("click", openPopup);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      node.rules = [];
      renderAll();
      scheduleAutoSave();
    });
    item.appendChild(text);
    item.appendChild(remove);
    list.appendChild(item);
  }

  body.appendChild(list);

  const popup = document.createElement("div");
  popup.className = "condition-popup";
  popup.dataset.view = "root";
  const popupHeader = document.createElement("div");
  popupHeader.className = "condition-popup-header";
  popupHeader.textContent = "Escolha uma condicao";

  const rootView = document.createElement("div");
  rootView.className = "condition-popup-root";
  const tagOption = document.createElement("button");
  tagOption.type = "button";
  tagOption.textContent = "Tag";
  tagOption.addEventListener("click", () => {
    renderTagList();
    popup.dataset.view = "tag";
  });
  rootView.appendChild(tagOption);

  const messageOption = document.createElement("button");
  messageOption.type = "button";
  messageOption.textContent = "Mensagem contem";
  rootView.appendChild(messageOption);

  const tagView = document.createElement("div");
  tagView.className = "condition-popup-tag";
  const tagHeader = document.createElement("div");
  tagHeader.className = "condition-popup-title";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "ghost";
  backBtn.textContent = "Voltar";
  backBtn.addEventListener("click", () => {
    popup.dataset.view = "root";
  });
  const tagTitle = document.createElement("span");
  tagTitle.textContent = "Tag";
  tagHeader.appendChild(backBtn);
  tagHeader.appendChild(tagTitle);

  const columns = document.createElement("div");
  columns.className = "condition-popup-columns";
  const opList = document.createElement("div");
  opList.className = "condition-op-list";
  let selectedOp = "is";
  const buildOpButton = (value, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (selectedOp === value) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      selectedOp = value;
      Array.from(opList.querySelectorAll("button")).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
    return btn;
  };
  opList.appendChild(buildOpButton("is", "esta"));
  opList.appendChild(buildOpButton("is_not", "nao e"));

  const tagPanel = document.createElement("div");
  tagPanel.className = "condition-tag-panel";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar tag";
  const tagList = document.createElement("div");
  tagList.className = "condition-tag-list";

  const renderTagList = () => {
    tagList.innerHTML = "";
    const term = search.value.trim().toLowerCase();
    const tags = state.tags.filter((tag) => tag.toLowerCase().includes(term));
    if (!tags.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nenhuma tag criada.";
      tagList.appendChild(empty);
      return;
    }
    tags.forEach((tag) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "condition-tag-item";
      item.innerHTML = `<span>${tag}</span><span class="count">0</span>`;
      item.addEventListener("click", () => {
        node.rules = [{ type: "tag", op: selectedOp, tag }];
        popup.classList.remove("open");
        renderAll();
        scheduleAutoSave();
        saveFlow();
      });
      tagList.appendChild(item);
    });
  };
  search.addEventListener("input", renderTagList);
  renderTagList();
  tagPanel.appendChild(search);
  tagPanel.appendChild(tagList);

  columns.appendChild(opList);
  columns.appendChild(tagPanel);
  tagView.appendChild(tagHeader);
  tagView.appendChild(columns);

  const messageView = document.createElement("div");
  messageView.className = "condition-popup-message";
  const messageHeader = document.createElement("div");
  messageHeader.className = "condition-popup-title";
  const messageBackBtn = document.createElement("button");
  messageBackBtn.type = "button";
  messageBackBtn.className = "ghost";
  messageBackBtn.textContent = "Voltar";
  messageBackBtn.addEventListener("click", () => {
    popup.dataset.view = "root";
  });
  const messageTitle = document.createElement("span");
  messageTitle.textContent = "Mensagem contem";
  messageHeader.appendChild(messageBackBtn);
  messageHeader.appendChild(messageTitle);

  const messagePanel = document.createElement("div");
  messagePanel.className = "condition-message-panel";
  const messageList = document.createElement("div");
  messageList.className = "condition-message-list";

  const createMessageKeywordInput = (value = "") => {
    const row = document.createElement("div");
    row.className = "condition-message-row";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Digite a frase (ex: gosto de abacate)";
    input.value = String(value || "");
    row.appendChild(input);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ghost condition-message-remove";
    removeBtn.textContent = "x";
    removeBtn.title = "Remover";
    removeBtn.addEventListener("click", () => {
      row.remove();
      if (!messageList.querySelector("input")) {
        messageList.appendChild(createMessageKeywordInput(""));
      }
    });
    row.appendChild(removeBtn);
    return row;
  };

  const readMessageKeywords = () =>
    uniqueStrings(
      Array.from(messageList.querySelectorAll("input"))
        .map((input) => String(input.value || "").trim())
        .filter(Boolean),
    );

  const messageActions = document.createElement("div");
  messageActions.className = "condition-message-actions";
  const addOrBtn = document.createElement("button");
  addOrBtn.type = "button";
  addOrBtn.className = "ghost";
  addOrBtn.textContent = "+ OU";
  addOrBtn.addEventListener("click", () => {
    messageList.appendChild(createMessageKeywordInput(""));
    const inputs = messageList.querySelectorAll("input");
    const lastInput = inputs[inputs.length - 1];
    if (lastInput) lastInput.focus();
  });

  const messageSave = document.createElement("button");
  messageSave.type = "button";
  messageSave.textContent = "Aplicar";

  const applyMessageRule = () => {
    const keywords = readMessageKeywords();
    if (!keywords.length) {
      const firstInput = messageList.querySelector("input");
      if (firstInput) firstInput.focus();
      return;
    }
    node.rules = [{ type: "message_contains", keyword: keywords[0], keywords }];
    popup.classList.remove("open");
    renderAll();
    scheduleAutoSave();
    saveFlow();
  };

  messageSave.addEventListener("click", applyMessageRule);
  messagePanel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    event.preventDefault();
    applyMessageRule();
  });

  messageActions.appendChild(addOrBtn);
  messageActions.appendChild(messageSave);
  messagePanel.appendChild(messageList);
  messagePanel.appendChild(messageActions);
  messageView.appendChild(messageHeader);
  messageView.appendChild(messagePanel);

  messageOption.addEventListener("click", () => {
    const current = Array.isArray(node.rules) ? node.rules[0] : null;
    let currentKeywords = [];
    if (current?.type === "message_contains") {
      const rawList = Array.isArray(current.keywords)
        ? current.keywords.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const fallback = String(current.keyword || "").trim();
      currentKeywords = uniqueStrings([...(rawList || []), ...(fallback ? [fallback] : [])]);
    }
    messageList.innerHTML = "";
    if (!currentKeywords.length) {
      messageList.appendChild(createMessageKeywordInput(""));
    } else {
      currentKeywords.forEach((keyword) => {
        messageList.appendChild(createMessageKeywordInput(keyword));
      });
    }
    popup.dataset.view = "message";
    const firstInput = messageList.querySelector("input");
    if (firstInput) firstInput.focus();
  });

  popup.appendChild(popupHeader);
  popup.appendChild(rootView);
  popup.appendChild(tagView);
  popup.appendChild(messageView);
  body.appendChild(popup);

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out yes";
  connectorOut.title = "Sim";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "yes";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorOutNo = document.createElement("div");
  connectorOutNo.className = "connector out no";
  connectorOutNo.title = "Nao";
  connectorOutNo.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "no";
    clearLinking();
    el.classList.add("linking");
  });

  const yesLabel = document.createElement("span");
  yesLabel.className = "flow-branch-label yes";
  yesLabel.textContent = "Sim";
  const noLabel = document.createElement("span");
  noLabel.className = "flow-branch-label no";
  noLabel.textContent = "Nao";

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  el.appendChild(connectorOutNo);
  el.appendChild(yesLabel);
  el.appendChild(noLabel);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderActionNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-actions";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header flow-action-header";
  const icon = document.createElement("span");
  icon.className = "flow-node-icon";
  icon.textContent = "A";
  const title = document.createElement("span");
  title.textContent = "Acoes";
  header.appendChild(icon);
  header.appendChild(title);
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body";
  const placeholder = document.createElement("button");
  placeholder.type = "button";
  placeholder.className = "flow-placeholder";
  placeholder.textContent = formatAction(node.action) || "Clique para adicionar uma acao";
  body.appendChild(placeholder);

  const popup = document.createElement("div");
  popup.className = "action-popup";
  popup.dataset.view = "root";
  const popupHeader = document.createElement("div");
  popupHeader.className = "action-popup-header";
  popupHeader.textContent = "Escolha uma acao";

  const rootView = document.createElement("div");
  rootView.className = "action-popup-root";
  const tagOption = document.createElement("button");
  tagOption.type = "button";
  tagOption.textContent = "Adicionar tag";
  tagOption.addEventListener("click", () => {
    selectedActionMode = "add";
    renderTagList();
    popup.dataset.view = "tag";
  });
  rootView.appendChild(tagOption);
  const removeTagOption = document.createElement("button");
  removeTagOption.type = "button";
  removeTagOption.textContent = "Remover tag";
  removeTagOption.addEventListener("click", () => {
    selectedActionMode = "remove";
    renderTagList();
    popup.dataset.view = "tag";
  });
  rootView.appendChild(removeTagOption);
  const waitOption = document.createElement("button");
  waitOption.type = "button";
  waitOption.textContent = "Aguardar resposta";
  waitOption.addEventListener("click", () => {
    node.action = { type: "wait_reply" };
    popup.classList.remove("open");
    renderAll();
    scheduleAutoSave();
    saveFlow();
  });
  rootView.appendChild(waitOption);
  const waitClickOption = document.createElement("button");
  waitClickOption.type = "button";
  waitClickOption.textContent = "Aguardar click no link";
  rootView.appendChild(waitClickOption);

  const tagView = document.createElement("div");
  tagView.className = "action-popup-tag";
  const tagHeader = document.createElement("div");
  tagHeader.className = "action-popup-title";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "ghost";
  backBtn.textContent = "Voltar";
  backBtn.addEventListener("click", () => {
    popup.dataset.view = "root";
  });
  const tagTitle = document.createElement("span");
  tagTitle.textContent = "Tags";
  tagHeader.appendChild(backBtn);
  tagHeader.appendChild(tagTitle);

  const tagPanel = document.createElement("div");
  tagPanel.className = "action-tag-panel";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar tag";
  const tagList = document.createElement("div");
  tagList.className = "action-tag-list";
  const createTag = document.createElement("button");
  createTag.type = "button";
  createTag.className = "ghost";
  createTag.textContent = "Nova tag";
  let selectedActionMode = "add";
  createTag.addEventListener("click", () => {
    if (selectedActionMode === "remove") return;
    const value = window.prompt("Nome da nova tag");
    if (!value) return;
    const name = value.trim();
    if (!name) return;
    if (!state.tags.includes(name)) {
      state.tags.push(name);
    }
    node.action = { type: "tag", tag: name };
    popup.classList.remove("open");
    renderAll();
    scheduleAutoSave();
    saveFlow();
  });

  const renderTagList = () => {
    tagList.innerHTML = "";
    tagTitle.textContent = selectedActionMode === "remove" ? "Remover tag" : "Adicionar tag";
    createTag.style.display = selectedActionMode === "remove" ? "none" : "inline-flex";
    const term = search.value.trim().toLowerCase();
    const tags = state.tags.filter((tag) => tag.toLowerCase().includes(term));
    if (!tags.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent =
        selectedActionMode === "remove"
          ? "Nenhuma tag disponivel para remover."
          : "Nenhuma tag criada.";
      tagList.appendChild(empty);
      return;
    }
    tags.forEach((tag) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "action-tag-item";
      item.textContent = tag;
      item.addEventListener("click", () => {
        node.action =
          selectedActionMode === "remove"
            ? { type: "tag_remove", tag }
            : { type: "tag", tag };
        popup.classList.remove("open");
        renderAll();
        scheduleAutoSave();
        saveFlow();
      });
      tagList.appendChild(item);
    });
  };
  search.addEventListener("input", renderTagList);
  renderTagList();
  tagPanel.appendChild(search);
  tagPanel.appendChild(tagList);
  tagPanel.appendChild(createTag);

  tagView.appendChild(tagHeader);
  tagView.appendChild(tagPanel);

  const waitClickView = document.createElement("div");
  waitClickView.className = "action-popup-wait-click";
  const waitClickHeader = document.createElement("div");
  waitClickHeader.className = "action-popup-title";
  const waitClickBackBtn = document.createElement("button");
  waitClickBackBtn.type = "button";
  waitClickBackBtn.className = "ghost";
  waitClickBackBtn.textContent = "Voltar";
  waitClickBackBtn.addEventListener("click", () => {
    popup.dataset.view = "root";
  });
  const waitClickTitle = document.createElement("span");
  waitClickTitle.textContent = "Aguardar click";
  waitClickHeader.appendChild(waitClickBackBtn);
  waitClickHeader.appendChild(waitClickTitle);

  const waitClickPanel = document.createElement("div");
  waitClickPanel.className = "action-wait-click-panel";

  const switchRow = document.createElement("label");
  switchRow.className = "action-wait-click-switch";
  const switchInput = document.createElement("input");
  switchInput.type = "checkbox";
  const switchText = document.createElement("span");
  switchText.textContent = "Com prazo";
  switchRow.appendChild(switchInput);
  switchRow.appendChild(switchText);

  const timeoutRow = document.createElement("div");
  timeoutRow.className = "action-wait-click-time";
  const timeoutValueInput = document.createElement("input");
  timeoutValueInput.type = "number";
  timeoutValueInput.min = "1";
  timeoutValueInput.step = "1";
  timeoutValueInput.value = "30";
  const timeoutUnitSelect = document.createElement("select");
  timeoutUnitSelect.innerHTML = `
    <option value="seconds">Segundos</option>
    <option value="minutes">Minutos</option>
    <option value="hours">Horas</option>
  `;
  timeoutUnitSelect.value = "minutes";
  timeoutRow.appendChild(timeoutValueInput);
  timeoutRow.appendChild(timeoutUnitSelect);

  const timeoutHint = document.createElement("div");
  timeoutHint.className = "hint";
  timeoutHint.textContent = "Saidas: Clicou (imediato) e Nao clicou (apos prazo).";

  const waitClickSave = document.createElement("button");
  waitClickSave.type = "button";
  waitClickSave.textContent = "Salvar";

  const refreshWaitClickUi = () => {
    const enabled = switchInput.checked;
    timeoutValueInput.disabled = !enabled;
    timeoutUnitSelect.disabled = !enabled;
    timeoutRow.classList.toggle("disabled", !enabled);
  };

  const openWaitClickConfig = () => {
    const current =
      node.action?.type === "wait_click" && node.action
        ? node.action
        : { type: "wait_click", with_timeout: true, timeout_value: 30, timeout_unit: "minutes" };
    switchInput.checked = current.with_timeout !== false;
    timeoutValueInput.value = String(normalizeWaitClickValue(current.timeout_value));
    timeoutUnitSelect.value = normalizeWaitClickUnit(current.timeout_unit);
    refreshWaitClickUi();
    popup.dataset.view = "wait_click";
  };

  switchInput.addEventListener("change", refreshWaitClickUi);
  waitClickSave.addEventListener("click", () => {
    node.action = {
      type: "wait_click",
      with_timeout: switchInput.checked,
      timeout_value: normalizeWaitClickValue(timeoutValueInput.value),
      timeout_unit: normalizeWaitClickUnit(timeoutUnitSelect.value),
    };
    popup.classList.remove("open");
    renderAll();
    scheduleAutoSave();
    saveFlow();
  });

  waitClickOption.addEventListener("click", openWaitClickConfig);

  waitClickPanel.appendChild(switchRow);
  waitClickPanel.appendChild(timeoutRow);
  waitClickPanel.appendChild(timeoutHint);
  waitClickPanel.appendChild(waitClickSave);
  waitClickView.appendChild(waitClickHeader);
  waitClickView.appendChild(waitClickPanel);

  popup.appendChild(popupHeader);
  popup.appendChild(rootView);
  popup.appendChild(tagView);
  popup.appendChild(waitClickView);
  body.appendChild(popup);

  const openPopup = (event) => {
    if (event) event.stopPropagation();
    popup.dataset.view = "root";
    popup.classList.add("open");
  };
  placeholder.addEventListener("click", openPopup);

  const isWaitClickAction = node.action?.type === "wait_click";
  const waitClickWithTimeout = isWaitClickAction ? node.action?.with_timeout !== false : false;
  if (isWaitClickAction) {
    el.classList.add("flow-node-actions-wait-click");
  }
  const footer = document.createElement("div");
  footer.className = "flow-node-footer";
  footer.textContent = isWaitClickAction ? "" : "Proximo Passo";

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  const connectorOut = document.createElement("div");
  connectorOut.className = isWaitClickAction ? "connector out yes" : "connector out";
  connectorOut.title = isWaitClickAction ? "Clicou" : "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = isWaitClickAction ? "yes" : "default";
    clearLinking();
    el.classList.add("linking");
  });

  let connectorOutNo = null;
  let yesLabel = null;
  let noLabel = null;
  if (isWaitClickAction) {
    connectorOutNo = document.createElement("div");
    connectorOutNo.className = "connector out no";
    connectorOutNo.title = waitClickWithTimeout ? "Nao clicou" : "Nao clicou (desligado)";
    if (!waitClickWithTimeout) connectorOutNo.classList.add("disabled");
    connectorOutNo.addEventListener("click", () => {
      if (!waitClickWithTimeout) return;
      linkFromId = node.id;
      linkFromBranch = "no";
      clearLinking();
      el.classList.add("linking");
    });

    yesLabel = document.createElement("span");
    yesLabel.className = "flow-branch-label yes";
    yesLabel.textContent = "Clicou";
    noLabel = document.createElement("span");
    noLabel.className = "flow-branch-label no";
    noLabel.textContent = "Nao clicou";
    if (!waitClickWithTimeout) noLabel.classList.add("disabled");
  }

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(footer);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  if (connectorOutNo) el.appendChild(connectorOutNo);
  if (yesLabel) el.appendChild(yesLabel);
  if (noLabel) el.appendChild(noLabel);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderLinkMessageNode(node) {
  const isShort = node.type === "message_short";
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-message-link";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  appendMessageHeaderTitle(header, node, isShort ? "Mensagem com link curto" : "Mensagem com link");
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body";
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Texto da mensagem";
  textarea.value = node.body || "";
  textarea.addEventListener("change", () => {
    node.body = textarea.value;
    scheduleAutoSave();
  });
  let updatePreview = null;
  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = isShort ? "URL final (com UTMs)" : "https://seusite.com";
  url.value = node.url || "";
  url.addEventListener("change", () => {
    node.url = url.value;
    if (typeof updatePreview === "function") updatePreview();
    scheduleAutoSave();
  });
  body.appendChild(textarea);
  body.appendChild(url);
  const varsHint = document.createElement("div");
  varsHint.className = "flow-url-vars-hint";
  varsHint.textContent = "Parametros: {wa_id}, {bloco}, {fluxo}";
  body.appendChild(varsHint);

  const linkMode = document.createElement("select");
  linkMode.innerHTML = `
    <option value="first">Link primeiro</option>
    <option value="last">Link por ultimo</option>
    <option value="only">Somente link</option>
  `;
  linkMode.value = node.linkMode || "first";
  linkMode.addEventListener("change", () => {
    node.linkMode = linkMode.value;
    scheduleAutoSave();
  });
  body.appendChild(linkMode);

  if (isShort) {
    const image = document.createElement("input");
    image.type = "url";
    image.placeholder = "URL da imagem (preview)";
    image.value = node.image || "";

    const linkFormat = document.createElement("select");
    linkFormat.innerHTML = `
      <option value="default">Link padrao</option>
      <option value="html">Forcar .html</option>
      <option value="jpg">Forcar .jpg</option>
    `;
    linkFormat.value = node.linkFormat || "default";
    linkFormat.addEventListener("change", () => {
      node.linkFormat = linkFormat.value;
      scheduleAutoSave();
    });

    const preview = document.createElement("div");
    preview.className = "link-preview";
    const previewLabel = document.createElement("div");
    previewLabel.className = "link-preview-label";
    previewLabel.textContent = "Preview do link";
    const card = document.createElement("div");
    card.className = "link-preview-card";
    const previewImage = document.createElement("img");
    previewImage.alt = "Preview";
    const previewPlaceholder = document.createElement("div");
    previewPlaceholder.className = "link-preview-placeholder";
    previewPlaceholder.textContent = "Sem imagem";
    const meta = document.createElement("div");
    meta.className = "link-preview-meta";
    const metaTitle = document.createElement("div");
    metaTitle.className = "link-preview-title";
    metaTitle.textContent = "Botzap Link";
    const metaDesc = document.createElement("div");
    metaDesc.className = "link-preview-desc";
    metaDesc.textContent = "Preview do WhatsApp";
    const metaUrl = document.createElement("div");
    metaUrl.className = "link-preview-url";
    const metaNote = document.createElement("div");
    metaNote.className = "link-preview-note";
    metaNote.textContent = "O link curto sera gerado no envio";
    meta.appendChild(metaTitle);
    meta.appendChild(metaDesc);
    meta.appendChild(metaUrl);
    meta.appendChild(metaNote);
    card.appendChild(previewImage);
    card.appendChild(previewPlaceholder);
    card.appendChild(meta);
    preview.appendChild(previewLabel);
    preview.appendChild(card);

    updatePreview = () => {
      const imageValue = (node.image || "").trim();
      const urlValue = (node.url || "").trim();
      metaUrl.textContent = urlValue ? urlValue : "URL final nao definida";
      if (imageValue) {
        previewImage.src = imageValue;
        previewImage.style.display = "block";
        previewPlaceholder.style.display = "none";
      } else {
        previewImage.removeAttribute("src");
        previewImage.style.display = "none";
        previewPlaceholder.style.display = "grid";
      }
    };

    image.addEventListener("change", () => {
      node.image = image.value;
      if (typeof updatePreview === "function") updatePreview();
      scheduleAutoSave();
    });

    updatePreview();

    body.appendChild(image);
    body.appendChild(linkFormat);
    body.appendChild(preview);
  }

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "default";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderFastReplyMessageNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-message-link flow-node-message-fast-reply";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.minHeight = `${fastReplyNodeHeight(node)}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  appendMessageHeaderTitle(header, node, "Mensagem Fast Reply");
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body flow-fast-reply-body";

  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Texto da mensagem";
  textarea.value = node.body || "";
  textarea.addEventListener("change", () => {
    node.body = textarea.value;
    scheduleAutoSave();
  });

  const loopWrap = document.createElement("label");
  loopWrap.className = "flow-switch flow-fast-reply-loop";
  const loopInput = document.createElement("input");
  loopInput.type = "checkbox";
  loopInput.checked = node.loop_until_match === true;
  const loopSlider = document.createElement("span");
  loopSlider.className = "flow-switch-slider";
  const loopLabel = document.createElement("span");
  loopLabel.className = "flow-switch-label";
  loopLabel.textContent = "Loop ate clicar";
  loopWrap.appendChild(loopInput);
  loopWrap.appendChild(loopSlider);
  loopWrap.appendChild(loopLabel);

  const hint = document.createElement("div");
  hint.className = "flow-fast-reply-hint";
  hint.textContent = "Cada botao tem um caminho proprio. Se loop estiver ligado, o bloco repete ate a resposta bater com um botao.";

  const list = document.createElement("div");
  list.className = "flow-fast-reply-list";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ghost";
  addButton.textContent = "+ Adicionar botao";

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  const rebuildOutputs = (options) => {
    el.querySelectorAll(".connector.out.fr, .flow-branch-label.fr").forEach((item) => item.remove());
    const total = Math.max(1, options.length);
    const bottomStart = 18;
    const step = 30;

    options.forEach((option, index) => {
      const branch = `fr_${index}`;
      const bottom = bottomStart + (total - 1 - index) * step;

      const connectorOut = document.createElement("div");
      connectorOut.className = `connector out fr ${branch}`;
      connectorOut.style.bottom = `${bottom}px`;
      connectorOut.style.top = "auto";
      connectorOut.style.transform = "none";
      connectorOut.title = `Opcao ${index + 1}`;
      connectorOut.addEventListener("click", () => {
        linkFromId = node.id;
        linkFromBranch = branch;
        clearLinking();
        el.classList.add("linking");
      });

      const branchLabel = document.createElement("span");
      branchLabel.className = `flow-branch-label fr ${branch}`;
      branchLabel.style.bottom = `${bottom + 3}px`;
      branchLabel.style.top = "auto";
      branchLabel.textContent = `${index + 1}: ${String(option || "").slice(0, 14)}`;

      el.appendChild(connectorOut);
      el.appendChild(branchLabel);
    });
  };

  const renderOptions = () => {
    node.quick_replies = normalizeFastReplyOptions(node.quick_replies);
    const options = [...node.quick_replies];
    el.style.minHeight = `${fastReplyNodeHeight(node)}px`;
    body.style.paddingBottom = `${58 + Math.max(1, options.length) * 30}px`;

    list.innerHTML = "";
    options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "flow-fast-reply-row";

      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 20;
      input.value = option;
      input.placeholder = `Botao ${index + 1}`;
      input.addEventListener("change", () => {
        const value = String(input.value || "").trim();
        if (!value) {
          input.value = options[index] || `Opcao ${index + 1}`;
          return;
        }
        const next = [...options];
        next[index] = value;
        node.quick_replies = normalizeFastReplyOptions(next);
        renderOptions();
        scheduleAutoSave();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost";
      remove.textContent = "x";
      remove.title = "Remover";
      remove.disabled = options.length <= 1;
      remove.addEventListener("click", () => {
        if (options.length <= 1) return;
        const next = options.filter((_, i) => i !== index);
        node.quick_replies = normalizeFastReplyOptions(next);
        renderOptions();
        scheduleAutoSave();
      });

      row.appendChild(input);
      row.appendChild(remove);
      list.appendChild(row);
    });

    addButton.disabled = options.length >= 3;
    rebuildOutputs(options);
  };

  loopInput.addEventListener("change", () => {
    node.loop_until_match = loopInput.checked;
    scheduleAutoSave();
  });

  addButton.addEventListener("click", () => {
    const current = normalizeFastReplyOptions(node.quick_replies);
    if (current.length >= 3) return;
    const next = [...current, `Opcao ${current.length + 1}`];
    node.quick_replies = normalizeFastReplyOptions(next);
    renderOptions();
    scheduleAutoSave();
  });

  renderOptions();

  body.appendChild(textarea);
  body.appendChild(loopWrap);
  body.appendChild(hint);
  body.appendChild(list);
  body.appendChild(addButton);

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderHumanServiceNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-message-link flow-node-human-service";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  appendMessageHeaderTitle(header, node, "Atendimento Humano");
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body flow-human-service-body";

  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Mensagem para o cliente";
  textarea.value = node.body || "";
  textarea.addEventListener("change", () => {
    node.body = textarea.value;
    scheduleAutoSave();
  });

  const hint = document.createElement("div");
  hint.className = "flow-fast-reply-hint";
  hint.textContent = "Saidas fixas: Quero um atendimento (sim) e Nao, obrigado (nao).";

  const buttonsPreview = document.createElement("div");
  buttonsPreview.className = "flow-human-buttons";

  const yesPreview = document.createElement("div");
  yesPreview.className = "flow-human-button yes";
  yesPreview.textContent = "Quero um atendimento";

  const noPreview = document.createElement("div");
  noPreview.className = "flow-human-button no";
  noPreview.textContent = "Nao, obrigado";

  buttonsPreview.appendChild(yesPreview);
  buttonsPreview.appendChild(noPreview);

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  const connectorOutYes = document.createElement("div");
  connectorOutYes.className = "connector out yes";
  connectorOutYes.title = "Quero um atendimento";
  connectorOutYes.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "yes";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorOutNo = document.createElement("div");
  connectorOutNo.className = "connector out no";
  connectorOutNo.title = "Nao, obrigado";
  connectorOutNo.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "no";
    clearLinking();
    el.classList.add("linking");
  });

  const yesLabel = document.createElement("span");
  yesLabel.className = "flow-branch-label yes";
  yesLabel.textContent = "Quero atendimento";

  const noLabel = document.createElement("span");
  noLabel.className = "flow-branch-label no";
  noLabel.textContent = "Nao, obrigado";

  body.appendChild(textarea);
  body.appendChild(hint);
  body.appendChild(buttonsPreview);

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOutYes);
  el.appendChild(connectorOutNo);
  el.appendChild(yesLabel);
  el.appendChild(noLabel);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}
function renderAudioMessageNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-message-link flow-node-message-audio";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  appendMessageHeaderTitle(header, node, "Mensagem de audio");
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body flow-audio-body";

  const sourceSelect = document.createElement("select");
  sourceSelect.innerHTML = `
    <option value="upload">Enviar audio</option>
    <option value="existing">Escolher existente</option>
  `;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Nome do audio";
  nameInput.value = node.audio_name || "";
  nameInput.addEventListener("change", () => {
    node.audio_name = nameInput.value;
    scheduleAutoSave();
  });

  const existingPanel = document.createElement("div");
  existingPanel.className = "flow-audio-existing";
  const existingSelect = document.createElement("select");
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "ghost";
  refreshButton.textContent = "Atualizar";

  const uploadPanel = document.createElement("div");
  uploadPanel.className = "flow-audio-upload";
  const pickButton = document.createElement("button");
  pickButton.type = "button";
  pickButton.textContent = "Selecionar arquivo";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "audio/*";
  fileInput.style.display = "none";
  const uploadHint = document.createElement("div");
  uploadHint.className = "flow-audio-hint";
  uploadHint.textContent = "Conversao para OGG/Opus obrigatoria antes do envio.";

  const status = document.createElement("div");
  status.className = "flow-audio-status";

  const preview = document.createElement("div");
  preview.className = "flow-audio-preview";
  const previewTitle = document.createElement("div");
  previewTitle.className = "flow-audio-preview-title";
  const audioEl = document.createElement("audio");
  audioEl.controls = true;
  audioEl.preload = "none";
  audioEl.style.width = "100%";
  const previewUrl = document.createElement("div");
  previewUrl.className = "flow-audio-preview-url";

  const existingMap = new Map();

  const setStatus = (text, mode = "info") => {
    status.textContent = text || "";
    status.dataset.mode = mode;
    status.style.display = text ? "block" : "none";
  };

  const updatePreview = () => {
    const currentUrl = String(node.audio_url || "").trim();
    const currentName = String(node.audio_name || "Audio").trim() || "Audio";
    previewTitle.textContent = currentName;
    previewUrl.textContent = currentUrl || "Sem audio selecionado";
    if (currentUrl) {
      audioEl.src = currentUrl;
      audioEl.style.display = "block";
    } else {
      audioEl.removeAttribute("src");
      audioEl.style.display = "none";
    }
  };

  const populateExistingOptions = () => {
    existingMap.clear();
    existingSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecione um audio";
    existingSelect.appendChild(placeholder);

    (audioLibraryCache || []).forEach((item) => {
      const id = String(item?.id || "");
      const url = String(item?.url || "");
      if (!id || !url) return;
      existingMap.set(id, item);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = String(item.name || "Audio");
      existingSelect.appendChild(option);
    });

    if (node.audio_id && existingMap.has(node.audio_id)) {
      existingSelect.value = node.audio_id;
    } else {
      existingSelect.value = "";
    }
  };

  const applyAssetToNode = (asset) => {
    node.audio_id = String(asset.id || "");
    node.audio_url = String(asset.url || "");
    node.audio_name = String(asset.name || node.audio_name || "Audio");
    node.audio_voice = Boolean(asset.voice_ready);
    node.audio_source = "existing";
    sourceSelect.value = "existing";
    nameInput.value = node.audio_name;
    populateExistingOptions();
    existingSelect.value = node.audio_id;
    updatePanels();
    updatePreview();
    scheduleAutoSave();
    saveFlow();
  };

  const updatePanels = () => {
    const mode = sourceSelect.value === "upload" ? "upload" : "existing";
    node.audio_source = mode;
    existingPanel.style.display = mode === "existing" ? "grid" : "none";
    uploadPanel.style.display = mode === "upload" ? "grid" : "none";
  };

  const refreshLibrary = async (force) => {
    try {
      setStatus("Carregando biblioteca de audio...", "info");
      await fetchAudioLibrary(force);
      populateExistingOptions();
      if (!audioLibraryCache.length) {
        setStatus("Nenhum audio na biblioteca ainda.", "warn");
      } else {
        setStatus("", "info");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao carregar biblioteca", "error");
    }
  };

  sourceSelect.value = node.audio_source === "upload" ? "upload" : "existing";
  sourceSelect.addEventListener("change", () => {
    updatePanels();
    scheduleAutoSave();
  });

  existingSelect.addEventListener("change", () => {
    const id = String(existingSelect.value || "");
    if (!id) {
      node.audio_id = "";
      node.audio_url = "";
      updatePreview();
      scheduleAutoSave();
      return;
    }
    const asset = existingMap.get(id);
    if (!asset) return;
    applyAssetToNode(asset);
    setStatus("Audio existente selecionado.", "ok");
  });

  refreshButton.addEventListener("click", () => {
    refreshLibrary(true);
  });

  pickButton.addEventListener("click", () => {
    fileInput.click();
  });

        fileInput.addEventListener("change", async () => {
    const picked = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!picked) return;
    if (Number(picked.size || 0) > MAX_AUDIO_UPLOAD_BYTES) {
      setStatus(`Arquivo muito grande: limite de ${Math.floor(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))}MB`, "error");
      fileInput.value = "";
      return;
    }

    try {
      const finalName = nameInput.value || picked.name || "Audio";

      setStatus("Convertendo para OGG/Opus...", "info");
      const converted = await convertToOggOpus(picked);

      if (!isVoiceReadyAudio(converted.name, converted.type)) {
        throw new Error("Conversao nao gerou OGG/Opus valido. Tente outro arquivo.");
      }

      setStatus("Enviando audio convertido para biblioteca...", "info");
      const asset = await uploadAudioAsset(converted, finalName);
      await refreshLibrary(true);
      applyAssetToNode(asset);
      setStatus("Audio convertido e enviado com sucesso.", "ok");
    } catch (err) {
      const detail = formatUnknownError(err);
      setStatus(`Conversao obrigatoria falhou: ${detail}`, "error");
      console.error("[botzap-audio-convert-required-error]", err);
    } finally {
      fileInput.value = "";
    }
  });

  existingPanel.appendChild(existingSelect);
  existingPanel.appendChild(refreshButton);

  uploadPanel.appendChild(pickButton);
  uploadPanel.appendChild(fileInput);
  uploadPanel.appendChild(uploadHint);

  preview.appendChild(previewTitle);
  preview.appendChild(audioEl);
  preview.appendChild(previewUrl);

  body.appendChild(sourceSelect);
  body.appendChild(nameInput);
  body.appendChild(existingPanel);
  body.appendChild(uploadPanel);
  body.appendChild(status);
  body.appendChild(preview);

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "default";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);

  updatePanels();
  updatePreview();
  populateExistingOptions();
  refreshLibrary(false);
}

function renderDelayNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-delay";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  const icon = document.createElement("span");
  icon.className = "flow-node-icon";
  icon.textContent = "D";
  const title = document.createElement("span");
  title.textContent = "Delay";
  header.appendChild(icon);
  header.appendChild(title);
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body flow-delay-body";
  const row = document.createElement("div");
  row.className = "flow-delay-row";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.value = String(normalizeDelayValue(node.delay_value || 1));

  const unit = document.createElement("select");
  unit.innerHTML = `
    <option value="seconds">Segundos</option>
    <option value="minutes">Minutos</option>
    <option value="hours">Horas</option>
  `;
  unit.value = normalizeDelayUnit(node.delay_unit || "seconds");

  const save = document.createElement("button");
  save.type = "button";
  save.className = "flow-delay-save";
  save.textContent = "Salvar";

  const summary = document.createElement("div");
  summary.className = "flow-delay-summary";

  const updateSummary = () => {
    summary.textContent = `Tempo atual: ${formatDelaySummary(input.value, unit.value)}`;
  };

  save.addEventListener("click", () => {
    node.delay_value = normalizeDelayValue(input.value);
    node.delay_unit = normalizeDelayUnit(unit.value);
    node.body = `Aguardar ${formatDelaySummary(node.delay_value, node.delay_unit)}`;
    input.value = String(node.delay_value);
    unit.value = node.delay_unit;
    updateSummary();
    scheduleAutoSave();
    saveFlow();
  });

  input.addEventListener("input", updateSummary);
  unit.addEventListener("change", updateSummary);
  updateSummary();

  row.appendChild(input);
  row.appendChild(unit);
  row.appendChild(save);
  body.appendChild(row);
  body.appendChild(summary);

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "default";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}

function renderImageMessageNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-message-link flow-node-message-image";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header";
  appendMessageHeaderTitle(header, node, "Mensagem com imagem + link");
  const deleteBtn = createDeleteButton(node);
  if (deleteBtn) header.appendChild(deleteBtn);

  const body = document.createElement("div");
  body.className = "flow-node-body";

  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "Legenda da imagem";
  textarea.value = node.body || "";
  textarea.addEventListener("change", () => {
    node.body = textarea.value;
    if (typeof updatePreview === "function") updatePreview();
    scheduleAutoSave();
  });

  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "URL final (com UTMs)";
  url.value = node.url || "";
  url.addEventListener("change", () => {
    node.url = url.value;
    if (typeof updatePreview === "function") updatePreview();
    scheduleAutoSave();
  });

  const linkMode = document.createElement("select");
  linkMode.innerHTML = `
    <option value="first">Link primeiro</option>
    <option value="last">Link por ultimo</option>
    <option value="only">Somente link</option>
  `;
  linkMode.value = node.linkMode || "first";
  linkMode.addEventListener("change", () => {
    node.linkMode = linkMode.value;
    scheduleAutoSave();
  });

  const linkFormat = document.createElement("select");
  linkFormat.innerHTML = `
    <option value="default">Link padrao</option>
    <option value="html">Forcar .html</option>
    <option value="jpg">Forcar .jpg</option>
  `;
  linkFormat.value = node.linkFormat || "default";
  linkFormat.addEventListener("change", () => {
    node.linkFormat = linkFormat.value;
    scheduleAutoSave();
  });

  const image = document.createElement("input");
  image.type = "url";
  image.placeholder = "URL da imagem (envio real)";
  image.value = node.image || "";

  let updatePreview = null;
  const preview = document.createElement("div");
  preview.className = "link-preview";
  const previewLabel = document.createElement("div");
  previewLabel.className = "link-preview-label";
  previewLabel.textContent = "Preview enviado";
  const card = document.createElement("div");
  card.className = "link-preview-card";
  const previewImage = document.createElement("img");
  previewImage.alt = "Preview";
  const previewPlaceholder = document.createElement("div");
  previewPlaceholder.className = "link-preview-placeholder";
  previewPlaceholder.textContent = "Sem imagem";
  const meta = document.createElement("div");
  meta.className = "link-preview-meta";
  const metaTitle = document.createElement("div");
  metaTitle.className = "link-preview-title";
  metaTitle.textContent = "Imagem enviada";
  const metaDesc = document.createElement("div");
  metaDesc.className = "link-preview-desc";
  const metaUrl = document.createElement("div");
  metaUrl.className = "link-preview-url";
  const metaNote = document.createElement("div");
  metaNote.className = "link-preview-note";
  metaNote.textContent = "Enviado como imagem (preview garantido)";
  meta.appendChild(metaTitle);
  meta.appendChild(metaDesc);
  meta.appendChild(metaUrl);
  meta.appendChild(metaNote);
  card.appendChild(previewImage);
  card.appendChild(previewPlaceholder);
  card.appendChild(meta);
  preview.appendChild(previewLabel);
  preview.appendChild(card);

  updatePreview = () => {
    const imageValue = (node.image || "").trim();
    const urlValue = (node.url || "").trim();
    const captionValue = (node.body || "").trim();
    metaDesc.textContent = captionValue ? captionValue : "Legenda da imagem";
    metaUrl.textContent = urlValue ? urlValue : "Sem link";
    if (imageValue) {
      previewImage.src = imageValue;
      previewImage.style.display = "block";
      previewPlaceholder.style.display = "none";
    } else {
      previewImage.removeAttribute("src");
      previewImage.style.display = "none";
      previewPlaceholder.style.display = "grid";
    }
  };

  image.addEventListener("change", () => {
    node.image = image.value;
    if (typeof updatePreview === "function") updatePreview();
    scheduleAutoSave();
  });

  updatePreview();

  body.appendChild(textarea);
  body.appendChild(url);
  const varsHint = document.createElement("div");
  varsHint.className = "flow-url-vars-hint";
  varsHint.textContent = "Parametros: {wa_id}, {bloco}, {fluxo}";
  body.appendChild(varsHint);
  body.appendChild(linkMode);
  body.appendChild(linkFormat);
  body.appendChild(image);
  body.appendChild(preview);

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    linkFromBranch = "default";
    clearLinking();
    el.classList.add("linking");
  });

  const connectorIn = document.createElement("div");
  connectorIn.className = "connector in";
  connectorIn.title = "Entrada";
  connectorIn.addEventListener("click", () => {
    if (!linkFromId || linkFromId === node.id) return;
    const branch = linkFromBranch || "default";
    const exists = state.edges.some(
      (edge) =>
        edge.from === linkFromId &&
        edge.to === node.id &&
        (edge.branch || "default") === branch,
    );
    if (!exists) {
      state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
      renderEdges();
      scheduleAutoSave();
    }
    linkFromId = null;
    resetLinking();
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  attachNodeInteractions(el, node);
  enableDrag(el, node);
}
function renderNodes() {
  if (!surface) return;
  const existing = surface.querySelectorAll(".flow-node");
  existing.forEach((node) => node.remove());

  messageBlockOrderCache = computeMessageBlockOrderMap();

  state.nodes.forEach((node) => {
    if (node.type === "start") {
      renderStartNode(node);
      return;
    }
    if (node.type === "tag") {
      const tagValue = String(node.body || node.action?.tag || "").trim();
      node.type = "action";
      node.title = "Acoes";
      node.body = "";
      node.action = { type: "tag", tag: tagValue };
    }
    if (node.type === "condition") {
      renderConditionNode(node);
      return;
    }
    if (node.type === "action") {
      renderActionNode(node);
      return;
    }
    if (node.type === "delay") {
      renderDelayNode(node);
      return;
    }
    if (node.type === "message_link" || node.type === "message_short") {
      renderLinkMessageNode(node);
      return;
    }
    if (node.type === "message_image") {
      renderImageMessageNode(node);
      return;
    }
    if (node.type === "message_fast_reply") {
      renderFastReplyMessageNode(node);
      return;
    }
    if (node.type === "human_service") {
      renderHumanServiceNode(node);
      return;
    }
    if (node.type === "message_audio") {
      renderAudioMessageNode(node);
      return;
    }
    const el = document.createElement("div");
    el.className = `flow-node flow-node-${node.type}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    const header = document.createElement("div");
    header.className = "flow-node-header";
    if (node.type === "message") {
      appendMessageHeaderTitle(header, node, "Mensagem Normal");
    } else {
      const title = document.createElement("input");
      title.type = "text";
      title.value = node.title || "Bloco";
      title.addEventListener("change", () => {
        node.title = title.value;
        scheduleAutoSave();
      });
      header.appendChild(title);
    }
    const deleteBtn = createDeleteButton(node);
    if (deleteBtn) header.appendChild(deleteBtn);

    const body = document.createElement("div");
    body.className = "flow-node-body";
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.value = node.body || "";
    textarea.addEventListener("change", () => {
      node.body = textarea.value;
      scheduleAutoSave();
    });
    body.appendChild(textarea);

    const connectorOut = document.createElement("div");
    connectorOut.className = "connector out";
    connectorOut.title = "Saida";
    connectorOut.addEventListener("click", () => {
      linkFromId = node.id;
      linkFromBranch = "default";
      clearLinking();
      el.classList.add("linking");
    });

    if (node.type !== "start") {
      const connectorIn = document.createElement("div");
      connectorIn.className = "connector in";
      connectorIn.title = "Entrada";
      connectorIn.addEventListener("click", () => {
        if (!linkFromId || linkFromId === node.id) return;
        const branch = linkFromBranch || "default";
        const exists = state.edges.some(
          (edge) =>
            edge.from === linkFromId &&
            edge.to === node.id &&
            (edge.branch || "default") === branch,
        );
        if (!exists) {
          state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id, branch });
          renderEdges();
          scheduleAutoSave();
        }
        linkFromId = null;
        resetLinking();
      });
      el.appendChild(connectorIn);
    }

    el.appendChild(header);
    el.appendChild(body);
    el.appendChild(connectorOut);
    surface.appendChild(el);

    enableDrag(el, node);
  });
}

function clearLinking() {
  const nodes = surface.querySelectorAll(".flow-node");
  nodes.forEach((node) => node.classList.remove("linking"));
}

function resetLinking() {
  clearLinking();
  linkFromBranch = null;
}

function enableDrag(element, node) {
  const header = element.querySelector(".flow-node-header");
  if (!header) return;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let frame = null;
  let latestX = 0;
  let latestY = 0;
  const onMove = (event) => {
    const zoom = state.zoom || 1;
    latestX = originX + (event.clientX - startX) / zoom;
    latestY = originY + (event.clientY - startY) / zoom;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      node.x = Math.min(SURFACE_WORLD_LIMIT, Math.max(-SURFACE_WORLD_LIMIT, latestX));
      node.y = Math.min(SURFACE_WORLD_LIMIT, Math.max(-SURFACE_WORLD_LIMIT, latestY));
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      renderEdges();
      renderMinimap();
    });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    ensureSurfaceSize();
    renderEdges();
    renderMinimap();
    scheduleAutoSave();
  };
  header.addEventListener("mousedown", (event) => {
    if (event.target.tagName === "INPUT" || event.target.tagName === "BUTTON") {
      return;
    }
    startX = event.clientX;
    startY = event.clientY;
    originX = node.x;
    originY = node.y;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function renderEdges() {
  if (!svg || !surface || !flowCanvas) return;
  svg.innerHTML = "";
  const zoom = state.zoom || 1;
  const canvasRect = flowCanvas.getBoundingClientRect();
  const cameraX = Number(state.cameraX || 0);
  const cameraY = Number(state.cameraY || 0);
  const segments = [];

  state.edges.forEach((edge) => {
    const branch = edge.branch || "default";
    let fromSelector = ".connector.out";
    if (branch === "yes") fromSelector = ".connector.out.yes";
    if (branch === "no") fromSelector = ".connector.out.no";
    if (/^fr_\d+$/i.test(String(branch))) fromSelector = `.connector.out.${branch}`;
    const fromEl = surface.querySelector(`[data-node-id="${edge.from}"] ${fromSelector}`);
    const toEl = surface.querySelector(`[data-node-id="${edge.to}"] .connector.in`);
    if (!fromEl || !toEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const x1 = (fromRect.left - canvasRect.left - cameraX + fromRect.width / 2) / zoom;
    const y1 = (fromRect.top - canvasRect.top - cameraY + fromRect.height / 2) / zoom;
    const x2 = (toRect.left - canvasRect.left - cameraX + toRect.width / 2) / zoom;
    const y2 = (toRect.top - canvasRect.top - cameraY + toRect.height / 2) / zoom;
    segments.push({ edge, branch, x1, y1, x2, y2 });
  });

  if (!segments.length) {
    svg.style.left = "0px";
    svg.style.top = "0px";
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    svg.setAttribute("viewBox", "0 0 1 1");
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  segments.forEach((seg) => {
    minX = Math.min(minX, seg.x1, seg.x2);
    minY = Math.min(minY, seg.y1, seg.y2);
    maxX = Math.max(maxX, seg.x1, seg.x2);
    maxY = Math.max(maxY, seg.y1, seg.y2);
  });

  minX -= 240;
  minY -= 240;
  maxX += 240;
  maxY += 240;
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));

  svg.style.left = `${minX}px`;
  svg.style.top = `${minY}px`;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  segments.forEach((seg) => {
    const x1 = seg.x1 - minX;
    const y1 = seg.y1 - minY;
    const x2 = seg.x2 - minX;
    const y2 = seg.y2 - minY;
    const dx = Math.max(60, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    const edgeClass =
      seg.branch === "no"
        ? "flow-edge edge-no energy"
        : seg.branch === "yes"
          ? "flow-edge edge-yes energy"
          : "flow-edge energy";
    path.setAttribute("class", edgeClass);
    path.dataset.edgeId = seg.edge.id;
    path.addEventListener("click", () => {
      state.edges = state.edges.filter((e) => e.id !== seg.edge.id);
      renderEdges();
      renderMinimap();
      scheduleAutoSave();
    });
    svg.appendChild(path);
  });
}

function renderAll() {
  if (selectedNodeId && !state.nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = null;
  }
  ensureSurfaceSize();
  renderTags();
  renderNodes();
  syncSelectedNodes();
  renderEdges();
  renderMinimap();
}

function addBlockAt(type, x, y) {
  const preset = blockPresets[type] || { title: "Bloco", body: "" };
  const node = {
    id: makeId("node"),
    type,
    title: preset.title,
    body: preset.body,
    x: Math.min(SURFACE_WORLD_LIMIT, Math.max(-SURFACE_WORLD_LIMIT, x)),
    y: Math.min(SURFACE_WORLD_LIMIT, Math.max(-SURFACE_WORLD_LIMIT, y)),
    tags: [],
  };
  if (type === "start") {
    node.trigger = "";
  }
  if (type === "condition") {
    node.rules = [];
  }
  if (type === "delay") {
    node.delay_value = 1;
    node.delay_unit = "seconds";
    node.body = "Aguardar 1 segundo";
  }
  if (type === "action") {
    node.action = null;
    node.tags = [];
  }
  if (type === "message_link" || type === "message_short" || type === "message_image") {
    node.url = "";
  }
  if (type === "message_short" || type === "message_image") {
    node.image = "";
  }
  if (type === "message_link" || type === "message_short" || type === "message_image") {
    node.linkMode = "first";
  }
  if (type === "message_short" || type === "message_image") {
    node.linkFormat = "default";
  }
  if (type === "message_audio") {
    node.audio_source = "existing";
    node.audio_id = "";
    node.audio_url = "";
    node.audio_name = "";
    node.audio_voice = true;
  }
  if (type === "message_fast_reply") {
    node.quick_replies = normalizeFastReplyOptions(node.quick_replies);
    node.body = typeof node.body === "string" && node.body.trim() ? node.body : "Escolha uma opcao:";
    node.loop_until_match = false;
  }
  if (type === "human_service") {
    node.body = typeof node.body === "string" && node.body.trim() ? node.body : "Deseja falar com um atendente?";
  }
  state.nodes.push(node);
  setSelectedNode(node.id);
  renderAll();
  scheduleAutoSave();
}

function addBlock(type) {
  addBlockAt(type, 160 + state.nodes.length * 40, 140 + state.nodes.length * 20);
}

function getBlockPickerCoordinates() {
  if (!blockPicker) return { x: 160, y: 140 };
  return {
    x: Number(blockPicker.dataset.nodeX || "160"),
    y: Number(blockPicker.dataset.nodeY || "140"),
  };
}

function renderBlockPickerView(view) {
  if (!blockPicker) return;
  const nextView = view === "messages" ? "messages" : "root";
  blockPicker.dataset.view = nextView;
  blockPicker.innerHTML = "";

  const addOptionButton = (option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      const coords = getBlockPickerCoordinates();
      addBlockAt(option.type, coords.x, coords.y);
      closeBlockPicker();
    });
    blockPicker.appendChild(button);
  };

  if (nextView === "messages") {
    const header = document.createElement("div");
    header.className = "block-picker-header";

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "ghost block-picker-back";
    backButton.textContent = "Voltar";
    backButton.addEventListener("click", () => {
      renderBlockPickerView("root");
    });

    const title = document.createElement("span");
    title.className = "block-picker-title";
    title.textContent = "Tipos de Mensagens";

    header.appendChild(backButton);
    header.appendChild(title);
    blockPicker.appendChild(header);

    messageBlockOptions.forEach(addOptionButton);
    return;
  }

  blockOptions.forEach((option) => {
    if (option.kind === "group" && option.type === "message_types") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "block-picker-group";
      button.textContent = `${option.label} >`;
      button.addEventListener("click", () => {
        renderBlockPickerView("messages");
      });
      blockPicker.appendChild(button);
      return;
    }
    addOptionButton(option);
  });
}

function buildBlockPicker() {
  if (!blockPicker) return;
  renderBlockPickerView("root");
}

function openBlockPicker(rawX, rawY, nodeX, nodeY) {
  if (!blockPicker) return;
  blockPicker.dataset.nodeX = String(nodeX);
  blockPicker.dataset.nodeY = String(nodeY);
  renderBlockPickerView("root");
  blockPicker.style.left = `${rawX}px`;
  blockPicker.style.top = `${rawY}px`;
  blockPicker.classList.add("open");
  blockPicker.setAttribute("aria-hidden", "false");
}

function closeBlockPicker() {
  if (!blockPicker) return;
  blockPicker.classList.remove("open");
  blockPicker.setAttribute("aria-hidden", "true");
}

function enablePan() {
  if (!flowCanvas) return;
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let originCameraX = 0;
  let originCameraY = 0;
  let frame = null;
  let latestCameraX = 0;
  let latestCameraY = 0;

  const onMove = (event) => {
    if (!isPanning) return;
    latestCameraX = originCameraX + (event.clientX - startX);
    latestCameraY = originCameraY + (event.clientY - startY);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      state.cameraX = latestCameraX;
      state.cameraY = latestCameraY;
      applyZoom();
    });
  };

  const onUp = () => {
    if (!isPanning) return;
    isPanning = false;
    flowCanvas.classList.remove("panning");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    scheduleAutoSave();
  };

  const canStartPan = (event) => {
    if (event.target.closest(PAN_IGNORE_SELECTOR)) return false;
    if (event.button === 1) return true;
    if (event.button === 0 && panReady) return true;
    return false;
  };

  flowCanvas.addEventListener("mousedown", (event) => {
    if (!canStartPan(event)) return;
    isPanning = true;
    startX = event.clientX;
    startY = event.clientY;
    originCameraX = Number(state.cameraX || 0);
    originCameraY = Number(state.cameraY || 0);
    flowCanvas.classList.add("panning");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    event.preventDefault();
  });
}

function exportJson() {
const payload = {
    id: state.flowId,
    name: state.flowName,
    updatedAt: Date.now(),
    data: {
      nodes: state.nodes,
      edges: state.edges,
      tags: state.tags,
      zoom: state.zoom,
      cameraX: state.cameraX,
      cameraY: state.cameraY,
    },
  };
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `botzap-flow-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "include",
      });
    } finally {
      window.location.href = "/";
    }
  });
}

if (flowCanvas) {
  flowCanvas.addEventListener("dblclick", (event) => {
    if (event.target.closest(".flow-node")) return;
    if (event.target.closest(".flow-zoom")) return;
    if (event.target.closest(".flow-minimap")) return;
    if (event.target.closest(".block-picker")) return;
    const rect = flowCanvas.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const zoom = state.zoom || 1;
    const nodeX = (rawX - Number(state.cameraX || 0)) / zoom;
    const nodeY = (rawY - Number(state.cameraY || 0)) / zoom;
    openBlockPicker(rawX, rawY, nodeX, nodeY);
  });

  flowCanvas.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = flowCanvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const prevZoom = state.zoom || 1;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = clampZoom(prevZoom + direction * ZOOM_STEP);
    if (nextZoom === prevZoom) return;
    const worldX = (localX - Number(state.cameraX || 0)) / prevZoom;
    const worldY = (localY - Number(state.cameraY || 0)) / prevZoom;
    state.zoom = nextZoom;
    state.cameraX = localX - worldX * nextZoom;
    state.cameraY = localY - worldY * nextZoom;
    applyZoom();
    scheduleAutoSave();
  }, { passive: false });
}

if (saveButton) {
  saveButton.addEventListener("click", () => {
    saveFlow();
  });
}

if (exportButton) {
  exportButton.addEventListener("click", exportJson);
}

if (resetButton) {
  resetButton.addEventListener("click", () => {
    const seeded = defaultData();
    state.nodes = seeded.nodes;
    state.edges = seeded.edges;
    state.tags = seeded.tags;
    renderAll();
    saveFlow();
  });
}

if (flowNameInput) {
  flowNameInput.addEventListener("change", () => {
    state.flowName = flowNameInput.value.trim() || "Fluxo sem nome";
    saveFlow();
  });
}

if (zoomInButton) {
  zoomInButton.addEventListener("click", () => {
    state.zoom = clampZoom((state.zoom || 1) + ZOOM_STEP);
    applyZoom();
    scheduleAutoSave();
  });
}

if (zoomOutButton) {
  zoomOutButton.addEventListener("click", () => {
    state.zoom = clampZoom((state.zoom || 1) - ZOOM_STEP);
    applyZoom();
    scheduleAutoSave();
  });
}

if (zoomResetButton) {
  zoomResetButton.addEventListener("click", () => {
    state.zoom = 1;
    applyZoom();
    scheduleAutoSave();
  });
}

window.addEventListener("resize", () => {
  renderEdges();
  renderMinimap();
});
document.addEventListener("click", (event) => {
  if (!blockPicker || !blockPicker.classList.contains("open")) return;
  if (blockPicker.contains(event.target)) return;
  closeBlockPicker();
});

document.addEventListener("mousedown", (event) => {
  if (!flowCanvas) return;
  if (event.button !== 0) return;
  if (!flowCanvas.contains(event.target)) return;
  if (event.target.closest(".flow-node")) return;
  if (event.target.closest(".block-picker")) return;
  if (event.target.closest(".flow-minimap")) return;
  setSelectedNode(null);
});

document.addEventListener("click", (event) => {
  const popup = event.target.closest(".condition-popup");
  if (popup) return;
  document.querySelectorAll(".condition-popup.open").forEach((node) => {
    node.classList.remove("open");
  });
});

document.addEventListener("click", (event) => {
  const popup = event.target.closest(".action-popup");
  if (popup) return;
  document.querySelectorAll(".action-popup.open").forEach((node) => {
    node.classList.remove("open");
  });
});

ensureSession().then(async (ok) => {
  if (ok && (await loadFlow())) {
    buildBlockPicker();
    renderAll();
    initMinimapInteractions();
    applyZoom();
    enablePan();
  }
});

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  const isTyping = Boolean(
    active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable),
  );

  if ((event.key === "Delete" || event.code === "Delete") && !isTyping && selectedNodeId) {
    event.preventDefault();
    removeNodeById(selectedNodeId);
    return;
  }

  if (event.code === "Space") {
    panReady = true;
    if (flowCanvas) flowCanvas.classList.add("pan-ready");
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    panReady = false;
    if (flowCanvas) flowCanvas.classList.remove("pan-ready");
  }
});


