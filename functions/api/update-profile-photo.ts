import { apiVersion, Env, getSession, json, options, requireEnv } from "./_utils";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

type GraphError = {
  status: number;
  data: unknown;
};

function toGraphError(status: number, data: unknown): GraphError {
  return { status, data };
}

async function parseResponse(res: Response) {
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text when not JSON
  }
  return data;
}

async function createUploadSession(
  appId: string,
  token: string,
  version: string,
  fileLength: number,
  fileType: string,
) {
  const url = `https://graph.facebook.com/${version}/${appId}/uploads?file_length=${fileLength}&file_type=${encodeURIComponent(fileType)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const data = await parseResponse(res);
  if (!res.ok) {
    throw toGraphError(res.status, data);
  }

  const id = String((data as any)?.id || "").trim();
  if (!id) {
    throw toGraphError(500, { ok: false, error: "Create upload session returned no id", data });
  }

  return { id, data };
}

async function uploadFileData(
  uploadSessionId: string,
  token: string,
  version: string,
  bytes: ArrayBuffer,
  contentType: string,
) {
  const url = `https://graph.facebook.com/${version}/${uploadSessionId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `OAuth ${token}`,
      file_offset: "0",
      "content-type": contentType,
    },
    body: bytes,
  });

  const data = await parseResponse(res);
  if (!res.ok) {
    throw toGraphError(res.status, data);
  }

  const handle = String((data as any)?.h || "").trim();
  if (!handle) {
    throw toGraphError(500, { ok: false, error: "Upload returned no handle", data });
  }

  return { handle, data };
}

async function updateBusinessProfilePhoto(
  phoneNumberId: string,
  token: string,
  version: string,
  profilePictureHandle: string,
) {
  const res = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/whatsapp_business_profile`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        profile_picture_handle: profilePictureHandle,
      }),
    },
  );

  const data = await parseResponse(res);
  if (!res.ok) {
    throw toGraphError(res.status, data);
  }

  return data;
}

export const onRequestOptions = async () => options();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env);
  if ("error" in session) {
    return json({ ok: false, error: session.error }, session.status);
  }

  try {
    const token = requireEnv(env, "WHATSAPP_TOKEN");
    const phoneNumberId = requireEnv(env, "WHATSAPP_PHONE_NUMBER_ID");
    const version = apiVersion(env);
    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => null);
      const handle = String((body as any)?.profile_picture_handle || "").trim();
      if (!handle) {
        return json({ ok: false, error: "Missing profile_picture_handle" }, 400);
      }
      const data = await updateBusinessProfilePhoto(phoneNumberId, token, version, handle);
      return json({ ok: true, mode: "handle", handle, data });
    }

    const form = await request.formData().catch(() => null);
    if (!form) {
      return json({ ok: false, error: "Invalid form data" }, 400);
    }

    const filePart = form.get("file");
    if (!(filePart instanceof File)) {
      return json({ ok: false, error: "Missing image file (field: file)" }, 400);
    }

    const file = filePart;
    const fileType = String(file.type || "").toLowerCase();
    const fileSize = Number(file.size || 0);

    if (!fileSize || fileSize > MAX_IMAGE_BYTES) {
      return json(
        {
          ok: false,
          error: `Invalid file size. Max ${MAX_IMAGE_BYTES} bytes`,
          debug: { name: file.name, type: fileType, size: fileSize },
        },
        400,
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(fileType)) {
      return json(
        {
          ok: false,
          error: "Invalid image type. Use JPG or PNG.",
          debug: { type: fileType, allowed: Array.from(ALLOWED_IMAGE_TYPES) },
        },
        400,
      );
    }

    const appId = requireEnv(env, "WHATSAPP_APP_ID");
    const bytes = await file.arrayBuffer();

    const uploadSession = await createUploadSession(appId, token, version, fileSize, fileType);
    const uploadData = await uploadFileData(uploadSession.id, token, version, bytes, fileType);
    const profileData = await updateBusinessProfilePhoto(
      phoneNumberId,
      token,
      version,
      uploadData.handle,
    );

    return json({
      ok: true,
      mode: "upload",
      handle: uploadData.handle,
      upload_session_id: uploadSession.id,
      data: profileData,
    });
  } catch (err: any) {
    if (err && typeof err === "object" && "status" in err && "data" in err) {
      const status = Number((err as GraphError).status) || 500;
      return json({ ok: false, status, data: (err as GraphError).data }, status);
    }
    return json(
      {
        ok: false,
        error: err?.message ? String(err.message) : "Unexpected error",
      },
      500,
    );
  }
};
