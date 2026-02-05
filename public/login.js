const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

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

async function checkSession() {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        window.location.href = "/app.html";
      }
    }
  } catch {
    // ignore
  }
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
      window.location.href = "/app.html";
    } catch {
      loginError.textContent = "Email ou senha invalidos.";
    }
  });
}

checkSession();