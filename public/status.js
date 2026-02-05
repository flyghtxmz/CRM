const logoutButton = document.getElementById("logout");
const statusGrid = document.getElementById("status-grid");
const statusRaw = document.getElementById("status-raw");
const healthGrid = document.getElementById("health-grid");
const refreshButton = document.getElementById("status-refresh");

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

function renderKeyValue(target, items) {
  if (!target) return;
  target.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "status-item";
    const label = document.createElement("div");
    label.className = "status-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "status-value";
    value.textContent = item.value;
    card.appendChild(label);
    card.appendChild(value);
    target.appendChild(card);
  });
}

async function loadStatus() {
  if (statusRaw) statusRaw.textContent = "Carregando...";
  try {
    const res = await fetch("/api/status", { credentials: "include" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      if (statusRaw) statusRaw.textContent = text;
      return;
    }

    const phoneNumbers = Array.isArray(data?.data?.data) ? data.data.data : [];
    const first = phoneNumbers[0] || {};
    const quality = first.quality_rating || "desconhecido";
    const throughput = first?.throughput?.level || "desconhecido";
    const statusItems = [
      { label: "Numero", value: first.display_phone_number || "-" },
      { label: "Nome verificado", value: first.verified_name || "-" },
      { label: "Qualidade", value: quality },
      { label: "Throughput", value: throughput },
      { label: "Webhook", value: first?.webhook_configuration?.application || "-" },
    ];
    renderKeyValue(statusGrid, statusItems);

    const env = data.env || {};
    const healthItems = [
      { label: "Modo do app", value: env.app_mode || "desconhecido" },
      { label: "Token", value: env.has_token ? "ok" : "faltando" },
      { label: "WABA", value: env.has_waba ? "ok" : "faltando" },
      { label: "Phone ID", value: env.has_phone ? "ok" : "faltando" },
      { label: "API version", value: env.api_version || "-" },
    ];
    renderKeyValue(healthGrid, healthItems);

    if (statusRaw) statusRaw.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    if (statusRaw) statusRaw.textContent = String(err);
  }
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

if (refreshButton) {
  refreshButton.addEventListener("click", loadStatus);
}

ensureSession().then((ok) => {
  if (ok) loadStatus();
});
