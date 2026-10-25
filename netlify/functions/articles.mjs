import { json, isAdmin, dbRequest, externalizeImages } from "./_shared.mjs";

export default async (request) => {
  try {
    if (request.method === "GET") {
      const admin = await isAdmin(request);
      const filter = admin ? "" : "&published=eq.true";
      const params = new URL(request.url).searchParams;
      if (params.get("meta") === "1") {
        const metaResponse = await dbRequest(`league_articles?select=id,published,updated_at&order=updated_at.desc${filter}`);
        if (!metaResponse.ok) { console.error("Supabase articles metadata read failed", metaResponse.status, await metaResponse.text()); return json({ error: "Nie udało się pobrać statusu aktualności." }, 502); }
        const metaRows = await metaResponse.json();
        return json(metaRows.map(row => ({ id: row.id, published: !!row.published, updated_at: row.updated_at })));
      }
      const response = await dbRequest(`league_articles?select=id,article,published,date,pinned,updated_at&order=updated_at.desc${filter}`);
      if (!response.ok) { console.error("Supabase articles read failed", response.status, await response.text()); return json({ error: "Nie udało się pobrać aktualności." }, 502); }
      const rows = await response.json();
      return json(rows.map(row => row.article));
    }
    if (!(await isAdmin(request))) return json({ error: "Tylko administrator może zarządzać aktualnościami." }, 403);
    if (request.method === "POST") {
      const submittedArticle = await request.json();
      if (!submittedArticle || typeof submittedArticle.id !== "string" || typeof submittedArticle.title !== "string" || !submittedArticle.title.trim() || typeof submittedArticle.content !== "string") return json({ error: "Nieprawidłowe dane artykułu." }, 400);
      if (submittedArticle.title.length > 200 || submittedArticle.content.length > 30000 || (submittedArticle.image && submittedArticle.image.length > 3_000_000)) return json({ error: "Artykuł lub grafika jest za duża." }, 413);
      const article = await externalizeImages(submittedArticle);
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
