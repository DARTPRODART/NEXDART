-- NEXDART: zgłoszenia rejestracyjne zawodników
-- Uruchom w SQL Editorze WYŁĄCZNIE w osobnym projekcie Supabase dla Deploy Preview.
create extension if not exists pgcrypto;

create table if not exists public.player_registration_requests (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (char_length(player_name) between 2 and 120),
  email text not null,
  email_normalized text not null,
  status text not null default 'pending_email'
    check (status in ('pending_email','pending_review','approved','rejected')),
  email_verified_at timestamptz,
  verification_token_hash text,
  verification_expires_at timestamptz,
  assigned_player_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists player_registration_requests_status_created_idx
  on public.player_registration_requests (status, created_at desc);

create unique index if not exists player_registration_requests_active_email_idx
  on public.player_registration_requests (email_normalized)
  where status in ('pending_email','pending_review','approved');

alter table public.player_registration_requests enable row level security;
revoke all on public.player_registration_requests from anon, authenticated;
grant all on public.player_registration_requests to service_role;
