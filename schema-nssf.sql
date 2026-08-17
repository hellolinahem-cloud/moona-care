-- ============================================================
--  Moona Care — NSSF (ប.ស.ស) benefit schedule
--  Run this in Supabase → SQL Editor AFTER schema.sql
-- ============================================================

create table if not exists public.nssf_visits (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  baby_id     uuid not null references public.babies on delete cascade,
  seq         integer not null default 1,          -- row number on the card
  category    text not null default 'child'        -- prenatal | postnatal | child
              check (category in ('prenatal','postnatal','child')),
  due_date    date not null,                       -- កាលបរិច្ឆេទណាត់
  window_end  date,                                -- last day the visit still counts
  done_at     date,                                -- the day it was actually done
  amount      numeric not null default 20,         -- USD paid for this visit
  is_estimate boolean not null default false,      -- true until the parent confirms
                                                   -- the date against their real card
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists nssf_baby_idx on public.nssf_visits (baby_id, due_date);

alter table public.nssf_visits enable row level security;

drop policy if exists p_nssf_all on public.nssf_visits;
create policy p_nssf_all on public.nssf_visits for all
  using (public.is_member(family_id))
  with check (public.is_member(family_id));

alter publication supabase_realtime add table public.nssf_visits;
