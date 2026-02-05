const logoutButton = document.getElementById("logout");
const listEl = document.getElementById("contact-list");
const emptyEl = document.getElementById("contact-empty");
const searchInput = document.getElementById("contact-search");
const refreshButton = document.getElementById("contact-refresh");

let contacts = [];
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

async function fetchContacts() {
  const res = await fetch("/api/contacts", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !data.ok) return [];
  return Array.isArray(data.data) ? data.data : [];
}

async function updateTag(waId, tag, action) {
  const res = await fetch("/api/contacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wa_id: waId, tag, action }),
    credentials: "include",
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.ok) return null;
  return data.data || null;
}

function formatDate(value) {
  if (!value) return "";
  const raw = Number(value);
  if (!Number.isFinite(raw)) return "";
  const timestamp = raw < 1e12 ? raw * 1000 : raw;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function within24h(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return false;
  const timestamp = raw < 1e12 ? raw * 1000 : raw;
  return Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function renderContacts(list) {
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = "";
  if (!list.length) {
    emptyEl.textContent = "Nenhum contato encontrado.";
    return;
  }
  emptyEl.textContent = "";

  list.forEach((contact) => {
    const row = document.createElement("div");
    row.className = "contact-row";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const name = contact.name || contact.wa_id || "Contato";
    avatar.textContent = name.trim().charAt(0).toUpperCase() || "?";

    const info = document.createElement("div");
    info.className = "contact-info";
    const title = document.createElement("div");
    title.className = "contact-name";
    title.textContent = name;
    const meta = document.createElement("div");
    meta.className = "contact-meta";
    meta.textContent = contact.last_message
      ? `${contact.last_message} · ${formatDate(contact.last_timestamp)}`
      : formatDate(contact.last_timestamp);

    const windowBadge = document.createElement("span");
    const open = within24h(contact.last_timestamp);
    windowBadge.className = `window-badge${open ? "" : " closed"}`;
    windowBadge.textContent = open ? "24h aberta" : "24h fechada";

    const tagWrap = document.createElement("div");
    tagWrap.className = "contact-tags";
    const tags = Array.isArray(contact.tags) ? contact.tags : [];
    if (!tags.length) {
      const emptyTag = document.createElement("span");
      emptyTag.className = "tag-pill muted";
      emptyTag.textContent = "Sem tags";
      tagWrap.appendChild(emptyTag);
    } else {
      tags.forEach((tag) => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.textContent = tag;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "tag-remove";
        remove.textContent = "x";
        remove.addEventListener("click", async (event) => {
          event.stopPropagation();
          const updated = await updateTag(contact.wa_id, tag, "remove");
          if (updated) {
            contacts = contacts.map((item) =>
              item.wa_id === updated.wa_id ? updated : item,
            );
            applySearch();
          }
        });
        pill.appendChild(remove);
        tagWrap.appendChild(pill);
      });
    }

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(windowBadge);
    info.appendChild(tagWrap);

    row.appendChild(avatar);
    row.appendChild(info);
    listEl.appendChild(row);
  });
}

function applySearch() {
  const term = (searchInput?.value || "").trim().toLowerCase();
  if (!term) {
    renderContacts(contacts);
    return;
  }
  const filtered = contacts.filter((contact) => {
    const name = (contact.name || "").toLowerCase();
    const wa = (contact.wa_id || "").toLowerCase();
    const tags = Array.isArray(contact.tags) ? contact.tags.join(" ").toLowerCase() : "";
    return name.includes(term) || wa.includes(term) || tags.includes(term);
  });
  renderContacts(filtered);
}

async function refreshNow() {
  contacts = await fetchContacts();
  applySearch();
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  autoRefreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refreshNow();
  }, autoRefreshIntervalMs);
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

if (searchInput) {
  searchInput.addEventListener("input", applySearch);
}

if (refreshButton) {
  refreshButton.addEventListener("click", refreshNow);
}

ensureSession().then(async (ok) => {
  if (ok) {
    await refreshNow();
    startAutoRefresh();
  }
});

window.addEventListener("focus", refreshNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshNow();
  }
});
