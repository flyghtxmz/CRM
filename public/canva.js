const logoutButton = document.getElementById("logout");
const blockButtons = document.querySelectorAll(".block-btn");
const tagForm = document.getElementById("tag-form");
const tagInput = document.getElementById("tag-input");
const tagList = document.getElementById("tag-list");
const saveButton = document.getElementById("save-flow");
const exportButton = document.getElementById("export-flow");
const resetButton = document.getElementById("reset-flow");
const surface = document.getElementById("flow-surface");
const svg = document.getElementById("flow-links");
const flowNameInput = document.getElementById("flow-name");

const FLOW_STORAGE_KEY = "botzap_flows_v1";
const AUTO_SAVE_MS = 5000;

let state = {
  flowId: null,
  flowName: "",
  nodes: [],
  edges: [],
  tags: [],
};

let linkFromId = null;
let autoSaveTimer = null;

const blockPresets = {
  start: { title: "Inicio", body: "Entrada do fluxo" },
  message: { title: "Mensagem", body: "Texto da mensagem" },
  question: { title: "Pergunta", body: "Pergunta para o cliente" },
  tag: { title: "Tag", body: "Aplicar tag" },
  delay: { title: "Delay", body: "Esperar" },
  condition: { title: "Condicao", body: "Se / Entao" },
};

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
        title: "Inicio",
        body: "Mensagem recebida",
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
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };

  if (!state.nodes.length) {
    const seeded = defaultData();
    state.nodes = seeded.nodes;
    state.edges = seeded.edges;
    state.tags = seeded.tags;
  }

  if (flowNameInput) {
    flowNameInput.value = state.flowName;
  }

  return true;
}

function saveFlow() {
  if (!state.flowId) return;
  const flows = loadFlows();
  const idx = flows.findIndex((item) => item.id === state.flowId);
  const payload = {
    id: state.flowId,
    name: state.flowName || "Fluxo sem nome",
    updatedAt: Date.now(),
    data: {
      nodes: state.nodes,
      edges: state.edges,
      tags: state.tags,
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

function renderTags() {
  if (!tagList) return;
  tagList.innerHTML = "";
  if (!state.tags.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Nenhuma tag criada.";
    tagList.appendChild(empty);
    return;
  }
  state.tags.forEach((tag) => {
    const item = document.createElement("div");
    item.className = "tag-item";
    const span = document.createElement("span");
    span.textContent = tag;
    item.appendChild(span);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "x";
    btn.addEventListener("click", () => {
      state.tags = state.tags.filter((t) => t !== tag);
      state.nodes.forEach((node) => {
        node.tags = (node.tags || []).filter((t) => t !== tag);
      });
      renderAll();
      scheduleAutoSave();
    });
    item.appendChild(btn);
    tagList.appendChild(item);
  });
}

function renderNodes() {
  if (!surface) return;
  const existing = surface.querySelectorAll(".flow-node");
  existing.forEach((node) => node.remove());

  state.nodes.forEach((node) => {
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
    tagRow.appendChild(select);
    tagRow.appendChild(addBtn);
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
    el.appendChild(connectorIn);
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
  const onMove = (event) => {
    const x = originX + (event.clientX - startX);
    const y = originY + (event.clientY - startY);
    node.x = Math.max(24, x);
    node.y = Math.max(24, y);
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    renderEdges();
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

function addBlock(type) {
  const preset = blockPresets[type] || { title: "Bloco", body: "" };
  const node = {
    id: makeId("node"),
    type,
    title: preset.title,
    body: preset.body,
    x: 160 + state.nodes.length * 40,
    y: 140 + state.nodes.length * 20,
    tags: [],
  };
  state.nodes.push(node);
  renderAll();
  scheduleAutoSave();
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

blockButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.block;
    addBlock(type);
  });
});

if (tagForm) {
  tagForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (tagInput?.value || "").trim();
    if (!value) return;
    if (!state.tags.includes(value)) {
      state.tags.push(value);
      renderAll();
      scheduleAutoSave();
    }
    if (tagInput) tagInput.value = "";
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

window.addEventListener("resize", renderEdges);

ensureSession().then((ok) => {
  if (ok && loadFlow()) {
    renderAll();
  }
});
