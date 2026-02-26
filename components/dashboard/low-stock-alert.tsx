import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Product } from "@/lib/types"

interface LowStockAlertProps {
  products: Product[]
}

export function LowStockAlert({ products }: LowStockAlertProps) {
  if (products.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            庫存警示
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">目前沒有低於安全庫存的商品</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          庫存警示 ({products.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {products.slice(0, 5).map((product) => (
          <div key={product.code} className="flex items-center justify-between text-sm">
            <div>
              <p className="font-medium">{product.name}</p>
              <p className="text-xs text-muted-foreground">{product.category || "未分類"}</p>
            </div>
            <div className="text-right">
              <p className="text-red-600 font-medium">
                {product.stock_quantity} {product.unit}
              </p>
              <p className="text-xs text-muted-foreground">安全庫存: {product.min_stock_level}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
