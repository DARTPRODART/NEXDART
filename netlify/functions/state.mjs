import { json, env, isAdmin, dbRequest } from "./_shared.mjs";

function publicState(value) {
  const copy = JSON.parse(JSON.stringify(value));
  // Hashes are private, including copies inside historical season archives.
  const strip = (item) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { for (const child of item) strip(child); return; }
    delete item.adminPasswordHash;
    delete item.resultPasswordHash;
    for (const child of Object.values(item)) strip(child);
  };
  strip(copy);
  return copy;
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method === "GET") {
      if (new URL(request.url).searchParams.get("checkAdmin") === "1") {
        const allowed = await isAdmin(request);
        return json({ isAdmin: allowed }, allowed ? 200 : 403);
      }
      const params = new URL(request.url).searchParams;
      if (params.get("meta") === "1") {
        const metaResponse = await dbRequest("league_state?id=eq.1&select=id,updated_at");
        if (!metaResponse.ok) return json({ error: "Nie udało się odczytać statusu bazy ligi." }, 502);
        const metaRows = await metaResponse.json();
        return json({ updated_at: metaRows[0]?.updated_at || null });
      }
      const response = await dbRequest("league_state?id=eq.1&select=id,data,updated_at");
      if (!response.ok) return json({ error: "Nie udało się odczytać bazy ligi." }, 502);
      const rows = await response.json();
      if (!rows.length) return json({ data: null, updated_at: null });
      const admin = await isAdmin(request);
      return json({ data: admin ? rows[0].data : publicState(rows[0].data), updated_at: rows[0].updated_at });
    }
    if (request.method !== "PUT") return json({ error: "Niedozwolona metoda." }, 405);
    if (!(await isAdmin(request))) return json({ error: "Tylko administrator może zapisywać dane." }, 403);
    const body = await request.json();
    if (!body?.data || !Array.isArray(body.data.players) || !Array.isArray(body.data.matches)) {
      return json({ error: "Nieprawidłowy format danych ligi." }, 400);
    }
    const data = JSON.parse(JSON.stringify(body.data));
    delete data.adminPasswordHash;
    const updatedAt = new Date().toISOString();
    const response = await dbRequest("league_state?on_conflict=id&select=id,data,updated_at", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: 1, data, updated_at: updatedAt })
    });
    if (!response.ok) { console.error("Supabase state upsert failed", response.status, await response.text()); return json({ error: "Nie udało się zapisać danych ligi." }, 502); }

    // A successful HTTP status alone is not enough: verify the row returned by Supabase.
    const rows = await response.json();
    const saved = Array.isArray(rows) ? rows.find(row => Number(row.id) === 1) : null;
    const stable = value => {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
      return value;
    };
    if (!saved || !Number.isFinite(new Date(saved.updated_at).getTime()) || new Date(saved.updated_at).getTime() !== new Date(updatedAt).getTime() || JSON.stringify(stable(saved.data)) !== JSON.stringify(stable(data))) {
      console.error("Supabase state write verification failed", {
        rowReturned: !!saved,
        expectedUpdatedAt: updatedAt,
        actualUpdatedAt: saved?.updated_at || null
      });
      return json({ error: "Baza nie potwierdziła zgodności zapisanego stanu ligi." }, 502);
    }
    return json({ ok: true, updated_at: saved.updated_at });
  } catch (error) {
    console.error("state function error", error);
    return json({ error: "Błąd serwera przy obsłudze danych ligi." }, 500);
  }
};
