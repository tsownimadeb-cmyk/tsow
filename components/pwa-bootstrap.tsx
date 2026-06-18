"use client"

import { useEffect } from "react"
import { flushPendingOperations } from "@/lib/mobile-offline-queue"
import { refreshReferenceCaches } from "@/lib/mobile-cache-sync"
import { isLocalOnlyMode } from "@/lib/runtime-mode-client"

export function PwaBootstrap() {
  useEffect(() => {
    const localOnly = isLocalOnlyMode()

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Keep app usable even if service worker registration fails.
      })
    }

    const sync = async () => {
      await flushPendingOperations()

      if (!localOnly) {
        try {
          const statusRes = await fetch('/api/auth/status', { credentials: 'same-origin' }).catch(() => null)
          const status = statusRes ? await statusRes.json().catch(() => null) : null

          if (status && status.authenticated === true) {
            await fetch("/api/sync", { credentials: 'same-origin' }).catch(() => {
              // Ignore server sync errors when offline.
            })
            await refreshReferenceCaches()
          }
          // If not authenticated, skip server sync and mobile-cache refresh to avoid exposing data before login.
        } catch {
          // ignore any errors and do not perform server sync
        }
      }
    }

    void sync()

    const onOnline = () => {
      void sync()
    }

    window.addEventListener("online", onOnline)
    const intervalId = window.setInterval(() => {
      if (navigator.onLine) {
        void sync()
      }
    }, 120000)

    return () => {
      window.removeEventListener("online", onOnline)
      window.clearInterval(intervalId)
    }
  }, [])

  return null
}
