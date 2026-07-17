import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(
  join(process.cwd(), "scripts", "047-lock-down-supabase-authenticated-only.sql"),
  "utf8",
)

describe("Supabase authenticated-only migration", () => {
  it("revokes public and anonymous table/RPC access", () => {
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA public FROM PUBLIC, anon/i)
    expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon/i)
    expect(sql).toMatch(/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon/i)
  })

  it("discovers and protects every public base or partitioned table", () => {
    expect(sql).toMatch(/JOIN pg_namespace n ON n\.oid = c\.relnamespace/i)
    expect(sql).toMatch(/n\.nspname = 'public'/i)
    expect(sql).toMatch(/c\.relkind IN \('r', 'p'\)/i)
    expect(sql).toMatch(/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i)
    expect(sql).toMatch(/No public tables were found to protect/i)
  })

  it("makes the payable statement view obey the caller's permissions", () => {
    expect(sql).toMatch(/ALTER VIEW public\.supplier_statement_payable SET \(security_invoker = true\)/i)
  })

  it("creates policies only for authenticated users", () => {
    expect(sql).toMatch(/FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/i)
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*TO anon/i)
  })
})
