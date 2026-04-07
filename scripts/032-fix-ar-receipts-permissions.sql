-- 修正 ar_receipts 現有資料表的欄位與權限
alter table if exists public.ar_receipts
  add column if not exists sales_order_id uuid null references public.sales_orders(id) on delete set null;

alter table if exists public.ar_receipts
  add column if not exists customer_name text null;

alter table if exists public.ar_receipts
  add column if not exists check_no text null;

alter table if exists public.ar_receipts
  add column if not exists check_due_date date null;

alter table if exists public.ar_receipts
  add column if not exists notes text null;

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