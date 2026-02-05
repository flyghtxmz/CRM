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

const FLOW_STORAGE_KEY = "botzap_flows_v1";
const AUTO_SAVE_MS = 5000;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

let state = {
  flowId: null,
  flowName: "",
  zoom: 1,
  nodes: [],
  edges: [],
  tags: [],
};

let linkFromId = null;
let autoSaveTimer = null;

const blockPresets = {
  start: { title: "Quando", body: "" },
  message: { title: "Mensagem", body: "Texto da mensagem" },
  question: { title: "Pergunta", body: "Pergunta para o cliente" },
  tag: { title: "Tag", body: "Aplicar tag" },
  delay: { title: "Delay", body: "Esperar" },
  condition: { title: "Condicao", body: "Se / Entao" },
};

const blockOptions = [
  { type: "start", label: "Quando" },
  { type: "message", label: "Mensagem" },
  { type: "question", label: "Pergunta" },
  { type: "tag", label: "Tag" },
  { type: "delay", label: "Delay" },
  { type: "condition", label: "Condicao" },
];

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

function loadFlows() {
  const raw = localStorage.getItem(FLOW_STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
  } catch {
    // ignore
  }
  return [];
}

function saveFlows(flows) {
  localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flows));
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

function loadFlow() {
  const flowId = new URLSearchParams(window.location.search).get("id");
  if (!flowId) {
    window.location.href = "/flows.html";
    return false;
  }

  const flows = loadFlows();
  const flow = flows.find((item) => item.id === flowId);
  if (!flow) {
    window.location.href = "/flows.html";
    return false;
  }

  const data = flow.data || {};
  state = {
    flowId: flow.id,
    flowName: flow.name || "Fluxo sem nome",
    zoom: typeof data.zoom === "number" ? data.zoom : 1,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };

  state.nodes.forEach((node) => {
    if (node.type === "start" && typeof node.trigger !== "string") {
      node.trigger = "";
    }
  });

  if (!state.nodes.length) {
    const seeded = defaultData();
    state.nodes = seeded.nodes;
    state.edges = seeded.edges;
    state.tags = seeded.tags;
  }

  if (flowNameInput) {
    flowNameInput.value = state.flowName;
  }
  applyZoom();

  return true;
}

function saveFlow() {
  if (!state.flowId) return;
  const flows = loadFlows();
  const idx = flows.findIndex((item) => item.id === state.flowId);
  const existing = idx >= 0 ? flows[idx] : null;
  const payload = {
    id: state.flowId,
    name: state.flowName || "Fluxo sem nome",
    enabled: existing?.enabled ?? true,
    updatedAt: Date.now(),
    data: {
      nodes: state.nodes,
      edges: state.edges,
      tags: state.tags,
      zoom: state.zoom,
    },
  };
  if (idx >= 0) {
    flows[idx] = payload;
  } else {
    flows.unshift(payload);
  }
  saveFlows(flows);
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveFlow, AUTO_SAVE_MS);
}

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function applyZoom() {
  if (!surface) return;
  const value = clampZoom(state.zoom || 1);
  state.zoom = value;
  surface.style.zoom = String(value);
  if (zoomValue) {
    zoomValue.textContent = `${Math.round(value * 100)}%`;
  }
  renderEdges();
}

