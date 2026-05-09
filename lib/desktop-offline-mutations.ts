import { DESKTOP_OFFLINE_KEYS, loadDesktopPageSnapshot, saveDesktopPageSnapshot } from "@/lib/desktop-offline-cache"

type AnyRecord = Record<string, any>

function upsertByKey<T extends AnyRecord>(rows: T[], row: T, key: keyof T): T[] {
  const keyValue = String(row[key] ?? "")
  const index = rows.findIndex((item) => String(item[key] ?? "") === keyValue)
  if (index === -1) {
    return [row, ...rows]
  }

  const next = [...rows]
  next[index] = { ...next[index], ...row }
  return next
}

function removeByKey<T extends AnyRecord>(rows: T[], key: keyof T, keyValue: string): T[] {
  return rows.filter((item) => String(item[key] ?? "") !== String(keyValue))
}

export function upsertProductSnapshot(product: AnyRecord) {
  const snapshot = loadDesktopPageSnapshot<{ products: AnyRecord[]; total: number; page?: number; searchText?: string }>(
    DESKTOP_OFFLINE_KEYS.productsPage,
  )
  const previous = snapshot?.data?.products || []
  const products = upsertByKey(previous, product, "code")
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.productsPage, {
    ...(snapshot?.data || {}),
    products,
    total: products.length,
  })
}

export function removeProductSnapshot(code: string) {
  const snapshot = loadDesktopPageSnapshot<{ products: AnyRecord[]; total: number; page?: number; searchText?: string }>(
    DESKTOP_OFFLINE_KEYS.productsPage,
  )
  if (!snapshot?.data) return

  const products = removeByKey(snapshot.data.products || [], "code", code)
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.productsPage, {
    ...snapshot.data,
    products,
    total: products.length,
  })
}

export function upsertCustomerSnapshot(customer: AnyRecord) {
  const snapshot = loadDesktopPageSnapshot<{ customers: AnyRecord[]; total: number; page?: number; searchText?: string }>(
    DESKTOP_OFFLINE_KEYS.customersPage,
  )
  const previous = snapshot?.data?.customers || []
  const customers = upsertByKey(previous, customer, "code")
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.customersPage, {
    ...(snapshot?.data || {}),
    customers,
    total: customers.length,
  })
}

export function removeCustomerSnapshot(code: string) {
  const snapshot = loadDesktopPageSnapshot<{ customers: AnyRecord[]; total: number; page?: number; searchText?: string }>(
    DESKTOP_OFFLINE_KEYS.customersPage,
  )
  if (!snapshot?.data) return

  const customers = removeByKey(snapshot.data.customers || [], "code", code)
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.customersPage, {
    ...snapshot.data,
    customers,
    total: customers.length,
  })
}

export function upsertSupplierSnapshot(supplier: AnyRecord) {
  const snapshot = loadDesktopPageSnapshot<{ suppliers: AnyRecord[] }>(DESKTOP_OFFLINE_KEYS.suppliersPage)
  const previous = snapshot?.data?.suppliers || []
  const suppliers = upsertByKey(previous, supplier, "id")
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.suppliersPage, {
    ...(snapshot?.data || {}),
    suppliers,
  })
}

export function removeSupplierSnapshot(id: string) {
  const snapshot = loadDesktopPageSnapshot<{ suppliers: AnyRecord[] }>(DESKTOP_OFFLINE_KEYS.suppliersPage)
  if (!snapshot?.data) return

  const suppliers = removeByKey(snapshot.data.suppliers || [], "id", id)
  saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.suppliersPage, {
    ...snapshot.data,
    suppliers,
  })
}
