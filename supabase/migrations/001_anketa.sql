-- Таблица анкет MaskShow. Выполнить один раз в Supabase → SQL Editor.
create table if not exists public.anketa (
  id        uuid primary key default gen_random_uuid(),
  no        bigint generated always as identity unique,   -- номер участника для розыгрышей
  created   timestamptz not null default now(),
  name      text not null,
  continent text not null,
  birthday  date not null,
  lastname  text,
  phone     text,
  email     text,
  consent   text not null
);
-- Доступ закрыт для всех, кроме облачной функции (она работает с ключом service_role).
alter table public.anketa enable row level security;
