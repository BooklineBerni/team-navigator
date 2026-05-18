-- =============================================================================
-- Migration: update admin RPCs to accept the 'member' permission
-- Date: 2026-05-19
-- Purpose: The previous migration (20260519120000_member_role.sql) added the
--          'member' role on the client side and dropped legacy CHECK
--          constraints on the permission columns, but the SECURITY DEFINER
--          RPCs that the admin UI calls (admin_grant_permission and
--          admin_set_allowlist_permission) still hard-code the old whitelist
--          and reject 'member' with "Invalid permission: member" /
--          "invalid_permission".
--
--          Rewrite both RPCs to accept the expanded set and to preserve all
--          previous behaviour (admin-only, target row updated, updated_at
--          touched). Also rewrite admin_add_allowlist to accept the new
--          permission on insert so an admin can invite someone directly as
--          a member.
-- =============================================================================

-- Helper: is the caller an admin?
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.user_permissions
     where user_id = auth.uid()
       and permission = 'admin'
  )
$$;

grant execute on function public.is_admin() to authenticated;

-- 1) admin_grant_permission(target_user_id uuid, new_permission text)
--    Updates user_permissions for an existing (already signed-in) user.
create or replace function public.admin_grant_permission(
  target_user_id uuid,
  new_permission text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Permission denied: caller is not an admin';
  end if;
  if new_permission not in ('none','restricted_view','member','admin') then
    raise exception 'invalid_permission: %', new_permission;
  end if;
  update public.user_permissions
     set permission = new_permission,
         updated_at = now()
   where user_id = target_user_id;
end;
$$;

grant execute on function public.admin_grant_permission(uuid, text) to authenticated;

-- 2) admin_set_allowlist_permission(target_email text, new_permission text)
--    Updates signup_allowlist for a pending invitation.
create or replace function public.admin_set_allowlist_permission(
  target_email text,
  new_permission text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Permission denied: caller is not an admin';
  end if;
  if new_permission not in ('none','restricted_view','member','admin') then
    raise exception 'Invalid permission: %', new_permission;
  end if;
  update public.signup_allowlist
     set permission = new_permission
   where lower(email) = lower(target_email);
end;
$$;

grant execute on function public.admin_set_allowlist_permission(text, text) to authenticated;

-- 3) admin_add_allowlist(target_email text, target_notes text, target_permission text)
--    Idempotent: upsert by email. Accept the expanded permission set.
create or replace function public.admin_add_allowlist(
  target_email text,
  target_notes text default null,
  target_permission text default 'restricted_view'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Permission denied: caller is not an admin';
  end if;
  if target_permission is null then target_permission := 'restricted_view'; end if;
  if target_permission not in ('none','restricted_view','member','admin') then
    raise exception 'Invalid permission: %', target_permission;
  end if;
  insert into public.signup_allowlist (email, notes, permission, added_at)
  values (lower(target_email), target_notes, target_permission, now())
  on conflict (email) do update set
    notes      = excluded.notes,
    permission = excluded.permission;
end;
$$;

grant execute on function public.admin_add_allowlist(text, text, text) to authenticated;

-- 4) admin_remove_allowlist(target_email text)
--    Recreate with admin check (in case it was missing). Idempotent delete.
create or replace function public.admin_remove_allowlist(target_email text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Permission denied: caller is not an admin';
  end if;
  delete from public.signup_allowlist where lower(email) = lower(target_email);
end;
$$;

grant execute on function public.admin_remove_allowlist(text) to authenticated;

-- 5) NEW: admin_revoke_user_access(target_user_id uuid)
--    Removes a signed-in user from BOTH user_permissions and signup_allowlist
--    in one call. Used by the redesigned Admin UI to revoke access from the
--    Per-user permissions panel (instead of having a Remove button in the
--    allowlist for already-signed-in users).
create or replace function public.admin_revoke_user_access(target_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if not is_admin() then
    raise exception 'Permission denied: caller is not an admin';
  end if;
  -- Look up the email so we can also clean up the allowlist row.
  select email into v_email from public.user_permissions where user_id = target_user_id;
  delete from public.user_permissions where user_id = target_user_id;
  if v_email is not null then
    delete from public.signup_allowlist where lower(email) = lower(v_email);
  end if;
end;
$$;

grant execute on function public.admin_revoke_user_access(uuid) to authenticated;
