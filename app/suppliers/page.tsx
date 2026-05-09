import { createClient } from "@/lib/supabase/server"
import { SuppliersTable } from "@/components/suppliers/suppliers-table"
import { SupplierDialog } from "@/components/suppliers/supplier-dialog"
import { SuppliersBatchActions } from "@/components/suppliers/suppliers-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { MobileCacheWriter } from "@/components/mobile-cache-writer"
import { DESKTOP_OFFLINE_KEYS, loadDesktopPageSnapshot, saveDesktopPageSnapshot } from "@/lib/desktop-offline-cache"
import { isLocalOnlyMode } from "@/lib/runtime-mode"

export default async function SuppliersPage() {
  let suppliers: any[] = []
  let loadedFromOffline = false
  const localOnly = isLocalOnlyMode()

  if (localOnly) {
    const snapshot = loadDesktopPageSnapshot<{ suppliers: any[] }>(DESKTOP_OFFLINE_KEYS.suppliersPage)
    suppliers = snapshot?.data?.suppliers || []
    loadedFromOffline = true
  } else {
    try {
      const supabase = await createClient()

      const sortedResult = await supabase
        .from("suppliers")
        .select("*")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })

      if (sortedResult.error) {
        const fallbackResult = await supabase
          .from("suppliers")
          .select("*")
          .order("created_at", { ascending: false })
        if (fallbackResult.error) {
          throw fallbackResult.error
        }
        suppliers = fallbackResult.data || []
      } else {
        suppliers = sortedResult.data || []
      }

      saveDesktopPageSnapshot(DESKTOP_OFFLINE_KEYS.suppliersPage, {
        suppliers,
      })
    } catch (error) {
      const snapshot = loadDesktopPageSnapshot<{ suppliers: any[] }>(DESKTOP_OFFLINE_KEYS.suppliersPage)
      if (snapshot?.data) {
        suppliers = snapshot.data.suppliers || []
        loadedFromOffline = true
      } else {
        throw error
      }
    }
  }

  return (
    <div className="space-y-6">
      <MobileCacheWriter cacheKey="ims-cache-suppliers-list" data={{ suppliers }} />
      {loadedFromOffline && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          離線模式：目前顯示本機快取資料。
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">供應商管理</h1>
          <p className="text-sm text-muted-foreground">管理您的供應商資料</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SupplierDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增供應商
            </Button>
          </SupplierDialog>
          <SuppliersBatchActions />
        </div>
      </div>

      <SuppliersTable suppliers={suppliers} />
    </div>
  )
}
