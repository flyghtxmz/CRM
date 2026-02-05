const logoutButton = document.getElementById("logout");
const createButton = document.getElementById("create-flow");
const listEl = document.getElementById("flow-list");

const STORAGE_KEY = "botzap_flows_v1";
const LEGACY_KEY = "botzap_flow_state_v1";

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

function loadLocalFlows() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
  } catch {
    // ignore
  }
  return [];
}

function loadLegacyFlow() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      id: makeId("flow"),
      name: "Fluxo importado",
      enabled: true,
      updatedAt: Date.now(),
      data: {
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
      },
    };
  } catch {
    return null;
  }
}

async function fetchFlows() {
  const res = await fetch("/api/flows", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !data.ok) return [];
  return Array.isArray(data.data) ? data.data : [];
}

async function saveFlow(flow) {
  const res = await fetch("/api/flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(flow),
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.ok) return null;
  return data.data || null;
}

async function deleteFlow(id) {
  const res = await fetch(`/api/flows?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data?.ok;
}

async function migrateLegacy(serverFlows) {
  if (serverFlows.length) return serverFlows;
  const localFlows = loadLocalFlows();
  const legacyFlow = loadLegacyFlow();
  const all = [...localFlows];
  if (legacyFlow) all.push(legacyFlow);
  if (!all.length) return serverFlows;

  for (const flow of all) {
    await saveFlow(flow);
  }

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  return fetchFlows();
}

function seedFlow(name) {
  const startId = makeId("node");
  const messageId = makeId("node");
  return {
    id: makeId("flow"),
    name: name || "Novo fluxo",
    enabled: true,
    updatedAt: Date.now(),
    data: {
      tags: [],
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
          tags: [],
        },
      ],
      edges: [{ id: makeId("edge"), from: startId, to: messageId }],
    },
  };
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function openFlow(id) {
  window.location.href = `/canva.html?id=${encodeURIComponent(id)}`;
}

function renderList(flows) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!flows.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Nenhum fluxo criado ainda.";
    listEl.appendChild(empty);
    return;
  }

  flows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  flows.forEach((flow) => {
    const card = document.createElement("div");
    card.className = "flow-list-item";
    const info = document.createElement("div");
    info.className = "flow-list-info";
    const name = document.createElement("div");
    name.className = "flow-list-name";
    name.textContent = flow.name || "Fluxo sem nome";
    const meta = document.createElement("div");
    meta.className = "flow-list-meta";
    meta.textContent = `Atualizado: ${formatDate(flow.updatedAt)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "flow-list-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Abrir";
    openBtn.addEventListener("click", () => openFlow(flow.id));
    const switchWrap = document.createElement("label");
    switchWrap.className = "flow-switch";
    const switchInput = document.createElement("input");
    switchInput.type = "checkbox";
    switchInput.checked = flow.enabled !== false;
    const switchSlider = document.createElement("span");
    switchSlider.className = "flow-switch-slider";
    const switchLabel = document.createElement("span");
    switchLabel.className = "flow-switch-label";
    switchLabel.textContent = switchInput.checked ? "Ligado" : "Desligado";
    switchInput.addEventListener("change", async () => {
      flow.enabled = switchInput.checked;
      switchLabel.textContent = switchInput.checked ? "Ligado" : "Desligado";
      flow.updatedAt = Date.now();
      await saveFlow(flow);
    });
    switchWrap.appendChild(switchInput);
    switchWrap.appendChild(switchSlider);
    switchWrap.appendChild(switchLabel);
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", async () => {
      await deleteFlow(flow.id);
      const updated = await fetchFlows();
      renderList(updated);
    });
    actions.appendChild(openBtn);
    actions.appendChild(switchWrap);
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    listEl.appendChild(card);
  });
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

if (createButton) {
  createButton.addEventListener("click", async () => {
    const flow = seedFlow();
    const saved = await saveFlow(flow);
    openFlow(saved?.id || flow.id);
  });
}

ensureSession().then(async (ok) => {
  if (ok) {
    let flows = await fetchFlows();
    flows = await migrateLegacy(flows);
    renderList(flows);
  }
});
