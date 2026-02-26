"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Users,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CreditCard,
  Plus,
  Lock,
} from "lucide-react"
import { useState, type ComponentType, type ReactNode, type SVGProps } from "react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

interface NavItem {
  name: string
  href?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  children?: NavItem[]
}

const navigation: NavItem[] = [
  { name: "儀表板", href: "/", icon: LayoutDashboard },
  { name: "商品管理", href: "/products", icon: Package },
  {
    name: "進貨管理",
    href: "/purchases",
    icon: Truck,
    children: [
      { name: "新建進貨", href: "/purchases?create=true", icon: Plus },
      { name: "應付帳款管理", href: "/accounts-payable", icon: CreditCard },
    ],
  },
  {
    name: "銷貨管理",
    href: "/sales",
    icon: ShoppingCart,
    children: [
      { name: "新建銷貨", href: "/sales?create=true", icon: Plus },
      { name: "應收帳款管理", href: "/accounts-receivable", icon: CreditCard },
    ],
  },
  { name: "供應商管理", href: "/suppliers", icon: Building2 },
  { name: "客戶管理", href: "/customers", icon: Users },
]

export function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [expandedItems, setExpandedItems] = useState<string[]>([])

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

  const renderNavItem = (item: NavItem, level: number = 0): ReactNode => {
    const isActive = item.href === pathname
    const hasChildren = item.children && item.children.length > 0
    const isExpanded = expandedItems.includes(item.name)

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

    return (
      <Link
        key={item.name}
        href={item.href!}
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
