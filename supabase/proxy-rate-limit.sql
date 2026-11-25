begin;
create table if not exists public.proxy_rate_limits (
  bucket text primary key,
  hits integer not null,
  expires_at timestamptz not null
);
alter table public.proxy_rate_limits enable row level security;
revoke all on public.proxy_rate_limits from public, anon, authenticated;
create index if not exists proxy_rate_limits_expiry on public.proxy_rate_limits(expires_at);

create or replace function public.proxy_take_rate_limit(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  t timestamptz := clock_timestamp();
  n integer;
begin
  if p_bucket is null or length(p_bucket) > 160 or p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Invalid rate limit';
  end if;
  insert into public.proxy_rate_limits as r (bucket,hits,expires_at)
  values (p_bucket,1,t + interval '1 minute')
  on conflict (bucket) do update set
    hits = case when r.expires_at <= t then 1 else r.hits + 1 end,
    expires_at = case when r.expires_at <= t then t + interval '1 minute' else r.expires_at end
  where r.expires_at <= t or r.hits < p_limit
  returning hits into n;
  return n is not null;
end;
$$;
revoke all on function public.proxy_take_rate_limit(text,integer) from public, anon, authenticated;
grant execute on function public.proxy_take_rate_limit(text,integer) to service_role;
commit;
-- Schedule periodic cleanup separately: delete from public.proxy_rate_limits where expires_at < now() - interval '1 day';
