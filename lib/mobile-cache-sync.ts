import { MOBILE_CACHE_KEYS, saveMobileCache } from "@/lib/mobile-cache"

const LAST_REFERENCE_REFRESH_KEY = "ims-mobile-cache-last-refresh"
const MIN_REFERENCE_REFRESH_INTERVAL_MS = 10 * 60 * 1000

type RefreshResult = {
  refreshed: number
  lastRefreshAt: number | null
}

export function getLastReferenceRefreshAt(): number | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(LAST_REFERENCE_REFRESH_KEY)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function setLastReferenceRefreshAt(timestamp: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LAST_REFERENCE_REFRESH_KEY, String(timestamp))
}

export async function refreshReferenceCaches(): Promise<RefreshResult> {
  if (typeof window === "undefined") return { refreshed: 0, lastRefreshAt: null }
  if (!navigator.onLine) return { refreshed: 0, lastRefreshAt: getLastReferenceRefreshAt() }

  const lastRefreshAt = getLastReferenceRefreshAt()
  if (lastRefreshAt && Date.now() - lastRefreshAt < MIN_REFERENCE_REFRESH_INTERVAL_MS) {
    return { refreshed: 0, lastRefreshAt }
  }

  const targets: Array<{ endpoint: string; key: string }> = [
    { endpoint: "/api/mobile-cache/products", key: MOBILE_CACHE_KEYS.productsAll },
    { endpoint: "/api/mobile-cache/customers", key: MOBILE_CACHE_KEYS.customersAll },
    { endpoint: "/api/mobile-cache/suppliers", key: MOBILE_CACHE_KEYS.suppliersAll },
  ]

  let refreshed = 0

  await Promise.all(
    targets.map(async ({ endpoint, key }) => {
      try {
        const response = await fetch(endpoint, { method: "GET" })
        if (!response.ok) return

        const payload = await response.json()
        if (!payload?.success || !Array.isArray(payload?.data)) return

        saveMobileCache(key, payload.data, { ttlMs: 24 * 60 * 60 * 1000 })
        refreshed += 1
      } catch {
        // Ignore each endpoint failure and continue with others.
      }
    })
  )

  if (refreshed > 0) {
    const now = Date.now()
    setLastReferenceRefreshAt(now)
    return { refreshed, lastRefreshAt: now }
  }

  return { refreshed, lastRefreshAt: getLastReferenceRefreshAt() }
}
