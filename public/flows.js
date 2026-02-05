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

function loadFlows() {
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

function saveFlows(flows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
}

function migrateLegacyFlow(flows) {
  if (flows.length) return flows;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return flows;
  try {
    const data = JSON.parse(raw);
    const flow = {
      id: makeId("flow"),
      name: "Fluxo importado",
      updatedAt: Date.now(),
      data: {
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
      },
    };
    const next = [flow];
    saveFlows(next);
    localStorage.removeItem(LEGACY_KEY);
    return next;
  } catch {
    return flows;
  }
}

function seedFlow(name) {
  const startId = makeId("node");
  const messageId = makeId("node");
  return {
    id: makeId("flow"),
    name: name || "Novo fluxo",
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
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "Excluir";
    deleteBtn.addEventListener("click", () => {
      const next = flows.filter((item) => item.id !== flow.id);
      saveFlows(next);
      renderList(next);
    });
    actions.appendChild(openBtn);
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
  createButton.addEventListener("click", () => {
    const flows = loadFlows();
    const flow = seedFlow();
    flows.unshift(flow);
    saveFlows(flows);
    openFlow(flow.id);
  });
}

ensureSession().then((ok) => {
  if (ok) {
    let flows = loadFlows();
    flows = migrateLegacyFlow(flows);
    renderList(flows);
  }
});
