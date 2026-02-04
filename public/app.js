const sendForm = document.getElementById("send-form");
const sendResult = document.getElementById("send-result");
const templateForm = document.getElementById("template-form");
const templateResult = document.getElementById("template-result");
const webhookButton = document.getElementById("webhook-test");
const webhookResult = document.getElementById("webhook-result");
const phoneButton = document.getElementById("phone-numbers");
const phoneResult = document.getElementById("phone-result");

const pretty = (data) => JSON.stringify(data, null, 2);

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