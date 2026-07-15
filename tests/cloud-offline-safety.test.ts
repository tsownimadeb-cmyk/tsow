import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  enqueuePendingOperation,
  flushPendingOperations,
  getPendingOperationCount,
} from "../lib/mobile-offline-queue"

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  clear() {
    this.values.clear()
  }
}

describe("browser persistent mutation queue", () => {
  const storage = new MemoryStorage()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal("navigator", { onLine: true })
    vi.stubGlobal("CustomEvent", class CustomEvent { constructor(public type: string) {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("retains an operation when the cloud endpoint returns non-2xx", async () => {
    enqueuePendingOperation({ endpoint: "/api/offline/products", method: "POST", body: { code: "P001" } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("cloud failed", { status: 502 })))

    await expect(flushPendingOperations()).resolves.toMatchObject({ flushed: 0, remaining: 1 })
    expect(getPendingOperationCount()).toBe(1)
  })

  it("removes an operation only after a real success response", async () => {
    enqueuePendingOperation({ endpoint: "/api/offline/products", method: "POST", body: { code: "P001" } })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })),
    )

    await expect(flushPendingOperations()).resolves.toMatchObject({ flushed: 1, remaining: 0 })
    expect(getPendingOperationCount()).toBe(0)
  })
})

describe("cloud API implementation safety", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

  it("does not use the server SQLite sync queue in cloud CRUD routes", () => {
    for (const route of ["products", "customers", "suppliers", "sales", "purchases"]) {
      const contents = source(`app/api/offline/${route}/route.ts`)
      expect(contents).not.toContain("addToSyncQueue")
      expect(contents).toContain("localOnly: true")
    }
  })

  it("awaits return synchronization before responding", () => {
    const purchaseReturn = source("app/api/purchase-returns/update/route.ts")
    const salesReturn = source("app/api/sales-returns/update/route.ts")

    expect(purchaseReturn).toContain("await syncPurchaseReturnNow")
    expect(salesReturn).toContain("await syncSalesReturnNow")
    expect(purchaseReturn).not.toContain("setImmediate")
    expect(salesReturn).not.toContain("setImmediate")
  })
})
