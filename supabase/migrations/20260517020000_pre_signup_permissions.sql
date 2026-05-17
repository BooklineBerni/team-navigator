-- =============================================================================
-- Migration: pre-signup permissions
-- Date: 2026-05-17
-- Purpose: Let admin assign a permission level to someone BEFORE they sign up.
--          When the user finally signs in, the trigger copies the permission
--          from signup_allowlist.permission into user_permissions.permission.
-- =============================================================================

-- 1) Add `permission` column to signup_allowlist (default 'none').
alter table public.signup_allowlist
  add column if not exists permission text
    check (permission in ('none','restricted_view','admin'))
    default 'none';

-- 2) Re-create admin_add_allowlist to accept an optional permission.
create or replace function public.admin_add_allowlist(
  target_email text,
  target_notes text default null,
  target_permission text default 'none'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized: only admin can modify allowlist';
  end if;
  if target_permission not in ('none','restricted_view','admin') then
    target_permission := 'none';
  end if;
  insert into public.signup_allowlist (email, added_by, added_at, notes, permission)
  values (lower(target_email), auth.uid(), now(), target_notes, target_permission)
  on conflict (email) do update set
    notes = coalesce(excluded.notes, public.signup_allowlist.notes),
    permission = excluded.permission;
end;
$$;

-- 3) New RPC: admin can change permission of an allowlist row independently.
create or replace function public.admin_set_allowlist_permission(
  target_email text,
  new_permission text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if new_permission not in ('none','restricted_view','admin') then
    raise exception 'Invalid permission: %', new_permission;
  end if;
  update public.signup_allowlist
    set permission = new_permission
    where lower(email) = lower(target_email);
end;
$$;

-- 4) Signup trigger: when a new auth user is created, copy permission from allowlist.
--    Replaces whatever trigger function we had before.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_perm text;
  v_in_allowlist boolean := false;
begin
  -- Look up allowlist row for this email.
  select permission into v_perm
  from public.signup_allowlist
  where lower(email) = lower(new.email)
  limit 1;
  if found then v_in_allowlist := true; end if;

  -- Block signups not in the allowlist (except the hardcoded owner).
  if not v_in_allowlist and lower(new.email) <> 'bernat@bookline.ai' then
    raise exception 'Signup not allowed for %', new.email
      using hint = 'Ask the admin to add you to the allowlist first';
  end if;

  -- Owner override: always admin.
  if lower(new.email) = 'bernat@bookline.ai' then
    v_perm := 'admin';
  end if;

  -- Default fallback if column is null for any reason.
  v_perm := coalesce(v_perm, 'none');

  -- Upsert into user_permissions.
  insert into public.user_permissions (user_id, email, permission, granted_at, updated_at)
  values (new.id, new.email, v_perm, now(), now())
  on conflict (user_id) do update set
    email = excluded.email,
    permission = excluded.permission,
    updated_at = now();

  return new;
end;
$$;

-- Re-bind trigger (drop any old ones with similar names, recreate from scratch).
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists restrict_signup_to_berni on auth.users;
drop trigger if exists restrict_signup_to_allowlist on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
