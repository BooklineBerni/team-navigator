-- =============================================================================
-- Migration: fix signup trigger
-- Date: 2026-05-18
-- Purpose: Real users (even ones in signup_allowlist) were getting
--          "Database error saving new user" from Supabase Auth. The previous
--          handle_new_user trigger had two failure modes:
--            (a) raise exception when email not in allowlist → 500 from Supabase
--            (b) the INSERT into public.user_permissions could fail silently if
--                the table didn't have the columns the trigger referenced
--                (email, granted_at, updated_at), or if there was no UNIQUE
--                constraint on user_id (so `on conflict (user_id)` would error).
--          Either failure aborts the `INSERT into auth.users`, breaking signup.
--
--          This migration:
--            1. Ensures user_permissions has every column the trigger needs.
--            2. Rewrites handle_new_user to:
--                 - never raise (no allowlist gate at the DB level)
--                 - wrap the user_permissions insert in exception handler so a
--                   missing column / constraint cannot break signup
--                 - still pre-fill permission from signup_allowlist when present
--                 - still force bernat@bookline.ai to admin
--          App-level UX: users that signup without a permission row see the
--          "Waiting for an admin to grant you access" gate (already wired in
--          lib/supabase-auth.js → bnAuthResolveGate).
-- =============================================================================

-- 1) Make sure user_permissions has every column handle_new_user references.
alter table public.user_permissions add column if not exists email      text;
alter table public.user_permissions add column if not exists granted_at timestamptz default now();
alter table public.user_permissions add column if not exists updated_at timestamptz default now();

-- 2) Ensure user_id is unique so `on conflict (user_id) do update` works.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_permissions'::regclass
      and contype  = 'u'
      and conkey   = (select array_agg(attnum)
                      from pg_attribute
                      where attrelid = 'public.user_permissions'::regclass
                        and attname = 'user_id')
  ) then
    -- Wrap in EXCEPTION block so a pre-existing PRIMARY KEY on user_id
    -- (which already enforces uniqueness) doesn't break the migration.
    begin
      alter table public.user_permissions add constraint user_permissions_user_id_key unique (user_id);
    exception when others then
      -- Either already unique via PK or duplicate constraint name; ignore.
      null;
    end;
  end if;
end $$;

-- 3) Defensive rewrite of handle_new_user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_perm text;
begin
  -- Pre-assigned permission from allowlist (if any). NULL means "not in allowlist".
  begin
    select permission into v_perm
    from public.signup_allowlist
    where lower(email) = lower(new.email)
    limit 1;
  exception when others then
    -- signup_allowlist might not exist in this environment; fall through.
    v_perm := null;
  end;

  -- Owner override: always admin, no matter what.
  if lower(new.email) = 'bernat@bookline.ai' then
    v_perm := 'admin';
  end if;

  -- Default fallback: new users with no allowlist entry start at 'none'.
  -- The app shows them a "waiting for permission" gate; RLS blocks data access
  -- until the admin promotes them. We do NOT block signup at the DB level —
  -- a failing trigger here returns "Database error saving new user" to the
  -- client, which is a terrible UX and hard to diagnose.
  v_perm := coalesce(v_perm, 'none');

  -- Best-effort: write the permission row. Wrap in exception handler so a
  -- missing column / dropped constraint / RLS misconfiguration here can NEVER
  -- abort the parent INSERT on auth.users.
  begin
    insert into public.user_permissions (user_id, email, permission, granted_at, updated_at)
    values (new.id, new.email, v_perm, now(), now())
    on conflict (user_id) do update set
      email      = excluded.email,
      permission = excluded.permission,
      updated_at = now();
  exception when others then
    -- Log the failure to the Postgres log (visible in Supabase dashboard → Logs)
    -- but do NOT propagate — signup must succeed even if this side-effect fails.
    raise warning '[handle_new_user] user_permissions upsert failed for %: % (sqlstate %)',
      new.email, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- 4) Re-bind trigger (idempotent: drops + recreates). IMPORTANT: also drop
--    `restrict_signup_trigger`, the BEFORE INSERT trigger that was installed by
--    an earlier migration/dashboard edit and was the REAL cause of "Database
--    error saving new user" for any user not in the allowlist (or whose
--    allowlist row didn't match the trigger's exact comparison). We don't
--    re-create it — the handle_new_user function now handles the per-user
--    permission setup defensively, and the app shows a "Waiting for an admin"
--    gate when the user has no permission row.
drop trigger if exists on_auth_user_created      on auth.users;
drop trigger if exists restrict_signup_trigger    on auth.users;
drop trigger if exists restrict_signup_to_berni   on auth.users;
drop trigger if exists restrict_signup_to_allowlist on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
