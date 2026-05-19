-- =============================================================================
-- Migration: member_set_task_status — also autofill startedDate / endedDate
-- Date: 2026-05-20
-- Purpose: Mirror the client-side autofill rule on the server:
--          • new status === 'In Progress'    AND startedDate empty → today
--          • new status IN ('Completed','Discarded') AND endedDate empty → today
--          Manual edits via the admin modal still win — the RPC only writes
--          startedDate / endedDate when the field is currently empty/missing
--          (so member-driven transitions can never overwrite an admin's manual
--          value). Re-saving a task that's already In Progress does nothing
--          because the field is no longer empty.
-- =============================================================================

create or replace function public.member_set_task_status(p_task_id text, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_perm           text;
  v_admin_user_id  uuid;
  v_store          jsonb;
  v_tasks          jsonb;
  v_idx            int;
  v_resp           text;
  v_slack          text;
  v_today          text;
  v_existing_start text;
  v_existing_end   text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select permission into v_perm from public.user_permissions where user_id = auth.uid();
  if v_perm is null or v_perm not in ('admin','member') then
    raise exception 'Permission denied (perm=%)', coalesce(v_perm,'null');
  end if;

  if p_status not in ('','Waiting','Proposed','Later / Next','In Progress','Under Review','Completed','Archived','Discarded') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select user_id into v_admin_user_id
    from public.user_permissions
   where permission = 'admin'
   order by case when lower(email) = 'bernat@bookline.ai' then 0 else 1 end,
            granted_at asc
   limit 1;
  if v_admin_user_id is null then raise exception 'No admin found'; end if;

  select store_data into v_store from public.user_stores where user_id = v_admin_user_id;
  if v_store is null then raise exception 'Admin store not found'; end if;

  v_tasks := v_store -> 'tasks';
  if v_tasks is null or jsonb_typeof(v_tasks) <> 'array' then
    raise exception 'Admin store has no tasks array';
  end if;

  select (ord-1)::int, elem ->> 'responsibleId', elem ->> 'startedDate', elem ->> 'endedDate'
    into v_idx, v_resp, v_existing_start, v_existing_end
    from jsonb_array_elements(v_tasks) with ordinality as arr(elem, ord)
   where elem ->> 'id' = p_task_id
   limit 1;
  if v_idx is null then raise exception 'Task % not found in admin store', p_task_id; end if;

  if v_perm = 'member' then
    select slack_id into v_slack from public.user_permissions where user_id = auth.uid();
    if v_slack is null then
      raise exception 'Caller (member) has no slack_id mapping. Admin must set user_permissions.slack_id for this user before they can edit task status.';
    end if;
    if v_resp is null or v_resp <> v_slack then
      raise exception 'Not your task (responsibleId=%, your slack_id=%)', coalesce(v_resp,'null'), v_slack;
    end if;
  end if;

  -- Patch the status first.
  v_store := jsonb_set(v_store, array['tasks', v_idx::text, 'slackStatus'], to_jsonb(p_status), true);

  -- Autofill the timing fields, ONCE, ONLY when currently empty/missing/null.
  v_today := to_char(current_date, 'YYYY-MM-DD');
  if p_status = 'In Progress' and (v_existing_start is null or v_existing_start = '') then
    v_store := jsonb_set(v_store, array['tasks', v_idx::text, 'startedDate'], to_jsonb(v_today), true);
  end if;
  if (p_status = 'Completed' or p_status = 'Discarded')
     and (v_existing_end is null or v_existing_end = '') then
    v_store := jsonb_set(v_store, array['tasks', v_idx::text, 'endedDate'], to_jsonb(v_today), true);
  end if;

  update public.user_stores
     set store_data = v_store,
         updated_at = now()
   where user_id = v_admin_user_id;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'new_status', p_status);
end;
$$;

grant execute on function public.member_set_task_status(text, text) to authenticated;
