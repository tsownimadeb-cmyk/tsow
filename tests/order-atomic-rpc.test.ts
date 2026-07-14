import { describe, expect, it } from "vitest"

import {
  isAtomicOrderTransportError,
  isMissingAtomicOrderRpc,
  SALES_ORDER_ATOMIC_RPC,
} from "../lib/order-atomic-rpc"

describe("atomic order RPC error classification", () => {
  it("allows the legacy path only when PostgREST cannot find the RPC", () => {
    expect(
      isMissingAtomicOrderRpc(
        { code: "PGRST202", message: "Could not find the function public.save_sales_order_atomic" },
        SALES_ORDER_ATOMIC_RPC,
      ),
    ).toBe(true)
  })

  it("does not bypass a validation or database error", () => {
    expect(
      isMissingAtomicOrderRpc(
        { code: "P0001", message: "商品 A001 的數量必須大於 0" },
        SALES_ORDER_ATOMIC_RPC,
      ),
    ).toBe(false)
  })

  it("recognizes a Supabase transport failure for offline queuing", () => {
    expect(isAtomicOrderTransportError({ message: "TypeError: fetch failed" })).toBe(true)
  })
})
