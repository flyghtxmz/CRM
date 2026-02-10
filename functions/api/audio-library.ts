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

type ProbeResult = {
  ok: boolean;
  error?: string;
  key?: string;
  head_size?: number | null;
  head_type?: string | null;
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
  if (value === "ogg" || value === "opus") return "audio/ogg";
  if (value === "mp3") return "audio/mpeg";
  if (value === "m4a") return "audio/mp4";
  if (value === "wav") return "audio/wav";
  if (value === "aac") return "audio/aac";
  if (value === "webm") return "audio/webm";
  return "application/octet-stream";
}

function isAudioExtension(ext: string) {
  const value = String(ext || "").toLowerCase();
  return ["ogg", "opus", "mp3", "m4a", "wav", "aac", "webm"].includes(value);
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

async function runR2Probe(bucket: R2Bucket): Promise<ProbeResult> {
  try {
    const key = `audio-probe/${Date.now()}_${Math.floor(Math.random() * 100000)}.txt`;
    const payload = new TextEncoder().encode(`probe:${Date.now()}`);
    await bucket.put(key, payload, {
      httpMetadata: { contentType: "text/plain", cacheControl: "no-store" },
    });
    const head = await bucket.head(key);
    await bucket.delete(key);
    return {
      ok: true,
      key,
      head_size: head?.size ?? null,
      head_type: head?.httpMetadata?.contentType ?? null,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ? String(err.message) : "R2 probe failed",
    };
  }
}

export const onRequestOptions = async () => options();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  const list = await readLibrary(session.kv);
  const baseUrl = normalizeBaseUrl(env.BOTZAP_AUDIO_BASE_URL || "");
  const url = new URL(request.url);
  const wantsProbe = url.searchParams.get("probe") === "1";

  let probe: ProbeResult | null = null;
  if (wantsProbe) {
    if (!env.BOTZAP_AUDIO_R2) {
      probe = { ok: false, error: "Missing env: BOTZAP_AUDIO_R2" };
    } else {
      probe = await runR2Probe(env.BOTZAP_AUDIO_R2);
    }
  }

  return json({
    ok: true,
    data: list,
    env: {
      has_r2: Boolean(env.BOTZAP_AUDIO_R2),
      has_base_url: Boolean(baseUrl),
      base_url: baseUrl || null,
      max_audio_bytes: MAX_AUDIO_BYTES,
    },
    ...(probe ? { probe } : {}),
  });
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
  } catch (err: any) {
    const detail = err?.message ? String(err.message) : "Invalid form data";
    return json({ ok: false, error: `Invalid form data: ${detail}` }, 400);
  }

  const filePart = form.get("file");
  if (!(filePart instanceof File)) {
    return json(
      {
        ok: false,
        error: "Missing file",
        debug: { keys: Array.from(form.keys()) },
      },
      400,
    );
  }

  const file = filePart;
  const size = Number(file.size || 0);
  if (!size || size > MAX_AUDIO_BYTES) {
    return json(
      {
        ok: false,
        error: `Invalid file size. Max ${MAX_AUDIO_BYTES} bytes`,
        debug: {
          name: String(file.name || ""),
          type: String(file.type || ""),
          size,
        },
      },
      400,
    );
  }

  const sourceName = safeName(String(file.name || "audio.ogg"));
  const ext = extensionFromName(sourceName);
  const mimeCandidate = String(file.type || "").trim().toLowerCase();
  const mimeByExt = mimeFromExtension(ext);
  const mime = mimeCandidate.startsWith("audio/") ? mimeCandidate : mimeByExt;
  if (!String(mime || "").toLowerCase().startsWith("audio/") && !isAudioExtension(ext)) {
    return json(
      {
        ok: false,
        error: "File must be audio/*",
        debug: { name: sourceName, ext, type: mimeCandidate, resolved_mime: mime },
      },
      400,
    );
  }

  const displayNameRaw = String(form.get("name") || "").trim();
  const displayName = safeName(displayNameRaw || sourceName.replace(/\.[^.]+$/, "") || "Audio");

  const createdAt = Date.now();
  const random = Math.floor(Math.random() * 100000);
  const key = `audio/${createdAt}_${random}.${ext}`;

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (err: any) {
    return json({ ok: false, error: `Read file failed: ${String(err?.message || err || "unknown")}` }, 400);
  }

  try {
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
  } catch (err: any) {
    const detail = err?.message ? String(err.message) : "R2 put failed";
    return json(
      {
        ok: false,
        error: `R2 upload failed: ${detail}`,
        debug: { key, mime, size: bytes.byteLength, baseUrl },
      },
      500,
    );
  }

  const asset: AudioAsset = {
    id: newId(),
    name: displayName,
    key,
    url: buildPublicUrl(baseUrl, key),
    mime,
    size,
    voice_ready: ext === "ogg" || ext === "opus" || mime.toLowerCase().includes("ogg") || mime.toLowerCase().includes("opus"),
    created_at: createdAt,
  };

  const current = await readLibrary(session.kv);
  const next = [asset, ...current.filter((item) => item.id !== asset.id)];
  await writeLibrary(session.kv, next);

  return json({ ok: true, data: asset });
};
