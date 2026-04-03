"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

type SalesReturn = {
  id: string;
  order_number: string;
  customer_code: string; // 實際為 customer_id
  return_date: string;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
};

type SalesReturnItem = {
  id: string;
  sales_return_id: string;
  product_code: string;
  quantity: number;
  unit_price: number;
  reason: string | null;
  product_name?: string;
};

export default function SalesReturnsListPage() {
  const [returns, setReturns] = useState<SalesReturn[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemsMap, setItemsMap] = useState<Record<string, SalesReturnItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [customerNameMap, setCustomerNameMap] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<SalesReturn | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createClient();

  // 載入銷貨退回列表
  useEffect(() => {
    const fetchReturns = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from("sales_returns")
          .select("*")
          .order("return_date", { ascending: false });

        if (searchTerm.trim()) {
          query = query.or(
            `order_number.ilike.%${searchTerm}%,customer_code.ilike.%${searchTerm}%`
          );
        }

        if (filterDateFrom) {
          query = query.gte("return_date", filterDateFrom);
        }

        if (filterDateTo) {
          query = query.lte("return_date", filterDateTo);
        }

        const { data, error } = await query;
        if (error) throw error;
        setReturns(data || []);

        // 取得所有 customer_code 對應的名稱
        const customerCodes = Array.from(new Set((data || []).map((r: any) => r.customer_code).filter(Boolean)));
        if (customerCodes.length > 0) {
          const { data: customers, error: customerError } = await supabase
            .from("customers")
            .select("code, name")
            .in("code", customerCodes);
          if (!customerError && customers) {
            const map: Record<string, string> = {};
            for (const c of customers) {
              map[c.code] = c.name;
            }
            setCustomerNameMap(map);
          }
        }
      } catch (err: any) {
        toast({
          title: "載入失敗",
          description: err.message || "無法載入銷貨退回列表",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchReturns();
  }, [searchTerm, filterDateFrom, filterDateTo]);

  // 當展開時載入明細
  const handleExpand = async (returnId: string) => {
    if (expandedId === returnId) {
      setExpandedId(null);
      return;
    }

    if (itemsMap[returnId]) {
      setExpandedId(returnId);
      return;
    }

    try {
      // 1. 先查 sales_return_items
      const { data: itemsData, error: itemsError } = await supabase
        .from("sales_return_items")
        .select("*")
        .eq("sales_return_id", returnId);

      if (itemsError) throw itemsError;

      // 2. 取出商品代號，查詢商品名稱
      const productCodes = Array.from(
        new Set((itemsData || []).map((item: any) => item.product_code).filter(Boolean))
      );
      let productNameMap: Record<string, string> = {};
      if (productCodes.length > 0) {
        const { data: productData, error: productError } = await supabase
          .from("products")
          .select("code, name")
          .in("code", productCodes);
        if (!productError && productData) {
          productNameMap = Object.fromEntries(
            productData.map((p: any) => [p.code, p.name])
          );
        }
      }

      // 3. 組合明細與商品名稱
      const items = (itemsData || []).map((item: any) => ({
        ...item,
        product_name: productNameMap[item.product_code] || "-",
      }));

      setItemsMap((prev) => ({
        ...prev,
        [returnId]: items,
      }));
      setExpandedId(returnId);
    } catch (err: any) {
      toast({
        title: "載入明細失敗",
        description: err.message || "無法載入退回明細",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      setDeletingId(deleteTarget.id);
      const { error } = await supabase.rpc("delete_sales_return_and_restore_stock", {
        return_id: deleteTarget.id,
      });

      if (error) throw error;

      setReturns((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setItemsMap((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      if (expandedId === deleteTarget.id) {
        setExpandedId(null);
      }
      setDeleteTarget(null);
      toast({ title: "刪除成功", description: "銷貨退回紀錄已刪除。" });
    } catch (err: any) {
      toast({
        title: "刪除失敗",
        description: err.message || "無法刪除銷貨退回紀錄",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">銷貨退回紀錄</h2>
        <Link href="/sales/returns">
          <Button>建立新退回單</Button>
        </Link>
      </div>

      {/* 搜尋和篩選 */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="搜尋單號或客戶編號..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
        </div>
        <div className="flex gap-2">
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            placeholder="從日期"
            className="flex-1"
          />
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            placeholder="到日期"
            className="flex-1"
          />
          <Button
            onClick={() => {
              setSearchTerm("");
              setFilterDateFrom("");
              setFilterDateTo("");
            }}
            variant="outline"
          >
            重設
          </Button>
        </div>
      </div>

      {/* 響應式：桌面表格 + 手機卡片 */}
      {loading ? (
        <div className="text-center py-8">載入中...</div>
      ) : returns.length === 0 ? (
        <div className="text-center py-8 text-gray-500">沒有銷貨退回紀錄</div>
      ) : (
        <>
          {/* 桌面版表格 (md 以上) */}
          <div className="hidden md:block w-full border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[5%_15%_15%_15%_15%_15%_13%_7%] bg-muted text-sm font-semibold border-b">
              <div className="py-3 px-3 text-center"></div>
              <div className="py-3 px-3 text-left">單號</div>
              <div className="py-3 px-3 text-left">客戶</div>
              <div className="py-3 px-3 text-center">退回日期</div>
              <div className="py-3 px-3 text-right">退回金額</div>
              <div className="py-3 px-3 text-center">狀態</div>
              <div className="py-3 px-3 text-left">備註</div>
              <div className="py-3 px-3 text-center">操作</div>
            </div>
            {returns.map((ret) => (
              <div key={ret.id}>
                <div className="grid grid-cols-[5%_15%_15%_15%_15%_15%_13%_7%] border-b last:border-0 items-center hover:bg-gray-50">
                  <div className="py-3 px-3 text-center">
                    <button
                      onClick={() => handleExpand(ret.id)}
                      className="inline-flex items-center justify-center"
                    >
                      {expandedId === ret.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                  <div className="py-3 px-3 text-left font-medium">{ret.order_number ?? "-"}</div>
                  <div className="py-3 px-3 text-left">{customerNameMap[ret.customer_code] ?? ret.customer_code ?? "-"}</div>
                  <div className="py-3 px-3 text-center text-sm">{ret.return_date ? new Date(ret.return_date).toLocaleDateString("zh-TW") : "-"}</div>
                  <div className="py-3 px-3 text-right font-semibold tabular-nums">{typeof ret.total_amount === "number" ? ret.total_amount.toLocaleString("zh-TW") : "-"}</div>
                  <div className="py-3 px-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${ret.status === "completed" ? "bg-green-100 text-green-700" : ret.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-700"}`}>{ret.status === "completed" ? "已完成" : ret.status === "pending" ? "待處理" : ret.status}</span>
                  </div>
                  <div className="py-3 px-3 text-left text-sm text-gray-600 truncate">{ret.notes || "-"}</div>
                  <div className="py-3 px-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleExpand(ret.id)}>檢視</Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(ret)} disabled={deletingId === ret.id}>{deletingId === ret.id ? "刪除中..." : "刪除"}</Button>
                    </div>
                  </div>
                </div>
                {expandedId === ret.id && itemsMap[ret.id] && (
                  <div className="bg-gray-50 border-b">
                    {itemsMap[ret.id].length === 0 ? (
                      <div className="py-4 px-3 text-center text-gray-500 text-sm">無明細資料</div>
                    ) : (
                      <div>
                        <div className="grid grid-cols-[10%_30%_20%_20%_20%] bg-gray-100 text-xs font-semibold border-b ml-6 mr-6 mt-2">
                          <div className="py-2 px-3 text-left">商品代號</div>
                          <div className="py-2 px-3 text-left">商品名稱</div>
                          <div className="py-2 px-3 text-right">數量</div>
                          <div className="py-2 px-3 text-right">單價</div>
                          <div className="py-2 px-3 text-left">原因</div>
                        </div>
                        {itemsMap[ret.id].map((item) => (
                          <div key={item.id} className="grid grid-cols-[10%_30%_20%_20%_20%] border-b last:border-0 items-center py-3 px-3 ml-3 mr-6 text-sm">
                            <div className="text-left">{item.product_code}</div>
                            <div className="text-left">{item.product_name}</div>
                            <div className="text-right tabular-nums font-semibold">{item.quantity}</div>
                            <div className="text-right tabular-nums">{typeof item.unit_price === "number" ? item.unit_price.toLocaleString("zh-TW") : "-"}</div>
                            <div className="text-left text-gray-600">{item.reason || "-"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 手機版卡片清單 (md 以下) */}
          <div className="block md:hidden space-y-4">
            {returns.map((ret) => (
              <Card key={ret.id} className="shadow-sm bg-white">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-semibold truncate">{ret.order_number ?? "-"}</CardTitle>
                  <Badge className={`ml-2 ${ret.status === "completed" ? "bg-green-100 text-green-700 border-green-200" : ret.status === "pending" ? "bg-yellow-100 text-yellow-700 border-yellow-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}>{ret.status === "completed" ? "已完成" : ret.status === "pending" ? "待處理" : ret.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex justify-between text-sm"><span className="text-gray-500">客戶</span><span className="text-right font-medium">{customerNameMap[ret.customer_code] ?? ret.customer_code ?? "-"}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">退回日期</span><span className="text-right">{ret.return_date ? new Date(ret.return_date).toLocaleDateString("zh-TW") : "-"}</span></div>
                  <div className="flex justify-between items-end mt-2"><span className="text-gray-500">總金額</span><span className="text-right text-2xl font-bold text-emerald-700 break-all">${typeof ret.total_amount === "number" ? ret.total_amount.toLocaleString("zh-TW") : "-"}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">備註</span><span className="text-right text-gray-600">{ret.notes || "-"}</span></div>
                </CardContent>
                <CardFooter className="flex gap-4 pt-2">
                  <Button className="flex-1 py-3 text-base" variant="outline" onClick={() => handleExpand(ret.id)}>檢視</Button>
                  <Button className="flex-1 py-3 text-base" variant="destructive" onClick={() => setDeleteTarget(ret)} disabled={deletingId === ret.id}>{deletingId === ret.id ? "刪除中..." : "刪除"}</Button>
                </CardFooter>
                {expandedId === ret.id && itemsMap[ret.id] && (
                  <div className="bg-gray-50 border-t mt-2 rounded-b-xl">
                    {itemsMap[ret.id].length === 0 ? (
                      <div className="py-4 px-3 text-center text-gray-500 text-sm">無明細資料</div>
                    ) : (
                      <div className="divide-y">
                        {itemsMap[ret.id].map((item) => (
                          <div key={item.id} className="flex flex-col gap-1 py-2 px-3 text-sm">
                            <div className="flex justify-between"><span className="text-gray-500">商品</span><span>{item.product_name}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">數量</span><span className="tabular-nums font-semibold">{item.quantity}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">單價</span><span className="tabular-nums">{typeof item.unit_price === "number" ? item.unit_price.toLocaleString("zh-TW") : "-"}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">原因</span><span className="text-gray-600">{item.reason || "-"}</span></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除銷貨退回</AlertDialogTitle>
            <AlertDialogDescription>
              您確定要刪除此筆銷貨退回紀錄嗎？刪除後將回補庫存，且此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={Boolean(deletingId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId ? "刪除中..." : "刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}