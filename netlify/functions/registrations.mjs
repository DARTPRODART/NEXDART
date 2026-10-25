import { randomBytes, randomInt, createHash } from "node:crypto";
import { json, env, isAdmin, dbRequest } from "./_shared.mjs";

const isolatedPreviewOnly = () =>
  process.env.CONTEXT === "deploy-preview" &&
  process.env.NEXDART_PREVIEW_ISOLATED === "true" &&
  process.env.REGISTRATION_ENABLED === "true";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizedEmail = (value) => String(value || "").trim().toLowerCase();

async function sendEmail(to, subject, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env("REGISTRATION_FROM_EMAIL"),
      to: [to],
      subject,
      html
    })
  });
  if (!response.ok) {
    console.error("Registration email provider failed", response.status, await response.text());
    throw new Error("Nie udało się wysłać wiadomości e-mail.");
  }
}

async function patchRequest(id, patch) {
  const response = await dbRequest(
    `player_registration_requests?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) throw new Error("Nie udało się zaktualizować zgłoszenia.");
  return response.json();
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!isolatedPreviewOnly()) {
      return json({
        error: "Rejestracja jest wyłączona. Włącz ją dopiero w Deploy Preview z oddzielnym projektem Supabase."
      }, 503);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.searchParams.get("action") === "verify") {
      const token = String(url.searchParams.get("token") || "");
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Link potwierdzający jest nieprawidłowy." }, 400);
      const response = await dbRequest(
        `player_registration_requests?verification_token_hash=eq.${sha256(token)}&status=eq.pending_email&select=id,verification_expires_at`
      );
      if (!response.ok) return json({ error: "Nie udało się sprawdzić linku." }, 502);
      const rows = await response.json();
      const row = rows[0];
      if (!row || !row.verification_expires_at || Date.parse(row.verification_expires_at) < Date.now()) {
        return json({ error: "Link wygasł lub został już wykorzystany. Wyślij zgłoszenie ponownie." }, 400);
      }
      await patchRequest(row.id, {
        status: "pending_review",
        email_verified_at: new Date().toISOString(),
        verification_token_hash: null,
        verification_expires_at: null
      });
      return json({ ok: true, message: "Adres e-mail potwierdzony. Zgłoszenie oczekuje na weryfikację administratora." });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const playerName = String(body?.playerName || "").trim().replace(/\\s+/g, " ");
      const email = String(body?.email || "").trim();
      const emailKey = normalizedEmail(email);
      if (playerName.length < 2 || playerName.length > 120) {
        return json({ error: "Wpisz nazwę zawodnika (od 2 do 120 znaków)." }, 400);
      }
      if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        return json({ error: "Wpisz prawidłowy adres e-mail." }, 400);
      }

      const existingResponse = await dbRequest(
        `player_registration_requests?email_normalized=eq.${encodeURIComponent(emailKey)}&status=in.(pending_email,pending_review,approved)&select=id&limit=1`
      );
      if (!existingResponse.ok) return json({ error: "Nie udało się sprawdzić zgłoszenia." }, 502);
      if ((await existingResponse.json()).length) {
        return json({ ok: true, message: "Jeśli dla tego adresu istnieje aktywne zgłoszenie, dalsze informacje zostaną wysłane e-mailem." });
      }

      const token = randomBytes(32).toString("hex");
      const baseUrl = url.origin;
      const verifyUrl = `${baseUrl}/.netlify/functions/registrations?action=verify&token=${token}`;
      const insert = await dbRequest("player_registration_requests", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          player_name: playerName,
          email,
          email_normalized: emailKey,
          status: "pending_email",
          verification_token_hash: sha256(token),
          verification_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        })
      });
      if (!insert.ok) {
        console.error("Registration insert failed", insert.status, await insert.text());
        return json({ error: "Nie udało się zapisać zgłoszenia. Spróbuj ponownie później." }, 502);
      }

      try {
        await sendEmail(
          email,
          "Potwierdź adres e-mail — NEXDART",
          `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d"><h2>Rejestracja w NEXDART</h2><p>Otrzymaliśmy zgłoszenie profilu: <strong>${playerName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</strong>.</p><p>Aby potwierdzić adres e-mail, kliknij poniższy link. Link wygaśnie po 24 godzinach.</p><p><a href="${verifyUrl}">Potwierdź adres e-mail</a></p><p>Potwierdzenie adresu nie aktywuje konta. Administrator musi jeszcze zweryfikować zgłoszenie.</p></div>`
        );
      } catch {
        const created = await insert.json();
        if (created[0]?.id) await patchRequest(created[0].id, { status: "rejected", verification_token_hash: null, verification_expires_at: null });
        return json({ error: "Zgłoszenie zapisano, ale wiadomość nie została wysłana. Spróbuj później." }, 502);
      }
      return json({ ok: true, message: "Sprawdź pocztę i potwierdź adres e-mail. Konto nie będzie aktywne, dopóki administrator nie zatwierdzi zgłoszenia." }, 201);
    }

    if (!(await isAdmin(request))) return json({ error: "Tylko administrator może zarządzać zgłoszeniami." }, 403);

    if (request.method === "GET") {
      const response = await dbRequest("player_registration_requests?select=id,player_name,email,status,email_verified_at,assigned_player_id,created_at,updated_at&order=created_at.desc&limit=100");
      if (!response.ok) return json({ error: "Nie udało się pobrać zgłoszeń." }, 502);
      return json(await response.json());
    }

    if (request.method === "PATCH") {
      const body = await request.json();
      const requestId = String(body?.requestId || "");
      const action = String(body?.action || "");
      const found = await dbRequest(`player_registration_requests?id=eq.${encodeURIComponent(requestId)}&select=id,player_name,email,status,email_verified_at,assigned_player_id`);
      if (!found.ok) return json({ error: "Nie udało się odczytać zgłoszenia." }, 502);
      const item = (await found.json())[0];
      if (!item) return json({ error: "Nie znaleziono zgłoszenia." }, 404);
      if (item.status !== "pending_review" || !item.email_verified_at) {
        return json({ error: "Można zatwierdzić wyłącznie zgłoszenie z potwierdzonym e-mailem, które oczekuje na weryfikację." }, 409);
      }

      if (action === "reject") {
        await patchRequest(item.id, { status: "rejected", verification_token_hash: null, verification_expires_at: null });
        return json({ ok: true, message: "Zgłoszenie odrzucone." });
      }
      if (action !== "approve" || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(body?.playerId || ""))) {
        return json({ error: "Wybierz istniejący profil zawodnika do przypisania." }, 400);
      }

      const playerId = String(body.playerId);
      const alreadyAssigned = await dbRequest(
        `player_registration_requests?assigned_player_id=eq.${encodeURIComponent(playerId)}&status=eq.approved&select=id&limit=1`
      );
      if (!alreadyAssigned.ok) return json({ error: "Nie udało się sprawdzić przypisania profilu." }, 502);
      if ((await alreadyAssigned.json()).length) return json({ error: "Do tego profilu przypisano już konto." }, 409);

      const stateResponse = await dbRequest("league_state?id=eq.1&select=id,data,updated_at");
      if (!stateResponse.ok) return json({ error: "Nie udało się odczytać listy zawodników." }, 502);
      const stateRows = await stateResponse.json();
      const leagueRow = stateRows[0];
      if (!leagueRow?.data || !Array.isArray(leagueRow.data.players)) return json({ error: "Nie znaleziono danych ligi." }, 502);
      const leagueData = JSON.parse(JSON.stringify(leagueRow.data));
      const player = leagueData.players.find((candidate) => String(candidate.id) === playerId);
      if (!player) return json({ error: "Wybrany profil nie istnieje w bazie ligi." }, 404);

      const pin = String(randomInt(0, 10000)).padStart(4, "0");
      player.resultPasswordHash = "sha256-" + sha256(pin);
      player.resultPinVersion = 2;
      player.legacyResultPassword = false;

      const updatedState = await dbRequest(
        `league_state?id=eq.1&updated_at=eq.${encodeURIComponent(leagueRow.updated_at)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ data: leagueData, updated_at: new Date().toISOString() })
        }
      );
      if (!updatedState.ok) return json({ error: "Nie udało się nadać PIN-u. Odśwież dane i spróbuj ponownie." }, 409);
      const changedRows = await updatedState.json();
      if (!changedRows.length) return json({ error: "Dane ligi zmieniły się w trakcie operacji. Odśwież i spróbuj ponownie." }, 409);

      try {
        await sendEmail(
          item.email,
          "Twój profil NEXDART jest aktywny",
          `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d"><h2>Witamy w NEXDART!</h2><p>Administrator zatwierdził profil <strong>${String(player.name || item.player_name).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</strong>.</p><p>Twój 4-cyfrowy PIN do logowania: <strong style="font-size:24px;letter-spacing:4px">${pin}</strong></p><p>Zachowaj PIN w bezpiecznym miejscu i nie udostępniaj go publicznie.</p><p>Jeśli nie składałeś(-aś) tego zgłoszenia, skontaktuj się z administratorem ligi.</p></div>`
        );
      } catch {
        return json({ error: "PIN został zapisany, ale e-mail nie dotarł. Nie zatwierdzono zgłoszenia — użyj opcji ponownego nadania PIN-u po poprawieniu konfiguracji poczty." }, 502);
      }

      await patchRequest(item.id, {
        status: "approved",
        assigned_player_id: playerId,
        approved_at: new Date().toISOString(),
        verification_token_hash: null,
        verification_expires_at: null
      });
      return json({ ok: true, message: "Profil zatwierdzony, PIN zapisany i wiadomość wysłana." });
    }

    return json({ error: "Niedozwolona metoda." }, 405);
  } catch (error) {
    console.error("registrations function error", error);
    return json({ error: error?.message || "Błąd serwera przy obsłudze rejestracji." }, 500);
  }
};
