import { getOfflineSnapshot, setOfflineSnapshot } from "@/lib/local-db"

const SNAPSHOT_MIN_WRITE_INTERVAL_MS = 30 * 1000
const lastSnapshotSavedAt = new Map<string, number>()

export const DESKTOP_OFFLINE_KEYS = {
  productsPage: "desktop-products-page",
  customersPage: "desktop-customers-page",
  suppliersPage: "desktop-suppliers-page",
  purchasesPage: "desktop-purchases-page",
  salesPage: "desktop-sales-page",
} as const

export function saveDesktopPageSnapshot<T>(key: string, data: T) {
  const now = Date.now()
  const last = lastSnapshotSavedAt.get(key) || 0
  if (now - last < SNAPSHOT_MIN_WRITE_INTERVAL_MS) {
    return
  }

  lastSnapshotSavedAt.set(key, now)
  setOfflineSnapshot(key, data)
}

export function loadDesktopPageSnapshot<T>(key: string): { data: T; updatedAt: number } | null {
  return getOfflineSnapshot<T>(key)
}
