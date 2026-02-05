const sendForm = document.getElementById("send-form");
const sendResult = document.getElementById("send-result");
const templateForm = document.getElementById("template-form");
const templateResult = document.getElementById("template-result");
const webhookButton = document.getElementById("webhook-test");
const webhookResult = document.getElementById("webhook-result");
const phoneButton = document.getElementById("phone-numbers");
const phoneResult = document.getElementById("phone-result");
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutButton = document.getElementById("logout");
const convButton = document.getElementById("refresh-conversations");
const convList = document.getElementById("conversation-list");
const convEmpty = document.getElementById("conversation-empty");

const pretty = (data) => JSON.stringify(data, null, 2);

function showApp() {
  if (loginScreen) loginScreen.hidden = true;
  if (appShell) appShell.hidden = false;
  if (logoutButton) logoutButton.hidden = false;
  refreshConversations();
}

function showLogin() {
  if (loginScreen) loginScreen.hidden = false;
  if (appShell) appShell.hidden = true;
  if (logoutButton) logoutButton.hidden = true;
}

async function checkSession() {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (!res.ok) {
      showLogin();
      return;
    }
    const data = await res.json();
    if (data && data.ok) {
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
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

function renderConversations(items) {
  if (!convList || !convEmpty) return;
  convList.innerHTML = "";

  if (!items || items.length === 0) {
    convEmpty.textContent = "Nenhuma conversa registrada ainda.";
    return;
  }

  convEmpty.textContent = "";
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "conversation-item";

    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = item.name || item.wa_id || "Desconhecido";

    const msg = document.createElement("div");
    msg.textContent = item.last_message || "(sem mensagem)";

    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    const time = formatTime(item.last_timestamp);
    meta.textContent = `${item.wa_id || ""} ${time ? "• " + time : ""}`.trim();

    div.appendChild(title);
    div.appendChild(msg);
    div.appendChild(meta);
    convList.appendChild(div);
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

if (loginForm && loginError) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const form = new FormData(loginForm);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "").trim();

    try {
      await postJson("/api/login", { email, password });
      showApp();
    } catch {
      loginError.textContent = "Email ou senha invalidos.";
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await postJson("/api/logout", {});
    } finally {
      showLogin();
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

checkSession();