import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ARCheckMobileCardProps {
  customerName: string;
  orderNo: string;
  checkNo: string | null;
  checkBank: string | null;
  checkIssueDate: string | null;
  dueDate: string | null;
  amountDue: number;
  paidAmount: number;
  outstanding: number;
  checkStatus: string;
  statusBadge: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}

export function ARCheckMobileCard({
  customerName,
  orderNo,
  checkNo,
  checkBank,
  checkIssueDate,
  dueDate,
  amountDue,
  paidAmount,
  outstanding,
  checkStatus,
  statusBadge,
  onEdit,
  onDelete,
}: ARCheckMobileCardProps) {
  return (
    <div className={cn("rounded-xl border p-4 bg-white shadow-sm flex flex-col gap-2")}> 
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold text-base">{customerName}</div>
          <div className="text-xs text-muted-foreground">單號 {orderNo}</div>
        </div>
        <div>{statusBadge}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs mt-1">
        <span>支票號碼: {checkNo || '-'}</span>
        <span>銀行: {checkBank || '-'}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span>開票日: {checkIssueDate ? new Date(checkIssueDate).toLocaleDateString("zh-TW") : '-'}</span>
        <span>到期日: {dueDate ? new Date(dueDate).toLocaleDateString("zh-TW") : '-'}</span>
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span>應收 ${amountDue.toLocaleString("zh-TW")}</span>
        <span>已收 ${paidAmount.toLocaleString("zh-TW")}</span>
        <span className="text-destructive">未收 ${outstanding.toLocaleString("zh-TW")}</span>
      </div>
      <div className="flex gap-2 mt-2">
        <button className="text-xs px-2 py-1 rounded border bg-muted hover:bg-gray-200" onClick={onEdit}>編輯</button>
        <button className="text-xs px-2 py-1 rounded border bg-muted hover:bg-gray-200" onClick={onDelete}>刪除</button>
      </div>
    </div>
  );
}
