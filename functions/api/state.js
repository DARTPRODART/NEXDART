import { json, isAdmin, dbRequest } from "../_shared.js";

function publicState(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const strip = (item) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) strip(child);
      return;
    }
    delete item.adminPasswordHash;
    delete item.resultPasswordHash;
    for (const child of Object.values(item)) strip(child);
  };
  strip(copy);
  return copy;
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method === "GET") {
      if (new URL(request.url).searchParams.get("checkAdmin") === "1") {
        const allowed = await isAdmin(request, env);
        return json({ isAdmin: allowed }, allowed ? 200 : 403);
      }
      const response = await dbRequest(env, "league_state?id=eq.1&select=id,data,updated_at");
      if (!response.ok) return json({ error: "Nie udało się odczytać bazy ligi." }, 502);
      const rows = await response.json();
      if (!rows.length) return json({ data: null, updated_at: null });
      const admin = await isAdmin(request, env);
      return json({
        data: admin ? rows[0].data : publicState(rows[0].data),
        updated_at: rows[0].updated_at
      });
    }
    if (request.method !== "PUT") return json({ error: "Niedozwolona metoda." }, 405);
    if (!(await isAdmin(request, env))) return json({ error: "Tylko administrator może zapisywać dane." }, 403);
    const body = await request.json();
    if (!body?.data || !Array.isArray(body.data.players) || !Array.isArray(body.data.matches)) {
      return json({ error: "Nieprawidłowy format danych ligi." }, 400);
    }
    const data = JSON.parse(JSON.stringify(body.data));
    delete data.adminPasswordHash;
    const response = await dbRequest(env, "league_state?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: 1, data, updated_at: new Date().toISOString() })
    });
    if (!response.ok) {
      console.error("Supabase state upsert failed", response.status, await response.text());
      return json({ error: "Nie udało się zapisać danych ligi." }, 502);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("state function error", error);
    return json({ error: "Błąd serwera przy obsłudze danych ligi." }, 500);
  }
}
