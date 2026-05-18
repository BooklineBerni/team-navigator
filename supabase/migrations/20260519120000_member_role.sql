-- =============================================================================
-- Migration: member role
-- Date: 2026-05-19
-- Purpose: Introduce a third permission level "member" that sits between
--          restricted_view and admin. Members see the app exactly like
--          restricted_view (everything read-only), but can update the
--          slackStatus field on tasks where they are the responsibleId.
--
--          Why an RPC: the master STORE lives in user_stores under the admin's
--          user_id. Members can't write to that row directly (RLS denies). The
--          RPC member_set_task_status() runs SECURITY DEFINER, validates the
--          caller's permission and the caller's ownership of the target task,
--          and patches only the one field on the master store.
-- =============================================================================

-- 1) Drop any old CHECK constraint that hard-codes the legacy permission set.
--    (We don't add a CHECK constraint going forward — keep the column free-form
--    so future roles can be added without another migration.)
do $$
declare
  v_conname text;
begin
  for v_conname in
    select conname from pg_constraint
     where conrelid = 'public.user_permissions'::regclass
       and contype  = 'c'
  loop
    -- Only drop check constraints that reference the "permission" column
    if exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.user_permissions'::regclass
        and a.attname  = 'permission'
        and a.attnum   = any (
          (select conkey from pg_constraint where conname = v_conname and conrelid = 'public.user_permissions'::regclass)
        )
    ) then
      execute format('alter table public.user_permissions drop constraint %I', v_conname);
    end if;
  end loop;
end $$;

-- Same for signup_allowlist (it has the same column with the same legacy CHECK).
do $$
declare
  v_conname text;
begin
  for v_conname in
    select conname from pg_constraint
     where conrelid = 'public.signup_allowlist'::regclass
       and contype  = 'c'
  loop
    if exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.signup_allowlist'::regclass
        and a.attname  = 'permission'
        and a.attnum   = any (
          (select conkey from pg_constraint where conname = v_conname and conrelid = 'public.signup_allowlist'::regclass)
        )
    ) then
      execute format('alter table public.signup_allowlist drop constraint %I', v_conname);
    end if;
  end loop;
end $$;

-- 2) The RPC. Calls auth.uid() to identify the member, reads their permission
--    row, validates "member", loads the admin's store, finds the task, checks
--    ownership, patches slackStatus, saves.
create or replace function public.member_set_task_status(p_task_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid := auth.uid();
  v_caller_email   text;
  v_caller_perm    text;
  v_admin_user_id  uuid;
  v_store          jsonb;
  v_tasks          jsonb;
  v_idx            int;
  v_task_resp      text;
  v_caller_slackid text;
begin
  if v_caller_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Caller's email + permission
  select email into v_caller_email from auth.users where id = v_caller_uid;
  select permission into v_caller_perm
    from public.user_permissions
   where user_id = v_caller_uid;

  if v_caller_perm is null or v_caller_perm <> 'member' then
    raise exception 'Permission denied: caller is not a member (perm=%)', coalesce(v_caller_perm,'null');
  end if;

  -- Whitelist of allowed status values (mirrors STATUS_ORDER on the client).
  if p_status not in ('','Waiting','Proposed','Later / Next','In Progress',
                      'Under Review','Completed','Archived','Discarded') then
    raise exception 'Invalid status: %', p_status;
  end if;

  -- Find THE admin (single-admin deploy). If there are multiple, fall back to
  -- the bookline owner.
  select user_id into v_admin_user_id
    from public.user_permissions
   where permission = 'admin'
   order by case when lower(email) = 'bernat@bookline.ai' then 0 else 1 end,
            granted_at asc
   limit 1;

  if v_admin_user_id is null then
    raise exception 'No admin found';
  end if;

  -- Read admin's store
  select store_data into v_store
    from public.user_stores
   where user_id = v_admin_user_id;

  if v_store is null then
    raise exception 'Admin user_stores row not found';
  end if;

  v_tasks := v_store -> 'tasks';
  if v_tasks is null or jsonb_typeof(v_tasks) <> 'array' then
    raise exception 'Admin store has no tasks array';
  end if;

  -- Locate the task by id
  select (ord - 1)::int, elem ->> 'responsibleId'
    into v_idx, v_task_resp
    from jsonb_array_elements(v_tasks) with ordinality as arr(elem, ord)
   where elem ->> 'id' = p_task_id
   limit 1;

  if v_idx is null then
    raise exception 'Task % not found in admin store', p_task_id;
  end if;

  -- Ownership check: the caller's Slack id (stored in user_permissions.slack_id
  -- once admin adds it, OR resolved from email via signup_allowlist.slack_id).
  -- We accept either source so the admin can configure it once. If no
  -- slack_id mapping exists yet, we DENY — better safe than sorry. The admin
  -- can grant per-task overrides by setting user_permissions.slack_id.
  begin
    select slack_id into v_caller_slackid
      from public.user_permissions
     where user_id = v_caller_uid;
  exception when undefined_column then
    -- slack_id column not added yet; will be created below in step 3.
    v_caller_slackid := null;
  end;

  if v_caller_slackid is null then
    -- Soft-fall to email match: if the task's responsibleId LOOKS like an
    -- email and equals the caller's email, accept. This lets the feature
    -- work in deploys that store emails as responsibleId.
    if v_task_resp is not null and lower(v_task_resp) = lower(v_caller_email) then
      null;  -- ok
    else
      raise exception 'Caller has no slack_id mapping — admin must set it. ' ||
                      'Required for member ownership checks.';
    end if;
  else
    if v_task_resp is null or v_task_resp <> v_caller_slackid then
      raise exception 'Caller does not own this task (task.responsibleId=%, caller.slack_id=%)',
                      coalesce(v_task_resp,'null'), v_caller_slackid;
    end if;
  end if;

  -- Patch only the slackStatus
  v_store := jsonb_set(
    v_store,
    array['tasks', v_idx::text, 'slackStatus'],
    to_jsonb(p_status),
    true
  );

  update public.user_stores
     set store_data = v_store,
         updated_at = now()
   where user_id = v_admin_user_id;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'new_status', p_status);
end;
$$;

grant execute on function public.member_set_task_status(text, text) to authenticated;

-- 3) Optional: add a slack_id column to user_permissions for clean ownership
--    checks. Admin can fill it in when promoting a user to member.
alter table public.user_permissions add column if not exists slack_id text;

-- 4) Update get_filtered_store so 'member' callers see the same view as
--    'restricted_view'. The RPC already lives in the DB; rather than rewrite
--    its body here (which would require duplicating its full logic), we rely
--    on the convention that any non-admin permission is treated as restricted.
--    If your get_filtered_store has a `if permission = 'restricted_view'`
--    branch, update it to `if permission in ('restricted_view','member')`.
--
--    This migration intentionally does NOT touch get_filtered_store — adapt
--    it manually if your get_filtered_store hard-codes the legacy set.
