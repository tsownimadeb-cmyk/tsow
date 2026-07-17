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

-- Replace every permissive policy on every exposed public table with
-- authenticated-only access. Discovering the tables from PostgreSQL keeps the
-- lock-down complete when a table (for example stock_adjustments or an import
-- staging table) was added outside the original bootstrap migration.
DO $migration$
DECLARE
  target_table text;
  policy_name text;
  protected_table_count integer := 0;
BEGIN
  FOR target_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    protected_table_count := protected_table_count + 1;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    FOR policy_name IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, target_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'Authenticated users only',
      target_table
    );
  END LOOP;

  IF protected_table_count = 0 THEN
    RAISE EXCEPTION 'No public tables were found to protect';
  END IF;
END
$migration$;

-- Make the payable statement view obey the permissions and RLS policies of
-- the authenticated caller instead of the view owner's elevated privileges.
DO $migration$
BEGIN
  IF to_regclass('public.supplier_statement_payable') IS NOT NULL THEN
    ALTER VIEW public.supplier_statement_payable SET (security_invoker = true);
  END IF;
END
$migration$;

COMMIT;

-- Verification (run after commit):
-- * An anon REST request to a business table must return 401/403 and no rows.
-- * An authenticated request must be able to read and write a disposable test record
--   in a non-production verification environment.
-- * pg_policies must show one authenticated policy for every public table.
