"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  clearConflicts,
  flushPendingOperations,
  getConflictCount,
  getPendingOperationCount,
  listConflicts,
  onPendingQueueChanged,
  removeConflict,
  requeueConflict,
} from "@/lib/mobile-offline-queue"
import { getLastReferenceRefreshAt, refreshReferenceCaches } from "@/lib/mobile-cache-sync"
import { onMobileCacheChanged } from "@/lib/mobile-cache"

export function OfflineSyncPill() {
  const [pending, setPending] = useState(0)
  const [conflicts, setConflicts] = useState(0)
  const [conflictItems, setConflictItems] = useState<Array<{ id: string; endpoint: string; reason: string; createdAt: number }>>([])
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null)

  useEffect(() => {
    const refresh = () => {
      setPending(getPendingOperationCount())
      setConflicts(getConflictCount())
      setConflictItems(
        listConflicts().map((item) => ({
          id: item.id,
          endpoint: item.endpoint,
          reason: item.reason,
          createdAt: item.createdAt,
        }))
      )
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : true)
      setLastRefreshAt(getLastReferenceRefreshAt())
    }

    refresh()
    const unbind = onPendingQueueChanged(refresh)
    const unbindCache = onMobileCacheChanged(refresh)

    const onOnline = () => {
      refresh()
      void handleSync()
    }
    const onOffline = () => refresh()

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    const id = window.setInterval(refresh, 5000)

    return () => {
      unbind()
      unbindCache()
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      window.clearInterval(id)
    }
  }, [])

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await flushPendingOperations()
      setPending(getPendingOperationCount())
      setConflicts(getConflictCount())
    } finally {
      setSyncing(false)
    }
  }

  const handleClearConflicts = () => {
    clearConflicts()
    setConflicts(0)
    setConflictItems([])
  }

  const handleRetryConflict = async (id: string) => {
    const moved = requeueConflict(id)
    if (!moved) return
    setPending(getPendingOperationCount())
    setConflicts(getConflictCount())
    setConflictItems(
      listConflicts().map((item) => ({
        id: item.id,
        endpoint: item.endpoint,
        reason: item.reason,
        createdAt: item.createdAt,
      }))
    )

    if (online) {
      await handleSync()
    }
  }

  const handleDismissConflict = (id: string) => {
    removeConflict(id)
    setConflicts(getConflictCount())
    setConflictItems(
      listConflicts().map((item) => ({
        id: item.id,
        endpoint: item.endpoint,
        reason: item.reason,
        createdAt: item.createdAt,
      }))
    )
  }

  const handleRefreshReferenceCache = async () => {
    if (refreshing || !online) return
    setRefreshing(true)
    try {
      const result = await refreshReferenceCaches()
      setLastRefreshAt(result.lastRefreshAt)
    } finally {
      setRefreshing(false)
    }
  }

  if (pending === 0 && conflicts === 0 && online) return null

  const lastSyncText = lastRefreshAt ? new Date(lastRefreshAt).toLocaleString("zh-TW") : "尚未同步"

  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="text-xs">
          <div className="font-semibold">{online ? "同步待處理" : "離線模式"}</div>
          <div className="text-muted-foreground">{pending} 筆待同步</div>
          <div className="text-muted-foreground">{conflicts} 筆衝突待處理</div>
          <div className="text-muted-foreground">最後更新: {lastSyncText}</div>
        </div>
        <Button size="sm" variant="outline" disabled={!online || syncing || pending === 0} onClick={handleSync}>
          {syncing ? "同步中" : "立即同步"}
        </Button>
        <Button size="sm" variant="outline" disabled={!online || refreshing} onClick={handleRefreshReferenceCache}>
          {refreshing ? "更新中" : "重抓資料"}
        </Button>
        <Button size="sm" variant="outline" disabled={conflicts === 0} onClick={handleClearConflicts}>
          清除衝突
        </Button>
      </div>
      {conflictItems.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-white/80 p-2 text-xs">
          {conflictItems.slice(0, 8).map((item) => (
            <div key={item.id} className="mb-2 rounded border p-2 last:mb-0">
              <div className="font-semibold text-rose-700">{item.reason}</div>
              <div className="text-muted-foreground">{item.endpoint}</div>
              <div className="text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-TW")}</div>
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="outline" onClick={() => void handleRetryConflict(item.id)}>
                  重試
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleDismissConflict(item.id)}>
                  忽略
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
