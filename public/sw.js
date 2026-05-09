const CACHE_NAME = "ims-cache-v1"
const CORE_ASSETS = ["/", "/manifest.webmanifest", "/apple-icon.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => Promise.resolve())
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (req.method !== "GET") return
  if (url.pathname.startsWith("/api/")) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        const cloned = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(req, cloned)).catch(() => {})
        return res
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
  )
})
