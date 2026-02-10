const logoutButton = document.getElementById("logout");
const refreshButton = document.getElementById("clicks-refresh");
const summaryEl = document.getElementById("clicks-summary");
const byFlowEl = document.getElementById("clicks-by-flow");
const byBlockEl = document.getElementById("clicks-by-block");
const listEl = document.getElementById("clicks-list");
const emptyEl = document.getElementById("clicks-empty");

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

async function fetchClicks() {
  const res = await fetch("/api/clicks?limit=300", { credentials: "include" });
  if (!res.ok) return { summary: null, data: [] };
  const payload = await res.json();
  if (!payload || !payload.ok) return { summary: null, data: [] };
  return {
    summary: payload.summary || null,
    data: Array.isArray(payload.data) ? payload.data : [],
  };
}

function formatDate(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const date = new Date(ts > 1e12 ? ts : ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function renderSummary(summary) {
  if (!summaryEl) return;
  summaryEl.innerHTML = "";
  const cards = [
    { label: "Total de clicks", value: Number(summary?.total_clicks || 0) },
    { label: "Contatos unicos", value: Number(summary?.unique_contacts || 0) },
    { label: "Clicks compartilhados", value: Number(summary?.shared_clicks || 0) },
  ];
  cards.forEach((item) => {
    const card = document.createElement("div");
    card.className = "clicks-metric";
    const value = document.createElement("div");
    value.className = "clicks-metric-value";
    value.textContent = String(item.value);
    const label = document.createElement("div");
    label.className = "clicks-metric-label";
    label.textContent = item.label;
    card.appendChild(value);
    card.appendChild(label);
    summaryEl.appendChild(card);
  });
}

function renderRanking(container, rows, emptyText, formatter) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(rows) || !rows.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "clicks-rank-row";
    const label = document.createElement("div");
    label.className = "clicks-rank-label";
    label.textContent = formatter(row);
    const value = document.createElement("div");
    value.className = "clicks-rank-value";
    value.textContent = String(row.clicks || 0);
    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  });
}

function renderRecent(list) {
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = "";
  if (!Array.isArray(list) || !list.length) {
    emptyEl.textContent = "Nenhum click encontrado.";
    return;
  }
  emptyEl.textContent = "";
  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "click-row";

    const top = document.createElement("div");
    top.className = "click-row-top";
    const title = document.createElement("div");
    title.className = "click-row-title";
    const flowName = String(item.flow_name || "").trim();
    const blockName = String(item.block_name || "").trim();
    const from = [flowName || "Sem fluxo", blockName || "Sem bloco"].join(" | ");
    title.textContent = `${item.wa_id || "(sem wa_id)"} - ${from}`;
    const time = document.createElement("div");
    time.className = "click-row-time";
    time.textContent = formatDate(item.ts);
    top.appendChild(title);
    top.appendChild(time);

    const meta = document.createElement("div");
    meta.className = "click-row-meta";
    const shortUrl = String(item.short_url || "").trim();
    const targetUrl = String(item.target_url || "").trim();
    meta.textContent = `short: ${shortUrl || "-"} | target: ${targetUrl || "-"}`;

    const detail = document.createElement("div");
    detail.className = "click-row-detail";
    const device = String(item.device_type || "unknown");
    const shared = Number(item.shared_click || 0) === 1 ? "sim" : "nao";
    detail.textContent = `device: ${device} | compartilhado: ${shared}`;

    row.appendChild(top);
    row.appendChild(meta);
    row.appendChild(detail);
    listEl.appendChild(row);
  });
}

async function loadAndRender() {
  const payload = await fetchClicks();
  const summary = payload.summary || {
    total_clicks: 0,
    unique_contacts: 0,
    shared_clicks: 0,
    by_flow: [],
    by_block: [],
  };
  renderSummary(summary);
  renderRanking(
    byFlowEl,
    summary.by_flow,
    "Nenhum fluxo com clicks.",
    (row) => String(row.flow_name || row.flow_id || "Sem fluxo"),
  );
  renderRanking(
    byBlockEl,
    summary.by_block,
    "Nenhum bloco com clicks.",
    (row) => {
      const flow = String(row.flow_name || row.flow_id || "Sem fluxo");
      const block = String(row.block_name || row.node_id || "Sem bloco");
      return `${flow} - ${block}`;
    },
  );
  renderRecent(payload.data || []);
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
  refreshButton.addEventListener("click", loadAndRender);
}

ensureSession().then(async (ok) => {
  if (!ok) return;
  await loadAndRender();
});

