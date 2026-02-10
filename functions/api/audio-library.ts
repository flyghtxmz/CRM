import { Env, getSession, json, options } from "./_utils";

type AudioAsset = {
  id: string;
  name: string;
  key: string;
  url: string;
  mime: string;
  size: number;
  voice_ready: boolean;
  created_at: number;
};

const AUDIO_LIBRARY_KEY = "audio-library:index";
const AUDIO_LIBRARY_LIMIT = 120;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function safeName(input: string, fallback = "audio") {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  return raw.replace(/[\r\n\t]+/g, " ").slice(0, 120);
}

function normalizeBaseUrl(raw: string) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function extensionFromName(name: string) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : "ogg";
}

function mimeFromExtension(ext: string) {
  const value = String(ext || "").toLowerCase();
  if (value === "ogg") return "audio/ogg";
  if (value === "mp3") return "audio/mpeg";
  if (value === "m4a") return "audio/mp4";
  if (value === "wav") return "audio/wav";
  return "application/octet-stream";
}

function buildPublicUrl(base: string, key: string) {
  const encodedPath = String(key || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/${encodedPath}`;
}

async function readLibrary(kv: KVNamespace) {
  const current = (await kv.get(AUDIO_LIBRARY_KEY, "json")) as AudioAsset[] | null;
  return Array.isArray(current) ? current : [];
}

async function writeLibrary(kv: KVNamespace, items: AudioAsset[]) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > AUDIO_LIBRARY_LIMIT) {
    list.splice(AUDIO_LIBRARY_LIMIT);
  }
  await kv.put(AUDIO_LIBRARY_KEY, JSON.stringify(list));
}

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const list = await readLibrary(session.kv);
  return json({ ok: true, data: list });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const bucket = env.BOTZAP_AUDIO_R2;
  if (!bucket) {
    return json({ ok: false, error: "Missing env: BOTZAP_AUDIO_R2" }, 500);
  }

  const baseUrl = normalizeBaseUrl(env.BOTZAP_AUDIO_BASE_URL || "");
  if (!baseUrl) {
    return json({ ok: false, error: "Missing env: BOTZAP_AUDIO_BASE_URL" }, 500);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form data" }, 400);
  }

  const filePart = form.get("file");
  if (!(filePart instanceof File)) {
    return json({ ok: false, error: "Missing file" }, 400);
  }

  const file = filePart;
  const size = Number(file.size || 0);
  if (!size || size > MAX_AUDIO_BYTES) {
    return json(
      {
        ok: false,
        error: `Invalid file size. Max ${MAX_AUDIO_BYTES} bytes`,
      },
      400,
    );
  }

  const sourceName = safeName(String(file.name || "audio.ogg"));
  const ext = extensionFromName(sourceName);
  const mime = safeName(String(file.type || mimeFromExtension(ext) || "application/octet-stream"));
  if (!mime.toLowerCase().startsWith("audio/")) {
    return json({ ok: false, error: "File must be audio/*" }, 400);
  }

  const displayNameRaw = String(form.get("name") || "").trim();
  const displayName = safeName(displayNameRaw || sourceName.replace(/\.[^.]+$/, "") || "Audio");

  const createdAt = Date.now();
  const random = Math.floor(Math.random() * 100000);
  const key = `audio/${createdAt}_${random}.${ext}`;
  const bytes = await file.arrayBuffer();

  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: mime,
      cacheControl: "public, max-age=31536000",
    },
    customMetadata: {
      name: displayName,
      uploaded_by: "botzap",
    },
  });

  const asset: AudioAsset = {
    id: newId(),
    name: displayName,
    key,
    url: buildPublicUrl(baseUrl, key),
    mime,
    size,
    voice_ready: ext === "ogg" || mime.toLowerCase().includes("ogg"),
    created_at: createdAt,
  };

  const current = await readLibrary(session.kv);
  const next = [asset, ...current.filter((item) => item.id !== asset.id)];
  await writeLibrary(session.kv, next);

  return json({ ok: true, data: asset });
};