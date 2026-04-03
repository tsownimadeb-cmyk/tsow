import { cn } from "@/lib/utils";

interface PurchaseHistoryMobileCardProps {
  orderDate: string;
  orderNo: string;
  customerName: string;
  itemSummary: string;
  unitPriceSummary: string;
  totalQuantity: number;
  totalAmount: number;
}

export function PurchaseHistoryMobileCard({
  orderDate,
  orderNo,
  customerName,
  itemSummary,
  unitPriceSummary,
  totalQuantity,
  totalAmount,
}: PurchaseHistoryMobileCardProps) {
  return (
    <div className={cn("rounded-xl border p-4 bg-white shadow-sm flex flex-col gap-2")}> 
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold text-base">{customerName}</div>
          <div className="text-xs text-muted-foreground">單號 {orderNo}</div>
        </div>
        <div className="text-xs text-muted-foreground">{new Date(orderDate).toLocaleDateString("zh-TW")}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs mt-1">
        <span>品項: {itemSummary}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span>單價: {unitPriceSummary}</span>
        <span>數量: {totalQuantity.toLocaleString("zh-TW")}</span>
      </div>
      <div className="flex justify-end text-xs mt-1">
        <span className="font-bold">金額 ${totalAmount.toLocaleString("zh-TW")}</span>
      </div>
    </div>
  );
}
