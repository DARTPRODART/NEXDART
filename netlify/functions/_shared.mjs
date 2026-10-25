export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej: ${name}`);
  return value;
}

export async function isAdmin(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  try {
    const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
      headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: authorization }
    });
    if (!response.ok) return false;
    const user = await response.json();
    return Boolean(user.id) && user.id === env("ADMIN_USER_ID");
  } catch { return false; }
}

export async function dbRequest(path, options = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}

const MEDIA_BUCKET = "nexdart-media";
let mediaBucketReady;

async function ensureMediaBucket() {
  if (!mediaBucketReady) {
    mediaBucketReady = (async () => {
      const base = env("SUPABASE_URL").replace(/\/$/, "");
      const key = env("SUPABASE_SERVICE_ROLE_KEY");
      const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      };
      const bucketUrl = `${base}/storage/v1/bucket/${MEDIA_BUCKET}`;
      const existing = await fetch(bucketUrl, { headers });
      if (existing.ok) {
        const bucket = await existing.json();
        if (bucket.public !== true) {
          throw new Error(`Magazyn Supabase ${MEDIA_BUCKET} już istnieje, ale nie jest publiczny. Nie zmieniono jego ustawień.`);
        }
        return;
      }
      if (existing.status !== 404) {
        const detail = await existing.text();
        throw new Error(`Nie udało się sprawdzić magazynu grafik Supabase (${existing.status}): ${detail.slice(0, 300)}`);
      }
      const created = await fetch(`${base}/storage/v1/bucket`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: MEDIA_BUCKET,
          name: MEDIA_BUCKET,
          public: true,
          file_size_limit: 12582912,
          allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
        })
      });
      if (!created.ok) {
        // Another concurrent function invocation may have created it after our GET.
        const verify = await fetch(bucketUrl, { headers });
        if (verify.ok) {
          const bucket = await verify.json();
          if (bucket.public === true) return;
        }
        const detail = await created.text();
        throw new Error(`Nie udało się przygotować magazynu grafik Supabase (${created.status}): ${detail.slice(0, 300)}`);
      }
    })().catch(error => {
      mediaBucketReady = undefined;
      throw error;
    });
  }
  return mediaBucketReady;
}

const mediaUploads = new Map();

async function storeImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Grafika ma nieobsługiwany format. Użyj JPG, PNG, WebP, GIF lub AVIF.");
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("Grafika przekracza limit 12 MB.");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (mediaUploads.has(hash)) return mediaUploads.get(hash);

  const uploadPromise = (async () => {
    await ensureMediaBucket();
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" })[mime];
    const path = `images/${hash}.${extension}`;
    const base = env("SUPABASE_URL").replace(/\/$/, "");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    const response = await fetch(`${base}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "x-upsert": "true"
      },
      body: bytes
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Nie udało się zapisać grafiki w Supabase Storage (${response.status}): ${detail.slice(0, 300)}`);
    }
    return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
  })();
  mediaUploads.set(hash, uploadPromise);
  try { return await uploadPromise; }
  catch (error) { mediaUploads.delete(hash); throw error; }
}

// Converts only embedded image data; existing URLs and all other values remain unchanged.
export async function externalizeImages(value) {
  if (typeof value === "string") {
    // Preserve uncommon image data URLs instead of blocking an otherwise valid save.
    if (!/^data:image\/(?:jpeg|png|webp|gif|avif);base64,/i.test(value)) return value;
    return storeImageDataUrl(value);
  }
  if (Array.isArray(value)) return Promise.all(value.map(externalizeImages));
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await externalizeImages(child)]));
    return Object.fromEntries(entries);
  }
  return value;
}
