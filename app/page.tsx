import Link from "next/link"
import { ArrowRight, Building2, CreditCard, Package, ShoppingCart, Truck, Users } from "lucide-react"

const quickLinks = [
  {
    title: "商品管理",
    description: "維護商品資料與庫存狀態",
    href: "/products",
    icon: Package,
  },
  {
    title: "進貨管理",
    description: "建立進貨單並追蹤到貨流程",
    href: "/purchases",
    icon: Truck,
  },
  {
    title: "銷貨管理",
    description: "快速建立銷貨單與出貨紀錄",
    href: "/sales",
    icon: ShoppingCart,
  },
  {
    title: "應收應付管理",
    description: "管理收付款與帳款狀態",
    href: "/accounts-receivable",
    icon: CreditCard,
  },
  {
    title: "供應商管理",
    description: "查看與維護供應商資料",
    href: "/suppliers",
    icon: Building2,
  },
  {
    title: "客戶管理",
    description: "集中管理客戶聯絡與交易資訊",
    href: "/customers",
    icon: Users,
  },
]

export default function WelcomePage() {
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/30" />
        <div className="relative space-y-3">
          <p className="inline-flex items-center rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
            Welcome
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">歡迎使用進銷貨系統</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            所有核心模組已準備完成，請從下方快速入口開始今天的作業流程。
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quickLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-accent/60"
          >
            <div className="mb-4 inline-flex rounded-lg border border-border bg-background p-2">
              <item.icon className="h-5 w-5 text-foreground" />
            </div>
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary">
              進入功能
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
