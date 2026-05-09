import { getOfflineSnapshot, setOfflineSnapshot } from "@/lib/local-db"

export const DESKTOP_OFFLINE_KEYS = {
  productsPage: "desktop-products-page",
  customersPage: "desktop-customers-page",
  suppliersPage: "desktop-suppliers-page",
} as const

export function saveDesktopPageSnapshot<T>(key: string, data: T) {
  setOfflineSnapshot(key, data)
}

export function loadDesktopPageSnapshot<T>(key: string): { data: T; updatedAt: number } | null {
  return getOfflineSnapshot<T>(key)
}
