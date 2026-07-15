-- IMPORTANT: Do not run this migration until all of the following are true:
-- 1. The matching application version is deployed and Supabase Auth login succeeds.
-- 2. A fresh database backup has been created and a restore has been verified.
-- 3. The rollback section in docs/SUPABASE_AUTH_ROLLOUT.md is available.

BEGIN;

-- Remove anonymous access from every current object in the exposed public schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Future tables and RPC functions created by this migration owner inherit the same rule.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Replace every permissive policy on business tables with authenticated-only access.
DO $migration$
DECLARE
  table_name text;
  policy_name text;
  business_tables text[] := ARRAY[
    'categories',
    'suppliers',
    'customers',
    'products',
    'purchase_orders',
    'purchase_order_items',
    'purchase_returns',
    'purchase_return_items',
    'sales_orders',
    'sales_order_items',
    'sales_returns',
    'sales_return_items',
    'accounts_receivable',
    'accounts_payable',
    'ar_receipts'
  ];
BEGIN
  FOREACH table_name IN ARRAY business_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required business table public.% is missing', table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    FOR policy_name IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'Authenticated users only',
      table_name
    );
  END LOOP;
END
$migration$;

COMMIT;

-- Verification (run after commit):
-- * An anon REST request to a business table must return 401/403 and no rows.
-- * An authenticated request must be able to read and write a disposable test record
--   in a non-production verification environment.
-- * pg_policies must show only the authenticated policy for the listed tables.
