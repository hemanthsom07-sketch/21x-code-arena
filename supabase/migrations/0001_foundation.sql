-- Phase 1: profiles + roles + RLS. Run in Supabase SQL editor or `supabase db push`.
create type public.app_role as enum ('student', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  roll_number text unique,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);
create index on public.profiles (role);

-- SECURITY DEFINER avoids recursive RLS when policies check admin status.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "admins read all profiles" on public.profiles for select using (public.is_admin());
create policy "admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
-- No update policy for students: they cannot change their own role.

-- New auth users default to 'student'. Roles are only ever raised by SQL / admins, never by clients.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, roll_number)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'roll_number');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- To make the first admin, after creating the user in Supabase Auth:
--   update public.profiles set role = 'admin' where id = '<USER-UUID>';
