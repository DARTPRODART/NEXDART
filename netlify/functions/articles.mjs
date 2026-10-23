import { json, isAdmin, dbRequest } from "./_shared.mjs";

export default async (request) => {
  try {
    if (request.method === "GET") {
      const admin = await isAdmin(request);
      const filter = admin ? "" : "&published=eq.true";
      const response = await dbRequest(`league_articles?select=id,article,published,date,pinned,updated_at&order=updated_at.desc${filter}`);
      if (!response.ok) { console.error("Supabase articles read failed", response.status, await response.text()); return json({ error: "Nie udało się pobrać aktualności." }, 502); }
      const rows = await response.json();
      return json(rows.map(row => row.article));
    }
    if (!(await isAdmin(request))) return json({ error: "Tylko administrator może zarządzać aktualnościami." }, 403);
    if (request.method === "POST") {
      const article = await request.json();
      if (!article || typeof article.id !== "string" || typeof article.title !== "string" || !article.title.trim() || typeof article.content !== "string") return json({ error: "Nieprawidłowe dane artykułu." }, 400);
      if (article.title.length > 200 || article.content.length > 30000 || (article.image && article.image.length > 3_000_000)) return json({ error: "Artykuł lub grafika jest za duża." }, 413);
      const row = { id: article.id, article, published: !!article.published, date: String(article.date || ""), pinned: !!article.pinned, updated_at: new Date().toISOString() };
      const response = await dbRequest("league_articles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
      if (!response.ok) { console.error("Supabase article upsert failed", response.status, await response.text()); return json({ error: "Nie udało się zapisać aktualności." }, 502); }
      return json({ ok: true, id: article.id });
    }
    if (request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ error: "Brak identyfikatora artykułu." }, 400);
      const response = await dbRequest(`league_articles?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (!response.ok) { console.error("Supabase article delete failed", response.status, await response.text()); return json({ error: "Nie udało się usunąć aktualności." }, 502); }
      return json({ ok: true });
    }
    return json({ error: "Niedozwolona metoda." }, 405);
  } catch (error) {
    console.error("articles function error", error);
    return json({ error: "Błąd serwera przy obsłudze aktualności." }, 500);
  }
};
