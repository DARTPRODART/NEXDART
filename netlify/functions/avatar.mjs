import { json, dbRequest } from "./_shared.mjs";

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256-" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function validImage(value) {
  if (typeof value !== "string" || value.length > 850_000) return false;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!["PUT", "DELETE"].includes(request.method)) return json({ error: "Niedozwolona metoda." }, 405);
    const body = await request.json();
    const playerId = String(body?.playerId || "");
    const pin = String(body?.pin || "");
    if (!/^p[\w-]{1,80}$/.test(playerId) || !/^\d{4}$/.test(pin)) {
      return json({ error: "Wpisz prawidłowy identyfikator zawodnika i 4-cyfrowy PIN." }, 400);
    }
    if (request.method === "PUT" && !validImage(body.avatar)) {
      return json({ error: "Nieprawidłowy obraz. Wybierz JPG, PNG lub WebP o rozmiarze dozwolonym przez aplikację." }, 400);
    }

    const read = await dbRequest("league_state?id=eq.1&select=id,data,updated_at");
    if (!read.ok) return json({ error: "Nie udało się odczytać danych ligi." }, 502);
    const rows = await read.json();
    if (!rows.length || !rows[0].data || !Array.isArray(rows[0].data.players)) {
      return json({ error: "Nie znaleziono danych ligi." }, 404);
    }
    const data = rows[0].data;
    const target = data.players.find(p => String(p.id) === playerId);
    if (!target) return json({ error: "Nie znaleziono zawodnika." }, 404);
    if (!target.resultPasswordHash || target.resultPinVersion !== 2 || !String(target.resultPasswordHash).startsWith("sha256-")) {
      return json({ error: "Zawodnik nie ma aktywnego 4-cyfrowego PIN-u. Skontaktuj się z administratorem ligi." }, 403);
    }
    const submittedHash = await sha256(pin);
    if (submittedHash !== target.resultPasswordHash) {
      return json({ error: "Nieprawidłowy PIN. Awatar nie został zmieniony." }, 403);
    }

    if (request.method === "PUT") target.avatar = body.avatar;
    else delete target.avatar;

    const write = await dbRequest("league_state?id=eq.1", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ data, updated_at: new Date().toISOString() })
    });
    if (!write.ok) {
      console.error("Supabase avatar update failed", write.status, await write.text());
      return json({ error: "Nie udało się zapisać awatara w bazie." }, 502);
    }
    return json({ ok: true, avatar: target.avatar || null });
  } catch (error) {
    console.error("avatar function error", error);
    return json({ error: "Błąd serwera podczas zapisu awatara." }, 500);
  }
};
