const logoutButton = document.getElementById("logout");
const listEl = document.getElementById("logs-list");
const emptyEl = document.getElementById("logs-empty");
const refreshButton = document.getElementById("logs-refresh");
const clearButton = document.getElementById("logs-clear");

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

async function fetchLogs() {
  const res = await fetch("/api/flow-logs?limit=200", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !data.ok) return [];
  return Array.isArray(data.data) ? data.data : [];
}

async function clearLogs() {
  await fetch("/api/flow-logs", { method: "DELETE", credentials: "include" });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function renderLogs(list) {
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = "";
  if (!list.length) {
    emptyEl.textContent = "Nenhum log encontrado.";
    return;
  }
  emptyEl.textContent = "";

  list.forEach((log) => {
    const row = document.createElement("div");
    row.className = "log-row";

    const top = document.createElement("div");
    top.className = "log-top";
    const title = document.createElement("div");
    title.className = "log-title";
    title.textContent = `${log.flow_name || "Fluxo"} - ${log.wa_id || ""}`.trim();
    const time = document.createElement("div");
    time.className = "log-time";
    time.textContent = formatDate(log.ts);
    top.appendChild(title);
    top.appendChild(time);

    const meta = document.createElement("div");
    meta.className = "log-meta";
    const before = Array.isArray(log.tags_before) ? log.tags_before.join(", ") : "";
    const after = Array.isArray(log.tags_after) ? log.tags_after.join(", ") : "";
    meta.textContent = `Tags: ${before || "(nenhuma)"} -> ${after || "(nenhuma)"}`;

    const notes = document.createElement("div");
    notes.className = "log-notes";
    const baseNotes = Array.isArray(log.notes) ? log.notes.join(" | ") : "";
    const repeats = Number(log.repeat_count || 1);
    notes.textContent = repeats > 1 ? `${baseNotes}${baseNotes ? " | " : ""}repeticoes:${repeats}` : baseNotes;

    row.appendChild(top);
    row.appendChild(meta);
    row.appendChild(notes);
    listEl.appendChild(row);
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

if (refreshButton) {
  refreshButton.addEventListener("click", async () => {
    const logs = await fetchLogs();
    renderLogs(logs);
  });
}

if (clearButton) {
  clearButton.addEventListener("click", async () => {
    await clearLogs();
    renderLogs([]);
  });
}

ensureSession().then(async (ok) => {
  if (ok) {
    const logs = await fetchLogs();
    renderLogs(logs);
  }
});
