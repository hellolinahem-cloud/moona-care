-- ============================================================
--  Moona Care — Supabase schema
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to run once on a fresh project.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Parent',
  lang         text not null default 'kh',
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Parent'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- families ----------
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My family',
  invite_code text not null unique,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      text not null default 'parent',
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- SECURITY DEFINER so RLS policies can call it without recursing
create or replace function public.is_member(fid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

-- ---------- babies ----------
create table if not exists public.babies (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families on delete cascade,
  name          text not null default 'Baby',
  dob           date,
  feed_interval numeric not null default 3,
  created_at    timestamptz not null default now()
);

-- ---------- events (feed / sleep / diaper / pump / temp / med) ----------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  baby_id     uuid not null references public.babies on delete cascade,
  kind        text not null check (kind in ('feed','sleep','diaper','pump','temp','med')),
  at          timestamptz not null default now(),
  side        text,          -- L | R | B (bottle) | S (solid)
  ml          numeric,
  minutes     integer,
  diaper      text,          -- wet | dirty | both
  med_name    text,
  dose        text,
  every_hours numeric,
  temp_c      numeric,
  note        text,
  by_user     uuid references auth.users on delete set null,
  by_name     text,
  created_at  timestamptz not null default now()
);
create index if not exists events_baby_at_idx on public.events (baby_id, at desc);

-- ---------- milk batches ----------
create table if not exists public.milk_batches (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families on delete cascade,
  baby_id      uuid not null references public.babies on delete cascade,
  label_no     integer,                                   -- printed on the bag: MC-0042
  ml           numeric not null,
  expressed_at timestamptz not null default now(),
  phase        text not null default 'day'                -- day | night
               check (phase in ('day','night')),
  place        text not null default 'freezer'            -- room | fridge | freezer | thawed
               check (place in ('room','fridge','freezer','thawed')),
  place_at     timestamptz not null default now(),
  used_at      timestamptz,
  by_name      text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists milk_family_idx on public.milk_batches (family_id, used_at, expressed_at);

-- per-family running label number
create or replace function public.set_label_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.label_no is null then
    select coalesce(max(label_no), 0) + 1 into new.label_no
      from public.milk_batches where family_id = new.family_id;
  end if;
  return new;
end $$;

drop trigger if exists t_milk_label on public.milk_batches;
create trigger t_milk_label before insert on public.milk_batches
  for each row execute function public.set_label_no();

-- ---------- vaccinations ----------
create table if not exists public.vaccinations (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  baby_id   uuid not null references public.babies on delete cascade,
  code      text not null,
  given_at  date not null default current_date,
  note      text,
  unique (baby_id, code)
);

-- ---------- appointments ----------
create table if not exists public.appointments (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  baby_id   uuid not null references public.babies on delete cascade,
  title     text not null,
  at        timestamptz not null,
  note      text
);

-- ---------- growth ----------
create table if not exists public.growth (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  baby_id   uuid not null references public.babies on delete cascade,
  at        timestamptz not null default now(),
  kg        numeric,
  cm        numeric,
  head_cm   numeric
);

-- ============================================================
--  Row Level Security — a family can only ever read its own rows
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.babies         enable row level security;
alter table public.events         enable row level security;
alter table public.milk_batches   enable row level security;
alter table public.vaccinations   enable row level security;
alter table public.appointments   enable row level security;
alter table public.growth         enable row level security;

drop policy if exists p_profile_self on public.profiles;
create policy p_profile_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists p_family_read on public.families;
create policy p_family_read on public.families
  for select using (public.is_member(id));
drop policy if exists p_family_write on public.families;
create policy p_family_write on public.families
  for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists p_member_read on public.family_members;
create policy p_member_read on public.family_members
  for select using (user_id = auth.uid() or public.is_member(family_id));
drop policy if exists p_member_leave on public.family_members;
create policy p_member_leave on public.family_members
  for delete using (user_id = auth.uid());

-- one identical policy shape for every family-scoped table
do $$
declare tbl text;
begin
  foreach tbl in array array['babies','events','milk_batches','vaccinations','appointments','growth']
  loop
    execute format('drop policy if exists p_%1$s_all on public.%1$I', tbl);
    execute format(
      'create policy p_%1$s_all on public.%1$I for all
         using (public.is_member(family_id))
         with check (public.is_member(family_id))', tbl);
  end loop;
end $$;

-- ============================================================
--  Joining a family — done through functions so nobody can
--  add themselves to a family they do not have the code for
-- ============================================================
create or replace function public.create_family(p_name text, p_baby text, p_dob date)
returns public.families language plpgsql security definer set search_path = public as $$
declare f public.families; c text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.families where invite_code = c);
  end loop;

  insert into public.families (name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'My family'), c, auth.uid())
  returning * into f;

  insert into public.family_members (family_id, user_id, role)
  values (f.id, auth.uid(), 'owner');

  insert into public.babies (family_id, name, dob)
  values (f.id, coalesce(nullif(trim(p_baby), ''), 'Baby'), p_dob);

  return f;
end $$;

create or replace function public.join_family(p_code text)
returns public.families language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into f from public.families
    where invite_code = upper(trim(p_code));
  if f.id is null then raise exception 'INVALID_CODE'; end if;
  insert into public.family_members (family_id, user_id, role)
  values (f.id, auth.uid(), 'parent')
  on conflict do nothing;
  return f;
end $$;

grant execute on function public.create_family(text, text, date) to authenticated;
grant execute on function public.join_family(text) to authenticated;

-- ---------- live updates between the two phones ----------
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.milk_batches;
alter publication supabase_realtime add table public.vaccinations;
