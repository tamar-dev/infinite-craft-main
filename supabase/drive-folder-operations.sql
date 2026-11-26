-- Additive migration; leaves existing single-file operations untouched.
begin;
create table if not exists public.drive_folder_operations (
 id uuid primary key,
 owner_subject text not null,
 source_link text not null,
 version integer not null default 0 check (version >= 0),
 plan jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.drive_folder_operations enable row level security;
revoke all on public.drive_folder_operations from public, anon, authenticated;
grant select, insert, update, delete on public.drive_folder_operations to service_role;
commit;
