-- My Time Planner: database setup
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- FIRST: replace you@gmail.com below with the Google email you will sign in with.

-- 1. Who may use the app (nobody else can sign up, read, or write)
create table if not exists public.allowed_users (email text primary key);
alter table public.allowed_users enable row level security;   -- no policies: unreadable from the browser
insert into public.allowed_users (email) values (lower('you@gmail.com'))
  on conflict do nothing;

create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- Block sign-ups from any other Google account at the database level
create or replace function public.block_unknown_signups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_users where email = lower(new.email)) then
    raise exception 'This account is not allowed to use this app';
  end if;
  return new;
end $$;
drop trigger if exists only_allowed_signups on auth.users;
create trigger only_allowed_signups before insert on auth.users
  for each row execute function public.block_unknown_signups();

-- 2. Tasks
create table if not exists public.tasks (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  due_date   date not null,
  due_time   text not null default '' check (due_time = '' or due_time ~ '^\d{2}:\d{2}$'),
  alarm      boolean not null default false,
  status     text not null default 'pending' check (status in ('pending','started','ongoing','completed')),
  done       boolean not null default false,
  fired      boolean not null default false,
  created    bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_date on public.tasks (user_id, due_date);

alter table public.tasks enable row level security;
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all to authenticated
  using      (user_id = auth.uid() and public.is_allowed())
  with check (user_id = auth.uid() and public.is_allowed());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- 3. Live sync between your phone and laptop
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
