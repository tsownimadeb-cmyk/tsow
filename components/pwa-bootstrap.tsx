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
        await fetch("/api/sync").catch(() => {
          // Ignore server sync errors when offline.
        })
        await refreshReferenceCaches()
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
