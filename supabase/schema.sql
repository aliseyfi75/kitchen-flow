-- ============================================================
-- KitchenFlow — Phase 2 Supabase Database Schema & Strict RLS
-- Run this once in your Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Households table (1 row for your shared household)
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Kitchen',
  created_at timestamptz not null default now()
);

-- 2. Whitelisted household members (ONLY you and your wife)
create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

-- 3. Shared real-time kitchen state (atomic JSONB sync)
create table if not exists public.household_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- Enable Row Level Security (locks all data even though GitHub repo is public!)
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_state enable row level security;

-- Helper function: returns the caller's household_id if they are a whitelisted member
create or replace function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

-- Policies: ONLY authenticated members of the household can read/write
drop policy if exists "Members read own household" on public.households;
create policy "Members read own household"
  on public.households for select
  using (id = public.my_household_id());

drop policy if exists "Members read own membership" on public.household_members;
create policy "Members read own membership"
  on public.household_members for select
  using (household_id = public.my_household_id());

drop policy if exists "Members read household state" on public.household_state;
create policy "Members read household state"
  on public.household_state for select
  using (household_id = public.my_household_id());

drop policy if exists "Members insert household state" on public.household_state;
create policy "Members insert household state"
  on public.household_state for insert
  with check (household_id = public.my_household_id());

drop policy if exists "Members update household state" on public.household_state;
create policy "Members update household state"
  on public.household_state for update
  using (household_id = public.my_household_id())
  with check (household_id = public.my_household_id());

-- Enable Supabase Realtime on household_state for instant 2-phone sync
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'household_state'
  ) then
    alter publication supabase_realtime add table public.household_state;
  end if;
end $$;

-- ============================================================
-- NEXT STEP (run AFTER creating your 2 users in Auth -> Users):
-- Replace the two emails below with your and your wife's emails
-- and run this block once in SQL Editor:
-- ============================================================
/*
do $$
declare
  hh_id uuid;
  user1 uuid;
  user2 uuid;
begin
  insert into public.households (name) values ('Ali & Partner Kitchen') returning id into hh_id;

  select id into user1 from auth.users where email = 'YOUR_EMAIL@example.com' limit 1;
  select id into user2 from auth.users where email = 'WIFE_EMAIL@example.com' limit 1;

  if user1 is not null then
    insert into public.household_members (user_id, household_id, display_name, role)
    values (user1, hh_id, 'Ali', 'owner')
    on conflict (user_id) do nothing;
  end if;

  if user2 is not null then
    insert into public.household_members (user_id, household_id, display_name, role)
    values (user2, hh_id, 'Partner', 'member')
    on conflict (user_id) do nothing;
  end if;
end $$;
*/
