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

  it("covers every business table including returns and accounts", () => {
    for (const table of [
      "products",
      "customers",
      "suppliers",
      "purchase_orders",
      "purchase_order_items",
      "purchase_returns",
      "purchase_return_items",
      "sales_orders",
      "sales_order_items",
      "sales_returns",
      "sales_return_items",
      "accounts_receivable",
      "accounts_payable",
      "ar_receipts",
    ]) {
      expect(sql).toContain(`'${table}'`)
    }
  })

  it("creates policies only for authenticated users", () => {
    expect(sql).toMatch(/FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/i)
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*TO anon/i)
  })
})
