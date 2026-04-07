-- 建立應收帳款收款履歷表
create table if not exists public.ar_receipts (
  id uuid primary key default gen_random_uuid(),
  ar_id uuid null references public.accounts_receivable(id) on delete set null,
  sales_order_id uuid null references public.sales_orders(id) on delete set null,
  order_no text null,
  customer_cno text null,
  customer_name text null,
  payment_date date not null default current_date,
  payment_method text not null,
  payment_amount numeric(12, 2) not null default 0,
  check_no text null,
  check_due_date date null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ar_receipts_payment_date
  on public.ar_receipts (payment_date desc);

create index if not exists idx_ar_receipts_customer_cno
  on public.ar_receipts (customer_cno);

create index if not exists idx_ar_receipts_order_no
  on public.ar_receipts (order_no);

create index if not exists idx_ar_receipts_sales_order_id
  on public.ar_receipts (sales_order_id);

alter table if exists public.ar_receipts enable row level security;

grant all on table public.ar_receipts to anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ar_receipts'
      and policyname = 'Allow public access'
  ) then
    create policy "Allow public access"
      on public.ar_receipts
      for all
      using (true)
      with check (true);
  end if;
end $$;
