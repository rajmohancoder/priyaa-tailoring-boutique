create table if not exists public.customers (
  id text primary key,
  name text not null,
  mobile text not null,
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  garment text not null,
  garment_label text not null,
  delivery_date date,
  status text not null default 'New',
  measurements jsonb not null default '{}'::jsonb,
  total_amount numeric,
  advance_paid numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_id_idx on public.orders (customer_id);

create table if not exists public.settings (
  id text primary key default 'app',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.settings (id, data)
values ('app', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.settings enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.customers, public.orders, public.settings to anon, authenticated;

drop policy if exists full_access_customers on public.customers;
create policy full_access_customers on public.customers
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists full_access_orders on public.orders;
create policy full_access_orders on public.orders
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists full_access_settings on public.settings;
create policy full_access_settings on public.settings
  for all to anon, authenticated
  using (true) with check (true);
