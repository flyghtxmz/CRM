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
const chatHistory = document.getElementById("chat-history");
const chatEmpty = document.getElementById("chat-empty");

const pretty = (data) => JSON.stringify(data, null, 2);
let currentConversationId = null;
let currentConversationName = null;

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

function formatTime(value) {
  if (!value) return "";
  const ts = Number(value);
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function setChatHeader(name, waId) {
  if (!chatHeader) return;
  if (!waId) {
    chatHeader.textContent = "Selecione uma conversa";
    return;
  }
  chatHeader.textContent = name ? `${name} • ${waId}` : waId;
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
    meta.textContent = formatTime(item.timestamp);

    bubble.appendChild(meta);
    chatHistory.appendChild(bubble);
  });
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

function renderConversations(items) {
  if (!convList || !convEmpty) return;
  convList.innerHTML = "";

  if (!items || items.length === 0) {
    convEmpty.textContent = "Nenhuma conversa registrada ainda.";
    setChatHeader(null, null);
    renderThread([]);
    return;
  }

  convEmpty.textContent = "";
  let hasActive = false;

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "conversation-item";
    div.dataset.waId = item.wa_id || "";

    if (currentConversationId && item.wa_id === currentConversationId) {
      div.classList.add("active");
      hasActive = true;
    }

    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = item.name || item.wa_id || "Desconhecido";

    const msg = document.createElement("div");
    const prefix = item.last_direction === "out" ? "Voce: " : "";
    msg.textContent = `${prefix}${item.last_message || "(sem mensagem)"}`;

    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    const time = formatTime(item.last_timestamp);
    meta.textContent = `${item.wa_id || ""} ${time ? "• " + time : ""}`.trim();

    div.appendChild(title);
    div.appendChild(msg);
    div.appendChild(meta);
    div.addEventListener("click", () => {
      currentConversationId = item.wa_id || null;
      currentConversationName = item.name || null;
      setChatHeader(currentConversationName, currentConversationId);
      renderConversations(items);
      loadThread(currentConversationId);
    });

    convList.appendChild(div);
  });

  if (!hasActive) {
    const first = items[0];
    currentConversationId = first?.wa_id || null;
    currentConversationName = first?.name || null;
    setChatHeader(currentConversationName, currentConversationId);
    renderConversations(items);
    loadThread(currentConversationId);
  } else if (currentConversationId) {
    loadThread(currentConversationId);
  }
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
      renderConversations([]);
      if (convEmpty) convEmpty.textContent = "Erro ao carregar conversas.";
      return;
    }
    renderConversations(data.data || []);
  } catch {
    renderConversations([]);
    if (convEmpty) convEmpty.textContent = "Erro ao carregar conversas.";
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
    refreshConversations();
  });
}

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
  if (ok) refreshConversations();
});
