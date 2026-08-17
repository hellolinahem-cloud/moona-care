-- ============================================================
--  Moona Care — account deletion
--  Required by Google Play and the App Store, and promised in
--  the privacy policy. Run AFTER schema.sql and schema-nssf.sql.
-- ============================================================

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare fid uuid; remaining int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;

  -- leave every family; if nobody else is left, the family and all of its
  -- records (babies, events, milk, vaccinations, appointments, growth, NSSF)
  -- are removed by the on-delete-cascade foreign keys
  for fid in select family_id from public.family_members where user_id = auth.uid()
  loop
    delete from public.family_members where family_id = fid and user_id = auth.uid();
    select count(*) into remaining from public.family_members where family_id = fid;
    if remaining = 0 then
      delete from public.families where id = fid;
    end if;
  end loop;

  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Note: this function must be owned by a role that can delete from auth.users.
-- Running it in the Supabase SQL editor makes the owner `postgres`, which can.
-- Verify with:  select proname, pg_get_userbyid(proowner) from pg_proc
--               where proname = 'delete_my_account';
