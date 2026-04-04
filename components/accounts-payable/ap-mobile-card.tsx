import { cn } from "@/lib/utils";

interface APSupplierMobileCardProps {
  supplierName: string;
  supplierId: string;
  totalDue: number;
  totalOutstanding: number;
  orderCount: number;
  onExport: () => void;
  onBatchSettle: () => void;
  onPayByCheck: () => void;
  orders: Array<{
    id: string;
    orderNumber: string;
    orderDate: string | null;
    products: string;
    amountDue: number;
    outstanding: number;
  }>;
}

export function APSupplierMobileCard({
  supplierName,
  supplierId,
  totalDue,
  totalOutstanding,
  orderCount,
  onExport,
  onBatchSettle,
  onPayByCheck,
  orders,
}: APSupplierMobileCardProps) {
  return (
    <div className={cn("rounded-xl border p-4 bg-white shadow-sm flex flex-col gap-2")}> 
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold text-base">{supplierName}</div>
          <div className="text-xs text-muted-foreground">{orderCount} 筆單據</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">應付合計</div>
          <div className="text-lg font-semibold">${totalDue.toLocaleString("zh-TW")}</div>
          <div className="text-xs text-destructive">總欠款 ${totalOutstanding.toLocaleString("zh-TW")}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        <button className="text-xs px-2 py-1 rounded border bg-muted hover:bg-gray-200" onClick={onExport}>匯出對帳單</button>
        <button className="text-xs px-2 py-1 rounded border bg-muted hover:bg-gray-200" onClick={onBatchSettle}>現金沖帳</button>
        <button className="text-xs px-2 py-1 rounded border bg-muted hover:bg-gray-200" onClick={onPayByCheck}>支票付款</button>
      </div>
      <div className="divide-y mt-2">
        {orders.map(order => (
          <div key={order.id} className="py-2 flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{order.orderNumber}</span>
              <span className="text-right text-xs text-muted-foreground">{order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}</span>
            </div>
            <div className="text-xs text-gray-500 truncate">{order.products}</div>
            <div className="flex justify-between text-xs mt-1">
              <span>單筆金額 ${order.amountDue.toLocaleString("zh-TW")}</span>
              <span className="text-destructive">未付 ${order.outstanding.toLocaleString("zh-TW")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
