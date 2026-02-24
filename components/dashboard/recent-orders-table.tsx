import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import type { PurchaseOrder, SalesOrder } from "@/lib/types"

interface RecentOrdersTableProps {
  orders: (PurchaseOrder | SalesOrder)[]
  type: "purchase" | "sales"
}

const statusMap = {
  pending: { label: "待處理", variant: "secondary" as const },
  completed: { label: "已完成", variant: "default" as const },
  cancelled: { label: "已取消", variant: "destructive" as const },
}

export function RecentOrdersTable({ orders, type }: RecentOrdersTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>單號</TableHead>
          <TableHead>{type === "purchase" ? "供應商" : "客戶"}</TableHead>
          <TableHead>日期</TableHead>
          <TableHead className="text-right">金額</TableHead>
          <TableHead>狀態</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              暫無資料
            </TableCell>
          </TableRow>
        ) : (
          orders.map((order) => {
            const status = statusMap[order.status]
            const counterparty =
              type === "purchase" ? (order as PurchaseOrder).supplier?.name : (order as SalesOrder).customer?.name
            return (
              <TableRow key={order.id}>
                <TableCell className="font-medium">{order.order_number}</TableCell>
                <TableCell>{counterparty || "-"}</TableCell>
                <TableCell>{new Date(order.order_date).toLocaleDateString("zh-TW")}</TableCell>
                <TableCell className="text-right">${order.total_amount.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
