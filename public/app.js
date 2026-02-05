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

const pretty = (data) => JSON.stringify(data, null, 2);
const AUTH_KEY = "botzap_auth";
const AUTH_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.ts !== "number") return null;
    if (Date.now() - data.ts > AUTH_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeAuth(email) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ email, ts: Date.now() }));
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function showApp() {
  if (loginScreen) loginScreen.hidden = true;
  if (appShell) appShell.hidden = false;
  if (logoutButton) logoutButton.hidden = false;
}

function showLogin() {
  if (loginScreen) loginScreen.hidden = false;
  if (appShell) appShell.hidden = true;
  if (logoutButton) logoutButton.hidden = true;
}

function initAuth() {
  const auth = readAuth();
  if (auth) {
    showApp();
  } else {
    showLogin();
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const form = new FormData(loginForm);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "").trim();

    if (email === "test@test.com" && password === "1234") {
      writeAuth(email);
      showApp();
      return;
    }

    loginError.textContent = "Email ou senha invalidos.";
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    clearAuth();
    showLogin();
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

initAuth();