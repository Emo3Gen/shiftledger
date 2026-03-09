-- Создание таблицы public.events для хранения chat events.
-- Выполнить в Supabase (SQL editor / psql).

create table if not exists public.events (
  id bigserial primary key,
  trace_id text not null,
  source text not null default 'emu',
  chat_id text not null,
  user_id text not null,
  text text not null default '',
  role text,
  meta jsonb default '{}'::jsonb,
  status text not null default 'received',
  received_at timestamptz not null default now()
);

create index if not exists idx_events_trace_id on public.events (trace_id);
create index if not exists idx_events_chat_id on public.events (chat_id);
create index if not exists idx_events_user_id on public.events (user_id);
create index if not exists idx_events_received_at on public.events (received_at desc);

