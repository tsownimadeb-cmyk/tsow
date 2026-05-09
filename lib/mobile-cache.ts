export type CacheEnvelope<T> = {
  version: number
  updatedAt: number
  expiresAt: number | null
  data: T
}

type SaveCacheOptions = {
  ttlMs?: number
  persistToIndexedDb?: boolean
}

type LoadCacheOptions = {
  allowStale?: boolean
}

const CACHE_SCHEMA_VERSION = 2
const CACHE_EVENT = "ims-mobile-cache-changed"
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const INDEXED_DB_NAME = "ims-mobile-cache-db"
const INDEXED_DB_VERSION = 1
const INDEXED_DB_STORE = "cache"

export const MOBILE_CACHE_KEYS = {
  productsPage: "ims-cache-products-list",
  customersPage: "ims-cache-customers-list",
  suppliersPage: "ims-cache-suppliers-list",
  purchaseReturnsPage: "ims-cache-purchase-returns-list",
  salesReturnsPage: "ims-cache-sales-returns-list",
  purchaseReturnItems: "ims-cache-purchase-return-items",
  salesReturnItems: "ims-cache-sales-return-items",
  productsAll: "ims-cache-products-all",
  customersAll: "ims-cache-customers-all",
  suppliersAll: "ims-cache-suppliers-all",
} as const

let dbOpenPromise: Promise<IDBDatabase | null> | null = null

function resolveTtlMs(key: string, ttlMs?: number) {
  if (typeof ttlMs === "number" && ttlMs >= 0) return ttlMs
  if (key.endsWith("-list")) return 4 * 60 * 60 * 1000
  return DEFAULT_TTL_MS
}

function buildEnvelope<T>(key: string, data: T, options?: SaveCacheOptions): CacheEnvelope<T> {
  const ttl = resolveTtlMs(key, options?.ttlMs)
  const updatedAt = Date.now()
  return {
    version: CACHE_SCHEMA_VERSION,
    updatedAt,
    expiresAt: ttl > 0 ? updatedAt + ttl : null,
    data,
  }
}

function normalizeEnvelope<T>(parsed: any): CacheEnvelope<T> | null {
  if (!parsed || typeof parsed !== "object") return null
  if (!("updatedAt" in parsed) || !("data" in parsed)) return null

  const updatedAt = Number(parsed.updatedAt)
  if (!Number.isFinite(updatedAt)) return null

  return {
    version: Number(parsed.version) || 1,
    updatedAt,
    expiresAt: parsed.expiresAt == null ? null : Number(parsed.expiresAt),
    data: parsed.data as T,
  }
}

function isExpired(envelope: CacheEnvelope<unknown>) {
  if (envelope.expiresAt == null) return false
  return envelope.expiresAt < Date.now()
}

function emitCacheChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CACHE_EVENT))
}

function openMobileCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null)
  if (dbOpenPromise) return dbOpenPromise

  dbOpenPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
          db.createObjectStore(INDEXED_DB_STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })

  return dbOpenPromise
}

async function saveToIndexedDb<T>(key: string, envelope: CacheEnvelope<T>) {
  const db = await openMobileCacheDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(INDEXED_DB_STORE, "readwrite")
      tx.objectStore(INDEXED_DB_STORE).put(envelope, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function loadFromIndexedDb<T>(key: string): Promise<CacheEnvelope<T> | null> {
  const db = await openMobileCacheDb()
  if (!db) return null

  return await new Promise<CacheEnvelope<T> | null>((resolve) => {
    try {
      const tx = db.transaction(INDEXED_DB_STORE, "readonly")
      const request = tx.objectStore(INDEXED_DB_STORE).get(key)
      request.onsuccess = () => resolve(normalizeEnvelope<T>(request.result))
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export function saveMobileCache<T>(key: string, data: T, options?: SaveCacheOptions) {
  if (typeof window === "undefined") return
  const payload = buildEnvelope(key, data, options)
  window.localStorage.setItem(key, JSON.stringify(payload))
  emitCacheChanged()

  if (options?.persistToIndexedDb === false) return
  void saveToIndexedDb(key, payload)
}

export function loadMobileCache<T>(key: string, options?: LoadCacheOptions): CacheEnvelope<T> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = normalizeEnvelope<T>(JSON.parse(raw))
    if (!parsed) return null
    if (!options?.allowStale && isExpired(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export async function loadMobileCacheAsync<T>(key: string, options?: LoadCacheOptions): Promise<CacheEnvelope<T> | null> {
  const local = loadMobileCache<T>(key, options)
  if (local) return local

  if (typeof window === "undefined") return null
  const indexed = await loadFromIndexedDb<T>(key)
  if (!indexed) return null
  if (!options?.allowStale && isExpired(indexed)) return null

  // Promote IDB data to localStorage for faster sync reads.
  window.localStorage.setItem(key, JSON.stringify(indexed))
  emitCacheChanged()
  return indexed
}

export function onMobileCacheChanged(handler: () => void) {
  if (typeof window === "undefined") return () => {}
  const wrapped = () => handler()
  window.addEventListener(CACHE_EVENT, wrapped)
  return () => window.removeEventListener(CACHE_EVENT, wrapped)
}
