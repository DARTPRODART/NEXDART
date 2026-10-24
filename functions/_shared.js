export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function envValue(env, name) {
  const value = env?.[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej: ${name}`);
  return value;
}

export async function isAdmin(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  try {
    const response = await fetch(`${envValue(env, "SUPABASE_URL")}/auth/v1/user`, {
      headers: {
        apikey: envValue(env, "SUPABASE_ANON_KEY"),
        Authorization: authorization
      }
    });
    if (!response.ok) return false;
    const user = await response.json();
    return Boolean(user.id) && user.id === envValue(env, "ADMIN_USER_ID");
  } catch {
    return false;
  }
}

export async function dbRequest(env, path, options = {}) {
  const key = envValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  return fetch(`${envValue(env, "SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}
