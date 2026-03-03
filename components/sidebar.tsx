"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Package,
  ShoppingCart,
  Truck,
  ChartColumn,
  Users,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CreditCard,
  Plus,
  Lock,
  Settings,
  Archive,
  FolderOpen,
  Download,
  Upload,
} from "lucide-react"
import { useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

interface NavItem {
  name: string
  href?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  children?: NavItem[]
  onClick?: () => void | Promise<void>
  disabled?: boolean
}

const importSummaryLabels: Record<string, string> = {
  categories: "商品分類",
  suppliers: "供應商",
  customers: "客戶",
  products: "商品",
  purchase_orders: "進貨單",
  purchase_order_items: "進貨明細",
  sales_orders: "銷貨單",
  sales_order_items: "銷貨明細",
  accounts_receivable: "應收帳款",
  accounts_payable: "應付帳款",
}

const toImportSummaryText = (summary?: Record<string, number>, separator: string = "\n") => {
  if (!summary) return ""

  const entries = Object.entries(summary)
  if (!entries.length) return "無資料"

  return entries
    .map(([key, count]) => `${importSummaryLabels[key] || key}: ${count}`)
    .join(separator)
}

export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [isExportingBusinessData, setIsExportingBusinessData] = useState(false)
  const [isExportingBusinessCsv, setIsExportingBusinessCsv] = useState(false)
  const [isImportingBusinessData, setIsImportingBusinessData] = useState(false)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)

  const handleLockSystem = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
    router.refresh()
  }

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    )
  }

  const handleCreateGitBundle = async () => {
    if (isCreatingBackup) return

    setIsCreatingBackup(true)
    try {
      const response = await fetch("/api/backups/git-bundle", { method: "POST" })
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        filePath?: string
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "建立備份失敗")
      }

      toast({
        title: "備份完成",
        description: data.filePath ? `已建立 ${data.filePath}` : "Git bundle 已建立",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "建立備份失敗"
      toast({
        title: "備份失敗",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsCreatingBackup(false)
    }
  }

  const handleOpenBackupFolder = async () => {
    try {
      const response = await fetch("/api/backups/open-folder", { method: "POST" })
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        folderPath?: string
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "無法開啟備份資料夾")
      }

      if (data.folderPath && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(data.folderPath)
        } catch {
          // ignore clipboard failures
        }
      }

      toast({
        title: "已開啟備份資料夾",
        description: data.folderPath || "已在檔案總管開啟 backups/git",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "無法開啟備份資料夾"
      toast({
        title: "開啟失敗",
        description: message,
        variant: "destructive",
      })
    }
  }

  const handleExportBusinessData = async () => {
    if (isExportingBusinessData) return

    setIsExportingBusinessData(true)
    try {
      const response = await fetch("/api/backups/business-export", { method: "GET" })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message || "匯出失敗")
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get("content-disposition") || ""
      const matched = contentDisposition.match(/filename=\"?([^\";]+)\"?/) 
      const fileName = matched?.[1] || `business-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`

      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)

      toast({
        title: "匯出完成",
        description: `已下載 ${fileName}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "匯出失敗"
      toast({
        title: "匯出失敗",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsExportingBusinessData(false)
    }
  }

  const handleExportBusinessCsv = async () => {
    if (isExportingBusinessCsv) return

    setIsExportingBusinessCsv(true)
    try {
      const response = await fetch("/api/backups/business-export-csv", { method: "GET" })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message || "匯出失敗")
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get("content-disposition") || ""
      const matched = contentDisposition.match(/filename=\"?([^\";]+)\"?/) 
      const fileName = matched?.[1] || `business-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`

      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)

      toast({
        title: "匯出完成",
        description: `已下載 ${fileName}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "匯出失敗"
      toast({
        title: "匯出失敗",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsExportingBusinessCsv(false)
    }
  }

  const handleImportBusinessData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ""

    if (!selectedFile) return
    if (isImportingBusinessData) return

    setIsImportingBusinessData(true)
    try {
      const previewFormData = new FormData()
      previewFormData.append("file", selectedFile)
      previewFormData.append("preview", "1")

      const previewResponse = await fetch("/api/backups/business-import", {
        method: "POST",
        body: previewFormData,
      })

      const previewData = (await previewResponse.json().catch(() => ({}))) as {
        success?: boolean
        message?: string
        preview?: boolean
        summary?: Record<string, number>
      }

      if (!previewResponse.ok || !previewData.success) {
        throw new Error(previewData.message || "預檢失敗")
      }

      const summaryLines = toImportSummaryText(previewData.summary, "\n") || "無資料"

      const confirmed = window.confirm(
        `預檢結果：\n${summaryLines}\n\n確認開始匯入？`,
      )
      if (!confirmed) {
        setIsImportingBusinessData(false)
        return
      }

      const importFormData = new FormData()
      importFormData.append("file", selectedFile)

      const response = await fetch("/api/backups/business-import", {
        method: "POST",
        body: importFormData,
      })

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean
        message?: string
        summary?: Record<string, number>
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "匯入失敗")
      }

      toast({
        title: "匯入完成",
        description: data.summary ? toImportSummaryText(data.summary, "、") : "資料已匯入",
      })

      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "匯入失敗"
      toast({
        title: "匯入失敗",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsImportingBusinessData(false)
    }
  }

  const navigation: NavItem[] = [
    {
      name: "商品管理",
      icon: Package,
      children: [
        { name: "商品清單", href: "/products", icon: Package },
        { name: "利潤分析", href: "/products/profit-analysis", icon: ChartColumn },
      ],
    },
    {
      name: "進貨管理",
      href: "/purchases",
      icon: Truck,
      children: [
        { name: "新建進貨", href: "/purchases?create=true", icon: Plus },
      ],
    },
    {
      name: "銷貨管理",
      href: "/sales",
      icon: ShoppingCart,
      children: [
        { name: "新建銷貨", href: "/sales?create=true", icon: Plus },
        { name: "銷貨分析", href: "/sales/analysis", icon: ChartColumn },
      ],
    },
    {
      name: "應收應付管理",
      icon: CreditCard,
      children: [
        { name: "應收帳款", href: "/accounts-receivable", icon: CreditCard },
        { name: "應付帳款", href: "/accounts-payable", icon: CreditCard },
      ],
    },
    { name: "供應商管理", href: "/suppliers", icon: Building2 },
    { name: "客戶管理", href: "/customers", icon: Users },
    {
      name: "設置",
      icon: Settings,
      children: [
        {
          name: isCreatingBackup ? "備份中..." : "備份（Git Bundle）",
          icon: Archive,
          onClick: handleCreateGitBundle,
          disabled: isCreatingBackup,
        },
        {
          name: "開啟備份資料夾",
          icon: FolderOpen,
          onClick: handleOpenBackupFolder,
        },
        {
          name: isExportingBusinessData ? "匯出中..." : "匯出營運資料",
          icon: Download,
          onClick: handleExportBusinessData,
          disabled: isExportingBusinessData,
        },
        {
          name: isExportingBusinessCsv ? "匯出中..." : "匯出營運CSV（ZIP）",
          icon: Download,
          onClick: handleExportBusinessCsv,
          disabled: isExportingBusinessCsv,
        },
        {
          name: isImportingBusinessData ? "匯入中..." : "匯入營運資料（JSON/ZIP）",
          icon: Upload,
          onClick: () => importFileInputRef.current?.click(),
          disabled: isImportingBusinessData,
        },
      ],
    },
  ]

  const isItemActive = (item: NavItem): boolean => {
    const currentPath = String(pathname || "")
    if (!currentPath) return false

    const hasChildren = Boolean(item.children && item.children.length > 0)

    if (hasChildren) {
      const selfActive = item.href ? item.href === currentPath : false
      const childActive = Boolean(item.children?.some((child) => isItemActive(child)))
      return selfActive || childActive
    }

    return Boolean(item.href && item.href === currentPath)
  }

  const renderNavItem = (item: NavItem, level: number = 0): ReactNode => {
    const isActive = isItemActive(item)
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.includes(item.name) || Boolean(item.children?.some((child) => isItemActive(child)))

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              collapsed && "justify-center px-2",
            )}
            title={collapsed ? item.name : undefined}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.name}</span>
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                />
              </>
            )}
          </button>
          {isExpanded && !collapsed && (
            <div className="ml-2 space-y-1 border-l border-border pl-2 py-1">
              {item.children?.map((child) => renderNavItem(child, level + 1))}
            </div>
          )}
        </div>
      )
    }

    if (item.href) {
      return (
        <Link
          key={item.name}
          href={item.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center px-2",
            level > 0 && "ml-2 text-xs",
          )}
          title={collapsed ? item.name : undefined}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && <span>{item.name}</span>}
        </Link>
      )
    }

    return (
      <button
        key={item.name}
        type="button"
        onClick={item.onClick}
        disabled={item.disabled}
        className={cn(
          "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none",
          collapsed && "justify-center px-2",
          level > 0 && "ml-2 text-xs",
        )}
        title={collapsed ? item.name : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{item.name}</span>}
      </button>
    )
  }

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!collapsed && <h1 className="text-lg font-semibold text-foreground">進銷貨系統</h1>}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className={cn("h-8 w-8", collapsed && "mx-auto")}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navigation.map((item) => renderNavItem(item))}
      </nav>
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json,.json,application/zip,.zip"
        className="hidden"
        onChange={handleImportBusinessData}
      />
      <div className="border-t border-border p-4 space-y-2">
        <Button
          variant="outline"
          className={cn("w-full", collapsed && "px-2")}
          onClick={handleLockSystem}
          title={collapsed ? "鎖定系統" : undefined}
        >
          <Lock className="h-4 w-4 shrink-0" />
          {!collapsed && <span>鎖定系統</span>}
        </Button>
        {!collapsed && <p className="text-xs text-muted-foreground text-center">v1.0.0</p>}
      </div>
    </aside>
  )
}
