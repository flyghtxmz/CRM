const sendForm = document.getElementById("send-form");
const sendResult = document.getElementById("send-result");
const templateForm = document.getElementById("template-form");
const templateResult = document.getElementById("template-result");
const webhookButton = document.getElementById("webhook-test");
const webhookResult = document.getElementById("webhook-result");
const phoneButton = document.getElementById("phone-numbers");
const phoneResult = document.getElementById("phone-result");
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
let currentConversationId = null;
let currentConversationName = null;
let allConversations = [];
const autoRefreshIntervalMs = 10000;
let autoRefreshTimer = null;

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
    const direction = item.direction === "out" ? "outgoing" : "incoming";
    bubble.className = `chat-bubble ${direction}`;
    bubble.textContent = item.text || "(mensagem)";

    const meta = document.createElement("div");
    meta.className = "chat-bubble-meta";
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

    allConversations = Array.isArray(data.data) ? data.data : [];
    const list = applySearch(allConversations);
    renderConversations(list);
  } catch {
    convEmpty.textContent = "Erro ao carregar conversas.";
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  autoRefreshTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    await refreshConversations();
    if (currentConversationId) {
      await loadThread(currentConversationId);
    }
  }, autoRefreshIntervalMs);
}

function refreshNow() {
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
  }
});

window.addEventListener("focus", refreshNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshNow();
  }
});
