-- Uruchom w Supabase: SQL Editor -> New query -> wklej cały plik -> Run.
-- Funkcje Netlify korzystają z klucza service_role po stronie serwera.

create table if not exists public.league_state (
  id integer primary key check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_articles (
  id text primary key,
  article jsonb not null,
  published boolean not null default false,
  date text not null default '',
  pinned boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.league_state enable row level security;
alter table public.league_articles enable row level security;

-- Odbierz bezpośredni dostęp do tabel wszystkim rolom przeglądarkowym.
revoke all on table public.league_state from anon, authenticated;
revoke all on table public.league_articles from anon, authenticated;
grant all on table public.league_state to service_role;
grant all on table public.league_articles to service_role;
