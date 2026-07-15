import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "scripts", "048-create-order-delete-rpc-functions.sql"),
  "utf8",
)
const salesTable = readFileSync(join(process.cwd(), "components", "sales", "sales-table.tsx"), "utf8")
const purchasesTable = readFileSync(
  join(process.cwd(), "components", "purchases", "purchases-table.tsx"),
  "utf8",
)

describe("atomic order deletion", () => {
  it("serializes delete with save and locks the order row", () => {
    expect(migration).toContain("'sales:' || p_order_id::text")
    expect(migration).toContain("'purchase:' || p_order_id::text")
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it("blocks deletion when financial history or returns would be detached", () => {
    expect(migration).toContain("FROM public.ar_receipts")
    expect(migration).toContain("v_ar.paid_amount > 0")
    expect(migration).toContain("v_ap.paid_amount > 0")
    expect(migration).toContain("FROM public.sales_returns")
    expect(migration).toContain("FROM public.purchase_returns")
  })

  it("validates stock and recalculates purchase totals and cost", () => {
    expect(migration).toContain("IF v_stock < v_item.quantity")
    expect(migration).toContain("purchase_qty_total = COALESCE(v_total_purchase_quantity, 0)")
    expect(migration).toContain("v_landed_purchase_amount / v_total_purchase_quantity")
  })

  it("allows only authenticated RPC execution", () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.delete_sales_order_atomic\(uuid\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_purchase_order_atomic\(uuid\) TO authenticated, service_role/i)
  })

  it("uses one RPC call from each frontend instead of multi-step inventory edits", () => {
    expect(salesTable).toContain("SALES_ORDER_DELETE_ATOMIC_RPC")
    expect(purchasesTable).toContain("PURCHASE_ORDER_DELETE_ATOMIC_RPC")
    expect(salesTable).not.toContain("coalescedStockQty + quantity")
    expect(purchasesTable).not.toContain("Math.max(0, coalescedStockQty - quantity)")
  })
})
