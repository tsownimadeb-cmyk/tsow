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
  try {
    setOfflineSnapshot(key, data)
  } catch {
    // Ignore local snapshot persistence failures in non-desktop environments.
  }
}

export function loadDesktopPageSnapshot<T>(key: string): { data: T; updatedAt: number } | null {
  try {
    return getOfflineSnapshot<T>(key)
  } catch {
    // If local DB is unavailable, treat as no snapshot.
    return null
  }
}
