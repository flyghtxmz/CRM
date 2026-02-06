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
const PAN_IGNORE_SELECTOR = ".flow-node, .flow-zoom, .block-picker";
let panReady = false;

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
let linkFromBranch = null;
let autoSaveTimer = null;

const blockPresets = {
  start: { title: "Quando", body: "" },
  message: { title: "Mensagem", body: "Texto da mensagem" },
  message_link: { title: "Mensagem com link", body: "Texto da mensagem", url: "" },
  message_short: { title: "Mensagem com link curto", body: "Texto da mensagem", url: "" },
  message_image: { title: "Mensagem com imagem + link", body: "Legenda da imagem", url: "", image: "" },
  question: { title: "Pergunta", body: "Pergunta para o cliente" },
  tag: { title: "Tag", body: "Aplicar tag" },
  delay: { title: "Delay", body: "Esperar" },
  condition: { title: "Condicao", body: "" },
  action: { title: "Acoes", body: "" },
};

const blockOptions = [
  { type: "start", label: "Quando" },
  { type: "message", label: "Mensagem" },
  { type: "message_link", label: "Mensagem com link" },
  { type: "message_short", label: "Mensagem com link curto" },
  { type: "message_image", label: "Mensagem com imagem + link" },
  { type: "question", label: "Pergunta" },
  { type: "tag", label: "Tag" },
  { type: "delay", label: "Delay" },
  { type: "condition", label: "Condicao" },
  { type: "action", label: "Acoes" },
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
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    edges: Array.isArray(data.edges) ? data.edges : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };

  state.nodes.forEach((node) => {
    if (node.type === "start" && typeof node.trigger !== "string") {
      node.trigger = "";
    }
    if (node.type === "condition") {
      const rawRules = Array.isArray(node.rules) ? node.rules : [];
      const normalized = rawRules.map(normalizeRule).filter(Boolean);
      node.rules = normalized.length ? [normalized[0]] : [];
    }
    if ((node.type === "message_short" || node.type === "message_image") && typeof node.image !== "string") {
      node.image = "";
    }
    if (node.type === "action") {
      if (node.action && typeof node.action === "object") return;
      if (typeof node.action === "string" && node.action.trim()) {
        node.action = { type: "text", label: node.action.trim() };
      } else {
        node.action = null;
      }
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
  return rule.label || "";
}

function formatAction(action) {
  if (!action) return "";
  if (action.type === "tag") {
    return `Adicionar tag: ${action.tag || ""}`.trim();
  }
  return action.label || "";
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
  enableDrag(el, node);
}

function renderConditionNode(node) {
  if (!surface) return;
  const el = document.createElement("div");
  el.className = "flow-node flow-node-condition";
  el.dataset.nodeId = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;

  const header = document.createElement("div");
  header.className = "flow-node-header flow-condition-header";
  const icon = document.createElement("span");
  icon.className = "flow-node-icon";
  icon.textContent = "C";
  const title = document.createElement("span");
  title.textContent = "Condicao";
  header.appendChild(icon);
  header.appendChild(title);

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

  popup.appendChild(popupHeader);
  popup.appendChild(rootView);
  popup.appendChild(tagView);
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
    renderTagList();
    popup.dataset.view = "tag";
  });
  rootView.appendChild(tagOption);

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
  createTag.addEventListener("click", () => {
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
      item.className = "action-tag-item";
      item.textContent = tag;
      item.addEventListener("click", () => {
        node.action = { type: "tag", tag };
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

  popup.appendChild(popupHeader);
  popup.appendChild(rootView);
  popup.appendChild(tagView);
  body.appendChild(popup);

  const openPopup = (event) => {
    if (event) event.stopPropagation();
    popup.dataset.view = "root";
    popup.classList.add("open");
  };
  placeholder.addEventListener("click", openPopup);

  const footer = document.createElement("div");
  footer.className = "flow-node-footer";
  footer.textContent = "Proximo Passo";

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
  el.appendChild(connectorIn);
  el.appendChild(connectorOut);
  surface.appendChild(el);
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
  const title = document.createElement("input");
  title.type = "text";
  title.value = node.title || (isShort ? "Mensagem com link curto" : "Mensagem com link");
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
  if (isShort) {
    const image = document.createElement("input");
    image.type = "url";
    image.placeholder = "URL da imagem (preview)";
    image.value = node.image || "";

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
  const title = document.createElement("input");
  title.type = "text";
  title.value = node.title || "Mensagem com imagem + link";
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
    if (node.type === "condition") {
      renderConditionNode(node);
      return;
    }
    if (node.type === "action") {
      renderActionNode(node);
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
  const zoom = state.zoom || 1;
  const width = Math.max(surface.scrollWidth, surface.clientWidth) / zoom;
  const height = Math.max(surface.scrollHeight, surface.clientHeight) / zoom;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const rect = surface.getBoundingClientRect();

  state.edges.forEach((edge) => {
    const branch = edge.branch || "default";
    let fromSelector = ".connector.out";
    if (branch === "yes") fromSelector = ".connector.out.yes";
    if (branch === "no") fromSelector = ".connector.out.no";
    const fromEl = surface.querySelector(`[data-node-id="${edge.from}"] ${fromSelector}`);
    const toEl = surface.querySelector(`[data-node-id="${edge.to}"] .connector.in`);
    if (!fromEl || !toEl) return;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const x1 = (fromRect.left - rect.left + fromRect.width / 2) / zoom;
    const y1 = (fromRect.top - rect.top + fromRect.height / 2) / zoom;
    const x2 = (toRect.left - rect.left + toRect.width / 2) / zoom;
    const y2 = (toRect.top - rect.top + toRect.height / 2) / zoom;
    const dx = Math.max(60, Math.abs(x2 - x1) / 2);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    );
    const edgeClass =
      branch === "no"
        ? "flow-edge edge-no energy"
        : branch === "yes"
          ? "flow-edge edge-yes energy"
          : "flow-edge energy";
    path.setAttribute("class", edgeClass);
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
  if (type === "condition") {
    node.rules = [];
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

function enablePan() {
  if (!flowCanvas) return;
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onMove = (event) => {
    if (!isPanning) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    flowCanvas.scrollLeft = originLeft - dx;
    flowCanvas.scrollTop = originTop - dy;
  };

  const onUp = () => {
    if (!isPanning) return;
    isPanning = false;
    flowCanvas.classList.remove("panning");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
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
    originLeft = flowCanvas.scrollLeft;
    originTop = flowCanvas.scrollTop;
    flowCanvas.classList.add("panning");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
    enablePan();
  }
});

document.addEventListener("keydown", (event) => {
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








