-- Foundation only: no public client access. Apply before deploying operation handlers.
begin;
create table public.drive_operations (
  id uuid primary key,
  owner_subject text not null,
  source_link text not null,
  mode text not null check (mode in ('copy','download','both')),
  state text not null default 'pending' check (state in ('pending','running','dispatching','cancel_requested','cleaning','cancelled','succeeded','failed','cleanup_failed','ready','finalizing','uncertain')),
  result_id text unique,
  result_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_items integer not null default 0 check (completed_items >= 0),
  total_items integer check (total_items >= completed_items)
);
create index drive_operations_owner_idx on public.drive_operations(owner_subject, created_at);
create table public.drive_operation_files (
  operation_id uuid not null references public.drive_operations(id) on delete restrict,
  file_id text not null unique,
  created_at timestamptz not null default now(),
  cleaned_at timestamptz,
  primary key (operation_id,file_id)
);
alter table public.drive_operations enable row level security;
alter table public.drive_operation_files enable row level security;
revoke all on public.drive_operations, public.drive_operation_files from public, anon, authenticated;
grant select, insert, update, delete on public.drive_operations, public.drive_operation_files to service_role;
commit;
