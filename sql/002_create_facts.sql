-- Facts extracted from events (deterministic parser v0)

create table if not exists public.facts (
  id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade,

  fact_type text not null,
  fact_payload jsonb not null default '{}'::jsonb,
  confidence numeric,

  created_at timestamptz not null default now()
);

create index if not exists idx_facts_event_id on public.facts (event_id);
create index if not exists idx_facts_fact_type on public.facts (fact_type);
create index if not exists idx_facts_created_at on public.facts (created_at desc);