function renderTags() {
  return;
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
  icon.textContent = "⚡";
  const title = document.createElement("span");
  title.className = "flow-start-title";
  title.textContent = "Quando...";
  header.appendChild(icon);
  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "flow-start-body";
  const desc = document.createElement("p");
  desc.textContent =
    "O gatilho é responsável por acionar a automação. Clique para adicionar um gatilho.";
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
  option.textContent = "Quando usuário enviar mensagem";
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
  footer.textContent = "Então";

  const connectorOut = document.createElement("div");
  connectorOut.className = "connector out";
  connectorOut.title = "Saida";
  connectorOut.addEventListener("click", () => {
    linkFromId = node.id;
    clearLinking();
    el.classList.add("linking");
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(footer);
  el.appendChild(connectorOut);
  surface.appendChild(el);
  enableDrag(el, node);
}

function renderNodes() {
  if (!surface) return;
  const existing = surface.querySelectorAll(".flow-node");
  existing.forEach((node) => node.remove());

  state.nodes.forEach((node) => {
    if (node.type === "start") {
      renderStartNode(node);
      return;
    }
    const el = document.createElement("div");
    el.className = `flow-node flow-node-${node.type}`;
    el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    const header = document.createElement("div");
    header.className = "flow-node-header";
    const title = document.createElement("input");
    title.type = "text";
    title.value = node.title || "Bloco";
    title.addEventListener("change", () => {
      node.title = title.value;
      scheduleAutoSave();
    });
    header.appendChild(title);
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => {
      state.nodes = state.nodes.filter((n) => n.id !== node.id);
      state.edges = state.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
      renderAll();
      scheduleAutoSave();
    });
    header.appendChild(deleteBtn);

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

    const tagRow = document.createElement("div");
    tagRow.className = "flow-tag-row";
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Adicionar tag";
    select.appendChild(placeholder);
    state.tags.forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      select.appendChild(opt);
    });
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Adicionar";
    addBtn.addEventListener("click", () => {
      const value = select.value;
      if (!value) return;
      node.tags = Array.isArray(node.tags) ? node.tags : [];
      if (!node.tags.includes(value)) {
        node.tags.push(value);
        renderAll();
        scheduleAutoSave();
      }
      select.value = "";
    });
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "ghost";
    createBtn.textContent = "Nova tag";
    createBtn.addEventListener("click", () => {
      const value = window.prompt("Nome da nova tag");
      if (!value) return;
      const name = value.trim();
      if (!name) return;
      if (!state.tags.includes(name)) {
        state.tags.push(name);
      }
      node.tags = Array.isArray(node.tags) ? node.tags : [];
      if (!node.tags.includes(name)) {
        node.tags.push(name);
      }
      renderAll();
      scheduleAutoSave();
    });
    tagRow.appendChild(select);
    tagRow.appendChild(addBtn);
    tagRow.appendChild(createBtn);
    body.appendChild(tagRow);

    const tagChips = document.createElement("div");
    tagChips.className = "tag-chips";
    (node.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        node.tags = (node.tags || []).filter((t) => t !== tag);
        renderAll();
        scheduleAutoSave();
      });
      tagChips.appendChild(chip);
    });
    body.appendChild(tagChips);

    const connectorOut = document.createElement("div");
    connectorOut.className = "connector out";
    connectorOut.title = "Saida";
    connectorOut.addEventListener("click", () => {
      linkFromId = node.id;
      clearLinking();
      el.classList.add("linking");
    });

    if (node.type !== "start") {
      const connectorIn = document.createElement("div");
      connectorIn.className = "connector in";
      connectorIn.title = "Entrada";
      connectorIn.addEventListener("click", () => {
        if (!linkFromId || linkFromId === node.id) return;
        const exists = state.edges.some((edge) => edge.from === linkFromId && edge.to === node.id);
        if (!exists) {
          state.edges.push({ id: makeId("edge"), from: linkFromId, to: node.id });
          renderEdges();
          scheduleAutoSave();
        }
        linkFromId = null;
        clearLinking();
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
    latestX = originX + (event.clientX - startX);
    latestY = originY + (event.clientY - startY);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      node.x = Math.max(24, latestX);
      node.y = Math.max(24, latestY);
      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;
      renderEdges();
    });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
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
  if (!svg || !surface) return;
  svg.innerHTML = "";
  const rect = surface.getBoundingClientRect();
  const width = Math.max(surface.scrollWidth, surface.clientWidth);
  const height = Math.max(surface.scrollHeight, surface.clientHeight);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  state.edges.forEach((edge) => {
    const fromEl = surface.querySelector(`[data-node-id="${edge.from}"] .connector.out`);
    const toEl = surface.querySelector(`[data-node-id="${edge.to}"] .connector.in`);
    if (!fromEl || !toEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const x1 = fromRect.left - rect.left + fromRect.width / 2;
    const y1 = fromRect.top - rect.top + fromRect.height / 2;
    const x2 = toRect.left - rect.left + toRect.width / 2;
    const y2 = toRect.top - rect.top + toRect.height / 2;
    const dx = Math.max(60, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    );
    path.setAttribute("class", "flow-edge");
    path.dataset.edgeId = edge.id;
    path.addEventListener("click", () => {
      state.edges = state.edges.filter((e) => e.id !== edge.id);
      renderEdges();
      scheduleAutoSave();
    });
    svg.appendChild(path);
  });
}

function renderAll() {
  renderTags();
  renderNodes();
  renderEdges();
}

function addBlockAt(type, x, y) {
  const preset = blockPresets[type] || { title: "Bloco", body: "" };
  const node = {
    id: makeId("node"),
    type,
    title: preset.title,
    body: preset.body,
    x: Math.max(24, x),
    y: Math.max(24, y),
    tags: [],
  };
  if (type === "start") {
    node.trigger = "";
  }
  state.nodes.push(node);
  renderAll();
  scheduleAutoSave();
}

function addBlock(type) {
  addBlockAt(type, 160 + state.nodes.length * 40, 140 + state.nodes.length * 20);
}

function buildBlockPicker() {
  if (!blockPicker) return;
  blockPicker.innerHTML = "";
  blockOptions.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      const x = Number(blockPicker.dataset.nodeX || "160");
      const y = Number(blockPicker.dataset.nodeY || "140");
      addBlockAt(option.type, x, y);
      closeBlockPicker();
    });
    blockPicker.appendChild(button);
  });
}

function openBlockPicker(rawX, rawY, nodeX, nodeY) {
  if (!blockPicker) return;
  blockPicker.dataset.nodeX = String(nodeX);
  blockPicker.dataset.nodeY = String(nodeY);
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
    if (event.target.closest(".block-picker")) return;
    const rect = flowCanvas.getBoundingClientRect();
    const rawX = event.clientX - rect.left + flowCanvas.scrollLeft;
    const rawY = event.clientY - rect.top + flowCanvas.scrollTop;
    const zoom = state.zoom || 1;
    const nodeX = rawX / zoom;
    const nodeY = rawY / zoom;
    openBlockPicker(rawX, rawY, nodeX, nodeY);
  });
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

window.addEventListener("resize", renderEdges);
document.addEventListener("click", (event) => {
  if (!blockPicker || !blockPicker.classList.contains("open")) return;
  if (blockPicker.contains(event.target)) return;
  closeBlockPicker();
});

ensureSession().then((ok) => {
  if (ok && loadFlow()) {
    buildBlockPicker();
    renderAll();
  }
});
